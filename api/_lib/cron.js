/**
 * Өдөр бүрийн cron (vercel.json → /api/cron/daily, УБ 04:00). Vercel нь `Authorization: Bearer <CRON_SECRET>`
 * толгойг автоматаар илгээнэ. Хийх ажил (хугацааны төсөв ~55 с, maxDuration 60):
 *   1. Гацсан event-тэй яриа (retryAt өнгөрсөн) — webhook-ийн waitUntil тасарсан бол нөхнө
 *   2. Хадгалах хугацаа: event 30, ноорог 180, ai_runs 400, echo загвар 90 хоног; ярианы мессеж 180 хоног
 *      (200-аар хуудаслан, хугацаа дуустал — өдрийн хязгааргүй)
 *   3. messenger_status/main: lastCronAt, env «тохируулсан эсэх» (boolean), Meta token-ийн шалгалт (байвал)
 * Хариунд зөвхөн тоо (хувийн мэдээлэлгүй).
 */
import { configStatus, cronSecret } from './config.js';
import { safeEqual } from './social/meta-signature.js';
import { createMetaClient } from './social/meta-client.js';
import { metaConfig } from './social/meta-config.js';
import { COL } from './store.js';
import { describeError } from './errors.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/**
 * @param {{ env?: Record<string, string|undefined>, getRuntime: () => any, fetchImpl?: typeof fetch, now?: () => Date, budgetMs?: number,
 *   log?: (m: string) => void }} deps
 */
export function createCronHandler(deps) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m) => console.error(m));
  return async function GET(request) {
    const secret = cronSecret(env);
    const auth = request.headers.get('authorization') ?? '';
    if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return json({ ok: false }, 401);
    const rt = deps.getRuntime();
    if (!rt) return json({ ok: false, reason: 'not_configured' }, 503);

    const start = Date.now();
    // maxDuration 60 с: гацсан event (Claude-ийг ≤ start+15 с хүртэл эхлүүлнэ — pipeline AGENT_MIN_MS) → ≤ 45 с, дараа нь
    // хадгалах хугацааны цэвэрлэгээ өөрийн төсөвтэй (≤ 55 с)
    const deadline = start + (deps.budgetMs ?? 55_000);
    const sweepUntil = deadline - 10_000;
    const out = { ok: true, sweptThreads: 0, purged: {}, metaToken: null };
    try {
      out.sweptThreads = await rt.pipeline.sweepStale({ maxThreads: 20, deadline: sweepUntil });
      // Хуудаслан устгана (өдрийн хязгааргүй — хоцрогдол хуримтлагдахгүй), хугацаа дуустал
      for (const c of [COL.events, COL.drafts, COL.runs, COL.echo]) {
        let n = 0;
        for (let page = 200; page === 200 && Date.now() < deadline - 3000;) {
          page = await rt.store.purgeExpired(c, 200);
          n += page;
        }
        out.purged[c] = n;
      }
      let msgs = 0;
      for (let r = { threads: 20 }; r.threads === 20 && Date.now() < deadline - 3000;) {
        r = await rt.store.purgeThreadMessages(20);
        msgs += r.deleted;
      }
      out.purged.messages = msgs;
      const m = metaConfig(env);
      if (m.pageToken && m.pageId && Date.now() < deadline) {
        try {
          const page = await createMetaClient({ pageToken: m.pageToken, fetchImpl: deps.fetchImpl }).getPage(m.pageId);
          out.metaToken = page.id === m.pageId ? 'ok' : 'page_mismatch';
        } catch (e) {
          out.metaToken = e?.kind || 'unknown';
        }
      }
      await rt.store.patchStatus({ lastCronAt: now(), config: configStatus(env), metaToken: out.metaToken });
    } catch (e) {
      log(`[messenger] cron алдаа: ${describeError(e)}`);
      await rt.store.patchStatus({ lastError: { code: `cron_${e?.status || e?.name || 'error'}`.slice(0, 40), at: now() } }).catch(() => {});
      return json({ ...out, ok: false }, 500);
    }
    return json(out);
  };
}

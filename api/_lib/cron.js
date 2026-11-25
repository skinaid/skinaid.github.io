/**
 * Өдөр бүрийн cron (vercel.json → /api/cron/daily, УБ 04:00). Vercel нь `Authorization: Bearer <CRON_SECRET>`
 * толгойг автоматаар илгээнэ. Хийх ажил (хугацааны төсөв ~45 с, maxDuration 60):
 *   1. Гацсан event-тэй яриа (retryAt өнгөрсөн) — webhook-ийн waitUntil тасарсан бол нөхнө
 *   2. Хадгалах хугацаа: event 30, ноорог 180, ai_runs 400, echo загвар 90 хоног; ярианы мессеж 180 хоног
 *   3. messenger_status/main: lastCronAt, env «тохируулсан эсэх» (boolean), Meta token-ийн шалгалт (байвал)
 * Хариунд зөвхөн тоо (хувийн мэдээлэлгүй).
 */
import { configStatus, cronSecret } from './config.js';
import { safeEqual } from './social/meta-signature.js';
import { createMetaClient } from './social/meta-client.js';
import { metaConfig } from './social/meta-config.js';
import { COL } from './store.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/**
 * @param {{ env?: Record<string, string|undefined>, getRuntime: () => any, fetchImpl?: typeof fetch, now?: () => Date, budgetMs?: number }} deps
 */
export function createCronHandler(deps) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  return async function GET(request) {
    const secret = cronSecret(env);
    const auth = request.headers.get('authorization') ?? '';
    if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return json({ ok: false }, 401);
    const rt = deps.getRuntime();
    if (!rt) return json({ ok: false, reason: 'not_configured' }, 503);

    const deadline = Date.now() + (deps.budgetMs ?? 45_000);
    const out = { ok: true, sweptThreads: 0, purged: {}, metaToken: null };
    try {
      out.sweptThreads = await rt.pipeline.sweepStale({ maxThreads: 20, deadline: deadline - 15_000 });
      for (const c of [COL.events, COL.drafts, COL.runs, COL.echo]) {
        if (Date.now() > deadline) break;
        out.purged[c] = await rt.store.purgeExpired(c, 200);
      }
      if (Date.now() < deadline) out.purged.messages = await rt.store.purgeThreadMessages(20);
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
      await rt.store.patchStatus({ lastError: { code: `cron_${e?.status || e?.name || 'error'}`.slice(0, 40), at: now() } }).catch(() => {});
      return json({ ...out, ok: false }, 500);
    }
    return json(out);
  };
}

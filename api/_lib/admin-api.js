/**
 * Admin-ийн серверийн үйлдэл — POST https://www.skinaid.mn/api/admin (admin/m-messenger.js дуудна). api/admin.js нь
 * жинхэнэ deps-ээр холбоно; тест хуурамч deps тарина.
 *
 * Хамгаалалт (дарааллаар): Origin = https://www.skinaid.mn → Content-Type JSON → Firebase ID token (admin-auth.js:
 * гарын үсэг, aud/iss/exp, email_verified, allowlist = firestore.rules) → body ≤ 16 KB → үйлдлийн allowlist.
 * Token, хүсэлтийн текстийг ХЭЗЭЭ Ч логлохгүй (тогтмол код л).
 *
 * Үйлдлүүд:
 *   · knowledge — prompt-д юу орж байгааг харуулна (LLM-гүй; кэшгүй уншина)
 *   · test      — «Туршилтын асуулт»: нууцалсан текст → үйлдвэрлэлийн ИЖИЛ мэдлэг/prompt/Claude/бодлого → ноорогтой
 *                 ижил хариу. messenger_drafts-д бичихгүй, хэнд ч илгээхгүй; ai_runs + сарын хязгаарт тоологдоно,
 *                 өдөрт ≤ ADMIN_TESTS_PER_DAY, сард ≤ сарын AI хязгаарын 20% (үйлдвэрлэлийн ноорогт үлдээнэ); Claude-ийг
 *                 дуудахаас ӨМНӨ тоолно; инстанст нэг удаад нэг; яаралтай зогсоолт асаалттай бол татгалзана. Горим
 *                 «Унтраалттай» үед ч ажиллана (асаахаас өмнө шалгах).
 */
import { anthropicConfigured } from './config.js';
import { AuthError, createTokenVerifier } from './admin-auth.js';
import { readBody } from './webhook.js';
import { redactForLlm } from './guardrails.js';
import { ADMIN_TESTS_PER_DAY, adminTestsPerMonth, ubDay, ubMonth } from './store.js';
import { capReached } from './agent.js';
import { buildSocialRequest, SOCIAL_PROMPT_VERSION } from './social/prompt.js';
import { describeError } from './errors.js';

export const ADMIN_ORIGIN = 'https://www.skinaid.mn';
export const ADMIN_MAX_BODY = 16_384;
/** Туршилтын асуултын дээд урт (тэмдэгт) */
export const TEST_TEXT_MAX = 1000;
/** Хүсэлт ирснээс хойш ийм хугацаа өнгөрсөн бол Claude-ийг дуудахгүй (maxDuration 60 с: Claude 25 с + бүртгэл) */
export const TEST_START_BUDGET_MS = 25_000;
/** Эрхийн алдаа (401 биш 403): нэвтэрсэн ч admin биш */
const FORBIDDEN = new Set(['not_admin', 'email_not_verified', 'bad_provider']);

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
const fail = (status, error, extra = {}) => json({ ok: false, error, ...extra }, status);

const countBy = (arr, key) => arr.reduce((m, x) => ({ ...m, [x[key]]: (m[x[key]] || 0) + 1 }), {});

/**
 * @param {{ getRuntime: () => ({ store: any, knowledge: any, agent: any } | null), env?: Record<string, string|undefined>,
 *   verifyIdToken?: (t: unknown) => Promise<{ email: string, uid: string }>, now?: () => Date, log?: (m: string) => void,
 *   origin?: string, clock?: () => number }} deps
 */
export function createAdminHandler(deps) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m) => console.warn(m));
  const verify = deps.verifyIdToken ?? createTokenVerifier();
  const origin = deps.origin ?? ADMIN_ORIGIN;
  const clock = deps.clock ?? Date.now;
  /** Инстанст нэг удаад нэг туршилт (олон таб, давхар дарах) */
  let testInFlight = false;

  /** @type {Record<string, (rt: any, body: Record<string, any>, started: number) => Promise<Response>>} */
  const actions = {
    async knowledge(rt, body) {
      let k;
      let req;
      try {
        k = await rt.knowledge.load(body.includeDrafts === true ? { includeDrafts: true } : { fresh: true });
        req = buildSocialRequest({ catalog: k.catalog, examples: k.examples, turns: [] });
      } catch (e) {
        log(`[messenger] admin knowledge алдаа: ${describeError(e)}`);
        return fail(500, 'knowledge_error');
      }
      const ids = (kind) => k.catalog.facts.filter((f) => f.kind === kind).map((f) => f.id);
      return json({
        ok: true,
        knowledge: {
          promptVersion: SOCIAL_PROMPT_VERSION,
          knowledgeRev: req.context.knowledgeRev,
          facts: countBy(k.catalog.facts, 'kind'),
          kb: ids('kb'),
          pages: ids('page'),
          voice: Boolean(k.catalog.voiceBrief),
          examples: k.examples.map((e) => ({ id: e.id, kind: e.kind })),
          excluded: k.excluded,
          truncated: k.catalog.truncated,
          allowedAmounts: k.catalog.allowedAmounts,
          allowedPercents: k.catalog.allowedPercents,
          chars: { static: req.system[0].text.length, knowledge: req.system[1].text.length, examples: req.system[2]?.text.length ?? 0 },
          // Эмнэлгийн өөрийн мэдлэг (нийтийн каталог + admin-ий бичсэн) — эзэмшигч prompt-ийг яг харах
          blocks: req.system.slice(1).map((b) => b.text),
        },
      });
    },

    async test(rt, body, started) {
      const raw = typeof body.text === 'string' ? body.text.trim() : '';
      if (!raw || [...raw].length > TEST_TEXT_MAX) return fail(400, 'bad_text');
      if (testInFlight) return fail(429, 'busy');
      testInFlight = true;
      try {
        return await runTest(rt, body, raw, started);
      } finally {
        testInFlight = false;
      }
    },
  };

  /** «Туршилтын асуулт»-ын үндсэн алхмууд (testInFlight түгжээний дотор) */
  async function runTest(rt, body, raw, started) {
    const settings = await rt.store.readSettings();
    if (settings.killSwitch) return fail(409, 'kill_switch');
    if (!anthropicConfigured(env)) return fail(503, 'no_ai_key');
    const t = now();
    const month = ubMonth(t);
    const day = ubDay(t);
    if (capReached(await rt.store.readUsage(month), settings)) return fail(429, 'month_cap');
    // Claude-ийг дуудахаас ӨМНӨ тоолно (зэрэг хүсэлт, бүртгэл бичигдээгүй ч хязгаар ажиллана)
    const monthMax = adminTestsPerMonth(settings);
    const r0 = await rt.store.reserveAdminTest({ month, day, dayMax: ADMIN_TESTS_PER_DAY, monthMax });
    if (!r0.ok) return fail(429, r0.reason, { limit: r0.reason === 'month_tests' ? monthMax : ADMIN_TESTS_PER_DAY });
    const k = await rt.knowledge.load(body.includeDrafts === true ? { includeDrafts: true } : {});
    if (clock() - started > TEST_START_BUDGET_MS) return fail(503, 'timeout');
    const r = await rt.agent.testDraft({ k, text: redactForLlm(raw) });
    try {
      await rt.store.saveAdminRun({ run: r.run, month });
    } catch (e) {
      // Claude аль хэдийн төлбөртэй — зардлыг логт үлдээнэ (туршилтын тоо урьдчилан тоологдсон)
      log(`[messenger] admin test: бүртгэл бичигдсэнгүй (${Math.round(r.run.costMicroUsd || 0)} µ$): ${describeError(e)}`);
    }
    const run = {
      costMicroUsd: r.run.costMicroUsd,
      inputTokens: r.run.inputTokens,
      outputTokens: r.run.outputTokens,
      cacheReadTokens: r.run.cacheReadTokens,
      cacheWriteTokens: r.run.cacheWriteTokens,
      durationMs: r.run.durationMs,
      model: r.run.model,
      knowledgeRev: r.run.context?.knowledgeRev ?? null,
    };
    const counts = { testsToday: r0.dayTests, testsLimit: ADMIN_TESTS_PER_DAY };
    if (r.status === 'error') return fail(502, 'ai_error', { code: String(r.code).slice(0, 40), run, ...counts });
    return json({ ok: true, result: r.draft, run, ...counts });
  }

  /** @param {Request} request */
  return async function POST(request) {
    const started = clock();
    if ((request.headers.get('origin') ?? '') !== origin) return fail(403, 'origin');
    if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return fail(415, 'content_type');
    const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(request.headers.get('authorization') ?? '');
    try {
      await verify(m ? m[1] : '');
    } catch (e) {
      const code = e instanceof AuthError ? e.code : 'auth_error';
      if (code === 'certs_unavailable') return fail(503, 'auth_unavailable');
      log(`[messenger] admin: нэвтрэлт татгалзсан (${code})`);
      return FORBIDDEN.has(code) ? fail(403, 'forbidden') : fail(401, 'unauthorized');
    }
    if (Number(request.headers.get('content-length') ?? '0') > ADMIN_MAX_BODY) return fail(413, 'too_large');
    const raw = await readBody(request, ADMIN_MAX_BODY);
    if (!raw) return fail(413, 'too_large');
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return fail(400, 'bad_json');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'bad_json');
    const name = typeof body.action === 'string' && Object.hasOwn(actions, body.action) ? body.action : '';
    if (!name) return fail(404, 'unknown_action');
    const rt = deps.getRuntime();
    if (!rt) return fail(503, 'not_configured');
    try {
      return await actions[name](rt, body, started);
    } catch (e) {
      log(`[messenger] admin ${name} алдаа: ${describeError(e)}`);
      return fail(500, 'server_error');
    }
  };
}

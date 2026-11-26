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
 *   · eval_start / eval_chunk / eval_finish — бодит Claude-тэй eval (≥ 100 зохиомол кейс, generated/eval-cases.js) ҮЙЛДВЭРЛЭЛИЙН
 *                 мэдлэгтэй; хэсэг тус бүр ≤ 6 кейс (зэрэг, функцийн 60 с-т багтана; Claude-ээс ӨМНӨ хэсгийг эзэмшинэ — давхар
 *                 төлөхгүй). Өдөрт ≤ 3 ажиллагаа, нэг ажиллагаа ≤ $5 (хэтэрвэл зогсоно), сарын хязгаар ба туршилттай ижил admin-ий
 *                 дэд хязгаарт (20%) тоологдоно; үр дүн messenger_status/eval_<id>, түүх messenger_status/evals.
 */
import { anthropicConfigured } from './config.js';
import { AuthError, createTokenVerifier } from './admin-auth.js';
import { readBody } from './webhook.js';
import { redactForLlm } from './guardrails.js';
import { ADMIN_TESTS_PER_DAY, adminTestCostPerMonth, adminTestsPerMonth, EVAL_LIMITS, ubDay, ubMonth } from './store.js';
import { EVAL_CASES } from './generated/eval-cases.js';
import { compareRuns, gradeCase, summarize } from './eval.js';
import { randomBytes } from 'node:crypto';
import { capReached } from './agent.js';
import { buildSocialRequest, SOCIAL_PROMPT_VERSION } from './social/prompt.js';
import { describeError } from './errors.js';
import { FirestoreError } from './firestore.js';

export const ADMIN_ORIGIN = 'https://www.skinaid.mn';
export const ADMIN_MAX_BODY = 16_384;
/** Туршилтын асуултын дээд урт (тэмдэгт) */
export const TEST_TEXT_MAX = 1000;
/** Хүсэлт ирснээс хойш ийм хугацаа өнгөрсөн бол Claude-ийг дуудахгүй (maxDuration 60 с: Claude 25 с + бүртгэл) */
export const TEST_START_BUDGET_MS = 25_000;
/** Нэг кейсийн ойролцоо зардал (кэштэй 6–9K оролт + 300–800 гаралт/бодол) — тооцоонд */
export const EVAL_EST_MICRO_USD = 20_000;
/** Eval-ийн хэсэг: хүсэлт ирснээс хойш ийм хугацаа өнгөрсөн бол Claude-ийг дуудахгүй (Claude ≤ 25 с + commit-д нөөц) */
export const EVAL_START_BUDGET_MS = 10_000;
const RUN_ID_RE = /^ev[a-z0-9]{8,30}$/;
/** Эрхийн алдаа (401 биш 403): нэвтэрсэн ч admin биш */
const FORBIDDEN = new Set(['not_admin', 'email_not_verified', 'bad_provider']);

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
const fail = (status, error, extra = {}) => json({ ok: false, error, ...extra }, status);

const knowledgeRevOf = (k) => buildSocialRequest({ catalog: k.catalog, examples: k.examples, turns: [] }).context.knowledgeRev;
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

  /** @type {Record<string, (rt: any, body: Record<string, any>, started: number, who: { email: string }) => Promise<Response>>} */
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
      // Жишээний блок давхар PII шалгалтаар хасагдсан бол (prompt.js) — орсон гэж бүү харуул
      const examplesIn = req.context.examples > 0;
      const excluded = examplesIn ? k.excluded : [...k.excluded, ...k.examples.map((e) => ({ id: `example:${e.id}`, kind: 'example', reason: 'pii' }))];
      return json({
        ok: true,
        knowledge: {
          promptVersion: SOCIAL_PROMPT_VERSION,
          knowledgeRev: req.context.knowledgeRev,
          facts: countBy(k.catalog.facts, 'kind'),
          kb: ids('kb'),
          pages: ids('page'),
          voice: Boolean(k.catalog.voiceBrief),
          examples: examplesIn ? k.examples.map((e) => ({ id: e.id, kind: e.kind })) : [],
          excluded,
          truncated: k.catalog.truncated,
          allowedAmounts: k.catalog.allowedAmounts,
          allowedPercents: k.catalog.allowedPercents,
          chars: { static: req.system[0].text.length, knowledge: req.system[1].text.length, examples: req.system[2]?.text.length ?? 0 },
          // Эмнэлгийн өөрийн мэдлэг (нийтийн каталог + admin-ий бичсэн) — эзэмшигч prompt-ийг яг харах
          blocks: req.system.slice(1).map((b) => b.text),
        },
      });
    },

    async eval_start(rt, body, started, who) {
      const settings = await rt.store.readSettings();
      if (settings.killSwitch) return fail(409, 'kill_switch');
      if (!anthropicConfigured(env)) return fail(503, 'no_ai_key');
      const t = now();
      const month = ubMonth(t);
      if (capReached(await rt.store.readUsage(month), settings)) return fail(429, 'month_cap');
      // Мэдлэгийг өдрийн тоо тоолохоос ӨМНӨ (алдаа гарвал өдрийн 3 эрхээс хасагдахгүй); толгойг заавал шалгана
      let k;
      try {
        k = await rt.knowledge.load({ revalidate: true });
      } catch (e) {
        log(`[messenger] admin eval: мэдлэг ачаалж чадсангүй: ${describeError(e)}`);
        return fail(500, 'knowledge_error');
      }
      const total = EVAL_CASES.length;
      const estimate = total * EVAL_EST_MICRO_USD;
      // Eval нь туршилттай ижил admin-ий дэд хязгаарт (сарын зардлын 20%): бүтэн ажиллагаанд хүрэлцэхгүй бол эхлүүлэхгүй
      const r0 = await rt.store.reserveDayCount({
        day: ubDay(t), field: 'evals', max: EVAL_LIMITS.runsPerDay, month,
        monthCostField: 'testCostMicroUsd', monthCostMax: adminTestCostPerMonth(settings) - estimate,
      });
      if (!r0.ok) {
        if (r0.reason === 'month_tests') return fail(429, 'month_tests');
        return fail(429, r0.reason === 'busy' ? 'busy' : 'eval_day_cap', { limit: EVAL_LIMITS.runsPerDay });
      }
      const runId = `ev${t.getTime().toString(36)}${randomBytes(4).toString('hex')}`;
      await rt.store.createEvalRun({
        runId, by: who.email, total, chunk: EVAL_LIMITS.chunk, maxMicroUsd: EVAL_LIMITS.maxMicroUsd,
        promptVersion: SOCIAL_PROMPT_VERSION, knowledgeRev: knowledgeRevOf(k),
      });
      return json({ ok: true, runId, total, chunk: EVAL_LIMITS.chunk, estimateMicroUsd: estimate, maxMicroUsd: EVAL_LIMITS.maxMicroUsd, evalsToday: r0.count });
    },

    async eval_chunk(rt, body, started) {
      const runId = typeof body.runId === 'string' && RUN_ID_RE.test(body.runId) ? body.runId : '';
      const from = Number(body.from);
      if (!runId || !Number.isInteger(from) || from < 0 || from >= EVAL_CASES.length || from % EVAL_LIMITS.chunk) return fail(400, 'bad_request');
      const run = await rt.store.readEvalRun(runId);
      if (!run || run.status !== 'running') return fail(409, 'eval_closed');
      if ((Number(run.costMicroUsd) || 0) >= (Number(run.maxMicroUsd) || EVAL_LIMITS.maxMicroUsd)) return fail(409, 'eval_budget');
      const settings = await rt.store.readSettings();
      if (settings.killSwitch) return fail(409, 'kill_switch');
      const month = ubMonth(now());
      const usage = await rt.store.readUsage(month);
      if (capReached(usage, settings)) return fail(429, 'month_cap');
      if ((Number(usage?.testCostMicroUsd) || 0) >= adminTestCostPerMonth(settings)) return fail(429, 'month_tests');
      let k;
      try {
        k = await rt.knowledge.load({ revalidate: true });
      } catch (e) {
        log(`[messenger] admin eval: мэдлэг ачаалж чадсангүй: ${describeError(e)}`);
        return fail(500, 'knowledge_error');
      }
      // Claude (≤ 25 с) + бүртгэлийн commit функцийн 60 с-т багтах ёстой (аудит: өмнө 25 с — commit тасрах эрсдэлтэй)
      if (clock() - started > EVAL_START_BUDGET_MS) return fail(503, 'timeout');
      // Claude-ийг дуудахаас ӨМНӨ хэсгийг эзэмшинэ — давхар/зэрэг хүсэлт хоёр удаа төлөхгүй
      const claim = await rt.store.claimEvalChunk(runId, from);
      if (claim.state === 'done') return json({ ok: true, results: claim.results, costMicroUsd: Number(run.costMicroUsd) || 0, repeated: true });
      if (claim.state === 'busy') return fail(409, 'busy', { retryAfterMs: claim.retryAfterMs });
      const rev = knowledgeRevOf(k);
      const cases = EVAL_CASES.slice(from, from + EVAL_LIMITS.chunk);
      const settled = await Promise.allSettled(cases.map(async (c) => {
        const turns = c.turns.map((x) => ({ role: x.role, text: redactForLlm(x.text) }));
        return { c, r: await rt.agent.testDraft({ k, turns, kind: 'eval' }) };
      }));
      const out = settled.map((s, i) => {
        const c = cases[i];
        if (s.status === 'rejected') {
          log(`[messenger] admin eval: кейс ${c.id} алдаа: ${describeError(s.reason)}`);
          return { run: null, result: { id: c.id, tags: c.tags, costMicroUsd: 0, ms: 0, pass: false, why: 'error', error: 'exception' } };
        }
        const { r } = s.value;
        const base = { id: c.id, tags: c.tags, costMicroUsd: Number(r.run.costMicroUsd) || 0, ms: Number(r.run.durationMs) || 0 };
        if (r.status === 'error') return { run: r.run, result: { ...base, pass: false, why: 'error', error: String(r.code).slice(0, 40) } };
        const d = r.draft;
        const extra = { route: d.route, intent: d.intent, reasons: d.reasons, reply: String(d.reply || '').slice(0, 300) };
        // AI-ийн гаралт буруу / татгалзсан → кодын нөөц шилжүүлэлт: AI өөрөө шийдээгүй тул «тэнцсэн» гэж тоолохгүй (аудит)
        if (r.status === 'fallback') return { run: r.run, result: { ...base, ...extra, pass: false, why: 'fallback', fallback: String(d.reasons?.[0] || '') } };
        const g = gradeCase(c, { route: d.route, intent: d.intent, reasons: d.reasons, lint: d.lint }, d.reply);
        return { run: r.run, result: { ...base, ...g, ...extra } };
      });
      const results = out.map((x) => x.result);
      const runs = out.map((x) => x.run);
      try {
        await rt.store.saveEvalChunk({ runId, from, results, runs, month, knowledgeRev: rev });
      } catch (e) {
        // Claude аль хэдийн төлбөртэй — зардлыг заавал бүртгэнэ (хэсгийн түгжээ 90 с-ийн дараа дахин эзэмшигдэнэ)
        const cost = results.reduce((n, r) => n + r.costMicroUsd, 0);
        log(`[messenger] admin eval: хэсэг бичигдсэнгүй (${Math.round(cost)} µ$): ${describeError(e)}`);
        await rt.store.recordEvalCost({ runs, month }).catch((e2) => log(`[messenger] admin eval: зардал бичигдсэнгүй: ${describeError(e2)}`));
        // Түгжээг чөлөөлнө — эс бөгөөс admin-ий дахин оролдлого 90 с «busy» авч ажиллагаа хагас дуусна (аудит)
        await rt.store.releaseEvalChunk(runId, from).catch(() => {});
        // Ажиллагаа энэ хооронд дууссан/устсан (хуудсыг орхисон) — дахин оролдох утгагүй
        const gone = e instanceof FirestoreError && (e.isNotFound || e.isPrecondition);
        return gone ? fail(409, 'eval_closed') : fail(500, 'server_error');
      }
      return json({ ok: true, results, costMicroUsd: (Number(run.costMicroUsd) || 0) + results.reduce((n, r) => n + r.costMicroUsd, 0) });
    },

    async eval_finish(rt, body) {
      const runId = typeof body.runId === 'string' && RUN_ID_RE.test(body.runId) ? body.runId : '';
      if (!runId) return fail(400, 'bad_request');
      const run = await rt.store.readEvalRun(runId);
      if (!run || run.status !== 'running') return fail(409, 'eval_closed');
      const total = Number(run.total) || 0;
      const chunk = Number(run.chunk) || EVAL_LIMITS.chunk;
      const { results, revs } = await rt.store.readEvalResults(runId, total, chunk);
      const summary = summarize(results);
      // Нэг ч кейс дуусаагүй — түүхэд оруулахгүй (дараагийн харьцуулалтыг хоосон болгохгүй)
      if (!summary.done) {
        await rt.store.discardEval({ runId, total, chunk });
        return json({ ok: true, discarded: true, summary, failures: [], compare: null, partial: true });
      }
      const cases = Object.fromEntries(results.filter((r) => !r.error).map((r) => [r.id, r.pass ? 1 : 0]));
      // Өмнөх БҮТЭН дууссан ажиллагаатай харьцуулна (хагас ажиллагаа суурь болохгүй — аудит)
      const idx = await rt.store.readEvalIndex();
      const prevEntry = (Array.isArray(idx.runs) ? idx.runs : []).find((r) => r && r.runId !== runId && !r.partial && Number(r.done) > 0);
      const prevRun = prevEntry ? await rt.store.readEvalRun(prevEntry.runId) : null;
      const compare = prevRun && prevRun.cases
        ? {
          runId: prevEntry.runId, at: prevEntry.at ?? null, done: Number(prevEntry.done) || 0,
          ...compareRuns(Object.fromEntries(Object.entries(prevRun.cases).map(([id, v]) => [id, v === 1])), Object.fromEntries(Object.entries(cases).map(([id, v]) => [id, v === 1]))),
        }
        : null;
      const failures = results.filter((r) => !r.pass).map((r) => ({ id: r.id, why: r.why, route: r.route ?? null, intent: r.intent ?? null, error: r.error ?? r.fallback ?? null, reply: String(r.reply || '').slice(0, 200) }));
      const partial = results.length < total;
      // Явцад мэдлэг өөрчлөгдсөн (эзэмшигч засварласан) — тайланд анхааруулна
      const knowledgeChanged = revs.length > 1 || (revs.length === 1 && Boolean(run.knowledgeRev) && revs[0] !== run.knowledgeRev);
      await rt.store.finishEval({
        runId, total, chunk,
        report: { summary, cases, failures, compare, partial, knowledgeChanged },
        entry: { runId, by: run.by, promptVersion: run.promptVersion, knowledgeRev: run.knowledgeRev, partial, pass: summary.pass, done: summary.done, passRate: summary.passRate, risky: summary.risky, invented: summary.invented, errors: summary.errors, fallbacks: summary.fallbacks, costMicroUsd: summary.costMicroUsd },
      });
      return json({ ok: true, summary, failures, compare, partial, knowledgeChanged });
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
    const r0 = await rt.store.reserveAdminTest({ month, day, dayMax: ADMIN_TESTS_PER_DAY, monthMax, monthCostMax: adminTestCostPerMonth(settings) });
    if (!r0.ok) return fail(429, r0.reason, { limit: r0.reason === 'month_tests' ? monthMax : ADMIN_TESTS_PER_DAY });
    let k;
    try {
      // Ноорогтой эсвэл үйлдвэрлэлийн мэдлэг — толгойг заавал шалгана (сая хадгалсан мэдлэг шууд тусна)
      k = await rt.knowledge.load(body.includeDrafts === true ? { includeDrafts: true } : { revalidate: true });
    } catch (e) {
      log(`[messenger] admin test: мэдлэг ачаалж чадсангүй: ${describeError(e)}`);
      return fail(500, 'knowledge_error');
    }
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
    let who;
    try {
      who = await verify(m ? m[1] : '');
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
      return await actions[name](rt, body, started, who);
    } catch (e) {
      log(`[messenger] admin ${name} алдаа: ${describeError(e)}`);
      return fail(500, 'server_error');
    }
  };
}

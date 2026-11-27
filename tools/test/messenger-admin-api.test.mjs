// Messenger AI 2-р үе шат — admin-ийн серверийн үйлдэл (api/admin.js): Firebase ID token-ийн шалгалт (тест RSA түлхүүрээр),
// хамгаалалтын дараалал, «Prompt-д юу орж байна», «Туршилтын асуулт» (хязгаар, тоологч, ноорог бичихгүй, нууцлал).
// Firestore = санах ойн хуурамч REST (_fake-firestore.mjs), Claude = хуурамч. Сүлжээгүй.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createFakeFirestore } from './_fake-firestore.mjs';
import { createFirestore, encodeFields } from '../../api/_lib/firestore.js';
import { ADMIN_TESTS_PER_DAY, createStore, ubDay, ubMonth } from '../../api/_lib/store.js';
import { createKnowledge } from '../../api/_lib/knowledge.js';
import { createAgent } from '../../api/_lib/agent.js';
import { MESSENGER_MODEL } from '../../api/_lib/claude.js';
import { ADMIN_EMAILS, AuthError, createTokenVerifier } from '../../api/_lib/admin-auth.js';
import { ADMIN_ORIGIN, createAdminHandler, TEST_TEXT_MAX } from '../../api/_lib/admin-api.js';

// ── Тест түлхүүр, token ───────────────────────────────────────────────────

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' });
const NOW = Date.parse('2026-11-27T03:00:00Z');
const t = Math.floor(NOW / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const CLAIMS = {
  aud: 'skinaid-mn', iss: 'https://securetoken.google.com/skinaid-mn', sub: 'uid-123', iat: t - 60, exp: t + 3000, auth_time: t - 600,
  email: 'hello@skinaid.mn', email_verified: true, firebase: { sign_in_provider: 'google.com' },
};
function jwt(over = {}, { kid = 'k1', alg = 'RS256', key = privateKey, header } = {}) {
  const h = b64(header ?? { alg, kid, typ: 'JWT' });
  const p = b64({ ...CLAIMS, ...over });
  const s = sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url');
  return `${h}.${p}.${s}`;
}
function certsFetch({ maxAge = 3600, keys = { k1: PEM }, fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (fail) return new Response('no', { status: 500 });
    return new Response(JSON.stringify(keys), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAge}` } });
  };
  return { fetchImpl, calls };
}

test('token: зөв Firebase ID token → и-мэйл; түлхүүрийг Cache-Control max-age хүртэл кэшлэнэ', async () => {
  let now = NOW;
  const f = certsFetch({ maxAge: 600 });
  const verify = createTokenVerifier({ fetchImpl: f.fetchImpl, now: () => now });
  assert.deepEqual(await verify(jwt()), { email: 'hello@skinaid.mn', uid: 'uid-123' });
  await verify(jwt({ email: 'info@skinaid.mn' }));
  assert.equal(f.calls.length, 1, 'кэш');
  assert.match(f.calls[0], /securetoken@system\.gserviceaccount\.com/);
  now += 601_000;
  await verify(jwt({ iat: Math.floor(now / 1000) - 5, exp: Math.floor(now / 1000) + 3000 }));
  assert.equal(f.calls.length, 2, 'max-age дууссаны дараа дахин татна');
});

test('token: буруу aud/iss/sub/exp/iat/auth_time/provider/email_verified/allowlist/гарын үсэг/alg/kid → татгалзана (тогтмол код)', async () => {
  const f = certsFetch();
  const verify = createTokenVerifier({ fetchImpl: f.fetchImpl, now: () => NOW });
  const cases = [
    [jwt({ aud: 'other-project' }), 'bad_audience'],
    [jwt({ iss: 'https://securetoken.google.com/other' }), 'bad_issuer'],
    [jwt({ sub: '' }), 'bad_subject'],
    [jwt({ exp: t - 120 }), 'expired'],
    [jwt({ iat: t + 600 }), 'bad_iat'],
    [jwt({ auth_time: t + 600 }), 'bad_auth_time'],
    [jwt({ firebase: { sign_in_provider: 'password' } }), 'bad_provider'],
    [jwt({ email_verified: false }), 'email_not_verified'],
    [jwt({ email_verified: 'true' }), 'email_not_verified'],
    [jwt({ email: 'attacker@example.com' }), 'not_admin'],
    [jwt({ email: 'Hello@skinaid.mn' }), 'not_admin'],   // rules шиг яг тэнцүү
    [jwt({}, { key: other.privateKey }), 'bad_signature'],
    [jwt({}, { alg: 'HS256' }), 'bad_header'],
    [jwt({}, { header: { alg: 'none', kid: 'k1' } }), 'bad_header'],
    [jwt({}, { kid: 'nope' }), 'unknown_kid'],
    ['abc', 'malformed'],
    ['a.b', 'malformed'],
    ['a.b.c!', 'malformed'],
    ['', 'no_token'],
    [null, 'no_token'],
    ['x'.repeat(5000), 'no_token'],
  ];
  for (const [tok, code] of cases) {
    await assert.rejects(verify(tok), (e) => e instanceof AuthError && e.code === code, `${code}`);
  }
  // Гарын үсэгтэй token-ийн payload-ийг сольсон (email → admin) — гарын үсэг таарахгүй
  const [h, , s] = jwt({ email: 'attacker@example.com' }).split('.');
  await assert.rejects(verify(`${h}.${b64({ ...CLAIMS })}.${s}`), (e) => e.code === 'bad_signature');
  // Цагийн зөрүү (60 с) дотор зөвшөөрнө
  await verify(jwt({ iat: t + 30, exp: t - 30 }));
});

test('token: танихгүй kid → түлхүүрийг албадан дахин татах нь 5 минутад ≤ 1 (давталт үүсгэхгүй); сертификат татагдахгүй = certs_unavailable', async () => {
  let now = NOW;
  const f = certsFetch();
  const verify = createTokenVerifier({ fetchImpl: f.fetchImpl, now: () => now });
  await verify(jwt());
  for (let i = 0; i < 5; i++) await assert.rejects(verify(jwt({}, { kid: 'rotated' })), (e) => e.code === 'unknown_kid');
  assert.equal(f.calls.length, 1);
  now += 6 * 60_000;
  await assert.rejects(verify(jwt({ iat: t + 300, exp: t + 3000 }, { kid: 'rotated' })), (e) => e.code === 'unknown_kid');
  assert.equal(f.calls.length, 2);
  const down = createTokenVerifier({ fetchImpl: certsFetch({ fail: true }).fetchImpl, now: () => NOW });
  await assert.rejects(down(jwt()), (e) => e.code === 'certs_unavailable');
});

test('token: allowlist = firestore.rules isAdmin() = assets/js/firebase-config.js ADMIN_EMAILS', () => {
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  const list = rules.match(/request\.auth\.token\.email in \[([^\]]+)\]/)[1];
  assert.deepEqual([...list.matchAll(/'([^']+)'/g)].map((m) => m[1]), [...ADMIN_EMAILS]);
  const cfg = readFileSync(new URL('../../assets/js/firebase-config.js', import.meta.url), 'utf8');
  assert.deepEqual([...cfg.match(/ADMIN_EMAILS = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]), [...ADMIN_EMAILS]);
});

// ── Admin handler ─────────────────────────────────────────────────────────

const SITE = { hours: 'Өдөр бүр 09:00-19:00', phone: '7600-0505', promoEnabled: true };
const CATALOG = { services: [{ id: 'exam-1', c: 'exam', n: 'Арьсны үзлэг, оношлогоо', t: '1 цаг', p: '₮50,000' }], packages: [] };
const ENV = { ANTHROPIC_API_KEY: 'sk-ant-test-not-real' };
const reply = (over = {}) => JSON.stringify({ intent: 'price', confidence: 0.9, needs_human: false, reply: 'Арьсны үзлэг ₮50,000.', source_ids: ['service:exam-1'], quick_replies: [], reason: 'Үнэ', ...over });

function setup({ settings = { mode: 'shadow', killSwitch: false, monthlyRunCap: 3000, monthlyCostCapUsd: 50 }, claude, env = ENV, verifyIdToken, warmupMs } = {}) {
  const fake = createFakeFirestore();
  const clock = () => new Date(NOW);
  const fs = createFirestore({ projectId: 'skinaid-mn', getAccessToken: async () => 'tok', fetchImpl: fake.fetchImpl });
  const store = createStore(fs, { now: clock });
  if (settings) fake.seed('messenger_settings/main', settings, encodeFields);
  fake.seed('settings/site', SITE, encodeFields);
  fake.seed('settings/catalog', CATALOG, encodeFields);
  const claudeCalls = [];
  const callClaude = async (req) => {
    claudeCalls.push(req);
    return claude ? claude(req) : { status: 'ok', text: reply(), model: MESSENGER_MODEL, usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 } };
  };
  const knowledge = createKnowledge(store, { now: () => NOW });
  const agent = createAgent({ store, knowledge, callClaude, env, now: clock, log: () => {} });
  const logs = [];
  const rt = { store, knowledge, agent };
  const handler = createAdminHandler({
    getRuntime: () => rt, env, now: clock, log: (m) => logs.push(m), warmupMs,
    verifyIdToken: verifyIdToken ?? (async (tok) => {
      if (tok === 'good') return { email: 'hello@skinaid.mn', uid: 'u' };
      throw new AuthError(tok === 'notadmin' ? 'not_admin' : 'bad_signature');
    }),
  });
  const call = (body, { token = 'good', origin = ADMIN_ORIGIN, type = 'application/json', raw } = {}) => handler(new Request('https://www.skinaid.mn/api/admin', {
    method: 'POST',
    body: raw ?? JSON.stringify(body),
    headers: { ...(origin ? { origin } : {}), ...(type ? { 'content-type': type } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  }));
  return { fake, store, call, claudeCalls, logs, handler };
}
const kb = (fake, id, data) => fake.seed(`messenger_kb/${id}`, { updatedBy: 'hello@skinaid.mn', ...data }, encodeFields);

test('admin API: хамгаалалтын дараалал — Origin, Content-Type, token (401/403), body хэмжээ, үйлдэл, runtime', async () => {
  const s = setup();
  const code = async (res) => [res.status, (await res.json()).error];
  assert.deepEqual(await code(await s.call({ action: 'knowledge' }, { origin: 'https://evil.example' })), [403, 'origin']);
  assert.deepEqual(await code(await s.call({ action: 'knowledge' }, { origin: null })), [403, 'origin']);
  assert.deepEqual(await code(await s.call({ action: 'knowledge' }, { type: 'text/plain' })), [415, 'content_type']);
  assert.deepEqual(await code(await s.call({ action: 'knowledge' }, { token: null })), [401, 'unauthorized']);
  assert.deepEqual(await code(await s.call({ action: 'knowledge' }, { token: 'forged' })), [401, 'unauthorized']);
  assert.deepEqual(await code(await s.call({ action: 'knowledge' }, { token: 'notadmin' })), [403, 'forbidden']);
  assert.deepEqual(await code(await s.call(null, { raw: JSON.stringify({ action: 'test', text: 'x'.repeat(20_000) }) })), [413, 'too_large']);
  assert.deepEqual(await code(await s.call(null, { raw: '{not json' })), [400, 'bad_json']);
  assert.deepEqual(await code(await s.call(null, { raw: '[1]' })), [400, 'bad_json']);
  assert.deepEqual(await code(await s.call({ action: 'toString' })), [404, 'unknown_action']);
  assert.deepEqual(await code(await s.call({ action: '__proto__' })), [404, 'unknown_action']);
  assert.deepEqual(await code(await s.call({})), [404, 'unknown_action']);
  const none = createAdminHandler({ getRuntime: () => null, verifyIdToken: async () => ({ email: 'hello@skinaid.mn' }), log: () => {} });
  const res = await none(new Request('https://www.skinaid.mn/api/admin', { method: 'POST', body: '{"action":"knowledge"}', headers: { origin: ADMIN_ORIGIN, 'content-type': 'application/json', authorization: 'Bearer x' } }));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  // Token, текст логт гарахгүй
  assert.ok(!s.logs.join('\n').includes('forged'));
});

test('admin API knowledge: нийтэлсэн FAQ орно; ноорог, утастай, хоосон FAQ хасагдана (шалтгаантай); жишээ, voice, дүн', async () => {
  const s = setup();
  kb(s.fake, 'k_b', { title: 'Урьдчилгаа', body: 'Цаг захиалахад ₮20,000 урьдчилгаа төлнө. Өвлийн 10% хөнгөлөлттэй.', status: 'published' });
  kb(s.fake, 'k_a', { title: 'Зогсоол', body: 'Байрны урд үнэгүй зогсоолтой.', status: 'published' });
  kb(s.fake, 'k_draft', { title: 'Шинэ', body: 'Ноорог мэдлэг', status: 'draft' });
  kb(s.fake, 'k_pii', { title: 'Утас', body: 'Манай утас 9911 2233', status: 'published' });
  kb(s.fake, 'voice', { title: 'Брэнд', body: 'Найрсаг, товч, мэргэжлийн.', status: 'published' });
  s.fake.seed('messenger_examples/x_1', { kind: 'good', userText: 'Сайн уу', reply: 'Сайн байна уу! Юугаар туслах вэ?', note: '', updatedAt: new Date(NOW - 2000) }, encodeFields);
  s.fake.seed('messenger_examples/x_2', { kind: 'bad', userText: 'Үнэ?', reply: 'Ботокс 350,000₮', note: 'Нийтлээгүй үнэ', updatedAt: new Date(NOW - 1000) }, encodeFields);
  const res = await s.call({ action: 'knowledge' });
  assert.equal(res.status, 200);
  const k = (await res.json()).knowledge;
  assert.deepEqual(k.kb, ['kb:k_a', 'kb:k_b'], 'id-аар эрэмбэлсэн, нийтэлсэн л');
  assert.equal(k.voice, true);
  assert.deepEqual(k.examples, [{ id: 'x_1', kind: 'good' }, { id: 'x_2', kind: 'bad' }]);
  assert.ok(k.excluded.some((e) => e.id === 'kb:k_pii' && e.reason === 'pii'));
  assert.ok(k.excluded.some((e) => e.id === 'kb:k_draft' && e.reason === 'draft'), 'admin харах үед ноорог «ороогүй» гэж жагсагдана');
  assert.ok(!k.blocks.join('\n').includes('9911'), 'утастай FAQ prompt-д үгүй');
  assert.deepEqual(k.allowedAmounts, [20000, 50000]);
  assert.deepEqual(k.allowedPercents, [10]);
  assert.ok(k.chars.examples > 0 && k.chars.knowledge > 0);
  assert.match(k.knowledgeRev, /^[0-9a-f]{12}$/);
  // Ноорогтой хамт
  const d = (await (await s.call({ action: 'knowledge', includeDrafts: true })).json()).knowledge;
  assert.ok(d.kb.includes('kb:k_draft'));
});

test('admin API test: үйлдвэрлэлийн prompt + бодлого → ноорог; хадгалахгүй, ai_runs + сар + өдрийн тоологч; текст нууцлагдана', async () => {
  const s = setup();
  kb(s.fake, 'k_a', { title: 'Зогсоол', body: 'Байрны урд үнэгүй зогсоолтой.', status: 'published' });
  const res = await s.call({ action: 'test', text: 'Арьсны үзлэг хэд вэ? Миний утас 99112233' });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.result.route, 'auto_candidate');
  assert.equal(j.result.intent, 'price');
  assert.ok(j.result.labels.route);
  assert.match(j.result.wouldSend, /Цаг захиалах: https:\/\/www\.skinaid\.mn\/\?utm_source=messenger#contact/);
  assert.equal(j.testsToday, 1);
  assert.ok(j.run.costMicroUsd > 0);
  // Claude-д явсан текст нууцлагдсан, мэдлэгт FAQ орсон
  const req = s.claudeCalls[0];
  assert.ok(!JSON.stringify(req).includes('99112233'));
  assert.match(req.user, /\[утас\]/);
  assert.match(req.system[1].text, /kb:k_a/);
  // Firestore: ноорог үгүй; ai_runs (текстгүй) + тоологч
  assert.deepEqual(s.fake.list('messenger_drafts'), []);
  const runs = s.fake.list('ai_runs');
  assert.equal(runs.length, 1);
  const run = s.fake.read(runs[0]);
  assert.equal(run.kind, 'admin_test');
  assert.ok(!JSON.stringify(run).includes('үзлэг хэд'), 'ai_runs-д текст үгүй');
  assert.equal(s.fake.read(`messenger_usage/${ubMonth(new Date(NOW))}`).runs, 1);
  assert.equal(s.fake.read(`messenger_usage/${ubMonth(new Date(NOW))}`).tests, 1);
  assert.equal(s.fake.read(`messenger_usage/${ubDay(new Date(NOW))}`).tests, 1);
  assert.ok(s.fake.read(`messenger_usage/${ubDay(new Date(NOW))}`).expireAt instanceof Date, 'өдрийн тоологч cron-оор устна');
  // Туршилтын бүртгэл (ai_runs + сарын зардал) НЭГ commit-д
  const commits = s.fake.calls.filter((c) => c.url.endsWith(':commit'));
  const runCommit = commits.find((c) => c.body.writes.some((w) => w.update?.name.includes('/ai_runs/')));
  assert.ok(runCommit.body.writes.some((w) => w.update?.name.endsWith(`/messenger_usage/${ubMonth(new Date(NOW))}`)));
});

test('admin API test: яаралтай зогсоолт 409, сар/өдрийн хязгаар 429, түлхүүргүй 503, хоосон/урт текст 400, Claude алдаа 502 (тоологдоно)', async () => {
  const code = async (res) => [res.status, (await res.json()).error];
  const killed = setup({ settings: { mode: 'shadow', killSwitch: true, monthlyRunCap: 3000, monthlyCostCapUsd: 50 } });
  assert.deepEqual(await code(await killed.call({ action: 'test', text: 'Сайн уу' })), [409, 'kill_switch']);
  assert.equal(killed.claudeCalls.length, 0);
  const capped = setup({ settings: { mode: 'shadow', killSwitch: false, monthlyRunCap: 1, monthlyCostCapUsd: 50 } });
  capped.fake.seed(`messenger_usage/${ubMonth(new Date(NOW))}`, { runs: 1, costMicroUsd: 10 }, encodeFields);
  assert.deepEqual(await code(await capped.call({ action: 'test', text: 'Сайн уу' })), [429, 'month_cap']);
  const day = setup();
  day.fake.seed(`messenger_usage/${ubDay(new Date(NOW))}`, { tests: ADMIN_TESTS_PER_DAY }, encodeFields);
  assert.deepEqual(await code(await day.call({ action: 'test', text: 'Сайн уу' })), [429, 'day_cap']);
  const nokey = setup({ env: {} });
  assert.deepEqual(await code(await nokey.call({ action: 'test', text: 'Сайн уу' })), [503, 'no_ai_key']);
  const s = setup();
  assert.deepEqual(await code(await s.call({ action: 'test', text: '   ' })), [400, 'bad_text']);
  assert.deepEqual(await code(await s.call({ action: 'test', text: 'а'.repeat(TEST_TEXT_MAX + 1) })), [400, 'bad_text']);
  assert.deepEqual(await code(await s.call({ action: 'test', text: 42 })), [400, 'bad_text']);
  // Горим «Унтраалттай» үед ч туршина (асаахаас өмнө шалгах)
  const off = setup({ settings: { mode: 'off', killSwitch: false, monthlyRunCap: 3000, monthlyCostCapUsd: 50 } });
  assert.equal((await off.call({ action: 'test', text: 'Сайн уу' })).status, 200);
  const err = setup({ claude: () => ({ status: 'error', code: 'api_529', model: MESSENGER_MODEL, usage: null }) });
  const r = await err.call({ action: 'test', text: 'Сайн уу' });
  assert.equal(r.status, 502);
  assert.equal((await r.json()).code, 'api_529');
  assert.equal(err.fake.read(`messenger_usage/${ubDay(new Date(NOW))}`).tests, 1, 'алдаатай туршилт ч өдрийн тоонд');
  assert.equal(err.fake.read(`messenger_usage/${ubMonth(new Date(NOW))}`).runs, undefined, 'төлбөргүй (usage null) — сарын AI тоо хөдлөхгүй');
  // Сарын туршилтын хязгаар (сарын AI хязгаарын 20%, ≥ 100) — үйлдвэрлэлийн ноорогт үлдээнэ
  const mt = setup();
  mt.fake.seed(`messenger_usage/${ubMonth(new Date(NOW))}`, { runs: 0, tests: 600 }, encodeFields);
  assert.deepEqual(await code(await mt.call({ action: 'test', text: 'Сайн уу' })), [429, 'month_tests']);
  assert.equal(mt.claudeCalls.length, 0);
});

test('admin API test: тоог Claude-ээс ӨМНӨ атомаар нөөцөлнө — зэрэг 2 хүсэлт 99-өөс 100 хүрэхэд нэг л Claude; инстанст нэг удаад нэг', async () => {
  const s = setup();
  s.fake.seed(`messenger_usage/${ubDay(new Date(NOW))}`, { tests: ADMIN_TESTS_PER_DAY - 1 }, encodeFields);
  const [a, b] = await Promise.all([s.call({ action: 'test', text: 'Сайн уу' }), s.call({ action: 'test', text: 'Сайн уу' })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 429]);
  assert.equal(s.claudeCalls.length, 1);
  assert.equal(s.fake.read(`messenger_usage/${ubDay(new Date(NOW))}`).tests, ADMIN_TESTS_PER_DAY);
  // Зэрэг бичилт (precondition зөрчил) → дахин уншиж оролдоно
  const r = setup();
  r.fake.failNext.push({ match: (u) => u.endsWith(':commit'), status: 400, body: { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'x' } } });
  assert.equal((await r.call({ action: 'test', text: 'Сайн уу' })).status, 200);
  assert.equal(r.fake.read(`messenger_usage/${ubDay(new Date(NOW))}`).tests, 1);
});

test('admin API test: ноорогтой туршилт үйлдвэрлэлийн кэшийг бохирдуулахгүй (ноорог → энгийн дараалал)', async () => {
  const claude = () => ({ status: 'ok', text: reply({ intent: 'promotion', reply: 'Урьдчилгаа ₮20,000.', source_ids: ['kb:k_new'] }), model: MESSENGER_MODEL, usage: { input_tokens: 1, output_tokens: 1 } });
  const s = setup({ claude });
  kb(s.fake, 'k_new', { title: 'Урьдчилгаа', body: 'Цаг захиалахад ₮20,000 урьдчилгаа.', status: 'draft' });
  const dr = await (await s.call({ action: 'test', text: 'Урьдчилгаа хэд вэ?', includeDrafts: true })).json();
  assert.equal(dr.result.route, 'auto_candidate');
  const pub = await (await s.call({ action: 'test', text: 'Урьдчилгаа хэд вэ?' })).json();
  assert.equal(pub.result.route, 'handoff', 'ноорог мэдлэг үйлдвэрлэлийн мэдлэгт орохгүй');
  assert.ok(!s.claudeCalls[1].system[1].text.includes('kb:k_new'));
});

test('admin API test: ноорог FAQ-г зөвхөн «нийтлээгүйг хамт турших» үед; FAQ-ийн үнэ зөвшөөрөгдөнө', async () => {
  const claude = () => ({ status: 'ok', text: reply({ intent: 'promotion', reply: 'Урьдчилгаа ₮20,000.', source_ids: ['kb:k_new'] }), model: MESSENGER_MODEL, usage: { input_tokens: 1, output_tokens: 1 } });
  const s = setup({ claude });
  kb(s.fake, 'k_new', { title: 'Урьдчилгаа', body: 'Цаг захиалахад ₮20,000 урьдчилгаа.', status: 'draft' });
  const pub = await (await s.call({ action: 'test', text: 'Урьдчилгаа хэд вэ?' })).json();
  assert.equal(pub.result.route, 'handoff', 'нийтлээгүй FAQ-ийн үнэ = зохиосон үнэ');
  assert.ok(pub.result.reasons.includes('invented_price'));
  const dr = await (await s.call({ action: 'test', text: 'Урьдчилгаа хэд вэ?', includeDrafts: true })).json();
  assert.equal(dr.result.route, 'auto_candidate');
  assert.deepEqual(dr.result.sourceIds, ['kb:k_new']);
});

test('cron: ноорогоос үүссэн жишээ (x_) 180 хоногийн дараа устна, гараар бичсэн (e_) хэвээр; мэдлэгийн тэмдэг шинэчлэгдэнэ; өдрийн тоологч устна', async () => {
  const s = setup();
  const old = new Date(NOW - 200 * 86_400_000);
  s.fake.seed('messenger_examples/x_old', { kind: 'good', userText: 'a', reply: 'b', note: '', updatedAt: old }, encodeFields);
  s.fake.seed('messenger_examples/e_old', { kind: 'good', userText: 'a', reply: 'b', note: '', updatedAt: old }, encodeFields);
  s.fake.seed('messenger_examples/x_new', { kind: 'good', userText: 'a', reply: 'b', note: '', updatedAt: new Date(NOW) }, encodeFields);
  assert.equal(await s.store.purgeDraftExamples(), 1);
  assert.deepEqual(s.fake.list('messenger_examples').sort(), ['messenger_examples/e_old', 'messenger_examples/x_new']);
  const rev = s.fake.read('messenger_kb/_rev');
  assert.equal(rev.status, 'draft', 'тэмдэг нь нийтлэгдээгүй бичлэг — AI-д орохгүй');
  const src = readFileSync(new URL('../../api/_lib/cron.js', import.meta.url), 'utf8');
  assert.match(src, /COL\.usage, COL\.status, COL\.outbound\]/);
  assert.match(src, /purgeDraftExamples/);
});

test('баталгаажуулалт: туршилтын сарын ЗАРДЛЫН хязгаар (сарын хязгаарын 20%); мэдлэг ачаалж чадаагүй → knowledge_error', async () => {
  const code = async (res) => [res.status, (await res.json()).error];
  const s = setup();
  s.fake.seed(`messenger_usage/${ubMonth(new Date(NOW))}`, { runs: 0, testCostMicroUsd: 10_000_000 }, encodeFields);
  assert.deepEqual(await code(await s.call({ action: 'test', text: 'Сайн уу' })), [429, 'month_tests'], '$50-ийн 20% = $10');
  const k = setup();
  // Мэдлэгийн толгойн уншилт (settings/site …) л унана — туршилтын тоо нөөцлөгдсөний дараа
  k.fake.failNext.push({ match: (u, init) => u.endsWith(':batchGet') && String(init.body).includes('settings%2Fsite') === false && String(init.body).includes('settings/site'), throw: new TypeError('network down') });
  assert.deepEqual(await code(await k.call({ action: 'test', text: 'Сайн уу' })), [500, 'knowledge_error']);
  assert.equal(k.claudeCalls.length, 0);
  // Амжилттай туршилт сарын туршилтын зардлыг тоолно
  const ok = setup();
  await ok.call({ action: 'test', text: 'Сайн уу' });
  assert.ok(ok.fake.read(`messenger_usage/${ubMonth(new Date(NOW))}`).testCostMicroUsd > 0);
});

test('холбоо барих (агент): утас/имэйл асуухад КОД «Холбоо барих» мөрийг нэмнэ — LLM-д дугаар, хаяг очихгүй; ажилтанд шилжвэл, өөр сэдэвт нэмэхгүй', async () => {
  const contact = (over = {}) => reply({ intent: 'contact', confidence: 0.9, reply: 'Холбоо барих мэдээллийг доор хавсаргалаа.', source_ids: ['contact'], reason: 'Утас асуусан', ...over });
  const s = setup({ claude: () => ({ status: 'ok', text: contact(), model: MESSENGER_MODEL, usage: { input_tokens: 10, output_tokens: 10 } }) });
  s.fake.seed('settings/site', { ...SITE, email: 'info@example.mn' }, encodeFields);
  const r = (await (await s.call({ action: 'test', text: 'Утасны дугаараа өгөөч' })).json()).result;
  assert.equal(r.route, 'auto_candidate');
  assert.equal(r.intent, 'contact');
  assert.equal(r.contact, 'Холбоо барих: утас 7600-0505 · имэйл info@example.mn');
  assert.ok(r.wouldSend.endsWith('Холбоо барих: утас 7600-0505 · имэйл info@example.mn'), r.wouldSend);
  assert.ok(!r.reply.includes('7600'), 'LLM-ийн хариунд дугаар алга — код нэмсэн');
  assert.equal(r.link, null, 'холбоо барихад захиалгын холбоос нэмэхгүй');
  const sent = JSON.stringify(s.claudeCalls[0]);
  assert.ok(!sent.includes('7600') && !sent.includes('info@example.mn'), 'LLM руу утас, имэйл очихгүй');
  assert.ok(sent.includes('Холбоо барих: утас, имэйл бий'), 'мэдлэгт зөвхөн суваг');
  // Имэйл тохируулаагүй / буруу → сайтын тогтмол имэйл (сайтад харагддагтай ижил); LLM-д тэр ч очихгүй
  const p = setup({ claude: () => ({ status: 'ok', text: contact(), model: MESSENGER_MODEL, usage: { input_tokens: 10, output_tokens: 10 } }) });
  p.fake.seed('settings/site', { ...SITE, email: 'not an email' }, encodeFields);
  assert.equal((await (await p.call({ action: 'test', text: 'Утас?' })).json()).result.contact, 'Холбоо барих: утас 7600-0505 · имэйл info@skinaid.mn');
  assert.ok(!JSON.stringify(p.claudeCalls[0]).includes('info@skinaid.mn'));
  // Өөр сэдэв ч «contact» баримтыг иш татсан («Хаяг, утсаа хэлээч») → амласан мөр заавал нэмэгдэнэ
  const mixed = setup({ claude: () => ({ status: 'ok', text: reply({ intent: 'location', confidence: 0.9, reply: 'Манай хаяг Чингэлтэй дүүрэгт. Холбоо барих мэдээллийг доор хавсаргалаа.', source_ids: ['address', 'contact'], reason: 'Хаяг, утас' }), model: MESSENGER_MODEL, usage: { input_tokens: 10, output_tokens: 10 } }) });
  const mr = (await (await mixed.call({ action: 'test', text: 'Хаяг, утсаа хэлээч' })).json()).result;
  assert.equal(mr.intent, 'location');
  assert.equal(mr.route, 'auto_candidate');
  assert.ok(mr.wouldSend.endsWith('Холбоо барих: утас 7600-0505 · имэйл info@skinaid.mn'), mr.wouldSend);
  // «Хүн хянана» (draft — урт хариу): автоматаар явахгүй ч код нэмэх мөр ноорогт ил (ажилтан харна)
  const long = setup({ claude: () => ({ status: 'ok', text: contact({ reply: `Холбоо барих мэдээллийг доор хавсаргалаа. ${'Асуух зүйлээ бичээрэй. '.repeat(25)}` }), model: MESSENGER_MODEL, usage: { input_tokens: 10, output_tokens: 10 } }) });
  const lr = (await (await long.call({ action: 'test', text: 'Утас?' })).json()).result;
  assert.equal(lr.route, 'draft');
  assert.equal(lr.wouldSend, null);
  assert.equal(lr.contact, 'Холбоо барих: утас 7600-0505 · имэйл info@skinaid.mn');
  // Ажилтанд шилжсэн (AI өөрөө хүссэн) → мөр нэмэхгүй; өөр сэдэв (үнэ) → нэмэхгүй
  const h = setup({ claude: () => ({ status: 'ok', text: contact({ needs_human: true }), model: MESSENGER_MODEL, usage: { input_tokens: 10, output_tokens: 10 } }) });
  const hr = (await (await h.call({ action: 'test', text: 'Утас?' })).json()).result;
  assert.equal(hr.route, 'handoff');
  assert.equal(hr.contact, null);
  assert.ok(!hr.wouldSend.includes('Холбоо барих:'));
  const price = setup();
  const pr = (await (await price.call({ action: 'test', text: 'Үзлэг хэд вэ?' })).json()).result;
  assert.equal(pr.contact, null);
  assert.ok(!pr.wouldSend.includes('Холбоо барих:'));
});

// ── Бодит Claude-тэй eval (admin «Eval») ───────────────────────────────────

test('admin API eval: эхлүүлэх → хэсгүүд → дуусгах; үр дүн, түүх, харьцуулалт, хэсэг давхар төлөгдөхгүй, хэсгийн баримт устна', async () => {
  const { EVAL_CASES } = await import('../../api/_lib/generated/eval-cases.js');
  const { EVAL_LIMITS } = await import('../../api/_lib/store.js');
  // Хуурамч Claude: эрсдэлтэй (risky) кейст ажилтанд шилжүүлнэ, бусдад мэнд — зарим нь унах ёстой
  const claude = (req) => {
    const risky = /хавд|гомдол|жирэмсэн|буцаа|эмчтэй|ажилтан/i.test(req.user);
    return { status: 'ok', text: reply(risky ? { intent: 'side_effect', needs_human: true, reply: 'Ажилтан холбогдоно.', source_ids: [] } : { intent: 'greeting', reply: 'Сайн байна уу!', source_ids: [] }), model: MESSENGER_MODEL, usage: { input_tokens: 10, output_tokens: 10 } };
  };
  const s = setup({ claude });
  const code = async (res) => [res.status, (await res.json()).error];
  const st = await (await s.call({ action: 'eval_start' })).json();
  assert.equal(st.ok, true);
  assert.equal(st.total, EVAL_CASES.length);
  assert.ok(st.estimateMicroUsd > 0 && st.maxMicroUsd === EVAL_LIMITS.maxMicroUsd);
  assert.match(st.runId, /^ev[a-z0-9]+$/);
  assert.deepEqual(await code(await s.call({ action: 'eval_chunk', runId: st.runId, from: 1 })), [400, 'bad_request'], 'хэсгийн эхлэл chunk-ийн үржвэр');
  assert.deepEqual(await code(await s.call({ action: 'eval_chunk', runId: '../x', from: 0 })), [400, 'bad_request']);
  let calls = 0;
  for (let from = 0; from < st.total; from += st.chunk) {
    const r = await (await s.call({ action: 'eval_chunk', runId: st.runId, from })).json();
    assert.equal(r.ok, true);
    calls += r.results.length;
  }
  assert.equal(calls, EVAL_CASES.length);
  const before = s.claudeCalls.length;
  const again = await (await s.call({ action: 'eval_chunk', runId: st.runId, from: 0 })).json();
  assert.equal(again.repeated, true);
  assert.equal(s.claudeCalls.length, before, 'давтан хэсэг дахин Claude дуудахгүй');
  const fin = await (await s.call({ action: 'eval_finish', runId: st.runId })).json();
  assert.equal(fin.ok, true);
  assert.equal(fin.summary.done, EVAL_CASES.length);
  assert.ok(fin.summary.pass > 0 && fin.summary.pass < EVAL_CASES.length);
  assert.ok(fin.failures.length > 0 && fin.failures.every((f) => f.id && f.why));
  // Унасан кейс бүрт бодлогын шалтгааны код (текстгүй) — тайланд хадгалагдана
  assert.ok(fin.failures.every((f) => Array.isArray(f.reasons) && f.reasons.length <= 6 && f.reasons.every((x) => /^[a-z_]+(:[a-z_]+)?$/.test(x))), JSON.stringify(fin.failures.slice(0, 3)));
  assert.deepEqual(s.fake.read(`messenger_status/eval_${st.runId}`).failures[0].reasons, fin.failures[0].reasons, 'тайланд хадгалагдсан');
  assert.deepEqual(fin.summary.handoffReasons, {}, 'энэ хуурамч AI шаардлагагүй шилжүүлээгүй');
  assert.equal(fin.compare, null, 'анхны ажиллагаа');
  assert.equal(s.fake.list('messenger_status/evalc_').length, 0, 'хэсгийн баримт устсан');
  const idx = s.fake.read('messenger_status/evals');
  assert.equal(idx.runs[0].runId, st.runId);
  assert.equal(s.fake.read(`messenger_status/eval_${st.runId}`).status, 'done');
  assert.equal(s.fake.read(`messenger_status/eval_${st.runId}`).expireAt, null, 'дууссан ажиллагаа түүхэд үлдэнэ');
  assert.deepEqual(await code(await s.call({ action: 'eval_finish', runId: st.runId })), [409, 'eval_closed']);
  // ai_runs (kind eval, текстгүй), сарын тоологч
  const runs = s.fake.list('ai_runs').map((p) => s.fake.read(p));
  assert.equal(runs.filter((r) => r.kind === 'eval').length, EVAL_CASES.length);
  assert.ok(!JSON.stringify(runs).includes('Сайн байна уу!'));
  assert.equal(s.fake.read(`messenger_usage/${ubMonth(new Date(NOW))}`).runs, EVAL_CASES.length);
  // Хоёр дахь ажиллагаа → харьцуулалт
  const st2 = await (await s.call({ action: 'eval_start' })).json();
  for (let from = 0; from < st2.total; from += st2.chunk) await s.call({ action: 'eval_chunk', runId: st2.runId, from });
  const fin2 = await (await s.call({ action: 'eval_finish', runId: st2.runId })).json();
  assert.deepEqual(fin2.compare, { runId: st.runId, at: new Date(NOW).toISOString(), done: EVAL_CASES.length, newlyFailing: [], newlyPassing: [] });
  // Eval-ийн зардал admin-ий дэд хязгаарт (туршилт + eval = сарын зардлын 20%) тоологдоно
  assert.ok(s.fake.read(`messenger_usage/${ubMonth(new Date(NOW))}`).testCostMicroUsd > 0);
  assert.equal(s.fake.read('messenger_status/evals').runs.length, 2);
});

test('admin API eval: өдөрт ≤ 3, ажиллагааны $5 хязгаар, яаралтай зогсоолт, сарын хязгаар; хагас дууссан ажиллагааг дуусгаж болно', async () => {
  const code = async (res) => [res.status, (await res.json()).error];
  const s = setup();
  for (let i = 0; i < 3; i++) assert.equal((await s.call({ action: 'eval_start' })).status, 200);
  assert.deepEqual(await code(await s.call({ action: 'eval_start' })), [429, 'eval_day_cap']);
  // Зардал: нэг дуудлага $1 (6 кейс = $6) → хоёр дахь хэсэг $5-аас хэтэрсэн тул зогсоно (хэтрэлт ≤ нэг хэсэг)
  const pricey = setup({ claude: () => ({ status: 'ok', text: reply(), model: MESSENGER_MODEL, usage: { output_tokens: 50_000 } }) });
  const st = await (await pricey.call({ action: 'eval_start' })).json();
  assert.equal((await pricey.call({ action: 'eval_chunk', runId: st.runId, from: 0 })).status, 200);
  assert.deepEqual(await code(await pricey.call({ action: 'eval_chunk', runId: st.runId, from: st.chunk })), [409, 'eval_budget']);
  const part = await (await pricey.call({ action: 'eval_finish', runId: st.runId })).json();
  assert.equal(part.partial, true);
  assert.equal(part.summary.done, st.chunk);
  const killed = setup({ settings: { mode: 'shadow', killSwitch: true, monthlyRunCap: 3000, monthlyCostCapUsd: 50 } });
  assert.deepEqual(await code(await killed.call({ action: 'eval_start' })), [409, 'kill_switch']);
  const capped = setup({ settings: { mode: 'shadow', killSwitch: false, monthlyRunCap: 1, monthlyCostCapUsd: 50 } });
  capped.fake.seed(`messenger_usage/${ubMonth(new Date(NOW))}`, { runs: 1 }, encodeFields);
  assert.deepEqual(await code(await capped.call({ action: 'eval_start' })), [429, 'month_cap']);
});

test('аудит (eval): зэрэг/давхар хэсэг Claude-ийг НЭГ л удаа дуудна; тасарсан түгжээг 90 с-ийн дараа дахин эзэмшинэ; commit унавал зардал бүртгэгдэнэ', async () => {
  const { EVAL_CLAIM_STALE_MS } = await import('../../api/_lib/store.js');
  const code = async (res) => [res.status, (await res.json()).error];
  const s = setup();
  const st = await (await s.call({ action: 'eval_start' })).json();
  const res = await Promise.all([0, 1, 2].map(() => s.call({ action: 'eval_chunk', runId: st.runId, from: 0 })));
  const bodies = await Promise.all(res.map((r) => r.json()));
  assert.equal(s.claudeCalls.length, st.chunk, 'зэрэг 3 хүсэлт — Claude 6 л удаа');
  assert.equal(bodies.filter((b) => b.ok && !b.repeated).length, 1);
  assert.ok(bodies.every((b) => b.ok || b.error === 'busy'), JSON.stringify(bodies.map((b) => b.error)));
  const month = `messenger_usage/${ubMonth(new Date(NOW))}`;
  assert.equal(s.fake.read(month).runs, st.chunk);
  // Функц тасарч үлдсэн «pending» түгжээ: шинэ бол busy, 90 с-ээс хуучин бол дахин эзэмшинэ
  const path = `messenger_status/evalc_${st.runId}_${String(st.chunk).padStart(4, '0')}`;
  s.fake.seed(path, { runId: st.runId, from: st.chunk, status: 'pending', claimedAt: new Date(NOW - 10_000) }, encodeFields);
  const busy = await (await s.call({ action: 'eval_chunk', runId: st.runId, from: st.chunk })).json();
  assert.equal(busy.error, 'busy');
  assert.ok(busy.retryAfterMs > 79_000 && busy.retryAfterMs <= 81_000, `түгжээ чөлөөлөгдөх хүртэл: ${busy.retryAfterMs}`);
  s.fake.seed(path, { runId: st.runId, from: st.chunk, status: 'pending', claimedAt: new Date(NOW - EVAL_CLAIM_STALE_MS - 1) }, encodeFields);
  const taken = await (await s.call({ action: 'eval_chunk', runId: st.runId, from: st.chunk })).json();
  assert.equal(taken.ok, true);
  assert.equal(taken.results.length, st.chunk);
  // Хэсгийн commit унасан (Claude төлбөртэй) → зардал + ai_runs тусад нь бичигдэнэ, 500
  const runsBefore = s.fake.read(month).runs;
  s.fake.failNext.push({ match: (u, init) => u.endsWith(':commit') && String(init.body).includes(`evalc_${st.runId}_0012`) && String(init.body).includes('"done"'), status: 503, body: { error: { code: 503, status: 'UNAVAILABLE', message: 'x' } } });
  assert.deepEqual(await code(await s.call({ action: 'eval_chunk', runId: st.runId, from: 2 * st.chunk })), [500, 'server_error']);
  assert.equal(s.fake.read(month).runs, runsBefore + st.chunk, 'зардал алдагдаагүй');
  assert.ok(s.logs.some((m) => /хэсэг бичигдсэнгүй/.test(m)));
  // Баталгаажуулалт: түгжээ чөлөөлөгдсөн — admin-ий дахин оролдлого 90 с хүлээлгүй шууд амжина
  assert.equal(s.fake.read(`messenger_status/evalc_${st.runId}_0012`), null);
  assert.equal((await s.call({ action: 'eval_chunk', runId: st.runId, from: 2 * st.chunk })).status, 200);
  // Баталгаажуулалт: 0 кейстэй дуусгасан (устсан) ажиллагааны замдаа яваа хэсэг run баримтыг expireAt-гүй дахин үүсгэхгүй
  const o = setup();
  const so = await (await o.call({ action: 'eval_start' })).json();
  const { EVAL_CASES } = await import('../../api/_lib/generated/eval-cases.js');
  await o.store.claimEvalChunk(so.runId, 0);
  await o.call({ action: 'eval_finish', runId: so.runId });
  assert.equal(o.fake.read(`messenger_status/eval_${so.runId}`), null);
  const run = { status: 'ok', billable: true, costMicroUsd: 100, kind: 'eval' };
  await assert.rejects(o.store.saveEvalChunk({ runId: so.runId, from: 0, results: [{ id: EVAL_CASES[0].id, pass: true, why: '', costMicroUsd: 100 }], runs: [run], month: ubMonth(new Date(NOW)) }));
  assert.equal(o.fake.read(`messenger_status/eval_${so.runId}`), null, 'өнчин run баримт үүсээгүй');
});

test('аудит (eval): admin-ий дэд хязгаар (20%) — бүтэн ажиллагаанд хүрэлцэхгүй бол эхлэхгүй, хэтэрвэл хэсэг зогсоно; хоосон ажиллагаа түүхэд орохгүй; хагас ажиллагаа харьцуулалтын суурь болохгүй', async () => {
  const code = async (res) => [res.status, (await res.json()).error];
  const month = `messenger_usage/${ubMonth(new Date(NOW))}`;
  // $50 → admin $10; бүтэн eval ≈ 124 × $0.02 = $2.48 → $8 зарцуулсан бол эхлэхгүй
  const s = setup();
  s.fake.seed(month, { runs: 0, testCostMicroUsd: 8_000_000 }, encodeFields);
  assert.deepEqual(await code(await s.call({ action: 'eval_start' })), [429, 'month_tests']);
  const s2 = setup();
  const st = await (await s2.call({ action: 'eval_start' })).json();
  s2.fake.seed(month, { runs: 0, testCostMicroUsd: 10_000_000 }, encodeFields);
  assert.deepEqual(await code(await s2.call({ action: 'eval_chunk', runId: st.runId, from: 0 })), [429, 'month_tests']);
  assert.equal(s2.claudeCalls.length, 0);
  // Нэг ч кейс дуусаагүй → түүхэд орохгүй, баримт устна
  const fin0 = await (await s2.call({ action: 'eval_finish', runId: st.runId })).json();
  assert.equal(fin0.discarded, true);
  assert.equal(s2.fake.read(`messenger_status/eval_${st.runId}`), null);
  assert.deepEqual(s2.fake.read('messenger_status/evals')?.runs ?? [], []);
  // Хагас ажиллагаа (1 хэсэг) → дараагийн ажиллагаа түүнтэй биш, өмнөх БҮТЭН ажиллагаатай харьцуулна
  const s3 = setup();
  const full = await (await s3.call({ action: 'eval_start' })).json();
  for (let from = 0; from < full.total; from += full.chunk) await s3.call({ action: 'eval_chunk', runId: full.runId, from });
  await s3.call({ action: 'eval_finish', runId: full.runId });
  const half = await (await s3.call({ action: 'eval_start' })).json();
  await s3.call({ action: 'eval_chunk', runId: half.runId, from: 0 });
  assert.equal((await (await s3.call({ action: 'eval_finish', runId: half.runId })).json()).compare.runId, full.runId);
  const third = await (await s3.call({ action: 'eval_start' })).json();
  for (let from = 0; from < third.total; from += third.chunk) await s3.call({ action: 'eval_chunk', runId: third.runId, from });
  const fin3 = await (await s3.call({ action: 'eval_finish', runId: third.runId })).json();
  assert.equal(fin3.compare.runId, full.runId, 'хагас ажиллагааг алгасна');
  assert.equal(fin3.compare.done, full.total);
});

test('аудит (eval): AI-ийн гаралт буруу (нөөц шилжүүлэлт) тэнцсэнд тоологдохгүй; явцад мэдлэг өөрчлөгдвөл тайланд тэмдэглэнэ', async () => {
  const s = setup({ claude: () => ({ status: 'ok', text: 'JSON биш', model: MESSENGER_MODEL, usage: { input_tokens: 10, output_tokens: 10 } }) });
  const st = await (await s.call({ action: 'eval_start' })).json();
  const r = await (await s.call({ action: 'eval_chunk', runId: st.runId, from: 0 })).json();
  assert.ok(r.results.every((x) => !x.pass && x.why === 'fallback' && x.fallback === 'invalid_output'));
  kb(s.fake, 'k_new', { title: 'Шинэ', body: 'Шинэ мэдлэг.', status: 'published' });
  s.fake.seed('messenger_kb/_rev', { title: 'x', body: 'y', status: 'draft', updatedBy: 'hello@skinaid.mn' }, encodeFields);
  await s.call({ action: 'eval_chunk', runId: st.runId, from: st.chunk });
  const fin = await (await s.call({ action: 'eval_finish', runId: st.runId })).json();
  assert.equal(fin.summary.fallbacks, 2 * st.chunk);
  assert.equal(fin.summary.pass, 0);
  assert.equal(fin.knowledgeChanged, true);
});

test('eval тайлан: «шаардлагагүй ажилтанд шилжүүлсэн» кейс бүр шалтгаантай (AI өөрөө шилжүүлсэн г.м.), нэгтгэлд шалтгааны тоо', async () => {
  // Хуурамч AI бүх асуултыг ажилтанд даатгана → шилжих ёсгүй кейсүүд «handoff»-оор унана
  const s = setup({ claude: () => ({ status: 'ok', text: reply({ intent: 'other', needs_human: true, reply: 'Ажилтан удахгүй холбогдоно.', source_ids: [] }), model: MESSENGER_MODEL, usage: { input_tokens: 10, output_tokens: 10 } }) });
  const st = await (await s.call({ action: 'eval_start' })).json();
  await s.call({ action: 'eval_chunk', runId: st.runId, from: 0 });
  const fin = await (await s.call({ action: 'eval_finish', runId: st.runId })).json();
  const over = fin.failures.filter((f) => f.why === 'handoff');
  assert.ok(over.length > 0, JSON.stringify(fin.summary.whyCount));
  assert.ok(over.every((f) => f.reasons.includes('llm_needs_human')), JSON.stringify(over.slice(0, 2)));
  assert.equal(fin.summary.handoffReasons.llm_needs_human, over.length);
  assert.ok(!JSON.stringify(fin.failures.map((f) => f.reasons)).includes('Ажилтан'), 'шалтгаан = код, текст биш');
});

test('eval: эхний хэсэгт эхний кейс ГАНЦААР (кэш бичүүлнэ), үлдсэн нь түүний дараа зэрэг; удвал хүлээлгүй эхлүүлнэ; дараагийн хэсэг шууд зэрэг', async () => {
  // Хуурамч Claude: дуудлага бүр гараар шийдэгдэнэ — хэзээ хэд нь эхэлснийг хянана
  const mk = (warmupMs) => {
    const waiting = [];
    const s = setup({ warmupMs, claude: () => new Promise((res) => { waiting.push(() => res({ status: 'ok', text: reply(), model: MESSENGER_MODEL, usage: { input_tokens: 10, output_tokens: 10 } })); }) });
    return { s, call: s.call, waiting };
  };
  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await tick(5); };

  const a = mk(10_000);
  const st = await (await a.call({ action: 'eval_start' })).json();
  const p0 = a.call({ action: 'eval_chunk', runId: st.runId, from: 0 });
  await until(() => a.waiting.length >= 1);
  await tick(60);
  assert.equal(a.waiting.length, 1, 'эхний кейс ганцаар явж байна — бусад нь хүлээнэ');
  a.waiting[0]();
  await until(() => a.waiting.length >= st.chunk);
  assert.equal(a.waiting.length, st.chunk, 'эхнийх дууссаны дараа үлдсэн 5 зэрэг');
  a.waiting.slice(1).forEach((f) => f());
  const r0 = await (await p0).json();
  assert.equal(r0.ok, true);
  assert.deepEqual(r0.results.map((x) => x.id), (await import('../../api/_lib/generated/eval-cases.js')).EVAL_CASES.slice(0, st.chunk).map((c) => c.id), 'дараалал хэвээр');
  // Дараагийн хэсэг (кэш аль хэдийн дулаан) — хүлээлгүй бүгд зэрэг
  const before = a.waiting.length;
  const p1 = a.call({ action: 'eval_chunk', runId: st.runId, from: st.chunk });
  await until(() => a.waiting.length >= before + st.chunk);
  assert.equal(a.waiting.length, before + st.chunk);
  a.waiting.slice(before).forEach((f) => f());
  assert.equal((await (await p1).json()).ok, true);

  // Эхний дуудлага удвал (warmupMs) үлдсэнийг хүлээлгүй эхлүүлнэ — функцийн хугацаанд багтана
  const b = mk(40);
  const sb = await (await b.call({ action: 'eval_start' })).json();
  const pb = b.call({ action: 'eval_chunk', runId: sb.runId, from: 0 });
  await until(() => b.waiting.length >= sb.chunk);
  assert.equal(b.waiting.length, sb.chunk, 'эхнийх дуусаагүй ч үлдсэн нь эхэлсэн');
  b.waiting.forEach((f) => f());
  assert.equal((await (await pb).json()).results.length, sb.chunk);
});

test('аудит: cron messenger_status-аас зөвхөн eval-ийн баримтыг устгана (main, evals — expireAt-тэй байсан ч хэвээр)', async () => {
  const s = setup();
  const old = new Date(NOW - 86_400_000);
  s.fake.seed('messenger_status/main', { expireAt: old }, encodeFields);
  s.fake.seed('messenger_status/evals', { runs: [], expireAt: old }, encodeFields);
  s.fake.seed('messenger_status/eval_evabcdefgh1', { status: 'running', expireAt: old }, encodeFields);
  s.fake.seed('messenger_status/evalc_evabcdefgh1_0000', { status: 'pending', expireAt: old }, encodeFields);
  await s.store.purgeExpired('messenger_status', 200);
  assert.deepEqual(s.fake.list('messenger_status/').sort(), ['messenger_status/evals', 'messenger_status/main']);
});

test('admin API ubPrices: нууц түлхүүрээр UB Beauty-ийн үнэ (нуусан ч) — runtime шаардахгүй; түлхүүргүй бол 503 ub_no_key', async () => {
  const sk = 'sk_live_' + 'a'.repeat(43);
  const id1 = '6f1c2a10-0000-4000-8000-000000000001', id2 = '6f1c2a10-0000-4000-8000-000000000002';
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), key: init.headers['X-Api-Key'] });
    return new Response(JSON.stringify({ services: [
      { id: id1, name: 'A', duration_min: 30, price: 50000, price_max: null, price_hidden: false },
      { id: id2, name: 'B', duration_min: 60, price: 80000, price_max: 120000, price_hidden: true },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const mk = (env) => createAdminHandler({ getRuntime: () => null, env, fetchImpl, verifyIdToken: async () => ({ email: 'hello@skinaid.mn' }), log: () => {} });
  const req = () => new Request('https://www.skinaid.mn/api/admin', { method: 'POST', headers: { Origin: ADMIN_ORIGIN, 'Content-Type': 'application/json', Authorization: 'Bearer good' }, body: JSON.stringify({ action: 'ubPrices' }) });
  const none = await mk({})(req());
  assert.equal(none.status, 503);
  assert.equal((await none.json()).error, 'ub_no_key');
  const res = await mk({ UBBEAUTY_SECRET_KEY: sk })(req());
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(j.services, [
    { id: id1, price: 50000, priceMax: null, priceHidden: false },
    { id: id2, price: 80000, priceMax: 120000, priceHidden: true },
  ]);
  assert.equal(seen[0].key, sk, 'нууц түлхүүрээр (сервер) дуудна');
});

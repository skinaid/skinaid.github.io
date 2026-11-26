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

function setup({ settings = { mode: 'shadow', killSwitch: false, monthlyRunCap: 3000, monthlyCostCapUsd: 50 }, claude, env = ENV, verifyIdToken } = {}) {
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
    getRuntime: () => rt, env, now: clock, log: (m) => logs.push(m),
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
  assert.match(src, /COL\.usage\]/);
  assert.match(src, /purgeDraftExamples/);
});

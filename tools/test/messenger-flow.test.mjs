// Messenger AI — бүтэн урсгал (webhook → Firestore REST → pipeline → агент → ноорог), cron, Claude-ийн хүсэлтийн хэлбэр.
// Firestore = санах ойн хуурамч REST сервер (_fake-firestore.mjs), Claude = хуурамч дуудлага. Сүлжээгүй, npm install-гүй.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createFakeFirestore } from './_fake-firestore.mjs';
import { createFirestore, decodeFields, encodeFields, encodeValue, FirestoreError, setWrite, transforms } from '../../api/_lib/firestore.js';
import { createStore, eventDocId, RETRY_AFTER_MS, ubMonth } from '../../api/_lib/store.js';
import { createKnowledge, knowledgeInput } from '../../api/_lib/knowledge.js';
import { createAgent } from '../../api/_lib/agent.js';
import { createPipeline } from '../../api/_lib/pipeline.js';
import { createWebhookHandlers } from '../../api/_lib/webhook.js';
import { createCronHandler } from '../../api/_lib/cron.js';
import { buildParams, costMicroUsd, createClaudeCaller, MESSENGER_MODEL } from '../../api/_lib/claude.js';
import { buildSocialRequest } from '../../api/_lib/social/prompt.js';
import { buildSocialCatalog } from '../../api/_lib/social/catalog-safe.js';
import { SOCIAL_OUTPUT_SCHEMA } from '../../api/_lib/social/prompt.js';
import { MEDIA_REPLY } from '../../api/_lib/social/disclosure.js';
import { createGcpAuth } from '../../api/_lib/gcp-auth.js';
import { describeError, safeErrorReason, scrub } from '../../api/_lib/errors.js';

const PAGE = '104729382716453';
const PSID = '6789012345678901';
const APP = '1122334455667788';
const SECRET = 'test-app-secret-not-real-0001';
const ENV = {
  META_APP_SECRET: SECRET,
  META_VERIFY_TOKEN: 'verify-token-test-0001',
  META_APP_ID: APP,
  META_PAGE_ID: PAGE,
  PSID_SALT: 'psid-salt-for-tests-only-0123456789abcdef',
  ANTHROPIC_API_KEY: 'sk-ant-test-not-real',
  CRON_SECRET: 'cron-secret-test-0123456789',
};
const T0 = Date.parse('2026-11-25T03:00:00Z');

const SITE = { hours: 'Өдөр бүр 09:00-19:00', phone: '7600-0505', promoEnabled: true, bookingEnabled: true };
const CATALOG = {
  services: [
    { id: 'exam-1', c: 'exam', n: 'Арьсны үзлэг, оношлогоо', d: 'Цогц оношлогоо', t: '1 цаг', p: '₮50,000' },
    { id: 'anti-1', c: 'anti', n: 'Ботокс (1 тун)', d: 'Үрчлээ', p: '' },
    { id: 'secret-1', c: 'laser', n: 'Нуусан лазер', p: '₮999,000', hidden: true },
  ],
  packages: [{ id: 'p1', name: 'Glow Start', price: '462,000₮' }],
};

const proposal = (over = {}) => JSON.stringify({
  intent: 'greeting', confidence: 0.92, needs_human: false, reply: 'Сайн байна уу! Танд юугаар туслах вэ?',
  source_ids: [], quick_replies: ['Цаг захиалах'], reason: 'Мэндчилгээ', ...over,
});

/** Бүх давхаргыг хуурамч Firestore + Claude-оор холбоно */
function setup({ settings = { mode: 'shadow', killSwitch: false, monthlyRunCap: 3000, monthlyCostCapUsd: 50 }, claude, env = ENV } = {}) {
  const fake = createFakeFirestore();
  let now = T0;
  const clock = () => new Date(now);
  const fs = createFirestore({ projectId: 'skinaid-mn', getAccessToken: async () => 'test-access-token', fetchImpl: fake.fetchImpl });
  const store = createStore(fs, { now: clock });
  if (settings) fake.seed('messenger_settings/main', settings, encodeFields);
  fake.seed('settings/site', SITE, encodeFields);
  fake.seed('settings/catalog', CATALOG, encodeFields);
  const claudeCalls = [];
  const callClaude = async (req) => {
    claudeCalls.push(req);
    return claude ? claude(req) : { status: 'ok', text: proposal(), model: MESSENGER_MODEL, usage: { input_tokens: 120, output_tokens: 60, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } };
  };
  const logs = [];
  const log = (m) => logs.push(m);
  const knowledge = createKnowledge(store, { now: () => now });
  const agent = createAgent({ store, knowledge, callClaude, env, now: clock, log });
  const sleeps = [];
  const pipeline = createPipeline({ store, agent, ownAppId: APP, now: clock, log, sleep: async (ms) => { sleeps.push(ms); } });
  const rt = { store, pipeline };
  const pending = [];
  const webhook = createWebhookHandlers({ env, getRuntime: () => rt, now: clock, log });
  const post = async (bodyObj, { sig } = {}) => {
    const raw = JSON.stringify(bodyObj);
    const signature = sig ?? `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
    const res = await webhook.POST(new Request('https://www.skinaid.mn/api/messenger', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': signature, 'content-type': 'application/json' } }), (p) => pending.push(p));
    await Promise.all(pending.splice(0));
    return res;
  };
  return { fake, store, pipeline, webhook, post, claudeCalls, logs, sleeps, agent, advance: (ms) => { now += ms; }, clock, rt };
}

const msg = (mid, text, ts = T0 - 5000, psid = PSID) => ({ sender: { id: psid }, recipient: { id: PAGE }, timestamp: ts, message: { mid, text } });
const img = (mid, ts = T0 - 4000) => ({ sender: { id: PSID }, recipient: { id: PAGE }, timestamp: ts, message: { mid, attachments: [{ type: 'image', payload: { url: 'https://scontent.xx.fbcdn.net/secret.jpg' } }] } });
const echo = (mid, text, ts) => ({ sender: { id: PAGE }, recipient: { id: PSID }, timestamp: ts, message: { mid, is_echo: true, app_id: 263902037430900, text } });
const body = (messaging, pageId = PAGE) => ({ object: 'page', entry: [{ id: pageId, time: T0, messaging }] });
const allDocsJson = (fake) => JSON.stringify(fake.list('').map((p) => fake.read(p)));

// ── Firestore REST клиент ─────────────────────────────────────────────────

test('Firestore: утгын encode/decode (бүхэл/бутархай, огноо, массив, map, null; undefined алгасна)', () => {
  const d = new Date('2026-11-25T01:02:03.004Z');
  const enc = encodeFields({ a: 1, b: 1.5, c: 'x', d, e: [1, 'y', null], f: { g: true }, h: null, u: undefined });
  assert.deepEqual(enc.a, { integerValue: '1' });
  assert.deepEqual(enc.b, { doubleValue: 1.5 });
  assert.deepEqual(enc.d, { timestampValue: d.toISOString() });
  assert.ok(!('u' in enc));
  const dec = decodeFields(enc);
  assert.equal(dec.d.getTime(), d.getTime());
  assert.deepEqual({ ...dec, d: null }, { a: 1, b: 1.5, c: 'x', d: null, e: [1, 'y', null], f: { g: true }, h: null });
  assert.deepEqual(encodeValue(Number.NaN), { nullValue: null });
  assert.throws(() => setWrite('a/b/c', {}), /буруу баримтын зам/);
  assert.throws(() => setWrite('a/__x__', {}), /буруу/);
});

test('Firestore: exists=false давхардлыг ALREADY_EXISTS-ээр; updateTime lock; increment/appendMissing; token толгойд', async () => {
  const { fake, store } = setup();
  const fs = store.fs;
  await fs.commit([setWrite('t/a', { n: 1 }, { exists: false })]);
  await assert.rejects(fs.commit([setWrite('t/a', { n: 2 }, { exists: false })]), (e) => e instanceof FirestoreError && e.isPrecondition);
  const a = await fs.get('t/a');
  await fs.commit([setWrite('t/a', { n: 3 }, { mask: ['n'], updateTime: a.updateTime })]);
  await assert.rejects(fs.commit([setWrite('t/a', { n: 4 }, { mask: ['n'], updateTime: a.updateTime })]), (e) => e.isPrecondition);
  await fs.commit([setWrite('t/a', {}, { mask: [], transforms: [transforms.increment('n', 2), transforms.appendMissing('xs', ['p', 'p'])] })]);
  assert.deepEqual(fake.read('t/a'), { n: 5, xs: ['p'] });
  assert.equal(await fs.get('t/missing'), null);
  assert.ok(fake.calls.every((c) => c.auth === 'Bearer test-access-token'));
  const q = await fs.query({ collection: 't', where: [['n', '==', 5]] });
  assert.deepEqual(q.map((d) => d.id), ['a']);
});

// ── Webhook ───────────────────────────────────────────────────────────────

test('webhook: GET verify — зөв token = challenge, буруу = 403', async () => {
  const { webhook } = setup();
  const ok = await webhook.GET(new Request(`https://www.skinaid.mn/api/messenger?hub.mode=subscribe&hub.verify_token=${ENV.META_VERIFY_TOKEN}&hub.challenge=12345`));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '12345');
  const bad = await webhook.GET(new Request('https://www.skinaid.mn/api/messenger?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1'));
  assert.equal(bad.status, 403);
});

test('webhook: нууцгүй = 503, буруу гарын үсэг = 401, буруу JSON = 400, өөр пэйж = юу ч хадгалахгүй', async () => {
  const noSecret = setup({ env: { ...ENV, META_APP_SECRET: '' } });
  assert.equal((await noSecret.post(body([msg('m1', 'Сайн уу')]))).status, 503);
  const s = setup();
  assert.equal((await s.post(body([msg('m1', 'Сайн уу')]), { sig: 'sha256=' + '0'.repeat(64) })).status, 401);
  const raw = '{буруу';
  const r = await s.webhook.POST(new Request('https://x/api/messenger', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}` } }), () => {});
  assert.equal(r.status, 400);
  assert.equal((await s.post(body([msg('m2', 'Сайн уу')], '999999999999'))).status, 200);
  assert.deepEqual(s.fake.list('messenger_events/'), []);
});

test('webhook: горим off / баримт байхгүй / kill switch → event хадгалахгүй, AI ажиллахгүй', async () => {
  for (const settings of [null, { mode: 'off' }, { mode: 'shadow', killSwitch: true }]) {
    const s = setup({ settings });
    assert.equal((await s.post(body([msg('m1', 'Сайн уу')]))).status, 200);
    assert.deepEqual(s.fake.list('messenger_events/'), [], JSON.stringify(settings));
    assert.equal(s.claudeCalls.length, 0);
  }
});

test('webhook: серверийн эрх тохируулаагүй (runtime null) → 200, лог, юу ч хадгалахгүй', async () => {
  const logs = [];
  const w = createWebhookHandlers({ env: ENV, getRuntime: () => null, log: (m) => logs.push(m) });
  const raw = JSON.stringify(body([msg('m1', 'Сайн уу')]));
  const res = await w.POST(new Request('https://x/api/messenger', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}` } }), () => assert.fail('waitUntil дуудах ёсгүй'));
  assert.equal(res.status, 200);
  assert.ok(logs.some((l) => /GCP/.test(l)));
});

test('урсгал: текст → event → нууцалсан мессеж → Claude (мэдлэгтэй) → ноорог (auto_candidate, ИЛГЭЭХГҮЙ) + ai_runs + таг', async () => {
  const s = setup();
  const res = await s.post(body([msg('m_hello', 'Сайн байна уу, миний утас 99112233')]));
  assert.equal(res.status, 200);
  const evId = eventDocId(PAGE, 'm_hello');
  assert.equal(s.fake.read(`messenger_events/${evId}`).status, 'done');
  assert.equal(s.claudeCalls.length, 1);
  // LLM-д: нууцалсан текст, сайтын каталог; нуусан үйлчилгээ, утас ОРОХГҮЙ
  const req = s.claudeCalls[0];
  assert.match(req.user, /\[утас\]/);
  assert.ok(!req.user.includes('99112233'));
  assert.ok(req.system[1].text.includes('service:exam-1') && req.system[1].text.includes('₮50,000'));
  assert.ok(!req.system[1].text.includes('Нуусан лазер') && !req.system[1].text.includes('999'));
  assert.ok(!req.system[1].text.includes('7600-0505'), 'эмнэлгийн утас LLM-д өгөхгүй');
  const drafts = s.fake.list('messenger_drafts/');
  assert.equal(drafts.length, 1);
  const d = s.fake.read(drafts[0]);
  assert.equal(d.route, 'auto_candidate');
  assert.equal(d.rating, null);
  assert.deepEqual(d.labels, { route: 'Автомат боломжтой', intent: 'Мэндчилгээ', reasons: [] }, 'admin-д харуулах шошго');
  assert.match(d.wouldSend, /AI туслах/, 'анхны хариунд тодруулга');
  assert.match(d.userText, /\[утас\]/);
  assert.ok(!d.userText.includes('99112233'));
  const runs = s.fake.list('ai_runs/').map((p) => s.fake.read(p));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'ok');
  assert.equal(runs[0].cacheReadTokens, 900);
  assert.ok(!JSON.stringify(runs[0]).includes('утас'), 'ai_runs-д текст алга');
  const usage = s.fake.read(`messenger_usage/${ubMonth(s.clock())}`);
  assert.equal(usage.runs, 1);
  assert.equal(usage.costMicroUsd, costMicroUsd(MESSENGER_MODEL, { input_tokens: 120, output_tokens: 60, cache_read_input_tokens: 900 }));
  // PSID хаана ч хадгалагдаагүй
  assert.ok(!allDocsJson(s.fake).includes(PSID));
  // Түгжээ тайлагдсан, сүүдрийн ботын цаг тэмдэглэгдсэн
  const th = s.fake.read(s.fake.list('messenger_threads/').find((p) => !p.includes('/messages/')));
  assert.equal(th.lockUntil, null);
  assert.ok(th.lastShadowBotAt instanceof Date);
});

test('урсгал: Meta-ийн давтан илгээлт (ижил mid) → нэг event, нэг ноорог', async () => {
  const s = setup();
  await s.post(body([msg('m_dup', 'Сайн байна уу')]));
  s.advance(1000);
  await s.post(body([msg('m_dup', 'Сайн байна уу')]));
  assert.equal(s.fake.list('messenger_events/').length, 1);
  assert.equal(s.fake.list('messenger_drafts/').length, 1);
  assert.equal(s.claudeCalls.length, 1);
});

test('урсгал: зөвхөн зураг → LLM-гүй загвар ноорог (handoff, media), CDN URL хадгалахгүй', async () => {
  const s = setup();
  await s.post(body([img('m_img')]));
  assert.equal(s.claudeCalls.length, 0);
  const d = s.fake.read(s.fake.list('messenger_drafts/')[0]);
  assert.equal(d.route, 'handoff');
  assert.equal(d.intent, 'media');
  assert.equal(d.wouldSend, MEDIA_REPLY);
  assert.ok(!allDocsJson(s.fake).includes('fbcdn'));
});

test('урсгал: Meta-ийн автомат хариу (≤ 15 с) «хүн» болохгүй — ноорог бичигдэнэ; ажилтны хариу (1 мин) → ноорог үгүй', async () => {
  const a = setup();
  await a.post(body([msg('m_u1', 'Ботокс хэд вэ', T0 - 30_000), echo('m_auto', 'Бид танд тун удахгүй хариу өгөх болно.', T0 - 28_000)]));
  assert.equal(a.fake.list('messenger_drafts/').length, 1);
  const th = a.fake.read(a.fake.list('messenger_threads/').find((p) => !p.includes('/messages/')));
  assert.equal(th.state, 'bot');
  const b = setup();
  await b.post(body([msg('m_u2', 'Ботокс хэд вэ', T0 - 120_000), echo('m_staff', 'Ботокс ажилтан хэлье', T0 - 60_000)]));
  assert.equal(b.fake.list('messenger_drafts/').length, 0);
  assert.equal(b.claudeCalls.length, 0);
  const th2 = b.fake.read(b.fake.list('messenger_threads/').find((p) => !p.includes('/messages/')));
  assert.equal(th2.state, 'human');
});

test('агент: эрсдэлтэй текст (гаж нөлөө) → handoff + яаралтай утас (код залгана); зохиосон үнэ → handoff', async () => {
  const s = setup({ claude: () => ({ status: 'ok', text: proposal({ intent: 'greeting', reply: 'Зүгээр, арилна.' }), model: MESSENGER_MODEL, usage: { input_tokens: 1, output_tokens: 1 } }) });
  await s.post(body([msg('m_se', 'Тариулсны дараа нүүр минь хавдсан байна')]));
  const d = s.fake.read(s.fake.list('messenger_drafts/')[0]);
  assert.equal(d.route, 'handoff');
  assert.equal(d.intent, 'side_effect');
  assert.match(d.templateReply, /7600-0505/);
  const p = setup({ claude: () => ({ status: 'ok', text: proposal({ intent: 'price', source_ids: ['service:exam-1'], reply: 'Үзлэг ₮35,000.' }), model: MESSENGER_MODEL, usage: {} }) });
  await p.post(body([msg('m_pr', 'Үзлэг хэд вэ')]));
  const pd = p.fake.read(p.fake.list('messenger_drafts/')[0]);
  assert.equal(pd.route, 'handoff');
  assert.ok(pd.reasons.includes('invented_price'));
});

test('агент: үнийн асуултад захиалгын холбоосыг КОД нэмнэ (utm_source=messenger)', async () => {
  const s = setup({ claude: () => ({ status: 'ok', text: proposal({ intent: 'price', source_ids: ['service:exam-1'], reply: 'Арьсны үзлэгийн үнэ ₮50,000.' }), model: MESSENGER_MODEL, usage: {} }) });
  await s.post(body([msg('m_link', 'Үзлэг хэд вэ')]));
  const d = s.fake.read(s.fake.list('messenger_drafts/')[0]);
  assert.equal(d.route, 'auto_candidate');
  assert.equal(d.link, 'https://www.skinaid.mn/?utm_source=messenger#contact');
  assert.ok(d.wouldSend.includes(d.link));
});

test('агент: сарын таг хүрсэн → Claude дуудахгүй, handoff (cap_reached); refusal → handoff; алдаа → ноорог үгүй, статус', async () => {
  const cap = setup({ settings: { mode: 'shadow', killSwitch: false, monthlyRunCap: 0, monthlyCostCapUsd: 50 } });
  await cap.post(body([msg('m_cap', 'Сайн уу')]));
  assert.equal(cap.claudeCalls.length, 0);
  const cd = cap.fake.read(cap.fake.list('messenger_drafts/')[0]);
  assert.deepEqual([cd.route, cd.reasons], ['handoff', ['cap_reached']]);

  const ref = setup({ claude: () => ({ status: 'refusal', category: 'bio', model: MESSENGER_MODEL, usage: { input_tokens: 5, output_tokens: 0 } }) });
  await ref.post(body([msg('m_ref', 'Сайн уу')]));
  const rd = ref.fake.read(ref.fake.list('messenger_drafts/')[0]);
  assert.deepEqual([rd.route, rd.reasons], ['handoff', ['refusal']]);
  assert.equal(ref.fake.read(ref.fake.list('ai_runs/')[0]).refusalCategory, 'bio');

  const err = setup({ claude: () => ({ status: 'error', code: 'api_529', model: MESSENGER_MODEL, usage: null }) });
  await err.post(body([msg('m_err', 'Сайн уу')]));
  assert.equal(err.fake.list('messenger_drafts/').length, 0);
  assert.equal(err.fake.read(err.fake.list('ai_runs/')[0]).errorCode, 'api_529');
  assert.equal(err.fake.read('messenger_status/main').lastError.code, 'api_529');

  const bad = setup({ claude: () => ({ status: 'ok', text: '{буруу', model: MESSENGER_MODEL, usage: {} }) });
  await bad.post(body([msg('m_bad', 'Сайн уу')]));
  assert.deepEqual(bad.fake.read(bad.fake.list('messenger_drafts/')[0]).reasons, ['invalid_output']);
});

test('агент: ANTHROPIC_API_KEY байхгүй → Claude дуудахгүй, ноорог үгүй, ai_runs not_configured', async () => {
  const s = setup({ env: { ...ENV, ANTHROPIC_API_KEY: '' } });
  await s.post(body([msg('m_nokey', 'Сайн уу')]));
  assert.equal(s.claudeCalls.length, 0);
  assert.equal(s.fake.list('messenger_drafts/').length, 0);
  assert.equal(s.fake.read(s.fake.list('ai_runs/')[0]).status, 'not_configured');
});

test('pipeline: ярианы түгжээ давхцахгүй; түгжээтэй үед event pending үлдэж, 2 минутын дараа гацсан event нөхөгдөнө', async () => {
  const s = setup();
  const h = (await import('../../api/_lib/social/meta-events.js')).psidHash(PAGE, PSID, ENV.PSID_SALT);
  const lock = await s.store.lockThread(h);
  assert.equal(lock.ok, true);
  assert.equal((await s.store.lockThread(h)).ok, false, 'хоёр дахь түгжээ татгалзана');
  await s.post(body([msg('m_locked', 'Сайн уу')]));
  const evPath = `messenger_events/${eventDocId(PAGE, 'm_locked')}`;
  assert.equal(s.fake.read(evPath).status, 'pending');
  assert.equal(s.fake.list('messenger_drafts/').length, 0);
  // Түгжээ хугацаа нь дуусч (120 с), retryAt (2 мин) өнгөрсний дараа дараагийн webhook/cron нөхнө
  s.advance(RETRY_AFTER_MS + 1000);
  assert.equal(await s.pipeline.sweepStale({ maxThreads: 5 }), 1);
  assert.equal(s.fake.read(evPath).status, 'done');
  assert.equal(s.fake.read(evPath).retryAt, null);
  assert.equal(s.fake.list('messenger_drafts/').length, 1);
});

test('pipeline: Firestore алдаа → event дахин оролдлого (attempts), 3 удаа бүтэлгүйтвэл failed; түгжээ тайлагдана', async () => {
  const s = setup();
  // pendingEvents-ийн query-г 3 удаа унагана
  for (let i = 0; i < 3; i++) s.fake.failNext.push({ match: (u, init) => u.endsWith(':runQuery') && JSON.parse(init.body).structuredQuery.where?.compositeFilter, status: 503, body: { error: { code: 503, status: 'UNAVAILABLE' } } });
  await s.post(body([msg('m_fail', 'Сайн уу')]));
  const evPath = `messenger_events/${eventDocId(PAGE, 'm_fail')}`;
  // Query унасан тул event-ийг уншаагүй — pending, retryAt хэвээр (attempts тоологдоогүй)
  assert.equal(s.fake.read(evPath).status, 'pending');
  const th = s.fake.read(s.fake.list('messenger_threads/')[0]);
  assert.equal(th.lockUntil, null, 'алдааны дараа түгжээ тайлагдсан');
  assert.equal(s.fake.read('messenger_status/main').lastError.code, 'firestore_UNAVAILABLE');
});

// ── Cron ──────────────────────────────────────────────────────────────────

test('cron: CRON_SECRET-гүй = 401; зөв = гацсан event, хадгалах хугацаа дууссаныг устгана, статус (boolean л)', async () => {
  const s = setup();
  const cron = createCronHandler({ env: ENV, getRuntime: () => s.rt, now: s.clock });
  assert.equal((await cron(new Request('https://x/api/cron/daily'))).status, 401);
  assert.equal((await cron(new Request('https://x/api/cron/daily', { headers: { authorization: 'Bearer wrong-secret' } }))).status, 401);
  s.fake.seed('messenger_events/e_old', { status: 'done', retryAt: null, expireAt: new Date(T0 - 1000) }, encodeFields);
  s.fake.seed('messenger_drafts/d_old', { route: 'draft', expireAt: new Date(T0 - 1000) }, encodeFields);
  s.fake.seed('messenger_drafts/d_new', { route: 'draft', expireAt: new Date(T0 + 86_400_000) }, encodeFields);
  const res = await cron(new Request('https://x/api/cron/daily', { headers: { authorization: `Bearer ${ENV.CRON_SECRET}` } }));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.purged.messenger_events, 1);
  assert.equal(j.purged.messenger_drafts, 1);
  assert.equal(s.fake.read('messenger_drafts/d_new').route, 'draft');
  const st = s.fake.read('messenger_status/main');
  assert.ok(st.lastCronAt instanceof Date);
  assert.equal(st.config.anthropicKey, true);
  assert.ok(!JSON.stringify(st).includes(ENV.ANTHROPIC_API_KEY) && !JSON.stringify(st).includes(SECRET), 'нууцын утга статуст алга');
  const noRt = createCronHandler({ env: ENV, getRuntime: () => null });
  assert.equal((await noRt(new Request('https://x', { headers: { authorization: `Bearer ${ENV.CRON_SECRET}` } }))).status, 503);
});

test('лог: token авч чадаагүй шалтгаан лог-д (token хасагдсан), Firestore-д зөвхөн код; cron алдааг логлоно', async () => {
  // google-auth-library (gaxios)-ийн STS алдааны хэлбэр
  const stsErr = Object.assign(new Error('Error code invalid_grant: The audience in ID Token [https://vercel.com/x] does not match the expected audience. eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln'), {
    name: 'GaxiosError', response: { status: 400 }, config: { url: 'https://sts.googleapis.com/v1/token' },
  });
  assert.match(safeErrorReason(stsErr), /^sts_400: Error code invalid_grant: The audience in ID Token/);
  assert.ok(!safeErrorReason(stsErr).includes('eyJ'), 'JWT хасагдсан');
  const iamErr = Object.assign(new Error("Permission 'iam.serviceAccounts.getAccessToken' denied on resource"), {
    name: 'GaxiosError', response: { status: 403 }, config: { url: new URL('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/x:generateAccessToken') },
  });
  assert.match(safeErrorReason(iamErr), /^iam_403: Permission 'iam\.serviceAccounts\.getAccessToken' denied/);
  assert.match(safeErrorReason(Object.assign(new Error("Cannot find package 'google-auth-library'"), { code: 'ERR_MODULE_NOT_FOUND' })), /^Error_ERR_MODULE_NOT_FOUND: Cannot find package 'google-auth-library'/);
  assert.equal(safeErrorReason(Object.assign(new Error('x'), { name: 'AuthNotConfiguredError' })), 'not_configured');
  assert.equal(scrub(`ya29.a0AfH6SM sk-ant-api03-abc 1234567890123456 ${'a'.repeat(40)}`), '<token> <key> <id> <hex>');

  // Firestore AUTH: мессеж тогтмол (Firestore-д хадгалагдаж болзошгүй), шалтгаан reason-д
  const fs = createFirestore({ projectId: 'skinaid-mn', getAccessToken: async () => { throw stsErr; }, fetchImpl: async () => { throw new Error('unreachable'); } });
  const err = await fs.get('a/b').catch((e) => e);
  assert.ok(err instanceof FirestoreError);
  assert.equal(err.message, 'FIRESTORE_AUTH: token failed');
  assert.match(describeError(err), /^firestore_AUTH: sts_400: Error code invalid_grant/);

  // cron: алдааг логлоно (нууцгүй), статуст зөвхөн код
  const s = setup();
  const logs = [];
  const broken = { store: s.rt.store, pipeline: { sweepStale: async () => { throw err; } } };
  const cron = createCronHandler({ env: ENV, getRuntime: () => broken, now: s.clock, log: (m) => logs.push(m) });
  const res = await cron(new Request('https://x/api/cron/daily', { headers: { authorization: `Bearer ${ENV.CRON_SECRET}` } }));
  assert.equal(res.status, 500);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[messenger\] cron алдаа: firestore_AUTH: sts_400: Error code invalid_grant/);
  assert.ok(!logs[0].includes(ENV.CRON_SECRET));
  assert.equal(s.fake.read('messenger_status/main').lastError.code, 'cron_AUTH');
});

test('cron: ярианы 180 хоногоос хуучин мессеж устгагдана, oldestExpireAt шинэчлэгдэнэ', async () => {
  const s = setup();
  await s.post(body([msg('m_old', 'Сайн уу')]));
  const thPath = s.fake.list('messenger_threads/').find((p) => !p.includes('/messages/'));
  assert.equal(s.fake.list(`${thPath}/messages/`).length, 1);
  s.advance(181 * 86_400_000);
  const n = await s.store.purgeThreadMessages(10);
  assert.deepEqual(n, { deleted: 1, threads: 1 });
  assert.equal(s.fake.list(`${thPath}/messages/`).length, 0);
  assert.equal(s.fake.read(thPath).oldestExpireAt, null);
});

// ── Claude-ийн хүсэлт ─────────────────────────────────────────────────────

test('Claude: claude-opus-5-5, effort low, json_schema гаралт, fallbacks "default", system 2 блок кэштэй', async () => {
  const catalog = buildSocialCatalog(knowledgeInput(SITE, CATALOG));
  const req = buildSocialRequest({ catalog, turns: [{ role: 'user', text: 'Сайн уу' }] });
  const p = buildParams(req);
  assert.equal(p.model, 'claude-opus-5-5');
  assert.deepEqual(p.output_config, { effort: 'low', format: { type: 'json_schema', schema: SOCIAL_OUTPUT_SCHEMA } });
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.ok(p.system.every((b) => b.cache_control?.type === 'ephemeral'));
  assert.deepEqual(p.messages, [{ role: 'user', content: req.user }]);
  assert.ok(!('thinking' in p) && !('temperature' in p));
  // Хуурамч клиент: refusal, max_tokens, алдаа
  const clogs = [];
  const mk = (res) => createClaudeCaller({ client: { beta: { messages: { create: async () => { if (res instanceof Error) throw res; return res; } } } }, log: (m) => clogs.push(m) });
  assert.equal((await mk({ stop_reason: 'end_turn', model: 'claude-opus-5-5', usage: {}, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":1}' }] })(req)).text, '{"a":1}');
  assert.deepEqual(await mk({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, model: 'claude-opus-4-8', usage: {} })(req), { status: 'refusal', category: 'cyber', model: 'claude-opus-4-8', usage: {} });
  assert.equal((await mk({ stop_reason: 'max_tokens', model: 'm', usage: {}, content: [] })(req)).code, 'max_tokens');
  const e = Object.assign(new Error('secret prompt text'), { status: 529 });
  assert.deepEqual(await mk(e)(req), { status: 'error', code: 'api_529', model: 'claude-opus-5-5', usage: null });
  assert.equal(clogs.at(-1), '[messenger] Claude алдаа api_529: no_detail', 'e.message (хүсэлтийн текст байж болзошгүй) логт орохгүй');
  // SDK-ийн APIError хэлбэр: 400 — шалтгаан лог-д, кирилл (үйлчлүүлэгчийн текст) ба token/урт тоо хасагдана
  const bad = Object.assign(new Error('400 Сайн уу secret'), {
    status: 400,
    error: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low. Echo: Ботокс хэд вэ? 99112233445566778 sk-ant-api03-xyz' } },
  });
  const r400 = await mk(bad)(req);
  assert.equal(r400.code, 'api_400');
  assert.ok(!('detail' in r400), 'Firestore руу шалтгаан явахгүй');
  const line = clogs.at(-1);
  assert.match(line, /^\[messenger\] Claude алдаа api_400: invalid_request_error: Your credit balance is too low\. Echo: …/);
  const body = line.slice('[messenger] Claude алдаа'.length);
  assert.ok(!/[Ѐ-ӿ]/.test(body), 'кирилл текст логт алга');
  assert.ok(!body.includes('99112233445566778') && !body.includes('sk-ant-api03'), 'PSID хэлбэрийн тоо, түлхүүр хасагдсан');
  assert.ok(!body.includes('secret'), 'e.message ашиглахгүй');
});

test('Claude: зардал (микро-доллар) — Opus 5.5 үнэ, мэдэгдэхгүй модель = хамгийн өндөр үнэ', () => {
  assert.equal(costMicroUsd('claude-opus-5-5', { input_tokens: 1_000_000 }), 4_000_000);
  assert.equal(costMicroUsd('claude-opus-5-5', { output_tokens: 1000, cache_read_input_tokens: 1_000_000 }), 20_000 + 200_000);
  assert.equal(costMicroUsd('unknown', { input_tokens: 1_000_000 }), 5_000_000);
  assert.equal(costMicroUsd('claude-opus-5-5', null), 0);
});

test('GCP эрх: тохируулаагүй = mode null; WIF/key сонголт; token кэш (сангуудыг тарьж)', async () => {
  assert.equal(createGcpAuth({ env: {} }).mode, null);
  await assert.rejects(createGcpAuth({ env: {} }).getAccessToken(), /NOT_CONFIGURED/);
  let made = 0;
  let subj = 0;
  const fakeLib = {
    ExternalAccountClient: { fromJSON: (o) => { made++; assert.equal(o.token_url, 'https://sts.googleapis.com/v1/token'); assert.match(o.service_account_impersonation_url, /messenger-ai@skinaid-mn\.iam\.gserviceaccount\.com:generateAccessToken$/); assert.match(o.audience, /^\/\/iam\.googleapis\.com\/projects\/453547531151\/locations\/global\/workloadIdentityPools\/vercel\/providers\/vercel$/); o.subject_token_supplier.getSubjectToken(); return { credentials: { expiry_date: Date.now() + 3600_000 }, getAccessToken: async () => ({ token: 'ya29.test' }) }; } },
  };
  const env = { GCP_PROJECT_NUMBER: '453547531151', GCP_WORKLOAD_IDENTITY_POOL_ID: 'vercel', GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel', GCP_SERVICE_ACCOUNT_EMAIL: 'messenger-ai@skinaid-mn.iam.gserviceaccount.com' };
  const auth = createGcpAuth({ env, importer: async (n) => (n === '@vercel/oidc' ? { getVercelOidcToken: async () => { subj++; return 'oidc'; } } : fakeLib) });
  assert.equal(auth.mode, 'wif');
  assert.equal(auth.projectId, 'skinaid-mn');
  assert.equal(await auth.getAccessToken(), 'ya29.test');
  assert.equal(await auth.getAccessToken(), 'ya29.test');
  assert.equal(made, 1, 'клиент нэг удаа');
  assert.equal(subj, 1);
  assert.equal(createGcpAuth({ env: { FIREBASE_SERVICE_ACCOUNT: '{"client_email":"a"}' } }).mode, 'key');
  await assert.rejects(createGcpAuth({ env: { FIREBASE_SERVICE_ACCOUNT: '{буруу' } }).getAccessToken(), /KEY_JSON_INVALID/);
});

// ── Аудит 2026-11-25: найдвартай байдал ───────────────────────────────────

const fsErr = (status, st) => ({ status, body: { error: { code: status, status: st } } });
const isCommitOf = (col) => (u, init) => u.endsWith(':commit') && JSON.parse(init.body).writes.some((w) => w.update?.name?.includes(`/${col}/`));

test('webhook: удаан үргэлжлэх алдаа (Spark квот, IAM) → 200 + статус; түр зуурын (503) → 503 (Meta дахин илгээнэ)', async () => {
  const q = setup();
  q.fake.failNext.push({ match: isCommitOf('messenger_events'), ...fsErr(429, 'RESOURCE_EXHAUSTED') });
  assert.equal((await q.post(body([msg('m_quota', 'Сайн уу')]))).status, 200);
  assert.equal(q.fake.read('messenger_status/main').lastError.code, 'firestore_RESOURCE_EXHAUSTED');
  const p = setup();
  p.fake.failNext.push({ match: isCommitOf('messenger_events'), ...fsErr(403, 'PERMISSION_DENIED') });
  assert.equal((await p.post(body([msg('m_perm', 'Сайн уу')]))).status, 200);
  const t = setup();
  t.fake.failNext.push({ match: isCommitOf('messenger_events'), ...fsErr(503, 'UNAVAILABLE') });
  assert.equal((await t.post(body([msg('m_unav', 'Сайн уу')]))).status, 503);
  // Token авах алдаа (WIF буруу) → AUTH, түр зуурын биш
  const fs = createFirestore({ projectId: 'skinaid-mn', getAccessToken: async () => { throw new Error('secret-ish detail'); }, fetchImpl: t.fake.fetchImpl });
  await assert.rejects(fs.get('a/b'), (e) => e instanceof FirestoreError && e.status === 'AUTH' && !e.isTransient && !e.message.includes('secret'));
});

test('webhook: хэсэгчилсэн 503-ийн дараах давтан илгээлт — өмнө үүссэн (давхардсан) event-тэй яриа ч боловсрогдоно', async () => {
  const s = setup();
  // A үүснэ, B-г бичихэд 503 → Meta бүгдийг дахин илгээнэ
  let n = 0;
  s.fake.failNext.push({ match: (u, init) => isCommitOf('messenger_events')(u, init) && ++n === 2, ...fsErr(503, 'UNAVAILABLE') });
  assert.equal((await s.post(body([msg('m_A', 'Сайн уу', T0 - 9000), msg('m_B', 'Үзлэг хэд вэ', T0 - 8000)]))).status, 503);
  assert.equal(s.fake.read(`messenger_events/${eventDocId(PAGE, 'm_A')}`).status, 'pending');
  assert.equal((await s.post(body([msg('m_A', 'Сайн уу', T0 - 9000), msg('m_B', 'Үзлэг хэд вэ', T0 - 8000)]))).status, 200);
  assert.equal(s.fake.read(`messenger_events/${eventDocId(PAGE, 'm_A')}`).status, 'done', 'давхардсан A ч дуусна');
  assert.equal(s.fake.read(`messenger_events/${eventDocId(PAGE, 'm_B')}`).status, 'done');
  assert.equal(s.fake.list('messenger_drafts/').length, 1, 'хоёр мессежид нэг ноорог');
});

test('pipeline: түр зуурын Claude алдаа (529) → event pending (attempts), ноорог үгүй; дараа нь амжилттай → нэг ноорог', async () => {
  let fail = true;
  const s = setup({ claude: () => (fail ? { status: 'error', code: 'api_529', model: MESSENGER_MODEL, usage: null } : { status: 'ok', text: proposal(), model: MESSENGER_MODEL, usage: { input_tokens: 1, output_tokens: 1 } }) });
  await s.post(body([msg('m_529', 'Сайн уу')]));
  const ev = `messenger_events/${eventDocId(PAGE, 'm_529')}`;
  assert.equal(s.fake.read(ev).status, 'pending');
  assert.equal(s.fake.read(ev).attempts, 1);
  assert.equal(s.fake.list('messenger_drafts/').length, 0);
  fail = false;
  s.advance(RETRY_AFTER_MS + 1000);
  await s.pipeline.sweepStale({ maxThreads: 5 });
  assert.equal(s.fake.read(ev).status, 'done');
  assert.equal(s.fake.list('messenger_drafts/').length, 1);
  // Түр зуурын биш (400) → event дуусна, ноорог үгүй (дахин оролдохгүй)
  const b = setup({ claude: () => ({ status: 'error', code: 'api_400', model: MESSENGER_MODEL, usage: null }) });
  await b.post(body([msg('m_400', 'Сайн уу')]));
  assert.equal(b.fake.read(`messenger_events/${eventDocId(PAGE, 'm_400')}`).status, 'done');
});

test('pipeline: хугацаа хүрэлцэхгүй бол Claude дуудахгүй, event pending (мессеж бичигдсэн); дахин боловсруулахад давхардахгүй', async () => {
  const s = setup();
  const h = (await import('../../api/_lib/social/meta-events.js')).psidHash(PAGE, PSID, ENV.PSID_SALT);
  await s.store.createEvent((await import('../../api/_lib/social/meta-events.js')).parseWebhook(body([msg('m_dl', 'Сайн уу')])).events[0], h);
  const r = await s.pipeline.processThread(h, { deadline: Date.now() + 10_000 });   // < 30 с үлдсэн
  assert.ok(r.actions.includes('deadline'));
  assert.equal(s.claudeCalls.length, 0);
  assert.equal(s.fake.read(`messenger_events/${eventDocId(PAGE, 'm_dl')}`).status, 'pending');
  const thPath = `messenger_threads/${h}`;
  assert.equal(s.fake.read(thPath).lockUntil, null);
  await s.pipeline.processThread(h, { deadline: Date.now() + 50_000 });
  assert.equal(s.fake.list('messenger_drafts/').length, 1);
  assert.equal(s.fake.list(`${thPath}/messages/`).length, 1, 'мессеж давхардаагүй');
  // Ноорогийн id тогтмол: event-ийг дахин pending болгож боловсруулахад шинэ ноорог үүсэхгүй
  s.fake.seed(`messenger_events/${eventDocId(PAGE, 'm_dl')}`, { ...s.fake.read(`messenger_events/${eventDocId(PAGE, 'm_dl')}`), status: 'pending' }, encodeFields);
  await s.pipeline.processThread(h, { deadline: Date.now() + 50_000 });
  assert.equal(s.fake.list('messenger_drafts/').length, 1);
  assert.equal(s.fake.read(`messenger_events/${eventDocId(PAGE, 'm_dl')}`).status, 'done');
});

test('pipeline: нэг ярианд өдөрт ≤ 40 Claude дуудлага; түгжээтэй бол хүлээж (sleep) дахин оролдоно', async () => {
  const s = setup();
  const { psidHash: ph, parseWebhook: pw } = await import('../../api/_lib/social/meta-events.js');
  const h = ph(PAGE, PSID, ENV.PSID_SALT);
  s.fake.seed(`messenger_threads/${h}`, { state: 'bot', lockUntil: null, agentDay: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' }).format(s.clock()), agentDayCount: 40 }, encodeFields);
  await s.store.createEvent(pw(body([msg('m_cap40', 'Сайн уу')])).events[0], h);
  const r = await s.pipeline.processThread(h, { deadline: Date.now() + 50_000 });
  assert.ok(r.actions.includes('thread_cap'));
  assert.equal(s.claudeCalls.length, 0);
  assert.equal(s.fake.read(`messenger_events/${eventDocId(PAGE, 'm_cap40')}`).status, 'done');
  // Түгжээ: өөр инстанс барьж байвал 2 с тутам ≤ 3 удаа хүлээнэ
  await s.store.lockThread(h);
  const locked = await s.pipeline.processThread(h, { deadline: Date.now() + 50_000 });
  assert.equal(locked.locked, true);
  assert.deepEqual(s.sleeps, [2000, 2000, 2000]);
});

test('webhook: Content-Length-гүй (chunked) 1 MB-аас том body → 413, бүхэлд нь уншихгүй', async () => {
  const { readBody, MAX_BODY_BYTES } = await import('../../api/_lib/webhook.js');
  let pulled = 0;
  const big = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(256 * 1024)); } });
  assert.equal(await readBody(new Request('https://x', { method: 'POST', body: big, duplex: 'half' })), null);
  assert.ok(pulled <= Math.ceil(MAX_BODY_BYTES / (256 * 1024)) + 2, 'хязгаараас хойш уншихгүй');
  const ok = await readBody(new Request('https://x', { method: 'POST', body: 'abc' }));
  assert.equal(new TextDecoder().decode(ok), 'abc');
});

test('Claude зардал: fallback-ийн iterations (татгалзсан оролдлого ч) моделиор тус бүр үнэлэгдэнэ', () => {
  const usage = { input_tokens: 100, output_tokens: 10, iterations: [
    { type: 'message', model: 'claude-opus-5-5', input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  ] };
  assert.equal(costMicroUsd('claude-opus-5', usage), 4_000_000 + 5_000_000);
});

test('echo загвар: ашиглагдсаар байвал хугацаа нь өдөр бүр сунгагдана (90 хоногийн дараа устахгүй)', async () => {
  const s = setup();
  const fp = 'a'.repeat(32);
  s.fake.seed(`messenger_echo_templates/${fp}`, { threads: ['x', 'y', 'z'], lastSeenAt: new Date(T0 - 2 * 86_400_000), expireAt: new Date(T0 + 10 * 86_400_000) }, encodeFields);
  const set = await s.store.automationHashes('q'.repeat(64), [fp], 3);
  assert.ok(set.has(fp));
  const d = s.fake.read(`messenger_echo_templates/${fp}`);
  assert.equal(d.threads.length, 3, 'массив томрохгүй');
  assert.ok(d.expireAt.getTime() > T0 + 80 * 86_400_000);
});

test('хуурамч Firestore: composite index шаардах query-г бодит шиг татгалзана (бидний query бүгд index-гүй)', async () => {
  const s = setup();
  await assert.rejects(s.store.fs.query({ collection: 'messenger_events', where: [['psidHash', '==', 'x'], ['retryAt', '<=', new Date()]] }), (e) => e.status === 'FAILED_PRECONDITION');
  await assert.rejects(s.store.fs.query({ collection: 'messenger_events', where: [['status', '==', 'pending']], orderBy: [['receivedAt', 'asc']] }), (e) => e.status === 'FAILED_PRECONDITION');
  assert.deepEqual(await s.store.fs.query({ collection: 'messenger_events', where: [['psidHash', '==', 'x'], ['status', '==', 'pending']] }), []);
});

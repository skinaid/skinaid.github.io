// Messenger AI 2-р үе шат (PR В) — «Тойм»-ын өдрийн нэгтгэл, хямралын автомат зогсолт, echo-гийн шалтгаан.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFirestore } from './_fake-firestore.mjs';
import { createFirestore, encodeFields } from '../../api/_lib/firestore.js';
import { createStore, ubDay } from '../../api/_lib/store.js';
import { CRISIS, createCrisisGuard, evaluateCrisis, ubDayStart } from '../../api/_lib/crisis.js';
import { classifyEchoWhy, AUTOMATION_ECHO_MS, planBatch } from '../../api/_lib/social/conversation-logic.js';
import { ADMIN_ORIGIN, createAdminHandler } from '../../api/_lib/admin-api.js';

const NOW = new Date('2026-11-27T05:00:00Z');
const H = 3600_000;
const active = { active: true, monthlyCostCapUsd: 50 };

test('хямрал: «Буруу» ≥ 5 ба ≥ 50% (24 цаг, одоогийн prompt; автомат зогсолтын дараа асаасан бол түүнээс хойшхи ноорог); цөөн/бага хувь — үгүй', () => {
  const r = (rating, h) => ({ rating, ratedAt: new Date(NOW.getTime() - h * H) });
  const wrong5 = [r('wrong', 1), r('wrong', 2), r('wrong', 3), r('wrong', 4), r('wrong', 5), r('good', 1), r('good', 2)];
  const t = evaluateCrisis({ now: NOW, settings: active, ratings: wrong5 });
  assert.equal(t.trip, true);
  assert.equal(t.reason, 'wrong_ratings');
  assert.deepEqual(t.detail, { wrong: 5, rated: 7 });
  assert.equal(evaluateCrisis({ now: NOW, settings: active, ratings: wrong5.slice(1) }).trip, false, '4 «Буруу»');
  assert.equal(evaluateCrisis({ now: NOW, settings: active, ratings: [...wrong5, ...Array.from({ length: 6 }, () => r('good', 1))] }).trip, false, '< 50%');
  assert.equal(evaluateCrisis({ now: NOW, settings: active, ratings: wrong5.map((x) => ({ ...x, ratedAt: new Date(NOW.getTime() - 30 * H) })) }).trip, false, '24 цагаас хуучин');
  // Автомат зогсолтын (2 цагийн өмнө) дараа эзэмшигч 30 минутын өмнө дахин асаасан — ТҮҮНЭЭС ӨМНӨ үүссэн ноорогийн үнэлгээ
  // тоологдохгүй (хуучин ноорогийг үнэлээд дахин зогсохгүй — аудит); дараа үүссэн ноорог тоологдоно
  const resumed = { settingsMeta: { updatedAt: new Date(NOW.getTime() - H / 2), updatedBy: 'hello@skinaid.mn' }, autoStop: { reason: 'wrong_ratings', at: new Date(NOW.getTime() - 2 * H) } };
  const old = wrong5.map((x) => ({ ...x, ratedAt: new Date(NOW.getTime() - 60_000), createdAt: new Date(NOW.getTime() - 5 * H) }));
  assert.equal(evaluateCrisis({ now: NOW, settings: active, ...resumed, ratings: old }).trip, false, 'дахин асаахаас өмнөх ноорог');
  assert.equal(evaluateCrisis({ now: NOW, settings: active, ...resumed, ratings: old.map((x) => ({ ...x, createdAt: new Date(NOW.getTime() - 10 * 60_000) })) }).trip, true, 'дахин асаасны дараах ноорог');
  // Автомат зогсолтгүй ердийн хадгалалт (жишээ нь хязгаар өөрчилсөн) цонхыг шинэчлэхгүй (аудит)
  assert.equal(evaluateCrisis({ now: NOW, settings: active, settingsMeta: resumed.settingsMeta, ratings: wrong5 }).trip, true);
  // Хуучин prompt-ийн хувилбартай ноорог тоологдохгүй
  assert.equal(evaluateCrisis({ now: NOW, settings: active, promptVersion: 'v2', ratings: wrong5.map((x) => ({ ...x, promptVersion: 'v1' })) }).trip, false, 'хуучин prompt');
  assert.equal(evaluateCrisis({ now: NOW, settings: active, promptVersion: 'v2', ratings: wrong5.map((x) => ({ ...x, promptVersion: 'v2' })) }).trip, true);
  assert.equal(evaluateCrisis({ now: NOW, settings: { ...active, active: false }, ratings: wrong5 }).trip, false, 'аль хэдийн зогссон');
});

test('хямрал: Claude дараалан ≥ 5 алдаа; өнөөдрийн зардал ≥ сарын хязгаарын 20% (өнөөдөр ЭНЭ шалтгаанаар зогсоосны дараа асаасан бол үгүй)', () => {
  assert.equal(evaluateCrisis({ now: NOW, settings: active, errorStreak: CRISIS.errorStreak }).reason, 'error_streak');
  assert.equal(evaluateCrisis({ now: NOW, settings: active, errorStreak: CRISIS.errorStreak - 1 }).trip, false);
  const dayStart = ubDayStart(NOW);
  assert.equal(evaluateCrisis({ now: NOW, settings: active, dayCostMicroUsd: 10_000_000, dayStart }).reason, 'day_cost');
  assert.equal(evaluateCrisis({ now: NOW, settings: active, dayCostMicroUsd: 9_999_999, dayStart }).trip, false);
  const ownerToday = { updatedAt: new Date(dayStart.getTime() + H), updatedBy: 'hello@skinaid.mn' };
  const dayStop = { reason: 'day_cost', at: new Date(dayStart.getTime() + H / 2) };
  assert.equal(evaluateCrisis({ now: NOW, settings: active, settingsMeta: ownerToday, autoStop: dayStop, dayCostMicroUsd: 20_000_000, dayStart }).trip, false, 'өнөөдөр day_cost-оор зогсоосны дараа дахин асаасан');
  // Аудит: өглөө ердийн хадгалалт (off → shadow) day_cost-ыг өдөржин унтраадаг байв
  assert.equal(evaluateCrisis({ now: NOW, settings: active, settingsMeta: ownerToday, dayCostMicroUsd: 20_000_000, dayStart }).reason, 'day_cost', 'зогсолтгүй ердийн хадгалалт');
  assert.equal(evaluateCrisis({ now: NOW, settings: active, settingsMeta: ownerToday, autoStop: { ...dayStop, reason: 'wrong_ratings' }, dayCostMicroUsd: 20_000_000, dayStart }).reason, 'day_cost', 'өөр шалтгааны зогсолт');
  assert.equal(evaluateCrisis({ now: NOW, settings: active, settingsMeta: ownerToday, autoStop: { reason: 'day_cost', at: new Date(dayStart.getTime() - H) }, dayCostMicroUsd: 20_000_000, dayStart }).reason, 'day_cost', 'өчигдрийн зогсолт');
  assert.equal(evaluateCrisis({ now: NOW, settings: active, settingsMeta: { updatedAt: new Date(dayStart.getTime() + H), updatedBy: 'system' }, dayCostMicroUsd: 20_000_000, dayStart }).reason, 'day_cost');
  assert.equal(evaluateCrisis({ now: NOW, settings: { active: true, monthlyCostCapUsd: 0 }, dayCostMicroUsd: 1e9, dayStart }).trip, false, 'хязгааргүй');
  assert.equal(ubDayStart(new Date('2026-11-27T17:30:00Z')).toISOString(), '2026-11-27T16:00:00.000Z', 'УБ шөнө дунд');
});

function setup(settings = { mode: 'shadow', killSwitch: false, monthlyRunCap: 3000, monthlyCostCapUsd: 50, updatedBy: 'hello@skinaid.mn', updatedAt: new Date(NOW.getTime() - 48 * H), lastAuditId: 'a_x' }) {
  const fake = createFakeFirestore();
  const fs = createFirestore({ projectId: 'skinaid-mn', getAccessToken: async () => 't', fetchImpl: fake.fetchImpl });
  const store = createStore(fs, { now: () => NOW });
  fake.seed('messenger_settings/main', settings, encodeFields);
  return { fake, store, guard: createCrisisGuard({ store, now: () => NOW, log: () => {} }) };
}

test('хямрал (Firestore): зогсоолт = killSwitch + audit + статус НЭГ commit, горим/хязгаар хэвээр; алдааны дараалал тоологдоно', async () => {
  const s = setup();
  for (let i = 0; i < 5; i++) {
    s.fake.seed(`messenger_drafts/d_${i}`, { rating: 'wrong', ratedAt: new Date(NOW.getTime() - (i + 1) * H), route: 'auto_candidate' }, encodeFields);
  }
  const r = await s.guard.check();
  assert.equal(r.trip, true);
  assert.equal(r.stopped, true);
  const st = s.fake.read('messenger_settings/main');
  assert.equal(st.killSwitch, true);
  assert.equal(st.mode, 'shadow');
  assert.equal(st.monthlyRunCap, 3000);
  assert.equal(st.updatedBy, 'system');
  const audit = s.fake.read(`messenger_audit/${st.lastAuditId}`);
  assert.equal(audit.action, 'auto_stop');
  assert.equal(audit.detail.reason, 'wrong_ratings');
  assert.equal(s.fake.read('messenger_status/main').autoStop.reason, 'wrong_ratings');
  // Зогссон байхад дахин шалгахад юу ч хийхгүй
  assert.deepEqual(await s.guard.check(), { trip: false });
  // Алдааны дараалал: saveDraft (run error ×5) → afterRun-ээр зогсоно; ok → 0
  const e = setup();
  for (let i = 0; i < 4; i++) await e.store.saveDraft({ draft: null, run: { status: 'error', billable: false }, month: '2026-11' });
  assert.equal(e.fake.read('messenger_status/main').errorStreak, 4);
  // Түр зуурын (дахин оролдогдох) алдаа тоологдохгүй, тэглэхгүй (аудит: богино тасалдал зогсоодог байв)
  for (let i = 0; i < 3; i++) await e.store.saveDraft({ draft: null, run: { status: 'error', billable: false, retryable: true }, month: '2026-11' });
  assert.equal(e.fake.read('messenger_status/main').errorStreak, 4);
  assert.deepEqual(await e.guard.afterRun({ status: 'error', retryable: true }), { trip: false });
  assert.equal((await e.guard.afterRun({ status: 'error' })).trip, false);
  await e.store.saveDraft({ draft: null, run: { status: 'error', billable: false }, month: '2026-11' });
  assert.equal((await e.guard.afterRun({ status: 'error' })).reason, 'error_streak');
  assert.equal(e.fake.read('messenger_status/main').errorStreak, 0, 'зогсоход дараалал 0 болно');
  await e.store.saveDraft({ draft: null, run: { status: 'ok', billable: true, costMicroUsd: 10 }, month: '2026-11' });
  assert.equal(e.fake.read('messenger_status/main').errorStreak, 0);
  // Эзэмшигч зэрэг хадгалсан (updateTime зөрсөн) — дарж бичихгүй
  const race = setup();
  const meta = await race.store.readSettingsMeta();
  race.fake.seed('messenger_settings/main', { mode: 'shadow', killSwitch: false, updatedBy: 'hello@skinaid.mn' }, encodeFields);
  assert.equal(await race.store.autoStop({ reason: 'error_streak', detail: {}, updateTime: meta.updateTime }), false);
  assert.equal(race.fake.read('messenger_settings/main').killSwitch, false);
});

test('өдрийн нэгтгэл: ноорог, route, intent, AI статус, зардал, токен — ноорогтой НЭГ commit; admin зардал тусдаа', async () => {
  const s = setup();
  const day = ubDay(NOW);
  await s.store.saveDraft({
    draft: { route: 'auto_candidate', intent: 'price', userText: 'x' }, replyToEventId: 'e_1', month: '2026-11',
    run: { status: 'ok', billable: true, costMicroUsd: 1234, inputTokens: 10, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 0 },
  });
  await s.store.saveDraft({ draft: { route: 'handoff', intent: 'side_effect', userText: 'y' }, replyToEventId: 'e_2', month: '2026-11', run: { status: 'cap', billable: false } });
  await s.store.saveAdminRun({ run: { status: 'ok', billable: true, costMicroUsd: 500 }, month: '2026-11' });
  const d = s.fake.read(`messenger_usage/${day}`);
  assert.equal(d.drafts, 2);
  assert.deepEqual(d.routes, { auto_candidate: 1, handoff: 1 });
  assert.deepEqual(d.intents, { price: 1, side_effect: 1 });
  assert.deepEqual(d.runs, { ok: 1, cap: 1 });
  assert.equal(d.costMicroUsd, 1234);
  assert.equal(d.adminCostMicroUsd, 500, 'туршилтын зардал үйлдвэрлэлийн зардлаас тусдаа');
  assert.equal(d.cacheReadTokens, 300);
  assert.ok(d.expireAt instanceof Date);
  // Хямралын өдрийн зардал = үйлдвэрлэлийн л
  assert.equal((await s.store.readCrisisCounters(NOW)).dayCostMicroUsd, 1234);
});

test('echo: шалтгаантай ангилал; strict (3-р үе шат) — хэрэглэгчгүй = ажилтан, 8 с босго, загвар/манай апп хэвээр; planBatch мессежид шалтгаан', () => {
  const user = new Date(NOW.getTime() - 60_000);
  const at = (ms, extra = {}) => ({ eventTime: new Date(user.getTime() + ms), payload: { app_id: '263902037430900', text: 'Сайн байна уу, бид удахгүй хариулна', ...extra } });
  const fp = new Set();
  assert.deepEqual(classifyEchoWhy(at(1000, { app_id: 'OWN' }), { ownAppId: 'OWN', lastUserAt: user }), { source: 'own_bot', why: 'own_app' });
  assert.deepEqual(classifyEchoWhy(at(1000), { ownAppId: 'OWN', lastUserAt: user }), { source: 'automation', why: 'fast_gap' });
  // strict: Meta-ийн автомат хариу (2–4 с) автомат хэвээр (бот дуугүй болохгүй — аудит); 8 с-ээс удаан = ажилтан
  assert.deepEqual(classifyEchoWhy(at(3000), { ownAppId: 'OWN', lastUserAt: user, policy: 'strict' }), { source: 'automation', why: 'fast_gap' });
  assert.deepEqual(classifyEchoWhy(at(10_000), { ownAppId: 'OWN', lastUserAt: user, policy: 'strict' }), { source: 'staff', why: 'default' });
  assert.deepEqual(classifyEchoWhy(at(10_000), { ownAppId: 'OWN', lastUserAt: user }), { source: 'automation', why: 'fast_gap' }, 'shadow хэвээр');
  assert.deepEqual(classifyEchoWhy(at(1000), { ownAppId: 'OWN', lastUserAt: null, policy: 'strict' }), { source: 'staff', why: 'no_user' });
  assert.deepEqual(classifyEchoWhy(at(AUTOMATION_ECHO_MS + 1), { ownAppId: 'OWN', lastUserAt: user }), { source: 'staff', why: 'default' });
  void fp;
  const plan = planBatch({ state: 'bot', humanSince: null, lastStaffAt: null, lastUserAt: null }, [
    { id: 'e1', kind: 'message', mid: 'm1', eventTime: user, payload: { text: 'Сайн уу' } },
    { id: 'e2', kind: 'echo', mid: 'm2', eventTime: new Date(user.getTime() + 2000), payload: { app_id: '263902037430900', text: 'Удахгүй хариулна' } },
  ], { mode: 'shadow', ownAppId: 'OWN', now: NOW });
  assert.equal(plan.messages[1].echoWhy, 'fast_gap');
  assert.equal(plan.messages[1].role, 'automation');
  assert.equal(plan.action.type, 'agent', 'сүүдэрт автомат хариу асуултад хариулаагүй гэж үзнэ (хэвээр)');
});

test('аудит (echo): дахин боловсруулахад ярианы lastUserAt багцын сүүлийн мессеж болсон ч Meta-ийн автомат хариу «ажилтан» болохгүй', () => {
  const t0 = new Date(NOW.getTime() - 120_000);
  const events = [
    { id: 'e1', kind: 'message', mid: 'm1', eventTime: t0, payload: { text: 'Үнэ хэд вэ' } },
    { id: 'e2', kind: 'echo', mid: 'm2', eventTime: new Date(t0.getTime() + 3000), payload: { app_id: '263902037430900', text: 'Удахгүй хариулна' } },
    { id: 'e3', kind: 'message', mid: 'm3', eventTime: new Date(t0.getTime() + 60_000), payload: { text: 'Байна уу?' } },
  ];
  // Эхний оролдлого saveBatch-ээр lastUserAt = t0+60 с хадгалсан, Claude түр алдаа → event pending → дахин төлөвлөнө
  const replan = planBatch({ state: 'bot', humanSince: null, lastStaffAt: null, lastUserAt: events[2].eventTime }, events, { mode: 'shadow', ownAppId: 'OWN', now: NOW });
  assert.equal(replan.messages[1].role, 'automation');
  assert.equal(replan.messages[1].echoWhy, 'fast_gap');
  assert.equal(replan.conversation.state, 'bot');
  assert.equal(replan.action.type, 'agent', 'бот 12 цаг дуугүй болохгүй');
  // Өмнөх багцын хэрэглэгчийн мессеж (echo-оос өмнө) хэвээр ашиглагдана
  const later = planBatch({ state: 'bot', humanSince: null, lastStaffAt: null, lastUserAt: t0 }, [events[1]], { mode: 'shadow', ownAppId: 'OWN', now: NOW });
  assert.equal(later.messages[0].echoWhy, 'fast_gap');
});

test('аудит: echo-гийн өдрийн тоо давтан боловсруулахад давхардахгүй; хямралын шалгалт хоцорвол хэзээ дахин илгээхийг хэлнэ', async () => {
  const s = setup();
  const t0 = new Date(NOW.getTime() - 120_000);
  const events = [
    { id: 'e1', kind: 'message', mid: 'm1', eventTime: t0, payload: { text: 'Үнэ хэд вэ' } },
    { id: 'e2', kind: 'echo', mid: 'm2', eventTime: new Date(t0.getTime() + 3000), payload: { app_id: '263902037430900', text: 'Удахгүй хариулна' } },
  ];
  const conv = { state: 'bot', humanSince: null, lastStaffAt: null, lastUserAt: null };
  // pipeline шиг: хадгалсан echo-г уншаад төлөвлөнө → хадгална; дахин боловсруулахад (retry) ангилал хэвээр, тоо давхардахгүй
  for (let i = 0; i < 2; i++) {
    const knownEchoes = await s.store.readEchoMessages('h1', ['e2']);
    assert.equal(knownEchoes.size, i);
    const plan = planBatch(i ? { ...conv, lastUserAt: NOW } : conv, events, { mode: 'shadow', ownAppId: 'OWN', now: NOW, knownEchoes });
    assert.equal(plan.messages[1].role, 'automation');
    await s.store.saveBatch('h1', plan, null);
  }
  assert.deepEqual(s.fake.read(`messenger_usage/${ubDay(NOW)}`).echo, { automation_fast_gap: 1 });
  assert.equal(s.fake.read('messenger_threads/h1/messages/e2').echoKnown, undefined, 'дотоод тэмдэг баримтад бичигдэхгүй');
  let clock = NOW.getTime();
  const handler = createAdminHandler({
    getRuntime: () => ({ store: s.store, guard: s.guard }), env: {}, now: () => NOW, clock: () => clock, log: () => {},
    verifyIdToken: async () => ({ email: 'hello@skinaid.mn', uid: 'u' }),
  });
  const call = () => handler(new Request('https://www.skinaid.mn/api/admin', { method: 'POST', body: JSON.stringify({ action: 'crisis_check' }), headers: { origin: ADMIN_ORIGIN, 'content-type': 'application/json', authorization: 'Bearer x' } })).then((r) => r.json());
  assert.equal((await call()).throttled, undefined);
  clock += 10_000;
  const r2 = await call();
  assert.equal(r2.throttled, true);
  assert.ok(r2.retryAfterMs > 19_000 && r2.retryAfterMs <= 21_000, String(r2.retryAfterMs));
  // Баталгаажуулалт: бүтэлгүй шалгалт дараагийнхыг 30 с хаахгүй
  let boom = true;
  const h2 = createAdminHandler({
    getRuntime: () => ({ store: s.store, guard: { check: async () => { if (boom) { boom = false; throw new Error('x'); } return { trip: false }; } } }), env: {}, now: () => NOW, clock: () => clock, log: () => {},
    verifyIdToken: async () => ({ email: 'hello@skinaid.mn', uid: 'u' }),
  });
  const call2 = () => h2(new Request('https://www.skinaid.mn/api/admin', { method: 'POST', body: JSON.stringify({ action: 'crisis_check' }), headers: { origin: ADMIN_ORIGIN, 'content-type': 'application/json', authorization: 'Bearer x' } })).then((r) => r.json());
  assert.equal((await call2()).error, 'server_error');
  assert.deepEqual(await call2(), { ok: true, trip: false, reason: null, stopped: false });
});

test('баталгаажуулалт (echo): өмнөх багцын хэрэглэгчийн мессежийн дараах автомат хариу дахин боловсруулахад хэвээр (strict-д ч); хоцорч ирсэн ажилтны хариу «автомат» болохгүй', () => {
  const u1 = new Date(NOW.getTime() - 300_000);
  const echo = { id: 'e2', kind: 'echo', mid: 'm2', eventTime: new Date(u1.getTime() + 3000), payload: { app_id: '263902037430900', text: 'Удахгүй хариулна' } };
  const u2 = { id: 'e3', kind: 'message', mid: 'm3', eventTime: new Date(u1.getTime() + 60_000), payload: { text: 'Байна уу?' } };
  const base = { state: 'bot', humanSince: null, lastStaffAt: null };
  const first = planBatch({ ...base, lastUserAt: u1 }, [echo, u2], { mode: 'shadow', ownAppId: 'OWN', now: NOW });
  assert.equal(first.messages[0].echoWhy, 'fast_gap');
  // saveBatch lastUserAt = u2 хадгалсан → агент түр алдаа → дахин төлөвлөнө: хадгалсан ангилал (automation/fast_gap) хэвээр
  const known = new Map([['e2', { role: 'automation', echoWhy: 'fast_gap' }]]);
  for (const echoPolicy of ['shadow', 'strict']) {
    const re = planBatch({ ...base, lastUserAt: u2.eventTime }, [echo, u2], { mode: 'shadow', ownAppId: 'OWN', now: NOW, knownEchoes: known, echoPolicy });
    assert.equal(re.messages[0].role, 'automation', echoPolicy);
    assert.equal(re.messages[0].echoWhy, 'fast_gap', echoPolicy);
    assert.equal(re.messages[0].echoKnown, true);
    assert.equal(re.conversation.state, 'bot', echoPolicy);
    assert.equal(re.action.type, 'agent', echoPolicy);
  }
  // Хоцорч ирсэн (дараалал алдагдсан) ажилтны хариу: хэрэглэгч бичсэн нь мэдэгдэж байгаа ч өмнөх мөч тодорхойгүй → ажилтан
  const late = planBatch({ ...base, lastUserAt: u2.eventTime }, [{ ...echo, id: 'e9', eventTime: new Date(u1.getTime() + 30_000) }], { mode: 'shadow', ownAppId: 'OWN', now: NOW });
  assert.equal(late.messages[0].role, 'staff');
  assert.equal(late.messages[0].echoWhy, 'default');
  assert.equal(late.conversation.state, 'human');
  // Хэрэглэгч огт бичээгүй яриа — хэвээр (сүүдэрт автомат)
  assert.equal(planBatch({ ...base, lastUserAt: null }, [echo], { mode: 'shadow', ownAppId: 'OWN', now: NOW }).messages[0].echoWhy, 'no_user');
});

test('баталгаажуулалт (хямрал): өдрийн зардлын зогсолтыг дараагийн өөр зогсолт дарахгүй; анхны дахин асаасан мөч тэмдэглэгдэж, дараагийн хадгалалт урагшлуулахгүй', async () => {
  const dayStart = ubDayStart(NOW);
  const meta = { updatedAt: new Date(dayStart.getTime() + 4 * H), updatedBy: 'hello@skinaid.mn' };
  // 01:00 зардлаар зогссон → асаасан → 03:00 «Буруу»-гаар зогссон → 04:00 асаасан: зардлын шалгуур дахин зогсоохгүй
  const twice = { settingsMeta: meta, autoStop: { reason: 'wrong_ratings', at: new Date(dayStart.getTime() + 3 * H) }, dayCostStopAt: new Date(dayStart.getTime() + H) };
  assert.equal(evaluateCrisis({ now: NOW, settings: active, ...twice, dayCostMicroUsd: 20_000_000, dayStart }).trip, false);
  assert.equal(evaluateCrisis({ now: NOW, settings: active, ...twice, dayCostStopAt: new Date(dayStart.getTime() - H), dayCostMicroUsd: 20_000_000, dayStart }).reason, 'day_cost', 'өчигдрийн зогсолт');
  // Тэмдэглэсэн resumedAt: дараагийн ердийн хадгалалт (updatedAt хожуу) завсрын ноорогийг тооноос хасахгүй
  const r = (h) => ({ rating: 'wrong', ratedAt: new Date(NOW.getTime() - 60_000), createdAt: new Date(NOW.getTime() - h * H) });
  const between = [r(1.5), r(1.4), r(1.3), r(1.2), r(1.1)];
  const stop = { reason: 'wrong_ratings', at: new Date(NOW.getTime() - 3 * H) };
  const laterSave = { updatedAt: new Date(NOW.getTime() - H / 2), updatedBy: 'hello@skinaid.mn' };
  assert.equal(evaluateCrisis({ now: NOW, settings: active, settingsMeta: laterSave, autoStop: stop, ratings: between }).trip, false, 'тэмдэглээгүй бол сүүлийн хадгалалтаар');
  assert.equal(evaluateCrisis({ now: NOW, settings: active, settingsMeta: laterSave, autoStop: { ...stop, resumedAt: new Date(NOW.getTime() - 2 * H) }, ratings: between }).reason, 'wrong_ratings');
  // Firestore: зогсолт → дахин асаалт → шалгалт resumedAt-ийг тэмдэглэнэ; зардлын зогсолт dayCostStopAt бичнэ
  const s = setup({ mode: 'shadow', killSwitch: false, monthlyRunCap: 3000, monthlyCostCapUsd: 50, updatedBy: 'hello@skinaid.mn', updatedAt: new Date(NOW.getTime() - 2 * H), lastAuditId: 'a_y' });
  s.fake.seed('messenger_status/main', { autoStop: { reason: 'wrong_ratings', at: new Date(NOW.getTime() - 3 * H) }, lastWebhookAt: NOW }, encodeFields);
  await s.guard.check();
  const st = s.fake.read('messenger_status/main');
  assert.equal(st.autoStop.resumedAt.getTime(), NOW.getTime() - 2 * H);
  assert.equal(st.autoStop.reason, 'wrong_ratings', 'бусад талбар хэвээр');
  assert.ok(st.lastWebhookAt instanceof Date);
  await s.store.autoStop({ reason: 'day_cost', detail: {}, updateTime: (await s.store.readSettingsMeta()).updateTime });
  const st2 = s.fake.read('messenger_status/main');
  assert.ok(st2.dayCostStopAt instanceof Date);
  assert.equal(st2.autoStop.resumedAt, undefined, 'шинэ зогсолт — тэмдэг арилна');
});

test('аудит (хямрал, Firestore): автомат зогсолтын дараа дахин асаасан бол өмнөх ноорогийн «Буруу» дахин зогсоохгүй; үнэлгээний уншилт ≤ 50', async () => {
  const s = setup({ mode: 'shadow', killSwitch: false, monthlyRunCap: 3000, monthlyCostCapUsd: 50, updatedBy: 'hello@skinaid.mn', updatedAt: new Date(NOW.getTime() - H), lastAuditId: 'a_y' });
  s.fake.seed('messenger_status/main', { autoStop: { reason: 'wrong_ratings', at: new Date(NOW.getTime() - 3 * H) } }, encodeFields);
  for (let i = 0; i < 6; i++) {
    s.fake.seed(`messenger_drafts/d_${i}`, { rating: 'wrong', ratedAt: new Date(NOW.getTime() - (i + 1) * 60_000), createdAt: new Date(NOW.getTime() - 5 * H), route: 'auto_candidate' }, encodeFields);
  }
  assert.equal((await s.guard.check()).trip, false, 'хуучин ноорог');
  for (let i = 0; i < 5; i++) {
    s.fake.seed(`messenger_drafts/n_${i}`, { rating: 'wrong', ratedAt: new Date(NOW.getTime() - (i + 1) * 30_000), createdAt: new Date(NOW.getTime() - 20 * 60_000), route: 'auto_candidate' }, encodeFields);
  }
  assert.equal((await s.guard.check()).reason, 'wrong_ratings', 'дахин асаасны дараах ноорог');
  const { CRISIS_RATINGS_READ } = await import('../../api/_lib/crisis.js');
  assert.ok(CRISIS_RATINGS_READ <= 50);
});

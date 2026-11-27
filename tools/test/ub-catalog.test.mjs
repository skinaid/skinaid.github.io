// node --test 'tools/test/*.test.mjs' — assets/js/ub-catalog.js (UB Beauty → «Онцлох эмчилгээ» үнэ, хугацаа)
// + api/_lib/ub-catalog-sync.js (өдөр бүрийн серверийн шинэчлэл)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  UB_LINKS, formatDuration, parseUbServices, ubFields, applyUbCatalog, siteHidden, fetchUbServices,
} from '../../assets/js/ub-catalog.js';
import { syncUbCatalog, ubSyncConfig } from '../../api/_lib/ub-catalog-sync.js';

const defaults = {};
vm.runInNewContext(readFileSync(new URL('../../assets/js/catalog-defaults.js', import.meta.url), 'utf8'), { window: defaults });
const TREATMENTS = JSON.parse(JSON.stringify(defaults.SKINAID_DEFAULTS.treatments));   // vm-ийн массив → энэ realm

/** UB Beauty-ийн жагсаалт: холбоотой БҮХ id (үнэ нуусан, 45 мин), override-оор өөрчилнө */
function ubJson(over = {}, drop = []) {
  const ids = [...new Set(Object.values(UB_LINKS).flat())].filter((id) => !drop.includes(id));
  return { services: ids.map((id) => ({ id, name: 'x', duration_min: 45, price: null, price_max: null, price_hidden: true, ...(over[id] || {}) })) };
}
const EXAM = UB_LINKS['exam-1'][0];

test('UB_LINKS: сайтын анхдагч мөрийн id, давхардалгүй UUID', () => {
  const siteIds = new Set(TREATMENTS.map((t) => t.id));
  const all = Object.values(UB_LINKS).flat();
  for (const k of Object.keys(UB_LINKS)) assert.ok(siteIds.has(k), `catalog-defaults-д ${k} байхгүй`);
  assert.equal(new Set(all).size, all.length, 'нэг UB үйлчилгээ хоёр мөрд холбогдсон');
  for (const id of all) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  // эзэмшигчтэй тулгасан 2026-11-27: холбогдоогүй үлдсэн мөрүүд
  assert.deepEqual(TREATMENTS.map((t) => t.id).filter((id) => !UB_LINKS[id]).sort(),
    ['inject-1', 'inject-5', 'inject-6', 'inject-7', 'iv-2', 'laser-2', 'laser-3', 'laser-4', 'lift-1', 'massage-2'].filter((id) => TREATMENTS.some((t) => t.id === id)).sort());
});

test('formatDuration', () => {
  assert.equal(formatDuration(30), '30 мин');
  assert.equal(formatDuration(60), '1 цаг');
  assert.equal(formatDuration(90), '1 цаг 30 мин');
  assert.equal(formatDuration(120), '2 цаг');
  assert.equal(formatDuration(0), '');
  assert.equal(formatDuration(null), '');
});

test('parseUbServices: буруу хэлбэр null, буруу мөр алгасна, үнэгүй = нуусан (fail-closed)', () => {
  assert.equal(parseUbServices(null), null);
  assert.equal(parseUbServices({ services: 'x' }), null);
  const m = parseUbServices({ services: [{ id: 'nope' }, null, { id: EXAM.toUpperCase(), duration_min: 30, price: 50000, price_hidden: false }, { id: UB_LINKS['exam-2'][0], price: null, price_hidden: false }] });
  assert.equal(m.size, 2);
  assert.deepEqual(m.get(EXAM), { id: EXAM, duration: 30, price: 50000, priceMax: null, priceHidden: false });
  assert.equal(m.get(UB_LINKS['exam-2'][0]).priceHidden, true);
});

test('ubFields: ганц үнэ, хэлбэлзэлтэй үнэ, олон үйлчилгээ, нуусан, идэвхгүй', () => {
  const ub = parseUbServices({ services: [
    { id: 'a0000000-0000-4000-8000-000000000001', duration_min: 30, price: 50000, price_hidden: false },
    { id: 'a0000000-0000-4000-8000-000000000002', duration_min: 45, price: 80000, price_max: 220000, price_hidden: false },
    { id: 'a0000000-0000-4000-8000-000000000003', duration_min: 15, price: 22000, price_hidden: false },
    { id: 'a0000000-0000-4000-8000-000000000004', duration_min: 90, price: null, price_hidden: true },
  ] });
  const id = (n) => `a0000000-0000-4000-8000-00000000000${n}`;
  assert.deepEqual(ubFields([id(1)], ub), { off: false, t: '30 мин', p: '₮50,000', missing: [] });
  assert.equal(ubFields([id(2)], ub).p, '₮80,000-с');
  assert.deepEqual(ubFields([id(1), id(3)], ub), { off: false, t: '15–30 мин', p: '₮22,000-с', missing: [] });
  // нэг нь нуусан → бүх мөрийн үнэ нуугдана (нуусан нь хамгийн хямд байж болзошгүй)
  assert.deepEqual(ubFields([id(3), id(4)], ub), { off: false, t: '15–90 мин', p: '', missing: [] });
  // зарим нь алга — үлдсэнээр
  assert.deepEqual(ubFields([id(1), id(9)], ub), { off: false, t: '30 мин', p: '₮50,000', missing: [id(9)] });
  assert.deepEqual(ubFields([id(9)], ub), { off: true, t: '', p: '', missing: [id(9)] });
});

test('applyUbCatalog: холбоотой мөрийн t/p/ub/ubOff, холбоогүй хэвээр, нэр/тайлбар хөндөхгүй', () => {
  const ub = parseUbServices(ubJson({ [EXAM]: { duration_min: 30, price: 50000, price_hidden: false } }, UB_LINKS['iv-1']));
  const rows = [
    { id: 'exam-1', c: 'exam', n: 'Арьсны үзлэг', d: 'тайлбар', t: '1 цаг', p: '₮50,000', hidden: false },
    { id: 'iv-1', c: 'iv', n: 'Glutathione', d: '', t: '', p: '', hidden: false },
    { id: 'inject-7', c: 'inject', n: 'Япон', d: '', t: '40 мин', p: '₮1', hidden: true },
    { id: 'svc-new', c: 'minor', n: 'Шинэ', d: '', t: '', p: '', hidden: false, ub: ['x'], ubOff: true },
  ];
  const r = applyUbCatalog(rows, ub);
  assert.equal(r.ok, true);
  const [exam, iv, jp, nw] = r.services;
  assert.deepEqual(exam, { ...rows[0], t: '30 мин', p: '₮50,000', hiddenSite: false, ub: UB_LINKS['exam-1'], ubOff: false, hidden: false });
  assert.equal(iv.ubOff, true); assert.equal(iv.hidden, true); assert.equal(iv.hiddenSite, false);
  assert.deepEqual(jp, { ...rows[2], hiddenSite: true, hidden: true });
  assert.equal('ub' in nw, false); assert.equal('ubOff' in nw, false);   // холбоос арилсан мөрийн хуучин талбар цэвэрлэгдэнэ
  assert.deepEqual(r.changed, ['exam-1', 'iv-1']);
  assert.deepEqual(r.report.off, ['iv-1']);
  assert.deepEqual(r.report.unlinked, ['inject-7', 'svc-new']);
  assert.deepEqual(rows[0].t, '1 цаг', 'оролт өөрчлөгдөхгүй');
  // дахин тавихад өөрчлөлтгүй (idempotent)
  assert.deepEqual(applyUbCatalog(r.services, ub).changed, []);
});

test('applyUbCatalog: сайтын «Нуух» нь UB Beauty дахин идэвхжихэд хадгалагдана', () => {
  const rows = [{ id: 'iv-1', c: 'iv', n: 'G', d: '', t: '', p: '', hidden: false }, { id: 'laser-1', c: 'laser', n: 'D', d: '', t: '', p: '', hidden: true }];
  const offRun = applyUbCatalog(rows, parseUbServices(ubJson({}, UB_LINKS['iv-1']))).services;
  assert.equal(offRun[0].hidden, true);
  const backOn = applyUbCatalog(offRun, parseUbServices(ubJson())).services;
  assert.equal(backOn[0].hidden, false, 'UB-д буцаж идэвхжвэл сайт дахин харуулна');
  assert.equal(backOn[1].hidden, true, 'сайтад гараар нуусан мөр нуугдсан хэвээр');
  assert.equal(siteHidden({ hidden: true }), true);
  assert.equal(siteHidden({ hidden: true, hiddenSite: false }), false);
});

test('applyUbCatalog: хоосон эсвэл ихэнх нь алга бол зогсоно (бүх мөрийг андуурч нуухгүй)', () => {
  const rows = TREATMENTS.map((t) => ({ ...t, hidden: false }));
  assert.deepEqual(applyUbCatalog(rows, new Map()).ok, false);
  const ids = [...new Set(Object.values(UB_LINKS).flat())];
  const few = parseUbServices({ services: ids.slice(0, 5).map((id) => ({ id, price: 1, price_hidden: true })) });
  const r = applyUbCatalog(rows, few);
  assert.equal(r.ok, false); assert.equal(r.reason, 'ub_mismatch');
});

test('fetchUbServices: түлхүүрийг толгойд (URL-д БИШ), HTTP алдаа, буруу хариу', async () => {
  let seen;
  const ok = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify(ubJson()), { status: 200 }); };
  const m = await fetchUbServices({ apiBase: 'https://ub.test/api/v1/web/', key: 'pk_live_x', fetchImpl: ok });
  assert.equal(seen.url, 'https://ub.test/api/v1/web/services');
  assert.equal(seen.init.headers['X-Api-Key'], 'pk_live_x');
  assert.ok(m.size > 50);
  await assert.rejects(fetchUbServices({ apiBase: 'https://ub.test', key: 'k', fetchImpl: async () => new Response('{}', { status: 401 }) }), /ub_http_401/);
  await assert.rejects(fetchUbServices({ apiBase: 'https://ub.test', key: 'k', fetchImpl: async () => new Response('{"x":1}') }), /ub_bad_response/);
  await assert.rejects(fetchUbServices({ apiBase: '', key: 'k' }), /ub_not_configured/);
});

// ---------- Сервер (cron) ----------
const SK = 'sk_live_' + 'a'.repeat(43);
function fakeFs(doc) {
  const s = { doc, writes: [] };
  return {
    s,
    async get(path) { assert.equal(path, 'settings/catalog'); return s.doc; },
    async commit(writes) { s.writes.push(...writes); return {}; },
  };
}
const ubFetch = (over, drop) => async () => new Response(JSON.stringify(ubJson(over, drop)));

test('ubSyncConfig: зөвхөн sk_live_ хэлбэр (pk тавьсан бол ашиглахгүй)', () => {
  assert.equal(ubSyncConfig({ UBBEAUTY_SECRET_KEY: SK }).key, SK);
  assert.equal(ubSyncConfig({ UBBEAUTY_SECRET_KEY: 'pk_live_' + 'a'.repeat(43) }).key, '');
  assert.equal(ubSyncConfig({}).key, '');
  assert.match(ubSyncConfig({}).apiBase, /^https:\/\/www\.ubbeauty\.mn\/api\/v1\/web$/);
});

test('syncUbCatalog: түлхүүргүй / каталоггүй бол алгасна, баримт үүсгэхгүй', async () => {
  assert.deepEqual(await syncUbCatalog({ fs: fakeFs(null), env: {} }), { status: 'skipped', reason: 'no_key' });
  const fs = fakeFs(null);
  assert.deepEqual(await syncUbCatalog({ fs, env: { UBBEAUTY_SECRET_KEY: SK }, fetchImpl: ubFetch() }), { status: 'skipped', reason: 'no_catalog' });
  assert.equal(fs.s.writes.length, 0);
});

test('syncUbCatalog: өөрчлөлтийг updateTime precondition-той бичнэ, багц/нэр хөндөхгүй', async () => {
  const data = { services: [{ id: 'exam-1', c: 'exam', n: 'Арьсны үзлэг', d: 'd', t: '1 цаг', p: '₮50,000', hidden: false }],
    packages: [{ id: 'p1', name: 'Glow Start', price: '462,000₮', hidden: false }], updatedBy: 'a@b' };
  const fs = fakeFs({ data, updateTime: '2026-11-27T00:00:00Z' });
  const now = () => new Date('2026-11-27T20:00:00Z');
  const r = await syncUbCatalog({ fs, env: { UBBEAUTY_SECRET_KEY: SK }, fetchImpl: ubFetch({ [EXAM]: { duration_min: 30, price: 50000, price_hidden: false } }), now });
  assert.deepEqual(r, { status: 'updated', changed: 1 });
  const w = fs.s.writes[0];
  assert.deepEqual(w.currentDocument, { updateTime: '2026-11-27T00:00:00Z' });
  assert.equal(w.update.fields.services.arrayValue.values[0].mapValue.fields.t.stringValue, '30 мин');
  assert.equal(w.update.fields.packages.arrayValue.values[0].mapValue.fields.name.stringValue, 'Glow Start');
  assert.equal(w.update.fields.updatedBy.stringValue, 'a@b');
  assert.equal(w.update.fields.ubSyncedAt.timestampValue, '2026-11-27T20:00:00.000Z');
  // ижил бол бичихгүй
  const fs2 = fakeFs({ data: { ...data, services: [{ ...data.services[0], t: '30 мин', hiddenSite: false, ub: UB_LINKS['exam-1'], ubOff: false }] }, updateTime: 'x' });
  assert.deepEqual(await syncUbCatalog({ fs: fs2, env: { UBBEAUTY_SECRET_KEY: SK }, fetchImpl: ubFetch({ [EXAM]: { duration_min: 30, price: 50000, price_hidden: false } }) }), { status: 'unchanged', changed: 0 });
  assert.equal(fs2.s.writes.length, 0);
});

test('syncUbCatalog: UB дутуу бол зогсоно; admin зэрэг хадгалсан бол conflict', async () => {
  const data = { services: TREATMENTS.map((t) => ({ ...t, hidden: false })) };
  const ids = [...new Set(Object.values(UB_LINKS).flat())];
  const fs = fakeFs({ data, updateTime: 'x' });
  assert.deepEqual(await syncUbCatalog({ fs, env: { UBBEAUTY_SECRET_KEY: SK }, fetchImpl: ubFetch({}, ids.slice(5)) }), { status: 'aborted', reason: 'ub_mismatch' });
  assert.equal(fs.s.writes.length, 0);
  const busy = { ...fakeFs({ data, updateTime: 'x' }), async commit() { const e = new Error('pre'); Object.defineProperty(e, 'isPrecondition', { value: true }); throw e; } };
  assert.deepEqual(await syncUbCatalog({ fs: busy, env: { UBBEAUTY_SECRET_KEY: SK }, fetchImpl: ubFetch() }), { status: 'conflict' });
});

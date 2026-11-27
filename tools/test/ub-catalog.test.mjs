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
  assert.deepEqual(m.get(EXAM), { id: EXAM, name: '', description: '', duration: 30, price: 50000, priceMax: null, priceHidden: false });
  assert.equal(m.get(UB_LINKS['exam-2'][0]).priceHidden, true);
});

test('ubFields: ганц үнэ, хэлбэлзэлтэй үнэ, олон үйлчилгээ, нуусан, идэвхгүй', () => {
  const ub = parseUbServices({ services: [
    { id: 'a0000000-0000-4000-8000-000000000001', name: 'Үзлэг', description: 'Эмч  үнэлнэ.\nБагтана: зөвлөгөө', duration_min: 30, price: 50000, price_hidden: false },
    { id: 'a0000000-0000-4000-8000-000000000002', name: 'TCA', duration_min: 45, price: 80000, price_max: 220000, price_hidden: false },
    { id: 'a0000000-0000-4000-8000-000000000003', name: 'Суга', description: 'Суганы үс', duration_min: 15, price: 22000, price_hidden: false },
    { id: 'a0000000-0000-4000-8000-000000000004', name: 'Бүтэн бие', duration_min: 90, price: null, price_hidden: true },
  ] });
  const id = (n) => `a0000000-0000-4000-8000-00000000000${n}`;
  // ганц үйлчилгээ: тайлбар UB-ээс (хоосон зай нэгтгэсэн), хувилбаргүй
  assert.deepEqual(ubFields([id(1)], ub), { off: false, t: '30 мин', p: '₮50,000', d: 'Эмч үнэлнэ. Багтана: зөвлөгөө', v: null, missing: [] });
  assert.equal(ubFields([id(2)], ub).p, '₮80,000-с');
  assert.equal(ubFields([id(2)], ub).d, null, 'UB тайлбаргүй бол сайтынх хэвээр');
  // олон үйлчилгээ: мөрийн тайлбар сайтынх (null), хувилбар бүр UB_LINKS-ийн дарааллаар
  assert.deepEqual(ubFields([id(1), id(3)], ub), { off: false, t: '15–30 мин', p: '₮22,000-с', d: null, missing: [],
    v: [{ n: 'Үзлэг', t: '30 мин', p: '₮50,000', d: 'Эмч үнэлнэ. Багтана: зөвлөгөө' }, { n: 'Суга', t: '15 мин', p: '₮22,000', d: 'Суганы үс' }] });
  // нэг нь нуусан → мөрийн үнэ нуугдана (нуусан нь хамгийн хямд байж болзошгүй); хувилбар бүр өөрийн үнээр
  const hid = ubFields([id(3), id(4)], ub);
  assert.equal(hid.p, ''); assert.equal(hid.t, '15–90 мин');
  assert.deepEqual(hid.v.map((x) => x.p), ['₮22,000', '']);
  assert.equal(ubFields([id(2), id(3)], ub).v[0].p, '₮80,000-с', 'хэлбэлзэлтэй хувилбар «-с»');
  // зарим нь алга — үлдсэнээр
  const part = ubFields([id(1), id(9)], ub);
  assert.deepEqual([part.t, part.p, part.missing, part.v.length], ['30 мин', '₮50,000', [id(9)], 1]);
  assert.deepEqual(ubFields([id(9)], ub), { off: true, t: '', p: '', d: null, v: null, missing: [id(9)] });
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

// ---------- Тайлбар, хувилбар (2026-11-27) ----------
test('applyUbCatalog: ганц мөрөнд UB тайлбар, олон мөрөнд v; холбоо тасарвал v цэвэрлэгдэнэ', () => {
  const [a1, a2] = UB_LINKS['acne-2'];
  const ub = parseUbServices(ubJson({
    [EXAM]: { name: 'Арьсны үзлэг', description: 'Эмч арьсыг үнэлнэ.', duration_min: 30, price: 50000, price_hidden: false },
    [a1]: { name: 'Батганы багц 1 - Хөнгөн зэрэг', description: '3 удаагийн курс.', duration_min: 60, price: 249000, price_hidden: false },
    [a2]: { name: 'Батганы багц 2 - Дунд зэрэг', description: '5 удаагийн курс.', duration_min: 60, price: 349000, price_hidden: false },
  }));
  const rows = [
    { id: 'exam-1', c: 'exam', n: 'Арьсны үзлэг, оношлогоо', d: 'хуучин', t: '', p: '', hidden: false },
    { id: 'acne-2', c: 'acne', n: 'Батганы багц эмчилгээ', d: 'Сайтын товч', t: '', p: '', hidden: false },
    { id: 'inject-7', c: 'inject', n: 'Япон', d: 'x', t: '', p: '', hidden: false, v: [{ n: 'хуучин' }] },
  ];
  const r = applyUbCatalog(rows, ub);
  const [exam, acne, jp] = r.services;
  assert.equal(exam.d, 'Эмч арьсыг үнэлнэ.'); assert.equal(exam.n, 'Арьсны үзлэг, оношлогоо', 'нэр сайтынх');
  assert.equal('v' in exam, false);
  assert.equal(acne.d, 'Сайтын товч'); assert.equal(acne.p, '₮249,000-с');
  assert.deepEqual(acne.v, [
    { n: 'Батганы багц 1 - Хөнгөн зэрэг', t: '1 цаг', p: '₮249,000', d: '3 удаагийн курс.' },
    { n: 'Батганы багц 2 - Дунд зэрэг', t: '1 цаг', p: '₮349,000', d: '5 удаагийн курс.' },
  ]);
  assert.equal('v' in jp, false);
  assert.deepEqual(applyUbCatalog(r.services, ub).changed, [], 'дахин тавихад өөрчлөлтгүй');
  // зөвхөн хувилбарын тайлбар өөрчлөгдсөн ч changed
  const ub2 = parseUbServices(ubJson({ [EXAM]: { name: 'Арьсны үзлэг', description: 'Эмч арьсыг үнэлнэ.', duration_min: 30, price: 50000, price_hidden: false },
    [a1]: { name: 'Батганы багц 1 - Хөнгөн зэрэг', description: 'ШИНЭ', duration_min: 60, price: 249000, price_hidden: false },
    [a2]: { name: 'Батганы багц 2 - Дунд зэрэг', description: '5 удаагийн курс.', duration_min: 60, price: 349000, price_hidden: false } }));
  assert.ok(applyUbCatalog(r.services, ub2).changed.includes('acne-2'));
});

test('catalog-render: v-тэй мөр = <div> карт + дэлгэх жагсаалт + холбоос; v-гүй мөр хуучнаараа <a>', () => {
  const g = {};
  vm.runInNewContext(readFileSync(new URL('../../assets/js/catalog-render.js', import.meta.url), 'utf8'), { window: g });
  const R = g.SKINAID_RENDER;
  const cats = { acne: 'Батга' };
  const plain = R.row({ id: 'acne-1', c: 'acne', n: 'Үрэвсэлт', d: 'тайлбар', t: '30 мин', p: '₮79,000' }, cats);
  assert.match(plain, /^<a class="row" href="#contact"/);
  const multi = R.row({ id: 'acne-2', c: 'acne', n: 'Батганы багц <эмчилгээ>', d: 'Товч', t: '1 цаг', p: '₮249,000-с',
    v: [{ n: 'Багц 1', t: '1 цаг', p: '₮249,000', d: '3 удаа' }, { n: 'Багц 2', t: '', p: '', d: '' }, { n: '' }, null] }, cats, { pages: { 'acne-2': '/emchilgee/batga' } });
  assert.match(multi, /^<div class="row row--multi" tabindex="-1" data-c="acne" id="t-acne-2">/);
  assert.match(multi, /<summary>2 сонголт — үнэ, тайлбар<\/summary>/);
  assert.match(multi, /<strong>Багц 1<\/strong><span>⏱ 1 цаг · ₮249,000<\/span>/);
  assert.match(multi, /<span class="row__var-d">3 удаа<\/span>/);
  assert.match(multi, /<a class="row__link" href="\/emchilgee\/batga">Дэлгэрэнгүй →<\/a>/);
  assert.ok(multi.includes('Батганы багц &lt;эмчилгээ&gt;'), 'escape');
  assert.ok(!/<a[^>]*>[^]*<details/.test(multi.replace(/<a class="row__link"[^]*$/, '')), 'details нь <a> дотор биш');
});

test('Messenger каталог: хувилбар бүрийн үнэ зөвшөөрөгдсөн дүнд, текстэд сонголтууд', async () => {
  const { knowledgeInput } = await import('../../api/_lib/knowledge.js');
  const { buildSocialCatalog } = await import('../../api/_lib/social/catalog-safe.js');
  const input = knowledgeInput({}, { services: [{ id: 'acne-2', c: 'acne', n: 'Батганы багц эмчилгээ', d: 'Товч', t: '1 цаг', p: '₮249,000-с', hidden: false,
    v: [{ n: 'Батганы багц 1', t: '1 цаг', p: '₮249,000', d: '3 удаа' }, { n: 'Батганы багц 2', t: '1 цаг', p: '₮349,000', d: '5 удаа' }] }], packages: [] });
  const cat = buildSocialCatalog(input);
  const f = cat.facts.find((x) => x.id === 'service:acne-2');
  assert.match(f.text, /сонголтууд: Батганы багц 1, 1 цаг, ₮249,000, 3 удаа; Батганы багц 2, 1 цаг, ₮349,000, 5 удаа/);
  assert.ok(cat.allowedAmounts.includes(349000));
});

test('applyUbCatalog: Firestore-ийн эрэмбэлсэн түлхүүртэй (d,n,p,t) хувилбар өөрчлөлтгүй гэж тооцогдоно', () => {
  const [a1, a2] = UB_LINKS['acne-2'];
  const ub = parseUbServices(ubJson({ [a1]: { name: 'Б1', description: 'x', duration_min: 60, price: 1000, price_hidden: false },
    [a2]: { name: 'Б2', description: 'y', duration_min: 60, price: 2000, price_hidden: false } }));
  const rows = TREATMENTS.map((t) => ({ ...t, hidden: false }));
  const first = applyUbCatalog(rows, ub).services;
  // Firestore-оос уншсан хэлбэр: map-ийн түлхүүр цагаан толгойн дарааллаар
  const sorted = first.map((r) => (r.v ? { ...r, v: r.v.map((x) => Object.fromEntries(Object.entries(x).sort(([k1], [k2]) => k1.localeCompare(k2)))) } : r));
  assert.deepEqual(Object.keys(sorted.find((r) => r.id === 'acne-2').v[0]), ['d', 'n', 'p', 't']);
  assert.deepEqual(applyUbCatalog(sorted, ub).changed, []);
});

test('applyUbCatalog: тайлбар — UB-ээс ирсэн (ubD), UB арилгавал хоосон, UB-д хэзээ ч байгаагүй бол сайтынх', () => {
  const withD = parseUbServices(ubJson({ [EXAM]: { name: 'Ү', description: 'UB текст', duration_min: 30, price: 1, price_hidden: false } }));
  const noD = parseUbServices(ubJson({ [EXAM]: { name: 'Ү', description: '', duration_min: 30, price: 1, price_hidden: false } }));
  const others = TREATMENTS.filter((t) => t.id !== 'exam-1').map((t) => ({ ...t, hidden: false }));
  const pick = (r) => r.services.find((x) => x.id === 'exam-1');
  const row = { id: 'exam-1', c: 'exam', n: 'Ү', d: 'сайтын текст', t: '', p: '', hidden: false };
  // UB-д хэзээ ч тайлбаргүй → сайтынх, ubD-гүй (admin засна)
  const never = pick(applyUbCatalog([row, ...others], noD));
  assert.equal(never.d, 'сайтын текст'); assert.equal('ubD' in never, false);
  // UB-ээс ирсэн → ubD
  const fromUb = pick(applyUbCatalog([row, ...others], withD));
  assert.equal(fromUb.d, 'UB текст'); assert.equal(fromUb.ubD, true);
  // UB тайлбараа арилгасан → хоосон (хуучин UB текст үлдэхгүй), changed
  const cleared = applyUbCatalog([fromUb, ...others], noD);
  assert.equal(pick(cleared).d, ''); assert.equal('ubD' in pick(cleared), false);
  assert.ok(cleared.changed.includes('exam-1'));
  // UB-д түр идэвхгүй → тайлбар, ubD хадгалагдана
  const off = pick(applyUbCatalog([fromUb, ...others], parseUbServices(ubJson({}, [EXAM]))));
  assert.equal(off.d, 'UB текст'); assert.equal(off.ubD, true); assert.equal(off.hidden, true);
  // холбоо тасарвал ubD цэвэрлэгдэнэ
  const unl = applyUbCatalog([{ ...fromUb, id: 'inject-7' }, ...others], withD).services[0];
  assert.equal('ubD' in unl, false);
});

test('adminPriceOf: нуусан үнийг зөвхөн admin-д текст болгоно; сайтын p хоосон хэвээр', async () => {
  const { adminPriceOf, ubFields } = await import('../../assets/js/ub-catalog.js');
  const a = '6f1c2a10-0000-4000-8000-00000000000a', b = '6f1c2a10-0000-4000-8000-00000000000b';
  const ub = new Map([
    [a, { id: a, duration: 30, price: 80000, priceMax: null, priceHidden: true }],
    [b, { id: b, duration: 30, price: 44000, priceMax: null, priceHidden: false }],
  ]);
  assert.deepEqual(adminPriceOf([a], ub), { text: '₮80,000', hidden: true });
  assert.deepEqual(adminPriceOf([a, b], ub), { text: '₮44,000-с', hidden: true });
  assert.deepEqual(adminPriceOf([b], ub), { text: '₮44,000', hidden: false });
  assert.deepEqual(adminPriceOf(['missing'], ub), { text: '', hidden: false });
  assert.equal(ubFields([a], ub).p, '', 'сайтын каталогт нуусан үнэ бичигдэхгүй');
});

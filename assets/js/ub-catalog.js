/* ==========================================================================
   SKIN AID — ub-catalog.js (ES module, цэвэр — import-гүй)
   Үйлчилгээний үнэ, хугацааны ЦОРЫН ГАНЦ эх = UB Beauty (os.ubbeauty.mn → Тохиргоо → Үйлчилгээ).
   Сайтын «Онцлох эмчилгээ» мөр бүрийг UB Beauty-ийн нэг эсвэл хэд хэдэн үйлчилгээтэй холбоно (UB_LINKS).
   Холбоотой мөрийн хугацаа (t), үнэ (p), «UB Beauty-д идэвхгүй» (ubOff)-ийг энэ модуль UB Beauty-ийн
   `/api/v1/web/services`-ээс тооцно — admin дээр гараар засахгүй (түгжээтэй). Тайлбар (2026-11-27 эзэмшигч):
   ганц үйлчилгээтэй мөрийн d = UB Beauty-ийн тайлбар; олон үйлчилгээтэй мөрийн d сайтынх (бүлгийн товч), харин
   v = UB Beauty-ийн хувилбар бүр { n, t, p, d } (сайт «N сонголт» дэлгэж харуулна, бот хувилбар бүрийн үнийг мэднэ).
   2026-11-27 эзэмшигч: сайтын «Онцлох эмчилгээ» = UB Beauty-ийн жагсаалттай ЯГ ИЖИЛ (толь): мөр бүр UB Beauty-ийн
   НЭГ үйлчилгээ; нэр (n), ангилал (c, UB-ийн «01.»…«11.» дугаараар → UB_CATS), дараалал UB Beauty-ийнх. UB Beauty-д
   шинээр нэмэгдсэн үйлчилгээ `ub-<uuid-ийн эхний 8>` id-тай мөр болж автоматаар нэмэгдэнэ; RETIRED_IDS (UB-д байхгүй
   хуучин сайтын мөр) хасагдана. «Сайтаас нуух» (hiddenSite) сайтынх хэвээр.

   Хэрэглэгч: admin/m-catalog.js (хөтөч, pk түлхүүр), api/_lib/ub-catalog-sync.js (сервер, sk түлхүүр, өдөр бүр).
   Firestore `settings/catalog`-ийн мөр: { id, c, n, d, t, p, hidden, hiddenSite, ub?, ubOff?, ubD?, v? } — ubD = d нь UB-ээс,
   hidden = hiddenSite || ubOff (сайт, build, Messenger бот зөвхөн `hidden`-ийг уншина).
   Тест: tools/test/ub-catalog.test.mjs
   ========================================================================== */

/** Сайтын мөрийн id → UB Beauty-ийн үйлчилгээний id (1:1, UB Beauty-ийн дарааллаар; 2026-11-27 толь болгосон).
 *  Хуучин id-ууд (exam-1, acne-2 …) хадгалагдсан — эмчилгээний хуудас (content/pipeline.mjs) тэдгээрийг заадаг. */
export const UB_LINKS = Object.freeze({
  "exam-1": ["af5e4f62-7ea0-4410-8c15-652c73c50f9e"],
  "exam-3": ["2c5f59c7-b86d-4998-a706-c69b2ac85f22"],
  "exam-2": ["5f509da3-4d3e-4c5d-adb5-9346156a5756"],
  "glow-2": ["3c544fe7-553f-44e7-9f0a-9cc452369beb"],
  "acne-2": ["49edad76-c4d5-434b-807e-ac585ee2af24"],
  "ub-cdce1283": ["cdce1283-1086-4fdd-8eac-7e368f621bb9"],
  "acne-4": ["04de9dd6-d27c-4f8d-b0f2-c77a2a378baa"],
  "acne-5": ["8cf68c78-22f5-49d1-95c0-dce54f2030b3"],
  "massage-3": ["a50b0c9f-4ed1-42df-ba85-ba982bcf5a1e"],
  "acne-1": ["203b005d-566b-4678-9414-7af6a310c7db"],
  "ub-b01a2fcf": ["b01a2fcf-8f24-42c5-bba6-710c512d4e28"],
  "acne-3": ["8c25ceb8-4926-4650-b410-33007a5724c5"],
  "ub-e20aa0f5": ["e20aa0f5-bc45-4a9b-8994-4948ff5b4556"],
  "scar-1": ["13b671d7-b21a-4e7c-aba1-dc044fcc1a65"],
  "scar-3": ["f07fb6f3-b20a-406c-ac26-53833fe6cf06"],
  "glow-3": ["78e9a369-d667-473c-a8e3-f39a88665398"],
  "scar-2": ["16eb39fe-82a4-42b3-8e5d-2560f085cc99"],
  "inject-4": ["2f3e7b99-86b9-44b0-bcaf-d69db5aa678a"],
  "inject-2": ["ad2c98a7-1b52-4154-acc3-bfa8ae3a29a2"],
  "inject-8": ["e792ef04-f02d-4831-af7e-a2e61d91389d"],
  "inject-9": ["313943ff-b7cb-43be-9f2b-8a631be8fa91"],
  "ub-a8f3dc6c": ["a8f3dc6c-09e0-43be-bfd4-e472dfa36225"],
  "inject-3": ["0f85e5fe-2b3b-4842-a1f4-ac09be7ef8ce"],
  "ub-5d5babeb": ["5d5babeb-2183-41e6-a33b-4c4ea91f1a2e"],
  "ub-e6c057e6": ["e6c057e6-e1f9-4657-824c-0279d389db8a"],
  "anti-2": ["5fde66a0-8ebe-471c-8725-c93c9f68c4db"],
  "anti-1": ["83725e55-5076-4b1d-910b-8966d150af4a"],
  "lift-3": ["2c7a1209-8809-451b-9db4-ab21f6fbd772"],
  "anti-3": ["353acf1f-191d-41a2-a6a9-07916552854d"],
  "ub-59dcae56": ["59dcae56-14b6-4a46-b88a-3741f4ac4435"],
  "ub-5b8e93b2": ["5b8e93b2-4be1-4232-8e27-d0dcc967af9e"],
  "minor-3": ["8667c956-4e8e-464d-9de9-f2cd7f00e269"],
  "ub-d9de66bc": ["d9de66bc-dead-4e25-b5b0-54f2f72aaf1f"],
  "anti-5": ["f79c2201-ac9b-4c39-897f-e3f815d48f42"],
  "ub-ae2ae2d0": ["ae2ae2d0-75bd-4ccd-9acb-344c232ed129"],
  "lift-2": ["74bbf909-c048-4389-94a4-73398b92644f"],
  "anti-4": ["55052abb-43f7-4637-8b6e-b8b93990848a"],
  "ub-012601d8": ["012601d8-d7e6-46ae-8fa7-a683533296a7"],
  "laser-1": ["de07a74c-ceca-445c-b552-84acae1db92b"],
  "ub-658d61e1": ["658d61e1-dcfc-4551-9c4e-f52238870f5c"],
  "ub-5698a797": ["5698a797-19ce-41e1-9101-ddf51e520216"],
  "ub-f85bb41c": ["f85bb41c-88d2-4e7a-a987-7d424ad2160a"],
  "ub-ea4037d0": ["ea4037d0-1594-42c5-a5a2-a945060890ff"],
  "ub-f97ea660": ["f97ea660-3a8e-455c-a7af-db94512db053"],
  "ub-ae428dee": ["ae428dee-80d1-47ec-bf60-dca194f27c4d"],
  "ub-49369da7": ["49369da7-9e29-452c-8a82-617d852bb3aa"],
  "ub-3bb3e4c9": ["3bb3e4c9-7e83-476e-88f0-ca153caa8313"],
  "ub-9bae0aaa": ["9bae0aaa-982d-42b8-9146-da07a5c000c4"],
  "ub-b0d33383": ["b0d33383-f0f5-4d4d-98d3-a0d11bfeabbb"],
  "ub-fc90ab96": ["fc90ab96-af3a-4dbb-9c37-700d13322d52"],
  "ub-a0c53855": ["a0c53855-3e54-4d92-a6a8-50feebe7e4e4"],
  "ub-69a3713b": ["69a3713b-b05e-455a-b7a8-fbfb06a4a675"],
  "ub-3235ebb8": ["3235ebb8-e271-41cc-80ef-5fdfbecb28a8"],
  "ub-093b39fc": ["093b39fc-2f27-4609-a5e7-3bcd54237533"],
  "glow-5": ["4041a3e7-411f-4993-9416-815c70f1490b"],
  "ub-c6abac94": ["c6abac94-64f7-456f-8975-605786b0ed73"],
  "iv-3": ["740ef24f-9fa8-49de-a323-1b778ab74381"],
  "iv-4": ["7a87e4fb-16c1-4037-b974-610bb16343fe"],
  "ub-cbe29cce": ["cbe29cce-245b-4a17-8cbb-13759f25ff61"],
  "iv-1": ["3ddcacea-2b00-4346-94e4-b8277fbbcdca"],
  "ub-3a6b7fcb": ["3a6b7fcb-63bb-4054-ac1b-3280019e0ec2"],
  "ub-d0937f35": ["d0937f35-e436-4e7d-9ddb-217389911980"],
  "ub-8b8cc6aa": ["8b8cc6aa-04e9-48b5-856c-42d50e8421d8"],
  "ub-da16a3e2": ["da16a3e2-c562-4d56-bd84-edcfc8fc717b"],
  "glow-1": ["d04362cc-c712-4a74-b849-1fb0cba40aa7"],
  "ub-d3f975e6": ["d3f975e6-2bc4-44ff-be34-69f109b72d99"],
  "massage-1": ["75125ed5-1df5-4b20-b4f7-c687b347744c"],
  "ub-e012c0db": ["e012c0db-6524-404d-aee4-a29e7e311962"],
  "glow-4": ["57df89f3-37e6-4fbd-b41d-ea1fb61b1028"],
  "massage-4": ["9db9e32f-e35f-4f45-8ee8-363de5d80325"],
  "scar-4": ["9aa9920f-9530-4b2d-94e4-bb4566258362"],
  "scar-5": ["18eb415c-9649-489e-8aa2-aa957eb13242"],
  "minor-2": ["768fafc5-e2f9-488a-a5cc-54d54447accc"],
  "minor-1": ["dc50ad2a-f8dd-452d-8520-6f6ee7dff2dd"],
});

/** UB Beauty-ийн ангиллын дугаар («01. …») → сайтын ангиллын түлхүүр (catalog-defaults.js cats) */
export const UB_CATS = Object.freeze({ '01': 'exam', '02': 'acne', '03': 'scar', '04': 'glow', '05': 'inject', '06': 'anti',
  '07': 'lift', '08': 'laser', '09': 'iv', '10': 'massage', '11': 'minor' });
export const ubCatKey = (category) => UB_CATS[String(category || '').trim().slice(0, 2)] || '';

/** UB Beauty-д байхгүй тул 2026-11-27-нд сайтаас хассан хуучин мөрүүд (Firestore-д үлдсэн бол синк хасна) */
export const RETIRED_IDS = Object.freeze(['inject-1', 'inject-5', 'inject-6', 'inject-7', 'laser-2', 'laser-3', 'laser-4', 'iv-2', 'massage-2']);

/** Мөрийн UB Beauty-ийн id-ууд: статик UB_LINKS, эсвэл автоматаар нэмэгдсэн `ub-xxxxxxxx` мөрийн хадгалсан `ub` */
const AUTO_ID = /^ub-[0-9a-f]{8}$/;
export function ubLinkIds(row, links = UB_LINKS) {
  if (!row || typeof row.id !== 'string') return null;
  if (links[row.id]) return links[row.id];
  return AUTO_ID.test(row.id) && Array.isArray(row.ub) && row.ub.length === 1 && UUID.test(row.ub[0]) ? [row.ub[0].toLowerCase()] : null;
}

/**
 * Хамгаалалт: UB Beauty-ийн жагсаалтад холбоотой id-уудын энэ хувиас бага нь ирвэл (түлхүүр буруу, эмнэлэг
 * түр хаагдсан, API алдаа) шинэчлэлийг ЗОГСООНО — сайтын бүх мөрийг андуурч нуухгүйн тулд.
 */
export const MIN_PRESENT_SHARE = 0.5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (n) => '₮' + Math.round(n).toLocaleString('en-US');
const posInt = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
const oneLine = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** Тайлбарын дээд урт (admin, Firestore мөр) */
export const DESC_MAX = 1000;
/** Нэг үйлчилгээний нийтийн үнийн текст: «₮50,000», хэлбэлзэлтэй бол «₮80,000-с», нуусан бол '' */
const priceOf = (s) => (s.priceHidden || !s.price ? '' : money(s.price) + (s.priceMax && s.priceMax > s.price ? '-с' : ''));

/** 30 → «30 мин», 60 → «1 цаг», 90 → «1 цаг 30 мин» */
export function formatDuration(min) {
  const m = posInt(min);
  if (!m) return '';
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} цаг ${r} мин` : `${h} цаг`;
}

/**
 * `/api/v1/web/services`-ийн хариу → Map(id → { id, duration, price, priceMax, priceHidden }).
 * Буруу хэлбэртэй мөрийг алгасна. Хариу өөрөө буруу бол null.
 */
export function parseUbServices(json) {
  const list = json && Array.isArray(json.services) ? json.services : null;
  if (!list) return null;
  const out = new Map();
  for (const s of list) {
    if (!s || typeof s.id !== 'string' || !UUID.test(s.id)) continue;
    out.set(s.id.toLowerCase(), {
      id: s.id.toLowerCase(),
      order: out.size,
      category: oneLine(s.category, 120),
      name: oneLine(s.name, 120),
      description: oneLine(s.description, DESC_MAX),
      duration: posInt(s.duration_min),
      price: posInt(s.price),
      priceMax: posInt(s.price_max),
      // fail-closed: UB Beauty үнэ нууснаа тодорхой хэлээгүй ч үнэ ирээгүй бол нуусан гэж үзнэ
      priceHidden: s.price_hidden === true || posInt(s.price) === null,
      // Нуусан үнэ — ЗӨВХӨН нууц (sk) түлхүүрийн хариунд (сервер). Нийтэд хэзээ ч бичихгүй: hiddenPrices → admin_private
      internalPrice: posInt(s.internal_price),
      internalPriceMax: posInt(s.internal_price_max),
    });
  }
  return out;
}

/**
 * Нэг сайтын мөрийн UB Beauty-ээс гарах талбарууд.
 *  - off: холбоотой үйлчилгээний НЭГ Ч UB Beauty-д идэвхтэй/захиалж болохоор байхгүй → сайтаас нуугдана
 *  - p: бүх (идэвхтэй) үйлчилгээний үнэ нийтэд ил үед л. Ганц үйлчилгээ, дээд үнэгүй → «₮50,000»;
 *       эс бөгөөс хамгийн бага үнэ «₮44,000-с». Аль нэг нь нуусан бол хоосон (нуусан нь хамгийн хямд байж болзошгүй).
 *  - t: ганц хугацаа → «30 мин»; ялгаатай бол «15–90 мин»
 *  - d: ганц үйлчилгээтэй мөрөнд UB Beauty-ийн тайлбар (хоосон бол null — сайтынх хэвээр); олон бол null
 *  - v: олон үйлчилгээтэй мөрөнд идэвхтэй хувилбар бүр { n, t, p, d } (UB_LINKS-ийн дарааллаар); ганц бол null
 * @param {readonly string[]} ids
 * @param {Map<string, {duration: number|null, price: number|null, priceMax: number|null, priceHidden: boolean}>} ub
 */
export function ubFields(ids, ub) {
  const present = ids.map((id) => ub.get(id.toLowerCase())).filter(Boolean);
  const missing = ids.filter((id) => !ub.has(id.toLowerCase()));
  if (!present.length) return { off: true, t: '', p: '', d: null, v: null, missing };
  const mins = [...new Set(present.map((s) => s.duration).filter(Boolean))].sort((a, b) => a - b);
  const t = !mins.length ? '' : mins.length === 1 ? formatDuration(mins[0]) : `${mins[0]}–${mins[mins.length - 1]} мин`;
  let p = '';
  if (present.every((s) => !s.priceHidden && s.price)) {
    const single = present.length === 1 && !(present[0].priceMax && present[0].priceMax > present[0].price);
    p = single ? money(present[0].price) : money(Math.min(...present.map((s) => s.price))) + '-с';
  }
  const multi = ids.length > 1;
  const d = !multi && present[0].description ? present[0].description : null;
  const v = multi ? present.map((s) => ({ n: s.name, t: formatDuration(s.duration), p: priceOf(s), d: s.description })) : null;
  return { off: false, t, p, d, v, missing };
}

/**
 * Админд л: нийтэд нуусан үнэтэй холбоотой мөрийн жинхэнэ үнэ — { мөрийн id: '₮80,000' | '₮44,000-с' }.
 * UB Beauty-ийн нууц (sk) түлхүүрийн `internal_price` шаардана (нийтийн түлхүүрээр хоосон). Үр дүнг ЗӨВХӨН
 * `admin_private/ub_prices` (admin уншина, сайт уншдаггүй) — `settings/catalog` руу хэзээ ч бичихгүй.
 * @param {readonly object[]} services
 * @param {Map<string, object>} ub
 * @param {Readonly<Record<string, readonly string[]>>} [links]
 * @returns {Record<string, string>}
 */
export function hiddenPrices(services, ub, links = UB_LINKS) {
  const out = {};
  for (const r of Array.isArray(services) ? services : []) {
    const ids = ubLinkIds(r, links);
    if (!ids) continue;
    const present = ids.map((id) => ub.get(id.toLowerCase())).filter(Boolean);
    if (!present.length || !present.some((s) => s.priceHidden)) continue;
    const priceOfRow = (s) => (s.priceHidden ? s.internalPrice : s.price);
    const maxOfRow = (s) => (s.priceHidden ? s.internalPriceMax : s.priceMax);
    const prices = present.map(priceOfRow);
    if (prices.some((p) => !p)) continue;
    const single = present.length === 1 && !(maxOfRow(present[0]) && maxOfRow(present[0]) > prices[0]);
    out[r.id] = single ? money(prices[0]) : money(Math.min(...prices)) + '-с';
  }
  return out;
}

/** Хувилбаруудын харьцуулах тамга — талбар бүрээр (Firestore map-ийн түлхүүрийг эрэмбэлж буцаадаг тул JSON дараалал зөрнө) */
const vSig = (v) => JSON.stringify((Array.isArray(v) ? v : []).map((x) => [x?.n ?? '', x?.t ?? '', x?.p ?? '', x?.d ?? '']));

/** Мөрийн сайтын «Нуух» сонголт (хуучин баримтад hiddenSite байхгүй — тэр үед hidden нь гараар нуусан) */
export const siteHidden = (row) => (typeof row?.hiddenSite === 'boolean' ? row.hiddenSite : row?.hidden === true);

/**
 * Каталогийн мөрүүдэд UB Beauty-ийн утгыг тавина (цэвэр — оролтыг өөрчлөхгүй).
 * Холбоогүй мөр: t, p хэвээр, ub/ubOff талбаргүй, hidden = hiddenSite.
 * @param {readonly object[]} services  settings/catalog.services
 * @param {Map<string, object>} ub  parseUbServices-ийн үр дүн
 * @param {Readonly<Record<string, readonly string[]>>} [links]
 * @returns {{ ok: true, services: object[], changed: string[], report: { linked: number, unlinked: string[], off: string[],
 *   missing: string[], unused: string[] } } | { ok: false, reason: 'ub_empty'|'ub_mismatch', present: number, expected: number }}
 */
export function applyUbCatalog(services, ub, links = UB_LINKS) {
  const all = Array.isArray(services) ? services : [];
  const removed = all.filter((r) => RETIRED_IDS.includes(r?.id)).map((r) => r.id);
  const rows = all.filter((r) => !RETIRED_IDS.includes(r?.id));
  const linkedIds = new Set();
  for (const r of rows) for (const id of ubLinkIds(r, links) || []) linkedIds.add(id.toLowerCase());
  const presentCount = [...linkedIds].filter((id) => ub.has(id)).length;
  if (!ub.size) return { ok: false, reason: 'ub_empty', present: 0, expected: linkedIds.size };
  if (linkedIds.size && presentCount / linkedIds.size < MIN_PRESENT_SHARE) {
    return { ok: false, reason: 'ub_mismatch', present: presentCount, expected: linkedIds.size };
  }
  const changed = [...removed], unlinked = [], off = [], missing = [], added = [];
  const mapped = rows.map((r) => {
    const ids = ubLinkIds(r, links);
    const hiddenSite = siteHidden(r);
    if (!ids) {
      unlinked.push(r?.id);
      const { ub: _u, ubOff: _o, v: _v, ubD: _d, ...rest } = r || {};
      return { ...rest, hiddenSite, hidden: hiddenSite };
    }
    const f = ubFields(ids, ub);
    if (f.off) off.push(r.id);
    missing.push(...f.missing);
    const { v: _v, ubD: _d, ...base } = r;
    // d: UB-ийн тайлбар байвал тэр (ubD = true — admin түгжинэ). UB тайлбараа арилгасан бол (өмнө нь UB-ээс ирсэн) хоосон;
    // UB-д хэзээ ч тайлбаргүй бол сайтынх (admin засна). Олон хувилбартай мөрөнд үргэлж сайтынх.
    const prevD = typeof r.d === 'string' ? r.d : '';
    const d = f.d ?? (f.off ? prevD : r.ubD === true ? '' : prevD);
    // Толь: ганц үйлчилгээтэй мөрийн нэр, ангилал = UB Beauty-ийнх (идэвхгүй болсон бол сүүлийнх хэвээр)
    const one = ids.length === 1 ? ub.get(ids[0].toLowerCase()) : null;
    const n = one && one.name ? one.name : r.n;
    const c = (one && ubCatKey(one.category)) || r.c;
    const next = { ...base, n, c, t: f.t, p: f.p, d, hiddenSite, ub: [...ids], ubOff: f.off, hidden: hiddenSite || f.off };
    if (f.d) next.ubD = true;
    else if (f.off && r.ubD === true) next.ubD = true;   // түр идэвхгүй — UB-ийн тайлбарыг хадгална
    if (f.v && f.v.length) next.v = f.v;
    if (next.t !== r.t || next.p !== r.p || next.d !== r.d || next.n !== r.n || next.c !== r.c || next.hidden !== r.hidden
      || r.ubOff !== f.off || (next.ubD === true) !== (r.ubD === true) || vSig(next.v) !== vSig(r.v)) changed.push(r.id);
    return next;
  });
  // UB Beauty-д шинээр нэмэгдсэн (аль ч мөртэй холбоогүй) үйлчилгээ → автомат мөр
  // id: статик холбоосын эзэн (мөрийг хассан/дутуу каталог → анхны id-аараа буцна), эс бөгөөс `ub-xxxxxxxx`
  const ownerOf = new Map();
  for (const [sid, ids] of Object.entries(links)) if (ids.length === 1) ownerOf.set(ids[0].toLowerCase(), sid);
  const taken = new Set(mapped.map((r) => r?.id));
  for (const s of ub.values()) {
    if (linkedIds.has(s.id)) continue;
    const owner = ownerOf.get(s.id);
    const id = owner || 'ub-' + s.id.slice(0, 8);
    if (taken.has(id) || (!owner && !ubCatKey(s.category))) continue;   // ангилалгүй шинэ үйлчилгээг алгасна
    taken.add(id);
    const f = ubFields([s.id], ub);
    const row = { id, c: ubCatKey(s.category) || 'minor', n: s.name, d: f.d || '', t: f.t, p: f.p, hiddenSite: false, ub: [s.id], ubOff: false, hidden: false };
    if (f.d) row.ubD = true;
    mapped.push(row);
    added.push(id);
    changed.push(id);
  }
  // Дараалал = UB Beauty-ийнх; UB-д алга (идэвхгүй) болон холбоогүй мөр төгсгөлд өмнөх дарааллаараа
  const rank = (r) => {
    const ids = ubLinkIds(r, links);
    const hit = ids && ids.map((id) => ub.get(id.toLowerCase())).find(Boolean);
    return hit ? hit.order : Infinity;
  };
  const out = mapped.map((r, i) => [r, rank(r), i]).sort((x, y) => (x[1] - y[1]) || (x[2] - y[2])).map((x) => x[0]);
  if (!changed.length && out.some((r, i) => r?.id !== rows[i]?.id)) changed.push(out[0].id);   // зөвхөн дараалал өөрчлөгдсөн
  const addedUb = new Set(out.filter((r) => added.includes(r.id)).flatMap((r) => r.ub));
  const unused = [...ub.keys()].filter((id) => !linkedIds.has(id) && !addedUb.has(id));
  return { ok: true, services: out, changed, report: { linked: rows.length - unlinked.length, unlinked, off, missing, unused, added, removed } };
}

/**
 * UB Beauty-ийн үйлчилгээний жагсаалтыг татна. key = pk (хөтөч, Origin-оор хамгаалагдсан) эсвэл sk (сервер).
 * @returns {Promise<Map<string, object>>}
 */
export async function fetchUbServices({ apiBase, key, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!apiBase || !key) throw new Error('ub_not_configured');
  const res = await fetchImpl(apiBase.replace(/\/+$/, '') + '/services', {
    headers: { 'X-Api-Key': key, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ub_http_${res.status}`);
  const map = parseUbServices(await res.json());
  if (!map) throw new Error('ub_bad_response');
  return map;
}

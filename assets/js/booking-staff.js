/* ==========================================================================
   SKIN AID — booking-staff.js (ES module, ЦЭВЭР — DOM-гүй; tools/test/booking-staff.test.mjs)
   Онлайн захиалгын «Эмч / Гоо засалч / Мэргэжилтэн» сонголтын дүрэм (booking.js ашиглана).

   Эх сурвалж = UB Beauty OS «Тохиргоо → Үйлчилгээ → Үзүүлэх ажилтан» (0167). Сайт үйлчилгээ бүрд
   `GET /doctors?service_id=`-г дуудна (UB Beauty репо docs/API-WEB-CHANNEL.md §2.1):
   - Тохируулаагүй үйлчилгээ = захиалга авдаг БҮХ ажилтан. API энэ ялгааг тусад нь өгдөггүй тул жагсаалт
     шүүлтгүй `/doctors`-ийн бүх хүнийг агуулж байвал «тохируулаагүй» гэж үзэж өмнөх түр дүрмийг хэрэглэнэ:
     ресепшн, менежерийг нууж (өөр хүн үлдэх бол), эмч → гоо засалч → массаж → сувилагч дарааллаар.
   - Тохируулсан (жагсаалтад хэн нэг нь дутуу) = эмнэлгийн сонголт → яг тэр хүмүүс (ресепшн сонгосон бол ч),
     мөн дараалал. «Аль нь ч болно» үед нэг цагт хэд хэдэн хүн сул бол энэ дарааллаар эхнийх нь авна.
   ========================================================================== */

export const ROLE_ORDER = ['doctor', 'cosmetologist', 'massage', 'nurse'];
export const NON_PROVIDER = new Set(['receptionist', 'manager']);

// Шошго: noun = гарчиг («Эмч»), lower = өгүүлбэр дотор («эмч»), gen = харьяалахын тийн ялгал («эмчийн»).
// «Гоо засалч» = SkinAid-ийн OS дахь албан тушаал, сайтын текст (UB Beauty-ийн үүргийн нэр «Гоо сайханч»).
const WORDS = {
  doctor: { noun: 'Эмч', lower: 'эмч', gen: 'эмчийн' },
  cosmetologist: { noun: 'Гоо засалч', lower: 'гоо засалч', gen: 'гоо засалчийн' },
  massage: { noun: 'Массажист', lower: 'массажист', gen: 'массажистын' },
  nurse: { noun: 'Сувилагч', lower: 'сувилагч', gen: 'сувилагчийн' },
};
const GENERIC = { noun: 'Мэргэжилтэн', lower: 'мэргэжилтэн', gen: 'мэргэжилтний' };

const key = (id) => String(id).toLowerCase();   // UUID: DB жижиг үсэг, гэхдээ тулгахдаа үл хамаарна

/** API-ийн `doctors` массиваас хүчинтэй мөрүүд (id заавал), давхардалгүй, ирсэн дарааллаар */
export function cleanStaff(list) {
  const seen = new Set();
  const out = [];
  (Array.isArray(list) ? list : []).forEach((d) => {
    if (!d || typeof d.id !== 'string' || !d.id || seen.has(key(d.id))) return;
    seen.add(key(d.id));
    out.push(d);
  });
  return out;
}

/** Үүргээр тогтвортой эрэмбэлнэ (ROLE_ORDER, бусад нь сүүлд; нэг үүрэг дотор API-ийн sort_order хэвээр) */
export function sortByRole(staff) {
  const rank = (d) => { const i = ROLE_ORDER.indexOf(d.staff_role); return i < 0 ? ROLE_ORDER.length : i; };
  return staff.map((d, i) => ({ d, i })).sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i).map((x) => x.d);
}

/**
 * Үйлчилгээний мэргэжилтнүүд.
 * @param list `/doctors?service_id=`-ийн `doctors` (цэвэрлэсэн)
 * @param all  шүүлтгүй `/doctors`-ийн `doctors` (цэвэрлэсэн) — «тохируулаагүй» илрүүлэх суурь
 * @returns {{ staff: object[], configured: boolean }}
 */
export function providersFor(list, all) {
  const have = new Set(list.map((d) => key(d.id)));
  const configured = all.length > 0 && all.some((d) => !have.has(key(d.id)));
  if (configured) return { staff: sortByRole(list), configured: true };
  const providers = list.filter((d) => !NON_PROVIDER.has(d.staff_role));
  return { staff: sortByRole(providers.length ? providers : list), configured: false };
}

/** Жагсаалтын шошго: бүгд нэг үүрэгтэй бол тэр үүргийн нэр, холимог/тодорхойгүй бол «Мэргэжилтэн» */
export function roleWords(staff) {
  const roles = new Set((staff || []).map((d) => d && d.staff_role));
  if (roles.size === 1) {
    const [r] = roles;
    if (WORDS[r]) return WORDS[r];
  }
  return GENERIC;
}

/** Нэг хүний шошго (баримтын «Эмч: …» мөр гэх мэт) */
export const personWords = (d) => roleWords(d ? [d] : []);

/**
 * Үйлчилгээ солиход өмнөх сонголт: тэр хүн шинэ үйлчилгээг бас хийдэг бол хадгална, эс бөгөөс «any».
 * Ганц хүнтэй бол тэр хүн. Хоосон бол null.
 */
export function keepChoice(prev, staff) {
  if (!staff.length) return null;
  if (staff.length === 1) return staff[0].id;
  if (prev && prev !== 'any' && staff.some((d) => key(d.id) === key(prev))) return staff.find((d) => key(d.id) === key(prev)).id;
  return 'any';
}

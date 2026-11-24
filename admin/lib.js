/* ==========================================================================
   SKIN AID admin — lib.js: DOM, Firebase-гүй цэвэр функцүүд (node --test-ээр шалгагдана: tools/test/admin-lib.test.mjs)
   Цаг бүсийг Asia/Ulaanbaatar-аар тооцно (эмнэлгийн цаг; хөтчийн цагийн бүсээс үл хамаарна).
   ========================================================================== */
const TZ = 'Asia/Ulaanbaatar';

// Intl.DateTimeFormat үүсгэх нь үнэтэй — нэг удаа (900 мөрт render бүрт олон мянгаар дуудагдана)
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const HM_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
/** ms → 'YYYY-MM-DD' (Улаанбаатарын цагаар) */
export function dayKey(ms) { return DAY_FMT.format(new Date(ms)); }
const dayIndex = (key) => Math.round(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 864e5);
const hhmm = (ms) => HM_FMT.format(new Date(ms));

/**
 * Захиалгын жагсаалтын бүлэг: today | yesterday | week (сүүлийн 7 хоног) | older.
 * @returns {{ key: string, label: string }}
 */
export function dayGroup(ms, now = Date.now()) {
  const d = dayIndex(dayKey(now)) - dayIndex(dayKey(ms));
  if (d <= 0) return { key: 'today', label: 'Өнөөдөр' };
  if (d === 1) return { key: 'yesterday', label: 'Өчигдөр' };
  if (d < 7) return { key: 'week', label: 'Сүүлийн 7 хоногт' };
  return { key: 'older', label: 'Өмнөх' };
}
export const GROUP_ORDER = ['today', 'yesterday', 'week', 'older'];

/** «дөнгөж сая», «5 мин өмнө», «3 цагийн өмнө», «өчигдөр 14:05», «11-20 14:05», «2025-12-31» */
export function relTime(ms, now = Date.now()) {
  if (!ms) return '—';
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return 'дөнгөж сая';
  if (s < 3600) return `${Math.floor(s / 60)} мин өмнө`;
  const d = dayIndex(dayKey(now)) - dayIndex(dayKey(ms));
  if (d === 0) return `${Math.floor(s / 3600)} цагийн өмнө`;
  if (d === 1) return `өчигдөр ${hhmm(ms)}`;
  const key = dayKey(ms);
  return key.slice(0, 4) === dayKey(now).slice(0, 4) ? `${key.slice(5)} ${hhmm(ms)}` : key;
}

/** Хайлтад: жижиг үсэг, ё→е, ү→у, ө→о (бичихэд андуурагддаг), зай/зураас/цэг хасна */
export function normSearch(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/ү/g, 'у').replace(/ө/g, 'о').replace(/[\s\-.·,()+]/g, '');
}
/**
 * Захиалга хайлттай таарах эсэх: нэр, утас, үйлчилгээ, мессеж, тэмдэглэл.
 * Талбаруудыг «|»-ээр холбоно — нэг талбарын төгсгөл, дараагийнх эхлэлээр хуурамч таарахгүй.
 * Зөвхөн цифр (зай, зураас, +)-тэй хайлтыг утасны цифрүүдтэй тулгана («9911 2233» = «9911-2233»).
 */
export function matchBooking(b, q) {
  const nq = normSearch(q);
  if (!nq) return true;
  const hay = [b.name, b.phone, b.service, b.message, b.note].map(normSearch).join('|');
  if (hay.includes(nq)) return true;
  if (!/^[\d\s+\-().]+$/.test(String(q).trim())) return false;
  const dq = String(q).replace(/\D/g, '');
  return dq.length >= 3 && String(b.phone || '').replace(/\D/g, '').includes(dq);
}

/** Утасны href: «7600-0505» → tel:+97676000505 (сайтын main.js-тэй ижил дүрэм) */
export function telHref(phone) {
  const d = String(phone || '').replace(/[^0-9+]/g, '');
  if (d.startsWith('+')) return 'tel:' + d;
  if (d.startsWith('976') && d.length === 11) return 'tel:+' + d;
  return 'tel:+976' + d;
}

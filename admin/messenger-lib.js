/* ==========================================================================
   SKIN AID admin — messenger-lib.js: «Messenger AI» цэсийн DOM, Firebase-гүй цэвэр функц, тогтмол.
   Серверийн (api/_lib) утгатай ИЖИЛ байх ёстой — tools/test/messenger-admin.test.mjs тулгана
   (хөтөч api/_lib-ийг импортолж чадахгүй: тэр нь Vercel функц, статик файл биш).
   ========================================================================== */

/** Горим (1-р үе шат: off | shadow) — api/_lib/social/labels.js SOCIAL_MODE_TEXT */
export const MODES = [
  { key: 'off', label: 'Унтраалттай', hint: 'Мессежийг хадгалахгүй, AI ажиллахгүй.' },
  { key: 'shadow', label: 'Сүүдэр', hint: 'AI хариуны ноорог бичнэ, үйлчлүүлэгч рүү ЮУ Ч илгээхгүй. Ажилтан Meta Inbox-оос өөрөө хариулж, «Ноорог» хэсэгт үнэлгээ өгнө.' },
];

/** Таг — api/_lib/social/settings-logic.js SOCIAL_CAP_LIMITS / SOCIAL_DEFAULTS, firestore.rules */
export const CAP_LIMITS = { runsMax: 100000, usdMax: 1000 };
export const DEFAULTS = { mode: 'off', killSwitch: false, monthlyRunCap: 3000, monthlyCostCapUsd: 50 };

/** Чиглэлийн тэмдгийн өнгө (шошгыг сервер ноорогт хадгална: draft.labels.route) */
export const ROUTE_TONE = { auto_candidate: 'ok', draft: 'info', handoff: 'warn', silent: 'muted' };

/** Үнэлгээ — firestore.rules messenger_drafts.rating, api/_lib/social/labels.js SOCIAL_RATING_TEXT */
export const RATINGS = [
  { key: 'good', label: 'Зөв' },
  { key: 'edited', label: 'Засвартай' },
  { key: 'wrong', label: 'Буруу' },
];
export const ratingLabel = (k) => (RATINGS.find((r) => r.key === k) || {}).label || '';

/** Ярианы мөрийн эзэн (api/_lib/social/conversation-logic.js MessageRole) */
export const ROLE_TEXT = { user: 'Үйлчлүүлэгч', staff: 'Ажилтан', bot: 'AI туслах', automation: 'Meta автомат хариу' };

/** Серверийн тохиргооны төлөв (api/_lib/config.js configStatus — boolean л, утга хэзээ ч биш) */
export const CONFIG_ITEMS = [
  ['serverAuth', 'Firebase-д хандах серверийн эрх (Google Cloud)'],
  ['anthropicKey', 'Claude AI-ийн түлхүүр (ANTHROPIC_API_KEY)'],
  ['psidSalt', 'Үйлчлүүлэгчийн id-г нууцлах түлхүүр (PSID_SALT)'],
  ['cronSecret', 'Өдрийн автомат ажлын түлхүүр (CRON_SECRET)'],
  ['metaAppSecret', 'Meta аппын нууц (META_APP_SECRET)'],
  ['metaVerifyToken', 'Webhook баталгаажуулах үг (META_VERIFY_TOKEN)'],
  ['metaAppId', 'Meta аппын id (META_APP_ID)'],
  ['metaPageId', 'SkinAid пэйжийн id (META_PAGE_ID)'],
];

/** Firestore-ийн баримт → маягтын утга (буруу/байхгүй = анхдагч; сервер ч ижил — settings-logic.js normalizeSettings) */
export function normalizeSettings(d) {
  const s = d && typeof d === 'object' ? d : {};
  const num = (v, def, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : def);
  return {
    mode: s.mode === 'shadow' ? 'shadow' : 'off',
    killSwitch: s.killSwitch === undefined ? false : s.killSwitch !== false,
    monthlyRunCap: Math.floor(num(s.monthlyRunCap, DEFAULTS.monthlyRunCap, CAP_LIMITS.runsMax)),
    monthlyCostCapUsd: num(s.monthlyCostCapUsd, DEFAULTS.monthlyCostCapUsd, CAP_LIMITS.usdMax),
  };
}

/** Маягтын хязгаар → тоо (хоосон = анхдагч); буруу бол { error }. Доллар: «12,5» / «12,50» = 12.5 (таслалтай гар),
 *  «1,000» = 1000 (мянгатын таслал) — серверийн settings-logic.js parseSocialCaps-тай ИЖИЛ. */
export function parseCaps(runsRaw, usdRaw) {
  const r = String(runsRaw ?? '').replace(/[\s,]/g, '');
  const u0 = String(usdRaw ?? '').replace(/[\s$]/g, '');
  const u = /^\d+,\d{1,2}$/.test(u0) ? u0.replace(',', '.') : u0.replace(/,/g, '');
  const runs = r === '' ? DEFAULTS.monthlyRunCap : /^\d{1,6}$/.test(r) ? Number(r) : NaN;
  const usd = u === '' ? DEFAULTS.monthlyCostCapUsd : /^\d{1,4}(\.\d{1,2})?$/.test(u) ? Number(u) : NaN;
  if (!Number.isFinite(runs) || runs < 0 || runs > CAP_LIMITS.runsMax) return { error: 'runs' };
  if (!Number.isFinite(usd) || usd < 0 || usd > CAP_LIMITS.usdMax) return { error: 'usd' };
  return { runs, usd };
}

/** Audit мөрийн id (firestore.rules: 8–64, ^[A-Za-z0-9_-]+$) */
export function auditId(now = Date.now(), rand = Math.random) {
  return `a_${now.toString(36).padStart(9, '0')}_${Math.floor(rand() * 2 ** 32).toString(36).padStart(7, '0')}`;
}

/** Улаанбаатарын цагаар сар («2026-11») — messenger_usage/{сар} (api/_lib/store.js ubMonth) */
export function ubMonth(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit' }).format(new Date(ms)).slice(0, 7);
}

/** Ноорогийн шүүлт: all | unrated | handoff | auto */
export const FILTERS = [
  { key: 'all', label: 'Бүгд' },
  { key: 'unrated', label: 'Үнэлээгүй' },
  { key: 'auto', label: 'Автомат боломжтой' },
  { key: 'handoff', label: 'Ажилтанд шилжүүлэх' },
];
export function draftMatches(d, filter) {
  if (filter === 'unrated') return !d.rating;
  if (filter === 'auto') return d.route === 'auto_candidate';
  if (filter === 'handoff') return d.route === 'handoff';
  return true;
}

/** Микро-доллар → «$1.23» */
export const usd = (micro) => `$${(Math.max(0, Number(micro) || 0) / 1e6).toFixed(2)}`;

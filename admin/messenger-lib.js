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

/* ---------- 2-р үе шат: «Сургалт» ---------- */

/** Мэдлэг (messenger_kb), жишээ (messenger_examples)-ийн талбарын хязгаар = firestore.rules (tools/test/messenger-admin.test.mjs) */
export const KB_LIMITS = { title: 120, body: 4000 };
export const EX_LIMITS = { userText: 2000, reply: 2000, note: 500 };
/** Брэнд дуу хоолой, нэмэлт заавар — тусгай id (api/_lib/knowledge.js KB_VOICE_ID) */
export const KB_VOICE_ID = 'voice';
export const KB_VOICE_TITLE = 'Брэнд дуу хоолой, заавар';
export const KB_STATUS = [
  { key: 'draft', label: 'Ноорог', hint: 'AI ашиглахгүй (зөвхөн «Туршилтын асуулт»-д «нийтлээгүйг хамт турших» үед).' },
  { key: 'published', label: 'Нийтэлсэн', hint: 'AI ≤ 5 минутын дотор ашиглаж эхэлнэ.' },
];
export const EX_KINDS = [
  { key: 'good', label: 'Сайн жишээ', hint: 'AI ингэж хариулбал зөв.' },
  { key: 'bad', label: 'Муу жишээ', hint: 'AI ингэж хариулж БОЛОХГҮЙ (яагаад гэдгийг тайлбарт бичнэ).' },
];
export const kbStatusLabel = (k) => (KB_STATUS.find((s) => s.key === k) || {}).label || '';
export const exKindLabel = (k) => (EX_KINDS.find((s) => s.key === k) || {}).label || '';

const rand36 = (rand, n) => Math.floor(rand() * 36 ** n).toString(36).padStart(n, '0');
/** Шинэ баримтын id (rules: ^[A-Za-z0-9_-]{1,40}$) */
export const newKbId = (now = Date.now(), rand = Math.random) => `k_${now.toString(36)}${rand36(rand, 6)}`;
export const newExampleId = (now = Date.now(), rand = Math.random) => `e_${now.toString(36)}${rand36(rand, 6)}`;
/** Ноорогоос үүсэх жишээний id — ноорог бүрт нэг (давхардахгүй) */
export const exampleIdForDraft = (draftId) => `x_${String(draftId ?? '').replace(/^d_/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 38) || '0'}`;

const chars = (s) => Array.from(String(s ?? '')).length;
const clip = (s, n) => Array.from(String(s ?? '').trim()).slice(0, n).join('');

/** Мэдлэгийн маягт → алдаа [{ field, msg }] (хоосон = зөв). Утгыг trim хийсэн хэлбэрээр шалгана. */
export function validateKb(v) {
  const errs = [];
  const title = String(v.title ?? '').trim();
  const body = String(v.body ?? '').trim();
  if (!title) errs.push({ field: 'title', msg: 'Гарчгийг бичнэ үү.' });
  else if (chars(title) > KB_LIMITS.title) errs.push({ field: 'title', msg: `Гарчиг ${KB_LIMITS.title} тэмдэгтээс урт байна.` });
  if (!body) errs.push({ field: 'body', msg: 'Агуулгыг бичнэ үү.' });
  else if (chars(body) > KB_LIMITS.body) errs.push({ field: 'body', msg: `Агуулга ${KB_LIMITS.body} тэмдэгтээс урт байна.` });
  if (!KB_STATUS.some((s) => s.key === v.status)) errs.push({ field: 'status', msg: '«Ноорог» эсвэл «Нийтэлсэн»-ийг сонгоно уу.' });
  return errs;
}

export function validateExample(v) {
  const errs = [];
  const userText = String(v.userText ?? '').trim();
  const reply = String(v.reply ?? '').trim();
  const note = String(v.note ?? '').trim();
  if (!EX_KINDS.some((k) => k.key === v.kind)) errs.push({ field: 'kind', msg: '«Сайн» эсвэл «Муу» жишээг сонгоно уу.' });
  if (!userText) errs.push({ field: 'userText', msg: 'Үйлчлүүлэгчийн асуултыг бичнэ үү.' });
  else if (chars(userText) > EX_LIMITS.userText) errs.push({ field: 'userText', msg: `Асуулт ${EX_LIMITS.userText} тэмдэгтээс урт байна.` });
  if (v.kind === 'good' && !reply) errs.push({ field: 'reply', msg: 'Сайн жишээнд зөв хариуг бичнэ үү.' });
  else if (v.kind === 'bad' && !reply && !note) errs.push({ field: 'reply', msg: 'Муу жишээнд буруу хариу эсвэл яагаад буруу болохыг бичнэ үү.' });
  if (chars(reply) > EX_LIMITS.reply) errs.push({ field: 'reply', msg: `Хариу ${EX_LIMITS.reply} тэмдэгтээс урт байна.` });
  if (chars(note) > EX_LIMITS.note) errs.push({ field: 'note', msg: `Тайлбар ${EX_LIMITS.note} тэмдэгтээс урт байна.` });
  return errs;
}

/**
 * Үнэлсэн ноорог → жишээ (нэг товч): Засвартай → сайн (хариу = ажилтны зөв хариу), Зөв → сайн (AI-ийн хариу),
 * Буруу → муу (AI-ийн хариу + ажилтны тайлбар). Текстгүй (зураг) эсвэл үнэлээгүй бол null.
 */
export function exampleFromDraft(d) {
  if (!d || !d.rating) return null;
  const userText = clip(d.userText, EX_LIMITS.userText);
  if (!userText) return null;
  const note = String(d.note ?? '').trim();
  const ai = String(d.reply || d.templateReply || '').trim();
  if (d.rating === 'edited') return note.length >= 2 ? { kind: 'good', userText, reply: clip(note, EX_LIMITS.reply), note: '' } : null;
  if (d.rating === 'good') return ai ? { kind: 'good', userText, reply: clip(ai, EX_LIMITS.reply), note: clip(note, EX_LIMITS.note) } : null;
  if (d.rating === 'wrong') return ai || note ? { kind: 'bad', userText, reply: clip(ai, EX_LIMITS.reply), note: clip(note, EX_LIMITS.note) } : null;
  return null;
}

/** Мэдлэгийн жагсаалтын эрэмбэ: брэнд дуу хоолой → нийтэлсэн → ноорог, тус бүр гарчгаар */
export function sortKb(rows) {
  const rank = (r) => (r.id === KB_VOICE_ID ? 0 : r.status === 'published' ? 1 : 2);
  return [...rows].sort((a, b) => rank(a) - rank(b) || String(a.title).localeCompare(String(b.title), 'mn'));
}

/** /api/admin-ийн алдааны код → ойлгомжтой текст */
export const API_ERRORS = {
  origin: 'Энэ үйлдлийг зөвхөн https://www.skinaid.mn/admin хуудаснаас хийнэ.',
  content_type: 'Хүсэлтийн хэлбэр буруу.',
  unauthorized: 'Нэвтрэлт хүчингүй болсон байна. Хуудсыг дахин ачаалаад нэвтэрнэ үү.',
  forbidden: 'Энэ бүртгэлд удирдлагын эрх байхгүй.',
  auth_unavailable: 'Google-ийн нэвтрэлтийг түр шалгаж чадсангүй. Хэсэг хүлээгээд дахин оролдоно уу.',
  not_configured: 'Серверийн Firebase-ийн эрх тохируулаагүй байна.',
  no_ai_key: 'Claude AI-ийн түлхүүр серверт тохируулаагүй байна.',
  kill_switch: 'Яаралтай зогсоолт асаалттай — «Тохиргоо»-оос унтраасны дараа туршина.',
  month_cap: 'Энэ сарын хязгаарт хүрсэн — «Тохиргоо»-оос хязгаарыг нэмэх эсвэл дараа сарыг хүлээнэ.',
  day_cap: 'Өнөөдрийн туршилтын хязгаарт хүрсэн. Маргааш дахин оролдоно уу.',
  bad_text: 'Мессеж хоосон эсвэл 1000 тэмдэгтээс урт байна.',
  ai_error: 'AI хариу өгсөнгүй (түр алдаа). Хэсэг хүлээгээд дахин оролдоно уу.',
  too_large: 'Хүсэлт хэт том байна.',
  bad_json: 'Хүсэлтийн хэлбэр буруу.',
  unknown_action: 'Сервер энэ үйлдлийг танихгүй байна (сайт шинэчлэгдээгүй байж магадгүй — хуудсыг дахин ачаална уу).',
  server_error: 'Серверт алдаа гарлаа. Дахин оролдоно уу.',
  network: 'Сервертэй холбогдож чадсангүй. Сүлжээгээ шалгана уу.',
  no_server: 'Серверийн функц энэ хаяг дээр алга — зөвхөн https://www.skinaid.mn/admin дээр ажиллана.',
};
export const apiErrorText = (code) => API_ERRORS[code] || `Алдаа гарлаа (${String(code).slice(0, 40)}).`;

/** «AI-д юу орж байна»-ийн хасагдсан шалтгаан (api/_lib/knowledge.js, catalog-safe.js, examples.js) */
export const EXCLUDE_TEXT = {
  draft: 'ноорог (нийтлээгүй)',
  pii: 'утас, имэйл, регистр эсвэл урт дугаар илэрсэн — AI-д оруулаагүй',
  empty: 'хоосон',
  invalid: 'төрөл буруу',
  limit: 'тооны хязгаар хэтэрсэн',
  total_limit: 'нийт хэмжээний хязгаар хэтэрсэн',
};

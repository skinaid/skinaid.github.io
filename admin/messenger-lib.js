/* ==========================================================================
   SKIN AID admin — messenger-lib.js: «Messenger AI» цэсийн DOM, Firebase-гүй цэвэр функц, тогтмол.
   Серверийн (api/_lib) утгатай ИЖИЛ байх ёстой — tools/test/messenger-admin.test.mjs тулгана
   (хөтөч api/_lib-ийг импортолж чадахгүй: тэр нь Vercel функц, статик файл биш).
   ========================================================================== */

/** Горим (off | shadow | auto) — api/_lib/social/labels.js SOCIAL_MODE_TEXT */
export const MODES = [
  { key: 'off', label: 'Унтраалттай', hint: 'Мессежийг хадгалахгүй, AI ажиллахгүй.' },
  { key: 'shadow', label: 'Сүүдэр', hint: 'AI хариуны ноорог бичнэ, үйлчлүүлэгч рүү ЮУ Ч илгээхгүй. Ажилтан Meta Inbox-оос өөрөө хариулж, «Ноорог» хэсэгт үнэлгээ өгнө.' },
  { key: 'auto', label: 'Автомат', hint: 'Зөвшөөрсөн сэдэвт (мэнд, цаг, хаяг, холбоо барих, үйлчилгээ, мэдлэгт бичигдсэн үнэ) AI Messenger-т ШУУД хариулна. Эмнэлгийн асуулт, гаж нөлөө, гомдол, мөнгө, зураг/видеог «ажилтанд дамжууллаа» гэж мэдэгдээд ажилтанд үлдээнэ.' },
];
/** «Автомат» горимд хэнд илгээх вэ — api/_lib/social/labels.js SOCIAL_AUDIENCE_TEXT, firestore.rules */
export const AUDIENCES = [
  { key: 'test', label: 'Зөвхөн туршилтын акаунт', hint: 'Доорх жагсаалтад байгаа акаунтад л шууд хариулна. Бусад үйлчлүүлэгчид юу ч илгээхгүй (сүүдэр хэвээр).' },
  { key: 'all', label: 'Бүх үйлчлүүлэгч', hint: 'Пэйж рүү бичсэн хүн бүрд шууд хариулна.' },
];
/** Туршилтын акаунтын дээд тоо — api/_lib/social/labels.js TEST_THREADS_MAX, firestore.rules validTestThreads */
export const TEST_THREADS_MAX = 10;
/** Ярианы id (messenger_drafts.threadId = psidHash) — api/_lib/social/settings-logic.js THREAD_ID_RE */
export const isThreadId = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
/** Ярианы id-ийн богино хэлбэр (жагсаалтад) */
export const shortThread = (id) => String(id ?? '').slice(0, 8);

/** Таг — api/_lib/social/settings-logic.js SOCIAL_CAP_LIMITS / SOCIAL_DEFAULTS, firestore.rules */
export const CAP_LIMITS = { runsMax: 100000, usdMax: 1000 };
export const DEFAULTS = { mode: 'off', killSwitch: false, monthlyRunCap: 3000, monthlyCostCapUsd: 50, autoAudience: 'test', testThreads: [] };

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
  ['metaPageToken', 'Пэйжийн token (META_PAGE_TOKEN) — «Автомат» горимд хариу илгээхэд'],
];
/** Өдрийн cron-ын пэйжийн token шалгалт (messenger_status/main.metaToken — api/_lib/cron.js) */
export const META_TOKEN_TEXT = {
  ok: 'хүчинтэй',
  page_mismatch: 'өөр пэйжийн token байна',
  token_invalid: 'хүчингүй эсвэл хугацаа нь дууссан — шинэ token хэрэгтэй',
  permission: 'зөвшөөрөл дутуу',
  network: 'шалгаж чадсангүй (Meta-тай холбогдоогүй)',
  rate_limit: 'шалгаж чадсангүй (Meta-ийн хязгаар)',
};
export const metaTokenText = (v) => (v ? META_TOKEN_TEXT[v] || 'шалгалт амжилтгүй' : 'шалгаагүй (өдөрт нэг удаа шалгана)');

/** Firestore-ийн баримт → маягтын утга (буруу/байхгүй = анхдагч; сервер ч ижил — settings-logic.js normalizeSettings) */
export function normalizeSettings(d) {
  const s = d && typeof d === 'object' ? d : {};
  const num = (v, def, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : def);
  return {
    mode: MODES.some((m) => m.key === s.mode) ? s.mode : 'off',
    killSwitch: s.killSwitch === undefined ? false : s.killSwitch !== false,
    monthlyRunCap: Math.floor(num(s.monthlyRunCap, DEFAULTS.monthlyRunCap, CAP_LIMITS.runsMax)),
    monthlyCostCapUsd: num(s.monthlyCostCapUsd, DEFAULTS.monthlyCostCapUsd, CAP_LIMITS.usdMax),
    // 'all'-оос бусад бүх утга = 'test' (fail-closed); жагсаалт: зөвхөн ярианы id, давхардалгүй, ≤ TEST_THREADS_MAX
    autoAudience: s.autoAudience === 'all' ? 'all' : 'test',
    testThreads: [...new Set((Array.isArray(s.testThreads) ? s.testThreads : []).filter(isThreadId))].slice(0, TEST_THREADS_MAX),
  };
}

/** Бот энэ ярианд ШУУД хариулах эсэх — api/_lib/social/settings-logic.js isLive-тэй ИЖИЛ */
export function isLiveThread(settings, threadId) {
  if (!settings || settings.mode !== 'auto' || settings.killSwitch !== false) return false;
  return settings.autoAudience === 'all' || (isThreadId(threadId) && Array.isArray(settings.testThreads) && settings.testThreads.includes(threadId));
}

/**
 * Сервер одоо илгээж ЧАДАХГҮЙ шалтгаан (messenger_status/main — сервер бичсэн сүүлийн төлөв) → текст; чадна = ''.
 * Тууз, баталгаажуулах цонх «шууд хариулж байна» гэж худал хэлэхгүйн тулд (api/_lib/outbound.js not_configured, token алдаа).
 * @param {Record<string, any> | null | undefined} st
 */
export function sendBlocker(st) {
  const cfg = st && typeof st === 'object' ? st.config : null;
  if (!cfg || typeof cfg !== 'object') return 'сервер хараахан холбогдоогүй (төлөв алга)';
  if (cfg.anthropicKey !== true) return 'серверт Claude AI-ийн түлхүүр (ANTHROPIC_API_KEY) тохируулаагүй';
  if (cfg.metaPageToken !== true) return 'серверт пэйжийн token (META_PAGE_TOKEN) тохируулаагүй';
  if (cfg.metaAppId !== true || cfg.metaPageId !== true) return 'серверт Meta аппын id эсвэл пэйжийн id тохируулаагүй';
  if (['token_invalid', 'page_mismatch', 'permission'].includes(st.metaToken)) return `пэйжийн token: ${metaTokenText(st.metaToken)}`;
  return '';
}

/**
 * Firestore-д бичих тохиргооны талбар (lastAuditId/updatedAt/updatedBy-гүй) ба audit-ийн detail — ИЖИЛ объект.
 * Анхдагч утгыг (autoAudience 'test', хоосон testThreads) БИЧИХГҮЙ: rules шинэчлэгдээгүй (шинэ талбаргүй) байсан ч
 * «Яаралтай зогсоох» ба «Автомат» биш горимын хадгалалт татгалзагдахгүй; rules ба сервер байхгүйг анхдагчаар уншина.
 * @param {ReturnType<typeof normalizeSettings>} n  normalizeSettings-ийн гаралт
 */
export function settingsDoc(n) {
  const d = { mode: n.mode, killSwitch: n.killSwitch, monthlyRunCap: n.monthlyRunCap, monthlyCostCapUsd: n.monthlyCostCapUsd };
  if (n.autoAudience === 'all') d.autoAudience = 'all';
  if (n.testThreads.length) d.testThreads = [...n.testThreads];
  return d;
}

/** Туршилтын акаунтын жагсаалтад нэмэх/хасах → шинэ жагсаалт; дүүрсэн / буруу id бол null */
export function toggleTestThread(list, threadId) {
  if (!isThreadId(threadId)) return null;
  const cur = Array.isArray(list) ? list.filter(isThreadId) : [];
  if (cur.includes(threadId)) return cur.filter((t) => t !== threadId);
  return cur.length >= TEST_THREADS_MAX ? null : [...cur, threadId];
}

/**
 * Илгээгээгүй / илгээж чадаагүй шалтгаан (ноорогийн sendReason) — api/_lib/social/labels.js SEND_REASON_TEXT-тэй ИЖИЛ
 * (tools/test/messenger-admin.test.mjs тулгана).
 */
export const SEND_REASON_TEXT = {
  no_recipient: 'хожимдож боловсруулсан тул хүлээн авагч тодорхойгүй (ажилтан хариулна)',
  not_configured: 'серверт пэйжийн token эсвэл аппын id тохируулаагүй',
  mode: 'горим «Автомат» биш болсон',
  kill_switch: 'яаралтай зогсоолт асаалттай',
  audience: 'туршилтын акаунт биш',
  standby: 'яриаг өөр апп (Page Inbox) эзэмшиж байна',
  human_active: 'ажилтан энэ ярианд хариулж байна',
  window: '24 цагийн хариулах хугацаа дууссан',
  thread_cap: 'энэ ярианд өнөөдрийн илгээх хязгаарт хүрсэн',
  day_cap: 'өнөөдрийн нийт илгээх хязгаарт хүрсэн',
  invalid_text: 'илгээх текст хоосон эсвэл буруу хэлбэртэй',
  duplicate: 'энэ мессежид аль хэдийн хариулсан',
  stale: 'мессеж хуучирсан эсвэл дараалал алдагдаж ирсэн (ажилтан хариулна)',
  sticker: 'зөвхөн стикер — хариу шаардлагагүй',
  token_invalid: 'пэйжийн token хүчингүй',
  permission: 'Meta зөвшөөрөл алга',
  thread_owned: 'яриаг өөр апп (Page Inbox) эзэмшиж байна',
  window_closed: '24 цагийн хариулах хугацаа дууссан',
  rate_limit: 'Meta-ийн хязгаарт хүрсэн',
  invalid: 'Meta хүсэлтийг хүлээж авсангүй',
  network: 'Meta-тай холбогдож чадсангүй',
  unknown: 'Meta-ийн тодорхойгүй алдаа',
  error: 'серверийн алдаа',
};
export const sendReasonText = (code) => SEND_REASON_TEXT[String(code ?? '')] || String(code ?? '');
/** Илгээсэн мессежийн төрөл (өдрийн нэгтгэл sent.<төрөл> — api/_lib/outbound.js SEND_KINDS) */
export const SEND_KIND_TEXT = { reply: 'AI-ийн хариу', handoff: '«ажилтанд дамжууллаа» мэдэгдэл', media: 'зураг/файлын мэдэгдэл' };

/**
 * Ноорогийн илгээлтийн төлөв → { tone, text } (картын тэмдэг); илгээх оролдлого хийгээгүй (сүүдэр, хуучин ноорог) = null.
 * @param {{ sendStatus?: string|null, sendReason?: string|null }} d @param {string} when  илгээсэн мөч (форматласан)
 */
export function sendBadge(d, when = '') {
  if (!d) return null;
  // Амьд ярианы ноорог боловч илгээх оролдлого хийгээгүй («Хүн хянана» чиглэл г.м.) — сүүдрийн ноорогоос ялгана:
  // үйлчлүүлэгч юу ч аваагүй, ажилтан хариулах ёстой
  if (!d.sendStatus) return d.mode === 'auto' ? { tone: 'muted', text: 'Илгээгээгүй — ажилтан хариулна' } : null;
  if (d.sendStatus === 'sent') return { tone: 'ok', text: `✓ Үйлчлүүлэгчид илгээсэн${when ? ` · ${when}` : ''}` };
  // Илгээхээр эзэмшсэн боловч үр дүн бүртгэгдээгүй — мессеж хүрсэн байж магадгүй (худал «илгээгээгүй» гэхгүй)
  if (d.sendStatus === 'sending') return { tone: 'warn', text: 'Илгээсэн байж магадгүй — үр дүн бүртгэгдээгүй (Meta Inbox-оос шалгана уу)' };
  if (d.sendStatus === 'failed') return { tone: 'warn', text: `Илгээж чадсангүй: ${sendReasonText(d.sendReason)}` };
  if (d.sendStatus === 'skipped') return { tone: 'muted', text: `Илгээгээгүй: ${sendReasonText(d.sendReason)}` };
  return null;
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
/** Нэг туршилтын зардал (жижиг дүн) → «$0.014» */
export const usd3 = (micro) => `$${(Math.max(0, Number(micro) || 0) / 1e6).toFixed(3)}`;

/* ---------- 2-р үе шат: «Сургалт» ---------- */

/** Мэдлэг (messenger_kb), жишээ (messenger_examples)-ийн талбарын хязгаар ≤ firestore.rules (tools/test/messenger-admin.test.mjs).
 *  Мэдлэгийн агуулга 1500 = AI-ийн уншдаг хэмжээ (api/_lib/social/catalog-safe.js KB_LIMITS) — rules 4000 хүртэл зөвшөөрдөг ч
 *  урт бичлэг AI-д тасарч ордог байсан (аудит 2026-11-27). */
export const KB_LIMITS = { title: 120, body: 1500 };
export const EX_LIMITS = { userText: 2000, reply: 2000, note: 500 };
/** Брэнд дуу хоолой, нэмэлт заавар — тусгай id; `_rev` = мэдлэгийн тэмдэг (api/_lib/store.js KB_IDS) */
export const KB_VOICE_ID = 'voice';
export const KB_REV_ID = '_rev';
export const KB_VOICE_TITLE = 'Брэнд дуу хоолой, заавар';
export const KB_STATUS = [
  { key: 'draft', label: 'Ноорог', hint: 'AI ашиглахгүй. «Туршилтын асуулт»-д «Ноорог (нийтлээгүй) мэдлэгийг хамт турших»-ыг чагталж шалгана.' },
  { key: 'published', label: 'Нийтэлсэн', hint: 'AI 1 минутын дотор ашиглаж эхэлнэ.' },
];
/** Сервер prompt-д оруулах хэмжээ (api/_lib/social/catalog-safe.js KB_LIMITS, examples.js EXAMPLE_LIMITS — тест тулгана) */
export const KB_BUDGET = { chars: 24000, entries: 60, entryChars: 1900 };
export const EX_BUDGET = { items: 30, customer: 500, reply: 600, why: 200, total: 12000 };
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

/**
 * Ноорогийн жишээний төлөв: 'none' (жишээ болгох боломжгүй), 'new', 'same', 'stale' (үнэлгээ өөрчлөгдсөн — жишээ хуучин
 * үнэлгээтэй: төрөл зөрсөн, эсвэл «Засвартай» болсон ч жишээ AI-ийн хуучин хариутай хэвээр).
 */
export function exampleState(d, cur) {
  const v = exampleFromDraft(d);
  if (!v) return 'none';
  if (!cur) return 'new';
  if (cur.kind !== v.kind) return 'stale';
  if (d.rating === 'edited' && String(cur.reply ?? '').trim() === String(d.reply ?? '').trim() && v.reply !== String(cur.reply ?? '').trim()) return 'stale';
  return 'same';
}

/** Нийтэлсэн мэдлэгийн AI-д орох ойролцоо хэмжээ (серверийнхтэй ижил тооцоо, нууцлалгүй) */
export function kbBudget(rows) {
  const pub = rows.filter((r) => r.status === 'published' && r.id !== KB_VOICE_ID && r.id !== KB_REV_ID);
  const len = (r) => Math.min(KB_BUDGET.entryChars, chars(String(r.title ?? '').trim()) + 3 + chars(String(r.body ?? '').trim()));
  const total = pub.reduce((n, r) => n + len(r), 0);
  return { published: pub.length, chars: total, over: total > KB_BUDGET.chars || pub.length > KB_BUDGET.entries };
}
/** AI-д орох жишээний тоо: ШИНЭ нь эхэнд, тоо ба нийт хэмжээний хязгаартай (сервер examples.js-тэй ижил) */
export function exampleBudget(rows) {
  const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v instanceof Date ? v.getTime() : 0);
  const sorted = [...rows].sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt));
  let used = 0;
  let total = 0;
  for (const r of sorted) {
    if (used >= EX_BUDGET.items) break;
    const size = Math.min(EX_BUDGET.customer, chars(r.userText)) + Math.min(EX_BUDGET.reply, chars(r.reply)) + Math.min(EX_BUDGET.why, chars(r.note));
    if (total + size > EX_BUDGET.total) continue;
    total += size;
    used++;
  }
  return { used, chars: total };
}

/** Мэдлэгийн жагсаалтын эрэмбэ: брэнд дуу хоолой → нийтэлсэн → ноорог, тус бүр гарчгаар */
export function sortKb(rows) {
  const rank = (r) => (r.id === KB_VOICE_ID ? 0 : r.status === 'published' ? 1 : 2);
  return [...rows].filter((r) => r.id !== KB_REV_ID).sort((a, b) => rank(a) - rank(b) || String(a.title).localeCompare(String(b.title), 'mn'));
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
  day_cap: 'Өнөөдрийн туршилтын хязгаарт (100) хүрсэн. Маргааш дахин оролдоно уу.',
  month_tests: 'Энэ сарын туршилт/eval-ийн хязгаарт хүрсэн эсвэл бүтэн eval-д хүрэлцэхгүй (сарын AI хязгаарын 20% — үлдсэнийг Messenger-ийн ноорогт үлдээнэ).',
  busy: 'Өөр туршилт эсвэл энэ хэсэг өөр хүсэлтээр явж байна. Хэдэн секунд хүлээгээд дахин оролдоно уу.',
  timeout: 'Сервер удаан хариулсан тул AI-г дуудсангүй (төлбөргүй). Дахин оролдоно уу.',
  knowledge_error: 'Мэдлэгийг бүрдүүлж чадсангүй. Сүүлд засварласан бичлэгээ шалгаад дахин оролдоно уу.',
  bad_request: 'Хүсэлт буруу байна (хуудсыг дахин ачаална уу).',
  eval_day_cap: 'Өнөөдрийн eval-ийн хязгаарт (3 удаа) хүрсэн. Маргааш дахин оролдоно уу.',
  eval_closed: 'Энэ eval аль хэдийн дууссан эсвэл олдсонгүй.',
  eval_budget: 'Eval-ийн дээд зардалд ($5) хүрсэн тул зогслоо.',
  bad_text: 'Мессеж хоосон эсвэл 1000 тэмдэгтээс урт байна.',
  ai_error: 'AI хариу өгсөнгүй (түр алдаа). Хэсэг хүлээгээд дахин оролдоно уу.',
  too_large: 'Хүсэлт хэт том байна.',
  bad_json: 'Хүсэлтийн хэлбэр буруу.',
  unknown_action: 'Сервер энэ үйлдлийг танихгүй байна (сайт шинэчлэгдээгүй байж магадгүй — хуудсыг дахин ачаална уу).',
  server_error: 'Серверт алдаа гарлаа. Дахин оролдоно уу.',
  network: 'Сервертэй холбогдож чадсангүй. Сүлжээгээ шалгана уу.',
  client_timeout: 'Сервер хугацаандаа (75 секунд) хариулсангүй. Сүлжээгээ шалгаад дахин оролдоно уу.',
  no_server: 'Серверийн функц энэ хаяг дээр алга — зөвхөн https://www.skinaid.mn/admin дээр ажиллана.',
  ub_no_key: 'UB Beauty-ийн нууц түлхүүр (UBBEAUTY_SECRET_KEY) серверт тохируулаагүй — нуусан үнийг татах боломжгүй.',
  ub_error: 'UB Beauty-ээс үнэ татаж чадсангүй — дараа дахин оролдоно уу.',
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

/* ---------- Eval ---------- */
/** Eval-ийн унасан шалтгаан (api/_lib/eval.js gradeCase) → ойлгомжтой текст */
export const EVAL_WHY = {
  not_handoff: 'Ажилтанд шилжүүлэх ёстой байсан',
  handoff: 'Шаардлагагүй ажилтанд шилжүүлсэн',
  intent: 'Сэдвийг буруу ангилсан',
  lint: 'Хориотой хэллэг (баталгаа, эмчилгээний амлалт г.м.)',
  must_not: 'Хориотой текст (нуусан үнэ, зохиосон дүн г.м.)',
  error: 'AI алдаа (төлбөр тоологдоогүй байж болно)',
  fallback: 'AI-ийн хариу бүтэлгүй (гаралт буруу эсвэл татгалзсан) — кодоор ажилтанд шилжүүлсэн',
};
/** Бодлогын шалтгаан (api/_lib/social/labels.js SOCIAL_REASON_TEXT-ийн товчлол — тест тулгана) */
export const EVAL_REASON = {
  no_source: 'мэдлэгээс иш заагаагүй', unknown_source: 'мэдэгдэхгүй иш', long_reply: 'хэт урт хариу', placeholder: 'хувьсагч',
  lint_block: 'хориотой хэллэг', invented_price: 'мэдлэгт байхгүй үнэ', invented_percent: 'мэдлэгт байхгүй хувь',
  invented_offer: 'мэдлэгт байхгүй хөнгөлөлт/санал', low_confidence: 'AI итгэл бага', llm_needs_human: 'AI өөрөө ажилтанд даатгасан',
  intent_human: 'эрсдэлтэй сэдэв', signal: 'эрсдэлийн дохио', empty_reply: 'хоосон хариу', refusal: 'AI татгалзсан', invalid_output: 'AI-ийн гаралт буруу',
  injection: 'AI-д заавар өгөх оролдлого',
};
/** Бодлогын шалтгааны кодууд («signal:refund» г.м.) → ойлгомжтой текст (давхардалгүй, «; »-ээр) */
export function evalReasonsText(reasons) {
  const seen = new Set();
  for (const r of Array.isArray(reasons) ? reasons : []) {
    const base = String(r).split(':')[0];
    if (base) seen.add(EVAL_REASON[base] || base);
  }
  return [...seen].join('; ');
}
/** «Шаардлагагүй ажилтанд шилжүүлсэн» кейсүүдийн шалтгааны тоо ({ код: тоо }) → [[текст, тоо]] их нь эхэндээ */
export function evalHandoffReasons(counts) {
  return Object.entries(counts && typeof counts === 'object' ? counts : {})
    .map(([k, n]) => [EVAL_REASON[k] || k, Number(n) || 0])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}
export function evalWhyText(code) {
  const c = String(code || '');
  if (EVAL_WHY[c]) return EVAL_WHY[c];
  if (c.startsWith('reason:')) return `Бодлого: ${EVAL_REASON[c.slice(7)] || c.slice(7)}`;
  return c || '—';
}

/* ---------- «Тойм» (PR В) ---------- */
/** Автомат зогсолтын шалтгаан (api/_lib/crisis.js CRISIS_REASONS) */
export const AUTO_STOP_TEXT = {
  wrong_ratings: 'сүүлийн 24 цагт үнэлсэн ноорогийн ихэнх нь «Буруу»',
  error_streak: 'Claude дараалан 5 удаа засагдахгүй алдаа гаргасан (түлхүүр, кредит эсвэл тохиргоо)',
  // wrong_ratings — одоогийн prompt-ийн ноорогт; автомат зогсолтын дараа асаасан бол түүнээс хойшхи ноорогт л (crisis.js)
  day_cost: 'өнөөдрийн зардал сарын хязгаарын 20%-иас хэтэрсэн',
};
/** 3-р үе шатны гейт: «Автомат боломжтой» ноорогийн ≥ 85% шууд эсвэл бага засвартай, ≥ 50 үнэлгээ */
export const AUTO_GATE = { share: 0.85, minRated: 50, smallEdit: 0.3 };
export const ECHO_TEXT = {
  automation_fast_gap: 'Meta автомат (хэрэглэгчээс ≤ 15 с)', automation_template: 'Meta автомат (давтагдсан загвар)',
  automation_no_user: 'Meta автомат (хэрэглэгч бичээгүй)', automation_known_app: 'Meta автомат (апп)',
  staff_default: 'Ажилтан', staff_no_user: 'Ажилтан (хэрэглэгч бичээгүй)', bot_own_app: 'Манай бот',
};
/** AI-ийн ажиллагааны төлөв (ai_runs.status — өдрийн нэгтгэл runs.<status>) → «Тойм»-ын текст */
export const RUN_STATUS_TEXT = {
  ok: 'амжилттай', error: 'алдаа', refusal: 'татгалзсан', invalid_output: 'гаралт буруу', cap: 'хязгаарт хүрсэн', not_configured: 'тохируулаагүй',
};

/** Засварын хувь (api/_lib/guardrails.js editRatio-той ИЖИЛ — тест тулгана): 0 = хэвээр, 1 = бүхэлд нь өөр */
export function editRatio(original, edited) {
  const a = [...String(original ?? '')].slice(0, 2000);
  const b = [...String(edited ?? '')].slice(0, 2000);
  if (a.length === 0 && b.length === 0) return 0;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return Math.min(1, prev[b.length] / Math.max(a.length, b.length));
}

/** Сүүлийн n өдрийн УБ-ын огноо (хуучнаас шинэ рүү) — messenger_usage/<өдөр> */
export function lastDays(n, nowMs = Date.now()) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit' });
  return Array.from({ length: n }, (_, i) => fmt.format(new Date(nowMs - (n - 1 - i) * 86_400_000)));
}

const addMap = (into, m) => { for (const [k, v] of Object.entries(m && typeof m === 'object' ? m : {})) into[k] = (into[k] || 0) + (Number(v) || 0); };
/** Өдрийн баримтууд (id → data) → нийт ба өдөр бүрийн ноорог */
export function aggregateDays(byDay, days) {
  const t = { drafts: 0, routes: {}, intents: {}, runs: {}, echo: {}, sent: {}, sendSkip: {}, sendFail: {}, costMicroUsd: 0, adminCostMicroUsd: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tests: 0, evals: 0 };
  const series = [];
  for (const day of days) {
    const d = byDay[day] || {};
    series.push({ day, drafts: Number(d.drafts) || 0 });
    t.drafts += Number(d.drafts) || 0;
    for (const k of ['routes', 'intents', 'runs', 'echo', 'sent', 'sendSkip', 'sendFail']) addMap(t[k], d[k]);
    for (const k of ['costMicroUsd', 'adminCostMicroUsd', 'inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'tests', 'evals']) t[k] += Number(d[k]) || 0;
  }
  const denom = t.cacheReadTokens + t.inputTokens + t.cacheWriteTokens;
  t.cacheHit = denom ? t.cacheReadTokens / denom : null;
  t.aiErrors = (t.runs.error || 0) + (t.runs.refusal || 0);
  // «Автомат» горимын илгээлт (api/_lib/store.js finishOutbound / markSendSkipped-ийн өдрийн нэгтгэл)
  const sum = (m) => Object.values(m).reduce((n, v) => n + (Number(v) || 0), 0);
  t.sentTotal = sum(t.sent);
  t.sendSkipTotal = sum(t.sendSkip);
  t.sendFailTotal = sum(t.sendFail);
  return { totals: t, series };
}

/** Үнэлсэн ноорогууд → нарийвчлал; «Автомат боломжтой»-д шууд эсвэл бага засвар (editRatio < 0.3) */
export function ratingStats(drafts) {
  const s = { rated: 0, good: 0, edited: 0, wrong: 0, small: 0, auto: { rated: 0, good: 0, small: 0 } };
  for (const d of drafts) {
    if (!['good', 'edited', 'wrong'].includes(d.rating)) continue;
    s.rated++;
    s[d.rating]++;
    const small = d.rating === 'edited' && editRatio(d.reply, d.note) < AUTO_GATE.smallEdit;
    if (small) s.small++;
    if (d.route === 'auto_candidate') {
      s.auto.rated++;
      if (d.rating === 'good') s.auto.good++;
      if (small) s.auto.small++;
    }
  }
  const share = s.auto.rated ? (s.auto.good + s.auto.small) / s.auto.rated : null;
  s.gate = { share, met: share !== null && s.auto.rated >= AUTO_GATE.minRated && share >= AUTO_GATE.share, enough: s.auto.rated >= AUTO_GATE.minRated };
  return s;
}

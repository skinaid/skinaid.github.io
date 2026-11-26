/**
 * Messenger AI — хамгаалалтын цөм. ЦЭВЭР модуль (runtime import-гүй; `node --test 'tools/test/*.test.mjs'`).
 *
 * Эх сурвалж: skinaid/ubbeauty@1a43c95c
 *   · src/lib/agents/guardrails.ts — findPii, assertNoPii, redactForLlm, LLM_FORBIDDEN_SOURCES, findForbiddenSources,
 *     assertNoForbiddenSources, hasEmoji, unknownPlaceholders, lintDraft, hasBlocking, cyrillicRatio, editRatio
 *   · src/lib/agents/eval-grade.ts — moneyMentions, percentMentions
 * SkinAid-д өөрчилсөн:
 *   · SMS/имэйлийн хэсгийг хассан (энд зөвхөн Messenger).
 *   · LLM_FORBIDDEN_SOURCES-д Firestore-ийн `bookings` (үйлчлүүлэгчийн нэр, утас) нэмсэн.
 *   · moneyMentions нь SkinAid-ийн каталогийн «₮50,000» (₮ угтвар) хэлбэрийг мөн уншина.
 *   · Placeholder-ийг огт зөвшөөрөхгүй (Messenger-ийн хариунд систем холбоосыг өөрөө нэмнэ).
 */

// ============================================================
// 1) Хувийн мэдээлэл (PII)
// ============================================================

/** @typedef {'phone' | 'email' | 'register_no' | 'number'} PiiKind */
/** @typedef {{ kind: PiiKind, match: string }} PiiHit */

// Мөнгөн дүнгийн араас (₮/төгрөг) ирсэн цифрийг утас/дугаар гэж үзэхгүй («59 000 000₮»)
const NOT_MONEY = String.raw`(?!\s*(?:₮|төг))`;
// Олон улсын дугаар: «+82 10-1234-5678», «+1 (415) 555-0100» (Монголын +976-ийг доорх PHONE_RE авна)
const INTL_PHONE_RE = /\+(?!976)\d[\d\s().-]{6,}\d/gu;
// Монгол утас: 8 орон (5–9-өөр эхэлнэ), +976 угтвартай эсвэл үгүй; цифрийн хооронд нэг тусгаарлагч (зай, цэг, зураас,
// хаалт) байж болно — «9911 2233», «99 11 22 33», «9911.2233», «99 112 233», «9 9 1 1 2 2 3 3» (аудит 2026-11-25).
// Таслал ОРОХГҮЙ (үнэ «50,000»). Урт тооны хэсэг (данс) хуурамч эерэг өгөхгүйн тулд хоёр талдаа цифргүй.
// Араас нь тусгаарлагч + цифр үргэлжилбэл (карт «5011 2233 4455 6677») утас биш — урт дугаар бүхэлдээ нуугдана.
const PHONE_RE = new RegExp(String.raw`(?<![\d.-])(?:\+?976[\s.-]?)?\(?[5-9](?:[\s.()-]{0,2}\d){7}(?![\s.-]?\d)` + NOT_MONEY, 'gu');
// Данс, карт, бусад урт дугаар: тусгаарлагчийг тооцолгүй 9+ цифр
const LONG_NUMBER_RE = new RegExp(String.raw`(?<![\d,])\d(?:[\s.-]?\d){8,}(?![\d,])` + NOT_MONEY, 'gu');
// Домэйн нь ASCII — эс бөгөөс «a@b.mn-ээр» дэх монгол нөхцөлийг залгина
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/gu;
// Регистрийн дугаар: 2 үсэг (кирилл эсвэл латин — «ИЙ12345678», «UB12345678») + 8 цифр
const REGISTER_RE = /(?<!\p{L})(?:[А-ЯЁӨҮа-яёөү]{2}|[A-Za-z]{2})[\s-]?\d{8}(?!\d)/gu;

// Илрүүлэх дараалал: имэйл → РД → олон улсын утас → утас → урт дугаар. Олдсон хэсгийг дараагийнхаас нууна.
// Имэйл РД-ээс ӨМНӨ: «bold.bat@mail.mn 99112233» дээр РД «mn 99112233»-ийг авч имэйлийн нэрийг үлдээдэг байсан (аудит 2026-11-27).
/** @type {[PiiKind, RegExp, string][]} */
const PII_ORDER = [
  ['email', EMAIL_RE, '[имэйл]'],
  ['register_no', REGISTER_RE, '[РД]'],
  ['phone', INTL_PHONE_RE, '[утас]'],
  ['phone', PHONE_RE, '[утас]'],
  ['number', LONG_NUMBER_RE, '[дугаар]'],
];

/** Бүтэн өргөнтэй цифр/үсэг («９９１１…») → энгийн (NFKC) — нуухаас өмнө */
const norm = (text) => String(text ?? '').normalize('NFKC');

/** @param {string} text @returns {PiiHit[]} */
export function findPii(text) {
  let s = norm(text);
  /** @type {PiiHit[]} */
  const hits = [];
  for (const [kind, re] of PII_ORDER) {
    for (const m of s.matchAll(re)) hits.push({ kind, match: m[0] });
    s = s.replace(re, (m) => ' '.repeat(m.length));
  }
  return hits;
}

/** LLM рүү явах payload-д хувийн мэдээлэл байвал алдаа шиднэ (объектыг JSON болгож бүхэлд нь шалгана). */
export function assertNoPii(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const hits = findPii(text);
  if (hits.length > 0) {
    const kinds = [...new Set(hits.map((h) => h.kind))].join(',');
    throw new Error(`PII_DETECTED:${kinds}`);
  }
}

/** Чөлөөт текстээс хувийн мэдээллийг нууна (утас → [утас], имэйл → [имэйл], РД → [РД], данс/карт → [дугаар]) */
export function redactForLlm(text) {
  let s = norm(text);
  for (const [, re, label] of PII_ORDER) s = s.replace(re, label);
  return s;
}

// ============================================================
// 1б) LLM-д ХЭЗЭЭ Ч явахгүй эх сурвалж
// ============================================================

/**
 * Эдгээр нэр payload-ийн ТҮЛХҮҮРТ гарвал алдаа (давхар хамгаалалт — мэдлэг нь allowlist-ээр л бүтдэг).
 * SkinAid: Firestore `bookings` = үйлчлүүлэгчийн нэр, утас, мессеж. UB Beauty-ийн жагсаалтыг хэвээр үлдээсэн
 * (ирээдүйд UB Beauty-ийн өгөгдөл холбогдвол).
 */
export const LLM_FORBIDDEN_SOURCES = Object.freeze([
  'bookings',
  'patients',
  'doctor_notes',
  'doctor_note_addenda',
  'doctor_note_revisions',
  'visit_care_notes',
  'visit_photos',
  'care_threads',
  'care_thread_messages',
  'register_no',
  'birth_date',
  'marketing_recipients',
  'signed_consents',
  'consent_records',
  'consent_answers',
  'guardian_phone',
  'psid',
]);
const FORBIDDEN_SOURCE_SET = new Set(LLM_FORBIDDEN_SOURCES);

/** Объектын (давхар) түлхүүрүүдээс хориотой эх сурвалжийн нэрийг олно */
export function findForbiddenSources(value) {
  const hits = new Set();
  const seen = new Set();
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 8 || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN_SOURCE_SET.has(k)) hits.add(k);
      walk(x, depth + 1);
    }
  };
  walk(value, 0);
  return [...hits];
}

export function assertNoForbiddenSources(value) {
  const hits = findForbiddenSources(value);
  if (hits.length > 0) throw new Error(`FORBIDDEN_SOURCE:${hits.join(',')}`);
}

// ============================================================
// 2) Emoji, placeholder
// ============================================================

const EMOJI_RE = /\p{Extended_Pictographic}/u;
export const hasEmoji = (text) => EMOJI_RE.test(String(text ?? ''));

const PLACEHOLDER_RE = /\{[^{}\s]{1,30}\}/gu;
export function findPlaceholders(text) {
  return [...String(text ?? '').matchAll(PLACEHOLDER_RE)].map((m) => m[0]);
}

// ============================================================
// 3) Төслийн lint (Messenger)
// ============================================================

/**
 * @typedef {{ code: string, severity: 'block' | 'warn', message: string, match?: string }} LintIssue
 */

// Үгийн хил: JS-ийн \b кирилл дээр ажилладаггүй тул \p{L}-ээр ХОЁР талд.
const W = (body) => new RegExp(`(?<!\\p{L})(?:${body})(?!\\p{L})`, 'iu');

const GUARANTEE = [
  W('100\\s?%'),
  W('баталгаатай\\s+(?:үр\\s+дүн\\p{L}*|арилна|эдгэрнэ)'),
  W('үр\\s+дүн(?:г|ийг)?\\s+баталгаа\\p{L}*'),
  W('гарантитай'),
  W('мөнхөд\\s+(?:арилна|алга)'),
];
const MEDICAL = [
  W('бүрэн\\s+эдгэр\\p{L}*'),
  W('эдгэрүүлнэ'),
  W('гаж\\s+нөлөөгүй'),
  W('ямар\\s+ч\\s+эрсдэлгүй'),
  W('эрсдэлгүй\\s+эмчилгээ\\p{L}*'),
  W('өвдөлтгүй\\s+(?:бүрэн|100)'),
  // Эмнэлгийн тайвшруулга — AI шинж тэмдгийг «хэвийн» гэж дүгнэх ёсгүй (аудит 2026-11-25)
  W('хэвийн\\s+(?:зүйл|үзэгдэл|юм|байдал)'),
  W('санаа\\s+зовох\\s+(?:хэрэггүй|зүйлгүй)'),
  W('(?:удахгүй|хэд\\s+хоно\\p{L}*|өөрөө|аяндаа)\\s+(?:арилна|эдгэрнэ|зүгээр\\s+болно|алга\\s+болно|намдана)'),
  W('аюулгүй\\s+(?:эмчилгээ|арга|процедур)\\p{L}*'),
];
const SUPERLATIVE = [W('хамгийн\\s+шилдэг\\p{L}*'), W('№\\s?1'), W('дугаар\\s+нэгт')];
const TESTIMONIAL = [
  W('(?:манай|бидний)\\s+үйлчлүүлэгч\\p{L}*\\s+(?:\\p{L}+\\s+){0,3}(?:хэлсэн|бичсэн|хэлэхдээ)'),
];
const INFORMAL = [W('чи|чамд|чамайг|чиний|чамтай|чамаас')];
const RUSSIAN = [W('здравствуйте|спасибо|пожалуйста|уважаем\\p{L}*|скидк\\p{L}*|записат\\p{L}*|приглашаем')];

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"')»]+/giu;

/** Messenger-ийн текст мессежийн дээд урт (Send API — 2000 тэмдэгт) */
export const MESSENGER_MAX_CHARS = 2000;

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function firstMatch(res, text) {
  for (const re of res) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

/**
 * Messenger-ийн хариуны төслийг шалгана. `block` = илгээж болохгүй, `warn` = хүн анхаарна.
 * @param {string} text
 * @param {{ allowedHosts?: string[], bannedPhrases?: string[] }} [opts]
 * @returns {LintIssue[]}
 */
export function lintDraft(text, opts = {}) {
  const s = String(text ?? '');
  /** @type {LintIssue[]} */
  const issues = [];
  if (!s.trim()) return [{ code: 'empty', severity: 'block', message: 'Текст хоосон байна.' }];

  const g = firstMatch(GUARANTEE, s);
  if (g) issues.push({ code: 'guarantee_claim', severity: 'block', match: g, message: 'Үр дүнг баталгаажуулсан амлалт — зар сурталчилгаанд хориотой.' });
  const med = firstMatch(MEDICAL, s);
  if (med) issues.push({ code: 'medical_claim', severity: 'block', match: med, message: 'Эмчилгээний үр дүн/эрсдэлгүй гэсэн амлалт — хориотой.' });
  const sup = firstMatch(SUPERLATIVE, s);
  if (sup) issues.push({ code: 'superlative', severity: 'warn', match: sup, message: '«Хамгийн шилдэг» төрлийн нотлогдоогүй давуу тал.' });
  const t = firstMatch(TESTIMONIAL, s);
  if (t) issues.push({ code: 'fake_testimonial', severity: 'block', match: t, message: 'Үйлчлүүлэгчийн сэтгэгдэл иш татсан — зохиомол байж болзошгүй.' });
  const inf = firstMatch(INFORMAL, s);
  if (inf) issues.push({ code: 'informal', severity: 'warn', match: inf, message: '«Чи» хэлбэр — үйлчлүүлэгчид «Та»-гаар хандана.' });
  const ru = firstMatch(RUSSIAN, s);
  if (ru) issues.push({ code: 'russian', severity: 'warn', match: ru, message: 'Орос үг орсон байна.' });

  const allowed = (opts.allowedHosts ?? []).map((h) => String(h).toLowerCase().replace(/^www\./, ''));
  for (const m of s.matchAll(URL_RE)) {
    const raw = m[0].startsWith('www.') ? `https://${m[0]}` : m[0];
    const host = hostOf(raw);
    if (!allowed.some((a) => host === a || host.endsWith(`.${a}`))) {
      issues.push({ code: 'url_not_allowed', severity: 'block', match: m[0], message: 'Зөвшөөрөгдөөгүй холбоос — холбоосыг систем өөрөө нэмнэ.' });
      break;
    }
  }

  const pii = findPii(s);
  if (pii.length) issues.push({ code: 'pii', severity: 'block', match: pii[0].match, message: 'Хувийн мэдээлэл (утас/имэйл/РД) орсон байна.' });

  const ph = [...new Set(findPlaceholders(s))];
  if (ph.length) issues.push({ code: 'placeholder', severity: 'block', match: ph.join(' '), message: 'Хувьсагч ({…}) орсон — Messenger-ийн хариунд хувьсагч хэрэглэхгүй.' });

  for (const phrase of opts.bannedPhrases ?? []) {
    const p = String(phrase).trim();
    if (p && s.toLowerCase().includes(p.toLowerCase())) {
      issues.push({ code: 'banned_phrase', severity: 'block', match: p, message: 'Эмнэлгийн хориотой хэллэг орсон байна.' });
      break;
    }
  }

  if (s.length > MESSENGER_MAX_CHARS) {
    issues.push({ code: 'too_long', severity: 'block', message: `Messenger-ийн мессеж ${MESSENGER_MAX_CHARS} тэмдэгтээс урт байна.` });
  }
  return issues;
}

/** @param {LintIssue[]} issues */
export const hasBlocking = (issues) => issues.some((i) => i.severity === 'block');

// ============================================================
// 4) Хэмжүүр
// ============================================================

/** Кирилл үсгийн эзлэх хувь (үсгүүдээс) */
export function cyrillicRatio(text) {
  const letters = [...String(text ?? '')].filter((c) => /\p{L}/u.test(c));
  if (letters.length === 0) return 1;
  const cyr = letters.filter((c) => /\p{Script=Cyrillic}/u.test(c)).length;
  return cyr / letters.length;
}

/** Засварын хувь: 0 = хэвээр, 1 = бүхэлд нь дахин бичсэн (Левенштейн / урт, 2000 тэмдэгтээр тасална) */
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

// ============================================================
// 5) Мөнгөн дүн, хувь (eval-grade.ts)
// ============================================================

// «50,000₮», «60 мянган төгрөг», «1.2 сая төгрөг» (UB Beauty) + «₮50,000», «₮ 300 000» (SkinAid каталог).
// Хоёр чиглэлийг ТУСДАА уншиж нэгтгэнэ: «50,000 ₮300,000» дээр нэг regex ₮-г залгиад 300,000-г алдах байсан.
// Илүү тоо уншвал (хуурамч эерэг) зөвхөн хүнд шилжүүлэлт нэмэгдэнэ — аюулгүй чиглэл.
const NUM = String.raw`\d+(?:[.,\s ]\d{3})*(?:[.,]\d+)?`;
const MULT = String.raw`мянга\p{L}*|сая\p{L}*`;
const MONEY_SUFFIX_RE = new RegExp(`(${NUM})\\s*(${MULT})?\\s*(?:₮|төг\\p{L}*)`, 'giu');
const MONEY_PREFIX_RE = new RegExp(`₮\\s*(${NUM})(?:\\s*(${MULT}))?`, 'giu');
// «хувь» → «хувийн», «хувиар» (ь гээгдэнэ)
const PCT_RE = /(\d{1,3}(?:[.,]\d+)?)\s*(?:%|хув[ьи]\p{L}*)/giu;

function moneyValue(raw, multWord) {
  const mult = multWord ? (multWord.toLowerCase().startsWith('сая') ? 1_000_000 : 1000) : 1;
  const n = mult > 1 ? Number(raw.replace(/[\s ]/g, '').replace(',', '.')) * mult : Number(raw.replace(/[.,\s ]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Бичвэр дэх мөнгөн дүнгүүд (₮/төгрөг-тэй, давхардалгүй) — «60 мянган төгрөг» = 60000, «₮50,000» = 50000 */
export function moneyMentions(text) {
  const s = String(text ?? '');
  const out = new Set();
  for (const re of [MONEY_SUFFIX_RE, MONEY_PREFIX_RE]) {
    for (const m of s.matchAll(re)) {
      const v = moneyValue(m[1], m[2]);
      if (v !== null) out.add(v);
    }
  }
  return [...out];
}

/**
 * ₮/төгрөггүй бичсэн дүн: «25,000-аар», «25000», «50 мянгаар», «1.5 сая», «25k» (аудит 2026-11-25: LLM валютгүй үнэ
 * бичвэл moneyMentions алгасдаг байсан). 1000-аас бага тоо (цаг, тун, минут), он («2007 оноос»), огноо, цаг
 * («09:00-19:00») тооцогдохгүй. Мэдлэгт байгаа тоо (үйлчилгээний нэр «Glutathione 1200» г.м.) policy-д зөвшөөрөгдөнө.
 */
const BARE_NUM_RE = /(?<![\d:/.,])(\d{1,3}(?:[,\s ]\d{3})+|\d{4,})(?![\d:/]|[.,]\d|-\d|\s*(?:он|оны|онд|оноос)(?!\p{L}))/gu;
const BARE_MULT_RE = /(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(мянга\p{L}*|сая\p{L}*|k|к)(?!\p{L})/giu;
export function numberMentions(text) {
  const s = String(text ?? '');
  const out = new Set();
  for (const m of s.matchAll(BARE_NUM_RE)) {
    const n = Number(m[1].replace(/[,\s ]/g, ''));
    if (Number.isFinite(n) && n >= 1000) out.add(n);
  }
  for (const m of s.matchAll(BARE_MULT_RE)) {
    const w = m[2].toLowerCase();
    const mult = w.startsWith('сая') ? 1_000_000 : 1000;
    const n = Math.round(Number(m[1].replace(',', '.')) * mult);
    if (Number.isFinite(n)) out.add(n);
  }
  return [...out];
}

/** Хөнгөлөлт, үнэгүй, бэлэг, хувь — мэдлэгт байхгүй бол policy хүнд шилжүүлнэ («хувь хүн» тооцогдохгүй) */
const OFFER_RE = /(?<!\p{L})(?:хөнгөлөлт\p{L}*|хямдрал\p{L}*|хямдар\p{L}*|хямд\s+үнэ\p{L}*|үнэгүй\p{L}*|хагас\s+үнэ\p{L}*|бэлэг\p{L}*|онцгой\s+үнэ\p{L}*|тусгай\s+үнэ\p{L}*|хув[ьи]\p{L}*(?!\s+хүн))/giu;
export function offerMentions(text) {
  return [...String(text ?? '').matchAll(OFFER_RE)].map((m) => m[0].toLowerCase());
}

export function percentMentions(text) {
  return [...String(text ?? '').matchAll(PCT_RE)].map((m) => Number(m[1].replace(',', '.')));
}

/**
 * Messenger AI — КОДЫН бичдэг тогтмол текстүүд (LLM бичихгүй, хасаж чадахгүй). ЦЭВЭР модуль.
 * Эх сурвалж: skinaid/ubbeauty@1a43c95c src/lib/social/disclosure.ts. SkinAid-ийн өөрчлөлт: composeBotReply давхар
 * мэндчилгээг хасна (stripLeadingGreeting).
 *
 *   · AI тодруулга — Meta-ийн бодлого: эхний ботын хариу, удаан завсарласны дараа, хүнээс бот руу буцахад.
 *     Сүүдэрт ноорогт «бот илгээх байсан» текст; «Автомат» горимд яг энэ текст илгээгдэнэ (`composeBotReply`,
 *     `handoffMessage`).
 *   · Зураг/видео/дууны загвар хариу — AI зураг харахгүй, онош тавихгүй.
 *   · Яаралтай сэдэвт эмнэлгийн утсыг КОД нэмнэ (LLM утасны дугаар харахгүй — assertNoPii).
 */

/** Сүүлийн ботын хариунаас хойш ийм хугацаа өнгөрвөл тодруулгыг дахин залгана */
export const DISCLOSURE_GAP_HOURS = 24;

/** Тодруулгын эхний өгүүлбэр — бот гэдгээ хэлнэ (Meta-ийн бодлого). Handoff/зургийн загварын өмнө ч энийг л залгана. */
export function aiIntro(clinicName) {
  const name = String(clinicName ?? '').trim().slice(0, 80) || 'Эмнэлгийн';
  return `Сайн байна уу! Би ${name}-ийн AI туслах.`;
}

export function aiDisclosure(clinicName) {
  return (
    `${aiIntro(clinicName)} Ерөнхий мэдээлэл, цаг захиалгад тусална. ` +
    'Эмчийн зөвлөгөө шаардлагатай асуултад манай ажилтан, эмч хариулна. Хүссэн үедээ «Ажилтантай ярих» гэж бичнэ үү.'
  );
}

/** Ботын хариуны доорх КОДЫН тогтмол quick reply — дарвал «Ажилтантай ярих» текст ирж, human_request дохиогоор хүнд шилжинэ */
export const HUMAN_QUICK_REPLY = Object.freeze({ title: 'Ажилтантай ярих', payload: 'HUMAN' });

/** Тодруулга залгах эсэх: энэ ярианд бот анх удаа, эсвэл удаан завсарласан, эсвэл хүнээс буцсан */
export function needsDisclosure({ lastBotAt, now, returnedFromHuman }) {
  if (returnedFromHuman || !lastBotAt) return true;
  return now.getTime() - lastBotAt.getTime() >= DISCLOSURE_GAP_HOURS * 3600_000;
}

/** Хариуны эхний мэндчилгээ (+ араас нь байгаа цэг таслал, зай) */
const LEADING_GREETING = /^(?:сайн\s+байна\s+уу|сайн\s+байцгаана\s+уу|сайн\s+уу|өглөөний\s+мэнд|өдрийн\s+мэнд|оройн\s+мэнд|мэнд\s+хүргэе|hello|hi)(?![\p{L}\p{N}])[\s!?.,…:;-]*/iu;

/**
 * Тодруулга «Сайн байна уу!»-гаар эхэлдэг тул хариуны эхний мэндчилгээг хасна (SkinAid-ийн нэмэлт, 2026-11-26: анхны
 * бодит ноорогт «Сайн байна уу» хоёр удаа давхардсан). Үлдсэн хэсгийн эхний үсгийг томруулна. Хасаад хоосон бол ''.
 * @param {string} body
 */
export function stripLeadingGreeting(body) {
  const rest = String(body ?? '').replace(LEADING_GREETING, '').trim();
  return rest ? rest.charAt(0).toLocaleUpperCase('mn') + rest.slice(1) : '';
}

/** Илгээх текст = (тодруулга) + хариу (тодруулгатай үед хариуны мэндчилгээг давхардуулахгүй); 2000 тэмдэгтэд багтаана */
export function composeBotReply(reply, { clinicName, withDisclosure }) {
  const body = String(reply ?? '').trim();
  if (!withDisclosure) return body.slice(0, 2000);
  const rest = stripLeadingGreeting(body);
  return (rest ? `${aiDisclosure(clinicName)}\n\n${rest}` : aiDisclosure(clinicName)).slice(0, 2000);
}

/** Зураг, видео, дуу, файл ирэхэд (LLM-гүй) */
export const MEDIA_REPLY =
  'Таны илгээсэн файлыг хүлээн авлаа. AI туслах зураг, бичлэгийг харж дүгнэлт гаргахгүй — манай эмч, ажилтан тантай удахгүй холбогдоно.';

/** Хүнд шилжүүлэхэд («Автомат» горимд илгээнэ — дараа нь бот тэр ярианд чимээгүй) */
export const HANDOFF_REPLY = 'Таны асуултыг манай ажилтанд дамжууллаа. Ажлын цагаар удахгүй хариулна. Түр хүлээнэ үү.';

/**
 * Загвар хариу (handoff, зураг, яаралтай) — энэ ярианд ботын АНХНЫ мессеж бол (эсвэл удаан завсарласан / хүнээс буцсан)
 * өмнө нь «Би …-ийн AI туслах» гэж танилцуулна: хэрэглэгч автомат хариу авч байгаагаа мэднэ. 2000 тэмдэгтэд багтаана.
 * @param {string} template @param {{ clinicName?: string, withDisclosure?: boolean }} o
 */
export function handoffMessage(template, { clinicName, withDisclosure } = {}) {
  const body = String(template ?? '').trim();
  return (withDisclosure && body ? `${aiIntro(clinicName)} ${body}` : body).slice(0, 2000);
}

/**
 * «Холбоо барих» мөр — утас/имэйл асуусан хариуны доор КОД нэмнэ (LLM-д дугаар, хаяг очдоггүй, LLM бичдэггүй).
 * Анхны бодит eval (2026-11-26): утас/имэйлийн асуулт бүр ажилтанд шилждэг байв — prompt «систем нэмнэ» гэдэг ч код нэмдэггүй байсан.
 * @param {{ phone?: string|null, email?: string|null }} c
 * @returns {string} хоосон = нэмэх зүйл алга
 */
export function contactLine(c) {
  const phone = String(c?.phone ?? '').trim();
  const email = String(c?.email ?? '').trim();
  const parts = [phone ? `утас ${phone}` : '', email ? `имэйл ${email}` : ''].filter(Boolean);
  return parts.length ? `Холбоо барих: ${parts.join(' · ')}` : '';
}

/** Яаралтай (гаж нөлөө) — утсыг код залгана */
export function urgentReply(clinicPhone) {
  const phone = String(clinicPhone ?? '').trim();
  return phone
    ? `Таны биеийн байдал санаа зовоож байвал яаралтай ${phone} утсаар холбогдоно уу. Манай эмч, ажилтан тантай удахгүй холбогдоно.`
    : 'Таны биеийн байдал санаа зовоож байвал эмнэлэгтэй яаралтай утсаар холбогдоно уу. Манай эмч, ажилтан тантай удахгүй холбогдоно.';
}

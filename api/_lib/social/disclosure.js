/**
 * Messenger AI — КОДЫН бичдэг тогтмол текстүүд (LLM бичихгүй, хасаж чадахгүй). ЦЭВЭР модуль.
 * Эх сурвалж: skinaid/ubbeauty@1a43c95c src/lib/social/disclosure.ts (агуулга өөрчлөгдөөгүй).
 *
 *   · AI тодруулга — Meta-ийн бодлого: эхний ботын хариу, удаан завсарласны дараа, хүнээс бот руу буцахад.
 *     1-р үе шатанд ИЛГЭЭХГҮЙ — ноорогт «бот илгээх байсан» текстийг харуулахад л (`composeBotReply`).
 *   · Зураг/видео/дууны загвар хариу — AI зураг харахгүй, онош тавихгүй.
 *   · Яаралтай сэдэвт эмнэлгийн утсыг КОД нэмнэ (LLM утасны дугаар харахгүй — assertNoPii).
 */

/** Сүүлийн ботын хариунаас хойш ийм хугацаа өнгөрвөл тодруулгыг дахин залгана */
export const DISCLOSURE_GAP_HOURS = 24;

export function aiDisclosure(clinicName) {
  const name = String(clinicName ?? '').trim().slice(0, 80) || 'Эмнэлгийн';
  return (
    `Сайн байна уу! Би ${name}-ийн AI туслах. Ерөнхий мэдээлэл, цаг захиалгад тусална. ` +
    'Эмчийн зөвлөгөө шаардлагатай асуултад манай ажилтан, эмч хариулна. Хүссэн үедээ «Ажилтантай ярих» гэж бичнэ үү.'
  );
}

/** Тодруулга залгах эсэх: энэ ярианд бот анх удаа, эсвэл удаан завсарласан, эсвэл хүнээс буцсан */
export function needsDisclosure({ lastBotAt, now, returnedFromHuman }) {
  if (returnedFromHuman || !lastBotAt) return true;
  return now.getTime() - lastBotAt.getTime() >= DISCLOSURE_GAP_HOURS * 3600_000;
}

/** Илгээх текст = (тодруулга) + хариу; Messenger-ийн 2000 тэмдэгтэд багтаана */
export function composeBotReply(reply, { clinicName, withDisclosure }) {
  const body = String(reply ?? '').trim();
  const text = withDisclosure ? `${aiDisclosure(clinicName)}\n\n${body}` : body;
  return text.slice(0, 2000);
}

/** Зураг, видео, дуу, файл ирэхэд (LLM-гүй) */
export const MEDIA_REPLY =
  'Таны илгээсэн файлыг хүлээн авлаа. AI туслах зураг, бичлэгийг харж дүгнэлт гаргахгүй — манай эмч, ажилтан тантай удахгүй холбогдоно.';

/** Хүнд шилжүүлэхэд (3-р үе шатнаас илгээнэ) */
export const HANDOFF_REPLY = 'Таны асуултыг манай ажилтанд дамжууллаа. Ажлын цагаар удахгүй хариулна. Түр хүлээнэ үү.';

/** Яаралтай (гаж нөлөө) — утсыг код залгана */
export function urgentReply(clinicPhone) {
  const phone = String(clinicPhone ?? '').trim();
  return phone
    ? `Таны биеийн байдал санаа зовоож байвал яаралтай ${phone} утсаар холбогдоно уу. Манай эмч, ажилтан тантай удахгүй холбогдоно.`
    : 'Таны биеийн байдал санаа зовоож байвал эмнэлэгтэй яаралтай утсаар холбогдоно уу. Манай эмч, ажилтан тантай удахгүй холбогдоно.';
}

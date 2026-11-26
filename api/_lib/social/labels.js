/**
 * Messenger AI — горим, чиглэл (route), үнэлгээний шошго. ЦЭВЭР модуль (import: ./intents.js).
 * Эх сурвалж: skinaid/ubbeauty@1a43c95c src/lib/social/labels.ts.
 * SkinAid-д өөрчилсөн: DB CHECK-ийн оронд firestore.rules-тэй ижил байх ёстой (tools/test/messenger-rules.test.mjs
 * тулгана); `cap_reached`, `refusal`, `not_configured` шалтгаан нэмсэн; hint-ийн «UB Beauty» → admin «Ноорог».
 * Admin (admin/m-messenger.js) нь хөтөч дээр ажилладаг тул эдгээр текстийг тусад нь давхарлана — тест тулгана.
 */
import { intentDef } from './intents.js';

/** @typedef {'off' | 'shadow'} SocialMode */
/** @typedef {'auto_candidate' | 'draft' | 'handoff' | 'silent'} SocialRoute */
/** @typedef {'good' | 'edited' | 'wrong'} SocialRating */

/** 1-р үе шат: зөвхөн off | shadow (assist/auto = 3-р үе шат) */
export const SOCIAL_MODES = Object.freeze(['off', 'shadow']);

export const SOCIAL_MODE_TEXT = Object.freeze({
  off: { label: 'Унтраалттай', hint: 'Мессежийг хадгалахгүй, AI ажиллахгүй.' },
  shadow: {
    label: 'Сүүдэр',
    hint: 'AI хариуны ноорог бичнэ, үйлчлүүлэгч рүү ЮУ Ч илгээхгүй. Ажилтан Meta Inbox-оос өөрөө хариулж, «Ноорог» хэсэгт үнэлгээ өгнө.',
  },
});

export const isSocialMode = (v) => v === 'off' || v === 'shadow';
export const socialModeText = (mode) => SOCIAL_MODE_TEXT[mode]?.label ?? String(mode);

/** Код шийдсэн чиглэл */
export const SOCIAL_ROUTES = Object.freeze(['auto_candidate', 'draft', 'handoff', 'silent']);

export const SOCIAL_ROUTE_TEXT = Object.freeze({
  auto_candidate: {
    label: 'Автомат боломжтой',
    tone: 'success',
    hint: 'Зөвшөөрсөн сэдэв, эх сурвалжтай, шалгалт тэнцсэн — автомат горимд (3-р үе шат) илгээгдэх байсан.',
  },
  draft: { label: 'Хүн хянана', tone: 'info', hint: 'Ноорог л — хүн засаж, баталж байж явна.' },
  handoff: { label: 'Ажилтанд шилжүүлнэ', tone: 'warning', hint: 'Эрсдэлтэй сэдэв — бот хариулахгүй, ажилтан хариулна.' },
  silent: { label: 'Чимээгүй', tone: 'neutral', hint: 'Ажилтан энэ ярианд хариулж байна — бот оролцохгүй.' },
});

export const socialRouteText = (route) => SOCIAL_ROUTE_TEXT[route]?.label ?? String(route);
export const socialIntentText = (intent) => intentDef(intent).label;

/** Ажилтны үнэлгээ (firestore.rules messenger_drafts.rating-тай ИЖИЛ) */
export const SOCIAL_RATINGS = Object.freeze(['good', 'edited', 'wrong']);
export const SOCIAL_RATING_TEXT = Object.freeze({ good: 'Зөв', edited: 'Засвартай', wrong: 'Буруу' });

/** Бодлогын шалтгааны код → ажилтанд харагдах тайлбар */
export const SOCIAL_REASON_TEXT = Object.freeze({
  human_active: 'Ажилтан энэ ярианд хариулж байна',
  intent_human: 'Сэдэв нь үргэлж хүнд очдог',
  signal: 'Текстэд эрсдэлийн дохио илэрсэн',
  llm_needs_human: 'AI хүнд шилжүүлэхийг санал болгосон',
  low_confidence: 'AI итгэл бага',
  empty_reply: 'Хариу хоосон',
  invented_price: 'Мэдлэгт байхгүй үнэ дурдсан',
  invented_percent: 'Мэдлэгт байхгүй хувь дурдсан',
  invented_offer: 'Мэдлэгт байхгүй хөнгөлөлт, бэлэг, үнэгүй санал дурдсан',
  long_reply: 'Энэ сэдэвт хэт урт хариу',
  lint_block: 'Хориотой хэллэг / хэлбэрийн алдаа',
  placeholder: 'Хувьсагч ({…}) орсон',
  no_source: 'Эх сурвалж заагаагүй',
  unknown_source: 'Мэдэгдэхгүй эх сурвалж заасан',
  injection: 'Мессеж AI-д заавар өгөх оролдлоготой',
  media: 'Зураг, видео, дуу — AI харахгүй',
  cap_reached: 'Сарын хязгаарт хүрсэн — AI ажиллаагүй',
  refusal: 'AI хариулахаас татгалзсан',
  invalid_output: 'AI-ийн гаралт буруу хэлбэртэй',
});

export function socialReasonText(code) {
  const s = String(code ?? '');
  const base = s.split(':')[0];
  const extra = s.includes(':') ? s.slice(s.indexOf(':') + 1) : '';
  const text = SOCIAL_REASON_TEXT[base] ?? base;
  if (!extra) return text;
  // signal:<нэр> — injection-ээс бусад дохионы нэр = сэдвийн түлхүүр (intents.js SIGNAL_INTENT)
  if (base === 'intent_human' || base === 'signal') return `${text} (${socialIntentText(extra)})`;
  return `${text} (${extra})`;
}

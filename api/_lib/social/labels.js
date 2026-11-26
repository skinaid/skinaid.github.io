/**
 * Messenger AI — горим, чиглэл (route), үнэлгээний шошго. ЦЭВЭР модуль (import: ./intents.js).
 * Эх сурвалж: skinaid/ubbeauty@1a43c95c src/lib/social/labels.ts.
 * SkinAid-д өөрчилсөн: DB CHECK-ийн оронд firestore.rules-тэй ижил байх ёстой (tools/test/messenger-rules.test.mjs
 * тулгана); `cap_reached`, `refusal`, `not_configured` шалтгаан нэмсэн; hint-ийн «UB Beauty» → admin «Ноорог».
 * Admin (admin/m-messenger.js) нь хөтөч дээр ажилладаг тул эдгээр текстийг тусад нь давхарлана — тест тулгана.
 */
import { intentDef } from './intents.js';

/** @typedef {'off' | 'shadow' | 'auto'} SocialMode */
/** @typedef {'test' | 'all'} SocialAudience */
/** @typedef {'auto_candidate' | 'draft' | 'handoff' | 'silent'} SocialRoute */
/** @typedef {'good' | 'edited' | 'wrong'} SocialRating */

/** off | shadow | auto (3-р үе шат: зөвшөөрсөн сэдэвт шууд хариулна — api/_lib/outbound.js sendGuarded л илгээнэ) */
export const SOCIAL_MODES = Object.freeze(['off', 'shadow', 'auto']);

export const SOCIAL_MODE_TEXT = Object.freeze({
  off: { label: 'Унтраалттай', hint: 'Мессежийг хадгалахгүй, AI ажиллахгүй.' },
  shadow: {
    label: 'Сүүдэр',
    hint: 'AI хариуны ноорог бичнэ, үйлчлүүлэгч рүү ЮУ Ч илгээхгүй. Ажилтан Meta Inbox-оос өөрөө хариулж, «Ноорог» хэсэгт үнэлгээ өгнө.',
  },
  auto: {
    label: 'Автомат',
    hint: 'Зөвшөөрсөн сэдэвт (мэнд, цаг, хаяг, холбоо барих, үйлчилгээ, мэдлэгт бичигдсэн үнэ) AI Messenger-т ШУУД хариулна. Эмнэлгийн асуулт, гаж нөлөө, гомдол, мөнгө, зураг/видеог «ажилтанд дамжууллаа» гэж мэдэгдээд ажилтанд үлдээнэ.',
  },
});

export const isSocialMode = (v) => SOCIAL_MODES.includes(v);

/** «Автомат» горимд хэнд илгээх вэ (messenger_settings/main.autoAudience; firestore.rules-тэй ИЖИЛ). Анхдагч = test. */
export const SOCIAL_AUDIENCES = Object.freeze(['test', 'all']);
export const SOCIAL_AUDIENCE_TEXT = Object.freeze({
  test: { label: 'Зөвхөн туршилтын акаунт', hint: 'Доорх жагсаалтад байгаа акаунтад л шууд хариулна. Бусад үйлчлүүлэгчид юу ч илгээхгүй (сүүдэр хэвээр).' },
  all: { label: 'Бүх үйлчлүүлэгч', hint: 'Пэйж рүү бичсэн хүн бүрд шууд хариулна.' },
});
/** Туршилтын акаунтын дээд тоо (firestore.rules, admin/messenger-lib.js-тэй ИЖИЛ) */
export const TEST_THREADS_MAX = 10;
export const socialModeText = (mode) => SOCIAL_MODE_TEXT[mode]?.label ?? String(mode);

/** Код шийдсэн чиглэл */
export const SOCIAL_ROUTES = Object.freeze(['auto_candidate', 'draft', 'handoff', 'silent']);

export const SOCIAL_ROUTE_TEXT = Object.freeze({
  auto_candidate: {
    label: 'Автомат боломжтой',
    tone: 'success',
    hint: 'Зөвшөөрсөн сэдэв, эх сурвалжтай, шалгалт тэнцсэн — «Автомат» горимд шууд илгээгдэнэ (сүүдэрт: илгээгдэх байсан).',
  },
  draft: { label: 'Хүн хянана', tone: 'info', hint: 'Ноорог л — хүн засаж, баталж байж явна.' },
  handoff: { label: 'Ажилтанд шилжүүлнэ', tone: 'warning', hint: 'Эрсдэлтэй сэдэв — бот хариулахгүй («Автомат» горимд «ажилтанд дамжууллаа» гэж мэдэгдэнэ), ажилтан хариулна.' },
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
  foreign_script: 'Кирилл биш үсгээр бичсэн (латин г.м.) — кодын эрсдэлийн шалгалт уншдаггүй тул «Автомат» горимд ажилтанд',
  ai_error: 'AI алдаа гарсан — ажилтанд шилжүүлсэн',
  thread_cap: 'Энэ ярианд өнөөдрийн AI хариуны хязгаарт хүрсэн',
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

/**
 * Илгээлтийн төлөв (ноорогийн `sendStatus`: sent | failed | skipped) ба шалтгаан (`sendReason`) → ажилтанд харагдах текст.
 * Шалтгаан = api/_lib/outbound.js-ийн хамгаалалтын код эсвэл Meta-ийн алдааны ангилал (meta-client.js MetaErrorKind).
 * Admin (admin/messenger-lib.js SEND_REASON_TEXT) давхарлана — тест тулгана.
 */
export const SEND_STATUSES = Object.freeze(['sent', 'failed', 'skipped']);
export const SEND_REASON_TEXT = Object.freeze({
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
});
export const sendReasonText = (code) => SEND_REASON_TEXT[String(code ?? '')] ?? String(code ?? '');

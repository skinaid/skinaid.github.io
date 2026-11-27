/**
 * Messenger AI — мессежийн СЭДЭВ ба эрсдэлийн дохио. ЦЭВЭР модуль (runtime import-гүй).
 * Эх сурвалж: skinaid/ubbeauty@1a43c95c src/lib/social/intents.ts (TS → JS, агуулга өөрчлөгдөөгүй).
 *
 * Зарчим: LLM сэдвийг САНАЛ БОЛГОНО, хүнд шилжүүлэх эсэхийг КОД шийднэ. Код энд монгол түлхүүр үгээр эрсдэлийн
 * дохиог өөрөө илрүүлдэг — LLM «мэнд» гэж ангилсан ч «хавдсан», «мөнгөө буцаа» гэх мэт үг байвал үргэлж хүнд
 * (policy.js). Илрүүлэгч нь нууцалсан (redactForLlm) текст дээр ажиллана.
 */

/**
 * @typedef {'greeting'|'thanks'|'hours'|'location'|'contact'|'service_info'|'price'|'promotion'|'booking'|
 *   'human_request'|'medical'|'side_effect'|'complaint'|'refund'|'discount'|'legal'|'sensitive_group'|'media'|'other'} SocialIntent
 * @typedef {{ key: SocialIntent, label: string, risk: 'auto'|'human', needsSource: boolean }} IntentDef
 * @typedef {'side_effect'|'medical'|'complaint'|'refund'|'discount'|'legal'|'sensitive_group'|'human_request'|'injection'} RiskSignal
 */

/** risk: auto = зөвшөөрсөн сэдэв (3-р үе шатанд автоматаар хариулж болох); human = ҮРГЭЛЖ хүнд.
 *  needsSource: мэдээллийн хариу — эмнэлгийн мэдлэгээс иш заавал. @type {readonly IntentDef[]} */
export const INTENTS = Object.freeze([
  { key: 'greeting', label: 'Мэндчилгээ', risk: 'auto', needsSource: false },
  { key: 'thanks', label: 'Талархал', risk: 'auto', needsSource: false },
  { key: 'hours', label: 'Цагийн хуваарь', risk: 'auto', needsSource: true },
  { key: 'location', label: 'Хаяг, байршил', risk: 'auto', needsSource: true },
  { key: 'contact', label: 'Холбоо барих', risk: 'auto', needsSource: false },
  { key: 'service_info', label: 'Үйлчилгээний мэдээлэл', risk: 'auto', needsSource: true },
  { key: 'price', label: 'Үнэ', risk: 'auto', needsSource: true },
  { key: 'promotion', label: 'Урамшуулал', risk: 'auto', needsSource: true },
  { key: 'booking', label: 'Цаг захиалах', risk: 'auto', needsSource: false },
  { key: 'human_request', label: 'Ажилтантай ярих', risk: 'human', needsSource: false },
  { key: 'medical', label: 'Эмнэлгийн (хувь хүний) асуулт', risk: 'human', needsSource: false },
  { key: 'side_effect', label: 'Гаж нөлөө, яаралтай', risk: 'human', needsSource: false },
  { key: 'complaint', label: 'Гомдол', risk: 'human', needsSource: false },
  { key: 'refund', label: 'Мөнгө буцаалт, төлбөрийн маргаан', risk: 'human', needsSource: false },
  { key: 'discount', label: 'Хөнгөлөлт гуйх', risk: 'human', needsSource: false },
  { key: 'legal', label: 'Хуулийн асуудал', risk: 'human', needsSource: false },
  { key: 'sensitive_group', label: 'Насанд хүрээгүй, жирэмсэн, хөхүүл', risk: 'human', needsSource: false },
  { key: 'media', label: 'Зураг, видео, дуу', risk: 'human', needsSource: false },
  { key: 'other', label: 'Тодорхойгүй', risk: 'human', needsSource: false },
].map((d) => Object.freeze(d)));

/** @type {readonly SocialIntent[]} */
export const INTENT_KEYS = Object.freeze(INTENTS.map((i) => i.key));

const BY_KEY = new Map(INTENTS.map((i) => [i.key, i]));

/** @returns {IntentDef} */
export function intentDef(key) {
  return (typeof key === 'string' && BY_KEY.get(key)) || BY_KEY.get('other');
}

export function isIntent(key) {
  return typeof key === 'string' && BY_KEY.has(key);
}

/** Дохио → сэдэв (injection-ээс бусад нь ҮРГЭЛЖ хүнд) */
export const SIGNAL_INTENT = Object.freeze({
  side_effect: 'side_effect',
  medical: 'medical',
  complaint: 'complaint',
  refund: 'refund',
  discount: 'discount',
  legal: 'legal',
  sensitive_group: 'sensitive_group',
  human_request: 'human_request',
});

// JS-ийн \b кирилл дээр ажилладаггүй — үгийн ЭХЛЭЛИЙГ \p{L}-ээр тогтооно (язгуураар таних)
const W = (body) => new RegExp(`(?<!\\p{L})(?:${body})`, 'iu');

/** @type {readonly (readonly [RiskSignal, RegExp])[]} */
const PATTERNS = [
  [
    'side_effect',
    // 2026-11-27 (eval): «хавдаад», «улайгаад», «идээ гарсан», «хөхөрөөд», «хөх ягаан» нэмсэн
    W(
      'гаж\\s*нөлөө|хавд|улай(?:сан|ж|лт|чих|гаад)|загатн|тууралт|харшил|цэврүү|идээ(?:л|тэй|\\s+(?:гар|бээр|үүс))|' +
        'өвд(?:өж|өөд|өлт|сөн|өөсөн)|халуур|яаралтай|түлэгд|цус\\s*(?:гар|алд)|хөхөр|хөх\\s*ягаан|муудаад|дордсон',
    ),
  ],
  [
    'medical',
    W(
      '(?:надад|миний\\s+арьсанд?|арьсанд\\s+минь)\\s+(?:\\p{L}+\\s+){0,3}(?:тохир|хэрэгтэй|болох)|тохирох\\s+болов\\s+уу|' +
        'тохирох\\s+уу|онош|ямар\\s+эмчилгээ|юу\\s+хийлгэ|эм\\s+(?:уух|ууж|хэрэглэ)|арьсны\\s+өвчин|өвчтэй|эмчилгээ\\s+хэрэгтэй',
    ),
  ],
  [
    'complaint',
    W(
      'гомдол|сэтгэл\\s+дундуур|муу\\s+үйлчилгээ|хууртагд|хуурсан|луйвар|хариуцлага|бүтэлгүй|ичмээр|' +
        'хүндэтгэлгүй|эвгүй\\s+харьц|бүдүүлэг|загнасан|хүлээлгэсэн',
    ),
  ],
  [
    'refund',
    // 2026-11-27 (eval): «буцааж/буцаах/буцаана» — өмнө нь «буца»+«аах» (гурван «а») хайдаг байсан тул «буцаалт» л танигддаг.
    // «буцааж залгаарай / холбогдоорой / бичээрэй» (эргэж холбогдох) — мөнгө буцаалт БИШ (аудит)
    W('буца(?:алт|ах|ана|ачих|аж(?!\\s+(?:залга|холбо|бич|ярь|яри|хариу|мэдэгд)))|мөнгө(?:ө|гөө)?\\s+(?:буца|өгөөч)|давхар\\s+(?:төл|гүйлг)|төлбөр\\p{L}*\\s+(?:\\p{L}+\\s+){0,2}(?:буруу|алдаа)'),
  ],
  // 2026-11-27 (eval): «үнээ / үнийг буулгаач» — өмнө нь «үнэээ», «үнэийг» хайдаг байсан
  ['discount', W('хөнгөлөлт\\s+(?:хийж|үзүүлж|өгч|өгөөч|хийгээч)|хямдруул|(?:үнэ|үнээ|үнийг)(?:\\s+нь)?\\s+(?:буулга|бууруул|хямдруул)|тусгай\\s+үнэ')],
  ['legal', W('шүүх|цагдаа|өмгөөлөгч|нэхэмжл|хуулийн|хуулиар|гэрээ\\s+цуцл|мэдээлл\\p{L}*\\s+устга')],
  ['sensitive_group', W('жирэмсэн|хөхүүл|хөхөөр\\s+хоолл|насанд\\s+хүрээгүй|хүүхд(?:эд|ийн|ийг)|хүүхэд\\s+(?:маань|минь|хийлгэ)')],
  [
    'human_request',
    // 2026-11-27 (eval): «хүнтэй ярих», «эмчтэй ярих» (өмнө нь «ярь» л)
    // 2026-11-27 (шалгалт): «над руу залгаарай», «эргээд/буцааж залгаарай», «залгана уу» — үйлчлүүлэгч ӨӨР рүүгээ залгуулах
    // хүсэлт = ажилтан (эмнэлгийн утсыг асуух биш; «залгаж болох уу» энд ОРОХГҮЙ — тэр нь contact)
    W('ажилтан(?:тай|д|ыг)|хүнтэй\\s+яр(?:ь|и)|оператор|менежер|эмчтэй\\s+(?:яр(?:ь|и)|холбо|уулз|зөвлө)|залгаж\\s+өг|ярих\\s+хүн|админ(?:тай)?|' +
      '(?:над|надад|бид)\\s*р[уү]у\\s+залга|(?:эргэ\\p{L}*|буцааж|буцаад)\\s+залга|залгаарай|залгана\\s+уу|залгуул'),
  ],
  [
    'injection',
    // SkinAid (аудит 2026-11-25): монгол хэллэгүүд — «дүрмээ орхи», «зааврыг үл тоо», «... гэж ангил», «чи одоо ... болно»
    /(?:өмнөх\s+заавр|зааврыг\s+март|заавраа\s+март|заавр\p{L}*\s+(?:орхи|үл\s+тоо|бүү\s+дага)|дүрм\p{L}*\s+(?:орхи|март|зөрч|үл\s+тоо)|гэж\s+ангил|ангилал\p{L}*\s+\p{L}+\s+болго|чи\s+одоо\s+(?:\p{L}+\s+){0,3}(?:болно|юм|байна)|систем\p{L}*\s+(?:заавар|промпт)|промпт|system\s*prompt|ignore\s+(?:all|previous|the)|you\s+are\s+now|developer\s+mode|jailbreak|prompt\s+injection)/iu,
  ],
];

/** «14 настай», «16 настай охин» — 18-аас доош нас дурдсан бол sensitive_group */
const AGE_RE = /(?<!\d)(\d{1,2})\s*(?:нас|настай|наст)/giu;

/** Аюулгүй, богино гадаад / галиг үг — мэнд, талархал, зөвшөөрөл («ok», «hi», «sain bn uu», «za», «bayarlalaa») гэхэд
 *  ажилтанд шилжүүлэхгүй. ЗӨВХӨН эрсдэлийн утга авч чадахгүй үг (эмчилгээ, мөнгө, бие, хүсэлтийн үг ЭНД ОРОХГҮЙ). */
const HARMLESS_FOREIGN = new Set([
  'ok', 'okay', 'okey', 'hi', 'hello', 'hey', 'thanks', 'thank', 'you', 'thx', 'tnx', 'ty', 'bye', 'yes', 'no', 'pls',
  'sain', 'sn', 'bn', 'bna', 'baina', 'bnu', 'bnuu', 'uu', 'yy', 'snu', 'sainuu', 'za', 'zaa', 'zaza', 'tiim', 'tim',
  'bayarlalaa', 'bayarllaa', 'bayrlalaa', 'bayarlaa', 'bayrlaa',
]);

/**
 * Мессежид КОД ТАНИХГҮЙ кирилл биш үг (латин галиг, англи, бусад бичиг) байгаа эсэх. Дээрх эрсдэлийн дохионы бүх загвар
 * кирилл монгол үгээр бичигдсэн тул «nuur havdaad bn», «mungu butsaaj avmaar bn», «нүүр havdsan» зэргийг КОД барьж
 * чадахгүй (аудит 2026-11-26) — «Автомат» горимд ийм мессежид AI шууд хариулахгүй, ажилтанд шилжүүлнэ (policy.js).
 * Дүрэм: кирилл биш үг (≥ 2 үсэг) НЭГ л байвал — дараахаас бусад:
 *   · мэнд/талархал/зөвшөөрлийн аюулгүй үгс (HARMLESS_FOREIGN: «ok», «sain bn uu», «za bayarlalaa»);
 *   · эмнэлгийн ӨӨРИЙН мэдлэгт (каталог, FAQ, хуудас — `knownText`) байгаа үг: брэнд, үйлчилгээний нэр («Botox», «HIFU»).
 * Тоон харьцаанд суурилсан таамаг БИШ — холимог бичвэрт ганц эрсдэлтэй латин үг («Сайн уу, havdsan») ч баригдана.
 * Нууцлалын тэмдэг («[утас]», «[имэйл]») үгэнд тоологдохгүй.
 * @param {string} text  хэрэглэгчийн (нууцалсан) текст
 * @param {string} [knownText]  мэдлэгийн бүх текст (доторх кирилл биш үгс «танигдсан» болно)
 */
export function isForeignScript(text, knownText = '') {
  const foreignWords = (t) => (String(t ?? '').replace(/\[[^\]\n]{0,40}\]/g, ' ').match(/\p{L}{2,}/gu) || [])
    .filter((w) => !/\p{Script=Cyrillic}/u.test(w)).map((w) => w.toLowerCase());
  const words = foreignWords(text).filter((w) => !HARMLESS_FOREIGN.has(w));
  if (!words.length) return false;
  const known = new Set(foreignWords(knownText));
  return words.some((w) => !known.has(w));
}

/** Нууцалсан текст дэх эрсдэлийн дохио (давхардалгүй, тогтмол дараалал) @returns {RiskSignal[]} */
export function detectRiskSignals(text) {
  const s = String(text ?? '');
  if (!s.trim()) return [];
  /** @type {RiskSignal[]} */
  const out = [];
  for (const [signal, re] of PATTERNS) if (re.test(s)) out.push(signal);
  if (!out.includes('sensitive_group')) {
    for (const m of s.matchAll(AGE_RE)) {
      const age = Number(m[1]);
      if (Number.isFinite(age) && age > 0 && age < 18) {
        out.push('sensitive_group');
        break;
      }
    }
  }
  return out;
}

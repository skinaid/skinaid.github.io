/**
 * Messenger AI — нэг ярианы event-үүдийг (цагийн дарааллаар) боловсруулах ТӨЛӨВЛӨГӨӨ. ЦЭВЭР модуль
 * (import: node:crypto); I/O нь ../pipeline.js.
 * Эх сурвалж: skinaid/ubbeauty@1a43c95c src/lib/social/conversation-logic.ts (TS → JS, логик өөрчлөгдөөгүй).
 *
 * Төлвийн машин:
 *   · echo-г `classifyEcho`-оор гурав ангилна: манай апп (META_APP_ID) = ботын мессеж; Meta-ийн өөрийн автоматжуулалт
 *     (Business Suite-ийн Auto reply, Away message, FAQ, Hours…) = «automation» — хүн хариулсан БИШ, төлөв өөрчлөхгүй;
 *     бусад = ажилтан (state = human, бот чимээгүй). Page Inbox-оос илгээсэн бүх echo (хүн ч, автомат ч) ижил
 *     app_id (263902037430900)-тай ирдэг тул автомат хариуг ХУГАЦААГААР танина: хэрэглэгчийн мессежээс
 *     `AUTOMATION_ECHO_MS` дотор ирсэн echo = автомат. Мөн: ижил текст (`echoFingerprint`) ≥ 3 өөр ярианд гарсан =
 *     автомат загвар; хэрэглэгч огт бичээгүй ярианы echo = Page-ээс эхэлсэн автомат (Comment to message, зарын greeting).
 *     Сүүдэр горимд алдах эрсдэл бага (ажилтныг автомат гэж үзвэл зөвхөн илүү ноорог бичнэ).
 *     2026-11-27: ангилал бүр ШАЛТГААНТАЙ (`classifyEchoWhy` → own_app | known_app | template | no_user | fast_gap | default) —
 *     мессеж ба өдрийн тоологчид хадгалж бодит echo-гоор тохируулна. `echoPolicy: 'strict'` — «Автомат» горимын АМЬД ярианд
 *     (бот шууд хариулдаг; pipeline.js): тодорхойгүй echo (no_user, 8 с-ээс удаан) = АЖИЛТАН (бот ажилтны яриаг таслахгүй);
 *     зөвхөн манай апп, ≥ 3 ярианд давтагдсан загвар, ≤ 8 с-ийн хариу автомат. Сүүдэр ярианд анхдагч 'shadow'.
 *   · Манай ботын ӨӨРИЙН илгээсэн мессеж (outbound.js): илгээсэн даруйд thread-д `own` мөрөөр бичигддэг (id = echo-гийн
 *     event id). Echo ирэхэд `knownEchoes` түүнийг таньж, бодит ирсэн цагаар БИШ «логик байрлал»-аар (хариулсан хэрэглэгчийн
 *     мессежийн яг дараа) эрэмбэлнэ — хэрэглэгч AI бодож байх хооронд дараагийн мессежээ бичсэн бол тэр мессеж «хариулсан»
 *     болж алгасагдахгүй.
 *   · take_thread_control → human; бидэнд pass_thread_control → bot.
 *   · хүн 12 цаг идэвхгүй байхад хэрэглэгч бичвэл → bot руу буцна (хүний сүүлийн хариу, хүнд шилжсэн мөчийн СҮҮЛИЙНХЭЭС).
 *   · standby (өөр апп яриаг эзэмшиж байна) мессежийг хадгална; ноорог бичсээр, action.standby = true — илгээхгүй
 *     (outbound.js: thread эзэмшээгүй үед Meta code 10 / 2018300 буцаана).
 * Үйлдэл: горим off → бүгд «skipped»; эс бөгөөс хэрэглэгчийн сүүлийн мессеж хүний/ботын хариунаас хойш байвал —
 * зөвхөн хавсралт = LLM-гүй загвар (зөвхөн стикер бол action.stickerOnly), текст = НЭГ агентын ажиллагаа (дараалсан
 * мессежүүдэд нэг ноорог).
 */
import { createHash } from 'node:crypto';

/** Ажилтан хариулснаас хойш ийм хугацаа идэвхгүй бол бот яриаг буцааж авна */
export const HUMAN_IDLE_HOURS = 12;
/** Хэрэглэгчийн мессежээс хойш ийм хурдан ирсэн пэйжийн echo = Meta-ийн автомат хариу (хүн биш) */
export const AUTOMATION_ECHO_MS = 15_000;
/** strict бодлого (3-р үе шат): илүү нарийн босго — production-д Meta-ийн автомат хариу 2–4 с, ажилтан ~1 цаг (2026-11-27) */
export const STRICT_AUTOMATION_ECHO_MS = 8_000;
/** Meta-ийн автоматжуулалтын апп id (тогтоогдвол). Page Inbox (263902037430900) энд ОРОХГҮЙ — хүний хариу ч тэр id-тай. */
export const KNOWN_AUTOMATION_APP_IDS = Object.freeze([]);
/** Ижил echo текст ийм тооны ӨӨР ярианд гарсан бол Meta-ийн автомат загвар (messenger_echo_templates) */
export const AUTOMATION_TEMPLATE_MIN_CONVERSATIONS = 3;

/**
 * @typedef {'bot'|'human'|'paused'} ConversationState
 * @typedef {'own_bot'|'automation'|'staff'} EchoSource
 * @typedef {'user'|'staff'|'bot'|'automation'} MessageRole
 * @typedef {'text'|'attachment'|'postback'|'referral'} MessageKind
 * @typedef {{ state: ConversationState, humanSince: Date|null, lastStaffAt: Date|null, lastUserAt: Date|null }} ConversationSnapshot
 * @typedef {{ id: string, kind: import('./meta-events.js').SocialEventKind, mid: string|null, eventTime: Date,
 *   payload: import('./meta-events.js').SocialEventPayload }} StoredEvent
 * @typedef {{ eventId: string, role: MessageRole, textHash: string|null, kind: MessageKind, text: string,
 *   attachments: string[], mid: string|null, sentAt: Date, echoWhy?: string }} PlannedMessage
 * @typedef {{ type: 'none', reason: 'mode_off'|'human_active'|'no_user_message'|'already_answered' }
 *   | { type: 'agent', replyToEventId: string, standby?: true }
 *   | { type: 'media_template', replyToEventId: string, standby?: true, stickerOnly?: true }} BatchAction
 *   standby / stickerOnly — зөвхөн үнэн үед талбар байна
 */

/**
 * Echo-гийн текстийн хурууны хээ: НУУЦАЛСАН текстийг normalize (NFKC, жижиг үсэг, зөвхөн үсэг/цифр) → sha256-ийн
 * эхний 32 hex. 8-аас цөөн тэмдэгт («Баярлалаа») → null (хүн ч бичдэг тул тоолохгүй).
 */
export function echoFingerprint(text) {
  const norm = String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (norm.length < 8) return null;
  return createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

/** @typedef {'own_app'|'known_app'|'template'|'no_user'|'fast_gap'|'default'} EchoWhy */
/** Echo-гийн бодлого: shadow (сүүдэр яриа) — тодорхойгүйг автомат гэж үзнэ; strict (амьд яриа) — хэрэглэгчгүй яриа = ажилтан,
 *  хурдан хариуны босго 8 с (Meta-ийн автомат хариу 2–4 с тул автомат хэвээр — бот дуугүй болохгүй; аудит) */
export const ECHO_POLICIES = Object.freeze(['shadow', 'strict']);

/**
 * Пэйжийн echo хэнийх вэ, ЯАГААД — манай бот, Meta-ийн автомат хариу, эсвэл ажилтан.
 * @param {Pick<StoredEvent, 'eventTime' | 'payload'>} echo
 * @param {{ ownAppId: string|null, lastUserAt: Date|null, userWrote?: boolean, automationHashes?: ReadonlySet<string>, policy?: 'shadow'|'strict' }} ctx
 *   userWrote — хэрэглэгч энэ ярианд бичсэн нь мэдэгдэж байгаа ч echo-оос ӨМНӨХ мөч нь тодорхойгүй (lastUserAt = null)
 * @returns {{ source: EchoSource, why: EchoWhy }}
 */
export function classifyEchoWhy(echo, ctx) {
  const app = echo.payload.app_id ?? null;
  if (ctx.ownAppId && app === ctx.ownAppId) return { source: 'own_bot', why: 'own_app' };
  if (app && KNOWN_AUTOMATION_APP_IDS.includes(app)) return { source: 'automation', why: 'known_app' };
  const fp = echoFingerprint(echo.payload.text);
  if (fp && ctx.automationHashes?.has(fp)) return { source: 'automation', why: 'template' };
  const strict = ctx.policy === 'strict';
  // Хэрэглэгч бичсэн ч echo-оос өмнөх мөч тодорхойгүй (echo хоцорч, дараалал алдагдаж ирсэн) — «бичээгүй» гэж бүү андуур:
  // зөрүүг хэмжих боломжгүй тул ажилтан гэж үзнэ (баталгаажуулах аудит; өмнөх зан төлөв)
  if (!ctx.lastUserAt && ctx.userWrote) return { source: 'staff', why: 'default' };
  // Хэрэглэгч энэ ярианд огт бичээгүй — Page-ээс эхэлсэн (Comment to message, зарын greeting)
  if (!ctx.lastUserAt) return { source: strict ? 'staff' : 'automation', why: 'no_user' };
  const gap = echo.eventTime.getTime() - ctx.lastUserAt.getTime();
  if (gap >= 0 && gap <= (strict ? STRICT_AUTOMATION_ECHO_MS : AUTOMATION_ECHO_MS)) return { source: 'automation', why: 'fast_gap' };
  return { source: 'staff', why: 'default' };
}

/** @returns {EchoSource} — classifyEchoWhy-ийн эх сурвалж л */
export function classifyEcho(echo, ctx) {
  return classifyEchoWhy(echo, ctx).source;
}

const hoursBetween = (a, b) => (b.getTime() - a.getTime()) / 3600_000;
const validDate = (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v : null);
/** Хоёр мөчийн сүүлийнх (аль нэг нь null байж болно) */
const laterOf = (a, b) => (a && b ? (a.getTime() >= b.getTime() ? a : b) : a ?? b ?? null);

/**
 * Echo-гийн ӨМНӨХ хэрэглэгчийн мессежийн мөч: энэ багцынх (эрэмбэлсэн тул ≤ echo), эс бөгөөс ярианы lastUserAt — зөвхөн echo-оос
 * өмнө бол. Аудит: дахин боловсруулахад (retry) ярианы lastUserAt аль хэдийн багцын СҮҮЛИЙН мессежээр шинэчлэгдсэн байдаг тул
 * Meta-ийн автомат хариуны зөрүү сөрөг гарч «ажилтан» гэж ангилагдаад бот 12 цаг дуугүй болдог байв.
 */
function userBefore(echoTime, inBatch, convLastUserAt) {
  if (inBatch) return { lastUserAt: inBatch, userWrote: true };
  if (!convLastUserAt) return { lastUserAt: null, userWrote: false };
  return { lastUserAt: convLastUserAt.getTime() <= echoTime.getTime() ? convLastUserAt : null, userWrote: true };
}
const ROLE_SOURCE = { bot: 'own_bot', automation: 'automation', staff: 'staff' };
/**
 * Аль хэдийн хадгалсан echo (өмнөх оролдлогоор ангилагдсан — pipeline message баримтыг уншина): ангиллыг ДАХИН
 * тооцохгүй. Дахин боловсруулахад ярианы төлөв өөрчлөгдсөн байдаг тул шинээр тооцвол өөр гарч болно (баталгаажуулах аудит).
 */
function knownEcho(known, e) {
  const k = known?.get(e.id);
  const source = k && ROLE_SOURCE[k.role];
  return source ? { source, why: k.echoWhy || 'default', own: source === 'own_bot' && Boolean(validDate(k.at)) } : null;
}
/**
 * Манай ботын өөрийн илгээсэн мессежийн echo → «логик байрлал» (хадгалсан мөрийн `at`)-аар; бусад event хэвээр.
 * Зөвхөн role = bot мөрөнд (ажилтан/автомат echo-гийн цагийг хэзээ ч өөрчлөхгүй).
 */
function withLogicalTime(events, known) {
  if (!known || !known.size) return events;
  return events.map((e) => {
    if (e.kind !== 'echo') return e;
    const k = known.get(e.id);
    const at = k && k.role === 'bot' ? validDate(k.at) : null;
    return at ? { ...e, eventTime: at } : e;
  });
}

/**
 * @param {ConversationSnapshot} conv
 * @param {readonly StoredEvent[]} events
 * @param {{ mode: 'off'|'shadow', ownAppId: string|null, now: Date, automationHashes?: ReadonlySet<string>, echoPolicy?: 'shadow'|'strict',
 *   knownEchoes?: ReadonlyMap<string, { role: string, echoWhy?: string|null, at?: Date|null }> }} opts  knownEchoes — өмнө
 *   хадгалсан echo мессеж (event id → ангилал; `at` = манай ботын өөрийн илгээсэн мессежийн логик байрлал)
 */
export function planBatch(conv, events, opts) {
  const sorted = [...withLogicalTime(events, opts.knownEchoes)].sort((a, b) => a.eventTime.getTime() - b.eventTime.getTime());
  /** @type {Record<string, 'done'|'skipped'>} */
  const status = {};
  if (opts.mode === 'off') {
    for (const e of sorted) status[e.id] = 'skipped';
    return {
      messages: [],
      conversation: { ...conv, addedUserMessages: 0, referral: null },
      action: /** @type {BatchAction} */ ({ type: 'none', reason: 'mode_off' }),
      eventStatus: status,
    };
  }

  let state = conv.state;
  let humanSince = conv.humanSince;
  let lastStaffAt = conv.lastStaffAt;
  let lastUserAt = conv.lastUserAt;
  let lastUserInBatch = null;
  let added = 0;
  let referral = null;
  /** @type {PlannedMessage[]} */
  const messages = [];
  // Хэрэглэгчийн сүүлийн мессеж (хариу шаардах) ба түүнээс хойш хүн/бот хариулсан эсэх
  let lastUser = null;
  let answeredAfterUser = false;

  for (const e of sorted) {
    status[e.id] = 'done';
    const text = e.payload.text ?? '';
    const attachments = e.payload.attachments ?? [];
    switch (e.kind) {
      case 'echo': {
        const stored = knownEcho(opts.knownEchoes, e);
        const { source, why } = stored ?? classifyEchoWhy(e, { ownAppId: opts.ownAppId, ...userBefore(e.eventTime, lastUserInBatch, conv.lastUserAt), automationHashes: opts.automationHashes, policy: opts.echoPolicy });
        if (source === 'staff') {
          state = 'human';
          humanSince = humanSince ?? e.eventTime;
          lastStaffAt = e.eventTime;
        }
        messages.push({
          eventId: e.id,
          role: source === 'own_bot' ? 'bot' : source === 'automation' ? 'automation' : 'staff',
          textHash: echoFingerprint(text),
          kind: text ? 'text' : 'attachment',
          text,
          attachments,
          mid: e.mid,
          sentAt: e.eventTime,
          echoWhy: why,
          // Өмнө хадгалсан — өдрийн тоонд дахин тоолохгүй (store.saveBatch)
          ...(stored ? { echoKnown: true } : {}),
          // Манай ботын өөрийн илгээсэн мөр — тэмдгийг хадгална (дахин боловсруулахад логик байрлал алдагдахгүй)
          ...(stored?.own ? { own: true } : {}),
        });
        // Meta-ийн автомат хариу асуултад хариулаагүй гэж үзнэ — сүүдэр ноорог бичигдсээр (үнэлгээнд хэрэгтэй)
        if (lastUser && source !== 'automation') answeredAfterUser = true;
        break;
      }
      case 'handover': {
        if (e.payload.handover === 'take') {
          state = 'human';
          humanSince = humanSince ?? e.eventTime;
        } else if (e.payload.handover === 'pass' && opts.ownAppId && e.payload.app_id === opts.ownAppId) {
          state = 'bot';
          humanSince = null;
        }
        break;
      }
      case 'message':
      case 'attachment':
      case 'postback':
      case 'referral': {
        // Хүний идэвхгүй хугацаа = сүүлийн хариу, хүнд шилжсэн мөчийн СҮҮЛИЙНХЭЭС (бот өөрөө ажилтанд шилжүүлэхэд
        // humanSince = одоо; хуучин lastStaffAt-аар тооцвол дараагийн мессежид шууд буцаад бот болчихно)
        const since = laterOf(lastStaffAt, humanSince);
        if (state === 'human' && (!since || hoursBetween(since, e.eventTime) >= HUMAN_IDLE_HOURS)) {
          state = 'bot';
          humanSince = null;
        }
        const kind = e.kind === 'postback' ? 'postback' : e.kind === 'referral' ? 'referral' : text ? 'text' : 'attachment';
        messages.push({ eventId: e.id, role: 'user', textHash: null, kind, text, attachments, mid: e.mid, sentAt: e.eventTime });
        // Дараалал алдагдсан / хойшилсон багц lastUserAt-ийг ухраахгүй
        if (!lastUserAt || e.eventTime > lastUserAt) lastUserAt = e.eventTime;
        lastUserInBatch = e.eventTime;
        if (e.payload.referral) referral = { ...e.payload.referral, at: e.eventTime };
        added++;
        if (e.kind !== 'referral') {
          lastUser = e;
          answeredAfterUser = false;
        }
        break;
      }
    }
  }

  /** @type {BatchAction} */
  let action;
  if (!lastUser) action = { type: 'none', reason: 'no_user_message' };
  else if (answeredAfterUser) action = { type: 'none', reason: 'already_answered' };
  else if (state !== 'bot') action = { type: 'none', reason: 'human_active' };
  // standby (Page Inbox яриаг эзэмшиж байна): ноорог бичсээр — action.standby-аар outbound.js илгээхгүй
  // (thread эзэмшээгүй — code 10 / 2018300).
  else {
    // Сүүлийн хариулаагүй хэсэгт текст байвал агент (бүх мессежийг нэг ноорогт), эс бөгөөс зөвхөн хавсралт
    const since = lastAnswerAt(sorted, opts.ownAppId, conv.lastUserAt, opts.automationHashes, opts.echoPolicy, opts.knownEchoes);
    const pending = sorted.filter(
      (e) => (e.kind === 'message' || e.kind === 'attachment' || e.kind === 'postback') && (!since || e.eventTime >= since),
    );
    const hasText = pending.some((e) => Boolean(e.payload.text));
    const standby = lastUser.payload.standby === true ? { standby: /** @type {const} */ (true) } : {};
    // Зөвхөн стикер (👍 г.м.) — «файлыг хүлээн авлаа» гэж хариулах, ажилтанд шилжүүлэх шаардлагагүй
    const stickers = pending.flatMap((e) => e.payload.attachments ?? []);
    const stickerOnly = !hasText && stickers.length > 0 && stickers.every((a) => a === 'sticker') ? { stickerOnly: /** @type {const} */ (true) } : {};
    action = hasText
      ? { type: 'agent', replyToEventId: lastUser.id, ...standby }
      : { type: 'media_template', replyToEventId: lastUser.id, ...standby, ...stickerOnly };
  }

  return {
    messages,
    conversation: { state, humanSince, lastStaffAt, lastUserAt, addedUserMessages: added, referral },
    action,
    eventStatus: status,
  };
}

/** Сүүлийн хүн/ботын хариуны мөч (echo; Meta-ийн автомат хариуг тоолохгүй) — түүнээс хойшхи = хариулаагүй хэсэг */
function lastAnswerAt(sorted, ownAppId, lastUserBefore, automationHashes, policy, known) {
  let at = null;
  let lastUser = null;
  for (const e of sorted) {
    if (e.kind === 'echo') {
      const source = knownEcho(known, e)?.source ?? classifyEcho(e, { ownAppId, ...userBefore(e.eventTime, lastUser, lastUserBefore), automationHashes, policy });
      if (source !== 'automation') at = e.eventTime;
    } else if (e.kind === 'message' || e.kind === 'attachment' || e.kind === 'postback') {
      lastUser = e.eventTime;
    }
  }
  return at;
}

/** Агентад өгөх хэрэглэгчийн «хариулаагүй» текст (нууцалсан) — эрсдэлийн дохионы оролт */
export function unansweredUserText(turns) {
  const out = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    // Meta-ийн автомат хариу хэрэглэгчийн асуултад хариулаагүй — алгасна
    if (t.role === 'automation') continue;
    if (t.role !== 'user') break;
    if (t.text) out.unshift(t.text);
  }
  return out.join('\n').slice(0, 2000);
}

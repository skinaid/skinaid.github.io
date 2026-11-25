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
 *     TODO(3-р үе шат, assist/auto): чиглэлийг ЭСРЭГЭЭР болго — тодорхойгүй echo = ажилтан (`human`).
 *   · take_thread_control → human; бидэнд pass_thread_control → bot.
 *   · хүн 12 цаг идэвхгүй байхад хэрэглэгч бичвэл → bot руу буцна.
 *   · standby (өөр апп яриаг эзэмшиж байна) мессежийг хадгална; сүүдэр горимд ноорог бичсээр.
 * Үйлдэл: горим off → бүгд «skipped»; эс бөгөөс хэрэглэгчийн сүүлийн мессеж хүний/ботын хариунаас хойш байвал —
 * зөвхөн хавсралт = LLM-гүй загвар, текст = НЭГ агентын ажиллагаа (дараалсан мессежүүдэд нэг ноорог).
 */
import { createHash } from 'node:crypto';

/** Ажилтан хариулснаас хойш ийм хугацаа идэвхгүй бол бот яриаг буцааж авна */
export const HUMAN_IDLE_HOURS = 12;
/** Хэрэглэгчийн мессежээс хойш ийм хурдан ирсэн пэйжийн echo = Meta-ийн автомат хариу (хүн биш) */
export const AUTOMATION_ECHO_MS = 15_000;
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
 *   attachments: string[], mid: string|null, sentAt: Date }} PlannedMessage
 * @typedef {{ type: 'none', reason: 'mode_off'|'human_active'|'no_user_message'|'already_answered' }
 *   | { type: 'agent', replyToEventId: string } | { type: 'media_template', replyToEventId: string }} BatchAction
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

/**
 * Пэйжийн echo хэнийх вэ — манай бот, Meta-ийн автомат хариу, эсвэл ажилтан.
 * @param {Pick<StoredEvent, 'eventTime' | 'payload'>} echo
 * @param {{ ownAppId: string|null, lastUserAt: Date|null, automationHashes?: ReadonlySet<string> }} ctx
 * @returns {EchoSource}
 */
export function classifyEcho(echo, ctx) {
  const app = echo.payload.app_id ?? null;
  if (ctx.ownAppId && app === ctx.ownAppId) return 'own_bot';
  if (app && KNOWN_AUTOMATION_APP_IDS.includes(app)) return 'automation';
  const fp = echoFingerprint(echo.payload.text);
  if (fp && ctx.automationHashes?.has(fp)) return 'automation';
  // Хэрэглэгч энэ ярианд огт бичээгүй — Page-ээс эхэлсэн (Comment to message, зарын greeting)
  if (!ctx.lastUserAt) return 'automation';
  const gap = echo.eventTime.getTime() - ctx.lastUserAt.getTime();
  if (gap >= 0 && gap <= AUTOMATION_ECHO_MS) return 'automation';
  return 'staff';
}

const hoursBetween = (a, b) => (b.getTime() - a.getTime()) / 3600_000;

/**
 * @param {ConversationSnapshot} conv
 * @param {readonly StoredEvent[]} events
 * @param {{ mode: 'off'|'shadow', ownAppId: string|null, now: Date, automationHashes?: ReadonlySet<string> }} opts
 */
export function planBatch(conv, events, opts) {
  const sorted = [...events].sort((a, b) => a.eventTime.getTime() - b.eventTime.getTime());
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
        const source = classifyEcho(e, { ownAppId: opts.ownAppId, lastUserAt, automationHashes: opts.automationHashes });
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
        // Хүний идэвхгүй хугацаа = сүүлийн хариу эсвэл хүнд шилжсэн мөчөөс
        const since = lastStaffAt ?? humanSince;
        if (state === 'human' && (!since || hoursBetween(since, e.eventTime) >= HUMAN_IDLE_HOURS)) {
          state = 'bot';
          humanSince = null;
        }
        const kind = e.kind === 'postback' ? 'postback' : e.kind === 'referral' ? 'referral' : text ? 'text' : 'attachment';
        messages.push({ eventId: e.id, role: 'user', textHash: null, kind, text, attachments, mid: e.mid, sentAt: e.eventTime });
        // Дараалал алдагдсан / хойшилсон багц lastUserAt-ийг ухраахгүй
        if (!lastUserAt || e.eventTime > lastUserAt) lastUserAt = e.eventTime;
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
  // standby (Page Inbox яриаг эзэмшиж байна): сүүдэр горимд ноорог бичсээр — юу ч илгээхгүй.
  // TODO(3-р үе шат): assist/auto-д standby үед илгээхгүй (thread эзэмшээгүй — code 10 / 2018300).
  else {
    // Сүүлийн хариулаагүй хэсэгт текст байвал агент (бүх мессежийг нэг ноорогт), эс бөгөөс зөвхөн хавсралт
    const since = lastAnswerAt(sorted, opts.ownAppId, conv.lastUserAt, opts.automationHashes);
    const pending = sorted.filter(
      (e) => (e.kind === 'message' || e.kind === 'attachment' || e.kind === 'postback') && (!since || e.eventTime >= since),
    );
    const hasText = pending.some((e) => Boolean(e.payload.text));
    action = hasText ? { type: 'agent', replyToEventId: lastUser.id } : { type: 'media_template', replyToEventId: lastUser.id };
  }

  return {
    messages,
    conversation: { state, humanSince, lastStaffAt, lastUserAt, addedUserMessages: added, referral },
    action,
    eventStatus: status,
  };
}

/** Сүүлийн хүн/ботын хариуны мөч (echo; Meta-ийн автомат хариуг тоолохгүй) — түүнээс хойшхи = хариулаагүй хэсэг */
function lastAnswerAt(sorted, ownAppId, lastUserBefore, automationHashes) {
  let at = null;
  let lastUser = lastUserBefore;
  for (const e of sorted) {
    if (e.kind === 'echo') {
      if (classifyEcho(e, { ownAppId, lastUserAt: lastUser, automationHashes }) !== 'automation') at = e.eventTime;
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

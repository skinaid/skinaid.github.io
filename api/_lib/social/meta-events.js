/**
 * Meta Messenger webhook-ийн payload → цэвэрлэсэн event — ЦЭВЭР модуль (import: node:crypto, ../guardrails.js).
 * Эх сурвалж: skinaid/ubbeauty@1a43c95c src/lib/social/meta-events.ts (TS → JS, логик өөрчлөгдөөгүй).
 *
 * Хувийн мэдээллийн дүрэм:
 *   · Хэрэглэгчийн текст ЗӨВХӨН `redactForLlm`-оор нууцалсан (утас, имэйл, РД → [утас]…), ≤ 2000 тэмдэгт.
 *   · PSID-г хадгалахгүй — пэйж тус бүрийн HMAC hash (`psidHash`). LLM руу hash ч явахгүй.
 *   · Хавсралтын ЗӨВХӨН ТӨРӨЛ (image/video/audio/file/sticker) — Meta CDN-ийн URL, координат хадгалахгүй.
 *   · read / delivery / reaction / message_edit / optin-ийг алгасна.
 *   · `standby` (өөр апп/Page Inbox яриаг эзэмшиж байх үеийн) мессежийг тэмдэглэнэ.
 */
import { createHash, createHmac } from 'node:crypto';
import { findPii, redactForLlm } from '../guardrails.js';

/**
 * @typedef {'message'|'attachment'|'echo'|'postback'|'referral'|'handover'} SocialEventKind
 * @typedef {'image'|'video'|'audio'|'file'|'sticker'|'other'} AttachmentType
 * @typedef {{ source?: string, ref?: string, ad_id?: string }} SocialReferral
 * @typedef {{ text?: string, attachments?: AttachmentType[], postback?: string, quick_reply?: string,
 *   referral?: SocialReferral, app_id?: string, standby?: boolean, handover?: string }} SocialEventPayload
 * @typedef {{ pageId: string, psid: string, kind: SocialEventKind, mid: string|null, eventKey: string,
 *   eventTime: Date, payload: SocialEventPayload }} ParsedEvent
 *   psid — ЗӨВХӨН санах ойд (hash хийхэд), DB/LLM руу ХЭЗЭЭ Ч үгүй
 */

export const MESSENGER_TEXT_MAX = 2000;
/** Page Inbox-ийн апп id (Meta Conversation Routing) */
export const PAGE_INBOX_APP_ID = '263902037430900';

const ATTACHMENT_TYPES = new Set(['image', 'video', 'audio', 'file']);
const ID_RE = /^[0-9]{5,30}$/;

const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/** PSID → пэйж тус бүрийн HMAC (hex 64). Түлхүүр = env PSID_SALT */
export function psidHash(pageId, psid, key) {
  return createHmac('sha256', key).update(`${pageId}:${psid}`).digest('hex');
}

const redact = (text) => redactForLlm(str(text)).slice(0, MESSENGER_TEXT_MAX);

/** mid-гүй event-ийн тогтмол түлхүүр (Meta давтан илгээвэл ижил) */
function syntheticKey(kind, pageId, psid, ts, extra) {
  const h = createHash('sha256').update(`${kind}|${pageId}|${psid}|${ts}|${extra}`).digest('hex');
  return `${kind}:${h.slice(0, 40)}`;
}

/** @returns {AttachmentType[]} */
function attachmentTypes(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const a of list.slice(0, 10)) {
    const o = obj(a);
    if (!o) continue;
    const t = str(o.type);
    const p = obj(o.payload);
    // Стикер (like 👍 г.м.) нь image төрөлтэй, payload.sticker_id-тэй ирнэ
    if (t === 'image' && p && p.sticker_id !== undefined) out.push('sticker');
    else out.push(ATTACHMENT_TYPES.has(t) ? t : 'other');
  }
  return out;
}

const shortCode = (v, max = 100) => {
  const s = str(v).trim();
  return s ? s.slice(0, max) : undefined;
};

/**
 * Хэрэглэгчээс ирж болох код (quick reply / postback payload, ref): Meta-ийн `user_phone_number` / `user_email`
 * quick reply, зарын lead загвар утас/имэйлийг шууд тавьдаг — PII илэрвэл ХАДГАЛАХГҮЙ (бүхэлд нь хаяна).
 */
const safeCode = (v, max = 100) => {
  const s = shortCode(v, max);
  return s && findPii(s).length === 0 ? s : undefined;
};

/** Meta-ийн referral объект → зөвхөн эх үүсвэр, ref, зарын id (ads_context_data-ийн зураг/URL-гүй) */
export function parseReferral(v) {
  const r = obj(v);
  if (!r) return undefined;
  /** @type {SocialReferral} */
  const out = {};
  const source = shortCode(r.source, 40);
  if (source && /^[A-Z_]{2,40}$/.test(source)) out.source = source;
  const ref = safeCode(r.ref);
  if (ref) out.ref = ref;
  const ad = shortCode(r.ad_id, 30);
  if (ad && /^[0-9]{5,30}$/.test(ad)) out.ad_id = ad;
  return Object.keys(out).length ? out : undefined;
}

/** Нэг `messaging` / `standby` мөр → event (алгасах төрөл бол null) @returns {ParsedEvent | null} */
export function parseMessagingItem(item, pageId, standby) {
  const m = obj(item);
  if (!m) return null;
  const senderId = str(obj(m.sender)?.id);
  const recipientId = str(obj(m.recipient)?.id);
  const tsNum = Number(m.timestamp);
  const ts = Number.isFinite(tsNum) && tsNum > 0 ? tsNum : Date.now();
  const eventTime = new Date(ts);
  const message = obj(m.message);

  if (message) {
    const isEcho = message.is_echo === true;
    // Echo-д илгээгч = пэйж, хүлээн авагч = хэрэглэгч
    const psid = isEcho ? recipientId : senderId;
    if (!ID_RE.test(psid)) return null;
    const mid = shortCode(message.mid, 200) ?? null;
    const attachments = attachmentTypes(message.attachments);
    const text = redact(message.text);
    /** @type {SocialEventPayload} */
    const payload = {};
    if (text) payload.text = text;
    if (attachments.length) payload.attachments = attachments;
    const qr = safeCode(obj(message.quick_reply)?.payload);
    if (qr) payload.quick_reply = qr;
    if (isEcho) {
      const app = shortCode(message.app_id, 30);
      if (app) payload.app_id = app;
    } else {
      // Зарын анхны мессеж (click-to-Messenger) referral-ийг message дотор авчирдаг
      const ref = parseReferral(message.referral ?? m.referral);
      if (ref) payload.referral = ref;
    }
    if (standby) payload.standby = true;
    const kind = isEcho ? 'echo' : text ? 'message' : attachments.length ? 'attachment' : 'message';
    if (!isEcho && !text && !attachments.length) return null;
    return { pageId, psid, kind, mid, eventKey: mid ?? syntheticKey(kind, pageId, psid, ts, ''), eventTime, payload };
  }

  const postback = obj(m.postback);
  if (postback) {
    if (!ID_RE.test(senderId)) return null;
    const mid = shortCode(postback.mid, 200) ?? null;
    /** @type {SocialEventPayload} */
    const payload = {};
    const title = redact(postback.title);
    if (title) payload.text = title;
    const code = safeCode(postback.payload);
    if (code) payload.postback = code;
    const ref = parseReferral(postback.referral);
    if (ref) payload.referral = ref;
    if (standby) payload.standby = true;
    return {
      pageId,
      psid: senderId,
      kind: 'postback',
      mid,
      eventKey: mid ?? syntheticKey('postback', pageId, senderId, ts, code ?? ''),
      eventTime,
      payload,
    };
  }

  const referral = obj(m.referral);
  if (referral) {
    if (!ID_RE.test(senderId)) return null;
    /** @type {SocialEventPayload} */
    const payload = {};
    const ref = parseReferral(referral);
    if (ref) payload.referral = ref;
    return {
      pageId,
      psid: senderId,
      kind: 'referral',
      mid: null,
      eventKey: syntheticKey('referral', pageId, senderId, ts, `${ref?.source ?? ''}|${ref?.ref ?? ''}|${ref?.ad_id ?? ''}`),
      eventTime,
      payload,
    };
  }

  for (const h of ['pass_thread_control', 'take_thread_control', 'request_thread_control']) {
    if (m[h] !== undefined) {
      // Хэрэглэгч рүү хандсан handover — хэрэглэгч = sender (Meta: sender = PSID)
      const psid = ID_RE.test(senderId) ? senderId : recipientId;
      if (!ID_RE.test(psid)) return null;
      const app = shortCode(obj(m[h])?.new_owner_app_id ?? obj(m[h])?.previous_owner_app_id ?? obj(m[h])?.requested_owner_app_id, 30);
      /** @type {SocialEventPayload} */
      const payload = { handover: h.replace('_thread_control', '') };
      if (app) payload.app_id = app;
      return { pageId, psid, kind: 'handover', mid: null, eventKey: syntheticKey('handover', pageId, psid, ts, h), eventTime, payload };
    }
  }
  // read, delivery, reaction, message_edit, optin, account_linking … — алгасна
  return null;
}

/** `{ object: "page", entry: [...] }` → event-үүд (бусад object = хоосон) @returns {{ events: ParsedEvent[], skipped: number }} */
export function parseWebhook(body) {
  const b = obj(body);
  if (!b || b.object !== 'page' || !Array.isArray(b.entry)) return { events: [], skipped: 0 };
  const events = [];
  let skipped = 0;
  for (const e of b.entry.slice(0, 100)) {
    const entry = obj(e);
    if (!entry) continue;
    const pageId = str(entry.id);
    if (!ID_RE.test(pageId)) continue;
    for (const [list, standby] of [
      [entry.messaging, false],
      [entry.standby, true],
    ]) {
      if (!Array.isArray(list)) continue;
      for (const item of list.slice(0, 200)) {
        const ev = parseMessagingItem(item, pageId, standby);
        if (ev) events.push(ev);
        else skipped++;
      }
    }
  }
  return { events, skipped };
}

/**
 * Meta Send API — үйлчлүүлэгч рүү Messenger мессеж илгээх ЦОР ГАНЦ газар (`POST /me/messages`).
 *
 * ЭНЭ ФАЙЛЫГ ЗӨВХӨН ../outbound.js ИМПОРТОЛНО (tools/test/messenger-architecture.test.mjs шалгана): илгээх эсэхийг
 * (горим, яаралтай зогсоолт, үзэгчид, 24 цагийн цонх, ярианы төлөв…) outbound.js `sendGuarded` шийднэ — энд ямар ч бодлого
 * байхгүй, зөвхөн хүсэлтийн хэлбэр ба алдааны ангилал.
 *
 *   · `messaging_type: RESPONSE` — хэрэглэгчийн мессежээс хойш 24 цагийн дотор (сурталчилгаа, дагаж мессеж ХОРИОТОЙ).
 *   · Текст ≤ 2000; quick reply ≤ 13 (гарчиг ≤ 20, payload ≤ 1000); товчтой загвар (button template): текст ≤ 640,
 *     ≤ 3 товч (https холбоос эсвэл postback, гарчиг ≤ 20).
 *   · sender_action (typing/mark_seen), thread control, broadcast ЭНД БАЙХГҮЙ (хориотой хэвээр).
 *
 * Нууц: Page token ЗӨВХӨН `Authorization: Bearer` толгойд — URL, лог, алдааны мессежид хэзээ ч үгүй. PSID, текстийг
 * логлохгүй; алдаа = ангилал + тоон код л (`MetaApiError`).
 */
import { classifyMetaError, GRAPH_BASE, META_ERROR_TEXT, MetaApiError } from './meta-client.js';

export const SEND_LIMITS = Object.freeze({ text: 2000, quickReplies: 13, quickReplyTitle: 20, payload: 1000, buttonText: 640, buttons: 3, buttonTitle: 20, url: 2000 });

const PSID_RE = /^[0-9]{5,30}$/;
const invalid = () => new MetaApiError('invalid', 0, null, null, META_ERROR_TEXT.invalid);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** @param {unknown} list @returns {{ content_type: 'text', title: string, payload: string }[] | null} null = буруу хэлбэр */
function quickReplyList(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > SEND_LIMITS.quickReplies) return null;
  const out = [];
  for (const q of list) {
    const title = str(q?.title);
    const payload = str(q?.payload);
    if (!title || title.length > SEND_LIMITS.quickReplyTitle || !payload || payload.length > SEND_LIMITS.payload) return null;
    out.push({ content_type: /** @type {const} */ ('text'), title, payload });
  }
  return out;
}

/** @param {unknown} list @returns {object[] | null} */
function buttonList(list) {
  if (!Array.isArray(list) || !list.length || list.length > SEND_LIMITS.buttons) return null;
  const out = [];
  for (const b of list) {
    const title = str(b?.title);
    if (!title || title.length > SEND_LIMITS.buttonTitle) return null;
    if (b?.type === 'web_url') {
      const url = str(b.url);
      if (!/^https:\/\/[^\s]+$/.test(url) || url.length > SEND_LIMITS.url) return null;
      out.push({ type: 'web_url', url, title });
    } else if (b?.type === 'postback') {
      const payload = str(b.payload);
      if (!payload || payload.length > SEND_LIMITS.payload) return null;
      out.push({ type: 'postback', title, payload });
    } else return null;
  }
  return out;
}

/**
 * Илгээх `message` объект (буруу хэлбэр = null — Graph руу хэзээ ч явахгүй).
 * @param {{ text: string, quickReplies?: { title: string, payload: string }[], buttons?: object[] }} m
 */
export function buildMessage(m) {
  const text = str(m?.text);
  const quick = quickReplyList(m?.quickReplies);
  if (!text || quick === null) return null;
  const qr = quick.length ? { quick_replies: quick } : {};
  if (m.buttons !== undefined && m.buttons !== null) {
    const buttons = buttonList(m.buttons);
    if (!buttons || text.length > SEND_LIMITS.buttonText) return null;
    return { attachment: { type: 'template', payload: { template_type: 'button', text, buttons } }, ...qr };
  }
  if (text.length > SEND_LIMITS.text) return null;
  return { text, ...qr };
}

/**
 * @param {{ pageToken: string, fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 * @returns {{ send(input: { recipientId: string, text: string, quickReplies?: { title: string, payload: string }[], buttons?: object[] }): Promise<{ mid: string|null }> }}
 */
export function createMetaSender(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const token = String(opts.pageToken ?? '').trim();

  return {
    /** Амжилттай = { mid }; бүх алдаа = MetaApiError (kind: token_invalid | thread_owned | window_closed | rate_limit | … | network) */
    async send(input) {
      if (!token) throw new MetaApiError('token_invalid', 0, null, null, META_ERROR_TEXT.token_invalid);
      const recipientId = str(input?.recipientId);
      const message = buildMessage(input);
      if (!PSID_RE.test(recipientId) || !message) throw invalid();
      let res;
      try {
        res = await fetchImpl(`${GRAPH_BASE}/me/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: 'RESPONSE', message }),
          signal: AbortSignal.timeout(timeoutMs),
          cache: 'no-store',
        });
      } catch {
        // Хугацаа дууссан / сүлжээ: мессеж хүрсэн эсэх тодорхойгүй — дуудагч ДАХИН ИЛГЭЭХГҮЙ (хамгийн ихдээ нэг удаа)
        throw new MetaApiError('network', 0, null, null, META_ERROR_TEXT.network);
      }
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (!res.ok || (json && typeof json === 'object' && 'error' in json)) {
        const c = classifyMetaError(res.status, json);
        throw new MetaApiError(c.kind, res.status, c.code, c.subcode, META_ERROR_TEXT[c.kind]);
      }
      const mid = json && typeof json === 'object' && typeof json.message_id === 'string' ? json.message_id.slice(0, 200) : null;
      return { mid };
    },
  };
}

/**
 * Meta Graph API клиент — хувилбар БЭХЭЛСЭН (`GRAPH_VERSION`). Runtime import-гүй (fetch-ийг тарьж болно).
 * Эх сурвалж: skinaid/ubbeauty@1a43c95c src/lib/social/meta-client.ts.
 *
 * Энэ файл: ЗӨВХӨН уншдаг/бүртгэлийн дуудлага — `getPage` (cron-ын token шалгалт), `subscribeApp` (пэйжийг webhook-д
 * бүртгэх) + алдааны ангилал. Үйлчлүүлэгч рүү мессеж илгээх нь ./meta-send.js (зөвхөн ../outbound.js дуудна).
 * senderAction (mark_seen/typing), pass/take/release thread control хаана ч БАЙХГҮЙ —
 * tools/test/messenger-architecture.test.mjs шалгана.
 *
 * Нууц: Page token-ийг `Authorization: Bearer` толгойд л — URL, лог, алдааны мессежид ХЭЗЭЭ Ч үгүй.
 */

export const GRAPH_VERSION = 'v27.0';
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Webhook-д бүртгүүлэх талбар */
export const SUBSCRIBED_FIELDS = Object.freeze([
  'messages',
  'messaging_postbacks',
  'message_echoes',
  'messaging_handovers',
  'standby',
  'messaging_referrals',
]);

/** @typedef {'token_invalid'|'permission'|'thread_owned'|'window_closed'|'rate_limit'|'invalid'|'network'|'unknown'} MetaErrorKind */

export class MetaApiError extends Error {
  /** @param {MetaErrorKind} kind @param {number} status @param {number|null} code @param {number|null} subcode @param {string} message */
  constructor(kind, status, code, subcode, message) {
    super(message);
    this.name = 'MetaApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
}

/**
 * Graph-ийн алдааг ангилна. 190 = token хүчингүй/хугацаа дууссан; 10 + 2018300 = яриаг өөр апп (Page Inbox)
 * эзэмшиж байна (Conversation Routing); 10 + 2018278 / 551 = 24 цагийн цонхноос гадуур; 4/17/32/613 = хязгаар.
 * @returns {{ kind: MetaErrorKind, code: number|null, subcode: number|null }}
 */
export function classifyMetaError(status, body) {
  const err = body && typeof body === 'object' ? body.error : undefined;
  const code = Number.isFinite(Number(err?.code)) ? Number(err?.code) : null;
  const subcode = Number.isFinite(Number(err?.error_subcode)) ? Number(err?.error_subcode) : null;
  /** @type {MetaErrorKind} */
  let kind = 'unknown';
  if (code === 190 || status === 401) kind = 'token_invalid';
  else if (code === 10 && subcode === 2018300) kind = 'thread_owned';
  else if ((code === 10 && subcode === 2018278) || code === 551) kind = 'window_closed';
  else if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) kind = 'rate_limit';
  else if (code === 10 || code === 200 || code === 299 || status === 403) kind = 'permission';
  else if (code === 100 || status === 400) kind = 'invalid';
  return { kind, code, subcode };
}

/** Ажилтанд харагдах тайлбар (token, fbtrace-гүй) */
export const META_ERROR_TEXT = Object.freeze({
  token_invalid: 'Пэйжийн token хүчингүй эсвэл хугацаа нь дууссан — шинэ token хадгална уу.',
  permission: 'Пэйж эсвэл апп-д шаардлагатай зөвшөөрөл алга.',
  thread_owned: 'Яриаг өөр апп (Page Inbox) эзэмшиж байна.',
  window_closed: '24 цагийн хариулах хугацаа дууссан.',
  rate_limit: 'Meta-ийн хүсэлтийн хязгаарт хүрсэн — түр хүлээгээд дахин оролдоно уу.',
  invalid: 'Meta хүсэлтийг хүлээж авсангүй (буруу id эсвэл параметр).',
  network: 'Meta-тай холбогдож чадсангүй.',
  unknown: 'Meta-ийн тодорхойгүй алдаа.',
});

const ID_RE = /^[0-9]{5,30}$/;

/**
 * @param {{ pageToken: string, fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 * @returns {{ getPage(pageId: string): Promise<{id: string, name: string}>, subscribeApp(pageId: string): Promise<boolean> }}
 */
export function createMetaClient(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const token = String(opts.pageToken ?? '').trim();

  async function call(method, path, body) {
    if (!token) throw new MetaApiError('token_invalid', 0, null, null, META_ERROR_TEXT.token_invalid);
    let res;
    try {
      res = await fetchImpl(`${GRAPH_BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
    } catch {
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
    return json && typeof json === 'object' ? json : {};
  }

  return {
    async getPage(pageId) {
      if (!ID_RE.test(pageId)) throw new MetaApiError('invalid', 0, null, null, META_ERROR_TEXT.invalid);
      const r = await call('GET', `/${pageId}?fields=id,name`);
      return { id: String(r.id ?? ''), name: String(r.name ?? '').slice(0, 200) };
    },
    async subscribeApp(pageId) {
      if (!ID_RE.test(pageId)) throw new MetaApiError('invalid', 0, null, null, META_ERROR_TEXT.invalid);
      const r = await call('POST', `/${pageId}/subscribed_apps`, { subscribed_fields: [...SUBSCRIBED_FIELDS] });
      return r.success === true;
    },
  };
}

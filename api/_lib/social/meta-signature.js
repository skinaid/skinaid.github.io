/**
 * Meta (Facebook) webhook-ийн гарын үсэг ба GET verify — ЦЭВЭР модуль (runtime import = node:crypto л).
 * Эх сурвалж: skinaid/ubbeauty@1a43c95c src/lib/social/meta-signature.ts (агуулга өөрчлөгдөөгүй).
 *
 * POST бүр `X-Hub-Signature-256: sha256=<hex>` толгойтой ирнэ: HMAC-SHA256(app secret, ТҮҮХИЙ body байт).
 * Тиймээс body-г JSON.parse хийхээс ӨМНӨ, яг ирсэн байтаар шалгана (дахин сериалчилбал гарын үсэг таарахгүй).
 * Харьцуулалт timing-safe. Нууц байхгүй бол ҮРГЭЛЖ худал (fail-closed).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SIG_RE = /^sha256=([0-9a-f]{64})$/i;

/** @param {Uint8Array | string} rawBody @param {string} appSecret */
export function metaSignature(rawBody, appSecret) {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

/** @param {Uint8Array | string} rawBody @param {string | null | undefined} header @param {string | null | undefined} appSecret */
export function verifyMetaSignature(rawBody, header, appSecret) {
  if (!appSecret || typeof header !== 'string') return false;
  const m = header.trim().match(SIG_RE);
  if (!m) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'), 'utf8');
  const got = Buffer.from(m[1].toLowerCase(), 'utf8');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Тогтмол хугацаат мөрийн харьцуулалт (verify token) */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * GET /api/messenger?hub.mode=subscribe&hub.verify_token=…&hub.challenge=… — token таарвал challenge-ийг
 * (зөвхөн тоо/үсэг, ≤ 200) буцаана, эс бөгөөс null (403). Token тохируулаагүй бол null.
 * @param {URLSearchParams} params @param {string | null | undefined} verifyToken
 */
export function verifyWebhookChallenge(params, verifyToken) {
  if (!verifyToken) return null;
  if (params.get('hub.mode') !== 'subscribe') return null;
  const token = params.get('hub.verify_token') ?? '';
  const challenge = params.get('hub.challenge') ?? '';
  if (!token || !safeEqual(token, verifyToken)) return null;
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(challenge)) return null;
  return challenge;
}

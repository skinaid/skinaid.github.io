/**
 * Admin-ийн серверийн үйлдэл (api/admin.js) — Firebase ID token-ийг firebase-admin-ГҮЙ шалгана (node:crypto).
 * Firebase-ийн «гуравдагч талын JWT сан»-д зориулсан албан ёсны шалгуур (Verify ID tokens):
 *   · header: alg = RS256, kid = Google securetoken-ийн нийтийн түлхүүрүүдийн нэг (x509, Cache-Control max-age-аар кэш)
 *   · гарын үсэг (RSA-SHA256) — claim-уудыг гарын үсгийн ДАРАА л итгэнэ
 *   · aud = skinaid-mn, iss = https://securetoken.google.com/skinaid-mn, sub хоосон биш (≤ 128),
 *     exp ирээдүйд, iat/auth_time өнгөрсөнд (60 с цагийн зөрүү)
 * Нэмэлт (firestore.rules isAdmin()-тэй ИЖИЛ): email_verified === true, email ∈ ADMIN_EMAILS, Google-ээр нэвтэрсэн
 * (rules-ээс хатуу — зөвхөн Google). Token-ийг цуцалсан эсэхийг (revocation) шалгахгүй — rules болон firebase-admin-ий
 * анхдагчтай ижил; token 1 цаг хүчинтэй тул admin-ийг хассаны дараа ≤ 1 цаг ажиллаж болно (allowlist-ээс хасах нь шууд).
 * Token-ийг лог, алдааны мессеж, Firestore-д ХЭЗЭЭ Ч гаргахгүй (зөвхөн тогтмол код).
 */
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { FIREBASE_PROJECT_ID } from './config.js';

/** firestore.rules → isAdmin() ба assets/js/firebase-config.js → ADMIN_EMAILS-тэй ИЖИЛ (tools/test/messenger-admin-api.test.mjs) */
export const ADMIN_EMAILS = Object.freeze(['hello@skinaid.mn', 'info@skinaid.mn']);
export const SECURETOKEN_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
/** Цагийн зөрүүний хүлцэл (секунд) */
export const CLOCK_SKEW_S = 60;
/** Танихгүй kid ирэхэд түлхүүрийг албадан дахин татах хамгийн бага завсар (халдагч татах давталт үүсгэхгүй) */
const FORCE_REFRESH_MS = 5 * 60_000;
const MAX_TOKEN_CHARS = 4096;

export class AuthError extends Error {
  /** @param {string} code тогтмол код (лог, хариунд) */
  constructor(code) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
  }
}

const decodeJson = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
const B64URL = /^[A-Za-z0-9_-]+$/;

/**
 * @param {{ projectId?: string, fetchImpl?: typeof fetch, now?: () => number, certsUrl?: string, admins?: readonly string[] }} [opts]
 * @returns {(token: unknown) => Promise<{ email: string, uid: string }>}
 */
export function createTokenVerifier(opts = {}) {
  const projectId = opts.projectId ?? FIREBASE_PROJECT_ID;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const certsUrl = opts.certsUrl ?? SECURETOKEN_CERTS_URL;
  const admins = new Set(opts.admins ?? ADMIN_EMAILS);
  const issuer = `https://securetoken.google.com/${projectId}`;
  /** @type {{ map: Map<string, import('node:crypto').KeyObject>, exp: number, at: number } | null} */
  let keys = null;
  /** @type {Promise<Map<string, import('node:crypto').KeyObject>> | null} */
  let inflight = null;

  function fetchKeys() {
    if (!inflight) {
      inflight = (async () => {
        let res;
        try {
          res = await fetchImpl(certsUrl, { signal: AbortSignal.timeout(5000) });
        } catch {
          throw new AuthError('certs_unavailable');
        }
        if (!res.ok) throw new AuthError('certs_unavailable');
        let json;
        try {
          json = await res.json();
        } catch {
          throw new AuthError('certs_unavailable');
        }
        const map = new Map();
        for (const [kid, pem] of Object.entries(json && typeof json === 'object' ? json : {})) {
          if (typeof pem !== 'string') continue;
          try {
            map.set(kid, createPublicKey(pem));
          } catch {
            // эвдэрсэн сертификат — алгасна
          }
        }
        if (!map.size) throw new AuthError('certs_unavailable');
        const maxAge = Number((/max-age=(\d+)/i.exec(res.headers.get('cache-control') ?? '') ?? [])[1]) || 3600;
        const t = now();
        keys = { map, exp: t + Math.min(Math.max(maxAge, 60), 6 * 3600) * 1000, at: t };
        return map;
      })().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  }

  async function keyFor(kid) {
    let map = keys && keys.exp > now() ? keys.map : await fetchKeys();
    if (!map.has(kid) && keys && now() - keys.at > FORCE_REFRESH_MS) map = await fetchKeys();
    return map.get(kid) ?? null;
  }

  return async function verifyIdToken(token) {
    if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_CHARS) throw new AuthError('no_token');
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every((p) => B64URL.test(p))) throw new AuthError('malformed');
    let header;
    let claims;
    try {
      header = decodeJson(parts[0]);
      claims = decodeJson(parts[1]);
    } catch {
      throw new AuthError('malformed');
    }
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw new AuthError('bad_header');
    const key = await keyFor(header.kid);
    if (!key) throw new AuthError('unknown_kid');
    const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new AuthError('bad_signature');

    // Гарын үсэг зөв — claim-ууд
    if (!claims || typeof claims !== 'object') throw new AuthError('bad_claims');
    const t = Math.floor(now() / 1000);
    if (claims.aud !== projectId) throw new AuthError('bad_audience');
    if (claims.iss !== issuer) throw new AuthError('bad_issuer');
    if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw new AuthError('bad_subject');
    if (!Number.isFinite(claims.exp) || claims.exp <= t - CLOCK_SKEW_S) throw new AuthError('expired');
    if (!Number.isFinite(claims.iat) || claims.iat > t + CLOCK_SKEW_S) throw new AuthError('bad_iat');
    if (!Number.isFinite(claims.auth_time) || claims.auth_time > t + CLOCK_SKEW_S) throw new AuthError('bad_auth_time');
    if (claims.firebase?.sign_in_provider !== 'google.com') throw new AuthError('bad_provider');
    if (claims.email_verified !== true) throw new AuthError('email_not_verified');
    // rules-ийн `request.auth.token.email in [...]` шиг ЯГ тэнцүү (том/жижиг үсгийг хөрвүүлэхгүй)
    const email = typeof claims.email === 'string' ? claims.email : '';
    if (!admins.has(email)) throw new AuthError('not_admin');
    return { email, uid: claims.sub };
  };
}

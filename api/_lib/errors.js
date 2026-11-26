/**
 * Алдааг Vercel-ийн runtime лог-д бичихэд зориулсан аюулгүй тайлбар. Firestore-д (lastError, event) зөвхөн богино код
 * хадгалагдсаар байна. Энэ тайлбар нь ЗӨВХӨН лог-д бичигдэнэ.
 *
 * Яагаад: 2026-11-26-нд production-ийн cron 500 буцаасан ч шалтгаан нь логт огт гараагүй, учир нь Firestore-ийн AUTH
 * алдаа анхны шалтгааныг («модуль олдсонгүй», «STS: audience таарахгүй», «IAM: getAccessToken denied») хаядаг байсан.
 *
 * Логт орох зүйл: тогтсон ангилал (sts / iam / oidc / алдааны нэр), HTTP статус, сангийн алдааны мессежийн эхний 160
 * тэмдэгт. Token, түлхүүрийн хэлбэрийг хасна (JWT, ya29., sk-ant-, урт hex, 15+ оронтой тоо = PSID). Хэрэглэгчийн
 * текст энд хэзээ ч ирэхгүй: сангийн алдаа (Google auth, Firestore REST) хүсэлтийн body-г мессежид оруулдаггүй.
 */

const SCRUB = [
  [/eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*/g, '<jwt>'],
  [/ya29\.[\w.~-]+/g, '<token>'],
  [/sk-ant-[\w-]+/g, '<key>'],
  [/\b[a-f0-9]{32,}\b/gi, '<hex>'],
  [/\d{15,}/g, '<id>'],
];

/** @param {string} s */
export function scrub(s) {
  let out = String(s ?? '').replace(/\s+/g, ' ').trim();
  for (const [re, to] of SCRUB) out = out.replace(re, to);
  return out;
}

/**
 * Firestore-оос бусад алдааны тайлбар (Google auth, @vercel/oidc, модуль ачаалах г.м.).
 * @param {unknown} e
 */
export function safeErrorReason(e) {
  if (!e || typeof e !== 'object') return 'unknown';
  const err = /** @type {any} */ (e);
  if (err.name === 'AuthNotConfiguredError') return 'not_configured';
  const code = typeof err.code === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(err.code) ? err.code : '';
  const status = Number(err.response?.status ?? err.status);
  const url = String(err.config?.url ?? err.response?.config?.url ?? '');
  const where = /sts\.googleapis\.com/.test(url) ? 'sts'
    : /iamcredentials\.googleapis\.com/.test(url) ? 'iam'
      : err.name === 'VercelOidcTokenError' ? 'oidc'
        : String(err.name || 'Error').replace(/[^\w]/g, '').slice(0, 40) || 'Error';
  const head = `${where}${Number.isFinite(status) && status > 0 ? `_${status}` : ''}${code ? `_${code}` : ''}`;
  const msg = scrub(err.message).slice(0, 160);
  return msg ? `${head}: ${msg}` : head;
}

/**
 * Лог-д бичих тайлбар: FirestoreError бол статус + (AUTH үед) token авч чадаагүй шалтгаан, бусад нь safeErrorReason.
 * @param {unknown} e
 */
export function describeError(e) {
  const err = /** @type {any} */ (e);
  if (err && err.name === 'FirestoreError') {
    const detail = err.reason || scrub(err.message).slice(0, 160);
    return `firestore_${err.status || err.httpStatus}${detail ? `: ${detail}` : ''}`;
  }
  return safeErrorReason(e);
}

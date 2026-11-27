/**
 * Meta (Facebook) аппын тохиргоо — ЗӨВХӨН орчны хувьсагчаас (нууцыг репо, Firestore, лог, URL-д ХЭЗЭЭ Ч үгүй).
 * Эх сурвалж: skinaid/ubbeauty@1a43c95c src/lib/social/meta-config.ts.
 * SkinAid-д өөрчилсөн: хувьсагчийн нэр (META_VERIFY_TOKEN, PSID_SALT), нэг пэйж (META_PAGE_ID), Supabase-ийн
 * түлхүүрээс PSID түлхүүр гаргах нөөц замыг хассан — PSID_SALT байхгүй бол webhook ажиллахгүй (fail-closed).
 *
 *   META_APP_SECRET   — webhook-ийн X-Hub-Signature-256 шалгалт (байхгүй = POST 503)
 *   META_VERIFY_TOKEN — GET verify (developers.facebook.com дээрх «Verify token»-той ижил)
 *   META_APP_ID       — манай аппын id (нууц биш): echo нь манай ботынх уу, хүнийх үү ялгана
 *   META_PAGE_ID      — SkinAid пэйжийн id (нууц биш): өөр пэйжийн event-ийг хаяна
 *   META_PAGE_TOKEN   — пэйжийн token: cron-ын token шалгалт (getPage) ба «Автомат» горимын илгээлт (ЗӨВХӨН
 *                       ../outbound.js → meta-send.js; `Authorization` толгойд л).
 *   PSID_SALT         — PSID hash-ийн түлхүүр (≥ 32 тэмдэгт). Солибол хуучин яриа шинээр эхэлнэ.
 */

const ID_RE = /^[0-9]{5,30}$/;

/** @param {Record<string, string | undefined>} [env] */
export function metaConfig(env = process.env) {
  const t = (k) => String(env[k] ?? '').trim();
  const appId = t('META_APP_ID');
  const pageId = t('META_PAGE_ID');
  const salt = t('PSID_SALT');
  return {
    appSecret: t('META_APP_SECRET'),
    verifyToken: t('META_VERIFY_TOKEN'),
    appId: ID_RE.test(appId) ? appId : null,
    pageId: ID_RE.test(pageId) ? pageId : null,
    pageToken: t('META_PAGE_TOKEN'),
    psidKey: salt.length >= 32 ? salt : '',
  };
}

/**
 * Messenger AI — орчны хувьсагч (Vercel env). Нууцын УТГЫГ лог, Firestore, хариу, URL-д ХЭЗЭЭ Ч гаргахгүй:
 * гадагш зөвхөн «тохируулсан эсэх» boolean (`configStatus`) явна. Эзэмшигч Vercel → Settings → Environment
 * Variables-д тавина (README «Messenger AI»).
 */
import { metaConfig } from './social/meta-config.js';

export const FIREBASE_PROJECT_ID = 'skinaid-mn';

const t = (env, k) => String(env[k] ?? '').trim();

/** Google Cloud-ийн серверийн эрх: WIF (Vercel OIDC) эсвэл service account JSON (нөөц) */
export function gcpConfig(env = process.env) {
  const wif = {
    projectNumber: t(env, 'GCP_PROJECT_NUMBER'),
    poolId: t(env, 'GCP_WORKLOAD_IDENTITY_POOL_ID'),
    providerId: t(env, 'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID'),
    serviceAccountEmail: t(env, 'GCP_SERVICE_ACCOUNT_EMAIL'),
    audience: t(env, 'GCP_AUDIENCE'),
  };
  const wifOk = /^\d{6,20}$/.test(wif.projectNumber) && /^[a-z0-9-]{4,32}$/.test(wif.poolId)
    && /^[a-z0-9-]{4,32}$/.test(wif.providerId) && /^[^@\s]+@[a-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(wif.serviceAccountEmail);
  const keyJson = t(env, 'FIREBASE_SERVICE_ACCOUNT');
  return {
    projectId: t(env, 'GCP_PROJECT_ID') || FIREBASE_PROJECT_ID,
    mode: wifOk ? 'wif' : keyJson ? 'key' : null,
    wif,
    keyJson,
  };
}

export function anthropicConfigured(env = process.env) {
  return /^sk-ant-/.test(t(env, 'ANTHROPIC_API_KEY'));
}

export function cronSecret(env = process.env) {
  const s = t(env, 'CRON_SECRET');
  return s.length >= 16 ? s : '';
}

/** Admin «Тохиргоо»-д харагдах тохиргооны төлөв — ЗӨВХӨН boolean, утга биш */
export function configStatus(env = process.env) {
  const m = metaConfig(env);
  const g = gcpConfig(env);
  return {
    metaAppSecret: Boolean(m.appSecret),
    metaVerifyToken: Boolean(m.verifyToken),
    metaAppId: Boolean(m.appId),
    metaPageId: Boolean(m.pageId),
    metaPageToken: Boolean(m.pageToken),
    psidSalt: Boolean(m.psidKey),
    anthropicKey: anthropicConfigured(env),
    cronSecret: Boolean(cronSecret(env)),
    serverAuth: g.mode ?? 'none',
  };
}

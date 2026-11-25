/**
 * Google Cloud-ийн серверийн эрх → Firestore REST-ийн access token.
 *
 *   wif — Vercel OIDC token → Google STS → service account-ийг impersonate (урт хугацааны түлхүүргүй).
 *         Vercel-ийн албан ёсны жишээ (https://vercel.com/docs/oidc/gcp): `@vercel/oidc` getVercelOidcToken +
 *         `google-auth-library` ExternalAccountClient. Service account-д зөвхөн `Cloud Datastore User`.
 *   key — `FIREBASE_SERVICE_ACCOUNT` (service account JSON) — байгууллагын бодлого key үүсгэхийг зөвшөөрсөн үед л.
 *
 * Сангуудыг lazy `import()` хийнэ: тестүүд npm install-гүй ажиллана, cold start-д хэрэггүй үед ачаалахгүй.
 * Token-ийг санах ойд хугацаа дуусахаас 2 минутын өмнө хүртэл хадгална (Fluid compute инстанс дахин ашиглагдана).
 */
import { gcpConfig } from './config.js';

const SCOPES = ['https://www.googleapis.com/auth/datastore'];

export class AuthNotConfiguredError extends Error {
  constructor() {
    super('GCP_AUTH_NOT_CONFIGURED');
    this.name = 'AuthNotConfiguredError';
  }
}

/**
 * @param {{ env?: Record<string, string|undefined>, importer?: (name: string) => Promise<any>, now?: () => number }} [opts]
 * @returns {{ mode: 'wif'|'key'|null, projectId: string, getAccessToken(): Promise<string> }}
 */
export function createGcpAuth(opts = {}) {
  const cfg = gcpConfig(opts.env ?? process.env);
  const importer = opts.importer ?? ((name) => import(name));
  const now = opts.now ?? Date.now;
  let client = null;
  let cached = { token: '', exp: 0 };

  async function getClient() {
    if (client) return client;
    if (cfg.mode === 'wif') {
      const [{ ExternalAccountClient }, { getVercelOidcToken }] = await Promise.all([
        importer('google-auth-library'),
        importer('@vercel/oidc'),
      ]);
      const w = cfg.wif;
      const providerPath = `projects/${w.projectNumber}/locations/global/workloadIdentityPools/${w.poolId}/providers/${w.providerId}`;
      // GCP_AUDIENCE (Default audience сонгосон бол) — Vercel-ийн «custom audience» жишээний дагуу хоёр газарт ижил
      const audience = w.audience || `//iam.googleapis.com/${providerPath}`;
      client = ExternalAccountClient.fromJSON({
        type: 'external_account',
        audience,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        token_url: 'https://sts.googleapis.com/v1/token',
        service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${w.serviceAccountEmail}:generateAccessToken`,
        subject_token_supplier: {
          getSubjectToken: () => (w.audience ? getVercelOidcToken({ audience: w.audience }) : getVercelOidcToken()),
        },
        scopes: SCOPES,
      });
      if (!client) throw new Error('GCP_WIF_CLIENT_FAILED');
      return client;
    }
    if (cfg.mode === 'key') {
      let creds;
      try {
        creds = JSON.parse(cfg.keyJson);
      } catch {
        throw new Error('GCP_KEY_JSON_INVALID');
      }
      if (!creds || typeof creds.client_email !== 'string' || typeof creds.private_key !== 'string') throw new Error('GCP_KEY_JSON_INVALID');
      const { JWT } = await importer('google-auth-library');
      client = new JWT({ email: creds.client_email, key: creds.private_key, scopes: SCOPES });
      return client;
    }
    throw new AuthNotConfiguredError();
  }

  return {
    mode: cfg.mode,
    projectId: cfg.projectId,
    async getAccessToken() {
      if (cached.token && cached.exp - 120_000 > now()) return cached.token;
      const c = await getClient();
      const res = await c.getAccessToken();
      const token = typeof res === 'string' ? res : res?.token;
      if (!token) throw new Error('GCP_TOKEN_EMPTY');
      // google-auth-library нь credentials.expiry_date-ийг тохируулдаг; байхгүй бол 10 минут гэж үзнэ
      const exp = Number(c.credentials?.expiry_date) || now() + 10 * 60_000;
      cached = { token, exp };
      return token;
    },
  };
}

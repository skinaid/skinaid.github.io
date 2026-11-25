/**
 * Messenger webhook-ийн логик (api/messenger.js нь жинхэнэ deps-ээр холбоно; тест хуурамч deps тарина).
 *
 * GET  — subscribe verify: hub.verify_token = META_VERIFY_TOKEN (timing-safe) → hub.challenge, эс бөгөөс 403.
 * POST — 1) ТҮҮХИЙ body байт дээр X-Hub-Signature-256 (META_APP_SECRET; байхгүй = 503, буруу = 401) — JSON.parse-аас ӨМНӨ.
 *        2) parseWebhook: текстийг нууцлах, PSID-г hash (PSID_SALT), хавсралтын төрөл л. META_PAGE_ID-ээс бусдыг хаяна.
 *        3) Тохиргоо off / kill switch → юу ч хадгалахгүй, 200.
 *        4) `messenger_events/{id}` create (exists=false) — Meta-ийн давтан илгээлт нэг л мөр.
 *        5) 200 шууд (Meta 20 секундэд хариу хүлээдэг) → waitUntil: шинэ event-тэй яриа + гацсан event (≤ 2 яриа).
 * Серверийн эрх (GCP) тохируулаагүй бол 200 (Meta дахин дахин илгээж subscription-ыг унтраахаас сэргийлнэ) + лог.
 * Firestore түр алдаа = 503 (Meta дахин илгээнэ). Body, толгой, PSID-г ХЭЗЭЭ Ч логлохгүй.
 */
import { metaConfig } from './social/meta-config.js';
import { verifyMetaSignature, verifyWebhookChallenge } from './social/meta-signature.js';
import { parseWebhook, psidHash } from './social/meta-events.js';
import { configStatus } from './config.js';

export const MAX_BODY_BYTES = 1_000_000;
const HEARTBEAT_MS = 10 * 60_000;

const text = (body, status, extra = {}) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });

/**
 * @param {{ env?: Record<string, string|undefined>, getRuntime: () => ({ store: any, pipeline: any } | null),
 *   now?: () => Date, log?: (m: string) => void }} deps
 *   getRuntime — серверийн эрх тохируулаагүй бол null
 */
export function createWebhookHandlers(deps) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m) => console.warn(m));
  let lastHeartbeat = 0;

  async function GET(request) {
    const { verifyToken } = metaConfig(env);
    const challenge = verifyWebhookChallenge(new URL(request.url).searchParams, verifyToken);
    if (!challenge) return text('Forbidden', 403);
    return text(challenge, 200);
  }

  /**
   * @param {Request} request
   * @param {(p: Promise<unknown>) => void} waitUntil
   */
  async function POST(request, waitUntil) {
    const cfg = metaConfig(env);
    if (!cfg.appSecret || !cfg.psidKey) {
      log('[messenger] webhook: META_APP_SECRET эсвэл PSID_SALT тохируулаагүй');
      return text('Unavailable', 503);
    }
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) return text('Too large', 413);
    const raw = new Uint8Array(await request.arrayBuffer());
    if (raw.byteLength > MAX_BODY_BYTES) return text('Too large', 413);
    if (!verifyMetaSignature(raw, request.headers.get('x-hub-signature-256'), cfg.appSecret)) {
      log('[messenger] webhook: гарын үсэг таарсангүй');
      return text('Invalid signature', 401);
    }
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return text('Bad request', 400);
    }
    const { events } = parseWebhook(body);
    const ours = cfg.pageId ? events.filter((e) => e.pageId === cfg.pageId) : [];
    if (events.length && !cfg.pageId) log('[messenger] webhook: META_PAGE_ID тохируулаагүй — event хадгалсангүй');
    if (!ours.length) return text('OK', 200);

    const rt = deps.getRuntime();
    if (!rt) {
      log('[messenger] webhook: серверийн эрх (GCP) тохируулаагүй — event хадгалсангүй');
      return text('OK', 200);
    }

    const created = new Set();
    try {
      const settings = await rt.store.readSettings();
      if (!settings.active) return text('OK', 200);
      for (const ev of ours) {
        const h = psidHash(ev.pageId, ev.psid, cfg.psidKey);
        if ((await rt.store.createEvent(ev, h)) === 'created') created.add(h);
      }
    } catch (e) {
      log(`[messenger] webhook: Firestore алдаа ${e?.status || e?.httpStatus || ''}`.trim());
      return text('Unavailable', 503);
    }

    const t = now().getTime();
    const heartbeat = t - lastHeartbeat > HEARTBEAT_MS;
    if (heartbeat) lastHeartbeat = t;
    waitUntil((async () => {
      try {
        if (heartbeat) await rt.store.patchStatus({ lastWebhookAt: now(), config: configStatus(env) });
        for (const h of created) await rt.pipeline.processThread(h);
        await rt.pipeline.sweepStale({ maxThreads: 2 });
      } catch (e) {
        log(`[messenger] webhook дараах боловсруулалт: ${e?.status || e?.name || 'error'}`);
      }
    })());
    return text('OK', 200);
  }

  return { GET, POST };
}

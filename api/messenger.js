/**
 * Facebook Messenger webhook — https://www.skinaid.mn/api/messenger (Meta developer апп → Webhooks).
 * 1-р үе шат (сүүдэр): мессежийг бүртгэж AI ноорог бичнэ, үйлчлүүлэгч рүү ЮУ Ч илгээхгүй.
 * Логик: api/_lib/webhook.js. Web стандартын Request (түүхий body — гарын үсэг шалгахад), body parser байхгүй.
 */
import { waitUntil } from '@vercel/functions';
import { createWebhookHandlers } from './_lib/webhook.js';
import { getRuntime } from './_lib/runtime.js';

const handlers = createWebhookHandlers({ getRuntime: () => getRuntime() });

export function GET(request) {
  return handlers.GET(request);
}

export function POST(request) {
  return handlers.POST(request, waitUntil);
}

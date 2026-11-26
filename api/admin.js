/**
 * Admin-ийн серверийн үйлдэл — POST https://www.skinaid.mn/api/admin (admin «Messenger AI → Сургалт»).
 * Firebase ID token (Google, allowlist = firestore.rules) шаардана. Логик: api/_lib/admin-api.js.
 * Үйлчлүүлэгч рүү ЮУ Ч илгээхгүй (туршилтын асуулт = ноорог л, хадгалахгүй).
 */
import { createAdminHandler } from './_lib/admin-api.js';
import { getRuntime } from './_lib/runtime.js';

const handler = createAdminHandler({ getRuntime: () => getRuntime() });

export function POST(request) {
  return handler(request);
}

export function GET() {
  return new Response(JSON.stringify({ ok: false, error: 'method' }), { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST', 'Cache-Control': 'no-store' } });
}

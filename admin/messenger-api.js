/* ==========================================================================
   SKIN AID admin — POST /api/admin (Messenger AI-ийн серверийн үйлдэл): Firebase ID token-оор. «Сургалт», «Тойм»,
   ноорогийн үнэлгээний дараах хямралын шалгалт хуваалцана.
   ========================================================================== */
import { session, errText } from './core.js?v=2c361933';
import { apiErrorText } from './messenger-lib.js?v=06a76b56';

const codeErr = (code, body) => Object.assign(new Error(code), { apiCode: code, body });
/** Хариу ирэхгүй (сүлжээ гацсан) бол ийм хугацааны дараа таслана — функцийн дээд хугацаа 60 с (аудит: «Зогсоох» гацдаг байв) */
const API_TIMEOUT_MS = 75_000;
/** @returns {Promise<any>} — алдаа: { apiCode, body } */
export async function api(action, payload = {}, { timeoutMs = API_TIMEOUT_MS } = {}) {
  if (!session.user) throw codeErr('unauthorized');
  let token;
  try { token = await session.user.getIdToken(); } catch (_) { throw codeErr('unauthorized'); }
  let res;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    res = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, ...payload }), cache: 'no-store', signal: ctl.signal });
  } catch (_) { throw codeErr(ctl.signal.aborted ? 'client_timeout' : 'network'); } finally { clearTimeout(timer); }
  let j = null;
  try { j = await res.json(); } catch (_) { j = null; }
  // JSON биш хариу: 404/405/501 (GitHub Pages, localhost) = функц энэ хаяг дээр алга; бусад (504 timeout г.м.) = серверийн алдаа
  if (!j || typeof j !== 'object' || (!j.ok && typeof j.error !== 'string')) throw codeErr([404, 405, 501].includes(res.status) ? 'no_server' : 'server_error');
  if (!res.ok || !j.ok) throw codeErr(j.error, j);
  return j;
}
export const apiMsg = (e) => (e && e.apiCode ? apiErrorText(e.apiCode) : errText(e));

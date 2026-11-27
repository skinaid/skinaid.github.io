/**
 * UB Beauty → `settings/catalog` шинэчлэл (сервер). Өдөр бүрийн cron (api/_lib/cron.js) дуудна; admin
 * «Үйлчилгээ / Багц» хуудас хөтөч дээрээ ижил дүрмээр (assets/js/ub-catalog.js) шинэчилдэг.
 *
 * Түлхүүр = UB Beauty-ийн НУУЦ түлхүүр `UBBEAUTY_SECRET_KEY` (`sk_live_…`, os.ubbeauty.mn → Холболт → Вэб суваг →
 * «Түлхүүр үүсгэх», төрөл: нууц) — Vercel env-д л, git/сайтын файлд ХЭЗЭЭ Ч үгүй. Тохируулаагүй бол алгасна.
 * Бичилт = баримтын updateTime precondition-той (admin тэр мөчид хадгалсан бол дарж бичихгүй, дараагийн өдөр).
 * Зөвхөн t, p, hidden, hiddenSite, ub, ubOff өөрчлөгдөнө; нэр, тайлбар, ангилал, багц хөндөгдөхгүй.
 */
import { applyUbCatalog, fetchUbServices } from '../../assets/js/ub-catalog.js';
import { API_BASE } from '../../assets/js/ubbeauty-config.js';
import { setWrite } from './firestore.js';

const t = (env, k) => String(env[k] ?? '').trim();

export function ubSyncConfig(env = process.env) {
  const key = t(env, 'UBBEAUTY_SECRET_KEY');
  return { apiBase: t(env, 'UBBEAUTY_API_BASE') || API_BASE, key: /^sk_live_[A-Za-z0-9_-]{43}$/.test(key) ? key : '' };
}

/**
 * @param {{ fs: { get(path: string): Promise<any>, commit(writes: any[]): Promise<any> }, env?: Record<string, string|undefined>,
 *   fetchImpl?: typeof fetch, now?: () => Date }} deps
 * @returns {Promise<{ status: 'skipped'|'unchanged'|'updated'|'aborted'|'conflict', reason?: string, changed?: number }>}
 */
export async function syncUbCatalog(deps) {
  const cfg = ubSyncConfig(deps.env ?? process.env);
  if (!cfg.key) return { status: 'skipped', reason: 'no_key' };
  const doc = await deps.fs.get('settings/catalog');
  const services = doc?.data?.services;
  // Admin нэг ч удаа хадгалаагүй (сайт анхны утгаар) бол сервер баримт ҮҮСГЭХГҮЙ — admin эхлээд хадгална
  if (!Array.isArray(services)) return { status: 'skipped', reason: 'no_catalog' };
  const ub = await fetchUbServices({ apiBase: cfg.apiBase, key: cfg.key, fetchImpl: deps.fetchImpl });
  const r = applyUbCatalog(services, ub);
  if (!r.ok) return { status: 'aborted', reason: r.reason };
  if (!r.changed.length) return { status: 'unchanged', changed: 0 };
  const now = deps.now ?? (() => new Date());
  try {
    await deps.fs.commit([setWrite('settings/catalog', { ...doc.data, services: r.services, ubSyncedAt: now() },
      { updateTime: doc.updateTime })]);
  } catch (e) {
    if (e?.isPrecondition) return { status: 'conflict' };
    throw e;
  }
  return { status: 'updated', changed: r.changed.length };
}

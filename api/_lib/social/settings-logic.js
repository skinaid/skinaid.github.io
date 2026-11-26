/**
 * Messenger AI — тохиргооны (`messenger_settings/main`) шалгалт ба анхдагч утга. ЦЭВЭР модуль.
 * Эх сурвалж: skinaid/ubbeauty@1a43c95c src/lib/social/settings-logic.ts (parseSocialCaps, SOCIAL_CAP_LIMITS,
 * SOCIAL_DEFAULTS). SkinAid-д өөрчилсөн: Supabase-ийн алдааны түлхүүр/хуудасны мессежийг хассан (admin нь Firestore-д
 * шууд бичдэг — admin/m-messenger.js); `normalizeSettings` (сервер уншихад) нэмсэн. Хязгаар = firestore.rules-тэй
 * ИЖИЛ (tools/test/messenger-rules.test.mjs тулгана).
 */
import { isSocialMode, TEST_THREADS_MAX } from './labels.js';

export const SOCIAL_CAP_LIMITS = Object.freeze({ runsMax: 100_000, usdMax: 1000 });
export const SOCIAL_DEFAULTS = Object.freeze({ mode: 'off', runs: 3000, usd: 50 });

/** Маягтын хязгаар → тоо (хоосон = анхдагч); хүрээнээс гадуур бол null. Доллар: «12,5» = 12.5, «1,000» = 1000 (аудит 2026-11-25). */
export function parseSocialCaps(runsRaw, usdRaw) {
  const r = String(runsRaw ?? '').replace(/[\s,]/g, '');
  const u0 = String(usdRaw ?? '').replace(/[\s$]/g, '');
  const u = /^\d+,\d{1,2}$/.test(u0) ? u0.replace(',', '.') : u0.replace(/,/g, '');
  const runs = r === '' ? SOCIAL_DEFAULTS.runs : /^\d{1,6}$/.test(r) ? Number(r) : NaN;
  const usd = u === '' ? SOCIAL_DEFAULTS.usd : /^\d{1,4}(\.\d{1,2})?$/.test(u) ? Number(u) : NaN;
  if (!Number.isFinite(runs) || runs < 0 || runs > SOCIAL_CAP_LIMITS.runsMax) return null;
  if (!Number.isFinite(usd) || usd < 0 || usd > SOCIAL_CAP_LIMITS.usdMax) return null;
  return { runs, usd };
}

/** psidHash (messenger_threads-ийн id) — HMAC-SHA256 hex */
export const THREAD_ID_RE = /^[0-9a-f]{64}$/;
export const isThreadId = (v) => typeof v === 'string' && THREAD_ID_RE.test(v);

/**
 * Firestore-оос уншсан тохиргоо → аюулгүй утга. Баримт байхгүй / буруу = УНТРААЛТТАЙ (fail-closed).
 * @param {Record<string, unknown> | null | undefined} doc
 * `autoAudience`: 'all'-оос бусад бүх утга (байхгүй, буруу) = 'test' (fail-closed). `testThreads`: зөвхөн psidHash (64 hex),
 * давхардалгүй, ≤ TEST_THREADS_MAX.
 * @returns {{ mode: 'off'|'shadow'|'auto', killSwitch: boolean, monthlyRunCap: number, monthlyCostCapUsd: number,
 *   autoAudience: 'test'|'all', testThreads: string[], active: boolean }}
 */
export function normalizeSettings(doc) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const mode = isSocialMode(d.mode) ? d.mode : 'off';
  // Талбар байхгүй = асаагаагүй; false-оос өөр утга (true, буруу төрөл) = ЗОГСООСОН (fail-closed)
  const killSwitch = d.killSwitch === undefined ? false : d.killSwitch !== false;
  const capNum = (v, def, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : def);
  const monthlyRunCap = Math.floor(capNum(d.monthlyRunCap, SOCIAL_DEFAULTS.runs, SOCIAL_CAP_LIMITS.runsMax));
  const monthlyCostCapUsd = capNum(d.monthlyCostCapUsd, SOCIAL_DEFAULTS.usd, SOCIAL_CAP_LIMITS.usdMax);
  const autoAudience = d.autoAudience === 'all' ? 'all' : 'test';
  const testThreads = [...new Set((Array.isArray(d.testThreads) ? d.testThreads : []).filter(isThreadId))].slice(0, TEST_THREADS_MAX);
  return { mode, killSwitch, monthlyRunCap, monthlyCostCapUsd, autoAudience, testThreads, active: mode !== 'off' && !killSwitch };
}

/**
 * «Амьд» яриа: бот энэ хүнд ШУУД хариулж болно — горим «Автомат», зогсоолтгүй, үзэгчид таарсан. Бусад бүх ярианд сүүдэр.
 * @param {ReturnType<typeof normalizeSettings>} settings  normalizeSettings-ийн гаралт (түүхий баримт биш)
 * @param {string} psidHash
 */
export function isLive(settings, psidHash) {
  if (!settings || settings.mode !== 'auto' || settings.killSwitch !== false) return false;
  if (settings.autoAudience === 'all') return true;
  return isThreadId(psidHash) && Array.isArray(settings.testThreads) && settings.testThreads.includes(psidHash);
}

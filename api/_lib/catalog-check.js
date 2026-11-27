/**
 * Messenger AI — каталогийн («Үйлчилгээ / Багц», Firestore `settings/catalog`) хамрах тайлан ба ҮНЭГҮЙ (AI-гүй) шалгалт.
 * ЦЭВЭР модуль. Admin «Сургалт» → «Үйлчилгээ бүрээр» (api/_lib/admin-api.js `knowledge` үйлдэл).
 *
 * Оролт: knowledge.js `knowledgeInput()`-ийн мөрүүд (бүх мөр, нуусан ч) + `buildSocialCatalog()`-ийн үр дүн (LLM-д очих
 * баримт). Мөр бүрийн хувьд «бот юу мэдэж байна» + шалгалтын тэмдэг:
 *   алдаа       hidden_leak    — нуусан мөр ботын мэдлэгт орсон
 *               missing        — сайтад харагдах мөр ботын мэдлэгт ороогүй (хязгаар, нэр хоосон / хувийн мэдээлэлтэй г.м.)
 *               price_mismatch — үнийн ₮ дүн ботын «хэлж болох дүн»-д алга (бот үнийг хэлж чадахгүй)
 *   анхааруулга desc_truncated — тайлбар хязгаараас урт → эхний хэсэг л очно
 *               no_desc        — тайлбаргүй үйлчилгээ (бот зөвхөн нэр, үнийг мэднэ)
 *               no_duration    — хугацаагүй
 *               kb_orphan      — мэдлэг каталогт байхгүй үйлчилгээнд холбогдсон
 *   мэдээлэл    no_price       — үнэ сайтад харагддаггүй (UB Beauty-д нуусан) → бот «үнийг ажилтан хэлнэ» гэнэ
 * Утга (нэр, үнэ) нь нийтийн каталогийнх — admin-д л буцна, LLM руу ЯВАХГҮЙ.
 */
import { CATALOG_LIMITS, factId, priceAmounts } from './social/catalog-safe.js';

export const CHECK_LEVEL = Object.freeze({
  hidden_leak: 'error', missing: 'error', price_mismatch: 'error',
  desc_truncated: 'warn', no_desc: 'warn', no_duration: 'warn', kb_orphan: 'warn',
  no_price: 'info',
});

/** Үйлчилгээнд холбосон мэдлэгийн id → үйлчилгээний id (admin/messenger-lib.js `kbServiceId`-тэй ижил) */
export const kbServiceId = (id) => (/^s_([A-Za-z0-9-]{1,24})_[A-Za-z0-9]+$/.exec(String(id ?? '')) || [])[1] || '';

const str = (v) => (typeof v === 'string' ? v : '');
/** catalog-safe.js `clean`-ий хэмжээтэй ижил тооцоо (хоосон зай нэгтгэсэн) */
const norm = (s) => str(s).replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * @param {{ services: readonly any[], packages: readonly any[] }} input  knowledgeInput() (kb-тэй бол kb[].id-г ч)
 * @param {{ facts: readonly { id: string, kind: string }[], allowedAmounts: readonly number[] }} catalog  buildSocialCatalog()
 * @param {{ kbIds?: readonly string[] }} [opt]  — мэдлэгийн бүх бичлэгийн id (ноорог ч; эс бөгөөс баримтаас)
 */
export function catalogCoverage(input, catalog, opt = {}) {
  const factIds = new Set((catalog.facts || []).map((f) => f.id));
  const allowed = new Set(catalog.allowedAmounts || []);
  const kbIds = opt.kbIds ?? (catalog.facts || []).filter((f) => f.kind === 'kb').map((f) => f.id.slice(3));
  /** үйлчилгээний id → холбосон мэдлэгийн id[] */
  const linked = new Map();
  for (const id of kbIds) {
    const sid = kbServiceId(id);
    if (!sid) continue;
    if (!linked.has(sid)) linked.set(sid, []);
    linked.get(sid).push(id);
  }

  const services = (input.services || []).filter((s) => s && norm(s.name)).map((s) => {
    const id = str(s.id);
    const hidden = s.hidden === true;
    const inPrompt = factIds.has(factId('service', id));
    const price = norm(s.price);
    const amounts = priceAmounts(price);
    const desc = norm(s.description);
    const dur = norm(s.duration);
    const checks = [];
    if (hidden && inPrompt) checks.push('hidden_leak');
    if (!hidden && !inPrompt) checks.push('missing');
    if (!hidden) {
      if (!amounts.length) checks.push('no_price');
      else if (inPrompt && amounts.some((n) => !allowed.has(n))) checks.push('price_mismatch');
      if (!desc) checks.push('no_desc');
      else if (desc.length > CATALOG_LIMITS.descriptionChars) checks.push('desc_truncated');
      if (!dur) checks.push('no_duration');
    }
    return {
      kind: 'service', id, name: norm(s.name), category: norm(s.category), catKey: str(s.catKey), hidden, inPrompt,
      price: amounts.length ? price : '', duration: dur,
      descChars: desc.length, descSent: inPrompt ? Math.min(desc.length, CATALOG_LIMITS.descriptionChars) : 0,
      kb: linked.get(id) || [], checks,
    };
  });

  const packages = (input.packages || []).filter((p) => p && norm(p.name)).map((p) => {
    const id = str(p.id);
    const hidden = p.hidden === true;
    const inPrompt = factIds.has(factId('package', id));
    const price = norm(p.price);
    const amounts = priceAmounts(price);
    const checks = [];
    if (hidden && inPrompt) checks.push('hidden_leak');
    if (!hidden && !inPrompt) checks.push('missing');
    if (!hidden) {
      if (!amounts.length) checks.push('no_price');
      else if (inPrompt && amounts.some((n) => !allowed.has(n))) checks.push('price_mismatch');
    }
    return { kind: 'package', id, name: norm(p.name), hidden, inPrompt, price: amounts.length ? price : '', kb: linked.get(id) || [], checks };
  });

  const known = new Set([...services, ...packages].map((r) => r.id));
  const orphans = [...linked.entries()].filter(([sid]) => !known.has(sid)).flatMap(([, ids]) => ids);

  const rows = [...services, ...packages];
  const count = (lvl) => rows.reduce((n, r) => n + r.checks.filter((c) => CHECK_LEVEL[c] === lvl).length, 0) + (lvl === 'warn' ? orphans.length : 0);
  return {
    summary: {
      services: services.length,
      servicesVisible: services.filter((r) => !r.hidden).length,
      packages: packages.length,
      inPrompt: rows.filter((r) => r.inPrompt).length,
      errors: count('error'),
      warnings: count('warn'),
      linkedKb: kbIds.filter((id) => kbServiceId(id)).length,
    },
    services,
    packages,
    /** kb_orphan — каталогт байхгүй үйлчилгээнд холбогдсон мэдлэг */
    orphans,
  };
}

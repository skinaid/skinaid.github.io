// vercel.json-ийн эмчилгээний хуудас руу заасан (destination нь /emchilgee/ эхэлсэн) redirect-уудыг build удирдана.
// Нийтлэгдсэн хуудас бүрийн `legacy` (хуучин Wix URL) → 308. Vercel кирилл эхийг ЗӨВХӨН percent-encoded
// (encodeURI, том үсгийн hex) хэлбэрээр таарна (2026-11-08 туршсан). Дүрмүүд Wix-ийн catch-all (…/:rest*)-аас өмнө орно.

import { BuildError } from './assets.mjs';

const BAD = /[\s?#:()*+\\]/;
const isCatchAll = (r) => !r.has && typeof r.source === 'string' && /\/:rest\*$/.test(r.source);
export const isManaged = (r) => typeof r.destination === 'string' && r.destination.startsWith('/emchilgee/');

/**
 * @param {string} text            одоогийн vercel.json
 * @param {{slug: string, legacy: string[]}[]} published
 * @param {(src: string) => RegExp} toRegExp  check.mjs sourceToRegExp
 * @returns {{text: string, errors: string[], rules: object[]}}
 */
export function manageRedirects(text, published, toRegExp) {
  const errors = [];
  const cfg = JSON.parse(text);
  const all = cfg.redirects || [];
  const kept = all.filter((r) => !isManaged(r));
  const seen = new Map();
  const rules = [];
  for (const pg of published) {
    for (const raw of pg.legacy || []) {
      const p = String(raw).normalize('NFC');
      if (!p.startsWith('/') || p.length < 2 || BAD.test(p) || p.endsWith('/')) { errors.push(`${pg.slug}: legacy "${raw}" буруу зам (/-ээр эхэлж, ? # : ( ) * + зай, төгсгөлийн / агуулахгүй)`); continue; }
      if (p === '/emchilgee/' + pg.slug || p.startsWith('/emchilgee')) { errors.push(`${pg.slug}: legacy "${raw}" нь сайтын өөрийн зам`); continue; }
      const source = encodeURI(p);
      if (seen.has(source)) { errors.push(`legacy "${raw}" давхардсан (${seen.get(source)}, ${pg.slug})`); continue; }
      seen.set(source, pg.slug);
      rules.push({ source, destination: '/emchilgee/' + pg.slug, permanent: true });
    }
  }
  rules.sort((a, b) => a.source.localeCompare(b.source));
  const at = kept.findIndex(isCatchAll);
  if (rules.length && at === -1) throw new BuildError('vercel.json: Wix catch-all (…/:rest*) дүрэм олдсонгүй — redirect-ийн байрлал тодорхойгүй');
  const next = at === -1 ? kept : [...kept.slice(0, at), ...rules, ...kept.slice(at)];
  // Эхний таарах дүрэм (host-гүй) нь өөрөө байх ёстой — өмнөх дүрэм далдлахгүй
  const plain = next.filter((r) => !r.has);
  for (const r of rules) {
    const path = decodeURI(r.source);
    const first = plain.find((x) => { try { return toRegExp(x.source).test(r.source) || toRegExp(x.source).test(path); } catch { return false; } });
    if (first !== r) errors.push(`redirect ${path} → ${r.destination}: өмнөх "${first && first.source}" дүрэм далдалж байна`);
  }
  cfg.redirects = next;
  return { text: JSON.stringify(cfg, null, 2) + '\n', errors, rules };
}

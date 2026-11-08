// SEO/бүтцийн шалгалт: build-ийн гаргасан HTML-ийг нийтлэхээс өмнө шалгана.
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { htmlBaseDir, needsVersion } from './assets.mjs';

const pick = (html, re) => { const m = html.match(re); return m ? m[1] : null; };
const decode = (s) => s && s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function pageMeta(html) {
  return {
    title: decode(pick(html, /<title>([^<]*)<\/title>/)),
    description: decode(pick(html, /<meta name="description" content="([^"]*)"/)),
    canonical: pick(html, /<link rel="canonical" href="([^"]*)"/),
    ogUrl: pick(html, /<meta property="og:url" content="([^"]*)"/),
    robots: pick(html, /<meta name="robots" content="([^"]*)"/),
    h1: (html.match(/<h1[\s>]/g) || []).length,
  };
}

/** Vercel (path-to-regexp) эхийг энгийн RegExp болгоно: /:a(re), /:a*, /:a */
export function sourceToRegExp(src) {
  let out = '';
  for (let i = 0; i < src.length;) {
    const rest = src.slice(i);
    let m;
    if ((m = rest.match(/^\/:[A-Za-z_]\w*\*/))) { out += '(?:/.*)?'; i += m[0].length; continue; }
    if ((m = rest.match(/^:[A-Za-z_]\w*\(/))) {
      let depth = 1, j = m[0].length;
      while (j < rest.length && depth) { if (rest[j] === '(') depth++; else if (rest[j] === ')') depth--; j++; }
      out += '(' + rest.slice(m[0].length, j - 1) + ')'; i += j; continue;
    }
    if ((m = rest.match(/^:[A-Za-z_]\w*/))) { out += '([^/]+)'; i += m[0].length; continue; }
    out += rest[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i += 1;
  }
  return new RegExp('^' + out + '$');
}

/** vercel.json-ийн redirect эх (host-гүй) — дотоод холбоос redirect руу заахыг илрүүлэхэд */
function redirectMatchers(root) {
  const cfg = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
  return (cfg.redirects || []).filter((r) => !r.has).map((r) => {
    const re = sourceToRegExp(r.source);
    return (p) => re.test(p);
  });
}

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** HTML-ийн бүх href/src/srcset холбоос: [attr, url] */
function refsOf(html) {
  const out = [];
  for (const [, attr, val] of html.matchAll(/\b(href|src|srcset)="([^"]+)"/g)) {
    if (attr === 'srcset') val.split(',').forEach((part) => { const u = part.trim().split(/\s+/)[0]; if (u) out.push([attr, u]); });
    else out.push([attr, val]);
  }
  return out;
}

/**
 * @returns {{errors: string[], warnings: string[]}}
 * strict (--check): git-д бүртгэлгүй хуудас/гаралтын файл = алдаа; энгийн build-д анхааруулга (шинэ хуудсыг эхний
 * build-ийн дараа `git add` хийх боломж олгоно).
 */
export function checkSite({ root, site, pages, otherHtml, files, catalog, tracked, strict = false }) {
  const errors = [];
  const untracked = new Set();
  const read = (rel) => (files.has(rel) ? files.get(rel) : readFileSync(join(root, rel), 'utf8'));
  // Vercel case-sensitive: git-д яг ийм бичлэгээр байгаа файл л deploy-д орно (macOS диск том/жижиг үсэг ялгадаггүй)
  const exists = (rel) => {
    if (!tracked) return files.has(rel) || existsSync(join(root, rel));
    if (tracked.has(rel)) return true;
    if (files.has(rel)) { untracked.add(rel); return true; }   // энэ build үүсгэсэн, commit хийгдээгүй
    return false;
  };
  if (tracked) {
    for (const rel of [...pages.map((p) => p.file), ...otherHtml, ...files.keys()]) if (!tracked.has(rel)) untracked.add(rel);
  }
  const isRedirect = redirectMatchers(root);
  const seen = { title: new Map(), description: new Map(), canonical: new Map() };

  for (const pg of pages) {
    const html = read(pg.file);
    const m = pageMeta(html);
    const want = site.origin + pg.path;
    if (!m.title || m.title.length < 10 || m.title.length > 70) errors.push(`${pg.file}: title урт ${m.title ? m.title.length : 0} (10–70 байх)`);
    if (!m.description || m.description.length < 50 || m.description.length > 170) errors.push(`${pg.file}: description урт ${m.description ? m.description.length : 0} (50–170 байх)`);
    if (m.canonical !== want) errors.push(`${pg.file}: canonical "${m.canonical}" ≠ "${want}"`);
    if (m.ogUrl && m.ogUrl !== want) errors.push(`${pg.file}: og:url "${m.ogUrl}" ≠ "${want}"`);
    if (m.robots && /noindex/.test(m.robots)) errors.push(`${pg.file}: индекслэгдэх хуудас noindex-тэй байна`);
    if (m.h1 !== 1) errors.push(`${pg.file}: h1 тоо ${m.h1} (яг 1 байх)`);
    for (const k of ['title', 'description', 'canonical']) {
      if (!m[k]) continue;
      if (seen[k].has(m[k])) errors.push(`${pg.file}: ${k} давхардсан (${seen[k].get(m[k])})`);
      seen[k].set(m[k], pg.file);
    }
  }

  const originAsset = new RegExp(reEsc(site.origin) + '/assets/[^"\'\\s<>),]+', 'g');
  for (const rel of [...pages.map((p) => p.file), ...otherHtml]) {
    const html = read(rel);
    // build тэмдэглэгээ: нээх/хаах бүр яг нэг удаа
    for (const name of new Set([...html.matchAll(/<!-- \/?build:([\w-]+) -->/g)].map((x) => x[1]))) {
      const o = html.split(`<!-- build:${name} -->`).length - 1, c = html.split(`<!-- /build:${name} -->`).length - 1;
      if (o !== 1 || c !== 1) errors.push(`${rel}: build:${name} тэмдэглэгээ ${o} нээх / ${c} хаах (яг 1/1 байх)`);
    }
    // JSON-LD: задлагдах, дотроо "<" агуулахгүй (HTML parser `</script` дээр тасалдаг — том/жижиг үсэг хамаарахгүй)
    for (const [, body] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script/gi)) {
      if (body.includes('<')) errors.push(`${rel}: JSON-LD дотор "<" байна (\\u003c болгох ёстой)`);
      try { JSON.parse(body); } catch (e) { errors.push(`${rel}: JSON-LD алдаатай — ${e.message}`); }
    }
    // Харьцангуй зам зөвхөн root index.html-д: trailingSlash:false тул `privacy/index.html` нь `/privacy` дээр,
    // 404.html аль ч гүнд үйлчлэгдэнэ — харьцангуй зам буруу газар руу задарна (8afb407-ийн алдаа).
    const relativeOk = !rel.includes('/') && rel !== '404.html';
    for (const [attr, ref] of refsOf(html)) {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(ref)) continue;
      const path = ref.split('#')[0].split('?')[0];
      if (!path) continue;
      if (!path.startsWith('/') && !relativeOk) { errors.push(`${rel}: ${attr}="${ref}" харьцангуй зам — "/"-ээр эхэлсэн зам бичнэ үү`); continue; }
      const abs = path.startsWith('/') ? path : '/' + normalize(join(htmlBaseDir(rel), path)).split('\\').join('/').replace(/^\.\//, '');
      if (attr === 'href') {
        if (abs.length > 1 && abs.endsWith('/')) errors.push(`${rel}: "${ref}" ташуу зураасаар төгссөн (Vercel 308 хийнэ)`);
        if (isRedirect.some((f) => f(abs.replace(/\/$/, '') || '/'))) errors.push(`${rel}: "${ref}" redirect руу заасан`);
      }
      const fsPath = abs === '/' ? 'index.html' : abs.slice(1).replace(/\/$/, '');
      if (!exists(fsPath) && !exists(fsPath + '/index.html')) errors.push(`${rel}: ${attr}="${ref}" файл олдсонгүй (git-д яг ийм бичлэгээр байх ёстой)`);
      if (abs.startsWith('/assets/') && needsVersion(abs) && !/\?v=[0-9a-f]{8}$/.test(ref)) errors.push(`${rel}: ${attr}="${ref}" хувилбаргүй`);
    }
    // og:image, JSON-LD logo/image зэрэг үнэмлэхүй /assets URL ч хувилбартай байх (immutable cache)
    for (const [u] of html.matchAll(originAsset)) {
      if (needsVersion(u) && !/\?v=[0-9a-f]{8}$/.test(u)) errors.push(`${rel}: ${u} хувилбаргүй`);
    }
  }

  // Багцын карт (гараар бичсэн) = catalog-defaults.js-ийн үнэ (JSON-LD priceRange үүнээс тооцогдоно)
  if (catalog && Array.isArray(catalog.packages)) {
    const home = read('index.html');
    for (const pk of catalog.packages) {
      const m = home.match(new RegExp(`data-pack="${reEsc(pk.id)}"[\\s\\S]*?</article>`));
      if (!m) errors.push(`index.html: багц "${pk.id}"-ийн карт (data-pack) олдсонгүй`);
      else if (!m[0].includes(`<strong>${pk.price}</strong>`)) errors.push(`index.html: багц ${pk.id}-ийн үнэ catalog-defaults.js-ийн "${pk.price}"-тэй зөрж байна`);
    }
  }

  // sitemap = хуудсын жагсаалт
  const sm = read('sitemap.xml');
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]).sort();
  const want = pages.map((p) => site.origin + p.path).sort();
  if (JSON.stringify(locs) !== JSON.stringify(want)) errors.push(`sitemap.xml: ${locs.join(', ')} ≠ ${want.join(', ')}`);
  const robots = read('robots.txt');
  if (!robots.includes(`Sitemap: ${site.origin}/sitemap.xml`)) errors.push('robots.txt: Sitemap мөр алга');

  const warnings = [];
  for (const rel of [...untracked].sort()) {
    (strict ? errors : warnings).push(`${rel}: git-д бүртгэлгүй (эсвэл том/жижиг үсэг зөрүүтэй) — Vercel дээр байхгүй болно; \`git add ${rel}\``);
  }
  return { errors, warnings };
}

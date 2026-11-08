// SEO/бүтцийн шалгалт: build-ийн гаргасан HTML-ийг нийтлэхээс өмнө шалгана.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';

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

export function checkSite({ root, site, pages, otherHtml, files }) {
  const errors = [];
  const read = (rel) => (files.has(rel) ? files.get(rel) : readFileSync(join(root, rel), 'utf8'));
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

  for (const rel of [...pages.map((p) => p.file), ...otherHtml]) {
    const html = read(rel);
    // JSON-LD задлагдах ёстой
    for (const [, body] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try { JSON.parse(body); } catch (e) { errors.push(`${rel}: JSON-LD алдаатай — ${e.message}`); }
    }
    // Дотоод холбоос: файл байх, redirect руу заахгүй, ташуу зураасгүй
    for (const [, href] of html.matchAll(/\bhref="([^"]+)"/g)) {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(href)) continue;
      const path = href.split('#')[0].split('?')[0];
      if (!path) continue;
      const abs = path.startsWith('/') ? path : '/' + normalize(join(dirname(rel), path)).replace(/^\.\//, '');
      if (abs.length > 1 && abs.endsWith('/')) errors.push(`${rel}: "${href}" ташуу зураасаар төгссөн (Vercel 308 хийнэ)`);
      if (isRedirect.some((f) => f(abs.replace(/\/$/, '') || '/'))) errors.push(`${rel}: "${href}" redirect руу заасан`);
      const fsPath = abs === '/' ? 'index.html' : abs.slice(1);
      const exists = existsSync(join(root, fsPath)) || existsSync(join(root, fsPath, 'index.html')) || files.has(fsPath);
      if (!exists) errors.push(`${rel}: "${href}" файл олдсонгүй`);
    }
    // /assets холбоос бүр хувилбартай байх
    for (const [, attr, url] of html.matchAll(/\b(src|href)="((?:\/|\.\.\/)?assets\/[^"]+)"/g)) {
      if (!/\?v=[0-9a-f]{8}$/.test(url)) errors.push(`${rel}: ${attr}="${url}" хувилбаргүй`);
    }
  }

  // sitemap = хуудсын жагсаалт
  const sm = read('sitemap.xml');
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]).sort();
  const want = pages.map((p) => site.origin + p.path).sort();
  if (JSON.stringify(locs) !== JSON.stringify(want)) errors.push(`sitemap.xml: ${locs.join(', ')} ≠ ${want.join(', ')}`);
  const robots = read('robots.txt');
  if (!robots.includes(`Sitemap: ${site.origin}/sitemap.xml`)) errors.push('robots.txt: Sitemap мөр алга');
  return errors;
}

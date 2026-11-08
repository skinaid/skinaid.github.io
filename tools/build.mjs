#!/usr/bin/env node
// SKIN AID — build скрипт (хамааралгүй, Node 18+).
//
//   node tools/build.mjs           # HTML-ийн build хэсгүүд, asset хувилбар, sitemap-ийг шинэчилнэ
//   node tools/build.mjs --check   # юу ч бичихгүй: файл хуучирсан эсвэл SEO шалгалт унавал exit 1
//
// Гараар бичсэн HTML-д зөвхөн <!-- build:NAME --> … <!-- /build:NAME --> хооронд бичнэ.
// Тэр хэсгүүдийг гараар бүү засаарай — дараагийн build дарна. Эх өгөгдөл:
//   assets/js/catalog-defaults.js   (үйлчилгээ, ангилал — admin-тай хуваалцдаг)
//   assets/js/catalog-render.js     (мөрийн HTML загвар — main.js-тэй хуваалцдаг)
//   content/site.mjs                (эмнэлгийн NAP, JSON-LD-ийн баримт, хуудсын жагсаалт)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { site, pages, otherHtml } from '../content/site.mjs';
import { homeGraph } from './lib/schema.mjs';
import { AssetStamper } from './lib/assets.mjs';
import { checkSite, pageMeta } from './lib/check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const files = new Map();                         // relPath → шинэ текст (санах ойд)
const read = (rel) => (files.has(rel) ? files.get(rel) : readFileSync(join(ROOT, rel), 'utf8'));

/* ---------- 1. Өгөгдөл ---------- */
function loadBrowserScript(rel, key) {
  const sandbox = { window: {}, globalThis: {} };
  sandbox.globalThis = sandbox.window;
  vm.runInNewContext(readFileSync(join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
  if (!sandbox.window[key]) throw new Error(`${rel}: window.${key} олдсонгүй`);
  return sandbox.window[key];
}
const catalog = loadBrowserScript('assets/js/catalog-defaults.js', 'SKINAID_DEFAULTS');
const R = loadBrowserScript('assets/js/catalog-render.js', 'SKINAID_RENDER');

/* ---------- 2. build хэсгүүдийг солих ---------- */
function region(html, name, content, file) {
  const re = new RegExp(`(<!-- build:${name} -->)([\\s\\S]*?)(\\n?([ \\t]*)<!-- /build:${name} -->)`);
  const m = html.match(re);
  if (!m) throw new Error(`${file}: <!-- build:${name} --> тэмдэглэгээ олдсонгүй`);
  const indent = m[4] || '';
  const body = content.split('\n').map((l) => (l ? indent + '  ' + l : l)).join('\n');
  return html.replace(re, `$1\n${body}\n${indent}<!-- /build:${name} -->`);
}

{
  let html = read('index.html');
  const meta = pageMeta(html);
  const home = pages.find((p) => p.jsonld === 'home');
  const graph = homeGraph(site, catalog, { path: home.path, title: meta.title, description: meta.description });
  html = region(html, 'jsonld', `<script type="application/ld+json">\n${JSON.stringify(graph)}\n</script>`, 'index.html');
  html = region(html, 'treat-chips', R.chips(catalog.cats).join('\n'), 'index.html');
  html = region(html, 'treat-list', catalog.treatments.map((t) => R.row(t, catalog.cats)).join('\n'), 'index.html');
  files.set('index.html', html);
}

/* ---------- 3. Asset хувилбар (JS module-ууд доороос дээш) ---------- */
const stamper = new AssetStamper(ROOT, files);
for (const rel of [...pages.map((p) => p.file), ...otherHtml]) {
  files.set(rel, stamper.stampHtml(rel, read(rel)));
}

/* ---------- 4. sitemap.xml (lastmod = хуудасны агуулга өөрчлөгдсөн огноо) ---------- */
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' }).format(new Date());
const lastmodFile = 'content/lastmod.json';
const lastmod = existsSync(join(ROOT, lastmodFile)) ? JSON.parse(readFileSync(join(ROOT, lastmodFile), 'utf8')) : {};
const contentHash = (html) => createHash('sha1').update(html.replace(/\?v=[0-9a-z]+/g, '')).digest('hex').slice(0, 12);
const nextLastmod = {};
for (const pg of pages) {
  const h = contentHash(read(pg.file));
  const prev = lastmod[pg.path];
  nextLastmod[pg.path] = prev && prev.hash === h ? prev : { hash: h, date: today };
}
files.set(lastmodFile, JSON.stringify(nextLastmod, null, 2) + '\n');
files.set('sitemap.xml', [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...pages.map((pg) => `  <url>\n    <loc>${site.origin}${pg.path}</loc>\n    <lastmod>${nextLastmod[pg.path].date}</lastmod>\n  </url>`),
  '</urlset>',
  '',
].join('\n'));

/* ---------- 5. Бичих / шалгах ---------- */
const changed = [];
for (const [rel, text] of files) {
  const abs = join(ROOT, rel);
  const old = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  if (old === text) continue;
  // --check: lastmod.json-ийн зөвхөн огноо өөрчлөгдсөн нь (хуудас өөрчлөгдсөн) өөрөө алдаа болно
  changed.push(rel);
  if (!CHECK) writeFileSync(abs, text);
}

const errors = checkSite({ root: ROOT, site, pages, otherHtml, files });
if (CHECK && changed.length) errors.unshift(`Build хуучирсан — дараах файлууд шинэчлэгдэх ёстой: ${changed.join(', ')} (node tools/build.mjs ажиллуулна уу)`);

if (errors.length) {
  console.error(`✗ ${errors.length} алдаа:\n  - ` + errors.join('\n  - '));
  process.exit(1);
}
console.log(CHECK ? '✓ Шалгалт амжилттай: build шинэ, SEO шалгалт алдаагүй.' : `✓ Build дууслаа. Өөрчлөгдсөн: ${changed.length ? changed.join(', ') : 'алга'}`);

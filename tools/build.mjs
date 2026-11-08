#!/usr/bin/env node
// SKIN AID — build скрипт (хамааралгүй, Node 18+).
//
//   node tools/build.mjs           # HTML-ийн build хэсгүүд, asset хувилбар, sitemap-ийг шинэчилнэ
//   node tools/build.mjs --check   # юу ч бичихгүй: файл хуучирсан эсвэл SEO шалгалт унавал exit 1
//                                  # (.githooks/pre-push push бүрийн өмнө ажиллуулна)
//
// Гараар бичсэн HTML-д зөвхөн <!-- build:NAME --> … <!-- /build:NAME --> хооронд бичнэ.
// Тэр хэсгүүдийг гараар бүү засаарай — дараагийн build дарна. Эх өгөгдөл:
//   assets/js/catalog-defaults.js   (үйлчилгээ, ангилал — admin-тай хуваалцдаг)
//   assets/js/catalog-render.js     (мөрийн HTML загвар — main.js-тэй хуваалцдаг)
//   content/site.mjs                (эмнэлгийн NAP, JSON-LD-ийн баримт, байнгын хуудсууд)
//   tools/lib/layout.mjs            (header/footer — нүүр, дэд хуудас бүгд)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { site, corePages, otherHtml } from '../content/site.mjs';
import { siteHeader, siteFooter } from './lib/layout.mjs';
import { homeGraph } from './lib/schema.mjs';
import { AssetStamper, BuildError, vercelIgnore } from './lib/assets.mjs';
import { checkSite, pageMeta } from './lib/check.mjs';

// Зориуд шидсэн алдаа (BuildError) → нэг мөр; бусад (catalog-defaults.js-ийн SyntaxError г.м.) → file:line-тэй stack
process.on('uncaughtException', (e) => { console.error(e instanceof BuildError ? `✗ ${e.message}` : e); process.exit(1); });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const files = new Map();                         // relPath → шинэ текст (санах ойд)
const read = (rel) => (files.has(rel) ? files.get(rel) : readFileSync(join(ROOT, rel), 'utf8'));

/* ---------- 1. Өгөгдөл ---------- */
function loadBrowserScript(rel, key) {
  const sandbox = { window: {}, globalThis: {} };
  sandbox.globalThis = sandbox.window;
  vm.runInNewContext(readFileSync(join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
  if (!sandbox.window[key]) throw new BuildError(`${rel}: window.${key} олдсонгүй`);
  return sandbox.window[key];
}
const catalog = loadBrowserScript('assets/js/catalog-defaults.js', 'SKINAID_DEFAULTS');
// Индекслэгдэх хуудсууд: байнгын хуудсууд (+ дараа нь content/pages-аас эмчилгээний хуудсууд)
const pages = [...corePages];
/** Нийтлэгдсэн эмчилгээний хуудасны URL (slug → '/emchilgee/<slug>' эсвэл null) */
const pageUrl = () => null;
const hubLive = false;
const R = loadBrowserScript('assets/js/catalog-render.js', 'SKINAID_RENDER');

/** git-д бүртгэлтэй файлууд (яг бичлэгээр). Vercel case-sensitive — локал macOS биш. */
function gitTracked() {
  try {
    return new Set(execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean));
  } catch {
    console.warn('⚠ git ls-files ажиллаагүй — asset git-д бүртгэлтэй эсэхийг шалгахгүй.');
    return null;
  }
}
const tracked = gitTracked();
const stamper = new AssetStamper(ROOT, files, { origin: site.origin, tracked, ignored: vercelIgnore(ROOT) });

/* ---------- 2. build хэсгүүдийг солих ---------- */
/** pad: мөр бүрт хаах тэмдэглэгээний доголын дараа нэмэх зай (анхдагч 2; layout-д '') */
function region(html, name, content, file, { pad = '  ' } = {}) {
  const open = `<!-- build:${name} -->`, close = `<!-- /build:${name} -->`;
  if (html.split(open).length !== 2 || html.split(close).length !== 2) {
    throw new BuildError(`${file}: ${open} … ${close} тэмдэглэгээ яг нэг удаа байх ёстой`);
  }
  const re = new RegExp(`(<!-- build:${name} -->)([\\s\\S]*?)(\\n?([ \\t]*)<!-- /build:${name} -->)`);
  const m = html.match(re);
  if (!m) throw new BuildError(`${file}: ${open} тэмдэглэгээ олдсонгүй`);
  const indent = m[4] || '';
  const body = content.split('\n').map((l) => (l ? indent + pad + l : l)).join('\n');
  // Replacer функц: агуулга дахь `$&`, `$1`, `$$` зэргийг String.replace тайлахгүй, яг байгаагаар нь оруулна
  return html.replace(re, (_, o) => `${o}\n${body}\n${indent}${close}`);
}
/** JSON-LD-г <script> дотор аюулгүй: `<` → \u003c (`</script`, `<!--` тэмдэглэгээг эвдэхгүй) */
const ldJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

{
  let html = read('index.html');
  const meta = pageMeta(html);
  const home = pages.find((p) => p.jsonld === 'home');
  const asset = (p) => stamper.withVersion('.', p);   // JSON-LD-ийн logo/image → ?v=hash (immutable cache)
  const graph = homeGraph(site, catalog, { path: home.path, title: meta.title, description: meta.description }, asset);
  html = region(html, 'jsonld', `<script type="application/ld+json">\n${ldJson(graph)}\n</script>`, 'index.html');
  html = region(html, 'treat-chips', R.chips(catalog.cats).join('\n'), 'index.html');
  html = region(html, 'treat-list', catalog.treatments.map((t) => R.row(t, catalog.cats)).join('\n'), 'index.html');
  const homeCtx = { home: true, site, pageUrl, hubLive };
  html = region(html, 'site-header', siteHeader(homeCtx), 'index.html', { pad: '' });
  html = region(html, 'site-footer', siteFooter(homeCtx), 'index.html', { pad: '' });
  files.set('index.html', html);
}

/* ---------- 3. Asset хувилбар (JS module-ууд доороос дээш) ---------- */
for (const rel of [...pages.map((p) => p.file), ...otherHtml]) {
  files.set(rel, stamper.stampHtml(rel, read(rel)));
}

/* ---------- 4. sitemap.xml (lastmod = хуудасны агуулга өөрчлөгдсөн огноо) ---------- */
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' }).format(new Date());
const lastmodFile = 'content/lastmod.json';
const lastmod = existsSync(join(ROOT, lastmodFile)) ? JSON.parse(readFileSync(join(ROOT, lastmodFile), 'utf8')) : {};
// Зөвхөн хуудасны өөрийн агуулга (title, description, <main>) — header/footer эсвэл ?v= өөрчлөгдөхөд lastmod хөдлөхгүй
const contentHash = (html) => {
  const m = pageMeta(html);
  const main = (html.match(/<main[\s>][\s\S]*<\/main>/) || [html])[0];
  return createHash('sha1').update([m.title, m.description, main].join('\n').replace(/\?v=[0-9a-z]+/g, '')).digest('hex').slice(0, 12);
};
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
  if (!CHECK) { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text); }
}

const { errors, warnings } = checkSite({ root: ROOT, site, pages, otherHtml, files, catalog, tracked, strict: CHECK });
if (warnings.length) console.warn(`⚠ ${warnings.length} анхааруулга:\n  - ` + warnings.join('\n  - '));
if (CHECK && changed.length) errors.unshift(`Build хуучирсан — дараах файлууд шинэчлэгдэх ёстой: ${changed.join(', ')} (node tools/build.mjs ажиллуулна уу)`);

if (errors.length) {
  console.error(`✗ ${errors.length} алдаа:\n  - ` + errors.join('\n  - '));
  process.exit(1);
}
console.log(CHECK ? '✓ Шалгалт амжилттай: build шинэ, SEO шалгалт алдаагүй.' : `✓ Build дууслаа. Өөрчлөгдсөн: ${changed.length ? changed.join(', ') : 'алга'}`);

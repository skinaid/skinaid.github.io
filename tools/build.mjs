#!/usr/bin/env node
// SKIN AID — build скрипт (хамааралгүй, Node 18+).
//
//   node tools/build.mjs            # HTML-ийн build хэсгүүд, эмчилгээний хуудсууд, asset хувилбар, sitemap-ийг шинэчилнэ
//   node tools/build.mjs --check    # юу ч бичихгүй: файл хуучирсан эсвэл SEO/контентын шалгалт унавал exit 1
//                                   # (.githooks/pre-push push бүрийн өмнө ажиллуулна)
//   node tools/build.mjs --preview  # content/drafts/-ийн ноорогтой хамт .preview/-д бичнэ (git-д орохгүй);
//                                   # node tools/preview.mjs-ээр харна
//
// Гараар бичсэн HTML-д зөвхөн <!-- build:NAME --> … <!-- /build:NAME --> хооронд бичнэ.
// Тэр хэсгүүдийг болон emchilgee/** файлуудыг гараар бүү засаарай — дараагийн build дарна. Эх өгөгдөл:
//   assets/js/catalog-defaults.js   (үйлчилгээ, ангилал — admin-тай хуваалцдаг)
//   assets/js/catalog-render.js     (мөрийн HTML загвар — main.js-тэй хуваалцдаг)
//   content/site.mjs                (эмнэлгийн NAP, JSON-LD-ийн баримт, байнгын хуудсууд)
//   content/pages/*.mjs             (эмчийн баталсан эмчилгээний хуудсууд), content/doctors.mjs, content/hub.mjs
//   tools/lib/layout.mjs            (header/footer — нүүр, дэд хуудас бүгд)

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { site, corePages, otherHtml } from '../content/site.mjs';
import { siteHeader, siteFooter } from './lib/layout.mjs';
import { homeGraph, treatmentGraph, hubGraph } from './lib/schema.mjs';
import { AssetStamper, BuildError, vercelIgnore } from './lib/assets.mjs';
import { checkSite, pageMeta, sourceToRegExp } from './lib/check.mjs';
import { manageRedirects } from './lib/redirects.mjs';
import { loadContent, validatePage, reviewHash, priceInfo } from './lib/content.mjs';
import { findClaims } from './lib/claims.mjs';
import { renderTreatment, renderHub, GENERATED } from './lib/pages.mjs';
import { plain, wordCount } from './lib/render.mjs';

// Зориуд шидсэн алдаа (BuildError) → нэг мөр; бусад (catalog-defaults.js-ийн SyntaxError г.м.) → file:line-тэй stack
process.on('uncaughtException', (e) => { console.error(e instanceof BuildError ? `✗ ${e.message}` : e); process.exit(1); });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const PREVIEW = process.argv.includes('--preview');
if (CHECK && PREVIEW) throw new BuildError('--check ба --preview-ийг хамт ашиглахгүй');
const files = new Map();                         // relPath → шинэ текст (санах ойд)
const read = (rel) => (files.has(rel) ? files.get(rel) : readFileSync(join(ROOT, rel), 'utf8'));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' }).format(new Date());

/* ---------- 1. Өгөгдөл ---------- */
function loadBrowserScript(rel, key) {
  const sandbox = { window: {}, globalThis: {} };
  sandbox.globalThis = sandbox.window;
  vm.runInNewContext(readFileSync(join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
  if (!sandbox.window[key]) throw new BuildError(`${rel}: window.${key} олдсонгүй`);
  return sandbox.window[key];
}
const catalog = loadBrowserScript('assets/js/catalog-defaults.js', 'SKINAID_DEFAULTS');
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

/* ---------- 2. Эмчилгээний хуудсууд (content/pages; --preview үед content/drafts) ---------- */
const content = await loadContent(ROOT, { preview: PREVIEW });
const bookingOptions = (() => {
  const sel = (readFileSync(join(ROOT, 'index.html'), 'utf8').match(/<select id="f-service"[\s\S]*?<\/select>/) || [''])[0];
  return [...sel.matchAll(/<option(?![^>]*value="")[^>]*>([^<]+)<\/option>/g)].map((m) => m[1].trim());
})();
const contentErrors = [], contentWarnings = [];
{ // content/pipeline.mjs: үйлчилгээ бүр нэг л хуудсанд, catalog-д байх ёстой
  const owner = new Map(), ids = new Set(catalog.treatments.map((t) => t.id));
  for (const p of content.pipeline) {
    for (const id of [...(p.catalogIds || []), ...(p.alsoIds || [])]) if (!ids.has(id)) contentErrors.push(`content/pipeline.mjs: ${p.slug} — "${id}" catalog-defaults.js-д алга`);
    for (const id of p.catalogIds || []) {
      if (owner.has(id)) contentErrors.push(`content/pipeline.mjs: "${id}" ${owner.get(id)} ба ${p.slug} хоёуланд catalogIds-д байна`);
      owner.set(id, p.slug);
    }
  }
}
{ // content/hub.mjs: эмнэлгийн мэдэгдэлгүй, тэмдэггүй, бүрэн (эхний хуудастай хамт нийтлэгдэнэ)
  const hub = content.hub;
  if (hub) {
    for (const k of ['title', 'description', 'h1']) if (typeof hub[k] !== 'string' || !hub[k].trim()) contentErrors.push(`content/hub.mjs: "${k}" хоосон`);
    if (!Array.isArray(hub.intro) || !hub.intro.length) contentErrors.push('content/hub.mjs: intro хоосон');
    const hubText = plain([hub.title, hub.description, hub.h1, hub.intro, hub.intros]);
    if (/\[\[/.test(JSON.stringify(hub))) contentErrors.push('content/hub.mjs: [[эмч: …]] тэмдэг байж болохгүй');
    for (const c of findClaims(hubText)) contentErrors.push(`content/hub.mjs: хориотой мэдэгдэл «${c.label}»: …${c.context}…`);
  }
}
const results = new Map();
for (const pg of content.pages) {
  const r = validatePage(pg, { catalog, doctors: content.doctors, bookingOptions, allPages: content.pages, today, preview: PREVIEW, pipelineSlugs: content.pipelineSlugs });
  results.set(pg.slug, r);
  // Нийтлэх гэж буй (content/pages) хуудасны алдаа = build-ийн алдаа. Ноорог (preview)-ийн асуудлыг туузанд харуулна.
  if (pg._dir === 'content/pages') contentErrors.push(...r.errors);
  contentWarnings.push(...r.warnings);
}
// Харагдах хуудсууд: build — зөвхөн шалгалтад тэнцсэн published; preview — бүгд
const catOrder = Object.keys(catalog.cats);
const visible = content.pages
  .filter((pg) => (PREVIEW ? true : results.get(pg.slug).publishable))
  .sort((a, b) => catOrder.indexOf(a.category) - catOrder.indexOf(b.category) || (a.order || 0) - (b.order || 0) || a.slug.localeCompare(b.slug));
const visibleSlugs = new Set(visible.map((p) => p.slug));
const pageUrl = (slug) => (visibleSlugs.has(slug) ? '/emchilgee/' + slug : null);
const hubLive = visible.length > 0 && !!content.hub;
/** Контентын дотоод холбоос: /emchilgee… нь зөвхөн харагдах (нийтлэгдсэн) хуудас руу */
const linkOk = (href) => {
  const p = href.split('#')[0];
  if (p === '/emchilgee') return hubLive;
  const m = /^\/emchilgee\/([a-z0-9-]+)$/.exec(p);
  return m ? visibleSlugs.has(m[1]) : true;
};
// content/pages-д байгаа ч алдаатай (нийтлэх нөхцөл хангахгүй) хуудас: одоо байгаа HTML-ийг ХӨНДӨХГҮЙ
// (устгахгүй, дахин үүсгэхгүй) — build алдаа өгч зогсоно. Санамсаргүй засвар live хуудсыг устгахаас сэргийлнэ.
const blocked = content.pages.filter((pg) => pg._dir === 'content/pages' && !results.get(pg.slug).publishable);
/** Нүүрний JS-д: үйлчилгээний id → хуудас, slug → захиалгын маягтын сонголт */
const pagesIndex = { byId: {}, opt: {} };
for (const pg of visible) {
  for (const id of pg.catalogIds) pagesIndex.byId[id] = '/emchilgee/' + pg.slug;
  pagesIndex.opt[pg.slug] = pg.bookingOption;
}
// Индекслэгдэх хуудсууд
const pages = [
  ...corePages,
  ...(hubLive ? [{ path: '/emchilgee', file: 'emchilgee/index.html', jsonld: 'hub' }] : []),
  ...visible.map((pg) => ({ path: '/emchilgee/' + pg.slug, file: `emchilgee/${pg.slug}/index.html`, jsonld: 'treatment' })),
];

/* ---------- 2b. admin → «Эмчилгээний хуудас» цэсийн өгөгдөл (нийтэд нээлттэй файл — нууц мэдээлэлгүй) ---------- */
if (!PREVIEW) {
  const W1 = Date.UTC(2026, 10, 9);   // 1-р долоо хоног = 2026-11-09
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const status = {
    pages: content.pipeline.map((p) => {
      const pub = visibleSlugs.has(p.slug) ? content.pages.find((x) => x.slug === p.slug) : null;
      const doc = p.reviewer ? content.doctors[p.reviewer] : null;
      const ids = pub ? pub.catalogIds : p.catalogIds || [];
      const priceIds = [...new Set([...ids, ...((pub ? pub.alsoIds : p.alsoIds) || [])])];
      return {
        slug: p.slug, h1: p.h1, primary: p.primary, week: p.week, weekStart: iso(W1 + (p.week - 1) * 7 * 864e5),
        stage: pub ? 'published' : (p.stage || 'planned'),
        reviewer: doc ? doc.name : null, reviewerConsent: !!(doc && doc.consent),
        lastReviewed: pub ? pub.lastReviewed : null, url: pub ? '/emchilgee/' + p.slug : null,
        catalogIds: ids, priceIds, sitePrice: priceInfo(priceIds.map((id) => catalog.treatments.find((t) => t.id === id)).filter(Boolean)).text,
      };
    }),
  };
  files.set('admin/pages-status.js', '/* generated by tools/build.mjs (эх: content/pipeline.mjs) — гараар бүү засаарай */\n' +
    'window.SKINAID_PAGES_STATUS = ' + JSON.stringify(status, null, 1).replace(/</g, '\\u003c') + ';\n');
}

/* ---------- 3. build хэсгүүдийг солих ---------- */
/** pad: мөр бүрт хаах тэмдэглэгээний доголын дараа нэмэх зай (анхдагч 2; layout-д '') */
function region(html, name, body0, file, { pad = '  ' } = {}) {
  const open = `<!-- build:${name} -->`, close = `<!-- /build:${name} -->`;
  if (html.split(open).length !== 2 || html.split(close).length !== 2) {
    throw new BuildError(`${file}: ${open} … ${close} тэмдэглэгээ яг нэг удаа байх ёстой`);
  }
  const re = new RegExp(`(<!-- build:${name} -->)([\\s\\S]*?)(\\n?([ \\t]*)<!-- /build:${name} -->)`);
  const m = html.match(re);
  if (!m) throw new BuildError(`${file}: ${open} тэмдэглэгээ олдсонгүй`);
  const indent = m[4] || '';
  const body = body0.split('\n').map((l) => (l ? indent + pad + l : l)).join('\n');
  // Replacer функц: агуулга дахь `$&`, `$1`, `$$` зэргийг String.replace тайлахгүй, яг байгаагаар нь оруулна
  return html.replace(re, (_, o) => `${o}\n${body}\n${indent}${close}`);
}
/** JSON-LD-г <script> дотор аюулгүй: `<` → < (`</script`, `<!--` тэмдэглэгээг эвдэхгүй) */
const ldJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');
const asset = (p) => stamper.withVersion('.', p);   // JSON-LD-ийн logo/image → ?v=hash (immutable cache)

/**
 * Гараар бичсэн нүүрний картууд: <a … data-page="slug|hub#cat" data-fallback="#treatments" href="…">.
 * Нийтлэгдсэн хуудас → /emchilgee/slug; hub#cat → hub нийтлэгдсэн бол /emchilgee#cat; үгүй бол data-fallback.
 */
function applyPageLinks(html) {
  return html.replace(/<a\b[^>]*\bdata-page="([^"]+)"[^>]*>/g, (tag, key) => {
    const fb = (tag.match(/\bdata-fallback="([^"]*)"/) || [])[1];
    if (fb === undefined) throw new BuildError(`index.html: data-page="${key}" картад data-fallback алга`);
    const [slug, anchor] = key.split('#');
    let href = fb;
    if (slug === 'hub') { if (hubLive && anchor) href = '/emchilgee#' + anchor; }
    else if (!content.pipelineSlugs.has(slug)) throw new BuildError(`index.html: data-page="${key}" — content/pipeline.mjs-д ийм хуудас алга`);
    else if (pageUrl(slug)) href = pageUrl(slug);
    return tag.replace(/\bhref="[^"]*"/, `href="${href}"`);
  });
}

{
  let html = read('index.html');
  const meta = pageMeta(html);
  const home = pages.find((p) => p.jsonld === 'home');
  const graph = homeGraph(site, catalog, { path: home.path, title: meta.title, description: meta.description }, asset);
  html = region(html, 'jsonld', `<script type="application/ld+json">\n${ldJson(graph)}\n</script>`, 'index.html');
  html = region(html, 'treat-chips', R.chips(catalog.cats).join('\n'), 'index.html');
  html = region(html, 'treat-list', catalog.treatments.map((t) => R.row(t, catalog.cats, { pages: pagesIndex.byId })).join('\n'), 'index.html');
  html = region(html, 'pages-index', `<script>window.SKINAID_PAGES=${ldJson(pagesIndex)};</script>`, 'index.html', { pad: '' });
  const homeCtx = { home: true, site, pageUrl, hubLive };
  html = region(html, 'site-header', siteHeader(homeCtx), 'index.html', { pad: '' });
  html = region(html, 'site-footer', siteFooter(homeCtx), 'index.html', { pad: '' });
  html = applyPageLinks(html);
  files.set('index.html', html);
}
// Бусад байнгын хуудас (privacy г.м.): build:site-header / site-footer тэмдэглэгээтэй бол дэд хуудасны загвар
for (const pg of corePages.filter((p) => p.file !== 'index.html')) {
  let html = read(pg.file);
  if (!html.includes('<!-- build:site-header -->')) continue;
  const ctx = { home: false, site, pageUrl, hubLive };
  html = region(html, 'site-header', siteHeader(ctx), pg.file, { pad: '' });
  html = region(html, 'site-footer', siteFooter(ctx), pg.file, { pad: '' });
  files.set(pg.file, html);
}

/* ---------- 4. Эмчилгээний хуудас, hub үүсгэх ---------- */
const infoFor = (pg) => {
  const r = results.get(pg.slug);
  return { hash: reviewHash(pg), words: r.words, markers: r.markers.length, issues: [...r.errors, ...r.warnings].map((m) => m.replace(/^[^:]+:\s*/, '')) };
};
const previewFailed = [];
for (const pg of visible) {
  const rel = `emchilgee/${pg.slug}/index.html`;
  const doc = content.doctors[pg.reviewer];
  const reviewer = doc && doc.consent && pg.status === 'published' ? { key: pg.reviewer, doc } : null;
  const url = site.origin + '/emchilgee/' + pg.slug;
  const items = [...new Set([...(pg.catalogIds || []), ...(pg.alsoIds || [])])].map((id) => catalog.treatments.find((t) => t.id === id)).filter(Boolean);
  const graph = treatmentGraph(site, pg, {
    url, title: pg.title, description: pg.description, items, reviewer, lastReviewed: pg.lastReviewed, asset,
    summaryText: plain(pg.summary),
    crumbs: [{ name: 'Нүүр', path: '/' }, { name: 'Эмчилгээ', path: '/emchilgee' }, { name: pg.name, path: '/emchilgee/' + pg.slug }],
  });
  try {
    files.set(rel, renderTreatment(pg, {
      site, catalog, R, pageUrl, hubLive, preview: PREVIEW, reviewer, ldJson: ldJson(graph), info: infoFor(pg), relatedPages: visible, linkOk,
    }));
  } catch (e) {
    if (!PREVIEW) throw e;
    // Дутуу ноорог бусад ноорогийн preview-г зогсоохгүй. Hub, нүүр, бусад хуудас энэ URL руу аль хэдийн
    // холбогдсон тул хуудсыг хасахгүй — оронд нь алдааг харуулах түр хуудас бичнэ.
    results.get(pg.slug).errors.push(`${pg.slug}: preview үүсгэж чадсангүй — ${e.message}`);
    previewFailed.push(pg.slug);
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    files.set(rel, `<!doctype html>\n<html lang="mn"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>НООРОГ — алдаа</title></head>\n<body style="font:16px/1.5 system-ui;margin:40px"><h1>${esc(pg.slug)}: preview үүсгэж чадсангүй</h1><pre style="white-space:pre-wrap">${esc(e.message)}</pre><p><a href="/emchilgee">← Эмчилгээ</a></p></body></html>\n`);
  }
}
if (hubLive) {
  const graph = hubGraph(site, {
    url: site.origin + '/emchilgee', title: content.hub.title, description: content.hub.description, asset,
    items: visible.map((p) => ({ name: p.name, path: '/emchilgee/' + p.slug })),
    crumbs: [{ name: 'Нүүр', path: '/' }, { name: 'Эмчилгээ', path: '/emchilgee' }],
  });
  files.set('emchilgee/index.html', renderHub(content.hub, {
    site, catalog, R, pageUrl, preview: PREVIEW, pages: visible, byId: pagesIndex.byId, ldJson: ldJson(graph), linkOk,
    info: { hash: '—', words: wordCount(plain([content.hub.h1, content.hub.intro, content.hub.intros])), markers: 0, issues: [] },
  }));
}

/* ---------- 5. Asset хувилбар (JS module-ууд доороос дээш) ---------- */
for (const rel of [...pages.map((p) => p.file), ...otherHtml]) {
  files.set(rel, stamper.stampHtml(rel, read(rel)));
}

/* ---------- 5b. --preview: .preview/-д л бичээд дуусна ---------- */
if (PREVIEW) {
  const out = join(ROOT, '.preview');
  rmSync(out, { recursive: true, force: true });
  for (const p of pages) {
    const abs = join(out, p.file);
    if (!abs.startsWith(out + '/')) throw new BuildError(`preview зам буруу: ${p.file}`);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, files.get(p.file) ?? read(p.file));
  }
  const ok = visible.length - previewFailed.length;
  console.log(`✓ Preview: ${ok} эмчилгээний хуудас .preview/-д бичигдлээ${previewFailed.length ? ` (${previewFailed.length} нь алдаатай — ${previewFailed.join(', ')}: алдааны хуудас)` : ''} (нийтлэгдэхгүй). Харах: node tools/preview.mjs`);
  for (const pg of visible) {
    const i = infoFor(pg);
    console.log(`  • /emchilgee/${pg.slug}  [${pg.status}${pg._draft ? ', ноорог' : ''}]  hash ${i.hash} · ${i.words} үг · эмчид асуух ${i.markers} · асуудал ${i.issues.length}`);
    for (const m of i.issues) console.log(`      - ${m}`);
  }
  process.exit(0);
}

/* ---------- 5c. vercel.json: нийтлэгдсэн хуудасны хуучин (Wix) URL → 308 ---------- */
{
  // Хуучин URL: хуудасны legacy + content/pipeline.mjs-ийн legacy (нэгтгэж)
  const pipeLegacy = (slug) => ((content.pipeline.find((p) => p.slug === slug) || {}).legacy || []);
  const r = manageRedirects(read('vercel.json'),
    visible.map((pg) => ({ slug: pg.slug, legacy: [...new Set([...(pg.legacy || []), ...pipeLegacy(pg.slug)])] })),
    sourceToRegExp, { liveSlugs: new Set([...visibleSlugs, ...blocked.map((b) => b.slug)]) });
  contentErrors.push(...r.errors.map((e) => 'vercel.json: ' + e));
  contentWarnings.push(...r.warnings);
  files.set('vercel.json', r.text);
}

/* ---------- 6. Эх нь байхгүй болсон эмчилгээний хуудас (emchilgee/**) ---------- */
const expected = new Set(pages.map((p) => p.file));
for (const pg of blocked) expected.add(`emchilgee/${pg.slug}/index.html`);
if (blocked.length) expected.add('emchilgee/index.html');
const stale = [];
(function walk(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return;
  for (const n of readdirSync(abs)) {
    const rel = `${dir}/${n}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
    else if (!n.startsWith('.') && !expected.has(rel)) stale.push(rel);
  }
})('emchilgee');
for (const t of tracked || []) if (t.startsWith('emchilgee/') && !expected.has(t) && !stale.includes(t)) stale.push(t);

/* ---------- 7. sitemap.xml (lastmod = хуудасны агуулга өөрчлөгдсөн огноо) ---------- */
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

/* ---------- 8. Бичих / шалгах ---------- */
if (!CHECK && contentErrors.length) {
  console.error(`✗ ${contentErrors.length} алдаа (контент) — юу ч бичээгүй:\n  - ` + contentErrors.join('\n  - '));
  process.exit(1);
}
const changed = [];
for (const [rel, text] of files) {
  const abs = join(ROOT, rel);
  const old = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  if (old === text) continue;
  changed.push(rel);
  if (!CHECK) { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text); }
}
const errors = [...contentErrors];
const staleWarnings = [];
for (const rel of stale) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {   // git-д байгаа ч дискээс устсан: commit-д устгалыг оруулах
    (CHECK ? errors : staleWarnings).push(`${rel}: дискээс устсан ч git-д байна — \`git add -A\` хийж устгалыг commit-д оруулна уу`);
    continue;
  }
  const generated = readFileSync(abs, 'utf8').includes(GENERATED);
  if (CHECK || !generated) errors.push(`${rel}: эх нь (content/pages/) алга — ${generated ? 'node tools/build.mjs устгана' : 'гараар үүсгэсэн файл, шалгаад устгана уу'}`);
  else { rmSync(abs); changed.push(`${rel} (устгав)`); }
}
// Хоосон үлдсэн emchilgee/ хавтсуудыг цэвэрлэх
if (!CHECK) {
  (function prune(dir) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) return;
    for (const n of readdirSync(abs)) prune(`${dir}/${n}`);
    if (!readdirSync(abs).length) rmSync(abs, { recursive: true });
  })('emchilgee');
}

const check = checkSite({ root: ROOT, site, pages, otherHtml, files, catalog, tracked, strict: CHECK });
errors.push(...check.errors);
const warnings = [...contentWarnings, ...staleWarnings, ...check.warnings];
if (warnings.length) console.warn(`⚠ ${warnings.length} анхааруулга:\n  - ` + warnings.join('\n  - '));
if (CHECK && changed.length) errors.unshift(`Build хуучирсан — дараах файлууд шинэчлэгдэх ёстой: ${changed.join(', ')} (node tools/build.mjs ажиллуулна уу)`);

if (errors.length) {
  console.error(`✗ ${errors.length} алдаа:\n  - ` + errors.join('\n  - '));
  process.exit(1);
}
console.log(CHECK ? '✓ Шалгалт амжилттай: build шинэ, SEO шалгалт алдаагүй.' : `✓ Build дууслаа. Өөрчлөгдсөн: ${changed.length ? changed.join(', ') : 'алга'}`);

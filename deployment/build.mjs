// Vercel deployment artifacts. The checked-in HTML remains the canonical editable source.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { offer, priceRange } from './offers.mjs';
import { JSDOM } from 'jsdom';
import { createGcpAuth } from '../api/_lib/gcp-auth.js';
import { createFirestore } from '../api/_lib/firestore.js';
import { pageKey, parseContent, renderPublicContent } from '../assets/js/site-content.js';

const browserGlobals = {};
for (const module of ['home-render', 'catalog-defaults', 'catalog-render']) {
  vm.runInNewContext(readFileSync(new URL('../assets/js/' + module + '.js', import.meta.url), 'utf8'), { window: browserGlobals });
}

function renderSettings(doc, records) {
  const site = records.get('settings/site')?.data || {};
  const apply = (selector, text) => {
    if (typeof text === 'string' && text.trim()) {
      for (const el of doc.querySelectorAll(selector)) el.textContent = text.trim();
    }
  };
  apply('[data-site~="hours"]', site.hours);
  apply('[data-site~="phone"]', site.phone);
  const phone = typeof site.phone === 'string' && site.phone.replace(/[^+0-9]/g, '');
  const tel = phone && (phone.startsWith('+') ? phone : (/^976\d{8}$/.test(phone) ? '+' : '+976') + phone);
  if (tel) for (const el of doc.querySelectorAll('[data-site~="tel"]')) el.href = 'tel:' + tel;
  const email = typeof site.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(site.email) && site.email;
  if (email) {
    apply('[data-site~="email"]', email);
    for (const el of doc.querySelectorAll('[data-site~="mailto"]')) el.href = 'mailto:' + email;
  }
  const raw = records.get('settings/home')?.data;
  const hero = doc.querySelector('[data-home="hero"]');
  if (hero && raw && (!raw.baseRev || raw.baseRev === hero.dataset.homeRev)) {
    const renderer = browserGlobals.SKINAID_HOME_RENDER;
    const home = renderer.norm(raw);
    if (home?.hero) hero.innerHTML = renderer.hero(home.hero);
    if (home?.posts) doc.querySelector('[data-home="posts"]').innerHTML = renderer.posts(home.posts);
  }
  const catalog = records.get('settings/catalog')?.data;
  const defaults = browserGlobals.SKINAID_DEFAULTS;
  const services = Array.isArray(catalog?.services) ? catalog.services.filter(item => item && !item.hidden && typeof item.n === 'string' && item.n.trim()) : null;
  const packages = Array.isArray(catalog?.packages) ? catalog.packages.filter(p => p && !p.hidden) : defaults.packages;
  const rows = doc.querySelector('#treatList');
  if (rows && services) {
    const mapping = [...doc.scripts].map(el => el.textContent.match(/^window\.SKINAID_PAGES=(.*);$/)).find(Boolean);
    const pages = mapping ? JSON.parse(mapping[1]).byId : {};
    rows.innerHTML = services
      .map(item => browserGlobals.SKINAID_RENDER.row(item, browserGlobals.SKINAID_DEFAULTS.cats, { pages })).join('');
  }
  const hideFor = (el, key) => {
    if (!el) return;
    el.hidden = true;
    el.dataset.staticHide = [...new Set([...(el.dataset.staticHide || '').split(' ').filter(Boolean), key])].join(' ');
  };
  const cards = [...doc.querySelectorAll('[data-pack]')];
  for (const card of cards) {
    if (Array.isArray(catalog?.packages) && catalog.packages.some(p => p?.id === card.dataset.pack && p.hidden)) {
      hideFor(card, 'catalog');
      continue;
    }
    const pkg = packages?.find(p => p.id === card.dataset.pack);
    if (!pkg) continue;
    const title = card.querySelector('h3');
    if (title && pkg.name) {
      const [first, ...rest] = pkg.name.trim().split(' ');
      title.textContent = first;
      if (rest.length) {
        const em = doc.createElement('em');
        em.textContent = rest.join(' ');
        title.append(' ', em);
      }
    }
    if (pkg.price) card.querySelector('.pack__price strong').textContent = pkg.price;
  }
  if (cards.length) {
    const visible = cards.filter(card => !card.hidden).length;
    apply('[data-pack-count]', visible + ' онцгой багц');
    const hidePromo = key => {
      hideFor(doc.querySelector('#promo'), key);
      for (const link of doc.querySelectorAll('a[href="#promo"]')) hideFor(link.closest('li') || link, key);
    };
    if (!visible) hidePromo('catalog');
    if (site.promoEnabled === false) hidePromo('site');
  }
  for (const element of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const graph = JSON.parse(element.textContent);
    for (const node of graph['@graph'] || []) {
      if (node['@type'] === 'WebPage' || node['@type'] === 'CollectionPage') {
        node.name = doc.title;
        node.description = doc.querySelector('meta[name="description"]')?.content || node.description;
      }
      if (node['@type'] === 'MedicalClinic') {
        if (node.hasOfferCatalog && services) {
          const groups = Object.entries(defaults.cats).map(([id, name]) => ({
            '@type': 'OfferCatalog', name, itemListElement: services.filter(row => row.c === id).map(offer),
          })).filter(group => group.itemListElement.length);
          if (groups.length) node.hasOfferCatalog.itemListElement = groups;
          else delete node.hasOfferCatalog;
          const range = priceRange({ treatments: services, packages });
          if (range) node.priceRange = range;
          else delete node.priceRange;
        }
        if (tel) node.telephone = tel;
        if (email && node.email) node.email = email;
      }
    }
    element.textContent = JSON.stringify(graph).replaceAll('<', '\\u003c');
  }
}

export function bake(html, path, records) {
  const content = records.get('public_content/' + pageKey(path));
  const common = path === '/' ? null : records.get('public_content/home');
  const snapshot = { content: content?.data.values || null, commonContent: common?.data.values || null };
  if (!snapshot.content && !snapshot.commonContent && !['site', 'catalog', 'home'].some(key => records.get('settings/' + key))) return html;
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  renderPublicContent(doc, path, parseContent(snapshot.content), parseContent(snapshot.commonContent), true);
  renderSettings(doc, records);
  const data = doc.createElement('script');
  data.type = 'application/json';
  data.dataset.contentSnapshot = '';
  data.textContent = JSON.stringify(snapshot).replaceAll('<', '\\u003c');
  doc.body.append(data);
  return dom.serialize();
}

async function build() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const out = join(root, 'dist');
  await mkdir(out, { recursive: true });
  const publicFiles = ['assets', 'admin', 'privacy', 'emchilgee', 'index.html', '404.html', 'robots.txt', 'sitemap.xml', 'favicon.ico'];
  for (const file of publicFiles) await cp(join(root, file), join(out, file), { recursive: true });
  if (process.env.VERCEL_ENV !== 'production') return;
  const auth = createGcpAuth();
  if (!auth.mode) throw new Error('Static content build requires the production Firestore reader.');
  const fs = createFirestore({ projectId: auth.projectId, getAccessToken: () => auth.getAccessToken() });
  const window = {};
  vm.runInNewContext(await readFile(join(root, 'admin/content-pages.js'), 'utf8'), { window });
  const pages = window.SKINAID_CONTENT_PAGES;
  const records = await fs.batchGet([...pages.map(p => 'public_content/' + pageKey(p.path)), 'settings/site', 'settings/home', 'settings/catalog']);
  const sitemapFile = join(out, 'sitemap.xml');
  const sitemap = new JSDOM(await readFile(sitemapFile, 'utf8'), { contentType: 'application/xml' });
  for (const url of sitemap.window.document.querySelectorAll('url')) {
    const path = new URL(url.querySelector('loc').textContent).pathname;
    const lastmod = url.querySelector('lastmod');
    const keys = ['public_content/' + pageKey(path), 'settings/site'];
    if (path === '/') keys.push('settings/home', 'settings/catalog');
    for (const key of keys) {
      const time = records.get(key)?.updateTime;
      if (!time || !lastmod) continue;
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' }).format(new Date(time));
      if (date > lastmod.textContent) lastmod.textContent = date;
    }
  }
  await writeFile(sitemapFile, sitemap.serialize());
  for (const { path } of pages) {
    const file = path === '/404.html' ? join(out, '404.html') : join(out, path.slice(1), 'index.html');
    const html = await readFile(file, 'utf8');
    await writeFile(file, bake(html, path, records));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await build();

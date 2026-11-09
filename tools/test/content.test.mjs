// node --test tools/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { inline, blocks, plain, wordCount, mnDate } from '../lib/render.mjs';
import { findClaims } from '../lib/claims.mjs';
import { reviewHash, priceInfo, validatePage } from '../lib/content.mjs';
import { vercelIgnore } from '../lib/assets.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const load = (rel, key) => { const w = {}; vm.runInNewContext(readFileSync(ROOT + rel, 'utf8'), { window: w, globalThis: w }); return w[key]; };
const R = load('assets/js/catalog-render.js', 'SKINAID_RENDER');
const catalog = load('assets/js/catalog-defaults.js', 'SKINAID_DEFAULTS');

test('inline: escapes HTML and supports the three tokens', () => {
  assert.equal(inline('<b>x</b> & "y"'), '&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
  assert.equal(inline('**тод** текст'), '<strong>тод</strong> текст');
  assert.equal(inline('[хуудас](/emchilgee/batga#une)'), '<a href="/emchilgee/batga#une">хуудас</a>');
  const markers = [];
  assert.equal(inline('Хугацаа [[эмч: 60 минут уу?]]', { preview: true, markers }), 'Хугацаа <mark class="dr-q" title="Эмч баталгаажуулна">60 минут уу?</mark>');
  assert.deepEqual(markers, ['60 минут уу?']);
  assert.equal(inline('[[эмч: x]]'), 'x');
});

test('inline: rejects unsafe or external links outside sources', () => {
  assert.throws(() => inline('[x](javascript:alert(1))'));
  assert.throws(() => inline('[x](https://evil.example)'));
  assert.throws(() => inline('[x](//evil.example)'));
  assert.throws(() => inline('[x](/a/../b)'));
  assert.equal(inline('[x](https://www.aad.org/a)', { external: true }), '<a href="https://www.aad.org/a" target="_blank" rel="noopener">x</a>');
});

test('blocks: list types and unknown block', () => {
  assert.equal(blocks(['a', { ul: ['b', 'c'] }]), '<p>a</p>\n<ul><li>b</li><li>c</li></ul>');
  assert.match(blocks([{ steps: ['x'] }]), /class="steps-list"/);
  assert.match(blocks([{ warn: ['x'] }]), /callout--warn/);
  assert.throws(() => blocks([{ html: '<script>' }]));
  assert.throws(() => blocks([{ ul: [] }]));
});

test('plain, wordCount, mnDate', () => {
  assert.equal(plain('**a** [b](/c) [[эмч: d]]'), 'a b d');
  assert.equal(wordCount('Батганы сорви 3 төрөл, CO2-лазер'), 6);
  assert.equal(mnDate('2026-11-20'), '2026 оны 11-р сарын 20');
});

test('claims: catches banned phrases in Mongolian word forms', () => {
  const labels = (t, a) => findClaims(t, a).map((c) => c.label);
  assert.deepEqual(labels('Хамгийн сайн арга'), ['хамгийн']);
  assert.deepEqual(labels('үр дүн баталгаатай, өвдөлтгүй'), ['баталгаатай', 'өвдөлтгүй']);
  assert.deepEqual(labels('100 % арилна'), ['100%']);
  assert.deepEqual(labels('гаж нөлөө огт байхгүй'), ['гаж нөлөөгүй']);
  assert.deepEqual(labels('Энэ арга аюулгүй'), ['аюулгүй']);
  assert.deepEqual(labels('сорви бүрмөсөн арилна'), ['бүрмөсөн']);
  assert.deepEqual(labels('Энэ эмчилгээ аюулгүй байдаг.'), ['аюулгүй']);
  assert.deepEqual(labels('Эмчилгээ огт өвдөхгүй'), ['өвдөлтгүй']);
  assert.deepEqual(labels('Үр дүнгийн баталгаа өгнө'), ['баталгаа өгнө']);
  assert.deepEqual(labels('гаж нөлөө гарахгүй'), ['гаж нөлөөгүй']);
  assert.deepEqual(labels('100 хувь арилна'), ['100%']);
});

test('claims: allows legitimate uses', () => {
  assert.deepEqual(findClaims('Эмч баталгаажуулна. Аюулгүй байдлын зөвлөмж. Аюулгүй байдал чухал.'), []);
  assert.deepEqual(findClaims('Хамгийн түгээмэл хэлбэр нь', ['хамгийн түгээмэл']), []);
  assert.deepEqual(findClaims('хамгийнхаа'), []);   // өөр үг (үсгээр үргэлжилсэн)
});

test('reviewHash: stable under key order, ignores price/links', () => {
  const a = { title: 't', sections: { what: ['x'], suits: ['y'] }, catalogIds: ['scar-1'], related: ['nuhjilt'] };
  const b = { related: [], catalogIds: ['scar-2'], sections: { suits: ['y'], what: ['x'] }, title: 't' };
  assert.equal(reviewHash(a), reviewHash(b));
  assert.notEqual(reviewHash(a), reviewHash({ ...a, title: 't2' }));
});

test('priceInfo: fixed, from, none', () => {
  assert.equal(priceInfo([{ p: '₮50,000' }]).text, '₮50,000');
  assert.equal(priceInfo([{ p: '₮275,000' }, { p: '₮440,000' }]).text, '₮275,000-с');
  assert.equal(priceInfo([{ p: '₮300,000-с' }]).text, '₮300,000-с');
  assert.equal(priceInfo([{ p: '' }, {}]).text, 'Эмчийн үзлэгийн дараа тодорхойлно');
});

test('row(): unchanged without pages; links to a published page with opts.pages', () => {
  const t = catalog.treatments.find((x) => x.id === 'scar-1');
  const plainRow = R.row(t, catalog.cats);
  assert.match(plainRow, /^<a class="row" href="#contact" data-c="scar" id="t-scar-1">/);
  assert.match(plainRow, /Цаг захиалах →/);
  const linked = R.row(t, catalog.cats, { pages: { 'scar-1': '/emchilgee/co2-lazer' } });
  assert.match(linked, /href="\/emchilgee\/co2-lazer"/);
  assert.match(linked, /Дэлгэрэнгүй →/);
  assert.match(R.row(t, catalog.cats, { pages: { 'scar-1': 'javascript:x' } }), /href="#contact"/);
  assert.match(R.row(t, catalog.cats, { book: '/#contact' }), /href="\/#contact"/);
});

test('vercelIgnore: root-anchored entries', () => {
  const ig = vercelIgnore(ROOT);
  assert.equal(ig('tools/build.mjs'), true);
  assert.equal(ig('content/drafts/x.mjs'), true);
  assert.equal(ig('assets/content/x.png'), false);
  assert.equal(ig('.preview/index.html'), true);
});

function samplePage(over = {}) {
  const para = 'Энэ бол туршилтын өгүүлбэр бөгөөд хуудасны бүтцийг шалгахад зориулсан энгийн текст юм. '.repeat(25);
  return {
    _dir: 'content/drafts', _file: 'zz.mjs', _slugFromFile: 'zz',
    slug: 'zz', status: 'draft', title: 'Туршилтын хуудас | SkinAid', description: 'Туршилтын хуудасны тайлбар, тэмдэгтийн урт шалгахад хангалттай байх ёстой текст.',
    h1: 'Туршилт', name: 'Туршилт', summary: 'Товч.', category: 'scar', bookingOption: 'Сорви, нүхжилт', catalogIds: ['scar-4'],
    facts: { duration: 'x', anesthesia: 'x', sessions: 'x', downtime: 'x' },
    sections: { what: [para], suits: [para], contraindications: ['a'], procedure: ['a'], aftercare: ['a'], sideEffects: ['a'], price: ['a'] },
    faq: [{ q: 'a?', a: ['b'] }, { q: 'c?', a: ['d'] }, { q: 'e?', a: ['f'] }],
    sources: [{ title: 'A', publisher: 'AAD', url: 'https://www.aad.org/a' }, { title: 'B', publisher: 'NHS', url: 'https://www.nhs.uk/b' }],
    reviewer: 'dr', related: [], legacy: [],
    ...over,
  };
}
const vctx = (page, doctors = {}) => ({ catalog, doctors, bookingOptions: ['Сорви, нүхжилт'], allPages: [page], today: '2026-11-08', preview: false });

test('validatePage: a clean draft has no errors', () => {
  const p = samplePage();
  const r = validatePage(p, vctx(p));
  assert.deepEqual(r.errors, []);
  assert.equal(r.publishable, false);
});

test('validatePage: publishing needs consent, title, date, matching hash and no markers', () => {
  const p = samplePage({ status: 'published', _dir: 'content/pages', lastReviewed: '2026-11-07' });
  let r = validatePage(p, vctx(p, { dr: { name: 'Э.Т', jobTitle: null, consent: null } }));
  assert.ok(r.errors.some((e) => /consent/.test(e)));
  assert.ok(r.errors.some((e) => /jobTitle/.test(e)));
  assert.ok(r.errors.some((e) => /review\.hash/.test(e)));
  const ok = { ...p, review: { hash: reviewHash(p), by: 'dr' } };
  r = validatePage(ok, vctx(ok, { dr: { name: 'Э.Т', jobTitle: 'Арьсны эмч', consent: { date: '2026-11-07' } } }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.publishable, true);
  const edited = { ...ok, summary: 'Өөрчилсөн.' };
  r = validatePage(edited, vctx(edited, { dr: { name: 'Э.Т', jobTitle: 'Арьсны эмч', consent: { date: '2026-11-07' } } }));
  assert.ok(r.errors.some((e) => /review\.hash/.test(e)));
  const marked = { ...p, sections: { ...p.sections, aftercare: ['[[эмч: хэд хоног?]]'] } };
  const m2 = { ...marked, review: { hash: reviewHash(marked), by: 'dr' } };
  r = validatePage(m2, vctx(m2, { dr: { name: 'Э.Т', jobTitle: 'Арьсны эмч', consent: { date: '2026-11-07' } } }));
  assert.ok(r.errors.some((e) => /тэмдэг үлдсэн/.test(e)));
});

test('validatePage: draft in content/pages, prices in prose and banned claims are errors', () => {
  const p = samplePage({ _dir: 'content/pages', sections: { ...samplePage().sections, price: ['Үнэ ₮275,000'], suits: ['Хамгийн үр дүнтэй. ' + 'үг '.repeat(300)] } });
  const r = validatePage(p, vctx(p));
  assert.ok(r.errors.some((e) => /content\/pages/.test(e)));
  assert.ok(r.errors.some((e) => /үнэ бичихгүй/.test(e)));
  assert.ok(r.errors.some((e) => /хамгийн/.test(e)));
});

test('validatePage: review.by must match reviewer; ctaTitle is hashed; prices in title are caught', () => {
  const docs = { dr: { name: 'Э.Т', jobTitle: 'Арьсны эмч', consent: { date: '2026-11-07' } }, dr2: { name: 'Б.Б', jobTitle: 'Арьсны эмч', consent: { date: '2026-11-07' } } };
  const p = samplePage({ status: 'published', _dir: 'content/pages', lastReviewed: '2026-11-07' });
  const ok = { ...p, review: { hash: reviewHash(p), by: 'dr' } };
  assert.deepEqual(validatePage(ok, vctx(ok, docs)).errors, []);
  const swapped = { ...ok, reviewer: 'dr2' };
  assert.ok(validatePage(swapped, vctx(swapped, docs)).errors.some((e) => /review\.by/.test(e)));
  const cta = { ...ok, ctaTitle: 'Шинэ гарчиг' };
  assert.ok(validatePage(cta, vctx(cta, docs)).errors.some((e) => /review\.hash/.test(e)));
  const priced = samplePage({ title: 'Туршилт 275,000₮ | SkinAid' });
  assert.ok(validatePage(priced, vctx(priced)).errors.some((e) => /үнэ бичихгүй/.test(e)));
  const raw = { ...ok, _raw: '// НООРОГ — эмч хянаагүй\nexport default {}' };
  assert.ok(validatePage(raw, vctx(raw, docs)).errors.some((e) => /НООРОГ/.test(e)));
});

test('manageRedirects: pre-encoded legacy is not double-encoded; old slug allowed; dropped rules warned', async () => {
  const { manageRedirects } = await import('../lib/redirects.mjs');
  const { sourceToRegExp } = await import('../lib/check.mjs');
  const base = JSON.stringify({ redirects: [{ source: '/service-page/:rest*', destination: '/#treatments', permanent: false }, { source: '/x', destination: '/emchilgee/old', permanent: true }] });
  const r = manageRedirects(base, [{ slug: 'co2-lazer', legacy: ['/service-page/лазер', encodeURI('/service-page/сорви'), '/emchilgee/co2-laser'] }], sourceToRegExp, { liveSlugs: new Set(['co2-lazer']) });
  assert.deepEqual(r.errors, []);
  const sources = r.rules.map((x) => x.source);
  assert.ok(sources.includes(encodeURI('/service-page/сорви')));
  assert.ok(!sources.some((s) => s.includes('%25')));
  assert.ok(sources.includes('/emchilgee/co2-laser'));
  assert.ok(r.warnings.some((w) => /emchilgee\/old/.test(w)));
  const bad = manageRedirects(base, [{ slug: 'co2-lazer', legacy: ['/service-page/лазер', encodeURI('/service-page/лазер')] }], sourceToRegExp);
  assert.ok(bad.errors.some((e) => /давхардсан/.test(e)));
});

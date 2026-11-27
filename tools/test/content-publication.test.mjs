import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { bake } from '../../deployment/build.mjs';
import { contentFields, renderPublicContent, restoreContent, cardLists, validCards, FAQ_KEY, faqItems } from '../../assets/js/site-content.js';
import { reviewDraft } from '../../admin/clinical-content.js';

const home = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const parse = html => new JSDOM(html).window.document;
const fields = contentFields(parse(home), '/');
const field = label => fields.find(item => item.label === label).id;
const bakeHome = values => bake(home, '/', new Map([['public_content/home', { data: { values: JSON.stringify(values) } }]]));

test('both selected photos are visible with JS disabled and independently resettable', () => {
  const examples = [
    ['Эмчийн үзлэг, оношлогооны зураг · Зураг', '.svc--featured img', '/assets/img/photos/about-sub.jpg'],
    ['Бидний тухай · Жижиг зураг · Зураг', '.about__img-sub img', '/assets/img/photos/feat-exam.jpg'],
  ];
  const changes = Object.fromEntries(examples.map(([name, , photo]) => [field(name), photo]));
  const doc = parse(bakeHome(changes));
  examples.forEach(([, selector, photo]) => assert.equal(doc.querySelector(selector).getAttribute('src'), photo));
  restoreContent(doc);
  delete changes[field(examples[0][0])];
  renderPublicContent(doc, '/', changes, {});
  assert.equal(doc.querySelector(examples[0][1]).getAttribute('src'), parse(home).querySelector(examples[0][1]).getAttribute('src'));
  assert.equal(doc.querySelector(examples[1][1]).getAttribute('src'), examples[1][2]);
});

test('SEO strings are still plain text when Vercel serializes and the browser reparses HTML', () => {
  const title = 'SkinAid <хуудас> & шинэ';
  const doc = parse(bakeHome({ [field('Хуудасны гарчиг')]: title }));
  assert.equal(doc.title, title);
  assert.ok(doc.querySelector('script[data-content-snapshot]'));
});

test('a cleared text node can be restored after HTML serialization', () => {
  const doc = parse(bakeHome({ [field('Хуудасны гарчиг')]: '' }));
  assert.equal(doc.title, '');
  restoreContent(doc);
  assert.equal(doc.title, parse(home).title);
});

test('card positions, hidden reviews, FAQ reset and the trust panel survive a snapshot round trip', () => {
  const service = { title: 'Жишээ', text: 'Тайлбар', url: '#contact', cta: 'Цаг захиалах', image: '', alt: '', hidden: false, position: 1 };
  const review = { title: 'Сэдэв', text: 'Санал', author: 'Нэр', source: '', hidden: false, position: 2 };
  const values = { [cardLists[0].key]: [service], [cardLists[1].key]: [review, { ...review, hidden: true }], [FAQ_KEY]: [] };
  const doc = parse(bakeHome(values));
  assert.equal(doc.querySelector('.bento > :first-child h3').textContent, service.title);
  assert.equal(doc.querySelector('.testi-grid > :nth-child(2) p').textContent, review.text);
  assert.ok(doc.querySelector('.testi-grid > :last-child').matches('.trust'));
  assert.equal(faqItems(doc).length, 0);
  restoreContent(doc);
  assert.equal(doc.querySelectorAll('[data-added-card]').length, 0);
  assert.deepEqual(faqItems(doc), faqItems(parse(home)));
  assert.equal(validCards(cardLists[0], [{ ...service, url: '' }]), false);
});

test('clinical export preserves structured body and invalidates the older review', () => {
  const source = { status: 'published', review: { hash: 'old' }, lastReviewed: '2026-01-01', sections: { what: [{ ul: ['Эхний', 'Хоёр'] }] } };
  const updated = reviewDraft(source, { 'sections/what/0/ul/1': 'Шинэ' });
  assert.equal(updated.status, 'draft');
  assert.equal(updated.review, undefined);
  assert.equal(updated.lastReviewed, undefined);
  assert.deepEqual(updated.sections.what[0].ul, ['Эхний', 'Шинэ']);
  assert.equal(source.status, 'published');
});

test('saved catalog, promo visibility and page metadata agree with the static homepage', () => {
  const services = [{ id: 'qa', c: 'exam', n: 'Үзлэг', d: 'Тайлбар', p: '₮50,000' }];
  const doc = parse(bake(home, '/', new Map([
    ['settings/site', { data: { phone: '99112233', promoEnabled: false } }],
    ['settings/catalog', { data: { services, packages: [] } }],
  ])));
  assert.equal(doc.querySelector('#treatList h3').textContent, 'Үзлэг');
  assert.equal(doc.querySelector('#promo').hidden, true);
  assert.equal(doc.querySelector('[data-site~="tel"]').getAttribute('href'), 'tel:+97699112233');
  const graph = JSON.parse(doc.querySelector('[type="application/ld+json"]').textContent)['@graph'];
  const clinic = graph.find(node => node['@type'] === 'MedicalClinic');
  assert.equal(clinic.hasOfferCatalog.itemListElement[0].itemListElement[0].price, '50000');
  assert.equal(clinic.telephone, '+97699112233');
});

test('homepage sections expose technology, catalog and booking fields without changing saved text IDs', () => {
  const doc = parse(home);
  const known = contentFields(doc, '/');
  assert.ok(known.some(({ group }) => group === 'Технологийн мөр'));
  assert.ok(known.some(({ group }) => group === 'Үйлчилгээний жагсаалт'));
  const intro = known.find(({ label }) => label === 'QPay төлбөрийн тайлбар');
  assert.equal(intro.group, 'Захиалгын маягт');
  const copy = 'Төлбөр төлсний дараа цаг баталгаажна.';
  assert.equal(parse(bakeHome({ [intro.id]: copy })).querySelector('[data-ub-copy="pending_payment"]').textContent, copy);
  doc.querySelectorAll('[data-ub-copy],[data-ub-submit]').forEach(node => node.remove());
  const previous = contentFields(doc, '/');
  assert.deepEqual(known.filter(({ label }) => !/^(Хүсэлтээр захиалах тайлбар|QPay төлбөрийн тайлбар|Хүсэлт илгээх товч|QPay төлөх товч|Шууд захиалах товч)$/.test(label)).map(({ id }) => id),
    previous.map(({ id }) => id));
});

// Messenger AI-ийн мэдлэг: clinic-facts.js = content/site.mjs + catalog-defaults.js (нэг үнэн эх сурвалж),
// settings/site + settings/catalog → LLM-д аюулгүй каталог, захиалгын холбоос.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { site } from '../../content/site.mjs';
import { CATS, CLINIC } from '../../api/_lib/clinic-facts.js';
import { clinicPhone, createKnowledge, knowledgeInput } from '../../api/_lib/knowledge.js';
import { bookingUrl } from '../../api/_lib/booking-link.js';
import { buildSocialCatalog } from '../../api/_lib/social/catalog-safe.js';
import { findPii } from '../../api/_lib/guardrails.js';

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(new URL('../../assets/js/catalog-defaults.js', import.meta.url), 'utf8'), sandbox);
const DEFAULTS = sandbox.window.SKINAID_DEFAULTS;

test('clinic-facts = content/site.mjs (нэр, хаяг, утас, origin) ба catalog-defaults.js (ангилал)', () => {
  assert.equal(CLINIC.name, site.name);
  assert.equal(CLINIC.streetAddress, site.address.streetAddress);
  assert.equal(CLINIC.locality, site.address.addressLocality);
  assert.equal(CLINIC.phoneDisplay, site.phone.display);
  assert.equal(CLINIC.origin, site.origin);
  assert.deepEqual({ ...CATS }, { ...DEFAULTS.cats });
});

test('мэдлэг: сайтын бодит каталог (catalog-defaults) → PII-гүй, нуусан үнэгүй, дүн = сайтын үнэ', () => {
  const catalog = { services: DEFAULTS.treatments.map((t) => ({ ...t })), packages: DEFAULTS.packages };
  const c = buildSocialCatalog(knowledgeInput({ hours: 'Өдөр бүр 09:00-19:00', phone: '7600-0505' }, catalog));
  assert.deepEqual(findPii(JSON.stringify(c)), []);
  assert.equal(c.facts.filter((f) => f.kind === 'service').length, DEFAULTS.treatments.length);
  assert.equal(c.facts.filter((f) => f.kind === 'package').length, DEFAULTS.packages.length);
  for (const n of [50000, 300000, 462000, 359000]) assert.ok(c.allowedAmounts.includes(n), n);
  assert.ok(c.facts.find((f) => f.id === 'service:exam-1').text.includes('ангилал: Үзлэг'));
  assert.ok(c.facts.some((f) => f.id === 'hours' && f.text.includes('09:00-19:00')));
  assert.ok(!JSON.stringify(c).includes('7600'), 'утас LLM-ийн мэдлэгт алга');
  // Нуусан үйлчилгээ, promoEnabled === false → багц алга
  catalog.services[0].hidden = true;
  const c2 = buildSocialCatalog(knowledgeInput({ promoEnabled: false }, catalog));
  assert.ok(!c2.facts.some((f) => f.id === 'service:exam-1'));
  assert.equal(c2.facts.filter((f) => f.kind === 'package').length, 0);
  assert.ok(!c2.facts.some((f) => f.id === 'hours'), 'цаг тохируулаагүй бол зохиохгүй');
  // Баримт байхгүй / буруу хэлбэр → эмнэлэг, хаяг л
  assert.deepEqual(buildSocialCatalog(knowledgeInput(null, { services: 'x' })).facts.map((f) => f.id), ['clinic', 'address']);
});

test('мэдлэг: кэш — толгойг ≥ 1 мин тутам (4 read), `_rev`/сайт өөрчлөгдвөл л бүрэн ачаална, 30 мин тутам заавал; алдаанд сүүлийн зөв утга', async () => {
  let t = 0;
  let rev = 'a|b|-|-';
  const calls = { heads: 0, lists: 0 };
  let fail = false;
  const store = {
    readKnowledgeHeads: async () => { calls.heads++; if (fail) throw new Error('UNAVAILABLE'); return { site: {}, catalog: { services: [], packages: [] }, voice: null, rev }; },
    readKnowledgeLists: async () => { calls.lists++; return { kb: [], examples: [] }; },
  };
  const k = createKnowledge(store, { now: () => t, log: () => {} });
  const first = await k.load();
  t += 30_000; await k.load();
  assert.deepEqual(calls, { heads: 1, lists: 1 }, '1 минутын дотор шалгахгүй');
  t += 60_000; await k.load();
  assert.deepEqual(calls, { heads: 2, lists: 1 }, 'тэмдэг өөрчлөгдөөгүй — жагсаалт дахин уншихгүй');
  rev = 'a|b|-|2026';
  t += 60_000; await k.load();
  assert.deepEqual(calls, { heads: 3, lists: 2 }, 'admin засвар → дахин ачаална');
  t += 31 * 60_000; await k.load();
  assert.deepEqual(calls, { heads: 4, lists: 3 }, '30 минут тутам заавал');
  fail = true;
  t += 60_000;
  assert.ok(await k.load(), 'алдаа → сүүлийн зөв мэдлэг');
  t += 10_000; await k.load();
  assert.equal(calls.heads, 5, 'алдааны дараа 30 с дахин оролдохгүй');
  // Зэрэг дуудлага нэг л ачаалалт
  const k2 = createKnowledge(store, { now: () => t, log: () => {} });
  fail = false;
  calls.heads = 0;
  await Promise.all([k2.load(), k2.load(), k2.load()]);
  assert.equal(calls.heads, 1);
  // Admin-ийн кэшгүй уншилт 30 с давтахгүй
  calls.lists = 0;
  await k2.load({ fresh: true }); await k2.load({ fresh: true });
  assert.equal(calls.lists, 1);
  void first;
  // Анхны ачаалалт (кэшгүй) амжилтгүй бол алдаа шиднэ
  const k3 = createKnowledge({ readKnowledgeHeads: async () => { throw new Error('x'); }, readKnowledgeLists: async () => ({}) }, { now: () => 0, log: () => {} });
  await assert.rejects(k3.load());
assert.equal(clinicPhone({ phone: '7600-0505' }), '7600-0505');
  assert.equal(clinicPhone({ phone: '<script>' }), CLINIC.phoneDisplay);
  assert.equal(clinicPhone(null), CLINIC.phoneDisplay);
});

test('захиалгын холбоос: utm_source=messenger, #contact; svc зөвхөн allowlist slug', () => {
  assert.equal(bookingUrl(), 'https://www.skinaid.mn/?utm_source=messenger#contact');
  assert.equal(bookingUrl('batga'), 'https://www.skinaid.mn/?utm_source=messenger#contact', 'нийтлэгдээгүй slug нэмэгдэхгүй');
  assert.equal(bookingUrl('batga', ['batga']), 'https://www.skinaid.mn/?svc=batga&utm_source=messenger#contact');
  assert.equal(bookingUrl('../x', ['../x']), 'https://www.skinaid.mn/?utm_source=messenger#contact');
});

// Messenger AI — каталогийн хамрах тайлан, үнэгүй шалгалт (api/_lib/catalog-check.js) ба бүтэн тайлбар (catalog-safe.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildKnowledge, knowledgeInput } from '../../api/_lib/knowledge.js';
import { catalogCoverage, CHECK_LEVEL, kbServiceId } from '../../api/_lib/catalog-check.js';
import { buildSocialCatalog, CATALOG_LIMITS } from '../../api/_lib/social/catalog-safe.js';
import { kbServiceId as adminKbServiceId, newServiceKbId } from '../../admin/messenger-lib.js';

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(new URL('../../assets/js/catalog-defaults.js', import.meta.url), 'utf8'), sandbox);
const DEFAULTS = sandbox.window.SKINAID_DEFAULTS;
const CATALOG = { services: DEFAULTS.treatments.map((t) => ({ ...t })), packages: DEFAULTS.packages.map((p) => ({ ...p })) };

test('бодит каталог (UB Beauty-ийн толь): бүх үйлчилгээ, багц AI-д орно, бүтэн тайлбартай, алдаагүй', () => {
  const k = buildKnowledge({ site: {}, catalog: CATALOG });
  const c = k.coverage;
  assert.equal(c.summary.services, DEFAULTS.treatments.length);
  assert.equal(c.summary.packages, DEFAULTS.packages.length);
  assert.equal(c.summary.inPrompt, DEFAULTS.treatments.length + DEFAULTS.packages.length);
  assert.equal(c.summary.errors, 0);
  assert.ok(c.services.every((r) => !r.checks.includes('desc_truncated')), 'тайлбар таслагдахгүй (≤ 700)');
  // Хамгийн урт тайлбар бүтнээрээ prompt-д
  const longest = [...DEFAULTS.treatments].sort((a, b) => b.d.length - a.d.length)[0];
  assert.ok(longest.d.length > 200);
  const fact = k.catalog.facts.find((f) => f.id === `service:${longest.id}`);
  assert.ok(fact.text.includes(longest.d.replace(/\s+/g, ' ').trim().slice(-40)), 'тайлбарын төгсгөл ч орсон');
  // Ангиллын түлхүүр (бүлэглэхэд)
  assert.ok(c.services.every((r) => r.catKey && r.category));
});

test('шалгалт: нуусан мөр орохгүй; нуусан үнэ → no_price; тайлбаргүй, хугацаагүй, урт тайлбар', () => {
  const input = knowledgeInput({}, {
    services: [
      { id: 'a', c: 'exam', n: 'Нуусан', p: '₮10,000', hidden: true },
      { id: 'b', c: 'exam', n: 'Үнэ нуусан', p: '', t: '30 мин', d: 'Тайлбар' },
      { id: 'c', c: 'exam', n: 'Тайлбаргүй', p: '₮20,000' },
      { id: 'd', c: 'exam', n: 'Урт', p: '₮30,000', t: '1 цаг', d: 'ж'.repeat(CATALOG_LIMITS.descriptionChars + 50) },
    ],
    packages: [{ id: 'p1', name: 'Багц', price: '100,000₮' }, { id: 'p2', name: 'Нуусан багц', price: '1₮', hidden: true }],
  });
  const catalog = buildSocialCatalog(input);
  const c = catalogCoverage(input, catalog, { kbIds: [] });
  const by = Object.fromEntries([...c.services, ...c.packages].map((r) => [r.id, r]));
  assert.deepEqual(by.a.checks, []);
  assert.equal(by.a.inPrompt, false);
  assert.deepEqual(by.b.checks, ['no_price']);
  assert.equal(by.b.price, '');
  assert.ok(catalog.facts.find((f) => f.id === 'service:b').text.includes('үнийг ажилтан хэлнэ'));
  assert.deepEqual(by.c.checks, ['no_desc', 'no_duration']);
  assert.deepEqual(by.d.checks, ['desc_truncated']);
  assert.equal(by.d.descSent, CATALOG_LIMITS.descriptionChars);
  assert.equal(by.p2.inPrompt, false);
  assert.deepEqual(by.p1.checks, []);
  assert.equal(c.summary.errors, 0);
  assert.equal(c.summary.warnings, 3);
});

test('шалгалт: алдаа — hidden_leak, missing, price_mismatch (каталог/баримт зөрвөл)', () => {
  const input = knowledgeInput({}, { services: [
    { id: 'x', c: 'exam', n: 'Нуусан', p: '₮10,000', t: '1 цаг', d: 'т', hidden: true },
    { id: 'y', c: 'exam', n: 'Ороогүй', p: '₮20,000', t: '1 цаг', d: 'т' },
    { id: 'z', c: 'exam', n: 'Үнэ зөрсөн', p: '₮30,000', t: '1 цаг', d: 'т' },
  ], packages: [] });
  const fake = { facts: [{ id: 'service:x', kind: 'service' }, { id: 'service:z', kind: 'service' }], allowedAmounts: [10000] };
  const c = catalogCoverage(input, fake, { kbIds: [] });
  const by = Object.fromEntries(c.services.map((r) => [r.id, r.checks]));
  assert.deepEqual(by, { x: ['hidden_leak'], y: ['missing'], z: ['price_mismatch'] });
  assert.equal(c.summary.errors, 3);
  for (const k of ['hidden_leak', 'missing', 'price_mismatch']) assert.equal(CHECK_LEVEL[k], 'error');
});

test('холбоос: s_<үйлчилгээ>_… мэдлэг → үйлчилгээ; admin ба сервер ижил задална; каталогт байхгүй бол orphan', () => {
  const id = newServiceKbId('ub-cdce1283', 1_800_000_000_000, () => 0.5);
  assert.equal(kbServiceId(id), 'ub-cdce1283');
  assert.equal(adminKbServiceId(id), 'ub-cdce1283');
  for (const bad of ['k_abc', 'voice', '_rev', 's__x', 's_a b_1', '']) assert.equal(kbServiceId(bad), adminKbServiceId(bad), bad);
  const input = knowledgeInput({}, CATALOG);
  const c = catalogCoverage(input, buildSocialCatalog(input), { kbIds: [newServiceKbId('acne-2'), newServiceKbId('acne-2'), newServiceKbId('nope-1'), 'k_plain'] });
  assert.equal(c.services.find((r) => r.id === 'acne-2').kb.length, 2);
  assert.equal(c.orphans.length, 1);
  assert.equal(c.summary.linkedKb, 3);
  const base = catalogCoverage(input, buildSocialCatalog(input), { kbIds: [] });
  assert.equal(c.summary.warnings, base.summary.warnings + 1, 'orphan = +1 анхааруулга');
});

test('нуусан үйлчилгээ/багцад холбосон мэдлэг AI-д орохгүй (reason hidden); энгийн мэдлэг хэвээр', () => {
  const catalog = { services: [
    { id: 'a', c: 'exam', n: 'Нээлттэй', p: '₮10,000' },
    { id: 'b', c: 'exam', n: 'Нуусан', p: '₮20,000', hidden: true },
    { id: '', c: 'exam', n: 'id-гүй нуусан', hidden: true },
  ], packages: [{ id: 'p1', name: 'Багц', price: '100,000₮' }] };
  const kb = [
    { id: 's_a_x1', data: { status: 'published', title: 'Нээлттэй — асуулт', body: 'А: ? Х: Тийм.' } },
    { id: 's_b_x1', data: { status: 'published', title: 'Нуусан — асуулт', body: 'А: ? Х: Нууц.' } },
    { id: 's_p1_x1', data: { status: 'published', title: 'Багц — асуулт', body: 'А: ? Х: Багтана.' } },
    { id: 'k_plain', data: { status: 'published', title: 'Зогсоол', body: 'Бий.' } },
  ];
  const k = buildKnowledge({ site: {}, catalog, kb });
  const ids = k.catalog.facts.filter((f) => f.kind === 'kb').map((f) => f.id);
  assert.deepEqual(ids, ['kb:k_plain', 'kb:s_a_x1', 'kb:s_p1_x1']);
  assert.ok(k.excluded.some((e) => e.id === 'kb:s_b_x1' && e.reason === 'hidden'));
  assert.ok(!k.catalog.knowledgeText.includes('Нууц'));
  // Багцыг сайтаас бүхэлд нь нуусан (promoEnabled: false) → багцын мэдлэг ч орохгүй
  const k2 = buildKnowledge({ site: { promoEnabled: false }, catalog, kb });
  assert.ok(k2.excluded.some((e) => e.id === 'kb:s_p1_x1' && e.reason === 'hidden'));
  assert.ok(k2.catalog.facts.some((f) => f.id === 'kb:k_plain'));
});

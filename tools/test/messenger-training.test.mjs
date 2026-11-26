// Messenger AI 2-р үе шат — «Сургалт»: admin-ий мэдлэг (FAQ, voice), эмчилгээний хуудас, жишээ → prompt-ийн 3 кэштэй блок.
// PII-тэй бичлэг хасагдана, эрэмбэ тогтвортой (кэш), хязгаар, нийтэлсэн FAQ-ийн дүн policy-д зөвшөөрөгдөнө.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSocialCatalog, KB_LIMITS, PAGE_LIMITS } from '../../api/_lib/social/catalog-safe.js';
import { buildExamples, EXAMPLE_LIMITS } from '../../api/_lib/social/examples.js';
import { buildSocialRequest, SOCIAL_SYSTEM_STATIC } from '../../api/_lib/social/prompt.js';
import { decideReply } from '../../api/_lib/social/policy.js';
import { buildKnowledge } from '../../api/_lib/knowledge.js';
import { bookingUrl, slugForSources } from '../../api/_lib/booking-link.js';
import { PAGES } from '../../api/_lib/generated/pages-knowledge.js';
import { pageKnowledge, pagesKnowledgeModule, PAGE_TEXT_MAX } from '../../tools/lib/messenger-pages.mjs';
import { findPii } from '../../api/_lib/guardrails.js';

const base = {
  clinicName: 'SkinAid',
  address: 'Улаанбаатар, Чингэлтэй дүүрэг',
  hoursBrief: 'Өдөр бүр 09:00-19:00',
  services: [{ id: 'exam-1', name: 'Арьсны үзлэг', price: '₮50,000' }],
  packages: [],
};
const PAGE = {
  slug: 'batga', name: 'Батганы эмчилгээ', catalogIds: ['acne-1'],
  text: 'Батгын төрлөөс хамаарч эмч төлөвлөгөө гаргана · Үргэлжлэх хугацаа: 45 минут',
};

test('мэдлэг: нийтэлсэн FAQ kb:<id>, хуудас page:<slug> — id-аар эрэмбэлнэ; утас/имэйлтэй, хоосон бичлэгийг ХАСНА', () => {
  const c = buildSocialCatalog({
    ...base,
    pages: [PAGE],
    kb: [
      { id: 'k_z', title: 'Зогсоол', body: 'Байрны урд\nүнэгүй зогсоолтой.' },
      { id: 'k_a', title: 'Төлбөр', body: 'Бэлэн, карт, QPay-ээр төлнө.' },
      { id: 'k_mail', title: 'Имэйл', body: 'Асуултаа info@skinaid.mn руу бичнэ үү' },
      { id: 'k_tel', title: 'Утас', body: 'Залгах: 9911-2233' },
      { id: 'k_empty', title: 'Хоосон', body: '   ' },
    ],
  });
  assert.deepEqual(c.facts.map((f) => f.id), ['clinic', 'address', 'hours', 'service:exam-1', 'page:batga', 'kb:k_a', 'kb:k_z']);
  assert.equal(c.facts.find((f) => f.id === 'kb:k_z').text, 'Зогсоол — Байрны урд · үнэгүй зогсоолтой.');
  assert.match(c.facts.find((f) => f.id === 'page:batga').text, /^Эмчилгээний хуудас — Батганы эмчилгээ: /);
  assert.deepEqual(c.excluded.map((e) => `${e.id}:${e.reason}`).sort(), ['kb:k_empty:empty', 'kb:k_mail:pii', 'kb:k_tel:pii']);
  assert.deepEqual(findPii(JSON.stringify(c.facts)), []);
  // Эрэмбэ оролтын дарааллаас хамаарахгүй (кэш)
  const c2 = buildSocialCatalog({ ...base, pages: [PAGE], kb: [{ id: 'k_a', title: 'Төлбөр', body: 'Бэлэн, карт, QPay-ээр төлнө.' }, { id: 'k_z', title: 'Зогсоол', body: 'Байрны урд\nүнэгүй зогсоолтой.' }] });
  assert.deepEqual(c2.facts, c.facts);
});

test('мэдлэг: нийтэлсэн FAQ-ийн ₮ дүн, хувь, хөнгөлөлт → бодлогод зөвшөөрөгдөнө (эзэмшигчийн шийдвэр); FAQ-гүй бол хүнд', () => {
  const kb = [{ id: 'k_promo', title: 'Өвлийн урамшуулал', body: 'Арьсны үзлэг 12-р сард 20% хөнгөлөлттэй — ₮40,000.' }];
  const withKb = buildSocialCatalog({ ...base, kb });
  assert.deepEqual(withKb.allowedAmounts, [40000, 50000]);
  assert.deepEqual(withKb.allowedPercents, [20]);
  const decide = (c) => decideReply({
    mode: 'shadow', conversationState: 'bot', userText: 'Үзлэг хямдарсан уу?',
    proposal: { intent: 'promotion', confidence: 0.9, needs_human: false, reply: 'Арьсны үзлэг 12-р сард 20% хөнгөлөлттэй — ₮40,000.', source_ids: ['kb:k_promo'], quick_replies: [], reason: '' },
    knownSourceIds: c.facts.map((f) => f.id), allowedAmounts: c.allowedAmounts, allowedPercents: c.allowedPercents,
    knownNumbers: c.knownNumbers, knowledgeText: c.knowledgeText,
  });
  assert.equal(decide(withKb).route, 'auto_candidate');
  const without = decide(buildSocialCatalog(base));
  assert.equal(without.route, 'handoff');
  assert.ok(without.reasons.includes('invented_price') && without.reasons.includes('invented_percent'));
});

test('мэдлэг: хязгаар — FAQ бичлэг ≤ 1500 тэмдэгт (тасална), нийт ≤ 16,000, тоо ≤ 60; хуудас ≤ 900; voice ≤ 1500, PII-тэй voice хасна', () => {
  const long = 'а'.repeat(KB_LIMITS.entryChars + 500);
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `k_${String(i).padStart(2, '0')}`, title: `Гарчиг ${i}`, body: long }));
  const c = buildSocialCatalog({ ...base, kb: many, voiceBrief: 'Найрсаг. '.repeat(400), pages: [{ ...PAGE, text: 'б'.repeat(2000) }] });
  const kbFacts = c.facts.filter((f) => f.kind === 'kb');
  assert.ok(kbFacts.every((f) => f.text.length <= KB_LIMITS.entryChars));
  assert.ok(kbFacts.reduce((n, f) => n + f.text.length, 0) <= KB_LIMITS.totalChars);
  assert.ok(c.excluded.some((e) => e.reason === 'total_limit'));
  assert.ok(c.truncated.includes('kb:k_00'));
  assert.ok(c.voiceBrief.length <= KB_LIMITS.voiceChars && c.truncated.includes('kb:voice'));
  assert.ok(c.facts.find((f) => f.kind === 'page').text.length <= PAGE_LIMITS.pageChars + 30);
  const lots = Array.from({ length: KB_LIMITS.entries + 5 }, (_, i) => ({ id: `k_${String(i).padStart(3, '0')}`, title: 'Т', body: 'Б' }));
  assert.equal(buildSocialCatalog({ ...base, kb: lots }).facts.filter((f) => f.kind === 'kb').length, KB_LIMITS.entries);
  const v = buildSocialCatalog({ ...base, voiceBrief: 'Асуувал 99112233 руу залга' });
  assert.equal(v.voiceBrief, '');
  assert.ok(v.excluded.some((e) => e.id === 'kb:voice' && e.reason === 'pii'));
});

test('жишээ: нууцална, id-аар эрэмбэлнэ; хоосон/буруу төрөл хасна; тоо, нийт хэмжээний хязгаар', () => {
  const r = buildExamples([
    { id: 'x_b', kind: 'bad', userText: 'Үнэ хэд вэ?', reply: 'Ботокс 350,000₮', note: 'Нийтлээгүй үнэ хэлсэн' },
    { id: 'x_a', kind: 'good', userText: 'Миний утас 99112233, залгаарай', reply: 'Манай ажилтан холбогдоно.', note: '' },
    { id: 'x_c', kind: 'good', userText: 'Сайн уу', reply: '' },
    { id: 'x_d', kind: 'meh', userText: 'a', reply: 'b' },
    { id: 'x_e', kind: 'bad', userText: 'Сайн уу', reply: '', note: 'Хариулаагүй' },
  ]);
  assert.deepEqual(r.items.map((x) => x.id), ['x_a', 'x_b', 'x_e']);
  assert.equal(r.items[0].customer, 'Миний утас [утас], залгаарай');
  assert.deepEqual(r.excluded, [{ id: 'x_c', reason: 'empty' }, { id: 'x_d', reason: 'invalid' }]);
  const many = Array.from({ length: 50 }, (_, i) => ({ id: `x_${String(i).padStart(2, '0')}`, kind: 'good', userText: 'а'.repeat(400), reply: 'б'.repeat(500) }));
  const m = buildExamples(many);
  assert.ok(m.items.length <= EXAMPLE_LIMITS.items);
  assert.ok(m.items.reduce((n, x) => n + x.customer.length + x.reply.length, 0) <= EXAMPLE_LIMITS.totalChars);
  assert.ok(m.excluded.some((e) => e.reason === 'total_limit'));
});

test('prompt: жишээгүй = 2 блок, жишээтэй = 3 блок (бүгд кэштэй); тогтвортой (огноо/санамсаргүйгүй); knowledgeRev мэдлэгээр өөрчлөгдөнө', () => {
  const catalog = buildSocialCatalog({ ...base, kb: [{ id: 'k_a', title: 'Зогсоол', body: 'Үнэгүй зогсоолтой.' }] });
  const turns = [{ role: 'user', text: 'Зогсоол бий юу?' }];
  const r2 = buildSocialRequest({ catalog, turns });
  assert.equal(r2.system.length, 2);
  const examples = buildExamples([{ id: 'x_1', kind: 'good', userText: 'Сайн уу', reply: 'Сайн байна уу!' }, { id: 'x_2', kind: 'bad', userText: 'Хэд вэ', reply: '100% арилна', note: 'Баталгаа өгсөн' }]).items;
  const r3 = buildSocialRequest({ catalog, examples, turns });
  assert.equal(r3.system.length, 3);
  assert.ok(r3.system.every((b) => b.cache_control?.type === 'ephemeral'));
  assert.equal(r3.system[0].text, SOCIAL_SYSTEM_STATIC);
  assert.match(r3.system[2].text, /<examples>[\s\S]*"type":"сайн"[\s\S]*"type":"муу"[\s\S]*"why":"Баталгаа өгсөн"[\s\S]*<\/examples>/);
  assert.match(SOCIAL_SYSTEM_STATIC, /<examples>.*ХЭВ МАЯГИЙН/);
  assert.match(SOCIAL_SYSTEM_STATIC, /kb:…/);
  assert.deepEqual(buildSocialRequest({ catalog, examples, turns }), r3, 'ижил оролт → ижил хүсэлт (кэш)');
  assert.ok(!/20\d\d-\d\d-\d\d/.test(r3.system.map((b) => b.text).join('')), 'system-д огноо үгүй');
  assert.deepEqual([r3.context.kb, r3.context.examples, r3.context.pages], [1, 2, 0]);
  const other = buildSocialRequest({ catalog: buildSocialCatalog({ ...base, kb: [{ id: 'k_a', title: 'Зогсоол', body: 'Төлбөртэй.' }] }), examples, turns });
  assert.notEqual(other.context.knowledgeRev, r3.context.knowledgeRev);
  assert.equal(buildSocialRequest({ catalog, examples, turns: [{ role: 'user', text: 'өөр асуулт' }] }).context.knowledgeRev, r3.context.knowledgeRev, 'rev ярианаас хамаарахгүй');
});

test('buildKnowledge: voice бичлэг → voiceBrief; нийтлээгүй (draft) — includeDrafts үед л; эсрэг тохиолдолд «draft» шалтгаантай', () => {
  const docs = {
    site: { hours: '09-19' },
    catalog: { services: [], packages: [] },
    kb: [
      { id: 'voice', data: { title: 'Брэнд', body: 'Найрсаг, товч.', status: 'published' } },
      { id: 'k_1', data: { title: 'Төлбөр', body: 'Карт', status: 'draft' } },
      { id: 'k_2', data: { title: 'Зогсоол', body: 'Бий', status: 'published' } },
      { id: 'k_3', data: { title: 'Хуучин', body: 'x', status: 'archived' } },
    ],
    examples: [{ id: 'x_1', data: { kind: 'good', userText: 'Сайн уу', reply: 'Сайн байна уу!' } }],
  };
  const k = buildKnowledge(docs, { pages: [] });
  assert.equal(k.catalog.voiceBrief, 'Найрсаг, товч.');
  assert.deepEqual(k.catalog.facts.filter((f) => f.kind === 'kb').map((f) => f.id), ['kb:k_2']);
  assert.ok(k.excluded.some((e) => e.id === 'kb:k_1' && e.reason === 'draft'));
  assert.ok(k.excluded.some((e) => e.id === 'kb:k_3' && e.reason === 'draft'));
  assert.equal(k.examples.length, 1);
  const d = buildKnowledge(docs, { includeDrafts: true, pages: [] });
  assert.deepEqual(d.catalog.facts.filter((f) => f.kind === 'kb').map((f) => f.id), ['kb:k_1', 'kb:k_2']);
});

test('эмчилгээний хуудас: зөвхөн товч тайлбар, хугацаа, «юу вэ», «явц» — эсрэг заалт, гаж нөлөө, арчилгаа, үнэ, FAQ ОРОХГҮЙ', () => {
  const page = {
    slug: 'test-page', name: 'Туршилтын эмчилгээ', catalogIds: ['acne-1'], summary: 'Товч **тайлбар**.',
    facts: { duration: '45 минут', anesthesia: 'Шаардлагагүй', sessions: '3–5 удаа', downtime: 'Байхгүй' },
    sections: {
      what: ['Юу вэ хэсэг.'], suits: ['Хэнд тохирох.'], contraindications: ['ЭСРЭГЗААЛТ'], procedure: [{ ol: ['Нэг', 'Хоёр'] }],
      aftercare: ['АРЧИЛГАА'], sideEffects: ['ГАЖНӨЛӨӨ'], price: ['ҮНЭХЭСЭГ'],
    },
    faq: [{ q: 'АСУУЛТ', a: 'ХАРИУЛТ' }],
  };
  const k = pageKnowledge(page);
  assert.equal(k.slug, 'test-page');
  assert.deepEqual(k.catalogIds, ['acne-1']);
  for (const w of ['Товч тайлбар.', 'Үргэлжлэх хугацаа: 45 минут', 'Давтамж, тоо: 3–5 удаа', 'Юу вэ хэсэг.', 'Нэг', 'Хоёр']) assert.ok(k.text.includes(w), w);
  for (const w of ['ЭСРЭГЗААЛТ', 'АРЧИЛГАА', 'ГАЖНӨЛӨӨ', 'ҮНЭХЭСЭГ', 'АСУУЛТ', 'Хэнд тохирох', '**']) assert.ok(!k.text.includes(w), w);
  assert.ok(pageKnowledge({ ...page, summary: 'а'.repeat(3000) }).text.length <= PAGE_TEXT_MAX);
  assert.match(pagesKnowledgeModule([page]), /^\/\* generated by tools\/build\.mjs/);
  // Одоо нийтлэгдсэн хуудас алга → үүсгэсэн файл хоосон (build --check хуучирсныг илрүүлнэ)
  assert.ok(Array.isArray(PAGES));
});

test('захиалгын холбоос: иш нь ганц нийтлэгдсэн хуудас (page:<slug> эсвэл хуудастай үйлчилгээ) бол ?svc=<slug>', () => {
  const pages = [{ slug: 'batga', catalogIds: ['acne-1', 'acne-2'] }, { slug: 'botox', catalogIds: ['anti-1'] }];
  assert.equal(slugForSources(['page:batga'], pages), 'batga');
  assert.equal(slugForSources(['service:acne-2', 'hours'], pages), 'batga');
  assert.equal(slugForSources(['service:acne-1', 'service:anti-1'], pages), null, 'олон хуудас — сонголт үйлчлүүлэгчид');
  assert.equal(slugForSources(['page:unknown'], pages), null);
  assert.equal(slugForSources([], pages), null);
  assert.equal(bookingUrl('batga', ['batga']), 'https://www.skinaid.mn/?svc=batga&utm_source=messenger#contact');
});

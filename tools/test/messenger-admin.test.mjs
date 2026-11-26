// admin/messenger-lib.js (хөтөч) = api/_lib (сервер) ба firestore.rules-ийн утгууд; цэвэр функцүүд.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as A from '../../admin/messenger-lib.js';
import { SOCIAL_MODE_TEXT, SOCIAL_MODES, SOCIAL_RATING_TEXT, SOCIAL_RATINGS, SOCIAL_ROUTES } from '../../api/_lib/social/labels.js';
import { normalizeSettings as serverNormalize, parseSocialCaps, SOCIAL_CAP_LIMITS, SOCIAL_DEFAULTS } from '../../api/_lib/social/settings-logic.js';
import { configStatus } from '../../api/_lib/config.js';
import { ubMonth as serverMonth } from '../../api/_lib/store.js';

test('admin ↔ сервер: горим, үнэлгээ, route, таг, анхдагч ижил', () => {
  assert.deepEqual(A.MODES.map((m) => m.key), [...SOCIAL_MODES]);
  for (const m of A.MODES) assert.deepEqual({ label: m.label, hint: m.hint }, SOCIAL_MODE_TEXT[m.key]);
  assert.deepEqual(A.RATINGS.map((r) => r.key), [...SOCIAL_RATINGS]);
  for (const r of A.RATINGS) assert.equal(r.label, SOCIAL_RATING_TEXT[r.key]);
  assert.deepEqual(Object.keys(A.ROUTE_TONE).sort(), [...SOCIAL_ROUTES].sort());
  assert.deepEqual(A.CAP_LIMITS, { ...SOCIAL_CAP_LIMITS });
  assert.equal(A.DEFAULTS.monthlyRunCap, SOCIAL_DEFAULTS.runs);
  assert.equal(A.DEFAULTS.monthlyCostCapUsd, SOCIAL_DEFAULTS.usd);
  // Тохиргооны төлөвийн түлхүүр бүр серверийн configStatus-д бий
  const keys = Object.keys(configStatus({}));
  for (const [k] of A.CONFIG_ITEMS) assert.ok(keys.includes(k), k);
});

test('admin: normalizeSettings, parseCaps = серверийнх (ижил оролт → ижил гаралт)', () => {
  for (const d of [null, {}, { mode: 'shadow' }, { mode: 'shadow', killSwitch: true }, { mode: 'x', killSwitch: 'y', monthlyRunCap: 5.5, monthlyCostCapUsd: 2000 }, { mode: 'shadow', monthlyRunCap: 10, monthlyCostCapUsd: 1.25 }]) {
    const s = serverNormalize(d);
    assert.deepEqual(A.normalizeSettings(d), { mode: s.mode, killSwitch: s.killSwitch, monthlyRunCap: s.monthlyRunCap, monthlyCostCapUsd: s.monthlyCostCapUsd }, JSON.stringify(d));
  }
  for (const [r, u] of [['3000', '12,5'], ['3000', '1,000'], ['', ''], ['1,000', '$12.5'], ['100001', '1'], ['1', '1000.5'], ['-1', '1'], ['abc', '1'], ['0', '0']]) {
    const srv = parseSocialCaps(r, u);
    const adm = A.parseCaps(r, u);
    assert.deepEqual(adm.error ? null : adm, srv, `${r} ${u}`);
  }
});

test('admin: audit id нь rules-ийн хэлбэрт (8–64, ^[A-Za-z0-9_-]+$); сар = серверийн ubMonth', () => {
  for (let i = 0; i < 50; i++) {
    const id = A.auditId();
    assert.match(id, /^[A-Za-z0-9_-]{8,64}$/);
  }
  assert.equal(A.auditId(0, () => 0), 'a_000000000_0000000', 'хамгийн бага утгад ч rules-ийн 8-аас урт');
  assert.match(A.auditId(Date.now(), () => 0.999999), /^a_[0-9a-z]{9}_[0-9a-z]{7}$/);
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /isStr\(incoming\(\)\.lastAuditId, 8, 64\)/);
  const t = Date.parse('2026-11-30T17:30:00Z');   // УБ-аар 12-01
  assert.equal(A.ubMonth(t), serverMonth(new Date(t)));
  assert.equal(A.ubMonth(t), '2026-12');
});

test('admin: ноорогийн шүүлт, зардлын формат', () => {
  const ds = [{ route: 'auto_candidate', rating: null }, { route: 'handoff', rating: 'good' }, { route: 'draft' }];
  assert.equal(ds.filter((d) => A.draftMatches(d, 'all')).length, 3);
  assert.equal(ds.filter((d) => A.draftMatches(d, 'unrated')).length, 2);
  assert.equal(ds.filter((d) => A.draftMatches(d, 'auto')).length, 1);
  assert.equal(ds.filter((d) => A.draftMatches(d, 'handoff')).length, 1);
  assert.equal(A.usd(1_234_567), '$1.23');
  assert.equal(A.usd(null), '$0.00');
  assert.equal(A.ratingLabel('edited'), 'Засвартай');
});

test('admin: m-messenger.js — бүх текстийг esc()-ээр; Firestore-д зөвхөн rules-ийн зөвшөөрсөн талбар бичнэ', () => {
  const src = readFileSync(new URL('../../admin/m-messenger.js', import.meta.url), 'utf8');
  // innerHTML-д орох draft-ийн текст талбар бүр esc()-тэй
  for (const f of ['userText', 'reply', 'wouldSend', 'aiReason']) {
    assert.match(src, new RegExp(`esc\\(d\\.${f}\\)`), f);
    assert.ok(!new RegExp(`\\$\\{d\\.${f}\\}`).test(src), `${f} esc-гүй`);
  }
  assert.match(src, /updateDoc\(doc\(db, 'messenger_drafts', id\), \{ rating, note, ratedAt: serverTimestamp\(\), ratedBy: session\.user\.email \}\)/);
  assert.match(src, /lastAuditId: id, updatedAt: serverTimestamp\(\), updatedBy: session\.user\.email/);
  assert.match(src, /action: 'settings', by: session\.user\.email, at: serverTimestamp\(\)/);
  assert.ok(!/messenger_(events|threads|usage|status)'\)[^;]*\b(set|update|delete)/.test(src));
});

// ── 2-р үе шат: «Сургалт» ─────────────────────────────────────────────────

const RULES = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const ruleBlock = (name) => {
  const at = RULES.indexOf(`match /${name}/{`);
  return RULES.slice(at, RULES.indexOf('\n    }', at));
};

test('сургалт: мэдлэг, жишээний хязгаар ≤ firestore.rules, = серверийн prompt хязгаар; voice/_rev id = сервер; id-ууд rules-ийн хэлбэрт', async () => {
  const kbRule = ruleBlock('messenger_kb');
  assert.match(kbRule, new RegExp(`isStr\\(incoming\\(\\)\\.get\\('title', ''\\), 1, ${A.KB_LIMITS.title}\\)`));
  // Агуулга: rules 4000 хүртэл; admin нь AI-ийн уншдаг хэмжээгээр (1500) хязгаарлана (аудит 2026-11-27)
  const rulesBody = Number(kbRule.match(/isStr\(incoming\(\)\.get\('body', ''\), 1, (\d+)\)/)[1]);
  assert.ok(A.KB_LIMITS.body <= rulesBody);
  const { KB_LIMITS: SRV_KB } = await import('../../api/_lib/social/catalog-safe.js');
  const { EXAMPLE_LIMITS } = await import('../../api/_lib/social/examples.js');
  const { KB_IDS } = await import('../../api/_lib/store.js');
  assert.ok(A.KB_LIMITS.title + 3 + A.KB_LIMITS.body <= SRV_KB.entryChars, 'admin-ий хязгаарт багтсан бичлэг AI-д тасрахгүй');
  assert.ok(A.KB_LIMITS.body <= SRV_KB.voiceChars, 'брэнд дуу хоолой тасрахгүй');
  assert.deepEqual(A.KB_BUDGET, { chars: SRV_KB.totalChars, entries: SRV_KB.entries, entryChars: SRV_KB.entryChars });
  assert.deepEqual(A.EX_BUDGET, { items: EXAMPLE_LIMITS.items, customer: EXAMPLE_LIMITS.customerChars, reply: EXAMPLE_LIMITS.replyChars, why: EXAMPLE_LIMITS.whyChars, total: EXAMPLE_LIMITS.totalChars });
  assert.equal(A.KB_REV_ID, KB_IDS.rev);
  assert.match(A.KB_REV_ID, /^[A-Za-z0-9_-]{1,40}$/, 'тэмдгийн id rules-ийн хэлбэрт');
  assert.match(kbRule, /hasOnly\(\['title', 'body', 'status', 'updatedAt', 'updatedBy'\]\)/);
  assert.deepEqual([...kbRule.match(/get\('status', ''\) in \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]), A.KB_STATUS.map((s) => s.key));
  const exRule = ruleBlock('messenger_examples');
  assert.match(exRule, new RegExp(`isStr\\(incoming\\(\\)\\.get\\('userText', ''\\), 1, ${A.EX_LIMITS.userText}\\)`));
  assert.match(exRule, new RegExp(`isStr\\(incoming\\(\\)\\.get\\('reply', ''\\), 0, ${A.EX_LIMITS.reply}\\)`));
  assert.match(exRule, new RegExp(`isStr\\(incoming\\(\\)\\.get\\('note', ''\\), 0, ${A.EX_LIMITS.note}\\)`));
  assert.match(exRule, /hasOnly\(\['userText', 'reply', 'kind', 'note', 'updatedAt', 'updatedBy'\]\)/);
  assert.deepEqual([...exRule.match(/get\('kind', ''\) in \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]), A.EX_KINDS.map((k) => k.key));
  const { KB_VOICE_ID } = await import('../../api/_lib/knowledge.js');
  assert.equal(A.KB_VOICE_ID, KB_VOICE_ID);
  const ID = /^[A-Za-z0-9_-]{1,40}$/;
  assert.match(kbRule, /\^\[A-Za-z0-9_-\]\{1,40\}\$/);
  for (let i = 0; i < 30; i++) { assert.match(A.newKbId(), ID); assert.match(A.newExampleId(), ID); }
  assert.match(A.newKbId(0, () => 0.999999), ID);
  for (const d of ['d_' + 'a'.repeat(40), 'd_1', 'd_<x>/..', '', null]) assert.match(A.exampleIdForDraft(d), ID, String(d));
  assert.equal(A.exampleIdForDraft('d_abc'), A.exampleIdForDraft('d_abc'), 'тогтмол — ноорог бүрт нэг жишээ');
  assert.notEqual(A.exampleIdForDraft('d_abc'), A.exampleIdForDraft('d_abd'));
  assert.ok(!A.newKbId().startsWith('x_') && !A.newExampleId().startsWith('x_'), 'гараар үүсгэсэн жишээ ноорогийн id-тай давхцахгүй');
});

test('сургалт: ноорог → жишээ (Засвартай → сайн/зөв хариу, Зөв → сайн/AI хариу, Буруу → муу), текстгүй/үнэлээгүй → null', () => {
  const d = { id: 'd_1', userText: 'Үзлэг хэд вэ?', reply: 'Үзлэг ₮45,000', templateReply: null };
  assert.deepEqual(A.exampleFromDraft({ ...d, rating: 'edited', note: 'Арьсны үзлэг ₮50,000.' }), { kind: 'good', userText: 'Үзлэг хэд вэ?', reply: 'Арьсны үзлэг ₮50,000.', note: '' });
  assert.deepEqual(A.exampleFromDraft({ ...d, rating: 'good', note: '' }), { kind: 'good', userText: 'Үзлэг хэд вэ?', reply: 'Үзлэг ₮45,000', note: '' });
  assert.deepEqual(A.exampleFromDraft({ ...d, rating: 'wrong', note: 'Үнэ буруу' }), { kind: 'bad', userText: 'Үзлэг хэд вэ?', reply: 'Үзлэг ₮45,000', note: 'Үнэ буруу' });
  assert.deepEqual(A.exampleFromDraft({ ...d, reply: '', templateReply: 'Ажилтанд дамжууллаа.', rating: 'wrong', note: '' }).reply, 'Ажилтанд дамжууллаа.');
  assert.equal(A.exampleFromDraft({ ...d, rating: 'edited', note: '' }), null);
  assert.equal(A.exampleFromDraft({ ...d, rating: null }), null);
  assert.equal(A.exampleFromDraft({ ...d, userText: '', rating: 'good' }), null, 'зураг/текстгүй');
  const long = A.exampleFromDraft({ ...d, rating: 'wrong', note: 'н'.repeat(900), reply: 'х'.repeat(3000) });
  assert.equal(long.note.length, A.EX_LIMITS.note);
  assert.equal(long.reply.length, A.EX_LIMITS.reply);
  // Үүссэн жишээ шалгалтад тэнцэнэ
  assert.deepEqual(A.validateExample(A.exampleFromDraft({ ...d, rating: 'wrong', note: 'Үнэ буруу' })), []);
});

test('сургалт: маягтын шалгалт (мэдлэг, жишээ), жагсаалтын эрэмбэ, серверийн алдааны код бүр тайлбартай', () => {
  assert.deepEqual(A.validateKb({ title: 'Зогсоол', body: 'Бий', status: 'published' }), []);
  assert.deepEqual(A.validateKb({ title: ' ', body: '', status: 'x' }).map((e) => e.field), ['title', 'body', 'status']);
  assert.deepEqual(A.validateKb({ title: 'а'.repeat(121), body: 'б'.repeat(4001), status: 'draft' }).map((e) => e.field), ['title', 'body']);
  assert.deepEqual(A.validateExample({ kind: 'good', userText: 'a', reply: 'b', note: '' }), []);
  assert.deepEqual(A.validateExample({ kind: 'good', userText: 'a', reply: '', note: 'x' }).map((e) => e.field), ['reply']);
  assert.deepEqual(A.validateExample({ kind: 'bad', userText: 'a', reply: '', note: 'яагаад' }), []);
  assert.deepEqual(A.validateExample({ kind: '', userText: '', reply: '', note: 'н'.repeat(501) }).map((e) => e.field), ['kind', 'userText', 'note']);
  assert.deepEqual(A.sortKb([{ id: 'k_2', title: 'Б', status: 'draft' }, { id: 'k_1', title: 'В', status: 'published' }, { id: 'voice', title: 'x', status: 'draft' }, { id: 'k_3', title: 'А', status: 'published' }]).map((r) => r.id), ['voice', 'k_3', 'k_1', 'k_2']);
  const api = readFileSync(new URL('../../api/_lib/admin-api.js', import.meta.url), 'utf8');
  const codes = new Set([...api.matchAll(/fail\(\d+, '([a-z_]+)'/g)].map((m) => m[1]));
  assert.ok(codes.size >= 10);
  for (const c of codes) assert.ok(A.API_ERRORS[c], `admin-lib API_ERRORS: ${c}`);
  for (const r of ['draft', 'pii', 'empty', 'invalid', 'limit', 'total_limit']) assert.ok(A.EXCLUDE_TEXT[r], r);
});

test('сургалт: m-messenger-train.js — текстийг esc()-ээр; Firestore-д rules-ийн талбар л; /api/admin-д token Authorization толгойд', () => {
  const src = readFileSync(new URL('../../admin/m-messenger-train.js', import.meta.url), 'utf8');
  for (const f of ['r.userText', 'r.reply', 'r.note', 'r.body', 'r.aiReason']) {
    assert.ok(!src.includes(`\${${f}}`), `${f} esc-гүй`);
  }
  assert.match(src, /const data = \{ title: v\.title\.slice\(0, KB_LIMITS\.title\), body: v\.body, status: v\.status, updatedAt: serverTimestamp\(\), updatedBy: session\.user\.email \};/);
  assert.match(src, /const data = \{ userText: v\.userText, reply: v\.reply, kind: v\.kind, note: v\.note, updatedAt: serverTimestamp\(\), updatedBy: session\.user\.email \};/);
  // Бичилт бүр мэдлэгийн тэмдэгтэй НЭГ batch-д; тэмдэг = rules-ийн мэдлэгийн талбарууд (ноорог — AI-д орохгүй)
  assert.match(src, /const revData = \(\) => \(\{ title: '[^']+', body: new Date\(\)\.toISOString\(\), status: 'draft', updatedAt: serverTimestamp\(\), updatedBy: session\.user\.email \}\);/);
  assert.equal((src.match(/commitWithRev\(/g) || []).length, 5, 'тодорхойлолт + мэдлэг/жишээ хадгалах, устгах');
  assert.ok(!/\bsetDoc\(|\bdeleteDoc\(/.test(src), 'тэмдэггүй шууд бичилт алга');
  // Ноорогоос жишээ ШУУД хадгалагдахгүй — урьдчилан бөглөсөн засварлагч (хувийн мэдээллийг арилгуулна)
  const fromDraft = src.slice(src.indexOf('export async function exampleFromDraftAction'), src.indexOf('export function editExample'));
  assert.ok(/openEx\(/.test(fromDraft) && !/commitWithRev/.test(fromDraft));
  assert.match(src, /Authorization: `Bearer \$\{token\}`/);
  assert.match(src, /fetch\('\/api\/admin'/);
  assert.ok(!/localStorage|sessionStorage/.test(src), 'token хадгалахгүй');
  const ms = readFileSync(new URL('../../admin/m-messenger.js', import.meta.url), 'utf8');
  assert.match(ms, /training\.exampleFromDraftAction\(d, x\)/);
});

test('сургалт (аудит 2026-11-27): ноорогийн жишээний төлөв — үнэлгээ өөрчлөгдвөл «stale»; мэдлэг/жишээний AI-д орох хэмжээ; жижиг зардал', () => {
  const d = { id: 'd_1', userText: 'Үзлэг хэд вэ?', reply: 'Үзлэг ₮45,000', rating: 'good', note: '' };
  assert.equal(A.exampleState({ ...d, reply: '', rating: 'good' }), 'none', 'AI-ийн хариугүй «Зөв» — товч гарахгүй');
  assert.equal(A.exampleState(d, null), 'new');
  const cur = { kind: 'good', reply: 'Үзлэг ₮45,000' };
  assert.equal(A.exampleState(d, cur), 'same');
  assert.equal(A.exampleState({ ...d, rating: 'wrong', note: 'Буруу үнэ' }, cur), 'stale', 'Зөв → Буруу');
  assert.equal(A.exampleState({ ...d, rating: 'edited', note: 'Арьсны үзлэг ₮50,000.' }, cur), 'stale', 'Зөв → Засвартай (жишээ AI-ийн хуучин хариутай)');
  assert.equal(A.exampleState({ ...d, rating: 'edited', note: 'Арьсны үзлэг ₮50,000.' }, { kind: 'good', reply: 'Арьсны үзлэг ₮50,000 (нэргүй болгосон).' }), 'same', 'ажилтан зассан жишээ — хуучирсан биш');
  const kb = A.kbBudget([
    { id: 'k_1', title: 'а'.repeat(10), body: 'б'.repeat(100), status: 'published' },
    { id: 'k_2', title: 'x', body: 'y', status: 'draft' },
    { id: 'voice', title: 'v', body: 'v'.repeat(1000), status: 'published' },
    { id: '_rev', title: 't', body: 'r', status: 'draft' },
  ]);
  assert.deepEqual(kb, { published: 1, chars: 113, over: false });
  assert.equal(A.kbBudget(Array.from({ length: 20 }, (_, i) => ({ id: `k_${i}`, title: 'Т', body: 'б'.repeat(1500), status: 'published' }))).over, true);
  const rows = Array.from({ length: 35 }, (_, i) => ({ userText: 'а', reply: 'б', note: '', updatedAt: new Date(i * 1000) }));
  assert.equal(A.exampleBudget(rows).used, 30, 'тооны хязгаар');
  assert.equal(A.exampleBudget(Array.from({ length: 25 }, () => ({ userText: 'а'.repeat(500), reply: 'б'.repeat(600), note: '' }))).used, 10, 'нийт 12,000 тэмдэгт');
  assert.equal(A.usd3(14_200), '$0.014');
  assert.equal(A.sortKb([{ id: '_rev', title: 'z', status: 'draft' }, { id: 'k_1', title: 'a', status: 'draft' }]).length, 1, 'тэмдэг жагсаалтад харагдахгүй');
});

// admin/messenger-lib.js (хөтөч) = api/_lib (сервер) ба firestore.rules-ийн утгууд; цэвэр функцүүд.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as A from '../../admin/messenger-lib.js';
import { SEND_REASON_TEXT, SOCIAL_AUDIENCE_TEXT, SOCIAL_AUDIENCES, SOCIAL_MODE_TEXT, SOCIAL_MODES, SOCIAL_RATING_TEXT, SOCIAL_RATINGS, SOCIAL_ROUTES, TEST_THREADS_MAX } from '../../api/_lib/social/labels.js';
import { isLive, normalizeSettings as serverNormalize, parseSocialCaps, SOCIAL_CAP_LIMITS, SOCIAL_DEFAULTS } from '../../api/_lib/social/settings-logic.js';
import { SEND_KINDS } from '../../api/_lib/outbound.js';
import { configStatus } from '../../api/_lib/config.js';
import { ubMonth as serverMonth } from '../../api/_lib/store.js';

test('admin ↔ сервер: горим, үнэлгээ, route, таг, анхдагч ижил', () => {
  assert.deepEqual(A.MODES.map((m) => m.key), [...SOCIAL_MODES]);
  for (const m of A.MODES) assert.deepEqual({ label: m.label, hint: m.hint }, SOCIAL_MODE_TEXT[m.key]);
  // «Автомат» горим: үзэгчид, туршилтын акаунтын дээд тоо, илгээлтийн шалтгааны текст = сервер
  assert.deepEqual(A.AUDIENCES.map((a) => a.key), [...SOCIAL_AUDIENCES]);
  for (const a of A.AUDIENCES) assert.deepEqual({ label: a.label, hint: a.hint }, SOCIAL_AUDIENCE_TEXT[a.key]);
  assert.equal(A.TEST_THREADS_MAX, TEST_THREADS_MAX);
  assert.deepEqual(A.SEND_REASON_TEXT, { ...SEND_REASON_TEXT });
  assert.deepEqual(Object.keys(A.SEND_KIND_TEXT).sort(), [...SEND_KINDS].sort());
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
  const H = 'c'.repeat(64);
  for (const d of [null, {}, { mode: 'shadow' }, { mode: 'shadow', killSwitch: true }, { mode: 'x', killSwitch: 'y', monthlyRunCap: 5.5, monthlyCostCapUsd: 2000 }, { mode: 'shadow', monthlyRunCap: 10, monthlyCostCapUsd: 1.25 },
    { mode: 'auto' }, { mode: 'auto', autoAudience: 'all' }, { mode: 'auto', autoAudience: 'x', testThreads: [H, H, 'bad', 7] }, { mode: 'auto', testThreads: 'x' },
    { mode: 'auto', killSwitch: true, autoAudience: 'all', testThreads: Array.from({ length: 12 }, (_, i) => i.toString(16).padStart(64, '0')) }]) {
    const s = serverNormalize(d);
    assert.deepEqual(A.normalizeSettings(d), { mode: s.mode, killSwitch: s.killSwitch, monthlyRunCap: s.monthlyRunCap, monthlyCostCapUsd: s.monthlyCostCapUsd, autoAudience: s.autoAudience, testThreads: s.testThreads }, JSON.stringify(d));
    // «Амьд яриа»-ны тодорхойлолт admin ба серверт ИЖИЛ (тууз, картын тэмдэг худал хэлэхгүй)
    for (const t of [H, 'd'.repeat(64), 'bad']) assert.equal(A.isLiveThread(A.normalizeSettings(d), t), isLive(s, t), `${JSON.stringify(d)} ${t.slice(0, 3)}`);
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
  const apiSrc = readFileSync(new URL('../../admin/messenger-api.js', import.meta.url), 'utf8');
  assert.match(apiSrc, /Authorization: `Bearer \$\{token\}`/);
  assert.match(apiSrc, /fetch\('\/api\/admin'/);
  assert.ok(!/localStorage|sessionStorage/.test(src + apiSrc), 'token хадгалахгүй');
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

test('eval (admin): унасан шалтгааны текст — серверийн бодлогын шалтгаан бүрт; gradeCase-ийн код бүрт', async () => {
  const { SOCIAL_REASON_TEXT } = await import('../../api/_lib/social/labels.js');
  for (const k of Object.keys(A.EVAL_REASON)) assert.ok(SOCIAL_REASON_TEXT[k], k);
  for (const k of ['no_source', 'invented_price', 'invented_offer', 'low_confidence', 'long_reply', 'llm_needs_human']) assert.ok(A.EVAL_REASON[k], k);
  const evalSrc = readFileSync(new URL('../../api/_lib/eval.js', import.meta.url), 'utf8');
  for (const code of ['not_handoff', 'handoff', 'intent', 'lint', 'must_not']) {
    assert.ok(evalSrc.includes(`'${code}'`), code);
    assert.ok(A.EVAL_WHY[code], code);
  }
  assert.equal(A.evalWhyText('reason:no_source'), 'Бодлого: мэдлэгээс иш заагаагүй');
  assert.equal(A.evalWhyText('reason:xyz'), 'Бодлого: xyz');
  const train = readFileSync(new URL('../../admin/m-messenger-train.js', import.meta.url), 'utf8');
  assert.ok(!/\$\{f\.(id|reply|why|error)\}/.test(train) && !/\$\{r\.(by|promptVersion|runId)\}/.test(train), 'eval-ийн текст esc()-тэй');
  assert.ok(A.EVAL_WHY.fallback && evalSrc.includes("'fallback'"), 'нөөц шилжүүлэлт');
});

test('eval (admin, аудит): төлбөртэй ажиллагааны баталгаажуулалт «Болих» дээр; явж байхад гарах/ачаалах/хаахад анхааруулна; түр алдаанд дахин оролдоно; fetch хугацаатай', () => {
  const src = (f) => readFileSync(new URL(`../../admin/${f}`, import.meta.url), 'utf8');
  const train = src('m-messenger-train.js');
  assert.match(train, /title: 'Бодит AI-тай eval ажиллуулах уу\?'[^\n]*safe: true/, 'Enter давхар дарахад эхлэхгүй');
  assert.match(train, /export const busyText/);
  assert.match(train, /export async function abandonEval/);
  assert.match(src('messenger-api.js'), /new AbortController\(\)/);
  assert.match(train, /RETRY_CODES = new Set\(\[[^\]]*'network'[^\]]*'busy'/);
  assert.match(train, /Алдаагаар тасарсан ажиллагааны тайлан/);
  // Баталгаажуулалт: «busy»-д серверийн хэлсэн хугацааг хүлээнэ; хүлээлтийн үеэр «Зогсоох» дарвал дахин илгээхгүй; ISO огноо
  assert.match(train, /retryAfterMs/);
  assert.match(train, /await sleep\(wait\);\s*\n[^\n]*\n\s*if \(!alive\(g\) \|\| \(stoppable && evalStop\)\) throw e;/);
  assert.match(train, /typeof cmp\.at === 'string' \? new Date\(cmp\.at\)/);
  assert.match(train, /e\.apiCode === 'eval_closed'/);
  const msg = src('m-messenger.js');
  assert.match(msg, /busy: \(\) => training\.busyText\(\)/);
  assert.match(msg, /training\.abandonEval\(\)/);
  const admin = src('admin.js');
  assert.match(admin, /beforeunload[^\n]*busyText\(\)/);
  assert.match(admin, /leaveBusy\(\)/);
  assert.ok(A.API_ERRORS.client_timeout);
  assert.ok(!src('index.html').includes('ОДООГИЙН мэдлэгтэй'), 'eval нь нийтэлсэн мэдлэгтэй');
});

test('тойм: өдрийн нэгтгэл, үнэлгээний нарийвчлал (бага засвар = editRatio < 0.3), гейт; editRatio = серверийнх; текст esc()-ээр', async () => {
  const { editRatio: srv } = await import('../../api/_lib/guardrails.js');
  for (const [a, b] of [['', ''], ['abc', 'abd'], ['Үзлэг ₮50,000', 'Арьсны үзлэг ₮50,000.'], ['x', ''], ['Сайн байна уу', 'Сайн уу']]) assert.equal(A.editRatio(a, b), srv(a, b));
  const days = A.lastDays(3, Date.parse('2026-11-27T05:00:00Z'));
  assert.deepEqual(days, ['2026-11-25', '2026-11-26', '2026-11-27']);
  assert.deepEqual(A.lastDays(1, Date.parse('2026-11-27T17:30:00Z')), ['2026-11-28'], 'УБ-ын өдөр');
  const agg = A.aggregateDays({
    '2026-11-25': { drafts: 2, routes: { handoff: 2 }, runs: { ok: 1, error: 1 }, costMicroUsd: 100, cacheReadTokens: 900, inputTokens: 100, echo: { staff_default: 1 } },
    '2026-11-27': { drafts: 1, routes: { auto_candidate: 1 }, runs: { refusal: 1 }, adminCostMicroUsd: 50 },
  }, days);
  assert.equal(agg.totals.drafts, 3);
  assert.deepEqual(agg.totals.routes, { handoff: 2, auto_candidate: 1 });
  assert.equal(agg.totals.aiErrors, 2);
  assert.equal(agg.totals.cacheHit, 0.9);
  assert.deepEqual(agg.series.map((x) => x.drafts), [2, 0, 1]);
  const r = A.ratingStats([
    { rating: 'good', route: 'auto_candidate' },
    { rating: 'edited', route: 'auto_candidate', reply: 'Арьсны үзлэг ₮50,000', note: 'Арьсны үзлэг ₮50,000.' },
    { rating: 'edited', route: 'auto_candidate', reply: 'Тийм', note: 'Үгүй, ажилтан Тантай холбогдоно.' },
    { rating: 'wrong', route: 'handoff' },
    { rating: null, route: 'draft' },
  ]);
  assert.deepEqual([r.rated, r.good, r.edited, r.wrong, r.small], [4, 1, 2, 1, 1]);
  assert.deepEqual(r.auto, { rated: 3, good: 1, small: 1 });
  assert.equal(Math.round(r.gate.share * 100), 67);
  assert.equal(r.gate.met, false);
  assert.equal(r.gate.enough, false, '< 50 үнэлгээ');
  const { CRISIS_REASONS } = await import('../../api/_lib/crisis.js');
  assert.deepEqual(Object.keys(A.AUTO_STOP_TEXT).sort(), [...CRISIS_REASONS].sort());
  const ov = readFileSync(new URL('../../admin/m-messenger-overview.js', import.meta.url), 'utf8');
  assert.ok(!/\$\{(?:k|s\.day|r\.\w+)\}/.test(ov.replace(/\$\{Number\([^)]*\)\}/g, '')), 'текст esc()/Number()-ээр');
  assert.match(ov, /where\(documentId\(\), '>=', ids\[0\]\)/, 'өдрийн баримт documentId-ийн мужаар (composite index-гүй)');
});

test('тохиргоо/тойм (аудит, PR В): хуучин маягт автомат зогсолтыг дарахгүй (transaction + lastAuditId); хямралын шалгалт хоцорвол дахин; 4 таб 320px-д багтана; хавтанд dl-д p үгүй', () => {
  const src = (f) => readFileSync(new URL(`../../admin/${f}`, import.meta.url), 'utf8');
  const msg = src('m-messenger.js');
  assert.match(msg, /runTransaction\(db, async \(tx\) =>/);
  assert.match(msg, /changed = curAudit !== savedAuditId/);
  // Баталгаажуулалт: «Яаралтай зогсоох» хуучирсан байсан ч татгалзахгүй — одоогийн утган дээр killSwitch = true
  assert.match(msg, /if \(stop\) written = \{ \.\.\.normalizeSettings\(changed \? curData : next\), killSwitch: true \};/);
  assert.match(msg, /persist\(\{ \.\.\.saved, killSwitch: true \}, \{ stop: true \}\)/);
  assert.ok(!/batch\.set\(doc\(db, 'messenger_settings'/.test(msg), 'тохиргоог шалгалтгүй batch-аар бичихгүй');
  assert.match(msg, /r\.throttled/);
  assert.match(msg, /retryAfterMs/);
  assert.match(msg, /visibilitychange/);
  assert.match(msg, /'систем \(автомат зогсолт\)'/);
  const ov = src('m-messenger-overview.js');
  assert.ok(!/<\/dd><p>/.test(ov), 'dl > div дотор зөвхөн dt/dd');
  assert.match(ov, /RUN_STATUS_TEXT\[k\]/);
  assert.match(ov, /T00:00:00\+08:00/, 'үнэлгээний цонх = өдрийн цонх');
  assert.match(src('admin.css'), /@media \(max-width: 360px\) \{ \.ms-tabs/);
  assert.match(src('index.html'), /id="msPanelOverview"[^>]*>\s*<h2 class="sr-only">/);
  for (const k of ['ok', 'error', 'refusal', 'cap']) assert.ok(A.RUN_STATUS_TEXT[k], k);
});

test('eval (admin): унасан кейсийн шилжүүлсэн шалтгаан — код → текст (давхардалгүй), тоогоор эрэмбэлсэн; тайланд esc()-ээр', () => {
  assert.equal(A.evalReasonsText(['llm_needs_human', 'low_confidence']), 'AI өөрөө ажилтанд даатгасан; AI итгэл бага');
  assert.equal(A.evalReasonsText(['signal:refund', 'signal:discount', 'invented_price']), 'эрсдэлийн дохио; мэдлэгт байхгүй үнэ');
  assert.equal(A.evalReasonsText(['xyz']), 'xyz');
  assert.equal(A.evalReasonsText(undefined), '', 'хуучин тайлан — шалтгаангүй');
  assert.deepEqual(A.evalHandoffReasons({ low_confidence: 3, llm_needs_human: 9, zzz: 0 }), [['AI өөрөө ажилтанд даатгасан', 9], ['AI итгэл бага', 3]]);
  assert.deepEqual(A.evalHandoffReasons(undefined), []);
  const train = readFileSync(new URL('../../admin/m-messenger-train.js', import.meta.url), 'utf8');
  assert.match(train, /esc\(extra\)/);
  assert.match(train, /hr\.map\(\(\[t, n\]\) => `\$\{esc\(t\)\} \$\{Number\(n\)\}`\)/);
  assert.ok(!/\$\{f\.reasons/.test(train) && !/\$\{evalReasonsText\(/.test(train), 'шалтгааны текст шууд биш, esc()-ээр');
});

test('холбоо барих (admin): «contact» ишийн нэр; код нэмэх мөр «Хүн хянана» ноорогт ил, esc()-ээр', () => {
  const src = (f) => readFileSync(new URL(`../../admin/${f}`, import.meta.url), 'utf8');
  const train = src('m-messenger-train.js');
  assert.match(train, /if \(id === 'contact'\) return 'Холбоо барих';/);
  assert.match(train, /r\.wouldSend \? '' : block\('Систем хариуны доор нэмэх мөр[^']*', r\.contact\)/);
  const msg = src('m-messenger.js');
  assert.match(msg, /!d\.wouldSend && d\.contact \?[^\n]*\$\{esc\(d\.contact\)\}/);
  assert.ok(!/\$\{d\.contact\}|\$\{r\.contact\}/.test(msg + train), 'мөр esc()-ээр');
});

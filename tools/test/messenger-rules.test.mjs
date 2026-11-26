// firestore.rules-ийн Messenger AI хэсгийн статик шалгалт (emulator-гүй — Java байхгүй). Бодит шалгалт: console-ийн Rules
// Playground ба нийтэлсний дараа admin хуудаснаас (README «Messenger AI → Rules шалгах»).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COL } from '../../api/_lib/store.js';
import { SOCIAL_AUDIENCES, SOCIAL_MODES, SOCIAL_RATINGS, TEST_THREADS_MAX } from '../../api/_lib/social/labels.js';
import { SOCIAL_CAP_LIMITS, THREAD_ID_RE } from '../../api/_lib/social/settings-logic.js';

const RULES = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const code = RULES.replace(/\/\/.*$/gm, '');

/** `match /name/{x} { ... }` блокийн бие (хаалт тэнцүүлж) */
function block(name) {
  const at = code.indexOf(`match /${name}/{`);
  assert.ok(at >= 0, `${name} match олдсонгүй`);
  let i = code.indexOf('{', code.indexOf('}', at) + 1);
  let depth = 0;
  const start = i;
  for (; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) break;
  }
  return code.slice(start, i + 1);
}
const list = (s) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('rules: хаалт тэнцүү, нийтэлсэн #6/#7-ийн дүрэм (settings/home) хэвээр, catch-all хориг төгсгөлд', () => {
  assert.equal((code.match(/\{/g) || []).length, (code.match(/\}/g) || []).length);
  assert.match(code, /doc in \['site', 'catalog', 'home'\]/, 'console-д нийтэлсэн settings/home дүрэм алга болох ёсгүй');
  assert.match(code, /function validPosts\(ps\)/);
  assert.ok(code.lastIndexOf('match /{document=**}') > code.lastIndexOf('match /messenger_'), 'catch-all нь төгсгөлд');
  assert.match(code, /function isAdmin\(\)[\s\S]*?email_verified == true/);
});

test('rules: серверийн collection бүр — admin уншина, client бичихгүй', () => {
  for (const c of [COL.events, COL.runs, COL.usage, COL.status, COL.echo, COL.threads, COL.outbound]) {
    const b = block(c);
    assert.match(b, /allow read: if isAdmin\(\);/, c);
    assert.match(b, /allow write: if false;/, c);
    assert.ok(!/allow (create|update)/.test(b.replace(/match \/messages[\s\S]*$/, '')), `${c}: client бичих эрх байх ёсгүй`);
  }
  const msgs = block(COL.threads).slice(block(COL.threads).indexOf('match /messages/'));
  assert.match(msgs, /allow write: if false;/);
  for (const c of Object.values(COL)) assert.ok(code.includes(`match /${c}/{`) || c === COL.messages, `${c} rules-д алга`);
  assert.ok(!/match \/messenger_[^}]*if true/.test(code), 'messenger-д «if true» байх ёсгүй');
});

test('rules: тохиргоо = код (горим, таг) + audit нэг batch-д; audit append-only', () => {
  const s = block(COL.settings);
  assert.deepEqual(list(s.match(/incoming\(\)\.mode in \[([^\]]+)\]/)[1]), [...SOCIAL_MODES]);
  assert.match(s, new RegExp(`monthlyRunCap <= ${SOCIAL_CAP_LIMITS.runsMax}\\b`));
  assert.match(s, new RegExp(`monthlyCostCapUsd <= ${SOCIAL_CAP_LIMITS.usdMax}\\b`));
  assert.match(s, /doc == 'main'/);
  assert.match(s, /messengerAudit\(incoming\(\)\.lastAuditId\)\.at == request\.time/);
  assert.match(s, /allow delete: if false;/);
  const a = block(COL.audit);
  assert.match(a, /allow create: if isAdmin\(\)/);
  assert.match(a, /allow update, delete: if false;/);
  assert.match(a, /messengerSettingsAfter\(\)\.lastAuditId == id/);
  assert.match(a, /incoming\(\)\.at == request\.time/);
});

test('rules («Автомат»): үзэгчид, туршилтын акаунт — код-той ижил; ЗААВАЛ БИШ талбар (хуучин admin ажиллана); audit тохиргоотой тэнцүү', () => {
  const s = block(COL.settings);
  assert.deepEqual(list(s.match(/incoming\(\)\.get\('autoAudience', 'test'\) in \[([^\]]+)\]/)[1]), [...SOCIAL_AUDIENCES]);
  assert.match(s, /validTestThreads\(incoming\(\)\.get\('testThreads', \[\]\)\)/);
  const only = list(s.match(/keys\(\)\.hasOnly\(\[([^\]]+)\]\)/)[1]);
  const all = list(s.match(/keys\(\)\.hasAll\(\[([^\]]+)\]\)/)[1]);
  assert.deepEqual(only.filter((k) => !all.includes(k)).sort(), ['autoAudience', 'testThreads'], 'шинэ талбарууд зөвшөөрөгдсөн ч заавал биш');
  assert.deepEqual(all.sort(), ['killSwitch', 'lastAuditId', 'mode', 'monthlyCostCapUsd', 'monthlyRunCap', 'updatedAt', 'updatedBy']);
  // Туршилтын акаунт: ≤ TEST_THREADS_MAX, элемент бүр ярианы id (индекс 0…max-1 бүгд шалгагдана)
  const fn = code.slice(code.indexOf('function validTestThreads'), code.indexOf('match /messenger_settings/'));
  assert.match(fn, new RegExp(`l is list && l\\.size\\(\\) <= ${TEST_THREADS_MAX}\\b`));
  for (let i = 0; i < TEST_THREADS_MAX; i++) assert.ok(fn.includes(`(l.size() < ${i + 1} || isThreadId(l[${i}]))`), `индекс ${i}`);
  assert.ok(!fn.includes(`l[${TEST_THREADS_MAX}]`));
  const re = code.match(/function isThreadId\(v\) \{\s*return v is string && v\.matches\('([^']+)'\);/)[1];
  assert.equal(re, THREAD_ID_RE.source);
  const a = block(COL.audit);
  assert.deepEqual(list(a.match(/detail\.keys\(\)\.hasOnly\(\[([^\]]+)\]\)/)[1]).sort(), ['autoAudience', 'killSwitch', 'mode', 'monthlyCostCapUsd', 'monthlyRunCap', 'testThreads']);
  assert.match(a, /detail\.get\('autoAudience', 'test'\) == messengerSettingsAfter\(\)\.get\('autoAudience', 'test'\)/);
  assert.match(a, /detail\.get\('testThreads', \[\]\) == messengerSettingsAfter\(\)\.get\('testThreads', \[\]\)/);
  // Илгээсэн мессежийн бүртгэл: client хэзээ ч бичихгүй
  const o = block(COL.outbound);
  assert.match(o, /allow read: if isAdmin\(\);/);
  assert.match(o, /allow write: if false;/);
});

test('rules: ноорог — admin зөвхөн үнэлгээ (rating = код), «Засвартай» тэмдэглэлтэй; үүсгэх/устгах хориотой', () => {
  const d = block(COL.drafts);
  assert.match(d, /affectedKeys\(\)\.hasOnly\(\['rating', 'note', 'ratedAt', 'ratedBy'\]\)/);
  assert.deepEqual(list(d.match(/incoming\(\)\.rating in \[([^\]]+)\]/)[1]), [...SOCIAL_RATINGS]);
  assert.match(d, /rating != 'edited' \|\| incoming\(\)\.note\.trim\(\)\.size\(\) >= 2/);
  assert.match(d, /allow create, delete: if false;/);
});

test('rules: Rules хэлний саад — `data.service` биш, unary `!` хэрэглээгүй (2026-11-07-ийн олдвор)', () => {
  const messenger = code.slice(code.indexOf('function messengerAudit'), code.lastIndexOf('match /{document=**}'));
  assert.ok(!/(^|[^=!<>])!(?!=)/.test(messenger), 'unary ! байна');
  assert.ok(!/\.service\b/.test(messenger));
});

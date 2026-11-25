// firestore.rules-ийн Messenger AI хэсгийн статик шалгалт (emulator-гүй — Java байхгүй). Бодит шалгалт: console-ийн Rules
// Playground ба нийтэлсний дараа admin хуудаснаас (README «Messenger AI → Rules шалгах»).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COL } from '../../api/_lib/store.js';
import { SOCIAL_MODES, SOCIAL_RATINGS } from '../../api/_lib/social/labels.js';
import { SOCIAL_CAP_LIMITS } from '../../api/_lib/social/settings-logic.js';

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
  for (const c of [COL.events, COL.runs, COL.usage, COL.status, COL.echo, COL.threads]) {
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

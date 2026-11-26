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

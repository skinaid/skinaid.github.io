// node --test 'tools/test/*.test.mjs' — admin/lib.js (захиалгын жагсаалтын цаг, бүлэг, хайлт)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, dayGroup, relTime, normSearch, matchBooking, telHref } from '../../admin/lib.js';

// 2026-11-24 15:00 Улаанбаатар = 07:00 UTC
const NOW = Date.UTC(2026, 10, 24, 7, 0, 0);
const at = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h - 8, mi);   // УБ цаг → ms

test('dayKey uses Ulaanbaatar time zone', () => {
  assert.equal(dayKey(at(2026, 11, 24, 0, 30)), '2026-11-24');   // UTC-ээр 11-23
  assert.equal(dayKey(at(2026, 11, 23, 23, 59)), '2026-11-23');
});

test('dayGroup: today, yesterday, last 7 days, older (calendar days, not 24h windows)', () => {
  assert.equal(dayGroup(at(2026, 11, 24, 0, 5), NOW).key, 'today');
  assert.equal(dayGroup(at(2026, 11, 23, 23, 50), NOW).key, 'yesterday');
  assert.equal(dayGroup(at(2026, 11, 18, 9), NOW).key, 'week');
  assert.equal(dayGroup(at(2026, 11, 17, 9), NOW).key, 'older');
  assert.equal(dayGroup(at(2026, 11, 25, 9), NOW).key, 'today');   // цаг зөрүүтэй ирээдүй → өнөөдөр
});

test('relTime: short Mongolian relative labels', () => {
  assert.equal(relTime(NOW - 20e3, NOW), 'дөнгөж сая');
  assert.equal(relTime(NOW - 5 * 60e3, NOW), '5 мин өмнө');
  assert.equal(relTime(NOW - 3 * 3600e3, NOW), '3 цагийн өмнө');
  assert.equal(relTime(at(2026, 11, 23, 14, 5), NOW), 'өчигдөр 14:05');
  assert.equal(relTime(at(2026, 11, 20, 9, 30), NOW), '11-20 09:30');
  assert.equal(relTime(at(2025, 12, 31, 9), NOW), '2025-12-31');
  assert.equal(relTime(0, NOW), '—');
});

test('search: case, ү/ө/ё, spaces and dashes in phones; digits-only phone search', () => {
  assert.equal(normSearch('Б.Анударь  9911-2233'), 'банударь99112233');
  const b = { name: 'Б.Анударь', phone: '9911-2233', service: 'Батганы эмчилгээ', message: '', note: 'Утсаар ярьсан' };
  assert.ok(matchBooking(b, 'анударь'));
  assert.ok(matchBooking(b, '99112233'));
  assert.ok(matchBooking(b, '9911 2233'));
  assert.ok(matchBooking(b, '2233'));
  assert.ok(matchBooking(b, 'батга'));
  assert.ok(matchBooking({ ...b, name: 'Мөнхзул' }, 'монхзул'));
  assert.ok(matchBooking(b, 'утсаар'));
  assert.ok(!matchBooking(b, 'ботокс'));
  assert.ok(matchBooking(b, '   '));
});

test('telHref', () => {
  assert.equal(telHref('7600-0505'), 'tel:+97676000505');
  assert.equal(telHref('+976 7600 0505'), 'tel:+97676000505');
  assert.equal(telHref('976 7600 0505'), 'tel:+97676000505');
});

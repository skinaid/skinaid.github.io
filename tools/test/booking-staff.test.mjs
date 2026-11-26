// node --test 'tools/test/*.test.mjs' — assets/js/booking-staff.js (онлайн захиалгын мэргэжилтний дүрэм)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// admin-lib.test.mjs-ийн адил data: URL-ээр (Node-ийн синтакс таних хувилбараас үл хамаарна)
const src = readFileSync(new URL('../../assets/js/booking-staff.js', import.meta.url), 'utf8');
const { cleanStaff, sortByRole, providersFor, roleWords, personWords, keepChoice } = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(src));

// prod-ийн бүтэцтэй (sort_order дараалал): эмч, эмч, ресепшн, гоо засалч, эмч, гоо засалч, эмч, сувилагч
const p = (id, staff_role, name = id) => ({ id, name, title: null, photo_url: null, staff_role });
const ALL = [
  p('d1', 'doctor'), p('d2', 'doctor'), p('r1', 'receptionist'), p('c1', 'cosmetologist'),
  p('d3', 'doctor'), p('c2', 'cosmetologist'), p('d4', 'doctor'), p('n1', 'nurse'),
];
const ids = (list) => list.map((d) => d.id);

test('cleanStaff: id-гүй, давхардсан мөрийг хасна, дарааллыг хадгална', () => {
  const list = cleanStaff([p('a', 'doctor'), null, { name: 'x' }, { id: '' }, p('b', 'nurse'), { ...p('A', 'doctor') }]);
  assert.deepEqual(ids(list), ['a', 'b']);   // 'A' = 'a' (UUID том/жижиг үсэг)
  assert.deepEqual(cleanStaff(undefined), []);
  assert.deepEqual(cleanStaff({ doctors: [] }), []);
});

test('sortByRole: эмч → гоо засалч → массаж → сувилагч → бусад, үүрэг дотроо API-ийн дараалал', () => {
  const list = [p('n1', 'nurse'), p('o1', 'other'), p('c1', 'cosmetologist'), p('d1', 'doctor'), p('m1', 'massage'), p('d2', 'doctor'), p('x', null)];
  assert.deepEqual(ids(sortByRole(list)), ['d1', 'd2', 'c1', 'm1', 'n1', 'o1', 'x']);
});

test('тохируулаагүй үйлчилгээ (API бүх ажилтныг буцаасан): ресепшн нуугдаж, үүргээр эрэмбэлнэ', () => {
  const r = providersFor(ALL, ALL);
  assert.equal(r.configured, false);
  assert.deepEqual(ids(r.staff), ['d1', 'd2', 'd3', 'd4', 'c1', 'c2', 'n1']);
  // API хариу ӨӨР дараалалтай ирсэн ч ялгаагүй (UUID том үсэг ч)
  const shuffled = [...ALL].reverse().map((d) => ({ ...d, id: d.id.toUpperCase() }));
  assert.equal(providersFor(shuffled, ALL).configured, false);
});

test('тохируулаагүй ч бүх ажилтан ресепшн/менежер бол тэднийг харуулна (хоосон үлдээхгүй)', () => {
  const only = [p('r1', 'receptionist'), p('m1', 'manager')];
  const r = providersFor(only, only);
  assert.equal(r.configured, false);
  assert.deepEqual(ids(r.staff), ['r1', 'm1']);
});

test('тохируулсан үйлчилгээ: яг тэр хүмүүс (жишээ: AHA 70% → эмч; Үрэвсэлт батга → гоо засалч)', () => {
  const aha = providersFor([p('d1', 'doctor'), p('d2', 'doctor'), p('d3', 'doctor'), p('d4', 'doctor')], ALL);
  assert.equal(aha.configured, true);
  assert.deepEqual(ids(aha.staff), ['d1', 'd2', 'd3', 'd4']);
  assert.equal(roleWords(aha.staff).noun, 'Эмч');
  const acne = providersFor([p('c1', 'cosmetologist'), p('c2', 'cosmetologist')], ALL);
  assert.deepEqual(ids(acne.staff), ['c1', 'c2']);
  assert.equal(roleWords(acne.staff).noun, 'Гоо засалч');
});

test('тохируулсан үйлчилгээнд эмнэлэг ресепшн сонгосон бол харуулна, холимог бол үүргээр эрэмбэлнэ', () => {
  const r = providersFor([p('n1', 'nurse'), p('r1', 'receptionist'), p('c1', 'cosmetologist')], ALL);
  assert.equal(r.configured, true);
  assert.deepEqual(ids(r.staff), ['c1', 'n1', 'r1']);
  assert.equal(roleWords(r.staff).noun, 'Мэргэжилтэн');
});

test('тохируулсан, гэвч хэн ч захиалга авдаггүй болсон → хоосон', () => {
  const r = providersFor([], ALL);
  assert.equal(r.configured, true);
  assert.deepEqual(r.staff, []);
});

test('шинээр захиалга авдаг болсон хүн (зочлолтын явцад) ирсэн ч бүгдийг агуулбал тохируулаагүй хэвээр', () => {
  const r = providersFor([...ALL, p('d5', 'doctor')], ALL);
  assert.equal(r.configured, false);
  assert.ok(!ids(r.staff).includes('r1'));
  assert.ok(ids(r.staff).includes('d5'));
});

test('roleWords: нэг үүрэг → тэр үүрэг, холимог/тодорхойгүй → Мэргэжилтэн; харьяалахын тийн ялгал', () => {
  assert.deepEqual(roleWords([p('d1', 'doctor')]), { noun: 'Эмч', lower: 'эмч', gen: 'эмчийн' });
  assert.equal(roleWords([p('c1', 'cosmetologist')]).gen, 'гоо засалчийн');
  assert.equal(roleWords([p('n1', 'nurse'), p('n2', 'nurse')]).noun, 'Сувилагч');
  assert.equal(roleWords([p('m1', 'massage')]).noun, 'Массажист');
  assert.deepEqual(roleWords([p('d1', 'doctor'), p('c1', 'cosmetologist')]), { noun: 'Мэргэжилтэн', lower: 'мэргэжилтэн', gen: 'мэргэжилтний' });
  assert.equal(roleWords([p('r1', 'receptionist')]).noun, 'Мэргэжилтэн');
  assert.equal(roleWords([{ id: 'x' }]).noun, 'Мэргэжилтэн');
  assert.equal(roleWords([]).noun, 'Мэргэжилтэн');
  assert.equal(roleWords(undefined).noun, 'Мэргэжилтэн');
  assert.equal(personWords(p('c1', 'cosmetologist')).noun, 'Гоо засалч');
  assert.equal(personWords(null).noun, 'Мэргэжилтэн');
});

test('keepChoice: өмнө сонгосон хүн шинэ үйлчилгээг бас хийдэг бол хадгална, эс бөгөөс «any»', () => {
  const docs = [p('d1', 'doctor'), p('d2', 'doctor')];
  assert.equal(keepChoice('d2', docs), 'd2');
  assert.equal(keepChoice('D2', docs), 'd2');           // API-ийн id-г буцаана
  assert.equal(keepChoice('c1', docs), 'any');          // гоо засалч эмчийн үйлчилгээнд үлдэхгүй
  assert.equal(keepChoice('any', docs), 'any');
  assert.equal(keepChoice(null, docs), 'any');
  assert.equal(keepChoice('any', [p('c1', 'cosmetologist')]), 'c1');   // ганц хүн → автоматаар
  assert.equal(keepChoice('d1', [p('c1', 'cosmetologist')]), 'c1');
  assert.equal(keepChoice('d1', []), null);
});

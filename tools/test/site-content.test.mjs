import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyContent, pageKey, parseContent, safeValue, MAX_PAYLOAD } from '../../assets/js/site-content.js';

test('content overrides accept safe image paths and links', () => {
  assert.ok(safeValue('src', '/assets/img/photos/about-sub.jpg?v=aabbccdd'));
  assert.ok(safeValue('src', 'https://example.org/photo.webp'));
  assert.ok(safeValue('href', '#contact'));
  assert.ok(safeValue('href', '/emchilgee#acne'));
  assert.ok(safeValue('href', 'tel:+97676000505'));
  for (const address of ['javascript:alert(1)', '//other.example/x', '/\\other.example/x', 'https://user@example.org', 'data:image/svg+xml,x']) {
    assert.equal(safeValue('href', address), false);
    assert.equal(safeValue('src', address), false);
  }
  assert.equal(safeValue('src', '/assets/img/../example.jpg'), false);
});

test('invalid records leave static fields alone', () => {
  const calls = [];
  const fields = [
    { id: 'a', kind: 'src', value: '/assets/img/a.jpg', apply: (value) => calls.push(value) },
    { id: 'b', kind: 'text', value: 'Анхны', apply: (value) => calls.push(value) },
  ];
  applyContent(fields, parseContent('{"a":"javascript:alert(1)","b":"Шинэ","c":"unused"}'));
  assert.deepEqual(calls, ['Шинэ']);
  assert.deepEqual(parseContent('[]'), {});
  assert.deepEqual(parseContent(' '.repeat(MAX_PAYLOAD + 1)), {});
  assert.deepEqual(parseContent(null), {});
});

test('page documents are stable across canonical and preview paths', () => {
  assert.equal(pageKey('/'), 'home');
  assert.equal(pageKey('/index.html'), 'home');
  assert.equal(pageKey('/emchilgee/index.html'), 'emchilgee');
  assert.equal(pageKey('/emchilgee/batga'), 'emchilgee~batga');
});

test('only embedded Google Maps URLs are allowed in the map frame', () => {
  assert.ok(safeValue('map', 'https://maps.google.com/maps?cid=123&output=embed'));
  assert.ok(safeValue('map', 'https://www.google.com/maps/embed?pb=example'));
  assert.equal(safeValue('map', 'https://www.google.com/search?q=maps'), false);
  assert.equal(safeValue('map', 'https://maps.google.com.example.net/maps?output=embed'), false);
});

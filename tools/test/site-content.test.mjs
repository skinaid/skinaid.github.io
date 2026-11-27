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

test('YouTube links resolve to a video id; anything else is rejected', async () => {
  const { youtubeId, validVideos } = await import('../../assets/js/site-content.js');
  const id = 'dQw4w9WgXcQ';
  for (const url of [
    'https://www.youtube.com/watch?v=' + id, 'https://youtube.com/watch?v=' + id + '&t=42s', 'https://m.youtube.com/watch?v=' + id,
    'https://youtu.be/' + id, 'https://youtu.be/' + id + '?si=abc', 'https://www.youtube.com/shorts/' + id,
    'https://www.youtube.com/embed/' + id, 'https://www.youtube.com/live/' + id, '  https://youtu.be/' + id + ' ',
  ]) assert.equal(youtubeId(url), id, url);
  for (const url of [
    '', 'youtu.be/' + id, 'http://youtu.be/' + id, 'https://vimeo.com/123456789', 'https://youtube.com.evil.example/watch?v=' + id,
    'https://user@youtube.com/watch?v=' + id, 'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/channel/' + id,
    'javascript:alert(1)', null, 'https://youtu.be/' + id + 'x'.repeat(200),
  ]) assert.equal(youtubeId(url), null, String(url));
  assert.ok(validVideos([]));
  assert.ok(validVideos([{ url: 'https://youtu.be/' + id, title: '', hidden: false }]));
  assert.equal(validVideos([{ url: 'https://youtu.be/' + id, title: 'x'.repeat(121), hidden: false }]), false);
  assert.equal(validVideos([{ url: 'https://example.org/', title: '', hidden: false }]), false);
  assert.equal(validVideos([{ url: 'https://youtu.be/' + id, title: '' }]), false);
  assert.equal(validVideos(Array.from({ length: 13 }, () => ({ url: 'https://youtu.be/' + id, title: '', hidden: false }))), false);
});

test('video section shows only while it has visible videos, and restores to hidden', async () => {
  const { JSDOM } = await import('jsdom');
  const { applyVideos, renderPublicContent, restoreContent, contentFields, VIDEO_KEY } = await import('../../assets/js/site-content.js');
  const { readFileSync } = await import('node:fs');
  const doc = new JSDOM(readFileSync(new URL('../../index.html', import.meta.url), 'utf8')).window.document;
  const section = doc.querySelector('#videos');
  assert.ok(section.hidden, 'static page ships the section hidden');
  const before = contentFields(doc, '/').map((f) => f.id);
  const items = [
    { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Танилцуулга <b>', hidden: false },
    { url: 'https://www.youtube.com/shorts/aaaaaaaaaaa', title: '', hidden: false },
    { url: 'https://youtu.be/bbbbbbbbbbb', title: 'Нуусан', hidden: true },
  ];
  renderPublicContent(doc, '/', { [VIDEO_KEY]: items }, {});
  const cards = [...section.querySelectorAll('a.video')];
  assert.equal(section.hidden, false);
  assert.deepEqual(cards.map((a) => a.dataset.videoId), ['dQw4w9WgXcQ', 'aaaaaaaaaaa']);
  assert.equal(cards[0].getAttribute('href'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(cards[0].querySelector('.video__title').textContent, 'Танилцуулга <b>');
  assert.equal(cards[0].querySelector('b'), null, 'titles are text, never HTML');
  assert.ok(cards[1].classList.contains('video--short'));
  assert.deepEqual(contentFields(doc, '/').map((f) => f.id), before, 'video cards never become editable fields');
  restoreContent(doc);
  assert.ok(section.hidden);
  assert.equal(section.querySelectorAll('a.video').length, 0);
  applyVideos(doc, [{ url: 'https://example.org/x', title: '', hidden: false }]);
  assert.ok(section.hidden, 'invalid records render nothing');
});

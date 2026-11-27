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

test('site videos: only /assets/video/<name>.mp4 is accepted, poster sits next to it', async () => {
  const { localVideo, videoPoster, validVideos, videoCardsHTML } = await import('../../assets/js/site-content.js');
  assert.equal(localVideo('/assets/video/qa-recovery.mp4'), '/assets/video/qa-recovery.mp4');
  assert.equal(localVideo('/assets/video/qa-recovery.mp4?v=abc123'), '/assets/video/qa-recovery.mp4?v=abc123');
  for (const bad of ['assets/video/x.mp4', '/assets/video/../x.mp4', '/assets/video/x.mov', '/assets/img/x.mp4', 'https://evil.example/assets/video/x.mp4',
    '/assets/video/x.mp4" onerror="1', '/assets/video/X.mp4', '//assets/video/x.mp4', null]) assert.equal(localVideo(bad), null, String(bad));
  assert.equal(videoPoster('/assets/video/ipl.mp4?v=1'), '/assets/video/ipl.jpg');
  assert.ok(validVideos([{ url: '/assets/video/ipl.mp4', title: '', hidden: false }]));
  const html = videoCardsHTML([{ url: '/assets/video/ipl.mp4', title: '<b>IPL</b> "x"', hidden: false }]);
  assert.ok(html.includes('data-video-src="/assets/video/ipl.mp4"'));
  assert.ok(html.includes('src="/assets/video/ipl.jpg"'));
  assert.ok(!html.includes('<b>'), 'titles are escaped');
});

test('static default videos ship visible; Firestore can replace or hide them; restore brings the static set back', async () => {
  const { JSDOM } = await import('jsdom');
  const { renderPublicContent, restoreContent, contentFields, videoItems, VIDEO_KEY } = await import('../../assets/js/site-content.js');
  const { videos } = await import('../../content/videos.mjs');
  const { readFileSync, existsSync } = await import('node:fs');
  const doc = new JSDOM(readFileSync(new URL('../../index.html', import.meta.url), 'utf8')).window.document;
  const section = doc.querySelector('#videos');
  const links = [...doc.querySelectorAll('[data-videos-link]')];
  assert.equal(links.length, 3, 'header, drawer, footer');
  assert.equal(section.hidden, !videos.length);
  assert.ok(links.every((el) => el.hidden === !videos.length));
  const statics = videoItems(doc);
  assert.deepEqual(statics.map((v) => v.url), videos.map((v) => v.url), 'index.html matches content/videos.mjs');
  for (const v of videos) {
    assert.ok(existsSync(new URL('../..' + v.url, import.meta.url)), v.url);
    assert.ok(existsSync(new URL('../..' + v.url.replace(/\.mp4$/, '.jpg'), import.meta.url)), v.url + ' poster');
  }
  const before = contentFields(doc, '/').map((f) => f.id);

  // No video key in the record: static set stays as is
  renderPublicContent(doc, '/', {}, {}, true);
  assert.equal(section.querySelectorAll('a.video').length, videos.length);

  const items = [
    { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Танилцуулга <b>', hidden: false },
    { url: videos[0]?.url || '/assets/video/ipl.mp4', title: '', hidden: false },
    { url: 'https://youtu.be/bbbbbbbbbbb', title: 'Нуусан', hidden: true },
  ];
  renderPublicContent(doc, '/', { [VIDEO_KEY]: items }, {}, true);
  const cards = [...section.querySelectorAll('a.video')];
  assert.equal(section.hidden, false);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].dataset.videoId, 'dQw4w9WgXcQ');
  assert.equal(cards[0].querySelector('.video__title').textContent, 'Танилцуулга <b>');
  assert.equal(cards[0].querySelector('b'), null, 'titles are text, never HTML');
  assert.equal(cards[1].dataset.videoSrc, items[1].url);
  assert.deepEqual(contentFields(doc, '/').map((f) => f.id), before, 'video cards never become editable fields');

  restoreContent(doc);
  assert.deepEqual(videoItems(doc).map((v) => v.url), videos.map((v) => v.url), 'restore brings back the static set');
  assert.equal(section.hidden, !videos.length);

  renderPublicContent(doc, '/', { [VIDEO_KEY]: items.map((v) => ({ ...v, hidden: true })) }, {}, true);
  assert.ok(section.hidden, 'all hidden → section hidden');
  assert.ok(links.every((el) => el.hidden), 'and the menu links too');
  restoreContent(doc);
  assert.equal(section.hidden, !videos.length);
  assert.ok(links.every((el) => el.hidden === !videos.length), 'links restored');
});

test('sub pages follow the home page videos for the menu link', async () => {
  const { JSDOM } = await import('jsdom');
  const { renderPublicContent, restoreContent, VIDEO_KEY } = await import('../../assets/js/site-content.js');
  const { videos } = await import('../../content/videos.mjs');
  const { readFileSync } = await import('node:fs');
  const doc = new JSDOM(readFileSync(new URL('../../privacy/index.html', import.meta.url), 'utf8')).window.document;
  const links = [...doc.querySelectorAll('[data-videos-link]')];
  assert.equal(links.length, 3);
  assert.ok(links.every((el) => el.hidden === !videos.length));
  assert.equal(doc.querySelector('a[href="/#videos"]').textContent, 'Бичлэг');
  renderPublicContent(doc, '/privacy', {}, {});
  assert.ok(links.every((el) => el.hidden === !videos.length), 'no record → static state');
  renderPublicContent(doc, '/privacy', {}, { [VIDEO_KEY]: [{ url: 'https://youtu.be/dQw4w9WgXcQ', title: '', hidden: true }] }, true);
  assert.ok(links.every((el) => el.hidden));
  restoreContent(doc);
  assert.ok(links.every((el) => el.hidden === !videos.length));
  renderPublicContent(doc, '/privacy', {}, { [VIDEO_KEY]: [{ url: 'https://youtu.be/dQw4w9WgXcQ', title: '', hidden: false }] });
  assert.ok(links.every((el) => !el.hidden));
});

// node --test 'tools/test/*.test.mjs' — assets/js/home-render.js (нүүрний hero + «Зөвлөгөө» картууд)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { findClaims } from '../lib/claims.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const load = (rel, key) => { const w = {}; vm.runInNewContext(readFileSync(ROOT + rel, 'utf8'), { window: w, globalThis: w }); return w[key]; };
const H = load('assets/js/home-render.js', 'SKINAID_HOME_RENDER');
const home = JSON.parse(readFileSync(ROOT + 'content/home.json', 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

test('content/home.json: already normalized, valid, no banned claims', () => {
  assert.deepEqual(clone(H.norm(home)), home);
  assert.ok(H.visiblePosts(home.posts).length >= 1);
  const claims = H.texts(H.norm(home)).flatMap(([, t]) => findClaims(t, ['хамгийн түгээмэл']));
  assert.equal(claims.length, 0, JSON.stringify(claims));
});

test('hero: same markup as before (h1 with em, stats with commas), escaping everywhere', () => {
  const n = H.norm(home);
  const html = H.hero(n.hero);
  assert.match(html, /<h1 class="hero__title" data-home="title">Эрүүл, гэрэлтсэн арьс бол <em>өөртөө итгэх<\/em> итгэлийн эхлэл<\/h1>/);
  assert.match(html, /data-count="58" data-suffix="K\+">58K\+</);
  assert.equal((html.match(/<h1/g) || []).length, 1);
  assert.doesNotMatch(H.hero(n.hero, { titleTag: 'div' }), /<h1/);
  const evil = '<img src=x onerror=alert(1)>"\'&';
  const x = H.hero(H.norm({ hero: { badge: evil, titlePre: evil, titleEm: evil, titlePost: evil, text: evil, btnPrimary: evil, btnSecondary: evil, stats: [{ num: '1', suffix: evil.slice(0, 4), label: evil }] } }).hero);
  assert.doesNotMatch(x, /<img|onerror=alert\(1\)>|"'/);
  assert.match(x, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;/);
  assert.match(H.hero(H.norm({ hero: { titlePre: 'a', stats: [{ num: '1200000', suffix: '+', label: 'x' }] } }).hero), />1,200,000\+</);
});

test('hero: title joins, empty parts, default buttons, empty stat hidden', () => {
  const t = (h) => (H.hero(H.norm({ hero: h }).hero).match(/<h1[^>]*>(.*)<\/h1>/) || [])[1];
  assert.equal(t({ titlePre: 'Арьс', titleEm: 'гэрэлтэх', titlePost: ', итгэл' }), 'Арьс <em>гэрэлтэх</em>, итгэл');
  assert.equal(t({ titleEm: 'Зөвхөн' }), '<em>Зөвхөн</em>');
  assert.equal(t({ titlePre: 'A', titlePost: 'B' }), 'A B');
  assert.equal(t({ titlePre: '«', titleEm: 'x', titlePost: '»' }), '«<em>x</em>»');
  assert.equal(H.norm({ hero: { titlePre: '  ', titleEm: '', titlePost: '' } }).hero, null);
  const html = H.hero(H.norm({ hero: { titlePre: 'A', stats: [{ num: '', label: 'нуугдана' }, { num: '007', suffix: '+', label: 'жил' }] } }).hero);
  assert.match(html, /Цаг захиалах/);
  assert.match(html, /Үйлчилгээ үзэх/);
  assert.doesNotMatch(html, /нуугдана/);
  assert.match(html, /data-count="7"/);
  assert.doesNotMatch(H.hero(H.norm({ hero: { titlePre: 'A' } }).hero), /hero__badge|hero__text|hero__stats/);
  assert.equal(H.norm({ hero: { titlePre: 'A', stats: [{ num: '12a' }] } }).hero.stats[0].num, '');
});

test('norm: limits, whitespace, types; arrays capped', () => {
  const n = H.norm({ hero: { titlePre: 'a\n  b ' + 'я'.repeat(200), stats: new Array(5).fill({ num: '1' }) }, posts: new Array(20).fill({ title: 'x' }) });
  assert.equal(Array.from(n.hero.titlePre).length, H.LIMITS.titlePre);
  assert.ok(n.hero.titlePre.startsWith('a b '));
  assert.equal(n.hero.stats.length, 3);
  assert.equal(n.posts.length, 12);
  assert.equal(H.norm({ hero: { titlePre: 'a' }, posts: 'x' }).posts, null);
  assert.equal(H.norm(null), null);
  assert.equal(H.norm({ hero: { titlePre: 5 } }).hero, null);
  assert.equal(H.norm({ posts: [{ title: 'x', hidden: 'true' }] }).posts[0].hidden, false);
  assert.equal(Array.from(H.norm({ posts: [{ title: '😀'.repeat(200) }] }).posts[0].title).length, H.LIMITS.title);
});

test('images and links: only site photos / https images; https or site paths for links', () => {
  const ok = ['assets/img/photos/blog-1.jpg', 'assets/img/photos/blog-1.jpg?v=f3265421', 'https://scontent.fbcdn.net/v/t1/abc.jpg?x=1&y=2'];
  const bad = ['javascript:alert(1)', 'data:image/png;base64,AAAA', '//evil.example/a.jpg', 'http://evil.example/a.jpg',
    'assets/img/photos/../../admin/x.jpg', '/assets/img/photos/blog-1.jpg', 'assets/img/logo.png', 'https://evil.example/a.jpg" onerror="x', ' https://a.b/c d'];
  ok.forEach((v) => assert.ok(H.validImg(v), v));
  bad.forEach((v) => assert.ok(!H.validImg(v), v));
  ['https://www.facebook.com/Skinaid.mn/posts/123', '/zovlogoo/nuhjilt', '/#contact'].forEach((v) => assert.ok(H.validUrl(v), v));
  ['javascript:alert(1)', 'JAVASCRIPT:x', '//evil.example', '/\\evil.example', 'http://a.b', 'data:text/html,x', 'mailto:a@b.c', 'https://a.b/"x', 'x'].forEach((v) => assert.ok(!H.validUrl(v), v));
  const n = H.norm({ posts: [{ title: 't', img: 'javascript:alert(1)', url: 'javascript:alert(1)' }] });
  assert.equal(n.posts[0].img, '');
  assert.equal(n.posts[0].url, '');
  assert.doesNotMatch(H.posts(n.posts), /javascript|post__media|<a /);
});

test('posts: order, hidden, missing title, data-delay, links (internal/external), escaping, src()', () => {
  const list = H.norm({ posts: [
    { id: 'a', title: 'A', url: 'https://www.facebook.com/x', img: 'assets/img/photos/blog-1.jpg' },
    { id: 'b', title: 'B', hidden: true },
    { id: 'c', title: '' },
    { id: 'd', title: 'D <b>', url: '/zovlogoo/d', img: 'https://cdn.example.com/d.jpg' },
    { id: 'e', title: 'E', url: 'https://www.skinaid.mn/zovlogoo/e' },
    { id: 'f', title: 'F' },
  ] }).posts;
  assert.deepEqual(H.visiblePosts(list).map((p) => p.id), ['a', 'd', 'e', 'f']);
  const html = H.posts(list, { src: (p) => (p.startsWith('assets/') ? '/' + p : p) });
  const arts = html.split('<article').slice(1);
  assert.equal(arts.length, 4);
  assert.match(arts[0], /class="post reveal post--link">/);
  assert.match(arts[0], /href="https:\/\/www\.facebook\.com\/x" target="_blank" rel="noopener"/);
  assert.match(arts[0], /src="\/assets\/img\/photos\/blog-1\.jpg"/);
  assert.match(arts[1], /data-delay="1"/);
  assert.match(arts[1], /<a class="post__link" href="\/zovlogoo\/d">D &lt;b&gt;<\/a>/);
  assert.match(arts[1], /referrerpolicy="no-referrer"/);
  assert.doesNotMatch(arts[2], /target=/);
  assert.match(arts[3], /^ class="post reveal">/);
  assert.doesNotMatch(arts[3], /post__media|post__cat|<p>|post__by/);
  assert.equal(H.posts([]), '');
});

test('texts(): every visible text field is checked for claims', () => {
  const t = H.texts(H.norm({ hero: { badge: 'b', titlePre: 'p', stats: [{ num: '5', suffix: '+', label: 'жил' }] }, posts: [{ title: 'хамгийн шилдэг', text: '100% арилна' }] }));
  const keys = t.map(([k]) => k);
  assert.ok(keys.includes('hero.badge') && keys.includes('hero.stats[0]') && keys.includes('posts[0].title') && keys.includes('posts[0].text'));
  const labels = t.flatMap(([, x]) => findClaims(x).map((c) => c.label));
  assert.ok(labels.includes('хамгийн') && labels.includes('шилдэг') && labels.includes('100%'));
});

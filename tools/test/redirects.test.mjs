// node --test tools/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manageRedirects, isManaged } from '../lib/redirects.mjs';
import { sourceToRegExp } from '../lib/check.mjs';

const base = JSON.stringify({
  redirects: [
    { source: '/privacy-policy', destination: '/privacy', permanent: true },
    { source: '/service-page/:rest*', destination: '/emchilgee', permanent: false },
    { source: '/post/:rest*', destination: '/#blog', permanent: false },
  ],
}, null, 2) + '\n';

const find = (text, path) => JSON.parse(text).redirects.find((r) => sourceToRegExp(r.source).test(encodeURI(path)));

test('гараагүй хуудасны legacy → hub-ийн ангилал 307, нийтлэгдсэн → хуудас 308; catch-all удирдлагад орохгүй', () => {
  assert.equal(isManaged({ destination: '/emchilgee' }), false, 'гараар бичсэн catch-all-ийг build устгах ёсгүй');
  assert.equal(isManaged({ destination: '/emchilgee#scar' }), true);
  assert.equal(isManaged({ destination: '/emchilgee/batga' }), true);

  const pending = manageRedirects(base, [
    { slug: 'batga', legacy: ['/service-page/батга-багц-1-1'], dest: '/emchilgee#acne', permanent: false },
  ], sourceToRegExp);
  assert.deepEqual(pending.errors, []);
  const r1 = find(pending.text, '/service-page/батга-багц-1-1');
  assert.equal(r1.destination, '/emchilgee#acne');
  assert.equal(r1.permanent, false);
  assert.equal(r1.source, encodeURI('/service-page/батга-багц-1-1'), 'кирилл эх percent-encoded');
  assert.equal(find(pending.text, '/service-page/өөр-хаяг').destination, '/emchilgee', 'тулгагдаагүй нь catch-all-аар hub руу');

  const live = manageRedirects(pending.text, [{ slug: 'batga', legacy: ['/service-page/батга-багц-1-1'] }], sourceToRegExp, { liveSlugs: new Set(['batga']) });
  assert.deepEqual(live.errors, []);
  assert.deepEqual(live.warnings, [], 'hub → хуудас шилжилт анхааруулга өгөхгүй');
  const r2 = find(live.text, '/service-page/батга-багц-1-1');
  assert.equal(r2.destination, '/emchilgee/batga');
  assert.equal(r2.permanent, true);
  assert.ok(JSON.parse(live.text).redirects.some((r) => r.source === '/service-page/:rest*'), 'catch-all хэвээр');

  const bad = manageRedirects(base, [{ slug: 'x', legacy: ['/service-page/a'], dest: '/#treatments' }], sourceToRegExp);
  assert.equal(bad.errors.length, 1, '/emchilgee-ээс гадуур destination-ийг хүлээн авахгүй');
});

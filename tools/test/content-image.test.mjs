import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { decodeImage } from '../../api/content-image.js';

test('only bounded JPEG and WebP image signatures are served', () => {
  const webp = Buffer.alloc(24);
  webp.write('RIFF', 0);
  webp.writeUInt32LE(16, 4);
  webp.write('WEBPVP8 ', 8);
  assert.equal(decodeImage(webp.toString('base64')).mime, 'image/webp');
  webp.writeUInt32LE(99, 4);
  assert.equal(decodeImage(webp.toString('base64')), null);
  const jpeg = Buffer.alloc(24);
  jpeg.set([0xff, 0xd8, 0xff], 0);
  jpeg.set([0xff, 0xd9], 22);
  assert.equal(decodeImage(jpeg.toString('base64')).mime, 'image/jpeg');
  assert.equal(decodeImage(Buffer.from('<svg onload="void(0)"></svg>').toString('base64')), null);
  assert.equal(decodeImage('A'.repeat(480004)), null);
});

test('unsupported methods and invalid identifiers never query Firestore', async () => {
  for (const [method, id, expected] of [['POST', 'abc', 405], ['GET', ['x'], 404], ['HEAD', '../bookings', 404]]) {
    let code;
    const res = { setHeader() {}, status(value) { code = value; return this; }, end() {} };
    await handler({ method, query: { id } }, res);
    assert.equal(code, expected);
  }
});

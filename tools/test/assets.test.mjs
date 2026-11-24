// node --test tools/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AssetStamper } from '../lib/assets.mjs';

const sha8 = (s) => createHash('sha1').update(s).digest('hex').slice(0, 8);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'skinaid-assets-'));
  mkdirSync(join(root, 'assets/css'), { recursive: true });
  mkdirSync(join(root, 'assets/fonts'), { recursive: true });
  writeFileSync(join(root, 'assets/fonts/a.woff2'), 'FONT-A');
  writeFileSync(join(root, 'assets/fonts/b.woff2'), 'FONT-B');
  return root;
}

test('CSS url()-д ?v=hash тавина: үнэмлэхүй, харьцангуй, хуучин ?v-г шинэчилнэ; data:/гадаад URL-д хүрэхгүй', () => {
  const root = fixture();
  try {
    const css = [
      "@font-face { src: url('/assets/fonts/a.woff2') format('woff2'); }",
      '@font-face { src: url("../fonts/b.woff2?v=deadbeef") format("woff2"); }',
      '.x { background: url(data:image/png;base64,AAAA); }',
      '.y { background: url(https://example.com/z.png); }',
      '.z { background: url( /favicon.ico ); }',
      '/* хуучин: url(/assets/fonts/deleted.woff2) */',
      '.u { background: URL(/assets/fonts/a.woff2?x=1&v=0ld); }',
    ].join('\n');
    writeFileSync(join(root, 'assets/css/f.css'), css);
    const files = new Map();
    const st = new AssetStamper(root, files);
    const v = st.version('assets/css/f.css');
    const out = files.get('assets/css/f.css');
    assert.ok(out.includes(`url('/assets/fonts/a.woff2?v=${sha8('FONT-A')}')`));
    assert.ok(out.includes(`url("../fonts/b.woff2?v=${sha8('FONT-B')}")`));
    assert.ok(out.includes('url(data:image/png;base64,AAAA)'));
    assert.ok(out.includes('url(https://example.com/z.png)'));
    assert.ok(out.includes('url( /favicon.ico )'));
    assert.ok(out.includes('/* хуучин: url(/assets/fonts/deleted.woff2) */'), 'тайлбар доторх url()-д хүрэхгүй (устгасан файл build-ийг унагахгүй)');
    assert.ok(out.includes(`url(/assets/fonts/a.woff2?x=1&v=${sha8('FONT-A')})`), 'URL( том үсэг; бусад query хадгалагдана');
    assert.equal(v, sha8(out), 'CSS-ийн хувилбар нь хувилбарласан текстийн hash');
    // HTML-ийн preload нь CSS-тэй яг ижил URL авна (фонт хоёр удаа татагдахгүй)
    const html = st.stampHtml('index.html', '<link rel="preload" href="assets/fonts/a.woff2" as="font" crossorigin>');
    assert.ok(html.includes(`href="assets/fonts/a.woff2?v=${sha8('FONT-A')}"`));
    // Дахин ажиллуулахад (idempotent) өөрчлөгдөхгүй
    const st2 = new AssetStamper(root, new Map([['assets/css/f.css', out]]));
    assert.equal(st2.version('assets/css/f.css'), v);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

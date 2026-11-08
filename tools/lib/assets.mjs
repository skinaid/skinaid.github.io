// Asset хувилбарлагч: /assets доторх файл бүрийн холбоост агуулгын hash-ийг `?v=<8hex>`
// хэлбэрээр тавина. Ингэснээр vercel.json дахь /assets/* → `immutable` (1 жил) cache аюулгүй:
// файл өөрчлөгдөхөд URL нь өөрчлөгдөнө.
//
// ES module-ууд (backend.js → app-check.js → firebase-config.js, admin.js → …) бие биеэ
// import хийдэг тул доороос дээш (leaf эхэлж) hash-лана: импортлогчийн hash нь импортлосон
// файлын шинэ ?v-г агуулсан текстээс тооцогдоно — эс тэгвээс өөрчлөгдсөн firebase-config.js
// хуучин backend.js-ийн cache-аас болж хэрэглэгчид хүрэхгүй.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, normalize } from 'node:path';

const VERSIONED_EXT = /\.(css|js|mjs|png|jpe?g|webp|avif|svg|gif|ico|woff2?)$/i;
const sha8 = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 8);

export class AssetStamper {
  /** @param {string} root repo root; @param {Map<string,string>} files in-memory overrides (relPath → text) */
  constructor(root, files) {
    this.root = root;
    this.files = files;          // build-ийн санах ой дахь (засварласан) текст файлууд
    this.memo = new Map();       // relPath → version
    this.stack = new Set();
  }

  read(rel) {
    if (this.files.has(rel)) return this.files.get(rel);
    return readFileSync(join(this.root, rel), 'utf8');
  }

  /** Холбоосыг repo-ийн relative зам болгоно (эсвэл null: гадаад, anchor гэх мэт). */
  resolve(fromRel, url) {
    if (!url || /^(?:[a-z]+:|\/\/|#|data:)/i.test(url)) return null;
    const clean = url.split('#')[0].split('?')[0];
    if (!VERSIONED_EXT.test(clean)) return null;
    const rel = clean.startsWith('/') ? normalize(clean.slice(1)) : normalize(join(dirname(fromRel), clean));
    if (rel.startsWith('..')) return null;
    if (!rel.startsWith('assets/') && !rel.startsWith('admin/')) return null;   // /favicon.ico зэрэг root файлд хувилбар тавихгүй
    return rel;
  }

  /** Файлын хувилбар (JS module бол эхлээд импортуудыг нь хувилбарлана). */
  version(rel) {
    if (this.memo.has(rel)) return this.memo.get(rel);
    if (!existsSync(join(this.root, rel)) && !this.files.has(rel)) throw new Error(`Asset олдсонгүй: ${rel}`);
    if (this.stack.has(rel)) throw new Error(`Module давталт: ${[...this.stack, rel].join(' → ')}`);
    this.stack.add(rel);
    let v;
    if (/\.(m?js)$/.test(rel)) {
      const stamped = this.stampJs(rel, this.read(rel));
      this.files.set(rel, stamped);
      v = sha8(Buffer.from(stamped, 'utf8'));
    } else if (/\.css$/.test(rel)) {
      v = sha8(Buffer.from(this.read(rel), 'utf8'));
    } else {
      v = sha8(readFileSync(join(this.root, rel)));
    }
    this.stack.delete(rel);
    this.memo.set(rel, v);
    return v;
  }

  withVersion(fromRel, url) {
    const rel = this.resolve(fromRel, url);
    if (!rel) return url;
    const base = url.split('#')[0].split('?')[0];
    return `${base}?v=${this.version(rel)}`;
  }

  /** JS доторх харьцангуй import болон '…/assets/…' мөрүүдэд хувилбар тавина. */
  stampJs(rel, text) {
    return text.replace(/(['"])((?:\.{1,2}\/|\/)[^'"\s?]+?)(?:\?v=[0-9a-z]+)?\1/g, (m, q, url) => {
      const target = this.resolve(rel, url);
      if (!target || target === rel) return m;
      return q + url + '?v=' + this.version(target) + q;
    });
  }

  /** HTML-ийн src/href/srcset болон og:image-д хувилбар тавина. */
  stampHtml(rel, html) {
    html = html.replace(/\b(src|href)="([^"]+)"/g, (m, attr, url) => `${attr}="${this.withVersion(rel, url)}"`);
    html = html.replace(/\bsrcset="([^"]+)"/g, (m, set) =>
      'srcset="' + set.split(',').map((part) => {
        const [url, ...desc] = part.trim().split(/\s+/);
        return [this.withVersion(rel, url), ...desc].join(' ');
      }).join(', ') + '"');
    return html;
  }
}

export const relPath = (root, abs) => relative(root, abs);

// Asset хувилбарлагч: /assets доторх файл бүрийн холбоост агуулгын hash-ийг `?v=<8hex>`
// хэлбэрээр тавина. Ингэснээр vercel.json дахь /assets/*?v=… → `immutable` (1 жил) cache аюулгүй:
// файл өөрчлөгдөхөд URL нь өөрчлөгдөнө.
//
// ES module-ууд (backend.js → app-check.js → firebase-config.js, admin.js → …) бие биеэ
// import хийдэг тул доороос дээш (leaf эхэлж) hash-лана: импортлогчийн hash нь импортлосон
// файлын шинэ ?v-г агуулсан текстээс тооцогдоно — эс тэгвээс өөрчлөгдсөн firebase-config.js
// хуучин backend.js-ийн cache-аас болж хэрэглэгчид хүрэхгүй.
//
// Vercel case-sensitive, локал macOS case-insensitive тул asset бүр `git ls-files`-д яг ижил
// бичлэгээр байх ёстой, .vercelignore-д орохгүй байх ёстой — эс тэгвээс 404 нь ?v-тэй URL дээр
// нэг жил cache-лэгдэнэ.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const VERSIONED_EXT = /\.(css|js|mjs|png|jpe?g|webp|avif|svg|gif|ico|woff2?)$/i;
/** ?v=hash тавигддаг төрөл эсэх (pdf, mp4 гэх мэтэд тавихгүй — vercel.json тэдгээрт 1 өдрийн cache өгнө) */
export const needsVersion = (path) => VERSIONED_EXT.test(path.split('#')[0].split('?')[0]);

/** Build-ийн зориуд шидсэн алдаа: build.mjs нэг мөрөөр хэвлэнэ (бусад алдаанд stack + file:line). */
export class BuildError extends Error {}
const sha8 = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 8);
const posixNorm = (p) => normalize(p).split('\\').join('/');

/**
 * HTML файлын харьцангуй холбоос хөтөч дээр аль хавтаснаас задрах вэ.
 * vercel.json `trailingSlash:false` тул `privacy/index.html` нь `/privacy` дээр үйлчлэгдэнэ →
 * харьцангуй зам `/`-ээс эхэлж задарна (`privacy/` биш). 404.html аль ч гүнд үйлчлэгддэг тул
 * check.mjs харьцангуй замыг root index.html-ээс бусад HTML-д хориглоно.
 */
export function htmlBaseDir(rel) {
  if (!rel.includes('/')) return '.';
  return rel.endsWith('/index.html') ? dirname(dirname(rel)) : dirname(rel);
}

/** .vercelignore-ийн энгийн gitignore хэлбэр: `/x` эсвэл `a/b` = root-оос, `x` = аль ч түвшинд, `*` дэмжинэ.
 *  `**`, `?`, `[…]`, `!` дэмжихгүй — чимээгүй буруу таарахаас сэргийлж алдаа өгнө. */
export function vercelIgnore(root) {
  const f = join(root, '.vercelignore');
  if (!existsSync(f)) return () => false;
  const res = readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((p) => {
      if (/\*\*|[?[\]!]/.test(p)) throw new BuildError(`.vercelignore: "${p}" — tools/lib/assets.mjs vercelIgnore() энэ хэлбэрийг дэмжихгүй (зөвхөн /нэр, нэр, *)`);
      const bare = p.replace(/^\//, '').replace(/\/$/, '');
      const anchored = p.startsWith('/') || bare.includes('/');
      const body = bare.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
      return new RegExp((anchored ? '^' : '(?:^|/)') + body + '(?:/|$)');
    });
  return (rel) => res.some((re) => re.test(rel));
}

export class AssetStamper {
  /**
   * @param {string} root repo root
   * @param {Map<string,string>} files in-memory overrides (relPath → text)
   * @param {{origin?: string, tracked?: Set<string>|null, ignored?: (rel: string) => boolean}} [opts]
   */
  constructor(root, files, { origin = '', tracked = null, ignored = () => false } = {}) {
    this.root = root;
    this.files = files;          // build-ийн санах ой дахь (засварласан) текст файлууд
    this.origin = origin;        // https://www.skinaid.mn — үнэмлэхүй URL-ыг локал гэж үзнэ
    this.tracked = tracked;      // git ls-files (яг бичлэгээр); null бол шалгахгүй
    this.ignored = ignored;
    this.memo = new Map();       // relPath → version
    this.stack = new Set();
  }

  read(rel) {
    if (this.files.has(rel)) return this.files.get(rel);
    return readFileSync(join(this.root, rel), 'utf8');
  }

  /** Холбоосыг repo-ийн relative зам болгоно (эсвэл null: гадаад, anchor, хувилбар шаардахгүй файл). */
  resolve(baseDir, url) {
    if (!url) return null;
    if (this.origin && url.startsWith(this.origin + '/')) url = url.slice(this.origin.length);
    if (/^(?:[a-z]+:|\/\/|#)/i.test(url)) return null;
    const clean = url.split('#')[0].split('?')[0];
    if (!VERSIONED_EXT.test(clean)) return null;
    const rel = posixNorm(clean.startsWith('/') ? clean.slice(1) : join(baseDir, clean));
    if (rel.startsWith('..')) return null;
    if (!rel.startsWith('assets/') && !rel.startsWith('admin/')) return null;   // /favicon.ico зэрэг root файлд хувилбар тавихгүй
    return rel;
  }

  /** Файлын хувилбар (JS module бол эхлээд импортуудыг нь хувилбарлана). */
  version(rel) {
    if (this.memo.has(rel)) return this.memo.get(rel);
    if (!this.files.has(rel)) {
      if (!existsSync(join(this.root, rel))) throw new BuildError(`Asset олдсонгүй: ${rel}`);
      if (this.tracked && !this.tracked.has(rel)) {
        throw new BuildError(`Asset git-д бүртгэлгүй эсвэл том/жижиг үсэг зөрүүтэй (Vercel ялгадаг): ${rel} — \`git add\` хийх эсвэл замыг засна уу`);
      }
      if (this.ignored(rel)) throw new BuildError(`Asset .vercelignore-д таарч байгаа тул Vercel дээр байхгүй: ${rel}`);
    }
    if (this.stack.has(rel)) throw new BuildError(`Module давталт: ${[...this.stack, rel].join(' → ')}`);
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

  /** url-д ?v=<hash> тавина (үнэмлэхүй/харьцангуй хэлбэрийг хадгална); хувилбар шаардахгүй бол хэвээр. */
  withVersion(baseDir, url) {
    const rel = this.resolve(baseDir, url);
    if (!rel) return url;
    const base = url.split('#')[0].split('?')[0];
    return `${base}?v=${this.version(rel)}`;
  }

  /** JS доторх харьцангуй import болон '…/assets/…' мөрүүдэд хувилбар тавина (JS файлын байрлалаас задална). */
  stampJs(rel, text) {
    const baseDir = dirname(rel);
    return text.replace(/(['"])((?:\.{1,2}\/|\/)[^'"\s?]+?)(?:\?v=[0-9a-z]+)?\1/g, (m, q, url) => {
      const target = this.resolve(baseDir, url);
      if (!target || target === rel) return m;
      return q + url + '?v=' + this.version(target) + q;
    });
  }

  /** HTML-ийн src/href/srcset болон <meta content="…/assets/…"> (og:image, twitter:image)-д хувилбар тавина. */
  stampHtml(rel, html) {
    const baseDir = htmlBaseDir(rel);
    html = html.replace(/\b(src|href)="([^"]+)"/g, (m, attr, url) => `${attr}="${this.withVersion(baseDir, url)}"`);
    html = html.replace(/\bsrcset="([^"]+)"/g, (m, set) =>
      'srcset="' + set.split(',').map((part) => {
        const [url, ...desc] = part.trim().split(/\s+/);
        return [this.withVersion(baseDir, url), ...desc].join(' ');
      }).join(', ') + '"');
    const assetUrl = new RegExp('^(?:' + this.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')?/assets/');
    html = html.replace(/(<meta\b[^>]*?\bcontent=")([^"]+)(")/g, (m, a, url, b) =>
      (assetUrl.test(url) ? a + this.withVersion(baseDir, url) + b : m));
    return html;
  }
}

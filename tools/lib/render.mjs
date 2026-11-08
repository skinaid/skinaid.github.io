// Контентын (content/pages/*.mjs) блок → HTML. Зөвхөн гурван inline хэлбэр зөвшөөрнө:
//   **тод**                 → <strong>
//   [текст](/зам#anchor)    → дотоод холбоос (зөвхөн "/"-ээр эхэлсэн; гадаад https зөвхөн эх сурвалжид)
//   [[эмч: асуулт]]         → эмчийн баталгаажуулах тэмдэг (зөвхөн ноорогт; нийтлэх үед алдаа)
// Бусад бүх тэмдэгт escape хийгдэнэ — контентын файлд HTML бичих боломжгүй.

import { BuildError } from './assets.mjs';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const TOKEN = /(\*\*[^*\n]+?\*\*)|(\[\[эмч:\s*[^\]\n]+?\]\])|(\[[^\]\n]+?\]\([^)\s]+?\))/gu;
const INTERNAL = /^\/(?!\/)[A-Za-z0-9\-._~/%]*(?:#[A-Za-z0-9\-_]+)?$/;

/**
 * @param {string} s
 * @param {{preview?: boolean, external?: boolean, where?: string, markers?: string[]}} ctx
 */
export function inline(s, ctx = {}) {
  if (typeof s !== 'string') throw new BuildError(`${ctx.where || 'контент'}: текст биш утга (${typeof s})`);
  let out = '', last = 0;
  for (const m of s.matchAll(TOKEN)) {
    out += esc(s.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) { out += '<strong>' + esc(m[1].slice(2, -2)) + '</strong>'; continue; }
    if (m[2]) {
      const q = m[2].replace(/^\[\[эмч:\s*/u, '').replace(/\]\]$/, '');
      if (ctx.markers) ctx.markers.push(q);
      out += ctx.preview ? `<mark class="dr-q" title="Эмч баталгаажуулна">${esc(q)}</mark>` : esc(q);
      continue;
    }
    const lm = m[3].match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    const text = lm[1], href = lm[2];
    if (INTERNAL.test(href) && !href.includes('..')) {
      // Нийтлэгдээгүй хуудас руу холбоос → энгийн текст (404 руу заахгүй); ctx.linkOk-ийг build өгнө
      out += !ctx.linkOk || ctx.linkOk(href) ? `<a href="${esc(href)}">${esc(text)}</a>` : esc(text);
    } else if (ctx.external && /^https:\/\/[^\s"'<>]+$/.test(href)) {
      out += `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;
    } else {
      throw new BuildError(`${ctx.where || 'контент'}: зөвшөөрөгдөөгүй холбоос "${href}" (дотоод "/"-ээр эхэлсэн зам эсвэл эх сурвалжид https)`);
    }
  }
  return out + esc(s.slice(last));
}

/**
 * Блокуудын жагсаалт → HTML.
 * Блок: "текст" → <p>; {ul:[…]}, {ol:[…]}, {steps:[…]} (дугаартай алхам), {h3:"…"}, {note:[…]}, {warn:[…]}
 */
export function blocks(list, ctx = {}) {
  if (!Array.isArray(list)) throw new BuildError(`${ctx.where || 'контент'}: блокийн жагсаалт (array) байх ёстой`);
  return list.map((b, i) => {
    const where = `${ctx.where || 'контент'}[${i}]`;
    const c = { ...ctx, where };
    if (typeof b === 'string') return `<p>${inline(b, c)}</p>`;
    if (!b || typeof b !== 'object') throw new BuildError(`${where}: буруу блок`);
    const keys = Object.keys(b);
    if (keys.length !== 1) throw new BuildError(`${where}: блок яг нэг түлхүүртэй байх ёстой (${keys.join(', ')})`);
    const [k] = keys, v = b[k];
    const items = (arr) => {
      if (!Array.isArray(arr) || !arr.length) throw new BuildError(`${where}.${k}: хоосон биш жагсаалт байх ёстой`);
      return arr.map((x, j) => `<li>${inline(x, { ...c, where: `${where}.${k}[${j}]` })}</li>`).join('');
    };
    switch (k) {
      case 'ul': return `<ul>${items(v)}</ul>`;
      case 'ol': return `<ol>${items(v)}</ol>`;
      case 'steps': return `<ol class="steps-list">${items(v)}</ol>`;
      case 'h3': return `<h3>${inline(v, c)}</h3>`;
      case 'note': return `<div class="callout">${blocks(v, c)}</div>`;
      case 'warn': return `<div class="callout callout--warn">${blocks(v, c)}</div>`;
      default: throw new BuildError(`${where}: үл мэдэх блок "${k}"`);
    }
  }).join('\n');
}

/** Markup-гүй цэвэр текст (үгийн тоо, хориотой үгийн шалгалтад) */
export function plain(value) {
  if (value == null) return '';
  if (typeof value === 'string') {
    return value.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[\[эмч:\s*([^\]]+)\]\]/gu, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  }
  if (Array.isArray(value)) return value.map(plain).join('\n');
  if (typeof value === 'object') return Object.values(value).map(plain).join('\n');
  return '';
}

/** Үгийн тоо (монгол/латин үсэг, тоо) */
export const wordCount = (text) => (text.match(/[\p{L}\p{N}]+/gu) || []).length;

/** "2026-11-20" → "2026 оны 11-р сарын 20" */
export function mnDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  return `${m[1]} оны ${Number(m[2])}-р сарын ${Number(m[3])}`;
}

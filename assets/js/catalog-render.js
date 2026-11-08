/* ==========================================================================
   SKIN AID — catalog-render.js
   Үйлчилгээний жагсаалтын HTML загвар. Сайт (main.js, хөтөч дээр) болон
   build скрипт (tools/build.mjs, Node дээр) хоёулаа ЯГ ЭНЭ функцийг ашиглана,
   тиймээс статик HTML ба JS-ийн зурсан мөр хэзээ ч зөрөхгүй.
   Хамааралгүй, энгийн script байх ёстой (vm-ээр уншигдана).
   ========================================================================== */
(function (root) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const BOOK = '#contact';
  const PAGE_RE = /^\/emchilgee\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

  /**
   * Нэг үйлчилгээний мөр. t = { id, c, n, d, t, p }, cats = { key: 'Нэр' }.
   * opts.pages = { '<id>': '/emchilgee/<slug>' } — нийтлэгдсэн эмчилгээний хуудастай мөр тэр хуудас руу
   * «Дэлгэрэнгүй →» гэж очно (build: tools/build.mjs, хөтөч: window.SKINAID_PAGES.byId). Үгүй бол захиалга руу.
   * opts.book — захиалгын холбоос (анхдагч '#contact'; дэд хуудсанд '/#contact').
   */
  function row(t, cats, opts) {
    opts = opts || {};
    const own = opts.pages && t.id && Object.prototype.hasOwnProperty.call(opts.pages, t.id) ? opts.pages[t.id] : null;
    const page = typeof own === 'string' && PAGE_RE.test(own) ? own : null;
    const id = t.id ? ' id="t-' + esc(t.id) + '"' : '';
    const meta = (t.t ? '<span>⏱ ' + esc(t.t) + '</span>' : '') + (t.p ? '<span>' + esc(t.p) + '</span>' : '') +
      '<span>' + (page ? 'Дэлгэрэнгүй →' : 'Цаг захиалах →') + '</span>';
    return '<a class="row" href="' + esc(page || opts.book || BOOK) + '" data-c="' + esc(t.c) + '"' + id + '>' +
      '<span class="row__dot" aria-hidden="true"></span>' +
      '<span>' +
        '<span class="row__cat">' + esc((cats && cats[t.c]) || '') + '</span>' +
        '<h3>' + esc(t.n) + '</h3>' +
        '<p>' + esc(t.d) + '</p>' +
        '<span class="row__meta">' + meta + '</span>' +
      '</span>' +
    '</a>';
  }

  /** Ангиллын шүүлтүүрийн товчнууд ("Бүгд" + ангилал бүр) */
  function chips(cats) {
    return ['<button type="button" class="chip is-active" data-cat="all" aria-pressed="true">Бүгд</button>']
      .concat(Object.keys(cats || {}).map((k) => '<button type="button" class="chip" data-cat="' + esc(k) + '" aria-pressed="false">' + esc(cats[k]) + '</button>'));
  }

  root.SKINAID_RENDER = { esc: esc, row: row, chips: chips, BOOK: BOOK };
})(typeof window !== 'undefined' ? window : globalThis);

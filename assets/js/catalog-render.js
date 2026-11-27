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
   * Нэг үйлчилгээний мөр. t = { id, c, n, d, t, p, v? }, cats = { key: 'Нэр' }. v (UB Beauty-ийн хувилбарууд) байвал multiRow.
   * opts.pages = { '<id>': '/emchilgee/<slug>' } — нийтлэгдсэн эмчилгээний хуудастай мөр тэр хуудас руу
   * «Дэлгэрэнгүй →» гэж очно (build: tools/build.mjs, хөтөч: window.SKINAID_PAGES.byId). Үгүй бол захиалга руу.
   * opts.book — захиалгын холбоос (анхдагч '#contact'; дэд хуудсанд '/#contact').
   */
  function row(t, cats, opts) {
    opts = opts || {};
    const own = opts.pages && t.id && Object.prototype.hasOwnProperty.call(opts.pages, t.id) ? opts.pages[t.id] : null;
    const page = typeof own === 'string' && PAGE_RE.test(own) ? own : null;
    const id = t.id ? ' id="t-' + esc(t.id) + '"' : '';
    const vars = variants(t.v);
    if (vars.length) return multiRow(t, cats, opts, page, id, vars);
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

  /** UB Beauty-ийн хувилбарууд (assets/js/ub-catalog.js `v`): нэртэйг л, талбар бүр текст */
  function variants(v) {
    if (!Array.isArray(v)) return [];
    const s = (x) => (typeof x === 'string' ? x : '');
    return v.filter((x) => x && typeof x === 'object' && s(x.n).trim()).slice(0, 40).map((x) => ({ n: s(x.n), t: s(x.t), p: s(x.p), d: s(x.d) }));
  }

  /**
   * Олон хувилбартай мөр (жишээ: «Diode лазер үс арилгах» = 16 бүс). <a> дотор дэлгэх товч байрлуулах боломжгүй тул
   * карт = <div> (.row — шүүлт, «Бүгдийг харах» ижил ажиллана; tabindex=-1 — шүүлтийн дараах фокус), дотор нь
   * <details> хувилбарын жагсаалт (нэр · хугацаа · үнэ · тайлбар) + тусдаа холбоос.
   */
  function multiRow(t, cats, opts, page, id, vars) {
    const meta = (t.t ? '<span>⏱ ' + esc(t.t) + '</span>' : '') + (t.p ? '<span>' + esc(t.p) + '</span>' : '');
    const items = vars.map((x) => {
      const m = [x.t ? '⏱ ' + esc(x.t) : '', x.p ? esc(x.p) : ''].filter(Boolean).join(' · ');
      return '<li><span class="row__var-head"><strong>' + esc(x.n) + '</strong>' + (m ? '<span>' + m + '</span>' : '') + '</span>' +
        (x.d ? '<span class="row__var-d">' + esc(x.d) + '</span>' : '') + '</li>';
    }).join('');
    return '<div class="row row--multi" tabindex="-1" data-c="' + esc(t.c) + '"' + id + '>' +
      '<span class="row__dot" aria-hidden="true"></span>' +
      '<div>' +
        '<span class="row__cat">' + esc((cats && cats[t.c]) || '') + '</span>' +
        '<h3>' + esc(t.n) + '</h3>' +
        (t.d ? '<p>' + esc(t.d) + '</p>' : '') +
        (meta ? '<span class="row__meta">' + meta + '</span>' : '') +
        '<details class="row__vars"><summary>' + vars.length + ' сонголт — үнэ, тайлбар</summary><ul>' + items + '</ul></details>' +
        '<a class="row__link" href="' + esc(page || opts.book || BOOK) + '">' + (page ? 'Дэлгэрэнгүй →' : 'Цаг захиалах →') + '</a>' +
      '</div>' +
    '</div>';
  }

  /** Ангиллын шүүлтүүрийн товчнууд ("Бүгд" + ангилал бүр) */
  function chips(cats) {
    return ['<button type="button" class="chip is-active" data-cat="all" aria-pressed="true">Бүгд</button>']
      .concat(Object.keys(cats || {}).map((k) => '<button type="button" class="chip" data-cat="' + esc(k) + '" aria-pressed="false">' + esc(cats[k]) + '</button>'));
  }

  root.SKINAID_RENDER = { esc: esc, row: row, chips: chips, BOOK: BOOK };
})(typeof window !== 'undefined' ? window : globalThis);

/* ==========================================================================
   SKIN AID — home-render.js
   Нүүр хуудасны hero (зүүн багана) болон «Зөвлөгөө» картуудын HTML загвар.
   Гурван газар ЯГ ЭНЭ функцийг ашиглана — статик HTML ба давхарлалт хэзээ ч зөрөхгүй:
     • tools/build.mjs  — content/home.json → index.html (<!-- build:home-hero|home-posts -->)
     • assets/js/main.js — Firestore settings/home (admin) → хөтөч дээр давхарлана
     • admin/admin.js   — «Нүүр хуудас» цэсийн урьдчилан харах
   Хамааралгүй, энгийн script байх ёстой (vm-ээр уншигдана; URL, DOM ашиглахгүй).
   Хязгаарууд firestore.rules (settings/home)-тэй ижил.
   ========================================================================== */
(function (root) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const LIMITS = {
    badge: 80, titlePre: 80, titleEm: 60, titlePost: 80, text: 400, btnPrimary: 30, btnSecondary: 30,
    stats: 3, num: 7, suffix: 4, label: 40,
    posts: 12, id: 40, cat: 30, title: 120, postText: 300, by: 60, img: 500, url: 500,
  };
  const BTN_DEFAULT = { btnPrimary: 'Цаг захиалах', btnSecondary: 'Үйлчилгээ үзэх' };

  /** Нэг мөр болгож (мөр шилжилт, давхар зай → нэг зай), тэмдэгтээр (code point) таслана */
  const str = (v, max) => (typeof v === 'string' ? Array.from(v.replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim() : '');

  // Сайтын зураг (assets/img/photos/…, ?v=hash байж болно) эсвэл https:// зураг
  const PHOTO_RE = /^assets\/img\/photos\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:jpe?g|JPE?G|png|PNG|webp|WEBP|avif|AVIF)(?:\?v=[0-9a-z]{6,12})?$/;   // ?v жижиг үсэг (firestore.rules validPost)
  const HTTPS_RE = /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d{1,5})?(?:[/?#][^\s"'<>\\`]*)?$/i;
  const PATH_RE = /^\/(?![/\\])[^\s"'<>\\`]*$/;   // сайтын дотоод зам (/zovlogoo/…); //host хориотой
  const OWN_HOST_RE = /^https:\/\/(?:www\.)?skinaid\.mn(?::\d+)?(?:[/?#]|$)/i;
  const validImg = (v) => typeof v === 'string' && v.length <= LIMITS.img && (PHOTO_RE.test(v) || HTTPS_RE.test(v));
  const validUrl = (v) => typeof v === 'string' && v.length <= LIMITS.url && (HTTPS_RE.test(v) || PATH_RE.test(v));
  const isExternal = (url) => HTTPS_RE.test(url) && !OWN_HOST_RE.test(url);

  /** Тоог «58», «1,200» хэлбэрээр (main.js-ийн count-up toLocaleString('en-US')-тэй ижил) */
  const fmtNum = (num) => String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  function normStat(s) {
    s = s && typeof s === 'object' ? s : {};
    const raw = str(s.num, LIMITS.num);
    return { num: /^\d+$/.test(raw) ? String(Number(raw)) : '', suffix: str(s.suffix, LIMITS.suffix), label: str(s.label, LIMITS.label) };
  }
  function normHero(h) {
    if (!h || typeof h !== 'object') return null;
    const out = {
      badge: str(h.badge, LIMITS.badge),
      titlePre: str(h.titlePre, LIMITS.titlePre), titleEm: str(h.titleEm, LIMITS.titleEm), titlePost: str(h.titlePost, LIMITS.titlePost),
      text: str(h.text, LIMITS.text),
      btnPrimary: str(h.btnPrimary, LIMITS.btnPrimary), btnSecondary: str(h.btnSecondary, LIMITS.btnSecondary),
      stats: (Array.isArray(h.stats) ? h.stats.slice(0, LIMITS.stats) : []).map(normStat),
    };
    return (out.titlePre || out.titleEm || out.titlePost) ? out : null;   // h1 хоосон байж болохгүй
  }
  function normPost(p) {
    if (!p || typeof p !== 'object') return null;
    // «HTTPS://…» → «https://…» (firestore.rules validPost том/жижиг үсэг ялгадаг)
    const img = typeof p.img === 'string' ? p.img.trim().replace(/^https:/i, 'https:') : '';
    const url = typeof p.url === 'string' ? p.url.trim().replace(/^https:/i, 'https:') : '';
    return {
      id: str(p.id, LIMITS.id), cat: str(p.cat, LIMITS.cat), title: str(p.title, LIMITS.title),
      text: str(p.text, LIMITS.postText), by: str(p.by, LIMITS.by),
      img: validImg(img) ? img : '', url: validUrl(url) ? url : '', hidden: p.hidden === true,
    };
  }
  /**
   * Firestore/JSON-оос ирсэн өгөгдлийг хэвшүүлнэ. hero = null (h1 хоосон, бүтэц буруу) бол статик hero хэвээр;
   * posts = null (массив биш) бол статик картууд хэвээр.
   */
  function norm(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      hero: normHero(raw.hero),
      posts: Array.isArray(raw.posts) ? raw.posts.slice(0, LIMITS.posts).map(normPost).filter(Boolean) : null,
    };
  }

  /** h1: «эхлэл <em>тодруулга</em> төгсгөл»; цэг таслалын өмнө/хаалтын дараа зай тавихгүй */
  const gap = (left, right) => (!left || /[«(\[]$/.test(left) || /^[,.!?;:…»)\]]/.test(right) ? '' : ' ');
  function titleHTML(h) {
    let out = esc(h.titlePre), last = h.titlePre;
    if (h.titleEm) { out += gap(last, h.titleEm) + '<em>' + esc(h.titleEm) + '</em>'; last = h.titleEm; }
    if (h.titlePost) out += gap(last, h.titlePost) + esc(h.titlePost);
    return out;
  }

  const STAR = '<span class="dot"><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/></svg></span>';
  const ARROW = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  /**
   * Hero-ийн зүүн баганын агуулга (index.html: <div data-home="hero">-ийн дотор).
   * Хүүхэд бүр data-home түлхүүртэй — main.js зөвхөн өөрчлөгдсөн хэсгийг солино.
   * opts.titleTag — admin-ий урьдчилан харахад 'div' (хуудсанд хоёр дахь h1 гаргахгүй).
   */
  function hero(h, opts) {
    opts = opts || {};
    const tag = opts.titleTag === 'div' ? 'div' : 'h1';
    const stats = (h.stats || []).filter((s) => s.num);
    return [
      h.badge ? '<div class="hero__badge" data-home="badge">' + STAR + esc(h.badge) + '</div>' : '',
      '<' + tag + ' class="hero__title" data-home="title">' + titleHTML(h) + '</' + tag + '>',
      h.text ? '<p class="hero__text" data-home="text">' + esc(h.text) + '</p>' : '',
      '<div class="hero__actions" data-home="actions">' +
        '<a class="btn btn--primary btn--lg" href="#contact">' + esc(h.btnPrimary || BTN_DEFAULT.btnPrimary) + ' ' + ARROW + '</a>' +
        '<a class="btn btn--outline btn--lg" href="#services">' + esc(h.btnSecondary || BTN_DEFAULT.btnSecondary) + '</a>' +
      '</div>',
      stats.length ? '<div class="hero__stats" data-home="stats">' + stats.map((s) =>
        '<div class="stat"><strong><span data-count="' + esc(s.num) + '" data-suffix="' + esc(s.suffix) + '">' + esc(fmtNum(s.num) + s.suffix) + '</span></strong>' +
        '<span>' + esc(s.label) + '</span></div>').join('') + '</div>' : '',
    ].filter(Boolean).join('\n');
  }

  /** Сайт дээр харагдах картууд: нуугдаагүй, гарчигтай */
  const visiblePosts = (list) => (list || []).filter((p) => p && !p.hidden && p.title);

  /**
   * «Зөвлөгөө» картууд (index.html: <div class="posts" data-home="posts">-ийн дотор).
   * opts.src(path) — зургийн замыг хувиргах (admin: '/assets/…'); анхдагч нь хэвээр.
   */
  function posts(list, opts) {
    opts = opts || {};
    const src = typeof opts.src === 'function' ? opts.src : (x) => x;
    return visiblePosts(list).map((p, i) => {
      const ext = p.url && isExternal(p.url);
      // Холбоостой карт: гарчиг дээр сум (мэдрэгч дэлгэцэд hover-гүй ч холбоос гэдэг нь харагдана);
      // гадаад холбоос шинэ цонхонд нээгдэхийг дэлгэц уншигчид хэлнэ
      const title = p.url
        ? '<a class="post__link" href="' + esc(p.url) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + esc(p.title) +
          ' <span class="post__go" aria-hidden="true">→</span>' + (ext ? '<span class="sr-only"> (шинэ цонхонд нээгдэнэ)</span>' : '') + '</a>'
        : esc(p.title);
      const remote = /^https:/i.test(p.img);
      return '<article class="post reveal' + (p.url ? ' post--link' : '') + '"' + (i % 3 ? ' data-delay="' + (i % 3) + '"' : '') + '>\n' +
        (p.img ? '  <div class="post__media"><img src="' + esc(src(p.img)) + '" alt="" loading="lazy" width="1200" height="750"' + (remote ? ' referrerpolicy="no-referrer"' : '') + '></div>\n' : '') +
        '  <div class="post__body">\n' +
        (p.cat ? '    <span class="post__cat">' + esc(p.cat) + '</span>\n' : '') +
        '    <h3>' + title + '</h3>\n' +
        (p.text ? '    <p>' + esc(p.text) + '</p>\n' : '') +
        (p.by ? '    <span class="post__by">' + esc(p.by) + '</span>\n' : '') +
        '  </div>\n' +
      '</article>';
    }).join('\n');
  }

  /** Хайлтад орох бүх текст (хориотой үгийн шалгалт: build ба admin) — [талбар, текст] */
  function texts(n) {
    const out = [];
    if (n && n.hero) {
      const h = n.hero;
      ['badge', 'titlePre', 'titleEm', 'titlePost', 'text', 'btnPrimary', 'btnSecondary'].forEach((k) => { if (h[k]) out.push(['hero.' + k, h[k]]); });
      h.stats.forEach((s, i) => { const t = [s.num && fmtNum(s.num) + s.suffix, s.label].filter(Boolean).join(' '); if (t) out.push(['hero.stats[' + i + ']', t]); });
    }
    if (n && n.posts) n.posts.forEach((p, i) => ['cat', 'title', 'text', 'by'].forEach((k) => { if (p[k]) out.push(['posts[' + i + '].' + k, p[k]]); }));
    return out;
  }

  /**
   * content/home.json-д бичих хэлбэр (admin «JSON хуулах», SEO 7-р үе шатны синк): hero + posts л
   * (updatedAt, updatedBy, baseRev-гүй — updatedBy нь admin-ий и-мэйл, repo нийтэд нээлттэй), сайтын зураг ?v-гүй
   * (build дахин тавина). raw-ийг norm()-оор хэвшүүлнэ; hero эсвэл posts буруу бол null.
   */
  function forRepo(raw) {
    const n = norm(raw);
    if (!n || !n.hero || !n.posts) return null;
    return { hero: n.hero, posts: n.posts.map((p) => Object.assign({}, p, { img: /^https:/i.test(p.img) ? p.img : p.img.replace(/\?.*$/, '') })) };
  }

  root.SKINAID_HOME_RENDER = {
    esc: esc, LIMITS: LIMITS, BTN_DEFAULT: BTN_DEFAULT, norm: norm, hero: hero, posts: posts, visiblePosts: visiblePosts,
    validImg: validImg, validUrl: validUrl, isExternal: isExternal, fmtNum: fmtNum, texts: texts, forRepo: forRepo,
  };
})(typeof window !== 'undefined' ? window : globalThis);

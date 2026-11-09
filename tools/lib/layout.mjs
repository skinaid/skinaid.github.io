// Сайтын нийтлэг header, drawer, footer, mobile bar, «дээш» товч — НЭГ эх сурвалж.
// index.html-д <!-- build:site-header --> / <!-- build:site-footer --> хэсгээр, дэд хуудсуудад шууд орно.
// Нүүр хуудсанд холбоос "#contact", дэд хуудсанд "/#contact" хэлбэртэй. Зургийн замд ?v=hash-ийг
// AssetStamper дараа нь тавина. Мөр бүр 0-р баганаас эхэлнэ; build нь region-ий доголоор шилжүүлнэ.

const NAV = [
  // [anchor, header-ийн нэр, drawer-ийн нэр, footer «Цэс»-ийн нэр]
  ['services', 'Үйлчилгээ', 'Үйлчилгээ', 'Үйлчилгээ'],
  ['promo', 'Урамшуулал', 'Шинэ жилийн урамшуулал', 'Урамшуулал'],
  ['treatments', 'Эмчилгээ', 'Эмчилгээ', 'Онцлох эмчилгээ'],
  ['about', 'Бидний тухай', 'Бидний тухай', 'Бидний тухай'],
  ['faq', 'Асуулт', 'Түгээмэл асуулт', 'Түгээмэл асуулт'],
  ['blog', 'Зөвлөгөө', 'Зөвлөгөө', 'Зөвлөгөө'],
  ['contact', 'Холбоо барих', 'Холбоо барих', 'Холбоо барих'],
];

const PHONE_SVG = (w) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>`;

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * @typedef {object} LayoutCtx
 * @property {boolean} home        нүүр хуудас эсэх
 * @property {object}  site        content/site.mjs → site
 * @property {string}  [book]      «Цаг захиалах» холбоос (анхдагч: #contact эсвэл /#contact)
 * @property {(slug: string) => string|null} [pageUrl]  нийтлэгдсэн эмчилгээний хуудасны URL (эсвэл null)
 * @property {boolean} [hubLive]   /emchilgee нийтлэгдсэн эсэх
 * @property {string}  [current]   'hub' | slug — идэвхтэй цэс тэмдэглэх
 */

/** Дэд хуудсанд улирлын «Урамшуулал» холбоос гаргахгүй (admin promoEnabled-ийг тэнд хэрэгжүүлэх боломжгүй) */
const navFor = (ctx) => (ctx.home ? NAV : NAV.filter((n) => n[0] !== 'promo'));

function hrefs(ctx) {
  const a = (id) => (ctx.home ? '#' + id : '/#' + id);
  const asset = (p) => (ctx.home ? p : '/' + p);
  // Дэд хуудсанд «Эмчилгээ» цэс hub руу (нийтлэгдсэн бол); нүүрэнд хуудсан доторх жагсаалт руу
  const treatments = !ctx.home && ctx.hubLive ? '/emchilgee' : a('treatments');
  return { a, asset, treatments, book: ctx.book || a('contact'), logo: ctx.home ? '#top' : '/' };
}

const navLink = (h, ctx, [id], label) => {
  const href = id === 'treatments' ? h.treatments : h.a(id);
  const cur = id === 'treatments' && ctx.current === 'hub' ? ' aria-current="page"' : '';
  return `<a href="${href}"${cur}>${label}</a>`;
};

/** @param {LayoutCtx} ctx */
export function siteHeader(ctx) {
  const h = hrefs(ctx);
  const p = ctx.site.phone;
  return [
    ctx.home ? '<header class="header">' : '<header class="header is-scrolled" data-solid>',
    '  <div class="container header__inner">',
    `    <a href="${h.logo}" class="logo" aria-label="SkinAid нүүр хуудас">`,
    `      <img src="${h.asset('assets/img/logo.png')}" alt="Skin Aid — Dermatology &amp; Aesthetic Clinic" width="480" height="121" decoding="async">`,
    '    </a>',
    '',
    '    <nav class="nav" aria-label="Үндсэн цэс">',
    ...navFor(ctx).map((n) => '      ' + navLink(h, ctx, n, n[1])),
    '    </nav>',
    '',
    '    <div class="header__cta">',
    `      <a class="header__phone" href="tel:${p.tel}" data-site="tel">`,
    '        ' + PHONE_SVG('1.8'),
    `        <span data-site="phone">${p.display}</span>`,
    '      </a>',
    `      <a class="btn btn--primary btn--sm" href="${escAttr(h.book)}">Цаг захиалах</a>`,
    '      <button class="burger" aria-label="Цэс нээх" aria-expanded="false" aria-controls="drawer">',
    '        <span></span><span></span><span></span>',
    '      </button>',
    '    </div>',
    '  </div>',
    '</header>',
    '',
    '<div class="drawer" id="drawer">',
    ...navFor(ctx).map((n) => '  ' + navLink(h, ctx, n, n[2])),
    '  <div class="drawer__cta">',
    `    <a class="btn btn--primary btn--lg" href="${escAttr(h.book)}">Цаг захиалах</a>`,
    `    <a class="btn btn--outline btn--lg" href="tel:${p.tel}" data-site="tel"><span data-site="phone">${p.display}</span> руу залгах</a>`,
    '  </div>',
    '</div>',
  ].join('\n');
}

/** footer «Эмчилгээ» баганын нэг холбоос: нийтлэгдсэн хуудас → hub-ийн ангилал → нүүрний жагсаалт */
function treatmentHref(item, ctx, h) {
  const url = item.page && ctx.pageUrl ? ctx.pageUrl(item.page) : null;
  if (url) return url;
  if (ctx.hubLive && item.hub) return '/emchilgee#' + item.hub;
  return h.a('treatments');
}

/** @param {LayoutCtx} ctx */
export function siteFooter(ctx) {
  const h = hrefs(ctx);
  const s = ctx.site;
  const p = s.phone;
  const fbHost = s.sameAs.find((u) => u.includes('facebook.com'));
  return [
    '<footer class="footer">',
    '  <div class="container">',
    '    <div class="footer__grid">',
    '      <div>',
    `        <a href="${h.logo}" class="logo" aria-label="SkinAid">`,
    `          <img src="${h.asset('assets/img/logo-white.png')}" alt="Skin Aid — Dermatology &amp; Aesthetic Clinic" width="480" height="121" loading="lazy" decoding="async">`,
    '        </a>',
    `        <p class="footer__about">${escText(s.footerAbout)}</p>`,
    '      </div>',
    '      <div>',
    '        <h3>Цэс</h3>',
    '        <ul>',
    ...navFor(ctx).map((n) => `          <li>${navLink(h, ctx, n, n[3])}</li>`),
    '        </ul>',
    '      </div>',
    '      <div>',
    '        <h3>Эмчилгээ</h3>',
    '        <ul>',
    ...s.footerTreatments.map((it) => `          <li><a href="${escAttr(treatmentHref(it, ctx, h))}">${escText(it.label)}</a></li>`),
    '        </ul>',
    '      </div>',
    '      <div>',
    '        <h3>Холбоо барих</h3>',
    '        <ul class="footer__contact">',
    `          <li><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg><span>${escText(s.addressShort)}</span></li>`,
    `          <li>${PHONE_SVG('1.8')}<a href="tel:${p.tel}" data-site="tel phone">${p.intl}</a></li>`,
    `          <li><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg><a href="mailto:${s.email}" data-site="mailto email">${s.email}</a></li>`,
    `          <li><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.4c-.3 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.2v2.3H7.4V14h2.8v8h3.3z"/></svg><a href="${fbHost}" target="_blank" rel="noopener">${fbHost.replace(/^https:\/\/(www\.)?/, '')}</a></li>`,
    '        </ul>',
    '      </div>',
    '    </div>',
    '    <div class="footer__bottom">',
    `      <span>© <span id="year">2026</span> ${escText(s.legalName)} · SkinAid Clinic. Бүх эрх хуулиар хамгаалагдсан.</span>`,
    '      <a href="/privacy">Нууцлалын бодлого</a>',
    '      <!-- reCAPTCHA-ийн тэмдэг (badge) нуугдсан тул Google-ийн нөхцөлөөр энэ мэдэгдлийг заавал харуулна -->',
    '      <span class="footer__recaptcha">Энэ сайт reCAPTCHA-аар хамгаалагдсан бөгөөд Google-ийн <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Нууцлалын бодлого</a> ба <a href="https://policies.google.com/terms" target="_blank" rel="noopener">Үйлчилгээний нөхцөл</a> үйлчилнэ.</span>',
    '    </div>',
    '  </div>',
    '</footer>',
    '',
    '<!-- Mobile sticky bar -->',
    '<div class="mobile-bar">',
    `  <a class="btn btn--outline" href="tel:${p.tel}" data-site="tel">`,
    '    ' + PHONE_SVG('2'),
    '    Залгах',
    '  </a>',
    `  <a class="btn btn--primary" href="${escAttr(h.book)}">Цаг захиалах</a>`,
    '</div>',
    '',
    '<button class="totop" aria-label="Дээш очих" type="button">',
    '  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    '</button>',
  ].join('\n');
}

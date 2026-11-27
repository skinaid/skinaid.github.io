/* Public content fields shared by the editor and the site. Text is never parsed as HTML. */
export const MAX_VALUE = 2000;
export const MAX_PAYLOAD = 80000;
const groups = {
  header: 'Дээд цэс', footer: 'Доод хэсэг', hero: 'Эхний дэлгэц',
  services: 'Үйлчилгээ', promo: 'Урамшуулал', treatments: 'Онцлох эмчилгээ',
  about: 'Бидний тухай', process: 'Үйлчлүүлэх дараалал', reviews: 'Сэтгэгдэл',
  faq: 'Түгээмэл асуулт', blog: 'Зөвлөгөө', contact: 'Холбоо барих', cta: 'Цаг захиалах уриалга', other: 'Бусад мэдээлэл',
};
const attrs = { map: 'Google Maps холбоос', position: 'Дараалал (0 бол нуух)', title: 'Тайлбар', src: 'Зураг', alt: 'Зургийн тайлбар', href: 'Холбоос', placeholder: 'Талбарын жишээ', content: 'Хайлтын мэдээлэл' };
const shared = 'header.header,footer.footer,.drawer,.mobile-bar';
const textLabels = { H1: 'Үндсэн гарчиг', H2: 'Гарчиг', H3: 'Дэд гарчиг', P: 'Тайлбар', A: 'Холбоосын нэр', BUTTON: 'Товчны нэр', TITLE: 'Хуудасны гарчиг' };
const skip = 'script,style,svg,noscript,template,[data-home],#treatList,#treatChips,[data-site],[data-count],#faq .faq__item,#ub-done,#ub-alert,#ub-service,#ub-slots,.form__ok,.sr-only,[data-pack-count],[data-pack] h3,.pack__price strong';
const htmlSpace = /[\t\n\r ]+/g;
const clean = (s) => s.replace(htmlSpace, ' ').trim();
function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
export function safeValue(kind, value) {
  if (typeof value !== 'string' || value.length > MAX_VALUE) return false;
  if (kind === 'position') return /^(?:0|[1-9]\d?)$/.test(value);
  if (kind === 'map') {
    try {
      const url = new URL(value);
      return ['https://maps.google.com', 'https://www.google.com'].includes(url.origin) &&
        !url.username && !url.password && (url.pathname === '/maps/embed' ||
          (url.pathname === '/maps' && url.searchParams.get('output') === 'embed'));
    } catch { return false; }
  }
  if (kind !== 'src' && kind !== 'href') return true;
  if (!value || /[\s\\<>"']/u.test(value) || value.startsWith('//')) return false;
  if (kind === 'src' && /^\/?assets\/img\/[\w./-]+(?:\?v=[a-f\d]+)?$/i.test(value)) {
    return !value.split('/').includes('..');
  }
  if (kind === 'href' && /^(?:#|\/(?!\/)|mailto:|tel:)/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

export function contentFields(doc, path, { includeCommon = false } = {}) {
  const fields = [];
  const occurrences = new Map();
  const positions = new Map();
  const add = (el, kind, raw, apply) => {
    const common = Boolean(el.closest(shared));
    if (common && path !== '/' && !includeCommon) return;
    const value = common && kind === 'href' ? clean(raw).replace(/^\/#/, '#') : clean(raw);
    if (!value && kind !== 'alt') return;
    const region = el.closest(shared + ',section[id],.hero,.section--tight');
    const group = el.closest('head') ? 'Хайлтын мэдээлэл' :
      groups[region?.id] || groups[region?.tagName.toLowerCase()] ||
      (common ? groups.header : region?.classList.contains('hero') ? groups.hero : region?.classList.contains('section--tight') ? groups.cta : groups.other);
    const card = el.closest('.svc,.about__media,.testi,.step,.pack,.feat');
    const special = el.matches('.svc--featured img') ? 'Эмчийн үзлэг, оношлогооны зураг' :
      el.matches('.about__img-sub img') ? 'Бидний тухай · Жижиг зураг' :
      el.matches('.about__img-main img') ? 'Бидний тухай · Үндсэн зураг' : null;
    const context = special || card?.querySelector('h3,.testi__tag')?.textContent.trim();
    const label = [context, attrs[kind] || textLabels[el.tagName] || 'Бичвэр'].filter(Boolean).join(' · ');
    // Keep photo overrides when a developer replaces the underlying static photo file.
    const signature = special ? special : value;
    const sig = hash([group, kind, el.tagName, signature].join('\0'));
    const nth = occurrences.get(sig) || 0;
    occurrences.set(sig, nth + 1);
    fields.push({
      id: sig + '-' + nth, group, label, kind, value, common,
      apply(next) { apply(common && path !== '/' && kind === 'href' && next.startsWith('#') ? '/' + next : next); },
    });
  };
  const selectors = [...shared.split(','), 'title', 'meta[name="description"],meta[property="og:title"],meta[property="og:description"],meta[property="og:image"]'];
  // Эмчээр баталгаажсан хуудсын үндсэн агуулгыг нийтлэх урсгалаар нь засна.
  if (!path.startsWith('/emchilgee/') || path === '/emchilgee/') selectors.push('main');
  for (const el of doc.querySelectorAll(selectors.map(s => s + ', ' + s + ' *').join(', '))) {
    if (el.closest(skip)) continue;
    if (el.matches('img[src]')) {
      add(el, 'src', el.getAttribute('src'), (value) => {
        el.removeAttribute('srcset');
        el.setAttribute('src', value);
      });
      add(el, 'alt', el.getAttribute('alt') || '', (value) => el.setAttribute('alt', value));
    }
    if (el.matches('.map iframe[src]')) {
      add(el, 'map', el.getAttribute('src'), (value) => el.setAttribute('src', value));
      add(el, 'title', el.getAttribute('title') || '', (value) => el.setAttribute('title', value));
    }
    if (el.matches('.bento > .svc,.testi-grid > .testi,.steps > .step,.feats > .feat')) {
      if (!positions.has(el.parentElement)) positions.set(el.parentElement, []);
      const siblings = positions.get(el.parentElement);
      const item = { el, position: siblings.length + 1 };
      siblings.push(item);
      add(el, 'position', String(item.position), (value) => { item.position = Number(value); });
    }
    if (el.matches('a[href]')) add(el, 'href', el.getAttribute('href'), (value) => el.setAttribute('href', value));
    if (el.hasAttribute('placeholder')) add(el, 'placeholder', el.getAttribute('placeholder'), (value) => el.setAttribute('placeholder', value));
    if (el.matches('meta[content]')) add(el, el.matches('[property="og:image"]') ? 'src' : 'content', el.getAttribute('content'), (value) => el.setAttribute('content', value));
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !clean(node.data)) continue;
      const prefix = node.data.match(/^\s*/)[0];
      const suffix = node.data.match(/\s*$/)[0];
      add(el, 'text', node.data, (value) => { node.data = prefix + value + suffix; });
    }
  }
  return Object.assign(fields, { positions });
}

export function parseContent(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_PAYLOAD) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function applyContent(fields, overrides) {
  for (const field of fields) {
    if (!Object.hasOwn(overrides, field.id)) continue;
    const value = overrides[field.id];
    if (value !== field.value && safeValue(field.kind, value)) field.apply(value);
  }
  for (const [parent, items] of fields.positions || []) {
    if (!items.some((item, i) => item.position !== i + 1)) continue;
    const ordered = [...items].sort((a, b) => a.position - b.position);
    for (const { el, position } of ordered) {
      el.hidden = position === 0;
      parent.append(el);
    }
  }
}

export function pageKey(path) {
  const cleanPath = path.replace(/\/(?:index\.html)?$/, '');
  return cleanPath ? cleanPath.slice(1).replaceAll('/', '~') : 'home';
}

export const FAQ_KEY = 'faq-items';

export function faqItems(doc) {
  return [...doc.querySelectorAll('#faq .faq__item')].map((item) => ({
    question: clean([...item.querySelector('.faq__q').childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join(' ')),
    answer: clean(item.querySelector('.faq__a').textContent),
    hidden: false,
  }));
}

export function validFaq(items) {
  return Array.isArray(items) && items.length <= 30 && items.every((item) =>
    item && typeof item.question === 'string' && item.question.trim().length > 0 && item.question.length <= 240 &&
    typeof item.answer === 'string' && item.answer.trim().length > 0 && item.answer.length <= MAX_VALUE &&
    typeof item.hidden === 'boolean');
}

export function applyFaq(doc, items) {
  if (!validFaq(items)) return;
  const list = doc.querySelector('#faq .faq');
  const template = list?.querySelector('.faq__item');
  if (!template) return;
  const visible = items.filter((item) => !item.hidden);
  list.replaceChildren(...visible.map((item, i) => {
    const row = template.cloneNode(true);
    const button = row.querySelector('.faq__q');
    const answer = row.querySelector('.faq__a p');
    for (const node of [...button.childNodes]) if (node.nodeType === 3) node.remove();
    button.prepend(doc.createTextNode(item.question));
    answer.textContent = item.answer;
    row.classList.toggle('is-open', i === 0);
    button.setAttribute('aria-expanded', String(i === 0));
    return row;
  }));
}

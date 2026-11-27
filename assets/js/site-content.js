/* Public content fields shared by the editor and the site. Text is never parsed as HTML. */
export const MAX_VALUE = 2000;
export const MAX_PAYLOAD = 80000;
const groups = {
  header: 'Дээд цэс', footer: 'Доод хэсэг', hero: 'Эхний дэлгэц',
  services: 'Үйлчилгээ', promo: 'Урамшуулал', treatments: 'Онцлох эмчилгээ',
  about: 'Бидний тухай', videos: 'Видео бичлэг', process: 'Үйлчлүүлэх дараалал', reviews: 'Сэтгэгдэл',
  faq: 'Түгээмэл асуулт', blog: 'Зөвлөгөө', contact: 'Холбоо барих', cta: 'Цаг захиалах уриалга', other: 'Бусад мэдээлэл',
};
const attrs = { map: 'Google Maps холбоос', position: 'Дараалал (0 бол нуух)', title: 'Тайлбар', src: 'Зураг', alt: 'Зургийн тайлбар', href: 'Холбоос', placeholder: 'Талбарын жишээ', content: 'Хайлтын мэдээлэл' };
const shared = 'header.header,footer.footer,.drawer,.mobile-bar';
const textLabels = { H1: 'Үндсэн гарчиг', H2: 'Гарчиг', H3: 'Дэд гарчиг', P: 'Тайлбар', A: 'Холбоосын нэр', BUTTON: 'Товчны нэр', TITLE: 'Хуудасны гарчиг' };
const skip = 'script,style,svg,noscript,template,[data-home],#treatList,#treatChips,[data-site],[data-count],#faq .faq__item,[data-videos],#ub-done,#ub-alert,#ub-service,#ub-slots,.form__ok,.sr-only,[data-pack-count],[data-pack] h3,.pack__price strong';
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
  const add = (el, kind, raw, apply, node = null) => {
    const common = Boolean(el.closest(shared));
    if (common && path !== '/' && !includeCommon) return;
    if (!common && /^\/emchilgee\/[^/]+/.test(path)) return;
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
    const label = [context, el.dataset.contentLabel || attrs[kind] || textLabels[el.tagName] || 'Бичвэр'].filter(Boolean).join(' · ');
    // Keep photo overrides when a developer replaces the underlying static photo file.
    const signature = special ? special : value;
    const sig = hash([group, kind, el.tagName, signature].join('\0'));
    const occurrenceKey = (common ? 'common' : 'page') + sig;
    const nth = occurrences.get(occurrenceKey) || 0;
    occurrences.set(occurrenceKey, nth + 1);
    fields.push({
      id: sig + '-' + nth,
      group: path === '/' && el.closest('.marquee') ? 'Технологийн мөр' :
        path === '/' && el.closest('.booking') ? 'Захиалгын маягт' :
        path === '/' && el.closest('#treatments') && el.closest('.scroller-wrap') === null && el.closest('.container')?.querySelector('#treatList') ? 'Үйлчилгээний жагсаалт' : group,
      label, kind, value, common, el,
      remember() {
        const entries = JSON.parse(el.getAttribute('data-content-original') || '[]');
        if (node) entries.push({ index: [...el.childNodes].indexOf(node), text: node.data });
        else if (kind !== 'position') {
          const attr = el.tagName === 'META' ? 'content' : kind === 'map' ? 'src' : kind;
          entries.push({ attr, value: el.getAttribute(attr) });
          if (kind === 'src' && el.hasAttribute('srcset')) entries.push({ attr: 'srcset', value: el.getAttribute('srcset') });
        }
        if (entries.length) el.setAttribute('data-content-original', JSON.stringify(entries));
      },
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
      add(el, 'text', node.data, (value) => { node.data = prefix + value + suffix; }, node);
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

export function applyContent(fields, overrides, remember = false) {
  for (const field of fields) {
    if (!Object.hasOwn(overrides, field.id)) continue;
    const value = overrides[field.id];
    if (value !== field.value && safeValue(field.kind, value)) {
      if (remember) field.remember();
      field.apply(value);
    }
  }
  for (const [parent, items] of fields.positions || []) {
    if (!items.some((item, i) => item.position !== i + 1)) continue;
    if (remember) [...parent.children].forEach((el, index) => el.dataset.contentOrder = String(index));
    const ordered = [...items].sort((a, b) => a.position - b.position);
    const tail = [...parent.children].find(node => !items.some(item => item.el === node));
    for (const { el, position } of ordered) {
      el.hidden = position === 0;
      parent.insertBefore(el, tail || null);
    }
  }
}

export function pageKey(path) {
  if (path === '/404.html') return '404';
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
  if (!list) return;
  const visible = items.filter((item) => !item.hidden);
  list.replaceChildren(...visible.map((item, i) => {
    const row = template ? template.cloneNode(true) : doc.createElement('div');
    if (!template) {
      row.className = 'faq__item';
      row.innerHTML = '<button type="button" class="faq__q"><span class="plus" aria-hidden="true">+</span></button><div class="faq__a"><div><p></p></div></div>';
    }
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

export const VIDEO_KEY = 'video-items';

/** YouTube холбоосоос бичлэгийн ID (watch?v=, youtu.be/, shorts/, embed/, live/) — танихгүй бол null */
export function youtubeId(value) {
  if (typeof value !== 'string' || value.length > 200) return null;
  let url;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.replace(/^(?:www|m|music)\./, '');
  const id = host === 'youtu.be' ? url.pathname.slice(1).split('/')[0] :
    host === 'youtube.com' || host === 'youtube-nocookie.com' ?
      (url.pathname === '/watch' ? url.searchParams.get('v') : (url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/) || [])[1]) : null;
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export function validVideos(items) {
  return Array.isArray(items) && items.length <= 12 && items.every((item) =>
    item && youtubeId(item.url) !== null && typeof item.title === 'string' && item.title.length <= 120 &&
    typeof item.hidden === 'boolean');
}

/** «Видео бичлэг» хэсэг: бичлэг байвал харагдана, үгүй бол нуугдана. Зураг дээр дарахад main.js тоглуулагчийг нээнэ. */
export function applyVideos(doc, items) {
  const section = doc.querySelector('#videos');
  const grid = section?.querySelector('[data-videos]');
  if (!grid) return;
  const visible = validVideos(items) ? items.filter((item) => !item.hidden) : [];
  grid.replaceChildren(...visible.map((item) => {
    const id = youtubeId(item.url);
    const title = item.title.trim();
    const card = doc.createElement('a');
    card.className = /\/shorts\//.test(item.url) ? 'video video--short' : 'video';
    card.setAttribute('href', 'https://www.youtube.com/watch?v=' + id);
    card.setAttribute('target', '_blank');
    card.setAttribute('rel', 'noopener');
    card.setAttribute('data-video-id', id);
    card.setAttribute('aria-label', (title || 'Видео бичлэг') + ' — тоглуулах');
    const img = doc.createElement('img');
    img.setAttribute('src', 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg');
    img.setAttribute('alt', '');
    img.setAttribute('loading', 'lazy');
    img.setAttribute('referrerpolicy', 'no-referrer');
    const play = doc.createElement('span');
    play.className = 'video__play';
    play.setAttribute('aria-hidden', 'true');
    card.append(img, play);
    if (title) {
      const caption = doc.createElement('span');
      caption.className = 'video__title';
      caption.textContent = title;
      card.append(caption);
    }
    return card;
  }));
  section.hidden = !visible.length;
}

// Additional cards share the existing section grid and its original cards.
export const cardLists = [
  { key: 'service-cards', group: groups.services, name: 'Үйлчилгээний карт', grid: '.bento', item: '.svc',
    fields: [['title', 'Гарчиг'], ['text', 'Тайлбар'], ['url', 'Холбоос'], ['cta', 'Товчны нэр'], ['image', 'Зураг', true], ['alt', 'Зургийн тайлбар', true]] },
  { key: 'review-cards', group: groups.reviews, name: 'Сэтгэгдэл', grid: '.testi-grid', item: '.testi',
    fields: [['title', 'Үйлчилгээний нэр'], ['text', 'Сэтгэгдэл'], ['author', 'Нэр'], ['source', 'Эх сурвалж', true]] },
];

export function validCards(list, rows) {
  return Array.isArray(rows) && rows.length <= 30 && rows.every(row =>
    row && typeof row.hidden === 'boolean' && Number.isSafeInteger(row.position) && row.position >= 1 && row.position <= 99 &&
    list.fields.every(([key, , optional]) => typeof row[key] === 'string' &&
      (optional && row[key] === '' || row[key].trim() && safeValue(key === 'url' ? 'href' : key === 'image' ? 'src' : 'text', row[key]))));
}

export function applyCards(doc, list, rows) {
  const grid = doc.querySelector(list.grid);
  if (!grid || !validCards(list, rows)) return;
  grid.querySelectorAll('[data-added-card]').forEach(el => el.remove());
  const base = [...grid.children].filter(el => el.matches(list.item) && !el.hidden);
  const tail = [...grid.children].find(el => !el.matches(list.item)) || null;
  const visible = rows.filter(row => !row.hidden).sort((a, b) => a.position - b.position);
  const make = (tag, cls, text) => {
    const el = doc.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    return el;
  };
  let lastSlot = 0;
  visible.forEach((row, i) => {
    let card;
    if (list.key === 'service-cards') {
      card = make('a', row.image ? 'svc svc--featured' : 'svc');
      card.setAttribute('href', row.url);
      if (row.image) {
        const img = make('img');
        img.setAttribute('src', row.image);
        img.setAttribute('alt', row.alt);
        img.loading = 'lazy';
        card.append(img);
      }
      card.append(make('h3', '', row.title), make('p', '', row.text), make('span', 'link-arrow', row.cta));
    } else {
      card = make('article', 'testi');
      const who = make('div', 'testi__who');
      const by = make('div');
      by.append(make('strong', '', row.author), make('span', '', row.source));
      who.append(make('span', 'avatar', [...row.author.trim()][0]), by);
      card.append(make('span', 'testi__tag', row.title), make('p', '', row.text), who);
    }
    card.dataset.addedCard = '';
    lastSlot = Math.max(lastSlot, row.position - 1 - i);
    grid.insertBefore(card, base[lastSlot] || tail);
  });
}

export function renderPublicContent(doc, path, values, common, remember = false) {
  const home = pageKey(path) === 'home';
  const fields = contentFields(doc, home ? '/' : path, { includeCommon: true });
  const changes = home ? values : Object.fromEntries(fields.flatMap(field => {
    const record = field.common ? common : values;
    return Object.hasOwn(record, field.id) ? [[field.id, record[field.id]]] : [];
  }));
  applyContent(fields, changes, remember);
  if (home) {
    for (const list of cardLists) applyCards(doc, list, values[list.key]);
    applyVideos(doc, values[VIDEO_KEY]);
    if (validFaq(values[FAQ_KEY])) {
      const faq = doc.querySelector('#faq .faq');
      if (remember && faq) {
        const original = doc.createElement('template');
        original.dataset.contentFaq = '';
        original.innerHTML = faq.innerHTML;
        faq.after(original);
      }
      applyFaq(doc, values[FAQ_KEY]);
    }
  }
}

// Only remove baked changes when a newer record arrives. An unavailable read keeps the snapshot.
export function restoreContent(doc) {
  for (const el of doc.querySelectorAll('[data-content-original]')) {
    for (const item of JSON.parse(el.dataset.contentOriginal)) {
      if ('index' in item) {
        const node = el.childNodes[item.index];
        if (node?.nodeType === 3) node.data = item.text;
        else el.insertBefore(doc.createTextNode(item.text), node || null);
      } else if (item.value === null) el.removeAttribute(item.attr);
      else el.setAttribute(item.attr, item.value);
    }
    el.removeAttribute('data-content-original');
  }
  doc.querySelectorAll('[data-added-card]').forEach(el => el.remove());
  applyVideos(doc, []);
  for (const parent of new Set([...doc.querySelectorAll('[data-content-order]')].map(el => el.parentElement))) {
    for (const el of [...parent.children].sort((a, b) => Number(a.dataset.contentOrder) - Number(b.dataset.contentOrder))) {
      el.removeAttribute('data-content-order');
      if (el.matches('.svc,.testi,.step,.feat')) el.hidden = false;
      parent.append(el);
    }
  }
  const faq = doc.querySelector('template[data-content-faq]');
  if (faq) {
    doc.querySelector('#faq .faq').replaceChildren(faq.content.cloneNode(true));
    faq.remove();
  }
}

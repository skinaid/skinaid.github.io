/* ==========================================================================
   SKIN AID — admin/m-content.js («Нүүр хуудас» засварлагч)
   Нүүр хуудасны зочдод харагддаг бүх хэсгийн бичвэр, зураг, холбоос → public_content/home.
   Зүүн талд: хэсгүүд (нэг нь нээлттэй) + талбарууд. Баруун талд: сайтын шууд харагдац (утас / компьютер).
   Талбарт бичих бүрд харагдац шинэчлэгдэнэ; талбарт фокуслахад харагдац дээр тэр хэсэг тодорно;
   харагдац дээр дарахад засах талбар нь нээгдэнэ. Зураг: файл сонгох эсвэл чирж оруулах (image-upload.js).
   Өгөгдлийн хэлбэр, шалгалт, сайтад хэрэглэх логик = assets/js/site-content.js (өөрчлөгдөөгүй).
   ========================================================================== */
import { uploadControl, openPhotoPicker, setImageValue, queueImage, imagePreview, queuedImages, writeImages, clearImageUploads } from './image-upload.js?v=bf8c90c8';
import { doc, getDocFromServer, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { $, $$, db, session, errText } from './core.js?v=2c361933';
import { registerForm, refreshDirty, snack, dialog } from './ui.js?v=720127aa';
import { contentFields, parseContent, safeValue, pageKey, MAX_PAYLOAD, MAX_VALUE, FAQ_KEY, faqItems, validFaq, VIDEO_KEY, MAX_VIDEOS, youtubeId, localVideo, videoPoster, videoItems, validVideos, applyVideos, applyContent, applyFaq, cardLists, validCards, applyCards, restoreContent } from '../assets/js/site-content.js?v=252ed684';
import { findClaims } from './claims.js?v=b71d5c91';

const PATH = '/';
const form = $('#contentForm');
const sections = $('#contentSections');
const status = $('#contentStatus');
const saveButton = $('#contentSave');
const discardButton = $('#contentDiscard');
const retry = $('#contentRetry');
const search = $('#contentSearch');
const searchNote = $('#contentSearchNote');
const previewBox = $('#contentPreviewBox');
const stage = $('#contentStage');
const frame = $('#contentFrame');

let fields = [];
let baseline = {};
let draft = {};
let original = null;
const faqList = { key: FAQ_KEY, group: 'Түгээмэл асуулт', name: 'Асуулт', fields: [['question', 'Асуулт'], ['answer', 'Хариулт']] };
const videoList = { key: VIDEO_KEY, group: 'Видео бичлэг', name: 'Бичлэг', fields: [['url', 'Бичлэг (сайтын бичлэг эсвэл YouTube холбоос)'], ['title', 'Гарчиг', true]] };
/** Жагсаалт бүрийн шалгалт (site-content.js) */
const validOf = (spec) => spec === faqList ? validFaq : spec === videoList ? validVideos : (items) => validCards(spec, items);
let lists = [];
let listDefaults = {};
let sourceDoc = null;
let ready = false;
let loading = false;
let saving = false;
let generation = 0;
/** id → { field, row, input, reset, section } */
const rows = new Map();
/** Гүйдэг мөрийн давхар хуулбар (aria-hidden): нэг талбараар хоёуланг нь засна. id → [давхар талбар] */
const twins = new Map();
/** хэсгийн нэр → { el: details, badge, first: эхний талбарын id, lists: [spec] } */
const groups = new Map();

/** Өөр цэсээс засдаг хэсгүүд — тухайн хэсгийн дотор холбоосоор заана */
const ELSEWHERE = {
  'Эхний дэлгэц': ['#/home/hero', 'Гарчиг, тайлбар, товч, тоон үзүүлэлтийг «Эхний баннер» засварлагчаас засна'],
  'Зөвлөгөө': ['#/home/hero', 'Зөвлөгөөний картуудыг «Эхний баннер ба зөвлөгөөний карт» засварлагчаас засна'],
  'Үйлчилгээний жагсаалт': ['#/catalog', 'Үйлчилгээний нэр, үнийг «Үйлчилгээ / Багц» цэсээс засна'],
  'Урамшуулал': ['#/catalog', 'Багцын нэр, үнийг «Үйлчилгээ / Багц» цэсээс засна'],
  'Холбоо барих': ['#/settings', 'Утас, имэйл, ажлын цагийг «Тохиргоо» цэсээс засна'],
};
const PRIMARY = new Set(['text', 'src']);
const SITE_CARD = '.svc,.testi,.step,.pack,.feat';
const EXTRA_NAME = { href: 'холбоос', alt: 'зургийн тайлбар', placeholder: 'талбарын жишээ', title: 'тайлбар', map: 'газрын зураг', position: 'дараалал', content: 'хайлтын мэдээлэл' };

const valueOf = (field, values) => Object.hasOwn(values, field.id) ? values[field.id] : field.value;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const listValue = (values, spec) => values[spec.key] ?? listDefaults[spec.key];
const listDirty = (spec) => !same(listValue(draft, spec), listValue(baseline, spec));
const fieldDirty = (field) => valueOf(field, draft) !== valueOf(field, baseline);
const dirty = () => ready && (lists.some(listDirty) || fields.some(fieldDirty));
const ref = doc(db, 'public_content', pageKey(PATH));
const message = (text) => { status.textContent = text; };
const lock = () => {
  sections.inert = !ready || saving;
  search.disabled = !ready;
  saveButton.disabled = !ready || saving;
  retry.disabled = loading || saving;
};
const photos = window.SKINAID_HOME_DATA?.photos || [];
for (const photo of photos) $('#contentPhotos').append(new Option('/' + photo.replace(/^\//, '')));
for (const video of window.SKINAID_HOME_DATA?.videos || []) $('#contentVideos').append(new Option(video));

function make(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}
function button(label, action, disabled = false, cls = 'btn btn--outline btn--sm') {
  const el = make('button', cls, label);
  el.type = 'button';
  el.disabled = disabled;
  el.addEventListener('click', action);
  return el;
}
const openAll = (el) => { for (let d = el.closest('details'); d; d = d.parentElement.closest('details')) d.open = true; };

/* ---------- Шууд харагдац (iframe) ---------- */
const PREVIEW_CSS = `
  html { scroll-behavior: auto !important; }
  .reveal, .reveal.is-pending { opacity: 1 !important; transform: none !important; }
  [data-ed] { cursor: pointer; }
  [data-ed]:hover { outline: 2px dashed #9674b8; outline-offset: 3px; }
  [data-ed-on] { outline: 3px solid #c9a46a !important; outline-offset: 3px; border-radius: 4px; }
  .ce-map { display: grid; place-items: center; min-height: 220px; background: #ede6f5; color: #4a4356; font: 600 14px system-ui; border-radius: 20px; }
`;
let frameReady = null;
let previewEls = new Map();
let activeId = null;
let previewTimer = 0;
let device = 'phone';
let focusing = false;   // focusField ажиллаж байна — хэсэг нээгдэхэд эхний талбар руу үсрэхгүй

function initFrame() {
  if (frameReady) return frameReady;
  const id = generation;
  frameReady = new Promise((resolve) => {
    const head = sourceDoc.head.cloneNode(true);
    head.querySelectorAll('script,link:not([rel="stylesheet"]),base,meta[http-equiv],noscript').forEach((el) => el.remove());
    // Фонтын «media=print + onload» заль скриптгүй орчинд ажиллахгүй — шууд идэвхжүүлнэ
    for (const link of head.querySelectorAll('link[onload]')) { link.removeAttribute('onload'); link.setAttribute('media', 'all'); }
    const root = sourceDoc.documentElement.cloneNode(false);
    root.innerHTML = '<head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'; object-src \'none\'; frame-src \'none\'">' +
      '<base href="' + new URL(PATH, location.origin).href + '">' + head.innerHTML + '<style>' + PREVIEW_CSS + '</style></head><body></body>';
    frame.addEventListener('load', () => {
      if (id !== generation) return;
      const fdoc = frame.contentDocument;
      // Харагдац дээр дарахад: холбоос нээхгүй, харин засах талбар руу очно
      fdoc.addEventListener('click', (event) => {
        event.preventDefault();
        let node = event.target.nodeType === 1 ? event.target : event.target.parentElement;
        let hit = node?.closest('[data-ed]');
        for (; node && !hit; node = node.parentElement) hit = node.querySelector('[data-ed]');
        if (hit) focusField(hit.dataset.ed, { fromPreview: true });
      });
      fdoc.addEventListener('submit', (event) => event.preventDefault());
      resolve();
    }, { once: true });
    frame.srcdoc = '<!doctype html>' + root.outerHTML;
  });
  return frameReady;
}

async function renderPreview() {
  clearTimeout(previewTimer);
  if (!ready || !sourceDoc) return;
  const id = generation;
  await initFrame();
  if (id !== generation || !ready) return;
  const copy = sourceDoc.cloneNode(true);
  const copyFields = contentFields(copy, PATH);
  const els = new Map();
  for (const field of copyFields) {
    els.set(field.id, field.el);
    if (PRIMARY.has(field.kind) && !field.el.closest('head') && !field.el.dataset.ed) field.el.dataset.ed = field.id;
  }
  applyContent(copyFields, draft);
  for (const list of cardLists) applyCards(copy, list, draft[list.key]);
  if (draft[FAQ_KEY]) applyFaq(copy, draft[FAQ_KEY]);
  applyVideos(copy, (listValue(draft, videoList) || []).filter((item) => validVideos([item])));   // бичиж дуусаагүй мөрийг алгасна
  for (const img of copy.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src');
    const local = imagePreview(src);
    if (local !== src) { img.removeAttribute('srcset'); img.setAttribute('src', local); }
  }
  const booking = copy.querySelector('#ubForm');
  const intro = booking?.querySelector('[data-ub-intro]'), introCopy = booking?.querySelector('[data-ub-copy="pending_payment"]');
  if (intro && introCopy) intro.textContent = introCopy.textContent;
  const submit = booking?.querySelector('button[type="submit"]'), submitCopy = booking?.querySelector('[data-ub-submit="pending_payment"]');
  if (submit && submitCopy) submit.textContent = submitCopy.textContent;
  for (const map of copy.querySelectorAll('.map iframe')) {
    const stub = copy.createElement('div');
    stub.className = 'ce-map';
    stub.textContent = 'Google Maps газрын зураг энд харагдана';
    map.replaceWith(stub);
  }
  copy.body.querySelectorAll('script,iframe,noscript,template').forEach((el) => el.remove());
  const fdoc = frame.contentDocument, win = frame.contentWindow;
  if (!fdoc || !win) return;
  const y = win.scrollY;
  fdoc.documentElement.replaceChild(fdoc.adoptNode(copy.body), fdoc.body);
  win.scrollTo(0, y);
  previewEls = els;
  markActive(false);
}
const schedulePreview = () => { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 180); };

/** Харагдац дээр идэвхтэй талбарын элементийг тодруулна; scroll — харагдахгүй байвал гүйлгэнэ */
function markActive(scroll) {
  const fdoc = frame.contentDocument, win = frame.contentWindow;
  if (!fdoc || !win) return;
  fdoc.querySelectorAll('[data-ed-on]').forEach((el) => el.removeAttribute('data-ed-on'));
  const el = activeId && previewEls.get(activeId);
  if (!el || !el.isConnected || el.closest('head')) return;
  el.setAttribute('data-ed-on', '');
  if (!scroll) return;
  const box = el.getBoundingClientRect();
  if (!box.width && !box.height) return;   // энэ дэлгэцийн хэмжээнд нуугдсан (жишээ нь утасны цэс)
  if (box.top < 70 || box.bottom > win.innerHeight - 20) win.scrollTo({ top: Math.max(0, win.scrollY + box.top - win.innerHeight * 0.3), behavior: 'smooth' });
}
function setActive(id, scroll = true) {
  activeId = id;
  markActive(scroll);
}

function fitFrame() {
  const width = device === 'phone' ? 390 : 1280;
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  const scale = Math.min(1, w / width);
  frame.style.width = width + 'px';
  frame.style.height = Math.round(h / scale) + 'px';
  frame.style.transform = 'scale(' + scale + ')';
  frame.style.marginLeft = Math.max(0, Math.round((w - width * scale) / 2)) + 'px';
}
if (window.ResizeObserver) new ResizeObserver(fitFrame).observe(stage);
for (const b of $$('[data-device]', previewBox)) {
  b.addEventListener('click', () => {
    device = b.dataset.device;
    $$('[data-device]', previewBox).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    fitFrame();
    markActive(true);
  });
}
$('#contentPreviewToggle').addEventListener('click', (event) => {
  const collapsed = previewBox.classList.toggle('is-collapsed');
  event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
  event.currentTarget.textContent = collapsed ? 'Харах' : 'Нуух';
  if (!collapsed) fitFrame();
});

/* ---------- Талбарууд ---------- */
function updateState() {
  for (const { field, row, reset } of rows.values()) {
    row.classList.toggle('is-unsaved', fieldDirty(field));
    reset.hidden = valueOf(field, draft) === field.value;
  }
  for (const group of groups.values()) {
    const n = [...rows.values()].filter((r) => r.section === group.el && fieldDirty(r.field)).length + group.lists.filter(listDirty).length;
    group.badge.hidden = !n;
    group.badge.textContent = n + ' өөрчлөлт';
  }
  discardButton.hidden = !dirty() || saving;
  refreshDirty();
}

function fieldRow(field, section) {
  const row = make('div', 'field ce-row');
  const isImage = field.kind === 'src';
  const long = field.kind === 'text' && field.value.length > 60;
  const input = make(long ? 'textarea' : 'input');
  input.id = 'content-' + field.id;
  input.maxLength = MAX_VALUE;
  input.value = valueOf(field, draft);
  input.dataset.fid = field.id;
  if (long) input.rows = 3;
  if (field.kind === 'position') { input.type = 'number'; input.min = '0'; input.max = '99'; input.inputMode = 'numeric'; }
  if (field.kind === 'href' || field.kind === 'map') input.inputMode = 'url';
  const label = make('label', '', field.label);
  label.htmlFor = input.id;
  const reset = button('Анхны утга', () => {
    input.value = field.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
  }, false, 'btn btn--ghost btn--sm ce-row__reset');
  reset.title = 'Сайтын анхны (хөгжүүлэгчийн) утгыг буцааж тавина';
  const head = make('div', 'ce-row__head');
  head.append(label, reset);

  if (isImage) {
    row.classList.add('ce-img');
    const thumb = make('button', 'ce-img__thumb');
    thumb.type = 'button';
    thumb.setAttribute('aria-label', field.label + ' — зураг солих');
    const img = make('img');
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    thumb.append(img, make('span', 'ce-img__hint', 'Зураг солих'));
    const upload = uploadControl(input, null, { label: 'Компьютер / утаснаас зураг оруулах' });
    // Дарахад сайтын зургийн сангаас сонгох цонх (дотор нь «Компьютер / утаснаас оруулах»)
    thumb.addEventListener('click', () => openPhotoPicker({ current: input.value, title: field.label, onPick: (v) => setImageValue(input, v) }));
    const updateThumb = () => {
      const ok = safeValue('src', input.value);
      thumb.classList.toggle('is-empty', !ok);
      if (ok) img.src = new URL(imagePreview(input.value), location.origin + PATH).href;
      else img.removeAttribute('src');
    };
    input.setAttribute('list', 'contentPhotos');
    input.addEventListener('change', updateThumb);
    input.addEventListener('input', updateThumb);
    const manual = make('details', 'ce-extra');
    const inner = make('div', 'ce-extra__body');
    inner.append(input, make('p', 'hint', 'Сайтын сангийн зургийн зам (жишээ нь /assets/img/photos/…) эсвэл https:// зургийн холбоос.'));
    manual.append(make('summary', '', 'Холбоос гараар оруулах'), inner);
    const body = make('div', 'ce-img__body');
    const fromLib = button('Сангаас сонгох', () => openPhotoPicker({ current: input.value, title: field.label, onPick: (v) => setImageValue(input, v) }), false, 'btn btn--primary btn--sm');
    upload.prepend(fromLib);
    body.append(head, upload, make('p', 'hint', 'Зураг дээр дарж сангаас сонгоно. Файлаа энд чирж оруулж болно — зургийг автоматаар шахна.'), manual);
    row.append(thumb, body);
    // Чирж оруулах
    const drag = (on) => (event) => { if ([...(event.dataTransfer?.types || [])].includes('Files')) { event.preventDefault(); row.classList.toggle('is-drop', on); } };
    row.addEventListener('dragover', drag(true));
    row.addEventListener('dragleave', drag(false));
    row.addEventListener('drop', async (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      event.preventDefault();
      row.classList.remove('is-drop');
      const note = upload.querySelector('[role="status"]');
      note.textContent = 'Зураг бэлдэж байна…';
      try {
        input.value = await queueImage(file);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        note.textContent = 'Зураг бэлэн. Хадгалахад сайтад байршуулна.';
      } catch (error) { note.textContent = error.message || 'Зураг нээх боломжгүй байна.'; }
    });
    updateThumb();
  } else {
    row.append(head, input);
  }
  input.addEventListener('input', () => {
    draft[field.id] = input.value;
    for (const twin of twins.get(field.id) || []) draft[twin.id] = input.value;
    input.removeAttribute('aria-invalid');
    updateState();
  });
  rows.set(field.id, { field, row, input, reset, section });
  return row;
}

function renderList(body, spec) {
  const block = make('div', 'ce-list');
  const isFaq = spec.key === FAQ_KEY;
  const isVideo = spec === videoList;
  const ordered = isFaq || isVideo;   // дарааллыг «Дээш / Доош»-оор (картууд байрлалын тоогоор)
  block.append(make('h3', 'ce-list__title', isFaq ? 'Асуулт, хариултууд' : isVideo ? 'Бичлэгүүд' : 'Нэмэлт ' + spec.name.toLowerCase()));
  if (isVideo) block.append(make('p', 'hint', 'Сайтын бичлэгээс сонгох (талбар дээр дарахад жагсаалт гарна) эсвэл YouTube дээрх бичлэгийн холбоосыг тавина (youtube.com/watch?v=…, youtu.be/…, Shorts). «Дээш / Доош»-оор эрэмбэлж, «Сайтаас нуух»-аар түр нууна; бүгдийг нуувал хэсэг ба цэсний «Бичлэг» холбоос нуугдана. Шинэ бичлэгийн файл нэмэхийг хөгжүүлэгчид хандана.'));
  const editor = make('div');
  editor.id = 'editor-' + spec.key;
  block.append(editor);
  body.append(block);
  const redraw = (focusIndex) => {
    editor.replaceChildren();
    const items = draft[spec.key] ??= structuredClone(listDefaults[spec.key]);
    items.forEach((item, i) => {
      const row = make('fieldset', 'ce-item');
      row.append(make('legend', '', spec.name + ' ' + (i + 1)));
      const columns = ordered ? spec.fields : [...spec.fields, ['position', 'Харагдах байрлал']];
      for (const [key, label, optional] of columns) {
        const wrapper = make('label', 'field', label + (optional ? ' (заавал биш)' : ''));
        const input = make(['answer', 'text'].includes(key) ? 'textarea' : 'input');
        input.value = item[key];
        input.maxLength = key === 'question' ? 240 : isVideo ? (key === 'url' ? 200 : 120) : MAX_VALUE;
        if (key === 'image') input.setAttribute('list', 'contentPhotos');
        if (key === 'position') { input.type = 'number'; input.min = '1'; input.max = '99'; }
        let check = null;
        if (isVideo && key === 'url') {
          input.inputMode = 'url';
          input.placeholder = '/assets/video/… эсвэл https://www.youtube.com/watch?v=…';
          input.setAttribute('list', 'contentVideos');
          const thumb = make('img', 'ce-video__thumb');
          thumb.alt = '';
          thumb.referrerPolicy = 'no-referrer';
          const note = make('p', 'hint');
          check = () => {
            const id = youtubeId(input.value), local = localVideo(input.value);
            thumb.hidden = !id && !local;
            thumb.classList.toggle('is-short', !!local);
            if (local) thumb.src = videoPoster(local);
            else if (id) thumb.src = 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg';
            else thumb.removeAttribute('src');
            const bad = !id && !local && !!input.value.trim();
            note.classList.toggle('is-err', bad);
            note.textContent = bad ? 'Бичлэг танигдсангүй. Жагсаалтаас сайтын бичлэг сонгох эсвэл YouTube-ийн «Хуваалцах» холбоосыг тавина уу.' : '';
          };
          wrapper.append(input, note, thumb);
        }
        input.addEventListener('input', () => {
          item[key] = key === 'position' ? input.valueAsNumber : input.value;
          if (check) check();
          updateState();
        });
        if (check) check(); else wrapper.append(input);
        row.append(wrapper);
        if (key === 'image') {
          const up = uploadControl(input, null, { label: 'Компьютер / утаснаас зураг оруулах' });
          up.prepend(button('Сангаас сонгох', () => openPhotoPicker({ current: input.value, title: spec.name + ' ' + (i + 1) + ' · зураг', onPick: (v) => setImageValue(input, v) }), false, 'btn btn--primary btn--sm'));
          row.append(up);
        }
      }
      const hide = make('label', 'ce-item__hide');
      const checkbox = make('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.hidden;
      checkbox.addEventListener('change', () => { item.hidden = checkbox.checked; updateState(); schedulePreview(); });
      hide.append(checkbox, ' Сайтаас нуух');
      const actions = make('div', 'actions');
      actions.append(hide);
      if (ordered) {
        const move = (next) => { [items[i], items[next]] = [items[next], items[i]]; redraw(next); };
        actions.append(button('↑ Дээш', () => move(i - 1), i === 0), button('↓ Доош', () => move(i + 1), i + 1 === items.length));
      }
      actions.append(button('Устгах', () => { items.splice(i, 1); redraw(Math.min(i, items.length - 1)); }));
      row.append(actions);
      editor.append(row);
    });
    const add = button('+ ' + spec.name + ' нэмэх', () => {
      const next = Object.fromEntries(spec.fields.map(([key]) => [key, '']));
      if (!ordered) next.position = items.length + sourceDoc.querySelectorAll(spec.grid + ' > ' + spec.item).length + 1;
      if (spec.key === 'service-cards') next.cta = 'Дэлгэрэнгүй';
      items.push({ ...next, hidden: false });
      redraw(items.length - 1);
    }, items.length >= (isVideo ? MAX_VIDEOS : 30));
    const foot = make('div', 'actions');
    foot.append(add);
    if (ordered) foot.append(button(isFaq ? 'Анхны асуултуудаар дүүргэх' : 'Анхны бичлэгүүдээр дүүргэх', () => {
      draft[spec.key] = structuredClone(listDefaults[spec.key]);
      redraw(0);
    }, false, 'btn btn--ghost btn--sm'));
    editor.append(foot);
    if (focusIndex !== undefined) (editor.querySelectorAll('fieldset')[focusIndex]?.querySelector('input, textarea') || add).focus();
    updateState();
    schedulePreview();
  };
  redraw();
}

function render() {
  sections.replaceChildren();
  rows.clear();
  groups.clear();
  // Хэсгүүд хуудсан дээрх дарааллаар; хайлтын мэдээлэл (title, description) хамгийн сүүлд
  const byGroup = new Map();
  twins.clear();
  const marquee = new Map();
  for (const field of fields) {
    if (field.group === 'Технологийн мөр' && field.kind === 'text') {
      const key = field.value + '\0' + valueOf(field, draft);
      const lead = marquee.get(key);
      if (lead && field.el.closest('[aria-hidden="true"]')) { twins.set(lead.id, [...(twins.get(lead.id) || []), field]); continue; }
      if (!lead) marquee.set(key, field);
    }
    if (!byGroup.has(field.group)) byGroup.set(field.group, new Map());
    // Сайтын нэг карт (үйлчилгээ, сэтгэгдэл, алхам, багц …)-ын талбарууд нэг блокт
    const cards = byGroup.get(field.group);
    const key = field.el.closest(SITE_CARD) || field.el;
    if (!cards.has(key)) cards.set(key, []);
    cards.get(key).push(field);
  }
  for (const spec of lists) if (!byGroup.has(spec.group)) byGroup.set(spec.group, new Map());
  const names = [...byGroup.keys()].sort((a, b) => (a === 'Хайлтын мэдээлэл') - (b === 'Хайлтын мэдээлэл'));
  for (const name of names) {
    const section = make('details', 'panel ce-sec');
    const summary = make('summary');
    const badge = make('span', 'badge ce-sec__badge');
    badge.hidden = true;
    summary.append(make('span', 'ce-sec__name', name), badge);
    const body = make('div', 'ce-sec__body');
    section.append(summary, body);
    const groupLists = lists.filter((spec) => spec.group === name);
    const group = { el: section, badge, first: null, lists: groupLists };
    groups.set(name, group);
    if (ELSEWHERE[name]) {
      const [href, text] = ELSEWHERE[name];
      const note = make('a', 'ce-else', text + ' →');
      note.href = href;
      body.append(note);
    }
    for (const [key, cardFields] of byGroup.get(name)) {
      group.first ??= cardFields[0].id;
      const card = make('div', 'ce-card');
      const title = key.matches?.(SITE_CARD) && key.querySelector('h3,.testi__tag')?.textContent.trim();
      if (title) { card.classList.add('ce-card--box'); card.append(make('h3', 'ce-card__title', title)); }
      const extras = (list, target) => {
        const more = make('details', 'ce-extra');
        const inner = make('div', 'ce-extra__body');
        more.append(make('summary', '', 'Нэмэлт: ' + [...new Set(list.map((f) => EXTRA_NAME[f.kind] || 'тохиргоо'))].join(', ')), inner);
        for (const field of list) inner.append(fieldRow(field, section));
        if (list.some((f) => valueOf(f, draft) !== f.value)) more.open = true;
        target.append(more);
      };
      // Элемент бүрээр: үндсэн талбар (бичвэр, зураг) ил, түүний холбоос / зургийн тайлбар «Нэмэлт»-д
      const byEl = new Map();
      for (const field of cardFields) byEl.set(field.el, [...(byEl.get(field.el) || []), field]);
      const loose = [];
      for (const list of byEl.values()) {
        const primary = list.filter((f) => PRIMARY.has(f.kind));
        const extra = list.filter((f) => !PRIMARY.has(f.kind));
        if (!primary.length) { loose.push(...extra); continue; }
        const block = make('div', 'ce-el');
        for (const field of primary) block.append(fieldRow(field, section));
        if (extra.length) extras(extra, block);
        card.append(block);
      }
      if (loose.length && title) extras(loose, card);
      else for (const field of loose) card.append(fieldRow(field, section));
      body.append(card);
    }
    for (const spec of groupLists) renderList(body, spec);
    // Нэг удаад нэг хэсэг нээлттэй (хайлтын үед бүх тохирсон хэсэг нээгдэнэ)
    section.addEventListener('toggle', () => {
      if (!section.open) return;
      if (!search.value.trim()) for (const other of groups.values()) if (other.el !== section) other.el.open = false;
      if (group.first && !focusing && !section.contains(document.activeElement?.closest('.ce-row') || null)) setActive(group.first);
    });
    sections.append(section);
  }
  applySearch();
  updateState();
}

/** Талбарыг нээж фокуслана (харагдац дээр дарсан, эсвэл хадгалахад алдаа гарсан үед) */
function focusField(id, { fromPreview = false } = {}) {
  const entry = rows.get(id);
  if (!entry) return;
  if (entry.row.hidden || entry.section.hidden) { search.value = ''; applySearch(); }
  focusing = true;
  openAll(entry.input);
  activeId = id;
  markActive(!fromPreview);
  const target = entry.field.kind === 'src' ? entry.row.querySelector('.ce-img__thumb') : entry.input;
  // toggle үйл явдал (бусад хэсгийг хаах) дууссаны дараа гүйлгэнэ
  setTimeout(() => {
    target.focus({ preventScroll: true });
    entry.row.scrollIntoView({ block: 'center', behavior: 'instant' });
    entry.row.classList.add('is-flash');
    setTimeout(() => entry.row.classList.remove('is-flash'), 1200);
    focusing = false;
  }, 60);
}
sections.addEventListener('focusin', (event) => {
  const row = event.target.closest('.ce-row');
  const id = row && (row.querySelector('[data-fid]')?.dataset.fid);
  if (id && id !== activeId) setActive(id);
});
form.addEventListener('input', (event) => { if (event.target !== search) schedulePreview(); });

/* ---------- Хайлт ---------- */
let searching = false;
function applySearch() {
  const q = search.value.trim().toLowerCase();
  if (searching && !q) for (const group of groups.values()) group.el.open = false;   // хайлт цэвэрлэхэд хэсгүүд эвхэгдэнэ
  searching = !!q;
  let hits = 0;
  for (const { field, row, input } of rows.values()) {
    const match = !q || (field.label + ' ' + input.value).toLowerCase().includes(q);
    row.hidden = !match;
    if (match) hits++;
  }
  for (const card of $$('.ce-card, .ce-extra', sections)) {
    const inner = $$('.ce-row', card);
    if (inner.length) card.hidden = inner.every((r) => r.hidden);
    if (q && card.matches('.ce-extra') && !card.hidden) card.open = true;
  }
  for (const [name, group] of groups) {
    const nameHit = q && name.toLowerCase().includes(q);
    const any = $$('.ce-row', group.el).some((r) => !r.hidden);
    $$('.ce-list, .ce-else', group.el).forEach((el) => { el.hidden = !!q && !nameHit; });
    group.el.hidden = !!q && !any && !nameHit;
    if (q && !group.el.hidden) group.el.open = true;
  }
  searchNote.textContent = !q ? '' : hits ? hits + ' талбар олдлоо.' : 'Олдсонгүй. Сайт дээр харагдаж буй үгээр хайж үзнэ үү.';
}
search.addEventListener('input', applySearch);
search.addEventListener('keydown', (event) => { if (event.key === 'Enter') event.preventDefault(); });

/* ---------- Ачаалах / хадгалах ---------- */
export function mount() {
  if (ready) { fitFrame(); return; }
  load();
}

export async function load() {
  if (!session.user || ready || loading) return;
  const id = ++generation;
  loading = true;
  retry.hidden = true;
  sections.replaceChildren();
  message('Ачаалж байна…');
  lock();
  try {
    const [response, snapshot] = await Promise.all([fetch(PATH, { cache: 'no-cache' }), getDocFromServer(ref)]);
    if (!response.ok) throw new Error('Хуудсыг ачаалж чадсангүй.');
    const source = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (id !== generation) return;
    restoreContent(source);
    sourceDoc = source;
    fields = contentFields(source, PATH);
    original = { raw: snapshot.data()?.values ?? null };
    if (original.raw !== null) {
      const stored = JSON.parse(original.raw);
      if (!stored || typeof stored !== 'object' || Array.isArray(stored) || original.raw.length > MAX_PAYLOAD) throw new Error('content-format');
    }
    baseline = parseContent(original.raw);
    lists = [faqList, videoList, ...cardLists];
    listDefaults = Object.fromEntries(lists.map((spec) => [spec.key, spec === faqList ? faqItems(source) : spec === videoList ? videoItems(source) : []]));
    for (const spec of lists) {
      const stored = baseline[spec.key];
      if (stored !== undefined && !validOf(spec)(stored)) throw new Error('content-format');
    }
    draft = structuredClone(baseline);
    ready = true;
    render();
    fitFrame();
    renderPreview();
    message('');
  } catch (error) {
    if (id !== generation) return;
    message(error.code ? errText(error) : 'Хуудсыг ачаалж чадсангүй.');
    retry.hidden = false;
  } finally {
    if (id === generation) {
      loading = false;
      lock();
      refreshDirty();
    }
  }
}

async function save() {
  if (!dirty() || saving || !session.user) return;
  const id = generation;
  const changes = fields.filter(fieldDirty);
  const invalid = changes.find((field) => !safeValue(field.kind, valueOf(field, draft)));
  if (invalid) {
    focusField(invalid.id);
    rows.get(invalid.id).input.setAttribute('aria-invalid', 'true');
    message('Утгыг шалгана уу. Зураг болон холбоос зөвшөөрсөн хаягтай байх ёстой.');
    return;
  }
  const values = { ...baseline };
  for (const field of fields) {
    const value = valueOf(field, draft);
    if (value === field.value) delete values[field.id];
    else values[field.id] = value;
  }
  for (const spec of lists) {
    const items = listValue(draft, spec);
    const valid = validOf(spec);
    if (!valid(items)) {
      const editor = document.getElementById('editor-' + spec.key);
      search.value = '';
      applySearch();
      openAll(editor);
      const row = editor.querySelectorAll('fieldset')[items.findIndex((item) => !valid([item]))];
      setTimeout(() => { row?.scrollIntoView({ block: 'center' }); row?.querySelector('input, textarea')?.focus(); }, 30);
      message(spec === videoList ? 'Бичлэг · сайтын бичлэг эсвэл YouTube-ийн холбоосыг шалгана уу.' : spec.name + ' · Бичвэр, холбоос болон байрлалыг шалгана уу.');
      return;
    }
    if (same(items, listDefaults[spec.key])) delete values[spec.key];
    else values[spec.key] = structuredClone(items);
  }
  const raw = JSON.stringify(values);
  if (new TextEncoder().encode(raw).length > MAX_PAYLOAD) {
    message('Энэ хуудасны өөрчлөлт хадгалах хэмжээнээс хэтэрсэн байна.');
    return;
  }
  const images = queuedImages([
    ...fields.filter((field) => field.kind === 'src').map((field) => values[field.id]),
    ...cardLists.flatMap((spec) => (values[spec.key] || []).map((item) => item.image)),
  ]);
  if (images.length > 12) { message('Нэг хадгалалтаар 12 хүртэлх зураг нэмнэ үү.'); return; }
  saving = true;
  lock();
  message('Хадгалж байна…');
  try {
    const claims = changes.filter((field) => field.kind === 'text' || field.kind === 'content')
      .flatMap((field) => findClaims(valueOf(field, draft)).map((claim) => claim.label));
    for (const spec of lists) {
      const prior = listValue(baseline, spec);
      for (const row of listValue(draft, spec)) {
        if (prior.some((old) => same(old, row))) continue;
        const text = spec.fields.map(([key]) => row[key]).join(' ');
        claims.push(...findClaims(text).map((claim) => claim.label));
      }
    }
    if (claims.length && !await dialog({
      title: 'Нийтлэх бичвэрээ шалгана уу',
      body: 'Анхаарах хэллэгүүд · ' + [...new Set(claims)].join(', '),
      confirm: 'Хадгалах', cancel: 'Буцаж засах', safe: true,
    })) { message(''); return; }
    if (id !== generation || !session.user) return;
    const old = original.raw;
    await runTransaction(db, async (tx) => {
      const current = await tx.get(ref);
      if ((current.data()?.values ?? null) !== old) throw new Error('content-conflict');
      writeImages(tx, images);
      tx.set(ref, { values: raw, updatedAt: serverTimestamp() });
    });
    clearImageUploads(images);
    if (id !== generation) return;
    original.raw = raw;
    baseline = values;
    const saved = 'Хадгалагдлаа. Сайтыг дахин ачаалахад зочдод шинэ хувилбар харагдана.';
    message(saved);
    snack('Нүүр хуудас хадгалагдлаа');
  } catch (error) {
    if (id === generation) message(error.message === 'content-conflict'
      ? 'Өөр хэрэглэгч хадгалсан байна. Хуудсаа дахин ачаалахын өмнө засвараа хуулж авна уу.'
      : errText(error));
  } finally {
    if (id === generation) {
      saving = false;
      lock();
      updateState();
    }
  }
}

function discard() {
  if (saving) return;
  const open = [...groups].find(([, group]) => group.el.open)?.[0];
  draft = structuredClone(baseline);
  render();
  if (open && groups.has(open)) groups.get(open).el.open = true;
  renderPreview();
  message('');
}
discardButton.addEventListener('click', async () => {
  if (await dialog({ title: 'Өөрчлөлтийг болих уу?', body: 'Хадгалаагүй бүх засвар хамгийн сүүлд хадгалсан хувилбар руу буцна.', confirm: 'Болих', cancel: 'Үргэлжлүүлж засах', danger: true })) discard();
});
retry.addEventListener('click', load);
form.addEventListener('submit', (event) => { event.preventDefault(); save(); });
registerForm('content', {
  isDirty: dirty, save, anchor: $('#contentActions'),
  busy: () => saving ? 'Сайтын мэдээлэл хадгалж байна.' : '',
  discard,
  reset() {
    clearImageUploads();
    clearTimeout(previewTimer);
    generation++;
    ready = loading = saving = false;
    sourceDoc = null;
    original = null;
    draft = baseline = {};
    fields = [];
    lists = [];
    rows.clear();
    groups.clear();
    previewEls = new Map();
    activeId = null;
    frameReady = null;
    frame.removeAttribute('srcdoc');
    sections.replaceChildren();
    search.value = '';
    searchNote.textContent = '';
    message('');
    lock();
  },
});
lock();

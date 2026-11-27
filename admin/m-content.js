import { clinicalFields, reviewDraft } from './clinical-content.js?v=2ad415b2';
import { doc, getDocFromServer, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { $, db, session, errText } from './core.js?v=2c361933';
import { registerForm, refreshDirty, snack, dialog } from './ui.js?v=4ec734c0';
import { contentFields, parseContent, safeValue, pageKey, MAX_PAYLOAD, MAX_VALUE, FAQ_KEY, faqItems, validFaq, applyContent, applyFaq, cardLists, validCards, applyCards, restoreContent } from '../assets/js/site-content.js?v=3f4a8dce';
import { findClaims } from './claims.js?v=b71d5c91';

const form = $('#contentForm');
const page = $('#contentPage');
const sections = $('#contentSections');
const status = $('#contentStatus');
const saveButton = $('#contentSave');
const retry = $('#contentRetry');
let fields = [];
let baseline = {};
let draft = {};
let original = null;
const faqList = { key: FAQ_KEY, group: 'Түгээмэл асуулт', name: 'Асуулт', fields: [['question', 'Асуулт'], ['answer', 'Хариулт']] };
let lists = [];
let listDefaults = {};
let sourceDoc;
let ready = false;
let loading = false;
let saving = false;
let generation = 0;

const valueOf = (field, values) => Object.hasOwn(values, field.id) ? values[field.id] : field.value;
const sameFaq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const listValue = (values, spec) => values[spec.key] ?? listDefaults[spec.key];
const dirty = () => ready && (lists.some(spec => !sameFaq(listValue(draft, spec), listValue(baseline, spec))) ||
  fields.some((field) => valueOf(field, draft) !== valueOf(field, baseline)));
const clinicalSources = window.SKINAID_CLINICAL_SOURCES || {};
const clinicalSource = path => path.startsWith('draft:') ? clinicalSources[path.slice(6)] : null;
const refFor = path => clinicalSource(path) ? doc(db, 'clinical_drafts', path.slice(6)) : doc(db, 'public_content', pageKey(path));
const preview = $('#contentPreviewBox');
const previewButton = $('#contentPreview');
const exportButton = $('#clinicalExport');
function clearPreview() { preview.replaceChildren(); preview.hidden = true; }
const message = (text) => { status.textContent = text; };
const lock = () => {
  sections.inert = !ready || saving;
  $('#contentShortcuts').hidden = !ready || saving || page.value !== '/';
  saveButton.disabled = !ready || saving;
  previewButton.disabled = !ready || saving;
  const stale = original?.path === page.value && original.storedBase && original.base !== original.storedBase;
  exportButton.hidden = !(ready || stale) || !clinicalSource(page.value);
  exportButton.disabled = !(ready || stale) || saving;
  saveButton.textContent = clinicalSource(page.value) ? 'Ноорог хадгалах' : 'Хадгалах';
  page.disabled = loading || saving;
  retry.disabled = loading || saving;
};
const pageOptions = window.SKINAID_CONTENT_PAGES || [{ path: '/', label: 'Нүүр хуудас' }];
for (const entry of pageOptions.filter(p => !/^\/emchilgee\/[^/]+/.test(p.path))) page.add(new Option(entry.label, entry.path));
const planned = document.createElement('optgroup');
planned.label = 'Эмчээр хянуулах ноорог';
for (const [slug, source] of Object.entries(clinicalSources)) planned.append(new Option(source.h1, 'draft:' + slug));
page.append(planned);
const photos = window.SKINAID_HOME_DATA?.photos || [];
const options = $('#contentPhotos');
for (const photo of photos) options.append(new Option('/' + photo.replace(/^\//, '')));

function button(label, action, disabled = false) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'btn btn--outline btn--sm';
  el.textContent = label;
  el.disabled = disabled;
  el.addEventListener('click', action);
  return el;
}

function renderList(group, spec) {
  const editor = document.createElement('div');
  editor.id = 'editor-' + spec.key;
  group.append(editor);
  const isFaq = spec.key === FAQ_KEY;
  const redraw = (focusIndex) => {
    editor.replaceChildren();
    const items = draft[spec.key] ??= structuredClone(listDefaults[spec.key]);
    items.forEach((item, i) => {
      const row = document.createElement('fieldset');
      row.className = 'content-field';
      const legend = document.createElement('legend');
      legend.textContent = spec.name + ' ' + (i + 1);
      row.append(legend);
      const columns = isFaq ? spec.fields : [...spec.fields, ['position', 'Харагдах байрлал']];
      for (const [key, label, optional] of columns) {
        const wrapper = document.createElement('label');
        wrapper.className = 'field';
        wrapper.textContent = label + (optional ? ' (заавал биш)' : '');
        const input = document.createElement(['answer', 'text'].includes(key) ? 'textarea' : 'input');
        input.value = item[key];
        input.maxLength = key === 'question' ? 240 : MAX_VALUE;
        if (key === 'image') input.setAttribute('list', 'contentPhotos');
        if (key === 'position') {
          input.type = 'number';
          input.min = '1';
          input.max = '99';
        }
        input.addEventListener('input', () => {
          item[key] = key === 'position' ? input.valueAsNumber : input.value;
          refreshDirty();
        });
        wrapper.append(input);
        row.append(wrapper);
      }
      const hide = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.hidden;
      checkbox.addEventListener('change', () => { item.hidden = checkbox.checked; refreshDirty(); });
      hide.append(checkbox, ' Сайтаас нуух');
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.append(hide);
      if (isFaq) {
        const move = (next) => { [items[i], items[next]] = [items[next], items[i]]; redraw(next); };
        actions.append(button('Дээш', () => move(i - 1), i === 0), button('Доош', () => move(i + 1), i + 1 === items.length));
      }
      actions.append(button('Устгах', () => { items.splice(i, 1); redraw(Math.min(i, items.length - 1)); }));
      row.append(actions);
      editor.append(row);
    });
    const add = button(spec.name + ' нэмэх', () => {
      const next = Object.fromEntries(spec.fields.map(([key]) => [key, '']));
      if (!isFaq) next.position = items.length + sourceDoc.querySelectorAll(spec.grid + ' > ' + spec.item).length + 1;
      if (spec.key === 'service-cards') next.cta = 'Дэлгэрэнгүй';
      items.push({ ...next, hidden: false });
      redraw(items.length - 1);
    }, items.length >= 30);
    editor.append(add);
    if (isFaq) editor.append(button('Анхны асуултуудаар дүүргэх', () => {
      draft[spec.key] = structuredClone(listDefaults[spec.key]);
      redraw(0);
    }));
    if (focusIndex !== undefined) (editor.querySelectorAll('fieldset')[focusIndex]?.querySelector('input') || add).focus();
    refreshDirty();
  };
  redraw();
}

function render() {
  sections.replaceChildren();
  const groups = new Map();
  for (const field of fields) {
    if (!groups.has(field.group)) {
      const group = document.createElement('details');
      group.className = 'panel content-group';
      const summary = document.createElement('summary');
      summary.textContent = field.group;
      group.append(summary);
      sections.append(group);
      groups.set(field.group, group);
    }
    const row = document.createElement('div');
    row.className = 'field content-field';
    const label = document.createElement('label');
    const input = document.createElement(field.kind === 'text' && field.value.length > 100 ? 'textarea' : 'input');
    input.id = 'content-' + field.id;
    input.maxLength = MAX_VALUE;
    input.value = valueOf(field, draft);
    label.htmlFor = input.id;
    label.textContent = field.label;
    row.append(label, input);
    let preview;
    if (field.kind === 'src') {
      input.setAttribute('list', 'contentPhotos');
      preview = document.createElement('img');
      preview.alt = '';
      preview.loading = 'lazy';
      preview.referrerPolicy = 'no-referrer';
      row.append(preview);
    }
    const updatePreview = () => {
      if (!preview) return;
      preview.hidden = !safeValue(field.kind, input.value);
      if (preview.hidden) preview.removeAttribute('src');
      else preview.src = new URL(input.value, location.origin + page.value).href;
    };
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'btn btn--ghost btn--sm';
    restore.textContent = 'Анхны утгаар дүүргэх';
    restore.addEventListener('click', () => {
      input.value = field.value;
      input.dispatchEvent(new Event('input'));
      input.focus();
    });
    row.append(restore);
    input.addEventListener('input', () => {
      draft[field.id] = input.value;
      input.removeAttribute('aria-invalid');
      refreshDirty();
    });
    input.addEventListener('change', updatePreview);
    updatePreview();
    groups.get(field.group).append(row);
  }
  for (const spec of lists) renderList(groups.get(spec.group), spec);
}

export async function load() {
  if (!session.user || (ready && original?.path === page.value)) return;
  const id = ++generation;
  const path = page.value;
  loading = true;
  ready = false;
  retry.hidden = true;
  clearPreview();
  sections.replaceChildren();
  message('Ачаалж байна…');
  lock();
  try {
    const clinical = clinicalSource(path);
    const [response, snapshot] = await Promise.all([
      clinical ? null : fetch(path, { cache: 'no-cache' }),
      getDocFromServer(refFor(path)),
    ]);
    if (response && !response.ok && !(path === '/404.html' && response.status === 404)) throw new Error('Хуудсыг ачаалж чадсангүй.');
    const html = response && await response.text();
    const source = clinical ? null : new DOMParser().parseFromString(html, 'text/html');
    const base = clinical && [...new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(JSON.stringify(clinical))))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (id !== generation) return;
    if (source) restoreContent(source);
    sourceDoc = source;
    fields = clinical ? clinicalFields(clinical) : contentFields(source, path);
    const priority = ['Үйлчилгээ', 'Бидний тухай'];
    const order = (field) => {
      const index = priority.indexOf(field.group);
      return index < 0 ? priority.length : index;
    };
    fields.sort((a, b) => order(a) - order(b));
    original = { path, raw: snapshot.data()?.values ?? null, base, storedBase: snapshot.data()?.base || null };
    if (clinical && original.storedBase && base !== original.storedBase) {
      message('Эх хуудас өөрчлөгджээ. Өмнөх нооргийн засварыг татаж эмчийн хяналтаар тулгана уу.');
      exportButton.hidden = false;
      exportButton.disabled = false;
      return;
    }
    if (original.raw !== null) {
      const stored = JSON.parse(original.raw);
      if (!stored || typeof stored !== 'object' || Array.isArray(stored) || original.raw.length > MAX_PAYLOAD) {
        throw new Error('content-format');
      }
    }
    baseline = parseContent(original.raw);
    lists = path === '/' ? [faqList, ...cardLists] : [];
    listDefaults = Object.fromEntries(lists.map(spec => [spec.key, spec === faqList ? faqItems(source) : []]));
    for (const spec of lists) {
      const rows = baseline[spec.key];
      if (rows !== undefined && !(spec === faqList ? validFaq(rows) : validCards(spec, rows))) throw new Error('content-format');
    }
    draft = structuredClone(baseline);
    ready = true;
    render();
    message(clinical ? 'Ноорог зөвхөн admin-д харагдана. Хадгалаад эмчээр хянуулах хувилбараа татна уу.' : 'Засах хэсгээ нээнэ үү.');
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
  const changes = fields.filter((field) => valueOf(field, draft) !== valueOf(field, baseline));
  const invalid = changes.find((field) => !safeValue(field.kind, valueOf(field, draft)));
  if (invalid) {
    const input = document.getElementById('content-' + invalid.id);
    input.closest('details').open = true;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
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
    const rows = listValue(draft, spec);
    const valid = spec === faqList ? validFaq : items => validCards(spec, items);
    if (!valid(rows)) {
      const editor = document.getElementById('editor-' + spec.key);
      editor.closest('details').open = true;
      const row = editor.querySelectorAll('fieldset')[rows.findIndex(item => !valid([item]))];
      row?.querySelector('input, textarea')?.focus();
      message(spec.name + ' · Бичвэр, холбоос болон байрлалыг шалгана уу.');
      return;
    }
    if (sameFaq(rows, listDefaults[spec.key])) delete values[spec.key];
    else values[spec.key] = structuredClone(rows);
  }
  const raw = JSON.stringify(values);
  if (new TextEncoder().encode(raw).length > MAX_PAYLOAD) {
    message('Энэ хуудасны өөрчлөлт хадгалах хэмжээнээс хэтэрсэн байна.');
    return;
  }
  saving = true;
  lock();
  try {
    const claims = changes.filter((field) => field.kind === 'text' || field.kind === 'content')
      .flatMap((field) => findClaims(valueOf(field, draft)).map((claim) => claim.label));
    for (const spec of lists) {
      const prior = listValue(baseline, spec);
      for (const row of listValue(draft, spec)) {
        if (prior.some(old => sameFaq(old, row))) continue;
        const text = spec.fields.map(([key]) => row[key]).join(' ');
        claims.push(...findClaims(text).map(claim => claim.label));
      }
    }
    if (claims.length && !await dialog({
      title: 'Нийтлэх бичвэрээ шалгана уу',
      body: 'Анхаарах хэллэгүүд · ' + [...new Set(claims)].join(', '),
      confirm: 'Хадгалах', cancel: 'Буцаж засах', safe: true,
    })) return;
    if (id !== generation || !session.user) return;
    const { path, raw: old } = original;
    const ref = refFor(path);
    await runTransaction(db, async (tx) => {
      const current = await tx.get(ref);
      if ((current.data()?.values ?? null) !== old) throw new Error('content-conflict');
      if (clinicalSource(path) && (current.data()?.base || null) !== original.storedBase) throw new Error('content-conflict');
      tx.set(ref, { values: raw, ...(clinicalSource(path) ? { base: original.base } : {}), updatedAt: serverTimestamp() });
    });
    if (id !== generation) return;
    original.raw = raw;
    original.storedBase = original.base;
    baseline = values;
    const saved = clinicalSource(path) ? 'Эмчээр хянуулах ноорог хадгалагдлаа.' : 'Хадгалагдлаа. Хуудсыг дахин ачаалахад өөрчлөлт харагдана.';
    message(saved);
    snack(saved);
  } catch (error) {
    if (id === generation) message(error.message === 'content-conflict'
      ? 'Өөр хэрэглэгч хадгалсан байна. Хуудсаа дахин ачаалахын өмнө засвараа хуулж авна уу.'
      : errText(error));
  } finally {
    if (id === generation) {
      saving = false;
      lock();
      refreshDirty();
    }
  }
}
$('#contentShortcuts').addEventListener('click', event => {
  const name = event.target.closest('[data-content-photo]')?.dataset.contentPhoto;
  const photo = fields.find(f => f.kind === 'src' && f.label === name + ' · Зураг');
  const input = photo && document.getElementById('content-' + photo.id);
  if (input) { input.closest('details').open = true; input.focus(); }
});
previewButton.addEventListener('click', () => {
  clearPreview();
  preview.hidden = false;
  const close = button('Хаах', () => { clearPreview(); previewButton.focus(); });
  preview.append(close);
  if (sourceDoc) {
    const copy = sourceDoc.cloneNode(true);
    applyContent(contentFields(copy, page.value), draft);
    for (const list of cardLists) applyCards(copy, list, draft[list.key]);
    if (draft[FAQ_KEY]) applyFaq(copy, draft[FAQ_KEY]);
    copy.querySelectorAll('script,iframe,link:not([rel="stylesheet"]),base,meta[http-equiv],noscript').forEach(el => el.remove());
    const base = copy.createElement('base');
    base.href = new URL(page.value, location.origin).href;
    copy.head.prepend(base);
    const frame = document.createElement('iframe');
    frame.title = page.selectedOptions[0].textContent + ' · Урьдчилан харах';
    frame.setAttribute('sandbox', '');
    frame.srcdoc = '<!doctype html>' + copy.documentElement.outerHTML;
    preview.append(frame);
  } else {
    for (const field of fields) {
      const text = valueOf(field, draft);
      if (!text) continue;
      const heading = document.createElement('h3');
      heading.textContent = field.label;
      const body = document.createElement('p');
      body.textContent = text;
      preview.append(heading, body);
    }
  }
  close.focus();
});
form.addEventListener('input', clearPreview);
exportButton.addEventListener('click', () => {
  const source = clinicalSource(page.value);
  if (!source || !original || original.path !== page.value) return;
  const stale = original.storedBase && original.storedBase !== original.base;
  const text = stale ? original.raw : 'export default ' + JSON.stringify(reviewDraft(source, draft), null, 2) + ';\n';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = source.slug + (stale ? '.edits.json' : '.mjs');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
page.addEventListener('change', async () => {
  const next = page.value;
  if (original) page.value = original.path;
  if (dirty() && !await dialog({ title: 'Хадгалаагүй өөрчлөлт байна', confirm: 'Хаяад хуудас солих', danger: true })) return;
  page.value = next;
  load();
});
retry.addEventListener('click', load);
form.addEventListener('submit', (event) => { event.preventDefault(); save(); });
registerForm('content', {
  isDirty: dirty, save, anchor: $('#contentActions'),
  busy: () => saving ? 'Сайтын мэдээлэл хадгалж байна.' : '',
  discard() { if (!saving) { draft = structuredClone(baseline); render(); refreshDirty(); } },
  reset() {
    generation++;
    ready = loading = saving = false;
    clearPreview();
    sourceDoc = null;
    original = null;
    draft = baseline = {};
    fields = [];
    sections.replaceChildren();
    lock();
  },
});
lock();

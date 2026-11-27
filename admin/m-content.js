import { doc, getDocFromServer, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { $, db, session, errText } from './core.js?v=2c361933';
import { registerForm, refreshDirty, snack, dialog } from './ui.js?v=4ec734c0';
import { contentFields, parseContent, safeValue, pageKey, MAX_PAYLOAD, MAX_VALUE, FAQ_KEY, faqItems, validFaq } from '../assets/js/site-content.js?v=03117684';
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
let faqDefaults = [];
let faqDraft = [];
let faqBaseline = [];
let ready = false;
let loading = false;
let saving = false;
let generation = 0;

const valueOf = (field, values) => Object.hasOwn(values, field.id) ? values[field.id] : field.value;
const sameFaq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const dirty = () => ready && (!sameFaq(faqDraft, faqBaseline) ||
  fields.some((field) => valueOf(field, draft) !== valueOf(field, baseline)));
const refFor = (path) => doc(db, 'public_content', pageKey(path));
const message = (text) => { status.textContent = text; };
const lock = () => {
  sections.inert = !ready || saving;
  saveButton.disabled = !ready || saving;
  page.disabled = loading || saving;
  retry.disabled = loading || saving;
};
const pageOptions = window.SKINAID_CONTENT_PAGES || [{ path: '/', label: 'Нүүр хуудас' }];
for (const entry of pageOptions) page.add(new Option(entry.label, entry.path));
const photos = window.SKINAID_HOME_DATA?.photos || [];
const options = $('#contentPhotos');
for (const photo of photos) options.append(new Option('/' + photo.replace(/^\//, '')));

function renderFaq(group) {
  if (!faqDefaults.length || !group) return;
  const editor = document.createElement('div');
  editor.id = 'contentFaq';
  group.append(editor);
  const redraw = (focusIndex) => {
    editor.replaceChildren();
    faqDraft.forEach((item, i) => {
      const row = document.createElement('fieldset');
      row.className = 'content-field';
      const legend = document.createElement('legend');
      legend.textContent = (i + 1) + '-р асуулт';
      row.append(legend);
      for (const [key, label, max] of [['question', 'Асуулт', 240], ['answer', 'Хариулт', MAX_VALUE]]) {
        const wrapper = document.createElement('label');
        wrapper.className = 'field';
        wrapper.textContent = label;
        const input = document.createElement(key === 'answer' ? 'textarea' : 'input');
        input.value = item[key];
        input.maxLength = max;
        input.addEventListener('input', () => { item[key] = input.value; refreshDirty(); });
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
      const move = (offset) => {
        const next = i + offset;
        [faqDraft[i], faqDraft[next]] = [faqDraft[next], faqDraft[i]];
        redraw(next);
      };
      actions.append(button('Дээш', () => move(-1), i === 0), button('Доош', () => move(1), i + 1 === faqDraft.length),
        button('Устгах', () => { faqDraft.splice(i, 1); redraw(Math.min(i, faqDraft.length - 1)); }));
      row.append(actions);
      editor.append(row);
    });
    const add = button('Асуулт нэмэх', () => {
      faqDraft.push({ question: '', answer: '', hidden: false });
      redraw(faqDraft.length - 1);
    }, faqDraft.length >= 30);
    editor.append(add, button('Анхны асуултуудаар дүүргэх', () => { faqDraft = structuredClone(faqDefaults); redraw(0); }));
    if (focusIndex !== undefined) (editor.querySelectorAll('fieldset')[focusIndex]?.querySelector('input') || add).focus();
    refreshDirty();
  };
  const button = (label, action, disabled = false) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--outline btn--sm';
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener('click', action);
    return btn;
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
  renderFaq(groups.get('Түгээмэл асуулт'));
}

export async function load() {
  if (!session.user || (ready && original?.path === page.value)) return;
  const id = ++generation;
  const path = page.value;
  loading = true;
  ready = false;
  retry.hidden = true;
  sections.replaceChildren();
  message('Ачаалж байна…');
  lock();
  try {
    const [response, snapshot] = await Promise.all([
      fetch(path, { cache: 'no-cache' }),
      getDocFromServer(refFor(path)),
    ]);
    if (!response.ok) throw new Error('Хуудсыг ачаалж чадсангүй.');
    const html = await response.text();
    if (id !== generation) return;
    const source = new DOMParser().parseFromString(html, 'text/html');
    fields = contentFields(source, path);
    const priority = ['Үйлчилгээ', 'Бидний тухай'];
    const order = (field) => {
      const index = priority.indexOf(field.group);
      return index < 0 ? priority.length : index;
    };
    fields.sort((a, b) => order(a) - order(b));
    original = { path, raw: snapshot.data()?.values ?? null };
    baseline = parseContent(original.raw);
    faqDefaults = faqItems(source);
    faqBaseline = structuredClone(validFaq(baseline[FAQ_KEY]) ? baseline[FAQ_KEY] : faqDefaults);
    faqDraft = structuredClone(faqBaseline);
    draft = { ...baseline };
    ready = true;
    render();
    message('Засах хэсгээ нээнэ үү.');
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
  const values = Object.fromEntries(fields.filter((field) => valueOf(field, draft) !== field.value)
    .map((field) => [field.id, valueOf(field, draft)]));
  if (faqDefaults.length && !validFaq(faqDraft)) {
    const editor = $('#contentFaq');
    editor.closest('details').open = true;
    const invalidRow = faqDraft.findIndex((item) => !validFaq([item]));
    const row = editor.querySelectorAll('fieldset')[invalidRow];
    const input = row && [...row.querySelectorAll('input[type="text"], textarea')].find((field) => !field.value.trim());
    input?.focus();
    message('Асуулт, хариултаа бүрэн бичнэ үү.');
    return;
  }
  if (faqDefaults.length && !sameFaq(faqDraft, faqDefaults)) values[FAQ_KEY] = faqDraft;
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
    if (!sameFaq(faqDraft, faqBaseline)) {
      for (const item of faqDraft) {
        if (faqBaseline.some((prior) => prior.question === item.question && prior.answer === item.answer)) continue;
        claims.push(...findClaims(item.question + ' ' + item.answer).map((claim) => claim.label));
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
      tx.set(ref, { values: raw, updatedAt: serverTimestamp() });
    });
    if (id !== generation) return;
    original.raw = raw;
    faqBaseline = structuredClone(faqDraft);
    baseline = values;
    draft = { ...values };
    message('Хадгалагдлаа. Хуудсыг дахин ачаалахад өөрчлөлт харагдана.');
    snack('Сайтын мэдээлэл хадгалагдлаа');
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
  discard() { if (!saving) { draft = { ...baseline }; faqDraft = structuredClone(faqBaseline); render(); refreshDirty(); } },
  reset() {
    generation++;
    ready = loading = saving = false;
    original = null;
    draft = baseline = {};
    fields = [];
    sections.replaceChildren();
    lock();
  },
});
lock();

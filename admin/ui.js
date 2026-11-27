/* ==========================================================================
   SKIN AID admin — ui.js: дахин ашиглах UI бүрэлдэхүүн (framework-гүй)
   - dialog():   <dialog> баталгаажуулалт — товч нь үйлдлээ нэрлэнэ (GOV.UK, Polaris), Esc = болих, фокус буцна
   - snack():    доод мэдэгдэл, «Буцаах» үйлдэлтэй (Material snackbar); алдаа хаах хүртэл үлдэнэ; hover/фокус үед зогсоно
   - registerForm()/refreshDirty(): хадгалаагүй өөрчлөлтийн мөр (Polaris contextual save bar), цэсний цэг, Ctrl/⌘+S
   - showErrors()/clearErrors(): маягтын дээрх алдааны хураангуй + талбарын доорх мэдэгдэл (GOV.UK error summary)
   - attachCounters(): тэмдэгт тоолуур (45/120)
   ========================================================================== */
import { $, $$, session, scrollMode } from './core.js?v=2c361933';

/* ---------- Дүрс (inline SVG, Lucide маягийн 24px stroke) ---------- */
const svg = (d, extra = '') => `<svg class="ic" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;
export const ICON = {
  bookings: svg('<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/><path d="m9 15 2 2 4-4"/>'),
  settings: svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  home: svg('<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  catalog: svg('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
  pages: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>'),
  chat: svg('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-4.6A8.4 8.4 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>'),
  phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'),
  copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  alert: svg('<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  up: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  down: svg('<path d="M12 5v14M19 12l-7 7-7-7"/>'),
  trash: svg('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
  eyeOff: svg('<path d="M17.9 17.9A10 10 0 0 1 12 20C5 20 1 12 1 12a18 18 0 0 1 5.1-5.9M9.9 4.2A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  bell: svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>'),
};

/* ---------- Баталгаажуулах цонх ---------- */
let dlg = null;
let dlgDone = null;
function ensureDialog() {
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.className = 'dlg';
  dlg.setAttribute('aria-labelledby', 'dlgTitle');
  dlg.setAttribute('aria-describedby', 'dlgBody');
  dlg.innerHTML = `
    <form method="dialog" class="dlg__box">
      <h2 class="dlg__title" id="dlgTitle"></h2>
      <div class="dlg__body" id="dlgBody"></div>
      <div class="dlg__actions">
        <button class="btn btn--outline" type="button" data-v="cancel"></button>
        <button class="btn btn--primary" type="button" data-v="ok"></button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (dlgDone) dlgDone(false); });   // Esc
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (b && dlgDone) dlgDone(b.dataset.v === 'ok');
  });
  return dlg;
}
/**
 * @param {{ title: string, body?: string|string[], list?: string[], confirm?: string, cancel?: string|null, danger?: boolean, safe?: boolean }} o
 *   danger — улаан товч; danger/safe үед анхны фокус «Болих» дээр (санамсаргүй Enter-ээр устгах/дарж бичихгүй)
 * @returns {Promise<boolean>} true = confirm товч
 */
export function dialog({ title, body = '', list = [], confirm = 'Тийм', cancel = 'Болих', danger = false, safe = false }) {
  const d = ensureDialog();
  if (dlgDone) dlgDone(false);   // өмнөх нээлттэй цонх (давхар дуудлага) — болих
  const prev = document.activeElement;
  $('#dlgTitle', d).textContent = title;
  const b = $('#dlgBody', d);
  b.replaceChildren();
  [].concat(body).filter(Boolean).forEach((t) => { const p = document.createElement('p'); p.textContent = t; b.appendChild(p); });
  if (list.length) {
    const ul = document.createElement('ul');
    list.forEach((t) => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
    b.appendChild(ul);
  }
  const ok = $('[data-v="ok"]', d), no = $('[data-v="cancel"]', d);
  ok.textContent = confirm;
  ok.className = 'btn ' + (danger ? 'btn--danger' : 'btn--primary');
  no.textContent = cancel || '';
  no.hidden = !cancel;
  return new Promise((resolve) => {
    dlgDone = (v) => {
      dlgDone = null;
      if (d.open) d.close();
      if (prev && prev.isConnected && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
      resolve(v);
    };
    d.showModal();
    ((danger || safe) && cancel ? no : ok).focus();
  });
}

/* ---------- Мэдэгдэл (snackbar) ----------
   Дэлгэц уншигчид зөвхөн текст нь (тусдаа sr-only live region-оор) хүрнэ — товчнууд дахин уншигдахгүй.
   «Буцаах»-тай мэдэгдлийг гарын хэрэглэгч Alt+Z-ээр шууд буцаана (Tab-аар хайх шаардлагагүй). */
let host = null;
let undoable = [];   // харагдаж буй «Буцаах»-тай мэдэгдлүүд (сүүлийнх нь Alt+Z)
function ensureHost() {
  if (host) return host;
  host = document.createElement('div');
  host.className = 'snackbar';
  host.innerHTML = '<div class="sr-only" role="status" aria-live="polite" data-live="polite"></div><div class="sr-only" role="alert" data-live="alert"></div><div class="snackbar__list"></div>';
  document.body.appendChild(host);
  return host;
}
ensureHost();
const liveQ = { polite: [], alert: [] }, liveT = { polite: 0, alert: 0 };
/** Дэлгэц уншигчид мэдэгдэнэ (ижил текстийг дахин ч уншуулна; ойрхон ирсэн мэдэгдлүүдийг нэгтгэж алдахгүй) */
export function announce(msg, error = false) {
  const kind = error ? 'alert' : 'polite';
  const r = $(`[data-live="${kind}"]`, ensureHost());
  liveQ[kind].push(msg);
  r.textContent = '';
  clearTimeout(liveT[kind]);
  liveT[kind] = setTimeout(() => { r.textContent = liveQ[kind].join(' '); liveQ[kind] = []; }, 60);
}
/**
 * Хадгалах үед фокустай талбарыг тэмдэглэж, түгжээ тайлагдсаны дараа сэргээнэ (мөр дахин зурагдсан ч
 * data-id + data-k/h/s эсвэл id-аар олно). Олдохгүй/нуугдсан бол fallback руу.
 */
export function captureFocus(root) {
  const a = document.activeElement;
  if (!a || a === document.body || !root.contains(a)) return () => {};
  const row = a.closest('[data-id]');
  const key = ['k', 'h', 's'].map((d) => a.dataset[d] && `[data-${d}="${a.dataset[d]}"]`).find(Boolean) || '';
  const rowId = row ? row.dataset.id : '', id = a.id;
  return (fallback) => {
    let el = null;
    if (rowId && key) { const r = $$('[data-id]', root).find((x) => x.dataset.id === rowId); el = r ? $(key, r) : null; }
    if (!el && id) el = document.getElementById(id);
    if (!el || !el.isConnected || el.closest('[hidden], [inert]') || el.disabled) el = fallback;
    if (el && el.isConnected) el.focus({ preventScroll: true });
  };
}
/**
 * @param {string} msg
 * @param {{ action?: string, onAction?: () => void, error?: boolean, timeout?: number }} [o]
 */
export function snack(msg, { action, onAction, error = false, timeout } = {}) {
  const h = ensureHost();
  const el = document.createElement('div');
  el.className = 'snack' + (error ? ' is-err' : '');
  const text = document.createElement('span');
  text.className = 'snack__text';
  text.textContent = msg;
  el.appendChild(text);
  let timer = 0, left = timeout || (action ? 10000 : 5000), started = 0, running = false, hovered = false, focused = false, gone = false;
  const entry = { run: () => { if (onAction) onAction(); } };
  const dismiss = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    undoable = undoable.filter((u) => u !== entry);
    const hadFocus = el.contains(document.activeElement);
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 200);
    if (hadFocus) $('#main')?.focus({ preventScroll: true });   // фокус body руу унахгүй
  };
  entry.dismiss = dismiss;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'snack__act'; b.textContent = action;
    b.setAttribute('aria-keyshortcuts', 'Alt+Z');
    b.title = `${action} (Alt+Z)`;
    b.addEventListener('click', () => { dismiss(); if (onAction) onAction(); });
    el.appendChild(b);
    undoable.push(entry);
  }
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'snack__close'; x.setAttribute('aria-label', 'Мэдэгдлийг хаах'); x.innerHTML = ICON.close;
  x.addEventListener('click', dismiss);
  el.appendChild(x);
  el._dismiss = dismiss;
  $('.snackbar__list', h).appendChild(el);
  // 3-аас олон бол хамгийн хуучныг жинхэнээр хаана (Alt+Z хуучин, харагдахгүй мэдэгдлийг буцаахгүй)
  const all = $$('.snack:not(.is-out)', h);
  if (all.length > 3) all.slice(0, all.length - 3).forEach((s) => s._dismiss());
  announce(action ? `${msg} ${action}: Alt+Z.` : msg, error);
  // Алдаа хаах хүртэл үлдэнэ; бусад нь хугацаатай — hover/фокус үед зогсоно (WCAG 2.2.1)
  const sync = () => {
    if (error || gone) return;
    const hold = hovered || focused;
    if (hold && running) { clearTimeout(timer); left -= Date.now() - started; running = false; }
    else if (!hold && !running) { started = Date.now(); timer = setTimeout(dismiss, Math.max(left, 1500)); running = true; }
  };
  el.addEventListener('mouseenter', () => { hovered = true; sync(); });
  el.addEventListener('mouseleave', () => { hovered = false; sync(); });
  el.addEventListener('focusin', () => { focused = true; sync(); });
  el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) { focused = false; sync(); } });
  sync();
  return { dismiss };
}
document.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyZ' || !undoable.length || document.querySelector('dialog[open]')) return;
  e.preventDefault();
  const u = undoable[undoable.length - 1];
  u.dismiss();
  u.run();
});

/* ---------- Хадгалаагүй өөрчлөлт: маягтын бүртгэл, save bar, цэсний цэг, Ctrl/⌘+S ---------- */
const forms = new Map();   // view → { isDirty(), save(), discard(), anchor?, bar? }
let currentView = '';
let bar = null;
const anchorVisible = new Map();
// Доод 96px (save bar, утасны доод цэс)-ийн ард байгаа «Хадгалах» товчийг харагдаж байна гэж тооцохгүй
const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  entries.forEach((e) => anchorVisible.set(e.target, e.isIntersecting));
  refreshDirty();
}, { rootMargin: '0px 0px -96px 0px' }) : null;

function ensureBar() {
  if (bar) return bar;
  bar = document.createElement('div');
  bar.className = 'savebar';
  bar.hidden = true;
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Хадгалаагүй өөрчлөлт');
  bar.innerHTML = `<span class="savebar__msg">${ICON.alert}<span>Хадгалаагүй өөрчлөлт байна</span></span>
    <span class="savebar__keys" aria-hidden="true">Ctrl/⌘ + S</span>
    <button class="btn btn--ghost btn--sm" type="button" data-act="discard">Болих</button>
    <button class="btn btn--primary btn--sm" type="button" data-act="save">Хадгалах</button>`;
  document.body.appendChild(bar);
  bar.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const f = forms.get(currentView); if (!f || !session.user) return;
    if (b.dataset.act === 'save') { b.disabled = true; try { await f.save(); } finally { b.disabled = false; } }
    else if (await dialog({ title: 'Өөрчлөлтийг хаях уу?', body: 'Хадгалаагүй өөрчлөлт алга болж, маягт сүүлд хадгалсан байдалдаа буцна.', confirm: 'Өөрчлөлтийг хаях', cancel: 'Үргэлжлүүлэн засах', danger: true })) {
      // discard() false буцаавал (жишээ нь хадгалалт явж байна) хаяагүй — «хаялаа» гэж бүү мэдэгд
      if (f.discard() !== false) announce('Өөрчлөлтийг хаялаа.');
    }
    // Мөр нуугдсан бол фокусыг маягтын өөрийн «Хадгалах» товч руу (body руу унахгүй)
    if (bar.hidden && (bar.contains(document.activeElement) || document.activeElement === document.body)) {
      const a = anchorsOf(f).find((x) => x.offsetParent !== null);
      const t = a && a.querySelector('button:not([disabled])');
      if (t) { t.scrollIntoView({ block: 'center' }); t.focus({ preventScroll: true }); }
      else $('#main')?.focus({ preventScroll: true });
    }
  });
  return bar;
}

/** @param {string} view  @param {{ isDirty: () => boolean, save?: () => Promise<any>, discard?: () => void, reset?: () => void, anchor?: Element, anchors?: Element[], bar?: boolean, busy?: () => string, leave?: () => Promise<void>|void }} api
 *  anchors — нэг цэсэд хэд хэдэн маягт (таб) байвал тус бүрийн «Хадгалах» мөр
 *  busy — явж буй ажлын тайлбар ('' = юу ч явахгүй; гарах/хаахад анхааруулна, хадгалах мөрийг ГАРГАХГҮЙ); leave — орхихын өмнө */
export function registerForm(view, api) {
  forms.set(view, api);
  if (io) for (const a of anchorsOf(api)) io.observe(a);
}
const anchorsOf = (f) => (f.anchors || (f.anchor ? [f.anchor] : [])).filter(Boolean);
export function setCurrentView(view) { currentView = view; refreshDirty(); }
export const anyDirty = () => !!session.user && [...forms.values()].some((f) => f.isDirty());
/** Явж буй ажил (жишээ нь Messenger AI-ийн eval) — гарах/хаахаас өмнө анхааруулах текст ('' = алга) */
export const busyText = () => (session.user ? [...forms.values()].map((f) => (f.busy ? f.busy() : '')).find(Boolean) || '' : '');
/** Гарахын өмнө явж буй ажлуудад мэдэгдэнэ (хагас үр дүнг хадгалуулах) */
export async function leaveBusy() {
  await Promise.all([...forms.values()].map(async (f) => { try { if (f.busy && f.busy() && f.leave) await f.leave(); } catch (_) { /* best effort */ } }));
}
/** Гарах үед: маягтуудыг «ачаалаагүй» төлөвт оруулна (хадгалах мөр нэвтрэх хуудсан дээр гарахгүй, дараагийн нэвтрэлт цэвэр) */
export function resetForms() {
  forms.forEach((f) => { if (f.reset) f.reset(); });
  refreshDirty();
}
export function refreshDirty() {
  const on = !!session.user;
  $$('[data-nav]').forEach((a) => {
    const d = on && [a.dataset.nav, a.dataset.navAlso].some((k) => { const f = k && forms.get(k); return !!(f && f.isDirty()); });
    a.classList.toggle('has-dirty', d);
    const sr = $('.nav__dirty', a); if (sr) sr.textContent = d ? ' (хадгалаагүй өөрчлөлттэй)' : '';
  });
  const b = ensureBar();
  const f = forms.get(currentView);
  // Маягтын өөрийн «Хадгалах» товч дэлгэцэнд харагдаж байвал давхар мөр гаргахгүй
  const show = on && !!(f && f.bar !== false && f.isDirty() && !anchorsOf(f).some((a) => anchorVisible.get(a)));
  b.hidden = !show;
  document.body.classList.toggle('has-savebar', show);
  document.documentElement.classList.toggle('has-savebar', show);   // scroll-padding (фокустай талбар мөрийн ард орохгүй)
}
document.addEventListener('keydown', (e) => {
  // Монгол (кирилл) гарын байрлалд e.key = 'ы' — физик товч (KeyS)-оор шалгана
  const isS = e.code === 'KeyS' || (typeof e.key === 'string' && e.key.toLowerCase() === 's');
  if (!isS || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  const f = forms.get(currentView);
  if (!f || !f.save || !session.user) return;
  e.preventDefault();
  if (f.isDirty() && !document.querySelector('dialog[open]')) f.save();
});

/* ---------- Алдааны хураангуй + талбарын мэдэгдэл ---------- */
let errSeq = 0;
/** errs: [{ msg, el?, reveal?() }] — summary нь маягтын дээрх .err-summary элемент; level — гарчгийн түвшин (маягтын
 *  гарчиг h3 бол 4 — гарчгийн дараалал эвдрэхгүй) */
export function showErrors(summary, errs, scope = summary.parentElement, { level = 2 } = {}) {
  clearErrors(scope);
  if (!errs.length) return;
  const h = `h${Math.min(6, Math.max(2, Number(level) || 2))}`;
  summary.innerHTML = `<div role="alert"><${h} class="err-summary__title">${ICON.alert}<span>Хадгалах боломжгүй — ${errs.length} зүйл засна уу</span></${h}><ul></ul></div>`;
  const ul = $('ul', summary);
  errs.forEach((e) => {
    const li = document.createElement('li');
    if (e.el) {
      const a = document.createElement('a');
      a.href = '#'; a.textContent = e.msg;
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (e.reveal) e.reveal();
        e.el.scrollIntoView({ block: 'center', behavior: scrollMode() });
        e.el.focus({ preventScroll: true });
      });
      li.appendChild(a);
      if (e.reveal) e.reveal();
      e.el.setAttribute('aria-invalid', 'true');
      const p = document.createElement('p');
      p.className = 'field-err';
      p.id = 'fe' + (++errSeq);
      p.innerHTML = ICON.alert;
      p.appendChild(document.createTextNode(e.msg));
      e.el.dataset.prevDescribedby = e.el.getAttribute('aria-describedby') || '';
      e.el.setAttribute('aria-describedby', (e.el.dataset.prevDescribedby + ' ' + p.id).trim());
      (e.el.closest('.field, td') || e.el.parentElement).appendChild(p);
    } else li.textContent = e.msg;
    ul.appendChild(li);
  });
  summary.hidden = false;
  summary.tabIndex = -1;
  summary.scrollIntoView({ block: 'start', behavior: scrollMode() });
  summary.focus({ preventScroll: true });
}
export function clearErrors(scope) {
  if (!scope) return;
  $$('.field-err', scope).forEach((p) => p.remove());
  $$('[aria-invalid]', scope).forEach((el) => {
    el.removeAttribute('aria-invalid');
    if ('prevDescribedby' in el.dataset) {
      if (el.dataset.prevDescribedby) el.setAttribute('aria-describedby', el.dataset.prevDescribedby); else el.removeAttribute('aria-describedby');
      delete el.dataset.prevDescribedby;
    }
  });
  $$('.err-summary', scope).forEach((s) => { s.hidden = true; s.replaceChildren(); });
}
/** Нэг талбарын алдааг (хэрэглэгч засаж эхлэхэд) арилгана */
export function clearFieldError(el) {
  if (!el || !el.hasAttribute('aria-invalid')) return;
  el.removeAttribute('aria-invalid');
  const wrap = el.closest('.field, td') || el.parentElement;
  $$('.field-err', wrap).forEach((p) => p.remove());
  if ('prevDescribedby' in el.dataset) {
    if (el.dataset.prevDescribedby) el.setAttribute('aria-describedby', el.dataset.prevDescribedby); else el.removeAttribute('aria-describedby');
    delete el.dataset.prevDescribedby;
  }
}

/* ---------- Тэмдэгт тоолуур, автоматаар өндөрсөх textarea ---------- */
export function attachCounters(root) {
  $$('[data-count-chars]', root).forEach((el) => {
    if (el._counter) return;
    const max = Number(el.getAttribute('maxlength')) || 0;
    if (!max) return;
    const c = document.createElement('span');
    c.className = 'counter';
    c.setAttribute('aria-hidden', 'true');   // maxlength өөрөө хязгаарлана; дэлгэц уншигчид товчлуур бүрт уншуулахгүй
    el.insertAdjacentElement('afterend', c);
    el._counter = () => {
      const n = Array.from(el.value).length;
      c.textContent = `${n}/${max}`;
      c.classList.toggle('is-near', n >= max * 0.9);
    };
    el.addEventListener('input', el._counter);
    el._counter();
  });
}
export const refreshCounters = (root) => $$('[data-count-chars]', root).forEach((el) => el._counter && el._counter());
/* Нуугдсан цэс дээр (display:none) scrollHeight = 0 тул өндрийг тооцохгүй — харагдах үед (өргөн өөрчлөгдөхөд)
   ResizeObserver дахин тааруулна. Ингэхгүй бол «Үйлчилгээ / Багц»-ын тайлбар 2px болж тасарч харагддаг байсан. */
const growRO = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => {
    for (const e of entries) {
      const w = Math.round(e.contentRect.width);
      if (w && w !== e.target._growW && e.target._grow) { e.target._growW = w; e.target._grow(); }   // зөвхөн өргөн өөрчлөгдөхөд
    }
  })
  : null;
export function autoGrow(ta) {
  const fit = () => {
    if (!ta.isConnected || !ta.offsetWidth) return;   // нуугдсан — харагдахад дахин
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, 640) + 'px';
  };
  if (!ta._grow) {
    ta.addEventListener('input', fit);
    ta._grow = fit;
    if (growRO) growRO.observe(ta);
  }
  fit();
}


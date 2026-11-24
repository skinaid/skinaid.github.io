/* ==========================================================================
   SKIN AID admin — Модуль: Захиалга (bookings, realtime)
   Нягт жагсаалт (огноогоор бүлэглэсэн) → мөрийг дарж задлах. Статус нэг товшилтоор хадгалагдана («Буцаах»-тай),
   тэмдэглэл тусдаа хадгална. Хайлт: нэр, утас, үйлчилгээ, мессеж, тэмдэглэл.
   ========================================================================== */
import { collection, query, orderBy, limit, onSnapshot, doc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db, $, $$, esc, fmtDate, errText, session, msOf } from './core.js?v=a484f97e';
import { ICON, dialog, snack, registerForm, refreshDirty } from './ui.js?v=29f3ef30';
import { dayGroup, GROUP_ORDER, relTime, matchBooking, telHref } from './lib.js?v=b23c61fb';

export const STATUS = { new: 'Шинэ', contacted: 'Холбогдсон', confirmed: 'Баталгаажсан', cancelled: 'Цуцалсан' };
const TITLE = 'SkinAid — Удирдлага';
const PAGE = 300;

const list = $('#bkList'), chips = $('#bkChips'), meta = $('#bkMeta'), newCount = $('#newCount');
const btnNotify = $('#btnNotify'), more = $('#bkMore'), bulk = $('#bkBulk'), search = $('#bkSearch');

let pageLimit = PAGE;       // «Цааш» дарахад PAGE-ээр нэмэгдэж дахин бүртгүүлнэ
let bookings = [];
let byId = new Map();
let knownIds = null;        // анхны snapshot-оос хойш шинээр ирснийг таних
let newestKnownMs = 0;      // хуучин doc цонхонд буцаж орж ирэхэд «шинэ» гэж дуугарахгүй
let filter = 'all';
let q = '';
let stop = null;
let loaded = false;
const expanded = new Set();     // задалсан мөрүүд (дахин зурахад хадгална)
const noteDraft = new Map();    // id → хадгалаагүй тэмдэглэл

/* ---------- Шүүлтийн chip ---------- */
chips.innerHTML = [['all', 'Бүгд'], ...Object.entries(STATUS)].map(([k, v], i) =>
  `<button class="chip${i === 0 ? ' is-active' : ''}" type="button" data-f="${k}" aria-pressed="${i === 0}" data-status="${k}">${v} <span data-n></span></button>`).join('');
chips.addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  filter = b.dataset.f;
  $$('.chip', chips).forEach((c) => { const on = c === b; c.classList.toggle('is-active', on); c.setAttribute('aria-pressed', String(on)); });
  applyFilter();
});
let qT = 0;
search.addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => { q = search.value; applyFilter(); }, 120); });
search.addEventListener('keydown', (e) => { if (e.key === 'Escape' && search.value) { search.value = ''; q = ''; applyFilter(); } });

/* ---------- Мөр ---------- */
const statusSeg = (b) => `
  <fieldset class="seg">
    <legend>Төлөв</legend>
    <div class="seg__opts">${Object.entries(STATUS).map(([k, v]) =>
      `<label class="seg__opt" data-status="${k}"><input type="radio" name="st-${esc(b.id)}" value="${k}"${k === b.status ? ' checked' : ''}><span>${v}</span></label>`).join('')}</div>
  </fieldset>`;

function rowHTML(b) {
  const id = esc(b.id);
  const ms = msOf(b.createdAt);
  const when = b.date ? `Хүссэн: ${esc(b.date)}` : 'Огноо тохиролцоно';
  return `
    <div class="bk__row">
      <button class="bk__sum" type="button" aria-expanded="false" aria-controls="bkd-${id}">
        <span class="bk__main">
          <span class="bk__name">${esc(b.name)}</span>
          <span class="bk__sub">${esc(b.service)} · ${when}</span>
        </span>
        <span class="bk__phone">${esc(b.phone)}</span>
        <span class="bk__when" data-ms="${ms || ''}" title="Ирсэн: ${esc(fmtDate(b.createdAt))}">${esc(relTime(ms))}</span>
        <span class="badge" data-status="${esc(b.status)}">${esc(STATUS[b.status] || b.status)}</span>
        <span class="bk__chev">${ICON.chevron}</span>
      </button>
      <a class="bk__call" href="${telHref(b.phone)}" aria-label="${esc(b.name)} руу залгах (${esc(b.phone)})">${ICON.phone}</a>
    </div>
    <div class="bk__detail" id="bkd-${id}" hidden>
      <div class="bk__grid">
        <dl class="bk__facts">
          <div><dt>Утас</dt><dd><a href="${telHref(b.phone)}">${esc(b.phone)}</a> <button class="btn-icon" type="button" data-act="copy" aria-label="${esc(b.phone)} дугаарыг хуулах" title="Хуулах">${ICON.copy}</button></dd></div>
          <div><dt>Үйлчилгээ</dt><dd>${esc(b.service)}</dd></div>
          <div><dt>Хүссэн огноо</dt><dd>${esc(b.date || 'тохиролцоно')}</dd></div>
          <div><dt>Ирсэн</dt><dd>${esc(fmtDate(b.createdAt))}</dd></div>
          ${b.updatedBy ? `<div><dt>Сүүлд зассан</dt><dd>${esc(fmtDate(b.updatedAt))} · ${esc(b.updatedBy)}</dd></div>` : ''}
        </dl>
        ${b.message ? `<div class="bk__msg"><strong>Үйлчлүүлэгчийн мессеж</strong>${esc(b.message)}</div>` : ''}
      </div>
      ${statusSeg(b)}
      <div class="field bk__note">
        <label for="bkn-${id}">Дотоод тэмдэглэл <small>(зөвхөн ажилтнууд харна)</small></label>
        <textarea id="bkn-${id}" data-f="note" maxlength="1000" placeholder="Залгасан эсэх, тохирсон цаг…"></textarea>
        <div class="bk__noteact">
          <button class="btn btn--primary btn--sm" type="button" data-act="note">Тэмдэглэл хадгалах</button>
          <span class="bk__notestate" data-notestate role="status"></span>
        </div>
      </div>
      <div class="bk__danger"><button class="btn btn--danger-ghost btn--sm" type="button" data-act="del">${ICON.trash} Захиалга устгах</button></div>
    </div>`;
}
function buildRow(b) {
  const el = document.createElement('article');
  el.className = 'bk';
  el.dataset.id = b.id;
  el.dataset.status = b.status;
  el.innerHTML = rowHTML(b);
  const ta = $('[data-f="note"]', el);
  ta.value = noteDraft.has(b.id) ? noteDraft.get(b.id) : (b.note || '');
  setNoteState(el, b);
  if (expanded.has(b.id)) setOpen(el, true);
  return el;
}
/** Фокустай мөрийг (бичиж/сонгож буй) дахин зурахгүй — зөвхөн төлөв, огноог шинэчилнэ */
function patchRow(el, b) {
  el.dataset.status = b.status;
  const badge = $('.bk__sum .badge', el);
  badge.dataset.status = b.status; badge.textContent = STATUS[b.status] || b.status;
  const r = $(`input[type="radio"][value="${b.status}"]`, el); if (r && !r.checked) r.checked = true;
  setNoteState(el, b);
}
function setOpen(el, open) {
  const btn = $('.bk__sum', el);
  btn.setAttribute('aria-expanded', String(open));
  $('.bk__detail', el).hidden = !open;
  el.classList.toggle('is-open', open);
  if (open) expanded.add(el.dataset.id); else expanded.delete(el.dataset.id);
}
function setNoteState(el, b) {
  const id = el.dataset.id;
  const draft = noteDraft.get(id);
  const dirty = draft !== undefined && draft !== (b.note || '');
  el.classList.toggle('has-draft', dirty);
  const st = $('[data-notestate]', el);
  if (st && !st.dataset.flash) st.textContent = dirty ? 'Хадгалаагүй өөрчлөлт' : '';
}

/* ---------- Жагсаалт зурах (огноогоор бүлэглэнэ) ---------- */
const groupEl = (key, label) => {
  const s = document.createElement('section');
  s.className = 'bk-group'; s.dataset.group = key;
  s.setAttribute('aria-labelledby', 'bkg-' + key);
  s.innerHTML = `<h2 class="bk-group__title" id="bkg-${key}">${label} <span class="bk-group__n" data-gn></span></h2><div class="bk-group__rows"></div>`;
  return s;
};
function render() {
  if (!loaded) return;
  const focused = document.activeElement;
  const existing = new Map($$('.bk[data-id]', list).map((el) => [el.dataset.id, el]));
  const now = Date.now();
  const groups = new Map();
  const frag = document.createDocumentFragment();
  bookings.forEach((b) => {
    const g = dayGroup(msOf(b.createdAt) || now, now);
    if (!groups.has(g.key)) groups.set(g.key, groupEl(g.key, g.label));
    let el = existing.get(b.id);
    if (el && el.contains(focused)) patchRow(el, b); else el = buildRow(b);
    existing.delete(b.id);
    $('.bk-group__rows', groups.get(g.key)).appendChild(el);
  });
  GROUP_ORDER.forEach((k) => { if (groups.has(k)) frag.appendChild(groups.get(k)); });
  existing.forEach((el, id) => { expanded.delete(id); noteDraft.delete(id); });
  list.replaceChildren(frag);
  list.setAttribute('aria-busy', 'false');
  if (focused && list.contains(focused)) focused.focus({ preventScroll: true });   // replaceChildren фокусыг алдуулна
  if (!bookings.length) list.innerHTML = `<div class="empty">${ICON.bookings}<p><strong>Одоогоор захиалга алга</strong><br>Сайтын маягтаар ирсэн хүсэлт энд шууд харагдана.</p></div>`;
  applyFilter();
  const n = bookings.filter((b) => b.status === 'new').length;
  $('[data-n]', newCount).textContent = String(n);
  newCount.classList.toggle('is-on', n > 0);
  document.title = (n ? `(${n}) ` : '') + TITLE;
  const counts = { all: bookings.length };
  bookings.forEach((b) => { counts[b.status] = (counts[b.status] || 0) + 1; });
  $$('.chip', chips).forEach((c) => { $('[data-n]', c).textContent = counts[c.dataset.f] ? `(${counts[c.dataset.f]})` : ''; });
  refreshDirty();
}
function applyFilter() {
  let shown = 0;
  $$('.bk[data-id]', list).forEach((el) => {
    const b = byId.get(el.dataset.id);
    const on = !!b && (filter === 'all' || b.status === filter) && matchBooking(b, q);
    el.hidden = !on;
    if (on) shown++;
  });
  $$('.bk-group', list).forEach((g) => {
    const n = $$('.bk:not([hidden])', g).length;
    g.hidden = !n;
    $('[data-gn]', g).textContent = n ? `(${n})` : '';
  });
  let none = $('.bk-none', list);
  const filtered = filter !== 'all' || q.trim();
  if (bookings.length && !shown) {
    if (!none) {
      none = document.createElement('div');
      none.className = 'empty bk-none';
      list.appendChild(none);
    }
    none.innerHTML = `${ICON.search}<p><strong>Тохирох захиалга алга</strong><br>${q.trim() ? `«${esc(q.trim())}» хайлтаар` : 'Энэ шүүлтээр'} захиалга олдсонгүй.</p><button class="btn btn--outline btn--sm" type="button" data-act="clear">Шүүлтийг цэвэрлэх</button>`;
  } else if (none) none.remove();
  const capped = bookings.length >= pageLimit;
  meta.textContent = !bookings.length ? '' : filtered
    ? `${bookings.length}-аас ${shown} захиалга харуулж байна`
    : `${shown} захиалга${capped ? ` (сүүлийн ${pageLimit} — хуучныг «Цааш ачаалах»-аар)` : ''}`;
  bulk.hidden = filter === 'all' || q.trim() !== '' || shown === 0;
  bulk.textContent = `«${STATUS[filter] || ''}» төлөвтэй ${shown}-ийг устгах`;
}
// Харьцангуй цагийг минут тутам шинэчилнэ
setInterval(() => { const now = Date.now(); $$('.bk__when[data-ms]', list).forEach((s) => { const ms = Number(s.dataset.ms); if (ms) s.textContent = relTime(ms, now); }); }, 60000);

const skeleton = () => {
  list.setAttribute('aria-busy', 'true');
  list.innerHTML = '<p class="sr-only">Захиалгууд ачаалж байна…</p>' + Array.from({ length: 4 }, () => '<div class="bk bk--skel" aria-hidden="true"><span></span><span></span><span></span></div>').join('');
};

/* ---------- Firestore (realtime) ---------- */
export function start() {
  if (stop) stop();
  if (!loaded) skeleton();
  const qy = query(collection(db, 'bookings'), orderBy('createdAt', 'desc'), limit(pageLimit));
  stop = onSnapshot(qy, (snap) => {
    bookings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    byId = new Map(bookings.map((b) => [b.id, b]));
    if (knownIds) {
      // Зөвхөн үнэхээр шинэ (status=new, өмнө мэдэгдэж байснаас хожуу үүссэн) doc-д мэдэгдэнэ
      const fresh = snap.docChanges()
        .filter((ch) => ch.type === 'added' && !knownIds.has(ch.doc.id))
        .map((ch) => ({ id: ch.doc.id, ...ch.doc.data() }))
        .filter((b) => b.status === 'new' && (msOf(b.createdAt) || 0) > newestKnownMs);
      if (fresh.length) notifyNew(fresh);
    }
    knownIds = new Set(snap.docs.map((d) => d.id));
    newestKnownMs = Math.max(newestKnownMs, ...bookings.map((b) => msOf(b.createdAt) || 0));
    more.hidden = snap.size < pageLimit; more.disabled = false;
    loaded = true;
    render();
  }, (e) => {
    loaded = false;
    list.setAttribute('aria-busy', 'false');
    list.innerHTML = `<div class="empty is-err">${ICON.alert}<p><strong>Захиалгыг ачаалж чадсангүй</strong><br>${esc(errText(e))}</p><button class="btn btn--outline btn--sm" type="button" data-act="retry">Дахин холбогдох</button></div>`;
  });
}
export function teardown() {
  if (stop) { stop(); stop = null; }
  bookings = []; byId = new Map(); knownIds = null; loaded = false;
  expanded.clear(); noteDraft.clear();
  list.replaceChildren();
  newCount.classList.remove('is-on');
  document.title = TITLE;
}
more.addEventListener('click', () => { pageLimit += PAGE; more.disabled = true; start(); });

/* ---------- Үйлдлүүд ---------- */
const ref = (id) => doc(db, 'bookings', id);
const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: session.user.email });

list.addEventListener('click', async (e) => {
  const sum = e.target.closest('.bk__sum');
  if (sum) { const el = sum.closest('.bk'); setOpen(el, sum.getAttribute('aria-expanded') !== 'true'); return; }
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'retry') { start(); return; }
  if (act === 'clear') { filter = 'all'; q = ''; search.value = ''; $$('.chip', chips).forEach((c, i) => { c.classList.toggle('is-active', i === 0); c.setAttribute('aria-pressed', String(i === 0)); }); applyFilter(); search.focus(); return; }
  const el = btn.closest('.bk'); if (!el) return;
  const id = el.dataset.id, b = byId.get(id); if (!b) return;
  if (act === 'copy') {
    try { await navigator.clipboard.writeText(b.phone); snack(`${b.phone} хуулагдлаа`); }
    catch (_) { snack('Хуулж чадсангүй — дугаарыг гараар хуулна уу.', { error: true }); }
  } else if (act === 'note') {
    const note = $('[data-f="note"]', el).value.trim().slice(0, 1000);
    btn.disabled = true;
    try {
      await updateDoc(ref(id), { note, ...stamp() });
      noteDraft.delete(id);
      const st = $('[data-notestate]', el);
      st.dataset.flash = '1'; st.textContent = 'Хадгалагдлаа ✓';
      setTimeout(() => { delete st.dataset.flash; setNoteState(el, byId.get(id) || b); }, 2500);
      el.classList.remove('has-draft');
      refreshDirty();
    } catch (err) { snack(errText(err), { error: true }); }
    finally { btn.disabled = false; }
  } else if (act === 'del') {
    const ok = await dialog({
      title: 'Захиалгыг устгах уу?',
      body: [`«${b.name}» (${b.phone}) — ${b.service}.`, 'Бүр мөсөн устгагдана, буцаах боломжгүй. Дараа нь харах шаардлагатай бол «Цуцалсан» төлөв өгөх нь зөв.'],
      confirm: 'Устгах', cancel: 'Болих', danger: true,
    });
    if (!ok) return;
    btn.disabled = true;
    try { await deleteDoc(ref(id)); snack(`«${b.name}» захиалга устгагдлаа`); }
    catch (err) { snack(errText(err), { error: true }); btn.disabled = false; }
  }
});
// Статус: нэг товшилтоор хадгална, «Буцаах»-тай
list.addEventListener('change', async (e) => {
  const r = e.target.closest('input[type="radio"][name^="st-"]'); if (!r) return;
  const el = r.closest('.bk'), id = el.dataset.id, b = byId.get(id); if (!b) return;
  const prev = b.status, next = r.value;
  if (prev === next) return;
  patchRow(el, { ...b, status: next });
  $$('input[type="radio"]', el).forEach((x) => { x.disabled = true; });
  try {
    await updateDoc(ref(id), { status: next, ...stamp() });
    snack(`«${b.name}» → ${STATUS[next]}`, {
      action: 'Буцаах',
      onAction: async () => {
        try { await updateDoc(ref(id), { status: prev, ...stamp() }); snack(`«${b.name}» → ${STATUS[prev]} (буцаалаа)`); }
        catch (err) { snack(errText(err), { error: true }); }
      },
    });
  } catch (err) {
    patchRow(el, b);
    snack(errText(err), { error: true });
  } finally {
    $$('input[type="radio"]', el).forEach((x) => { x.disabled = false; });
  }
});
list.addEventListener('input', (e) => {
  const ta = e.target.closest('[data-f="note"]'); if (!ta) return;
  const el = ta.closest('.bk'), b = byId.get(el.dataset.id); if (!b) return;
  if (ta.value === (b.note || '')) noteDraft.delete(b.id); else noteDraft.set(b.id, ta.value);
  setNoteState(el, b);
  refreshDirty();
});

/* Спам цэвэрлэх: одоогийн шүүлтийн (нэг төлөвийн) бүх захиалгыг багцаар устгана */
bulk.addEventListener('click', async () => {
  if (filter === 'all' || q.trim()) return;
  const targets = bookings.filter((b) => b.status === filter);
  if (!targets.length) return;
  const ok = await dialog({
    title: `«${STATUS[filter]}» төлөвтэй ${targets.length} захиалгыг устгах уу?`,
    body: 'Бүгд бүр мөсөн устгагдана, буцаах боломжгүй. Ихэвчлэн спам цэвэрлэхэд ашиглана.',
    confirm: `${targets.length} захиалга устгах`, cancel: 'Болих', danger: true,
  });
  if (!ok) return;
  bulk.disabled = true;
  try {
    for (let i = 0; i < targets.length; i += 400) {
      const batch = writeBatch(db);
      targets.slice(i, i + 400).forEach((b) => batch.delete(ref(b.id)));
      await batch.commit();
    }
    snack(`${targets.length} захиалга устгагдлаа`);
  } catch (e) { snack(errText(e), { error: true }); }
  finally { bulk.disabled = false; }
});

/* ---------- Шинэ захиалгын мэдэгдэл (таб нээлттэй үед) ---------- */
const canNotify = 'Notification' in window;
const refreshNotifyBtn = () => { btnNotify.hidden = !canNotify || Notification.permission !== 'default'; };
refreshNotifyBtn();
btnNotify.addEventListener('click', async () => { try { await Notification.requestPermission(); } catch (_) { } refreshNotifyBtn(); });
const beep = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.18);
  } catch (_) { }
};
function notifyNew(fresh) {
  const first = fresh[0] || {};
  const body = `${first.name || ''} · ${first.phone || ''} · ${first.service || ''}`;
  snack(`Шинэ захиалга: ${body}`);
  beep();
  if (canNotify && Notification.permission === 'granted') {
    try { new Notification(fresh.length > 1 ? `${fresh.length} шинэ захиалга — SkinAid` : 'Шинэ захиалга — SkinAid', { body, icon: '/assets/img/apple-touch-icon.png?v=af82331c' }); } catch (_) { }
  }
}

/* Тэмдэглэл бичиж байгаад хуудаснаас гарахад сануулна (save bar-гүй — мөр бүр өөрийн товчтой) */
registerForm('bookings', {
  bar: false,
  isDirty: () => [...noteDraft.entries()].some(([id, v]) => { const b = byId.get(id); return !!b && v !== (b.note || ''); }),
});

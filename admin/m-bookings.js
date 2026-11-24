/* ==========================================================================
   SKIN AID admin — Модуль: Захиалга (bookings, realtime)
   Нягт жагсаалт (огноогоор бүлэглэсэн) → мөрийг дарж задлах. Статус нэг товшилтоор хадгалагдана («Буцаах»-тай),
   тэмдэглэл тусдаа хадгална. Хайлт: нэр, утас, үйлчилгээ, мессеж, тэмдэглэл.
   ========================================================================== */
import { collection, query, orderBy, limit, onSnapshot, doc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db, $, $$, esc, fmtDate, errText, session, msOf, updateTitle } from './core.js?v=2c361933';
import { ICON, dialog, snack, announce, registerForm, refreshDirty } from './ui.js?v=a5405b51';
import { dayKey, dayGroup, GROUP_ORDER, relTime, matchBooking, telHref } from './lib.js?v=a9638bd3';

const STATUS = { new: 'Шинэ', contacted: 'Холбогдсон', confirmed: 'Баталгаажсан', cancelled: 'Цуцалсан' };
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
const expanded = new Set();      // задалсан мөрүүд (дахин зурахад хадгална)
const noteDraft = new Map();     // id → хадгалаагүй тэмдэглэл
const busy = new Set();          // статус бичиж буй мөрүүд (давхар товшилт үл тоох)
const deletingHere = new Set();  // энэ табаас устгасан (өөр хүн устгасан гэж мэдэгдэхгүй)

/* ---------- Шүүлтийн chip, хайлт ---------- */
chips.innerHTML = [['all', 'Бүгд'], ...Object.entries(STATUS)].map(([k, v], i) =>
  `<button class="chip${i === 0 ? ' is-active' : ''}" type="button" data-f="${k}" aria-pressed="${i === 0}" data-status="${k}">${v} <span data-n></span></button>`).join('');
const setFilter = (f) => {
  filter = f;
  $$('.chip', chips).forEach((c) => { const on = c.dataset.f === f; c.classList.toggle('is-active', on); c.setAttribute('aria-pressed', String(on)); });
};
chips.addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  setFilter(b.dataset.f);
  applyFilter();
});
let qT = 0;
search.addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => { q = search.value; applyFilter(); }, 120); });
search.addEventListener('keydown', (e) => { if (e.key === 'Escape' && search.value) { search.value = ''; q = ''; applyFilter(); } });

/* ---------- Мөр ---------- */
// Статус: товчлуурын бүлэг (aria-pressed). Radio биш — сумаар шилжихэд завсрын төлөв бүр хадгалагдахгүй.
const statusSeg = (b) => `
  <div class="seg" role="group" aria-labelledby="bks-${esc(b.id)}">
    <span class="seg__label" id="bks-${esc(b.id)}">Төлөв <small>(дармагц хадгалагдана)</small></span>
    <div class="seg__opts">${Object.entries(STATUS).map(([k, v]) =>
      `<button type="button" class="seg__opt" data-act="status" data-status="${k}" aria-pressed="${k === b.status}">${v}</button>`).join('')}</div>
  </div>`;

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
          <span class="bk__notestate" data-notestate></span>
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
/** Фокустай мөрийг (бичиж/сонгож буй) дахин зурахгүй — зөвхөн төлөвийг шинэчилнэ */
function patchRow(el, b) {
  el.dataset.status = b.status;
  const badge = $('.bk__sum .badge', el);
  badge.dataset.status = b.status; badge.textContent = STATUS[b.status] || b.status;
  $$('.seg__opt', el).forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.status === b.status)));
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
  // Фокустай мөр устсан эсвэл шүүлтээс гарсан (жишээ нь «Шинэ» шүүлттэй үед «Холбогдсон» дарсан) бол
  // фокусыг дараагийн харагдах мөр рүү — local snapshot нь updateDoc дуусахаас өмнө ирдэг тул энд шийднэ
  const focusRow = focused && list.contains(focused) ? focused.closest('.bk[data-id]') : null;
  const order = $$('.bk[data-id]:not([hidden])', list).map((el) => el.dataset.id);
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
  existing.forEach((el, id) => {
    // Нээлттэй/засаж байсан захиалгыг өөр хүн (эсвэл өөр таб) устгасан бол мэдэгдэнэ
    if ((expanded.has(id) || noteDraft.has(id)) && !deletingHere.has(id)) snack(`«${($('.bk__name', el) || {}).textContent || 'Нэг'}» захиалга өөр газраас устгагдсан тул жагсаалтаас хасагдлаа.`);
    expanded.delete(id); noteDraft.delete(id); deletingHere.delete(id); busy.delete(id);
  });
  list.replaceChildren(frag);
  list.setAttribute('aria-busy', 'false');
  if (!bookings.length) list.innerHTML = `<div class="empty">${ICON.bookings}<p><strong>Одоогоор захиалга алга</strong><br>Сайтын маягтаар ирсэн хүсэлт энд шууд харагдана.</p></div>`;
  applyFilter();
  if (focused && list.contains(focused) && !focused.closest('[hidden]')) focused.focus({ preventScroll: true });   // replaceChildren фокусыг алдуулна
  else if (focusRow) {
    const i = order.indexOf(focusRow.dataset.id);
    const cand = [...order.slice(i + 1), ...order.slice(0, Math.max(i, 0)).reverse()];
    const rows = $$('.bk[data-id]', list);
    const t = cand.map((id) => rows.find((r) => r.dataset.id === id && !r.hidden)).find(Boolean);
    (t ? $('.bk__sum', t) : search).focus({ preventScroll: true });
  }
  const n = bookings.filter((b) => b.status === 'new').length;
  $('[data-n]', newCount).textContent = String(n);
  newCount.classList.toggle('is-on', n > 0);
  updateTitle({ newCount: n });
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
// Харьцангуй цагийг минут тутам шинэчилнэ; шөнө дунд өнгөрвөл бүлгүүдийг («Өнөөдөр» → «Өчигдөр») дахин зурна
let lastDay = dayKey(Date.now());
setInterval(() => {
  const now = Date.now();
  if (dayKey(now) !== lastDay) { lastDay = dayKey(now); render(); return; }
  $$('.bk__when[data-ms]', list).forEach((s) => { const ms = Number(s.dataset.ms); if (ms) s.textContent = relTime(ms, now); });
}, 60000);

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
  expanded.clear(); noteDraft.clear(); busy.clear(); deletingHere.clear();
  list.replaceChildren();
  newCount.classList.remove('is-on');
}
more.addEventListener('click', () => { pageLimit += PAGE; more.disabled = true; start(); });

/* ---------- Үйлдлүүд ---------- */
const ref = (id) => doc(db, 'bookings', id);
const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: session.user.email });

async function setStatus(el, b, next) {
  const id = b.id, prev = b.status;
  if (prev === next || busy.has(id)) return;
  busy.add(id);
  el.setAttribute('aria-busy', 'true');
  patchRow(el, { ...b, status: next });
  try {
    await updateDoc(ref(id), { status: next, ...stamp() });   // шүүлтээс гарсан мөрийн фокусыг render() шилжүүлнэ
    snack(`«${b.name}» → ${STATUS[next]}`, {
      action: 'Буцаах',
      onAction: async () => {
        const cur = byId.get(id);
        if (!cur) { snack('Захиалга устгагдсан тул буцаах боломжгүй.', { error: true }); return; }
        if (cur.status !== next) { snack(`Буцаасангүй — «${b.name}»-ийн төлөвийг энэ хооронд «${STATUS[cur.status] || cur.status}» болгосон байна.`, { error: true }); return; }
        try { await updateDoc(ref(id), { status: prev, ...stamp() }); snack(`«${b.name}» → ${STATUS[prev]} (буцаалаа)`); }
        catch (err) { snack(errText(err), { error: true }); }
      },
    });
  } catch (err) {
    patchRow(el, byId.get(id) || b);
    snack(errText(err), { error: true });
  } finally {
    busy.delete(id);
    el.removeAttribute('aria-busy');
  }
}

list.addEventListener('click', async (e) => {
  const sum = e.target.closest('.bk__sum');
  if (sum) { const el = sum.closest('.bk'); setOpen(el, sum.getAttribute('aria-expanded') !== 'true'); return; }
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'retry') { start(); return; }
  if (act === 'clear') { setFilter('all'); q = ''; search.value = ''; applyFilter(); search.focus(); return; }
  const el = btn.closest('.bk'); if (!el) return;
  const id = el.dataset.id, b = byId.get(id); if (!b) return;
  if (act === 'status') { setStatus(el, b, btn.dataset.status); return; }
  if (act === 'copy') {
    try { await navigator.clipboard.writeText(b.phone); snack(`${b.phone} хуулагдлаа`); }
    catch (_) { snack('Хуулж чадсангүй — дугаарыг гараар хуулна уу.', { error: true }); }
  } else if (act === 'note') {
    const submitted = $('[data-f="note"]', el).value;
    const note = submitted.trim().slice(0, 1000);
    btn.disabled = true;
    try {
      await updateDoc(ref(id), { note, ...stamp() });
      // Хадгалах хооронд нэмж бичсэн текстийг хаяхгүй — илгээсэнтэй ижил бол л ноорог устгана
      if (noteDraft.get(id) === submitted) noteDraft.delete(id);
      const st = $('[data-notestate]', el);
      st.dataset.flash = '1'; st.textContent = 'Хадгалагдлаа ✓';
      announce('Тэмдэглэл хадгалагдлаа');
      setTimeout(() => { delete st.dataset.flash; setNoteState(el, byId.get(id) || b); }, 2500);
      refreshDirty();
    } catch (err) { snack(errText(err), { error: true }); }
    finally { btn.disabled = false; }
  } else if (act === 'del') {
    if (btn.getAttribute('aria-disabled') === 'true') return;   // устгаж буй
    const ok = await dialog({
      title: 'Захиалгыг устгах уу?',
      body: [`«${b.name}» (${b.phone}) — ${b.service}.`, 'Бүр мөсөн устгагдана, буцаах боломжгүй. Дараа нь харах шаардлагатай бол «Цуцалсан» төлөв өгөх нь зөв.'],
      confirm: 'Устгах', cancel: 'Болих', danger: true,
    });
    if (!ok) return;
    // Мөр алга болоход render() фокусыг дараагийн мөр рүү шилжүүлнэ (устгах товч фокустай хэвээр байх ёстой — disabled хийхгүй)
    btn.setAttribute('aria-disabled', 'true');
    deletingHere.add(id);
    try {
      await deleteDoc(ref(id));
      snack(`«${b.name}» захиалга устгагдлаа`);
    } catch (err) { deletingHere.delete(id); snack(errText(err), { error: true }); btn.removeAttribute('aria-disabled'); }
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
  if (filter === 'all' || search.value.trim()) return;
  const status = filter;
  // Баталгаажуулсан жагсаалт: цонх нээлттэй байх хооронд шинээр ирсэн (жинхэнэ) захиалгыг устгахгүй
  const ids = new Set(bookings.filter((b) => b.status === status).map((b) => b.id));
  if (!ids.size) return;
  const ok = await dialog({
    title: `«${STATUS[status]}» төлөвтэй ${ids.size} захиалгыг устгах уу?`,
    body: 'Бүгд бүр мөсөн устгагдана, буцаах боломжгүй. Ихэвчлэн спам цэвэрлэхэд ашиглана.',
    confirm: `${ids.size} захиалга устгах`, cancel: 'Болих', danger: true,
  });
  if (!ok) return;
  // …мөн энэ хооронд төлөв нь өөрчлөгдсөнийг ч устгахгүй
  const targets = bookings.filter((b) => ids.has(b.id) && b.status === status);
  bulk.disabled = true;
  try {
    for (let i = 0; i < targets.length; i += 400) {
      const batch = writeBatch(db);
      targets.slice(i, i + 400).forEach((b) => { deletingHere.add(b.id); batch.delete(ref(b.id)); });
      await batch.commit();
    }
    snack(`${targets.length} захиалга устгагдлаа`);
    setFilter('all'); applyFilter();
    $('.chip[data-f="all"]', chips).focus();
  } catch (e) { snack(errText(e), { error: true }); }
  finally { bulk.disabled = false; }
});

/* ---------- Шинэ захиалгын мэдэгдэл (таб нээлттэй үед) ---------- */
const canNotify = 'Notification' in window;
const refreshNotifyBtn = () => { btnNotify.hidden = !canNotify || Notification.permission !== 'default'; };
refreshNotifyBtn();
btnNotify.addEventListener('click', async () => { try { await Notification.requestPermission(); } catch (_) { } refreshNotifyBtn(); });
let audio = null;   // нэг AudioContext-ийг дахин ашиглана (дуут дохио бүрт шинээр үүсгэвэл хөтөч хязгаарт хүрнэ)
const beep = () => {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const o = audio.createOscillator(); const g = audio.createGain();
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.18);
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

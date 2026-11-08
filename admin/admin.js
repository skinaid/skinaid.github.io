/* ==========================================================================
   SKIN AID — admin.js (ES module, backoffice)
   Google нэвтрэлт (allowlist) + Firestore: Захиалга (realtime), Тохиргоо, Үйлчилгээ/Багц.
   Хэрэглэгчийн оруулсан бүх текстийг esc()/textContent-ээр л дэлгэцэнд гаргана (XSS хамгаалалт).
   ========================================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFirestore, collection, query, orderBy, limit, onSnapshot, doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { firebaseConfig, ADMIN_EMAILS } from '../assets/js/firebase-config.js?v=0e85a329';
import { attachAppCheck } from '../assets/js/app-check.js?v=5df671db';

const app = initializeApp(firebaseConfig);
attachAppCheck(app);   // reCAPTCHA → App Check token (Firestore-д Enforce асаалттай)
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const str = (v, max) => (typeof v === 'string' ? v : '').trim().slice(0, max);
const telHref = (phone) => {
  const d = String(phone || '').replace(/[^0-9+]/g, '');
  if (d.startsWith('+')) return 'tel:' + d;
  if (d.startsWith('976') && d.length === 11) return 'tel:+' + d;
  return 'tel:+976' + d;
};
const DEFAULTS = window.SKINAID_DEFAULTS || { cats: {}, treatments: [], packages: [] };
const CATS = DEFAULTS.cats || {};
const STATUS = { new: 'Шинэ', contacted: 'Холбогдсон', confirmed: 'Баталгаажсан', cancelled: 'Цуцалсан' };
const TITLE = 'SkinAid — Удирдлага';

const fmtDate = (ts) => {
  const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : (ts instanceof Date ? ts : null);
  if (!d) return '—';
  // 2026-11-07 18:12 (Улаанбаатарын цаг, 24 цагийн формат) — sv-SE locale ISO маягаар гаргадаг
  try { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(',', ''); }
  catch (_) { return d.toISOString().slice(0, 16).replace('T', ' '); }
};
const errText = (e) => {
  const code = (e && e.code) || '';
  const map = {
    'permission-denied': 'Эрх хүрэхгүй: Firestore дүрэм эсвэл App Check (reCAPTCHA) энэ үйлдлийг татгалзлаа. Хуудсыг дахин ачаалаад оролдоно уу.',
    'unavailable': 'Firestore-той түр холбогдож чадсангүй. Сүлжээгээ шалгаад дахин оролдоно уу.',
    'unauthenticated': 'Нэвтрэлт дууссан байна. Дахин нэвтэрнэ үү.',
    'resource-exhausted': 'Өдрийн үнэгүй квот (Spark) дууссан байна. Улаанбаатарын цагаар өглөө ~16:00-д шинэчлэгдэнэ — дараа нь «Дахин холбогдох» дарна уу.',
    'auth/popup-closed-by-user': 'Нэвтрэх цонх хаагдлаа.',
    'auth/cancelled-popup-request': 'Нэвтрэх цонх хаагдлаа.',
    'auth/popup-blocked': 'Браузер popup цонхыг блоклосон байна. Энэ сайтад popup зөвшөөрөөд дахин оролдоно уу.',
    'auth/unauthorized-domain': 'Энэ домэйн Firebase Authentication → Authorized domains-д бүртгэгдээгүй байна.',
    'auth/network-request-failed': 'Сүлжээний алдаа. Интернэт холболтоо шалгана уу.',
  };
  return map[code] || ('Алдаа гарлаа' + (code ? ' (' + code + ')' : '') + '.');
};

/* ---------- Toast ---------- */
const toastEl = $('#toast'); let toastT = 0;
const toast = (msg) => { toastEl.textContent = msg; toastEl.classList.add('is-on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('is-on'), 3200); };
const setStatus = (el, msg, kind) => { el.textContent = msg; el.classList.toggle('is-ok', kind === 'ok'); el.classList.toggle('is-err', kind === 'err'); };

/* ==========================================================================
   Нэвтрэлт
   ========================================================================== */
const gate = $('#gate'), shell = $('#shell'), gateErr = $('#gateErr'), btnLogin = $('#btnLogin');
let gateMessage = '';
let currentUser = null;
let stopBookings = null;

const showGate = () => {
  shell.hidden = true; gate.hidden = false;
  gateErr.hidden = !gateMessage; gateErr.textContent = gateMessage;
  btnLogin.disabled = false;
};
const isAdminUser = (u) => !!u && !!u.email && u.emailVerified && ADMIN_EMAILS.includes(u.email.toLowerCase());

btnLogin.addEventListener('click', async () => {
  gateMessage = ''; gateErr.hidden = true; btnLogin.disabled = true;
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  } catch (e) {
    gateMessage = errText(e); showGate();
  }
});
$('#btnLogout').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (!user) { teardown(); showGate(); return; }
  if (!isAdminUser(user)) {
    gateMessage = `«${user.email || 'энэ бүртгэл'}» хаягт удирдлагын эрх байхгүй. Эрхтэй Google бүртгэлээр нэвтэрнэ үү.`;
    await signOut(auth);   // onAuthStateChanged(null) → showGate() gateMessage-тэй
    return;
  }
  currentUser = user;
  $('#whoEmail').textContent = user.email;
  gate.hidden = true; shell.hidden = false;
  startBookings();
  loadSite();
  renderPages(null);
  loadCatalog();
});
const teardown = () => {
  currentUser = null;
  if (stopBookings) { stopBookings(); stopBookings = null; }
  bookings = []; knownIds = null; renderBookings();
  document.title = TITLE;
};

/* ==========================================================================
   Цэс (модулиуд)
   ========================================================================== */
$$('.menu button').forEach(b => b.addEventListener('click', () => {
  $$('.menu button').forEach(x => x.removeAttribute('aria-current'));
  b.setAttribute('aria-current', 'page');
  $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + b.dataset.view; });
  const h = $('#view-' + b.dataset.view + ' h1'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
}));

/* ==========================================================================
   Модуль 1: Захиалга (realtime)
   ========================================================================== */
const bkList = $('#bkList'), bkChips = $('#bkChips'), bkMeta = $('#bkMeta'), newCount = $('#newCount'), btnNotify = $('#btnNotify');
const bkMore = $('#bkMore'), bkBulk = $('#bkBulk');
const PAGE = 300;
let pageLimit = PAGE;       // «Цааш» дарахад PAGE-ээр нэмэгдэж дахин бүртгүүлнэ (хуучин захиалга ч харагдана)
let bookings = [];
let knownIds = null;        // анхны snapshot-оос хойш шинээр ирснийг таних
let newestKnownMs = 0;      // хуучин doc цонхонд буцаж орж ирэхэд «шинэ» гэж дуугарахгүй
let filter = 'all';
const createdMs = (b) => (b && b.createdAt && typeof b.createdAt.toMillis === 'function') ? b.createdAt.toMillis() : 0;

bkChips.innerHTML = [['all', 'Бүгд'], ...Object.entries(STATUS)].map(([k, v], i) =>
  `<button class="chip${i === 0 ? ' is-active' : ''}" type="button" data-f="${k}" aria-pressed="${i === 0}">${v} <span data-n></span></button>`).join('');
bkChips.addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  filter = b.dataset.f;
  $$('.chip', bkChips).forEach(c => { const on = c === b; c.classList.toggle('is-active', on); c.setAttribute('aria-pressed', String(on)); });
  applyFilter();
});

const cardHTML = (b) => `
  <div class="bk__who">
    <h3>${esc(b.name)}</h3>
    <a href="${telHref(b.phone)}">${esc(b.phone)}</a>
    <span class="badge" data-status="${esc(b.status)}">${esc(STATUS[b.status] || b.status)}</span>
  </div>
  <div class="bk__when">Ирсэн: ${esc(fmtDate(b.createdAt))}${b.updatedBy ? `<br>Зассан: ${esc(fmtDate(b.updatedAt))} · ${esc(b.updatedBy)}` : ''}</div>
  <div class="bk__row">
    <span><strong>Үйлчилгээ</strong>${esc(b.service)}</span>
    <span><strong>Хүссэн огноо</strong>${esc(b.date || 'тохиролцоно')}</span>
    ${b.message ? `<div class="bk__msg">${esc(b.message)}</div>` : ''}
  </div>
  <div class="bk__ctl">
    <select aria-label="Статус" data-f="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === b.status ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <textarea aria-label="Тэмдэглэл" data-f="note" maxlength="1000" placeholder="Тэмдэглэл: залгасан эсэх, тохирсон цаг…">${esc(b.note || '')}</textarea>
    <button class="btn btn--primary btn--sm" type="button" data-act="save">Хадгалах</button>
    <button class="btn btn--ghost btn--sm" type="button" data-act="del">Устгах</button>
  </div>`;

const renderBookings = () => {
  const focused = document.activeElement;   // бичиж байсан textarea-ийн фокусыг дахин зурсны дараа сэргээнэ
  const existing = new Map($$('.bk', bkList).map(el => [el.dataset.id, el]));
  const frag = document.createDocumentFragment();
  bookings.forEach(b => {
    let el = existing.get(b.id);
    const dirty = el && (el.dataset.dirty === '1' || el.contains(document.activeElement));
    if (!el || !dirty) {
      const fresh = document.createElement('article');
      fresh.className = 'bk'; fresh.dataset.id = b.id; fresh.dataset.status = b.status;
      fresh.innerHTML = cardHTML(b);
      el = fresh;
    }
    existing.delete(b.id);
    frag.appendChild(el);
  });
  existing.forEach(el => el.remove());
  bkList.replaceChildren(frag);
  if (focused && bkList.contains(focused)) focused.focus({ preventScroll: true });
  if (!bookings.length) bkList.innerHTML = '<div class="empty">Одоогоор захиалга байхгүй. Сайтын маягтаар ирсэн хүсэлт энд шууд харагдана.</div>';
  applyFilter();
  const n = bookings.filter(b => b.status === 'new').length;
  $('[data-n]', newCount).textContent = String(n); newCount.classList.toggle('is-on', n > 0);
  document.title = (n ? `(${n}) ` : '') + TITLE;
  const counts = { all: bookings.length };
  bookings.forEach(b => { counts[b.status] = (counts[b.status] || 0) + 1; });
  $$('.chip', bkChips).forEach(c => { $('[data-n]', c).textContent = counts[c.dataset.f] ? `(${counts[c.dataset.f]})` : ''; });
};
const applyFilter = () => {
  let shown = 0;
  $$('.bk', bkList).forEach(el => { const on = filter === 'all' || el.dataset.status === filter; el.hidden = !on; if (on) shown++; });
  const capped = bookings.length >= pageLimit;
  bkMeta.textContent = bookings.length ? `${shown} захиалга харуулж байна${capped ? ` (зөвхөн сүүлийн ${pageLimit} — хуучныг «Цааш ачаалах» дарж татна)` : ''}` : '';
  bkBulk.hidden = filter === 'all' || shown === 0;
  bkBulk.textContent = `«${STATUS[filter] || ''}» төлөвтэй ${shown}-ийг устгах`;
};

const startBookings = () => {
  if (stopBookings) stopBookings();
  const q = query(collection(db, 'bookings'), orderBy('createdAt', 'desc'), limit(pageLimit));
  stopBookings = onSnapshot(q, (snap) => {
    bookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (knownIds) {
      // Зөвхөн үнэхээр шинэ (status=new, өмнө мэдэгдэж байснаас хожуу үүссэн) doc-д мэдэгдэнэ;
      // устгасны дараа цонхонд буцаж орж ирсэн хуучин захиалга эсвэл «Цааш» дарахад татагдсан doc-д биш
      const fresh = snap.docChanges()
        .filter(ch => ch.type === 'added' && !knownIds.has(ch.doc.id))
        .map(ch => ({ id: ch.doc.id, ...ch.doc.data() }))
        .filter(b => b.status === 'new' && createdMs(b) > newestKnownMs);
      if (fresh.length) notifyNew(fresh);
    }
    knownIds = new Set(snap.docs.map(d => d.id));
    newestKnownMs = Math.max(newestKnownMs, ...bookings.map(createdMs));
    bkMore.hidden = snap.size < pageLimit; bkMore.disabled = false;
    renderBookings();
  }, (e) => {
    toast(errText(e));
    bkList.innerHTML = `<div class="empty">${esc(errText(e))}<br><br><button class="btn btn--outline btn--sm" type="button" data-act="retry">Дахин холбогдох</button></div>`;
  });
};
bkMore.addEventListener('click', () => { pageLimit += PAGE; bkMore.disabled = true; startBookings(); });

/* Спам цэвэрлэх: одоогийн шүүлтийн (нэг төлөвийн) бүх захиалгыг багцаар устгана — 2 удаа баталгаажуулна */
bkBulk.addEventListener('click', async () => {
  if (filter === 'all') return;
  const targets = bookings.filter(b => b.status === filter);
  if (!targets.length) return;
  if (!confirm(`«${STATUS[filter]}» төлөвтэй ${targets.length} захиалгыг БҮГДИЙГ нь бүр мөсөн устгах уу? Буцаах боломжгүй.`)) return;
  if (!confirm(`Дахин баталгаажуулна уу: ${targets.length} захиалга устгана.`)) return;
  bkBulk.disabled = true;
  try {
    for (let i = 0; i < targets.length; i += 400) {
      const batch = writeBatch(db);
      targets.slice(i, i + 400).forEach(b => batch.delete(doc(db, 'bookings', b.id)));
      await batch.commit();
    }
    toast(`${targets.length} захиалга устгагдлаа`);
  } catch (e) { toast(errText(e)); }
  finally { bkBulk.disabled = false; }
});

bkList.addEventListener('input', (e) => { const card = e.target.closest('.bk'); if (card) card.dataset.dirty = '1'; });
bkList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  if (btn.dataset.act === 'retry') { startBookings(); return; }
  const card = btn.closest('.bk'); const id = card.dataset.id;
  const ref = doc(db, 'bookings', id);
  if (btn.dataset.act === 'del') {
    const b = bookings.find(x => x.id === id);
    if (!confirm(`«${b ? b.name : id}» захиалгыг бүр мөсөн устгах уу? Буцаах боломжгүй.`)) return;
    btn.disabled = true;
    try { await deleteDoc(ref); toast('Захиалга устгагдлаа'); } catch (err) { toast(errText(err)); btn.disabled = false; }
    return;
  }
  if (btn.dataset.act === 'save') {
    const status = $('[data-f="status"]', card).value;
    const note = $('[data-f="note"]', card).value.trim().slice(0, 1000);
    if (!STATUS[status]) return;
    btn.disabled = true; btn.textContent = 'Хадгалж байна…';
    try {
      await updateDoc(ref, { status, note, updatedAt: serverTimestamp(), updatedBy: currentUser.email });
      delete card.dataset.dirty;
      toast('Хадгалагдлаа');
    } catch (err) { toast(errText(err)); }
    finally { btn.disabled = false; btn.textContent = 'Хадгалах'; }
  }
});

/* Шинэ захиалгын мэдэгдэл (таб нээлттэй үед) */
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
const notifyNew = (list) => {
  const first = list[0] || {};
  const body = `${first.name || ''} · ${first.phone || ''} · ${first.service || ''}`;
  toast(`Шинэ захиалга: ${body}`);
  beep();
  if (canNotify && Notification.permission === 'granted') {
    try { new Notification(list.length > 1 ? `${list.length} шинэ захиалга — SkinAid` : 'Шинэ захиалга — SkinAid', { body, icon: '../assets/img/apple-touch-icon.png?v=af82331c' }); } catch (_) { }
  }
};

/* ==========================================================================
   Модуль 2: Тохиргоо (settings/site)
   ========================================================================== */
const siteForm = $('#siteForm'), siteStatus = $('#siteStatus');
const siteRef = doc(db, 'settings', 'site');
const loadSite = async () => {
  try {
    const snap = await getDoc(siteRef);
    const s = snap.exists() ? snap.data() : {};
    $('#s-hours').value = typeof s.hours === 'string' ? s.hours : '';
    $('#s-phone').value = typeof s.phone === 'string' ? s.phone : '';
    $('#s-email').value = typeof s.email === 'string' ? s.email : '';
    $('#s-booking').checked = s.bookingEnabled !== false;
    $('#s-promo').checked = s.promoEnabled !== false;
    setStatus(siteStatus, snap.exists() ? `Сүүлд хадгалсан: ${fmtDate(s.updatedAt)} · ${s.updatedBy || ''}` : 'Одоогоор хадгалсан тохиргоо байхгүй — сайт анхны утгаараа байна.', '');
  } catch (e) { setStatus(siteStatus, errText(e), 'err'); }
};
siteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    hours: str($('#s-hours').value, 300),
    phone: str($('#s-phone').value, 30),
    email: str($('#s-email').value, 80),
    bookingEnabled: $('#s-booking').checked,
    promoEnabled: $('#s-promo').checked,
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.email,
  };
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) { setStatus(siteStatus, 'И-мэйл хаяг буруу байна.', 'err'); return; }
  if (data.phone) {
    const digits = data.phone.replace(/[^0-9]/g, '');
    if (!/^[-0-9+ ]+$/.test(data.phone) || digits.length < 7 || digits.length > 12) { setStatus(siteStatus, 'Нэг утасны дугаар оруулна уу (7–12 орон, жишээ: 7600-0505). Хоёр дугаар бичиж болохгүй.', 'err'); return; }
  }
  const btn = $('#btnSaveSite'); btn.disabled = true;
  setStatus(siteStatus, 'Хадгалж байна…', '');
  try { await setDoc(siteRef, data); setStatus(siteStatus, 'Хадгалагдлаа — сайт дээр дараагийн ачааллаас харагдана.', 'ok'); toast('Тохиргоо хадгалагдлаа'); }
  catch (err) { setStatus(siteStatus, errText(err), 'err'); }
  finally { btn.disabled = false; }
});

/* ==========================================================================
   Модуль 3: Үйлчилгээ / Багц (settings/catalog)
   ========================================================================== */
const catRef = doc(db, 'settings', 'catalog');
const svcBody = $('#svcTable tbody'), pkgBody = $('#pkgTable tbody'), catStatus = $('#catStatus');
const catOptions = (sel) => Object.entries(CATS).map(([k, v]) => `<option value="${esc(k)}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
// Нийтлэгдсэн эмчилгээний хуудастай холбоотой үйлчилгээ (build: admin/pages-status.js) — зөвхөн харуулна, хадгалахгүй
const PAGE_BY_ID = {};
((window.SKINAID_PAGES_STATUS || {}).pages || []).forEach(p => { if (p.url) p.catalogIds.forEach(id => { PAGE_BY_ID[id] = p.url; }); });
const svcRow = (s) => {
  const tr = document.createElement('tr');
  tr.dataset.id = s.id; if (s.hidden) tr.classList.add('is-hidden');
  const page = PAGE_BY_ID[s.id];
  tr.innerHTML = `
    <td class="c-cat"><select aria-label="Ангилал" data-k="c">${catOptions(s.c)}</select></td>
    <td class="c-name"><input type="text" aria-label="Нэр" data-k="n" maxlength="120" value="${esc(s.n)}">${page ? `<a class="svc-page" href="${esc(page)}" target="_blank" rel="noopener" title="Энэ үйлчилгээний үнэ эмчилгээний хуудсанд ч харагдана — үнэ өөрчилбөл repo-ийн catalog-defaults.js-ийг мөн шинэчилнэ">↗ ${esc(page)}</a>` : ''}</td>
    <td class="c-desc"><input type="text" aria-label="Тайлбар" data-k="d" maxlength="300" value="${esc(s.d)}"></td>
    <td class="c-time"><input type="text" aria-label="Хугацаа" data-k="t" maxlength="30" value="${esc(s.t)}"></td>
    <td class="c-price"><input type="text" aria-label="Үнэ" data-k="p" maxlength="40" value="${esc(s.p)}"></td>
    <td class="c-hide"><input type="checkbox" aria-label="Нуух" data-k="hidden"${s.hidden ? ' checked' : ''}></td>
    <td class="c-hide"><button class="btn btn--ghost btn--sm" type="button" data-act="rm" aria-label="Мөр устгах">✕</button></td>`;
  return tr;
};
const pkgRow = (p) => {
  const tr = document.createElement('tr');
  tr.dataset.id = p.id; if (p.hidden) tr.classList.add('is-hidden');
  tr.innerHTML = `
    <td>${esc(p.id)}</td>
    <td class="c-name"><input type="text" aria-label="Багцын нэр" data-k="name" maxlength="60" value="${esc(p.name)}"></td>
    <td class="c-price"><input type="text" aria-label="Үнэ" data-k="price" maxlength="40" value="${esc(p.price)}"></td>
    <td class="c-hide"><input type="checkbox" aria-label="Нуух" data-k="hidden"${p.hidden ? ' checked' : ''}></td>`;
  return tr;
};
const normSvc = (s) => ({ id: str(s && s.id, 40) || ('svc-' + Date.now().toString(36)), c: CATS[s && s.c] ? s.c : 'minor', n: str(s && s.n, 120), d: str(s && s.d, 300), t: str(s && s.t, 30), p: str(s && s.p, 40), hidden: !!(s && s.hidden) });
const normPkg = (p) => ({ id: str(p && p.id, 10), name: str(p && p.name, 60), price: str(p && p.price, 40), hidden: !!(p && p.hidden) });
const fillCatalog = (services, packages) => {
  svcBody.replaceChildren(...services.map(normSvc).map(svcRow));
  // Багц: id-г HTML картуудтай (p1..p5) тааруулж, анхны жагсаалтыг суурь болгоно
  const byId = new Map(packages.map(normPkg).map(p => [p.id, p]));
  pkgBody.replaceChildren(...DEFAULTS.packages.map(d => pkgRow(byId.get(d.id) || normPkg(d))));
  $('#svcCount').textContent = String(svcBody.children.length);
};
const loadCatalog = async () => {
  try {
    const snap = await getDoc(catRef);
    if (snap.exists() && Array.isArray(snap.data().services)) {
      const c = snap.data();
      fillCatalog(c.services, Array.isArray(c.packages) ? c.packages : []);
      renderPages(c.services);
      setStatus(catStatus, `Сүүлд хадгалсан: ${fmtDate(c.updatedAt)} · ${c.updatedBy || ''}`, '');
    } else {
      fillCatalog(DEFAULTS.treatments, DEFAULTS.packages);
      setStatus(catStatus, 'Firestore-д каталог хадгалагдаагүй — анхны утгыг харуулж байна. Хадгалбал сайт эндхийг уншина.', '');
    }
  } catch (e) { fillCatalog(DEFAULTS.treatments, DEFAULTS.packages); setStatus(catStatus, errText(e), 'err'); }
};
$('#btnCatDefaults').addEventListener('click', () => {
  if (!confirm('Хүснэгтийг анхны утгаар дүүргэх үү? (Хадгалах дарах хүртэл Firestore өөрчлөгдөхгүй)')) return;
  fillCatalog(DEFAULTS.treatments, DEFAULTS.packages);
  setStatus(catStatus, 'Анхны утга дүүргэгдлээ — хадгалахаа мартуузай.', '');
});
$('#btnSvcAdd').addEventListener('click', () => {
  const tr = svcRow(normSvc({ id: 'svc-' + Date.now().toString(36), c: 'minor' }));
  svcBody.appendChild(tr); $('#svcCount').textContent = String(svcBody.children.length);
  $('[data-k="n"]', tr).focus();
});
svcBody.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act="rm"]'); if (!b) return;
  const tr = b.closest('tr');
  if (PAGE_BY_ID[tr.dataset.id] && !confirm(`Энэ үйлчилгээ ${PAGE_BY_ID[tr.dataset.id]} хуудастай холбоотой. Устгавал дахин нэмэхэд холбоос сэргэхгүй (шинэ id). Түр нуух бол «Нуух»-ыг сонгоно уу. Устгах уу?`)) return;
  tr.remove(); $('#svcCount').textContent = String(svcBody.children.length);
});
[svcBody, pkgBody].forEach(tb => tb.addEventListener('change', (e) => {
  if (e.target.matches('[data-k="hidden"]')) e.target.closest('tr').classList.toggle('is-hidden', e.target.checked);
}));
const readRows = (tbody, keys) => $$('tr', tbody).map(tr => {
  const o = { id: tr.dataset.id };
  keys.forEach(k => { const el = $(`[data-k="${k}"]`, tr); o[k] = el ? (el.type === 'checkbox' ? el.checked : el.value) : ''; });
  return o;
});
$('#catForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const services = readRows(svcBody, ['c', 'n', 'd', 't', 'p', 'hidden']).map(normSvc).filter(s => s.n);
  const packages = readRows(pkgBody, ['name', 'price', 'hidden']).map(normPkg);
  if (services.length > 200) { setStatus(catStatus, 'Үйлчилгээ 200-аас ихгүй байна.', 'err'); return; }
  if (!services.some(s => !s.hidden) && !confirm('Нэг ч үйлчилгээ харагдахгүй болно — сайтын жагсаалт хоосон гарна. Үргэлжлүүлэх үү?')) return;
  const btn = $('#btnSaveCat'); btn.disabled = true;
  setStatus(catStatus, 'Хадгалж байна…', '');
  try {
    await setDoc(catRef, { services, packages, updatedAt: serverTimestamp(), updatedBy: currentUser.email });
    setStatus(catStatus, `Хадгалагдлаа (${services.length} үйлчилгээ, ${packages.length} багц) — сайт дээр дараагийн ачааллаас харагдана.`, 'ok');
    toast('Каталог хадгалагдлаа');
    fillCatalog(services, packages);
  } catch (err) { setStatus(catStatus, errText(err), 'err'); }
  finally { btn.disabled = false; }
});

/* ==========================================================================
   Модуль 4: Эмчилгээний хуудас (зөвхөн харах; өгөгдөл: build-ийн admin/pages-status.js)
   ========================================================================== */
function renderPages(fsServices) {
  const tb = $('#pgTable tbody'); if (!tb) return;
  const ST = (window.SKINAID_PAGES_STATUS || {}).pages || [];
  const STAGE = { planned: 'Төлөвлөсөн', drafting: 'Ноорог бичиж буй', review: 'Эмч хянаж буй', approved: 'Баталсан', published: 'Нийтэлсэн' };
  const nameOf = (id) => { const t = (DEFAULTS.treatments || []).find(x => x.id === id); return t ? t.n : id; };
  tb.replaceChildren(...ST.map(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(p.h1)}</strong><br>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a>` : `<span class="muted">/emchilgee/${esc(p.slug)}</span>`}<br><span class="muted">Түлхүүр үг: ${esc(p.primary)}</span></td>
      <td>${esc(String(p.week))}<br><span class="muted">${esc(p.weekStart)}</span></td>
      <td><span class="badge" data-stage="${esc(p.stage)}">${esc(STAGE[p.stage] || p.stage)}</span></td>
      <td>${p.reviewer ? esc(p.reviewer) + (p.reviewerConsent ? '' : '<br><span class="muted">зөвшөөрөл хүлээгдэж буй</span>') : '<span class="muted">томилоогүй</span>'}</td>
      <td>${p.lastReviewed ? esc(p.lastReviewed) : '—'}</td>
      <td>${esc(p.sitePrice)}</td>
      <td>${p.catalogIds.map(id => esc(nameOf(id))).join('<br>')}</td>`;
    return tr;
  }));
  const count = (st) => ST.filter(p => p.stage === st).length;
  $('#pgStats').innerHTML = ['published', 'approved', 'review', 'drafting', 'planned']
    .map(st => `<div class="pg-stat"><strong>${count(st)}</strong><span>${esc(STAGE[st])}</span></div>`).join('');
  // Анхааруулга: нийтлэгдсэн хуудасны үйлчилгээ admin-д нуугдсан/устсан, эсвэл үнэ сайтын хуудаснаас зөрсөн
  const warn = [];
  if (Array.isArray(fsServices)) {
    const byId = new Map(fsServices.map(s => [s && s.id, s]));
    ST.filter(p => p.url).forEach(p => p.catalogIds.forEach(id => {
      const s = byId.get(id), d = (DEFAULTS.treatments || []).find(x => x.id === id) || {};
      if (!s) warn.push(`${p.url}: «${nameOf(id)}» үйлчилгээ admin-ий жагсаалтад алга (устгагдсан).`);
      else if (s.hidden) warn.push(`${p.url}: «${nameOf(id)}» admin-д нуугдсан ч эмчилгээний хуудсанд харагдаж байна.`);
      else if ((s.p || '') !== (d.p || '')) warn.push(`${p.url}: «${nameOf(id)}» үнэ admin-д «${s.p || '—'}», сайтын хуудсанд «${d.p || '—'}» — repo-ийн catalog-defaults.js-ийг шинэчилнэ.`);
    }));
  }
  $('#pgWarn').innerHTML = warn.map(w => `<li>${esc(w)}</li>`).join('');
}

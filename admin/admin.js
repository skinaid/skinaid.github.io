/* ==========================================================================
   SKIN AID — admin.js (ES module, backoffice)
   Google нэвтрэлт (allowlist) + Firestore: Захиалга (realtime), Тохиргоо, Нүүр хуудас, Үйлчилгээ/Багц.
   Хэрэглэгчийн оруулсан бүх текстийг esc()/textContent-ээр л дэлгэцэнд гаргана (XSS хамгаалалт).
   ========================================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFirestore, collection, query, orderBy, limit, onSnapshot, doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
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
$('#btnLogout').addEventListener('click', () => {
  if (homeDirty && !confirm('«Нүүр хуудас»-ны хадгалаагүй өөрчлөлт алга болно. Гарах уу?')) return;
  homeDirty = false;
  signOut(auth);
});

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
  loadHome();
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
const PRICE_PAGE_BY_ID = {};   // үнэ нь эмчилгээний хуудсанд харагддаг (catalogIds + alsoIds)
((window.SKINAID_PAGES_STATUS || {}).pages || []).forEach(p => {
  if (!p.url) return;
  p.catalogIds.forEach(id => { PAGE_BY_ID[id] = p.url; });
  (p.priceIds || p.catalogIds).forEach(id => { PRICE_PAGE_BY_ID[id] = PRICE_PAGE_BY_ID[id] || p.url; });
});
const svcRow = (s) => {
  const tr = document.createElement('tr');
  tr.dataset.id = s.id; if (s.hidden) tr.classList.add('is-hidden');
  const page = PAGE_BY_ID[s.id] || PRICE_PAGE_BY_ID[s.id];
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
  const linked = PAGE_BY_ID[tr.dataset.id] || PRICE_PAGE_BY_ID[tr.dataset.id];
  if (linked && !confirm(`Энэ үйлчилгээ ${linked} хуудастай холбоотой. Устгавал дахин нэмэхэд холбоос сэргэхгүй (шинэ id). Түр нуух бол «Нуух»-ыг сонгоно уу. Устгах уу?`)) return;
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
    renderPages(services);
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
    ST.filter(p => p.url).forEach(p => (p.priceIds || p.catalogIds).forEach(id => {
      const s = byId.get(id), d = (DEFAULTS.treatments || []).find(x => x.id === id) || {};
      if (!s) warn.push(`${p.url}: «${nameOf(id)}» үйлчилгээ admin-ий жагсаалтад алга (устгагдсан).`);
      else if (s.hidden) warn.push(`${p.url}: «${nameOf(id)}» admin-д нуугдсан ч эмчилгээний хуудсанд харагдаж байна.`);
      else if ((s.p || '') !== (d.p || '')) warn.push(`${p.url}: «${nameOf(id)}» үнэ admin-д «${s.p || '—'}», сайтын хуудсанд «${d.p || '—'}» — repo-ийн catalog-defaults.js-ийг шинэчилнэ.`);
    }));
  }
  $('#pgWarn').innerHTML = warn.map(w => `<li>${esc(w)}</li>`).join('');
}

/* ==========================================================================
   Модуль 5: Нүүр хуудас (settings/home) — hero + «Зөвлөгөө» картууд
   HTML загвар: /assets/js/home-render.js (сайт, build-тэй ижил). Анхны утга, сайтын зургууд, дотоод хуудсууд,
   repo-ийн хувилбар (rev): /admin/home-data.js (build: content/home.json). Хориотой үг: ./claims.js (build: tools/lib/claims.mjs).
   ========================================================================== */
const HR = window.SKINAID_HOME_RENDER;
const HOME_DATA = window.SKINAID_HOME_DATA || { rev: '', defaults: null, photos: [], internalPaths: [], claimsAllow: [] };
const homeRef = doc(db, 'settings', 'home');
const homeForm = $('#homeForm'), homeStatus = $('#homeStatus'), hmPosts = $('#hmPosts'), hmWarn = $('#hmWarn');
const HERO_KEYS = ['badge', 'titlePre', 'titleEm', 'titlePost', 'text', 'btnPrimary', 'btnSecondary'];
const HM_MAX = (HR && HR.LIMITS.posts) || 12;
let findClaims = null, claimsFailed = false;   // ./claims.js ачаалагдахгүй бол зөвхөн хориотой үгийн анхааруулга алга (мэдэгдэнэ)
import('./claims.js?v=b71d5c91').then((m) => { findClaims = m.findClaims; renderHomeAux(); }).catch(() => { claimsFailed = true; renderHomeAux(); });
// Маягт аль хувилбар дээр суурилсан бэ: Firestore doc-ийн updatedAt (millis; doc байхгүй бол null) — давхар засварын шалгалт.
// SELF = хадгалсны дараа серверийн цагийг уншиж чадаагүй (дараагийн шалгалтад updatedBy-ээр өөрийн хадгалалт гэж таньна).
const SELF = 'self';
let homeBaseMs = null;
let homeReady = false;   // эхний ачаалал амжилттай болтол маягт түгжээтэй (repo-ийн утгыг амьд гэж андуурч дарж бичихгүй)
let homeLive = false;    // сайт Firestore-ийн хувилбарыг харуулж байгаа эсэх (repo шинэчлэгдсэн бол үгүй — main.js baseRev)
let homeDirty = false;
let rowSeq = 0;
let lastWarnHTML = null;
const brokenImgs = new Set();

const noV = (p) => String(p || '').replace(/\?.*$/, '');
const adminSrc = (p) => (/^assets\//.test(p) ? '/' + p : p);   // admin /admin/ дээр — сайтын зам root-оос
const photoOf = (img) => HOME_DATA.photos.find((x) => noV(x) === noV(img)) || '';
const newPostId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const msOf = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null);
/** content/home.json-ийн хэлбэрээр харьцуулах (?v-гүй зураг, updatedAt-гүй) */
const homeKey = (x) => JSON.stringify(HR && x ? HR.forRepo(x) : null);
const lockHome = (on) => { homeForm.inert = on; homeForm.classList.toggle('is-locked', on); $('#btnHomeDefaults').disabled = on; };
lockHome(true);

const statRow = (s, i) => {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${i + 1}</td>
    <td class="c-num"><input type="text" inputmode="numeric" aria-label="${i + 1}-р статистикийн тоо" data-s="num" maxlength="9"></td>
    <td class="c-suf"><input type="text" aria-label="${i + 1}-р статистикийн дагавар" data-s="suffix" maxlength="4"></td>
    <td><input type="text" aria-label="${i + 1}-р статистикийн тайлбар" data-s="label" maxlength="40"></td>`;
  ['num', 'suffix', 'label'].forEach((k) => { $(`[data-s="${k}"]`, tr).value = (s && s[k]) || ''; });
  return tr;
};

const postRow = (p) => {
  const el = document.createElement('article');
  const rid = 'hp' + (++rowSeq);
  el.className = 'hm-post';
  el.dataset.id = p.id || newPostId();
  const photo = p.img ? photoOf(p.img) : '';
  const custom = !!p.img && !photo;
  el.innerHTML = `
    <div class="hm-post__img"><img alt="" data-k="thumb" hidden><span class="hm-post__noimg" data-k="noimg">Зураггүй</span></div>
    <div class="hm-post__fields">
      <div class="field">
        <label for="${rid}-cat">Ангилал</label>
        <input id="${rid}-cat" type="text" data-k="cat" maxlength="30" placeholder="жишээ: Батга">
      </div>
      <div class="field">
        <label for="${rid}-by">Эмчийн нэр</label>
        <input id="${rid}-by" type="text" data-k="by" maxlength="60" placeholder="жишээ: Э.Өнөрсайхан эмч">
      </div>
      <div class="field field--full">
        <label for="${rid}-title">Гарчиг *</label>
        <input id="${rid}-title" type="text" data-k="title" maxlength="120">
      </div>
      <div class="field field--full">
        <label for="${rid}-text">Товч тайлбар <small>(нэг догол мөр — мөр шилжилт хадгалагдахгүй)</small></label>
        <textarea id="${rid}-text" data-k="text" maxlength="300"></textarea>
      </div>
      <div class="field field--full">
        <label for="${rid}-url">Холбоос (заавал биш) <small>— Facebook пост гэх мэт https://…, эсвэл сайтын хуудас: ${esc(HOME_DATA.internalPaths.join(', '))}</small></label>
        <input id="${rid}-url" type="url" data-k="url" maxlength="500" placeholder="https://www.facebook.com/Skinaid.mn/posts/…">
      </div>
      <div class="field">
        <label for="${rid}-img">Зураг</label>
        <select id="${rid}-img" data-k="imgSel">
          <option value="">— Зураггүй —</option>
          ${HOME_DATA.photos.map((x) => `<option value="${esc(x)}">${esc(noV(x).replace(/^assets\/img\/photos\//, ''))}</option>`).join('')}
          <option value="__url">Өөр зураг (https холбоос)…</option>
        </select>
      </div>
      <div class="field" data-k="imgUrlWrap" hidden>
        <label for="${rid}-imgurl">Зургийн шууд холбоос (https://…jpg)</label>
        <input id="${rid}-imgurl" type="url" data-k="imgUrl" maxlength="500" placeholder="https://…">
      </div>
    </div>
    <div class="hm-post__ctl">
      <label class="hm-hide"><input type="checkbox" data-k="hidden"> Нуух</label>
      <button class="btn btn--ghost btn--sm" type="button" data-act="up">↑</button>
      <button class="btn btn--ghost btn--sm" type="button" data-act="down">↓</button>
      <button class="btn btn--ghost btn--sm" type="button" data-act="rm">✕</button>
    </div>`;
  const f = (k) => $(`[data-k="${k}"]`, el);
  f('imgSel').value = custom ? '__url' : photo;
  f('imgUrl').value = custom ? p.img : '';
  ['cat', 'by', 'title', 'text', 'url'].forEach((k) => { f(k).value = p[k] || ''; });
  f('hidden').checked = !!p.hidden;
  const thumb = f('thumb');
  // Зураг биш холбоос (Drive, Facebook пост г.м.) эсвэл хаалттай зураг → анхааруулга (сайтад эвдэрсэн зураг гаргахгүй)
  thumb.addEventListener('error', () => { brokenImgs.add(thumb.getAttribute('src')); syncPostRow(el); scheduleAux(); });
  thumb.addEventListener('load', () => { if (brokenImgs.delete(thumb.getAttribute('src'))) { syncPostRow(el); scheduleAux(); } });
  syncPostRow(el);
  return el;
};
/** Зургийн сонголт → URL талбар, жижиг зураг, нуусан төлөв */
function syncPostRow(el) {
  const f = (k) => $(`[data-k="${k}"]`, el);
  const custom = f('imgSel').value === '__url';
  f('imgUrlWrap').hidden = !custom;
  const img = custom ? f('imgUrl').value.trim() : f('imgSel').value;
  const ok = !!img && !!HR && HR.validImg(img);
  const thumb = f('thumb');
  if (ok && thumb.getAttribute('src') !== adminSrc(img)) {
    thumb.referrerPolicy = /^https:/i.test(img) ? 'no-referrer' : '';
    thumb.src = adminSrc(img);
  }
  const broken = ok && brokenImgs.has(adminSrc(img));
  thumb.hidden = !ok || broken;
  f('noimg').hidden = ok && !broken;
  f('noimg').textContent = broken ? 'Зураг ачаалагдсангүй' : (img && !ok ? 'Буруу холбоос' : 'Зураггүй');
  f('noimg').classList.toggle('is-err', broken || (!!img && !ok));
  el.classList.toggle('is-hidden', f('hidden').checked);
}
const readPost = (el) => {
  const f = (k) => $(`[data-k="${k}"]`, el);
  const sel = f('imgSel').value;
  return {
    id: el.dataset.id, cat: f('cat').value, title: f('title').value, text: f('text').value, by: f('by').value,
    img: sel === '__url' ? f('imgUrl').value.trim() : sel, url: f('url').value.trim(), hidden: f('hidden').checked,
  };
};
const readHome = () => {
  const hero = {};
  HERO_KEYS.forEach((k) => { hero[k] = $(`[data-h="${k}"]`, homeForm).value; });
  // «1,200», «1 200» → 1200 (таслалыг сайт өөрөө тавина)
  hero.stats = $$('#hmStats tbody tr').map((tr) => ({ num: $('[data-s="num"]', tr).value.replace(/[\s,]/g, ''), suffix: $('[data-s="suffix"]', tr).value, label: $('[data-s="label"]', tr).value }));
  return { hero, posts: $$('.hm-post', hmPosts).map(readPost) };
};
const fillHome = (n) => {
  const h = (n && n.hero) || {};
  HERO_KEYS.forEach((k) => { $(`[data-h="${k}"]`, homeForm).value = h[k] || ''; });
  const stats = (h.stats || []).slice(0, 3);
  while (stats.length < 3) stats.push({ num: '', suffix: '', label: '' });
  $('#hmStats tbody').replaceChildren(...stats.map(statRow));
  hmPosts.replaceChildren(...((n && n.posts) || []).map(postRow));
  $$('[aria-invalid]', homeForm).forEach((x) => x.removeAttribute('aria-invalid'));
  homeDirty = false;
  renderHomeAux();
};
/** Огт бөглөөгүй шинэ карт (зураг ч сонгоогүй) хадгалахад хасагдана */
const blankPost = (p) => ![p.title, p.cat, p.text, p.by, p.url, p.img].some((x) => String(x || '').trim());

/** Хадгалахыг хаах алдаа: [{ msg, el }] — el = буруу талбар (фокуслана) */
const homeErrors = (raw) => {
  const errs = [];
  const h = raw.hero;
  if (![h.titlePre, h.titleEm, h.titlePost].some((x) => x.trim())) errs.push({ msg: 'Гарчиг (h1) хоосон байж болохгүй.', el: $('#hm-titlePre') });
  const statInputs = $$('#hmStats [data-s="num"]');
  h.stats.forEach((s, i) => {
    if (s.num && !/^\d{1,7}$/.test(s.num)) errs.push({ msg: `${i + 1}-р статистикийн тоо зөвхөн бүхэл тоо (1–7 орон) байна — «K», «+»-ийг дагавар талбарт бичнэ; 4.9 гэх мэт бутархай болохгүй.`, el: statInputs[i] });
  });
  const rows = $$('.hm-post', hmPosts);
  raw.posts.forEach((p, i) => {
    if (blankPost(p)) return;
    const f = (k) => $(`[data-k="${k}"]`, rows[i]);
    const no = `${i + 1}-р карт`;
    if (!p.title.trim()) errs.push({ msg: `${no}: гарчиг хоосон.`, el: f('title') });
    if (p.img && !HR.validImg(p.img)) errs.push({ msg: `${no}: зургийн холбоос https://… хэлбэртэй байна.`, el: f('imgUrl') });
    if (p.url && !HR.validUrl(p.url)) errs.push({ msg: `${no}: холбоос https://… эсвэл сайтын /… хуудас байна (http:// болон бусдыг хүлээн авахгүй).`, el: f('url') });
    else if (p.url.startsWith('/') && !HOME_DATA.internalPaths.includes(p.url.split(/[?#]/)[0])) {
      errs.push({ msg: `${no}: сайтад «${p.url.split(/[?#]/)[0]}» хуудас алга (байгаа: ${HOME_DATA.internalPaths.join(', ')}).`, el: f('url') });
    }
  });
  return errs;
};
const showHomeErrors = (errs) => {
  $$('[aria-invalid]', homeForm).forEach((x) => x.removeAttribute('aria-invalid'));
  errs.forEach((e) => { if (e.el) e.el.setAttribute('aria-invalid', 'true'); });
  setStatus(homeStatus, errs.map((e) => e.msg).join(' '), 'err');
  const first = errs.find((e) => e.el && !e.el.closest('[hidden]'));
  if (first) first.el.focus();
};
const FIELD = { badge: 'Тэмдэг', titlePre: 'Гарчиг', titleEm: 'Гарчиг', titlePost: 'Гарчиг', text: 'Тайлбар', btnPrimary: 'Товч', btnSecondary: 'Товч' };
const POST_FIELD = { cat: 'ангилал', title: 'гарчиг', text: 'тайлбар', by: 'эмчийн нэр' };
const fieldName = (k) => {
  let m = /^hero\.(\w+)$/.exec(k); if (m) return FIELD[m[1]] || m[1];
  m = /^hero\.stats\[(\d+)\]$/.exec(k); if (m) return `${+m[1] + 1}-р статистик`;
  m = /^posts\[(\d+)\]\.(\w+)$/.exec(k); if (m) return `${+m[1] + 1}-р карт · ${POST_FIELD[m[2]] || m[2]}`;
  return k;
};
/** Хадгалахыг хаахгүй анхааруулга (хадгалахад confirm асууна). all = norm(readHome()) — картын дугаар маягтын дараалалтай ижил */
const homeWarnings = (all) => {
  const w = [];
  if (!all) return w;
  if (claimsFailed) w.push('Хориотой үгийн шалгалт (claims.js) ачаалагдсангүй — хуудсыг дахин ачаалж үзнэ үү. Шалгалтгүйгээр хадгалах боломжтой.');
  if (findClaims) {
    for (const [k, t] of HR.texts(all)) {
      for (const c of findClaims(t, HOME_DATA.claimsAllow || [])) w.push(`${fieldName(k)}: «${c.match}» — эрүүл мэндийн сурталчилгаанд хориотой/эрсдэлтэй үг (${c.label}).`);
    }
  }
  const y = all.hero && (all.hero.badge.match(/(?:19|20)\d{2}/) || [])[0];
  if (y) {
    const years = new Date().getFullYear() - Number(y);
    const st = all.hero.stats.find((s) => s.num && /жил/i.test(s.label));
    if (st && Number(st.num) !== years) w.push(`Тэмдэгт ${y} он (${years} жил) гэсэн ч статистикт «${HR.fmtNum(st.num)}${st.suffix} ${st.label}» байна — тоог шалгана уу. Нүүрний зургийн дээрх «… оноос хойш / … жилийн туршлагатай» жижиг картыг энд засдаггүй (хөгжүүлэгчээр).`);
  }
  (all.posts || []).forEach((p, i) => {
    if (p.hidden || !p.img) return;
    if (brokenImgs.has(adminSrc(p.img))) w.push(`${i + 1}-р карт: зураг ачаалагдсангүй — холбоос зураг биш (Drive, Facebook пост г.м.) эсвэл хаалттай байж магадгүй. Сайтад эвдэрсэн зураг харагдана.`);
    else if (/(?:fbcdn\.net|fbsbx\.com)/i.test(p.img)) w.push(`${i + 1}-р карт: Facebook-ийн зургийн холбоос хэсэг хугацааны дараа ажиллахаа больдог — сайтын зургийг сонгох нь найдвартай.`);
  });
  return w;
};
/** norm(readHome()) — posts маягтын дараалалтай; хадгалах хувилбар нь хоосон картгүй */
const currentHome = () => {
  const raw = readHome();
  const all = HR.norm(raw);
  return { raw, all, save: all && { hero: all.hero, posts: all.posts.filter((p, i) => !blankPost(raw.posts[i])) } };
};

/** Урьдчилан харах, анхааруулга, тоолуур, дараалал солих товчнууд — маягт өөрчлөгдөх бүрт (debounce) */
let auxT = 0;
function renderHomeAux() {
  if (!HR || !homeForm) return;
  const { raw, all, save } = currentHome();
  $('#hmPrevHero').innerHTML = save && save.hero ? HR.hero(save.hero, { titleTag: 'div' }) : '<p class="muted">Гарчиг (h1) хоосон байна.</p>';
  $('#hmPrevPosts').innerHTML = save ? HR.posts(save.posts, { src: adminSrc }) : '';
  const html = homeWarnings(all).map((x) => `<li>${esc(x)}</li>`).join('');
  if (html !== lastWarnHTML) { hmWarn.innerHTML = html; lastWarnHTML = html; }   // aria-live: зөвхөн өөрчлөгдөхөд
  const rows = $$('.hm-post', hmPosts);
  rows.forEach((row, i) => {
    const t = $('[data-k="title"]', row).value.trim();
    const name = `${i + 1}-р карт${t ? ` «${t}»` : ''}`;
    const up = $('[data-act="up"]', row), down = $('[data-act="down"]', row), rm = $('[data-act="rm"]', row);
    up.setAttribute('aria-label', `${name}-ыг дээш зөөх`); up.disabled = i === 0;
    down.setAttribute('aria-label', `${name}-ыг доош зөөх`); down.disabled = i === rows.length - 1;
    rm.setAttribute('aria-label', `${name}-ыг устгах`);
  });
  const shown = save ? HR.visiblePosts(save.posts).length : 0;
  $('#hmCount').textContent = `${shown} харагдана · ${raw.posts.length}/${HM_MAX}`;
  $('#btnHmAdd').disabled = raw.posts.length >= HM_MAX;
}
const scheduleAux = () => { clearTimeout(auxT); auxT = setTimeout(renderHomeAux, 150); };

/** Маягтын дээрх тайлбар: repo шинэчлэгдсэн (stale) эсвэл зочдод харагдаж буй нь Google-ийнхоос өөр (unsynced) */
const showHomeNote = (kind, when) => {
  const el = $('#hmDiff'); if (!el) return;
  const msg = kind === 'stale'
    ? `Таны ${when}-ний хадгалалтаас хойш хөгжүүлэгч сайтын үндсэн хувилбарыг шинэчилсэн тул зочдод одоо тэр хувилбар харагдаж байна. Маягтад одоо харагдаж буй хувилбарыг ачааллаа — засаад хадгалбал таны хувилбар дахин гарна.`
    : kind === 'unsynced'
      ? 'Зочдод харагдаж буй (хадгалсан) хувилбар Google-ийн уншдаг үндсэн хувилбараас өөр байна: Google хуучин текстийг харж, нүүр ачаалахад хуучин текст хормын төдий харагдана. «Хөгжүүлэгчид илгээх JSON хуулах» дарж хөгжүүлэгчид илгээнэ үү.'
      : '';
  el.hidden = !msg;
  el.textContent = msg;
};
const showLoadError = (msg) => {
  $('#hmLoadMsg').textContent = msg;
  $('#hmLoad').hidden = false;
  if (!homeReady) lockHome(true);
};

const loadHome = async () => {
  if (!HR || !HOME_DATA.defaults) { showLoadError('Нүүр хуудасны скрипт (home-render.js / home-data.js) ачаалагдсангүй — хуудсыг дахин ачаална уу.'); return; }
  if (homeReady && homeDirty && !confirm('Хадгалаагүй өөрчлөлт байна. Хадгалсан хувилбарыг ачаалж, өөрчлөлтөө хаях уу?\n\n«Болих» — засвараа үлдээнэ.')) return;
  $('#hmLoad').hidden = true;
  setStatus(homeStatus, 'Ачаалж байна…', '');
  let snap;
  try { snap = await getDoc(homeRef); }
  catch (e) {
    setStatus(homeStatus, '', '');
    showLoadError(`${errText(e)} Хадгалсан хувилбарыг уншиж чадаагүй тул ${homeReady ? 'маягт өмнөх байдлаараа үлдлээ' : 'засварлахыг түр хаалаа (хадгалсан хувилбарыг санамсаргүй дарж бичихгүйн тулд)'}.`);
    return;
  }
  const D = HOME_DATA.defaults;
  const d = snap.exists() ? snap.data() : null;
  homeBaseMs = d ? msOf(d.updatedAt) : null;
  // Admin хадгалснаас хойш repo шинэчлэгдсэн бол сайт repo-ийн хувилбарыг харуулна (main.js) — маягт ч түүнийг
  const stale = !!(d && typeof d.baseRev === 'string' && d.baseRev && HOME_DATA.rev && d.baseRev !== HOME_DATA.rev);
  const n = d && !stale ? HR.norm(d) : null;
  fillHome(n ? { hero: n.hero || D.hero, posts: n.posts || D.posts } : D);
  homeReady = true;
  homeLive = !!n;
  lockHome(false);
  setStatus(homeStatus, d ? `Сүүлд хадгалсан: ${fmtDate(d.updatedAt)} · ${d.updatedBy || ''}` : 'Одоогоор энд хадгалсан зүйл алга — сайт үндсэн хувилбараараа харагдаж байна.', '');
  if (stale && homeKey(HR.norm(d)) !== homeKey(D)) showHomeNote('stale', fmtDate(d.updatedAt));
  else showHomeNote(homeLive && homeKey(n) !== homeKey(D) ? 'unsynced' : null);
};

const markDirty = (e) => {
  if (!homeReady) return;
  homeDirty = true;
  if (e && e.target && e.target.removeAttribute) e.target.removeAttribute('aria-invalid');
  const row = e && e.target && e.target.closest && e.target.closest('.hm-post'); if (row) syncPostRow(row);
  scheduleAux();
};
homeForm.addEventListener('input', markDirty);
homeForm.addEventListener('change', markDirty);
hmPosts.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const row = b.closest('.hm-post');
  if (b.dataset.act === 'rm') {
    const t = $('[data-k="title"]', row).value.trim();
    if (!confirm(`${t ? `«${t}»` : 'Энэ'} картыг устгах уу? (Хадгалах дарах хүртэл сайтад нөлөөлөхгүй. Түр нуух бол «Нуух»-ыг сонгоно уу.)`)) return;
    const next = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    (next ? $('[data-k="title"]', next) : $('#btnHmAdd')).focus();
  } else if (b.dataset.act === 'up' && row.previousElementSibling) {
    row.previousElementSibling.before(row);
  } else if (b.dataset.act === 'down' && row.nextElementSibling) {
    row.nextElementSibling.after(row);
  } else return;
  homeDirty = true;
  renderHomeAux();
  if (b.isConnected) (b.disabled ? $('[data-act="' + (b.dataset.act === 'up' ? 'down' : 'up') + '"]', row) : b).focus();
});
$('#btnHmAdd').addEventListener('click', () => {
  if (!homeReady || $$('.hm-post', hmPosts).length >= HM_MAX) return;
  const row = postRow({ id: newPostId(), img: '', hidden: false });
  hmPosts.appendChild(row);
  homeDirty = true;
  renderHomeAux();
  $('[data-k="title"]', row).focus();
});
$('#btnHomeDefaults').addEventListener('click', () => {
  if (!homeReady || !HOME_DATA.defaults) return;
  if (!confirm('Маягтыг сайтын үндсэн хувилбараар (Google-ийн уншдаг) дүүргэх үү? Хадгалах дарах хүртэл сайт өөрчлөгдөхгүй.')) return;
  fillHome(HOME_DATA.defaults);
  homeDirty = true;
  setStatus(homeStatus, 'Үндсэн хувилбар дүүргэгдлээ — хадгалахаа мартуузай.', '');
});
$('#btnHomeReload').addEventListener('click', () => { loadHome(); });
$('#btnHmRetry').addEventListener('click', () => { loadHome(); });
$('#btnHmJson').addEventListener('click', async () => {
  if (!HR) return;
  const raw = readHome();
  const errs = homeErrors(raw);
  if (errs.length) { showHomeErrors(errs); return; }
  const { save } = currentHome();
  const repo = HR.forRepo(save);
  if (!repo) return;
  const json = JSON.stringify(repo, null, 2) + '\n';
  const box = $('#hmJson');
  try {
    await navigator.clipboard.writeText(json);
    box.hidden = true;
    setStatus(homeStatus, `JSON хуулагдлаа (маягт дээрх${homeDirty ? ', ХАДГАЛААГҮЙ' : ''} утга) — хөгжүүлэгчид илгээнэ үү (тэд content/home.json-д тавина).`, 'ok');
  } catch (_) {
    box.value = json; box.hidden = false; box.focus(); box.select();
    setStatus(homeStatus, 'Автоматаар хуулж чадсангүй — доорх текстийг хуулна уу (Cmd/Ctrl+C).', '');
  }
});
window.addEventListener('beforeunload', (e) => { if (homeDirty) { e.preventDefault(); e.returnValue = ''; } });

/**
 * Transaction: уншаад шалгаад бичнэ — нөгөө admin хооронд нь хадгалсан бол бичихгүй (force-гүй үед).
 * @returns {Promise<{ok: true} | {conflict: object|null}>}
 */
const saveHomeTx = (payload, force) => runTransaction(db, async (tx) => {
  const cur = await tx.get(homeRef);
  const c = cur.exists() ? cur.data() : null;
  const same = homeBaseMs === SELF ? !!c && c.updatedBy === currentUser.email : (c ? msOf(c.updatedAt) : null) === homeBaseMs;
  if (!force && !same) return { conflict: c };
  tx.set(homeRef, payload);
  return { ok: true };
});

homeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!HR || !homeReady) return;
  const raw = readHome();
  const errs = homeErrors(raw);
  if (errs.length) { showHomeErrors(errs); return; }
  const { all, save: n } = currentHome();
  const dropped = raw.posts.length - n.posts.length;
  const warns = homeWarnings(all);
  if (warns.length && !confirm('Анхааруулга:\n\n• ' + warns.join('\n• ') + '\n\nҮргэлжлүүлж хадгалах уу?')) return;
  if (!HR.visiblePosts(n.posts).length && !confirm('Харагдах карт алга — сайтын «Зөвлөгөө» хэсэгт карт харагдахгүй (гарчиг, Facebook холбоос үлдэнэ). Үргэлжлүүлэх үү?')) return;
  const btn = $('#btnSaveHome');
  btn.disabled = true;
  lockHome(true);   // хадгалах явцад бичсэн текст алга болохгүйн тулд маягтыг түгжинэ
  setStatus(homeStatus, 'Хадгалж байна…', '');
  const payload = { hero: n.hero, posts: n.posts, baseRev: HOME_DATA.rev || '', updatedAt: serverTimestamp(), updatedBy: currentUser.email };
  try {
    let r = await saveHomeTx(payload, false);
    if (!r.ok) {
      const c = r.conflict;
      const who = c ? `${c.updatedBy || 'өөр хүн'} (${fmtDate(c.updatedAt)})` : 'өөр хүн';
      if (!confirm(`Таныг энэ хуудсыг ачаалснаас хойш ${who} нүүр хуудсыг хадгалсан байна.\n\nOK — таны хувилбараар дарж бичнэ (тэдний өөрчлөлт алга болно).\nБолих — хадгалахгүй; таны засвар маягт дээр үлдэнэ. Хүсвэл «Хөгжүүлэгчид илгээх JSON хуулах»-аар хуулж аваад «Дахин ачаалах» дарж тэдний хувилбарыг харна уу.`)) {
        setStatus(homeStatus, 'Хадгалаагүй — өөр хүний хадгалсан хувилбар бий. Таны засвар маягт дээр хэвээр.', 'err');
        return;
      }
      r = await saveHomeTx(payload, true);
    }
    try { const after = await getDoc(homeRef); homeBaseMs = after.exists() ? msOf(after.data().updatedAt) : null; }
    catch (_) { homeBaseMs = SELF; }
    fillHome(n);
    homeLive = true;
    showHomeNote(homeKey(n) !== homeKey(HOME_DATA.defaults) ? 'unsynced' : null);
    const shown = HR.visiblePosts(n.posts).length;
    setStatus(homeStatus, `Хадгалагдлаа (${shown} карт харагдана${dropped ? `; огт бөглөөгүй ${dropped} карт хасагдлаа` : ''}) — сайт дээр дараагийн ачааллаас харагдана.`, 'ok');
    toast('Нүүр хуудас хадгалагдлаа');
  } catch (err) { setStatus(homeStatus, errText(err), 'err'); }
  finally { btn.disabled = false; lockHome(false); if (document.activeElement === document.body) btn.focus(); }
});

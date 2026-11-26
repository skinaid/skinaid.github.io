/* ==========================================================================
   SKIN AID — admin.js (ES module, backoffice-ийн эхлэл)
   Google нэвтрэлт (allowlist) → модулиуд: Захиалга (realtime), Тохиргоо, Нүүр хуудас, Үйлчилгээ/Багц, Эмчилгээний хуудас,
   Messenger AI.
   Hash routing (#/bookings …), утсан дээр доод navigation bar, хадгалаагүй өөрчлөлтийн хамгаалалт (ui.js).
   Модулиуд: core.js (Firebase, туслах), ui.js (dialog, snackbar, save bar, алдааны хураангуй), lib.js (цэвэр функц),
   m-bookings.js, m-settings.js, m-home.js, m-catalog.js, m-pages.js, m-messenger.js (+ messenger-lib.js).
   ========================================================================== */
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { auth, ADMIN_EMAILS, $, $$, errText, session, updateTitle } from './core.js?v=2c361933';
import { ICON, dialog, setCurrentView, anyDirty, busyText, leaveBusy, refreshDirty, resetForms } from './ui.js?v=4ec734c0';
import * as bookings from './m-bookings.js?v=86d18531';
import * as settings from './m-settings.js?v=7df0705b';
import * as home from './m-home.js?v=540566f7';
import * as catalog from './m-catalog.js?v=1a25d559';
import { renderPages } from './m-pages.js?v=26a525a2';
import * as messenger from './m-messenger.js?v=838727ba';

const splash = $('#splash'), gate = $('#gate'), shell = $('#shell'), gateErr = $('#gateErr'), btnLogin = $('#btnLogin');
let gateMessage = '';

// Дүрс (inline SVG) — HTML-д data-icon="…"
$$('[data-icon]').forEach((el) => { el.innerHTML = ICON[el.dataset.icon] || ''; });

/* ---------- Нэвтрэлт ---------- */
const showGate = () => {
  splash.hidden = true; shell.hidden = true; gate.hidden = false;
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
$$('[data-logout]').forEach((b) => b.addEventListener('click', async () => {
  if (anyDirty() && !(await dialog({ title: 'Хадгалаагүй өөрчлөлт байна', body: 'Гарвал хадгалаагүй өөрчлөлт алга болно.', confirm: 'Хадгалалгүй гарах', cancel: 'Үлдэх', danger: true }))) return;
  const busy = busyText();
  if (busy) {
    if (!(await dialog({ title: 'Ажил дуусаагүй байна', body: busy, confirm: 'Зогсоогоод гарах', cancel: 'Үлдэх', danger: true }))) return;
    await leaveBusy();
  }
  signOut(auth);
}));

onAuthStateChanged(auth, async (user) => {
  if (!user) { teardown(); showGate(); return; }
  if (!isAdminUser(user)) {
    gateMessage = `«${user.email || 'энэ бүртгэл'}» хаягт удирдлагын эрх байхгүй. Эрхтэй Google бүртгэлээр нэвтэрнэ үү.`;
    await signOut(auth);   // onAuthStateChanged(null) → showGate() gateMessage-тэй
    return;
  }
  session.user = user;
  $('#whoEmail').textContent = user.email;
  $$('[data-logout]').forEach((b) => b.setAttribute('title', `Гарах (${user.email})`));
  $('.topbar__out').setAttribute('aria-label', `Гарах (${user.email})`);
  splash.hidden = true; gate.hidden = true; shell.hidden = false;
  route();
  bookings.start();
  settings.load();
  home.load();
  renderPages(null);
  catalog.load();
  messenger.load();
});
function teardown() {
  session.user = null;
  bookings.teardown();
  messenger.teardown();
  resetForms();   // хадгалах мөр нэвтрэх хуудсан дээр үлдэхгүй, дараагийн нэвтрэлт цэвэр эхэлнэ
  updateTitle({ view: '', newCount: 0 });
}

/* ---------- Hash routing: #/bookings, #/settings, #/home, #/catalog, #/pages, #/messenger ---------- */
const VIEWS = ['bookings', 'settings', 'home', 'catalog', 'pages', 'messenger'];
let firstRoute = true;
const viewFromHash = () => { const v = (location.hash.match(/^#\/([a-z]+)/) || [])[1]; return VIEWS.includes(v) ? v : 'bookings'; };
let currentRoute = '';
function route() {
  const view = viewFromHash();
  currentRoute = view;
  $$('.view').forEach((s) => { s.hidden = s.id !== 'view-' + view; });
  $$('[data-nav]').forEach((a) => { if (a.dataset.nav === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const h1 = $(`#view-${view} h1`);
  $('#topTitle').textContent = h1 ? h1.textContent : '';
  updateTitle({ view: h1 ? h1.textContent : '' });
  setCurrentView(view);
  if (!firstRoute && h1) {   // цэс сольсон: шинэ хэсгийн гарчиг руу фокус (дэлгэц уншигч, гарын хэрэглэгч)
    h1.tabIndex = -1;
    h1.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  firstRoute = false;
}
// «#/…» эсвэл хоосон hash (Буцах товчоор /admin/ руу) л цэсийг солино; «#main» гэх мэт бусад hash-ийг үл тооно
window.addEventListener('hashchange', () => {
  const h = location.hash;
  if (!shell.hidden && (h === '' || h === '#' || /^#\//.test(h)) && viewFromHash() !== currentRoute) route();
});
// Skip link: hash-ийг өөрчлөхгүйгээр үндсэн агуулга руу фокус
$('.skip').addEventListener('click', (e) => { e.preventDefault(); const m = $('#main'); m.focus(); m.scrollIntoView({ block: 'start' }); });

window.addEventListener('beforeunload', (e) => { if (session.user && (anyDirty() || busyText())) { e.preventDefault(); e.returnValue = ''; } });
refreshDirty();

/* ==========================================================================
   SKIN AID admin — core.js: Firebase (Auth + Firestore + App Check) ба модулиудын хуваалцах туслахууд.
   Хэрэглэгчийн оруулсан бүх текстийг esc()/textContent-ээр л дэлгэцэнд гаргана (XSS хамгаалалт).
   ========================================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { firebaseConfig, ADMIN_EMAILS } from '../assets/js/firebase-config.js?v=feaeafa8';
import { attachAppCheck } from '../assets/js/app-check.js?v=36d581c4';

const app = initializeApp(firebaseConfig);
attachAppCheck(app);   // reCAPTCHA → App Check token (Firestore-д Enforce асаалттай)
export const auth = getAuth(app);
export const db = getFirestore(app);
export { ADMIN_EMAILS };

export const $ = (s, c = document) => c.querySelector(s);
export const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
export const str = (v, max) => (typeof v === 'string' ? v : '').trim().slice(0, max);
export const msOf = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null);

export const DEFAULTS = window.SKINAID_DEFAULTS || { cats: {}, treatments: [], packages: [] };
export const CATS = DEFAULTS.cats || {};

/** Нэвтэрсэн admin (admin.js тохируулна) */
export const session = { user: null };

/** Хөтчийн табын гарчиг: «(2) Захиалга — SkinAid удирдлага» (цэс бүрт; WCAG 2.4.2) */
const titleState = { view: '', newCount: 0 };
export function updateTitle(patch = {}) {
  Object.assign(titleState, patch);
  const n = titleState.newCount;
  document.title = (n ? `(${n}) ` : '') + (titleState.view ? `${titleState.view} — ` : '') + 'SkinAid удирдлага';
}
/** prefers-reduced-motion үед гүйлгэлт хөдөлгөөнгүй */
export const scrollMode = () => (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/** 2026-11-07 18:12 (Улаанбаатарын цаг, 24 цаг) */
export const fmtDate = (ts) => {
  const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : (ts instanceof Date ? ts : null);
  if (!d) return '—';
  try { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(',', ''); }
  catch (_) { return d.toISOString().slice(0, 16).replace('T', ' '); }
};

export const errText = (e) => {
  const code = (e && e.code) || '';
  const map = {
    'permission-denied': 'Эрх хүрэхгүй: Firestore дүрэм эсвэл App Check (reCAPTCHA) энэ үйлдлийг татгалзлаа. Хуудсыг дахин ачаалаад оролдоно уу.',
    'unavailable': 'Firestore-той түр холбогдож чадсангүй. Сүлжээгээ шалгаад дахин оролдоно уу.',
    'unauthenticated': 'Нэвтрэлт дууссан байна. Дахин нэвтэрнэ үү.',
    'resource-exhausted': 'Өдрийн үнэгүй квот (Spark) дууссан байна. Улаанбаатарын цагаар өглөө ~16:00-д шинэчлэгдэнэ — дараа нь дахин оролдоно уу.',
    'auth/popup-closed-by-user': 'Нэвтрэх цонх хаагдлаа.',
    'auth/cancelled-popup-request': 'Нэвтрэх цонх хаагдлаа.',
    'auth/popup-blocked': 'Браузер popup цонхыг блоклосон байна. Энэ сайтад popup зөвшөөрөөд дахин оролдоно уу.',
    'auth/unauthorized-domain': 'Энэ домэйн Firebase Authentication → Authorized domains-д бүртгэгдээгүй байна.',
    'auth/network-request-failed': 'Сүлжээний алдаа. Интернэт холболтоо шалгана уу.',
  };
  return map[code] || ('Алдаа гарлаа' + (code ? ' (' + code + ')' : '') + '.');
};

/** Статусын мөр (role=status): kind = 'ok' | 'err' | '' */
export const setStatus = (el, msg, kind) => {
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('is-ok', kind === 'ok');
  el.classList.toggle('is-err', kind === 'err');
};

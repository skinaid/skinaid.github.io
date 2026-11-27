/* ==========================================================================
   SKIN AID — backend.js (ES module, нийтийн сайт)
   Firestore-lite ашиглан: (1) захиалгыг `bookings`-д бичих, (2) `settings/site`,
   `settings/catalog`, нүүрэнд `settings/home`-ийг унших. main.js (энгийн script) window.SkinAidBackend-ээр холбогдоно.
   Энэ файл ачаалагдахгүй (CDN блок, offline) бол main.js fallback сувгуудаа харуулна.
   Firestore хүсэлт бүр App Check (reCAPTCHA) token-той явна — app-check.js.
   ========================================================================== */
import { pageKey } from './site-content.js?v=3f4a8dce';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getFirestore, collection, addDoc, doc, getDoc, serverTimestamp, setLogLevel } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore-lite.js';
import { firebaseConfig } from './firebase-config.js?v=feaeafa8';
import { attachAppCheck } from './app-check.js?v=36d581c4';

setLogLevel('error');   // амжилтгүй хүсэлтийн payload-ыг (захиалгын өгөгдөл) console-д warn хэлбэрээр хэвлэхгүй
const app = initializeApp(firebaseConfig);
attachAppCheck(app);    // reCAPTCHA → App Check token; token авч чадахгүй бол Firestore хүсэлт унаж main.js fallback панел харуулна
const db = getFirestore(app);

const oneLine = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Захиалга бичнэ. Талбарууд firestore.rules-ийн create нөхцөлтэй яг таарна. */
export async function submitBooking(d) {
  const payload = {
    name: oneLine(d.name, 80),
    phone: oneLine(d.phone, 20).replace(/[^0-9+ -]/g, ''),   // дүрэм: '^[-0-9+ ]+$', 8–20
    service: oneLine(d.service, 120),
    date: /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') ? d.date : '',
    message: String(d.message ?? '').trim().slice(0, 1000),
    status: 'new',
    source: 'web',
    createdAt: serverTimestamp(),
  };
  if (payload.name.length < 2 || payload.phone.length < 8 || !payload.service) {
    throw new Error('invalid-booking');
  }
  const ref = await addDoc(collection(db, 'bookings'), payload);
  return ref.id;
}

/**
 * settings/site + settings/catalog (+ нүүр хуудсанд settings/home) — нийтэд уншигдана (2–3 read / нэг нээлт).
 * Doc тус бүр бие даана: нэг нь уншигдахгүй бол бусад нь хэрэглэгдэнэ; бүгд унавал алдаа шидэнэ.
 */
export async function loadPublicSettings() {
  const ids = document.querySelector('#bookForm') ? ['site', 'catalog'] : ['site'];
  if (document.querySelector('[data-home]')) ids.push('home');   // зөвхөн hero/«Зөвлөгөө» бүхий хуудас (нүүр)
  const reads = ids.map((id) => getDoc(doc(db, 'settings', id)));
  if (document.querySelector('script[data-site-content]')) {
    ids.push('content');
    const page = pageKey(document.querySelector('[data-content-path]')?.dataset.contentPath || location.pathname);
    reads.push(getDoc(doc(db, 'public_content', page)));
    if (page !== 'home') {
      ids.push('commonContent');
      reads.push(getDoc(doc(db, 'public_content', 'home')));
    }
  }
  const res = await Promise.allSettled(reads);
  if (res.every((r) => r.status === 'rejected')) throw res[0].reason;
  const out = {};
  ids.forEach((id, i) => { const r = res[i]; if (r.status === 'fulfilled') out[id] = r.value.exists() ? r.value.data() : null; });
  return out;
}

const api = { submitBooking, settings: null, ready: null };
window.SkinAidBackend = api;
api.ready = loadPublicSettings()
  .then((s) => { api.settings = s; document.dispatchEvent(new CustomEvent('skinaid:settings', { detail: s })); return s; })
  .catch(() => null);   // уншиж чадаагүй бол сайт HTML дахь анхны утгаараа үлдэнэ

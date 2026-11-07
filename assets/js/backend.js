/* ==========================================================================
   SKIN AID — backend.js (ES module, нийтийн сайт)
   Firestore-lite ашиглан: (1) захиалгыг `bookings`-д бичих, (2) `settings/site`,
   `settings/catalog`-ийг унших. main.js (энгийн script) window.SkinAidBackend-ээр холбогдоно.
   Энэ файл ачаалагдахгүй (CDN блок, offline) бол main.js fallback сувгуудаа харуулна.
   ========================================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getFirestore, collection, addDoc, doc, getDoc, serverTimestamp, setLogLevel } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore-lite.js';
import { firebaseConfig } from './firebase-config.js';

setLogLevel('error');   // амжилтгүй хүсэлтийн payload-ыг (захиалгын өгөгдөл) console-д warn хэлбэрээр хэвлэхгүй
const app = initializeApp(firebaseConfig);
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

/** settings/site + settings/catalog — хоёулаа нийтэд уншигдана (2 read / нэг нээлт). */
export async function loadPublicSettings() {
  const [site, catalog] = await Promise.all([
    getDoc(doc(db, 'settings', 'site')),
    getDoc(doc(db, 'settings', 'catalog')),
  ]);
  return { site: site.exists() ? site.data() : null, catalog: catalog.exists() ? catalog.data() : null };
}

const api = { submitBooking, settings: null, ready: null };
window.SkinAidBackend = api;
api.ready = loadPublicSettings()
  .then((s) => { api.settings = s; document.dispatchEvent(new CustomEvent('skinaid:settings', { detail: s })); return s; })
  .catch(() => null);   // уншиж чадаагүй бол сайт HTML дахь анхны утгаараа үлдэнэ

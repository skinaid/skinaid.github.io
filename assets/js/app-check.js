/* ==========================================================================
   SKIN AID — app-check.js (ES module, сайт + admin хоёулаа ашиглана)
   Firebase App Check: Firestore хүсэлт бүрд reCAPTCHA-аар (score-based v3, Enterprise түлхүүр,
   төсөл skinaid-mn) баталгаажсан token хавсаргана. Console дээр Firestore-д Enforce асаалттай тул
   token-гүй хүсэлт (сайтын гадна скрипт/бот, шууд REST/SDK) Firestore-оос татгалзагдана.
   Сайтын түлхүүр (нийтийн): firebase-config.js → RECAPTCHA_SITE_KEY. Заавар: README → «App Check».
   ========================================================================== */
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app-check.js';
import { RECAPTCHA_SITE_KEY } from './firebase-config.js?v=0e85a329';

/** initializeApp(...)-ийн дараа, Firestore/Auth ашиглахаас ӨМНӨ нэг удаа дуудна. */
export function attachAppCheck(app) {
  // Локал хөгжүүлэлт: `localhost` домэйн reCAPTCHA түлхүүрт бүртгэлтэй тул http://localhost:PORT дээр шууд ажиллана.
  // reCAPTCHA ажиллахгүй үед (127.0.0.1, өөр хост, скрипт блоклогдсон) debug token хэрэглэнэ — README → «App Check».
  try {
    const dbg = localStorage.getItem('skinaid:appcheck-debug');   // 'true' = шинэ token үүсгэж console-д хэвлэнэ, эсвэл бүртгэлтэй token
    if (dbg && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = dbg === 'true' ? true : dbg;
  } catch (_) { /* localStorage хаалттай (privacy mode) — debug горим хэрэггүй */ }
  return initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,   // token дуусахаас өмнө ар талд шинэчилнэ (хэрэглэгч удаан нээлттэй байлгасан ч ажиллана)
  });
}

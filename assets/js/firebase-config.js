/* ==========================================================================
   SKIN AID — firebase-config.js
   Firebase төслийн НИЙТИЙН тохиргоо (нууц биш: вэб апп бүрийн HTML-д ил байдаг).
   Хамгаалалт нь firestore.rules + доорх admin allowlist (дүрэмд давхар бий).
   Төсөл: skinaid-mn (Spark үнэгүй багц), Firestore: asia-northeast1
   ========================================================================== */
export const firebaseConfig = {
  apiKey: 'AIzaSyDeJDti4Y0csEDRTMTxWoiueqIgbMXamc8',
  authDomain: 'skinaid-mn.firebaseapp.com',
  projectId: 'skinaid-mn',
  storageBucket: 'skinaid-mn.firebasestorage.app',
  messagingSenderId: '453547531151',
  appId: '1:453547531151:web:219384366f2ebd6f1289fa',
};

// Admin эрхтэй Google бүртгэлүүд — зөвхөн UI-д (цэс харуулах/нуух). Бодит шалгалт: firestore.rules isAdmin()
export const ADMIN_EMAILS = ['hello@skinaid.mn', 'info@skinaid.mn'];

// SDK хувилбар — backend.js, admin/admin.js доторх import URL-уудтай ижил байх ёстой
export const SDK_VERSION = '12.16.0';

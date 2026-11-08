// SKIN AID — эмнэлгийн баталгаатай мэдээлэл (NAP). tools/build.mjs нь эндээс
// JSON-LD (schema.org) үүсгэнэ. Зөвхөн баталгаажсан баримт бичнэ: мэдэхгүй
// утгыг null үлдээ — build түүнийг JSON-LD-д оруулахгүй (зохиомол утга бичихгүй).

export const site = {
  origin: 'https://www.skinaid.mn',
  name: 'SkinAid',
  alternateName: ['Skin Aid', 'Скин Эйд', 'SkinAid арьсны өвчин, гоо заслын эмнэлэг', 'Skin Aid Clinic'],
  legalName: 'Eco Beauty Nature LLC',
  description:
    'Улаанбаатар дахь арьсны өвчин, гоо заслын эмнэлэг. 2007 оноос хойш батга, сорви, нүхжилт, нөсөө, ' +
    'үрчлээний эмчилгээ, лазер, тарилга, арьс чангалах үйлчилгээг эмчийн үзлэгт үндэслэн үзүүлдэг.',
  telephone: '+97676000505',
  // Сайтын header/footer-т (tools/lib/layout.mjs) харагдах хэлбэрүүд
  phone: { tel: '+97676000505', display: '7600-0505', intl: '+976 7600-0505' },
  email: 'info@skinaid.mn',
  foundingDate: '2007',
  logo: '/assets/img/logo.png',
  images: ['/assets/img/og-image.jpg', '/assets/img/photos/about-main.jpg', '/assets/img/photos/hero.jpg'],
  address: {
    streetAddress: 'Чингэлтэй дүүрэг, Тэнгис кино театрын автобусны буудлын баруун талд, KFC-тэй байр, Caffe Bene хаалгаар, 5 давхар',
    addressLocality: 'Улаанбаатар',
    postalCode: '15141',
    addressCountry: 'MN',
  },
  // Google Business Profile баталгаажсаны дараа бөглөнө (pin-ий координат, Maps-ын CID холбоос).
  geo: null,          // { latitude: '47.92…', longitude: '106.91…' }
  hasMap: null,       // 'https://www.google.com/maps?cid=…'
  // Эзэмшигч бодит цагийг баталгаажуулсны дараа бөглөнө. Жишээ:
  // [{ days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], opens: '10:00', closes: '19:00' }]
  openingHours: null,
  // priceRange: catalog-defaults.js-ийн үйлчилгээ + багцын үнээс tools/lib/schema.mjs priceRange() тооцно
  currenciesAccepted: 'MNT',
  paymentAccepted: 'Storepay, Pocket',
  areaServed: 'Улаанбаатар',
  sameAs: ['https://www.facebook.com/Skinaid.mn', 'https://www.instagram.com/skinaid.mn'],

  // Эмчилгээний хуудас бүрийн төгсгөлд (tools/lib/pages.mjs)
  medicalDisclaimer: 'Энэ мэдээлэл ерөнхий танилцуулга бөгөөд эмчийн үзлэг, зөвлөгөөг орлохгүй. Эмчилгээ танд тохирох эсэх, ' +
    'эрсдэл, хүлээгдэх үр дүнг эмч таны арьсыг үзсэний дараа тайлбарлана.',

  // Footer (tools/lib/layout.mjs)
  addressShort: 'Чингэлтэй дүүрэг, Тэнгис кино театрын хажууд, KFC-тэй байр, 5 давхар',
  footerAbout: 'Арьсны өвчин, үрчлээ, гоо засал, батганы үрэвсэл, сорви, нүхжилтийн цогц эмчилгээ. 2007 оноос хойш Улаанбаатар хотод.',
  // Footer «Эмчилгээ» багана: page нийтлэгдсэн бол /emchilgee/<page>, үгүй бол hub-ийн ангилал
  // (/emchilgee#<hub>, hub нийтлэгдсэн үед), үгүй бол нүүрний #treatments.
  footerTreatments: [
    { label: 'Батга эмчилгээ', page: 'batga', hub: 'acne' },
    { label: 'Сорви, нүхжилт', page: 'batganii-sorvi', hub: 'scar' },
    { label: 'Тарилга эмчилгээ', page: null, hub: 'inject' },
    { label: 'Лазер, гэрлэн эмчилгээ', page: null, hub: 'laser' },
    { label: 'Арьс чангалах', page: 'ultraformer-hifu', hub: 'lift' },
    { label: 'Дусал эмчилгээ', page: null, hub: 'iv' },
  ],
};

// Байнгын, индекслэгдэх хуудсууд. Эмчилгээний хуудсууд (/emchilgee/…) болон hub-ийг
// tools/build.mjs нь content/pages/-аас нэмж тооцно. path нь ташуу зураасгүй.
export const corePages = [
  { path: '/', file: 'index.html', jsonld: 'home' },
  { path: '/privacy', file: 'privacy/index.html' },
];

// Индекслэгдэхгүй ч asset хувилбар тавигдах HTML файлууд.
export const otherHtml = ['404.html', 'admin/index.html'];

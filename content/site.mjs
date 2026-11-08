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
};

// Индекслэгдэх хуудсууд (sitemap.xml ба шалгалтын жагсаалт). path нь ташуу зураасгүй.
export const pages = [
  { path: '/', file: 'index.html', jsonld: 'home' },
  { path: '/privacy', file: 'privacy/index.html' },
];

// Индекслэгдэхгүй ч asset хувилбар тавигдах HTML файлууд.
export const otherHtml = ['404.html', 'admin/index.html'];

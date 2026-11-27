/**
 * SkinAid-ийн тогтмол мэдээлэл (Messenger AI-ийн мэдлэг). `content/` нь Vercel deploy-д ордоггүй (.vercelignore),
 * `assets/js/catalog-defaults.js` нь хөтчийн скрипт тул эндээ хуулсан. tools/test/messenger-knowledge.test.mjs
 * нь эдгээр утга `content/site.mjs` болон `catalog-defaults.js`-тэй ЯГ ТЭНЦҮҮ эсэхийг шалгана — тэнд засвал энд засна.
 */

export const CLINIC = Object.freeze({
  name: 'SkinAid',
  // content/site.mjs → site.address.streetAddress + addressLocality
  streetAddress: 'Чингэлтэй дүүрэг, Тэнгис кино театрын автобусны буудлын баруун талд, KFC-тэй байр, Caffe Bene хаалгаар, 5 давхар',
  locality: 'Улаанбаатар',
  // content/site.mjs → site.phone.display (LLM-д ӨГӨХГҮЙ — яаралтай үед код залгана)
  phoneDisplay: '7600-0505',
  // content/site.mjs → site.email (сайтад ил; LLM-д ӨГӨХГҮЙ — «Холбоо барих» мөрөнд код нэмнэ)
  email: 'info@skinaid.mn',
  origin: 'https://www.skinaid.mn',
});

// assets/js/catalog-defaults.js → SKINAID_DEFAULTS.cats
export const CATS = Object.freeze({
  exam: 'Арьсны оношлогоо, эмчийн үзлэг', acne: 'Батга, үрэвсэлтэй арьсны эмчилгээ', scar: 'Сорви, нүхжилт, арьсны бүтэц сэргээх',
  glow: 'Арьс залуужуулах, гэрэлтүүлэх эмчилгээ', inject: 'Premium нөхөн төлжүүлэх тарилга', anti: 'Хөгшрөлтийн эсрэг, нүүрний хэлбэр засах',
  lift: 'Арьс чангалах эмчилгээ', laser: 'Лазер, гэрлэн эмчилгээ', iv: 'Дусал эмчилгээ', massage: 'Массаж, алжаал тайлах эмчилгээ',
  minor: 'Жижиг ажилбарууд',
});

// 14 эмчилгээний хуудасны төлөвлөгөө (SEO 3-р үе шат). Нууц мэдээлэлгүй — repo нийтэд нээлттэй.
// Хуудас бүр нэг гол түлхүүр үгийг (primary) ЭЗЭМШИНЭ; secondary нь зөвхөн тэр хуудсанд (давхардлаас сэргийлнэ).
// catalogIds — тэр хуудас руу холбогдох үйлчилгээ (нэг үйлчилгээ нэг хуудсанд); alsoIds — үнийн хүснэгтэд харуулах.
// legacy — хуучин Wix URL (нийтлэгдэхэд 308 redirect, build удирдана). Хуудасны эцсийн өгөгдөл content/pages/<slug>.mjs-д.
//   2026-11-24: Google-д индексжсэн хаягийг (site:skinaid.mn) catalogIds-ийн эзэмшигч хуудсанд хуваарилав. Аль ч хуудас
//   эзэмшдэггүй үйлчилгээний хаяг (дусал, chanel/pink/эхэс/япон гиалурон/ASCE, моно утас, Cellbooster Shape, плазма,
//   үү/ургацаг, биеийн массаж) болон бусад /post/ нийтлэл vercel.json-ийн catch-all (307) дээр үлдэнэ.
// admin → «Эмчилгээний хуудас» цэс энэ жагсаалтыг харуулна. Долоо хоног 1 = 2026-11-09-ний долоо хоног.
// stage: 'planned' | 'drafting' (ноорог бичиж буй) | 'review' (эмчид Google Doc илгээсэн) | 'approved' (эмч баталсан).
// ubServiceId — хуудасны «Цаг захиалах» (/?svc=<slug>#contact) онлайн захиалгад (UB Beauty) урьдчилан сонгох үйлчилгээний id
//   (нийтийн GET /services-ийн id; байхгүй бол юу ч сонгохгүй). Анх: эмчийн үзлэг «Арьсны оношлогоо».
// Нийтлэгдсэн эсэхийг build өөрөө тогтооно (content/pages/<slug>.mjs шалгалтад тэнцсэн бол).

export const pipeline = [
  { slug: 'batganii-sorvi', week: 1, stage: 'review', reviewer: 'onorsaikhan', category: 'scar', h1: 'Батганы сорви арилгах эмчилгээ',
    primary: 'батганы сорви арилгах', secondary: ['батганы сорви', 'сорвины төрөл', 'сорви өөрөө арилдаг уу', 'сорви салгах', 'келоид сорви'],
    catalogIds: ['scar-4', 'scar-5'], alsoIds: ['scar-1', 'scar-2', 'scar-3', 'glow-3'], related: ['nuhjilt', 'co2-lazer', 'vivace-rf'],
    bookingOption: 'Сорви, нүхжилт', ubServiceId: 'af5e4f62-7ea0-4410-8c15-652c73c50f9e', legacy: ['/service-page/сорви-салгах-эмчилгээ', '/service-page/келойд-сорвины-тариа'] },
  { slug: 'nuhjilt', week: 1, stage: 'review', reviewer: 'onorsaikhan', category: 'scar', h1: 'Нүхжилт арилгах эмчилгээ',
    primary: 'нүхжилт арилгах', secondary: ['сүв томрох', 'нүүрний нүхжилт', 'нүхжилтийн шалтгаан', 'карбон пийл'],
    catalogIds: ['glow-4'], alsoIds: ['scar-1', 'scar-2', 'scar-3', 'glow-2'], related: ['batganii-sorvi', 'vivace-rf', 'nuur-archilgaa'],
    bookingOption: 'Сорви, нүхжилт', ubServiceId: 'af5e4f62-7ea0-4410-8c15-652c73c50f9e', legacy: [
      '/post/нүхжилтийг-яаж-арилгах-талаар-э-өнөрсайхан-эмч-зөвлөж-байна',
      '/service-page/карбокси-карбон-пийл-carboxy-carbon-peel',
    ] },
  { slug: 'vivace-rf', week: 2, reviewer: null, category: 'scar', h1: 'VIVACE бичил зүүт RF ба MTS эмчилгээ',
    primary: 'vivace', secondary: ['бичил зүүт RF', 'микронидлинг', 'MTS эмчилгээ', 'needle RF'],
    catalogIds: ['scar-2', 'scar-3'], alsoIds: [], related: ['batganii-sorvi', 'nuhjilt', 'co2-lazer'],
    bookingOption: 'Сорви, нүхжилт', legacy: ['/service-page/vivace', '/service-page/mts-microneedling-therapy-бичил-зүүн-эмчилгээ'] },
  { slug: 'batga', week: 2, reviewer: null, category: 'acne', h1: 'Батга эмчилгээ',
    primary: 'батга эмчилгээ', secondary: ['батганы үрэвсэл', 'нуруу цээжний батга', 'өсвөр насны батга', 'карбокси'],
    catalogIds: ['acne-1', 'acne-2', 'acne-3', 'acne-4', 'acne-5'], alsoIds: [], related: ['batganii-sorvi', 'nusuu-tolbo'],
    bookingOption: 'Батга эмчилгээ', legacy: [
      '/service-page/батга-үрэвсэл',
      '/service-page/үрэвсэлт-батганы-нэг-удаагийн-эмчилгээ',
      '/service-page/батга-багц-1-1',
      '/service-page/батга-багц-1-2',
      '/service-page/батга-багц-1-3',
      '/service-page/батга-багц-2-1',
      '/service-page/батга-багц-2-2',
      '/service-page/батга-багц-2-3',
      '/service-page/батга-багц-2-4',
      '/service-page/батга-багц-2-5',
      '/service-page/цээж-нурууны-батганы-эмчилгээ',
      '/service-page/цээж-нурууны-батганы-эмчилгээ-карбокси',
      '/service-page/ipl-батганы-багцны-урамшуулал',
      '/service-page/карбокси-эмчилгээ',
    ] },
  { slug: 'co2-lazer', week: 3, reviewer: null, category: 'scar', h1: 'CO2 фракшнал лазер эмчилгээ',
    primary: 'co2 лазер', secondary: ['фракшнал лазер', 'CO2 лазерын дараах арчилгаа', 'лазер эмчилгээ'],
    catalogIds: ['scar-1'], alsoIds: [], related: ['batganii-sorvi', 'vivace-rf'],
    bookingOption: 'Сорви, нүхжилт', legacy: ['/service-page/laser-эмчилгээ'] },
  { slug: 'rejuran-pdrn', week: 3, reviewer: null, category: 'inject', h1: 'Rejuran ба PDRN (загасан) тарилга',
    primary: 'rejuran тарилга', secondary: ['загасан тарилга', 'PDRN тарилга', 'Cellbooster Glow', 'Lapuroon', 'skin booster'],
    catalogIds: ['inject-1', 'inject-3', 'inject-4', 'inject-6'], alsoIds: [], related: ['juvelook-facetem', 'nuur-archilgaa'],
    bookingOption: 'Тарилга эмчилгээ (Rejuran, филлер, ботокс)', legacy: [
      '/service-page/загасан-тарилга',
      '/service-page/rejuran-4ml-тарилга',
      '/service-page/загасан-тарилга-aurora-v',
      '/service-page/загасан-тарилга-aurora-s',
      '/service-page/cellbooster-glow-lift',
    ] },
  { slug: 'juvelook-facetem', week: 4, reviewer: null, category: 'anti', h1: 'Juvelook ба Facetem коллаген өдөөгч тарилга',
    primary: 'juvelook', secondary: ['facetem', 'CaHA тарилга', 'коллаген өдөөгч тарилга'],
    catalogIds: ['inject-2', 'anti-3'], alsoIds: [], related: ['rejuran-pdrn', 'filler'],
    bookingOption: 'Тарилга эмчилгээ (Rejuran, филлер, ботокс)', legacy: [
      '/service-page/juvelook-тарилга',
      '/service-page/facetem-caha-тарилга-филлертэй',
      '/service-page/facetem-caha-тарилга-2-бүтэн',
    ] },
  { slug: 'botoks', week: 5, reviewer: null, category: 'anti', h1: 'Ботулинум токсин (ботокс) тарилга',
    primary: 'ботокс тарилга', secondary: ['суганы хөлрөлт', 'V-line ботокс', 'үрчлээний тарилга'],
    catalogIds: ['anti-1', 'minor-3'], alsoIds: [], related: ['filler'],
    bookingOption: 'Тарилга эмчилгээ (Rejuran, филлер, ботокс)', legacy: [
      '/service-page/ботокс',
      '/service-page/хуян-арилгах-ботокс',
      '/service-page/v-line-botox',
      '/service-page/суганы-хөлрөлт-арилгах-ботокс',
    ] },
  { slug: 'nusuu-tolbo', week: 6, reviewer: null, category: 'laser', h1: 'Нөсөө, толбо, улайлтын лазер эмчилгээ',
    primary: 'нөсөө толбо арилгах', secondary: ['пигмент лазер', 'IPL улайлт', 'сэвх арилгах'],
    catalogIds: ['laser-4', 'laser-3', 'glow-5'], alsoIds: [], related: ['batga', 'nuur-archilgaa'],
    bookingOption: 'Лазер, гэрлэн эмчилгээ', legacy: [
      '/service-page/нөсөө-лазер-эмчилгээ-pigmentation-laser',
      '/service-page/ipl-гэрлэн-эмчилгээ',
      '/service-page/хацрын-улайлтын-ipl-гэрэл-эмчилгээ',
    ] },
  { slug: 'arisnii-emchiin-uzleg', week: 6, reviewer: null, category: 'exam', h1: 'Арьсны эмчийн үзлэг, оношлогоо',
    primary: 'арьсны эмчийн үзлэг', secondary: ['арьсны эмнэлэг цаг авах', 'онлайн зөвлөгөө', 'арьсны оношлогоо'],
    catalogIds: ['exam-1', 'exam-2', 'exam-3'], alsoIds: [], related: ['batga', 'batganii-sorvi'],
    bookingOption: 'Арьсны үзлэг, оношлогоо', legacy: [
      '/service-page/арьсны-3d-оношлогоо',
      '/service-page/онлайн-зөвлөгөө',
      '/service-page/арьсны-үзлэг-оношлогоо',
      '/service-page/арьсны-эмчийн-онлайн-зөвлөгөө',
      '/service-page/давтан-үзлэг',
    ] },
  { slug: 'filler', week: 7, reviewer: null, category: 'anti', h1: 'Филлер тарилга',
    primary: 'филлер тарилга', secondary: ['уруулын филлер', 'филлер хайлуулах'],
    catalogIds: ['anti-2', 'anti-5'], alsoIds: [], related: ['botoks', 'juvelook-facetem'],
    bookingOption: 'Тарилга эмчилгээ (Rejuran, филлер, ботокс)', legacy: [
      '/service-page/уруулын-филлер-1-мл',
      '/service-page/нүүрний-хэлбэр-засах-филлер',
      '/service-page/филлер-хайлуулагч-тарилга',
    ] },
  { slug: 'lazer-us-arilgah', week: 7, reviewer: null, category: 'laser', h1: 'Лазераар үс арилгах',
    primary: 'лазер үс арилгах', secondary: ['суганы үс арилгах', 'diode лазер', 'бикини лазер'],
    catalogIds: ['laser-1', 'laser-2'], alsoIds: [], related: [],
    bookingOption: 'Лазер, гэрлэн эмчилгээ', legacy: [
      '/service-page/ipl-үсний-ургалт-зогсоох-лазер',
      '/service-page/diode-laser-hair-removal',
      '/service-page/diod-laser-hair-removal-сахал-лазер',
      '/service-page/diod-лазер-гуя',
      '/service-page/diod-лазер-bikini-cуга',
      '/service-page/diode-лазер-bikini-бүтэн',
      '/service-page/diode-лазер-нүүрний-хэсэг',
      '/service-page/diode-лазер-гар-хагас',
      '/service-page/diode-лазер-гар-бүтэн-full-arms',
      '/service-page/diode-лазер-хөл-бүтэн',
      '/service-page/diode-лазер-гар-хөл-хагас',
      '/service-page/diode-лазер-гар-хөл-бүтэн',
      '/service-page/diode-лазер-бүтэн-бие',
    ] },
  { slug: 'us-unalt', week: 8, reviewer: null, category: 'inject', h1: 'Үс уналтын эмчилгээ',
    primary: 'үс уналт эмчилгээ', secondary: ['үсний мезо', 'Cellbooster Hair', 'үс хуйхны оношлогоо'],
    catalogIds: ['inject-9'], alsoIds: [], related: ['arisnii-emchiin-uzleg'],
    bookingOption: 'Бусад / Мэдэхгүй байна', legacy: ['/service-page/үс-хуйх-оношлогоо', '/service-page/cellbooster-hair-үсний-мезо-тарилга'] },
  { slug: 'nuur-archilgaa', week: 8, reviewer: null, category: 'glow', h1: 'Нүүрний арчилгаа, химийн пийл, RF массаж',
    primary: 'нүүр цэвэрлэгээ', secondary: ['glass skin', 'химийн пийл', 'AHA пийл', 'RF массаж'],
    catalogIds: ['glow-1', 'glow-2', 'glow-3', 'massage-1', 'massage-2', 'massage-3'], alsoIds: [], related: ['nuhjilt', 'rejuran-pdrn'],
    bookingOption: 'Гоо сайхан, массаж', legacy: [
      '/service-page/rf-хүйтэн-массаж',
      '/service-page/glass-skin-therapy-массажгүй',
      '/service-page/glass-skin-гүний-бохирдолын-цэвэрлэгээ',
      '/service-page/aha-70-химийн-гуужуулалт',
      '/service-page/хүчилээр-арчих',
      '/service-page/tca',
      '/service-page/rf-массаж',
      '/service-page/rf-нүүр-хүзүүний-массаж',
      '/service-page/cooling-rf-massage',
    ] },
];

// Зогссон үйлчилгээний хуучин (Wix) URL: өөрийн хуудас ХЭЗЭЭ Ч гарахгүй тул pipeline-д байхгүй, гэхдээ Google-д индексжсэн
// хаяг нь catch-all-ын оронд hub-ийн тухайн ангилал руу (/emchilgee#<category>, 307) очно (build удирдана).
//   2026-11-26: эмнэлэгт уг төхөөрөмж байхгүй (эзэмшигч) — үйлчилгээг каталог, сайтаас хассан.
export const retiredLegacy = [
  { category: 'lift', legacy: ['/service-page/ультраформер-iii'] },
];

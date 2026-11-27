// SKIN AID — нүүр хуудасны «Видео бичлэг» хэсгийн АНХДАГЧ жагсаалт (tools/build.mjs → index.html-д статикаар).
// Файл: assets/video/<нэр>.mp4 (540×960, H.264 ~0.8 Мбит/с) + assets/video/<нэр>.jpg (нүүр зураг) — хоёулаа заавал.
// Эх: «Skinaid - Маркетинг» фолдер (эмчийн асуулт-хариулт, эмчилгээний бичлэг). HIFU бичлэг оруулахгүй (эмнэлэгт байхгүй).
// Нийт 20 хүртэл (site-content.js → MAX_VIDEOS). Admin → Нүүр хуудас → «Видео бичлэг»-ээс эрэмбэлэх, нуух, YouTube бичлэг нэмж болно (public_content/home → video-items).
export const videos = [
  { url: '/assets/video/qa-vivace-skin-type.mp4', title: 'VIVACE ямар төрлийн арьсанд тохиромжтой вэ?' },
  { url: '/assets/video/qa-acne-scar.mp4', title: 'Батганы дараах сорви өөрөө арилдаг уу?' },
  { url: '/assets/video/qa-laser-devices.mp4', title: 'Ямар аппаратаар лазер эмчилгээ хийдэг вэ?' },
  { url: '/assets/video/qa-mts-redness.mp4', title: 'MTS хийлгэсний дараа нүүр хэр удаан улайдаг вэ?' },
  { url: '/assets/video/qa-recovery.mp4', title: 'Эдгэрэлтийн хугацаа хэд хоног байдаг вэ?' },
  { url: '/assets/video/qa-injection-safety.mp4', title: 'Тарилга арьсанд сөрөг нөлөөтэй юу?' },
  { url: '/assets/video/salmon-injection.mp4', title: 'Загасан тарилга' },
  { url: '/assets/video/cellbooster.mp4', title: 'Cellbooster Shape — өөх хайлуулах тарилга' },
  { url: '/assets/video/carboxy-reasons.mp4', title: 'Карбокси хийлгэх 5 шалтгаан' },
  { url: '/assets/video/vivace-reel.mp4', title: 'VIVACE эмчилгээ' },
  { url: '/assets/video/ipl.mp4', title: 'IPL эмчилгээ' },
];

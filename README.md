# SkinAid.mn — вэб сайт

Арьсны өвчин, гоо заслын SkinAid эмнэлгийн орчин үеийн нэг хуудаст (single-page) вэб сайт.
Цэвэр HTML + CSS + JavaScript, framework-гүй. Vercel дээр build алхам байхгүй: `node tools/build.mjs`-ийг локал дээр
ажиллуулж гарсан файлуудыг commit хийнэ (доорх «Build» хэсэг).
Backend: **Firebase (Spark үнэгүй багц)** — захиалга Firestore-д хадгалагдаж, `/admin/` удирдлагын хэсгээр Google-ээр нэвтэрч удирдана.

## Файлын бүтэц

```
index.html                    — Үндсэн хуудас (бүх хэсэг)
assets/css/style.css          — Загвар (өнгө, фонт, responsive)
assets/js/main.js             — Цэс, анимаци, үйлчилгээний шүүлтүүр, FAQ, маягт (Firestore + fallback), тохиргоо унших
assets/js/catalog-defaults.js — Үйлчилгээ/ангилал/багцын АНХНЫ утга (сайт + admin + build ашиглана)
assets/js/catalog-render.js   — Үйлчилгээний мөрийн HTML загвар (main.js болон tools/build.mjs хоёулаа ашиглана)
assets/js/firebase-config.js  — Firebase төслийн нийтийн тохиргоо, admin и-мэйлийн жагсаалт (UI-д), reCAPTCHA сайтын түлхүүр
assets/js/app-check.js        — Firebase App Check (reCAPTCHA): сайт + admin хоёулаа Firestore-оос өмнө дуудна
assets/js/backend.js          — Firestore-lite: захиалга бичих, settings/site + settings/catalog унших
admin/                        — Удирдлагын хэсэг (index.html, admin.js, admin.css): Google нэвтрэлт, 4 модуль
admin/pages-status.js         — «Эмчилгээний хуудас» цэсийн өгөгдөл (build үүсгэнэ)
firestore.rules               — Firestore аюулгүй байдлын дүрэм (console-д нийтэлсэнтэй ижил байлгана)
firebase.json, .firebaserc    — Firebase CLI хэрэглэх үед (заавал биш)
assets/img/                   — Лого (logo.png, logo-white.png), favicon, og-image; өөрийн зургуудаа энд хийнэ
tools/build.mjs (+ tools/lib) — Build: header/footer, JSON-LD, статик жагсаалт, эмчилгээний хуудсууд, asset хувилбар,
                                sitemap, redirect; --check шалгалт, --preview ноорог
tools/preview.mjs             — Ноорог харах локал сервер (127.0.0.1:8766)
tools/test/                   — node --test 'tools/test/*.test.mjs'
emchilgee/                    — Эмчилгээний хуудсууд ба hub (build үүсгэнэ — гараар бүү засаарай)
content/site.mjs              — Эмнэлгийн баталгаатай мэдээлэл (NAP, JSON-LD), байнгын хуудсууд, footer
content/pipeline.mjs          — 15 эмчилгээний хуудасны төлөвлөгөө (түлхүүр үг, долоо хоног, үйлчилгээ, хуучин URL)
content/pages/*.mjs           — ЗӨВХӨН эмчийн баталсан эмчилгээний хуудас (repo нийтэд нээлттэй!)
content/doctors.mjs           — Хянагч эмч нар (нэр, цол, нэр гаргах зөвшөөрлийн огноо)
content/hub.mjs               — /emchilgee жагсаалтын текст
content/drafts/, content/_work/ — Ноорог, судалгаа (.gitignore — commit хийхгүй)
content/lastmod.json          — Хуудас бүрийн агуулга өөрчлөгдсөн огноо (build бичнэ, sitemap-ийн lastmod)
```

## Локал дээр үзэх

```bash
python3 -m http.server 8765
```
Дараа нь браузерт http://localhost:8765 нээнэ.

## Build (`tools/build.mjs`) — push хийхээс өмнө заавал

HTML, JS, CSS, зураг, `catalog-defaults.js` эсвэл `content/site.mjs`-ийг зассан бол:

```bash
node tools/build.mjs          # шинэчилнэ
node tools/build.mjs --check  # юу ч бичихгүй; хуучирсан эсвэл SEO алдаатай бол exit 1
```

Шинэ компьютер/clone дээр нэг удаа: `git config core.hooksPath .githooks` — ингэснээр `git push` бүрийн өмнө
`.githooks/pre-push` нь `--check`-ийг ажиллуулж, хуучирсан build-ийг push хийлгэхгүй (`/assets` нэг жилийн cache-тэй тул
build мартвал хэрэглэгчид хуучин JS/CSS-ээ жилээр ашиглана).

Build юу хийдэг вэ:
- `index.html` дахь `<!-- build:jsonld -->`, `treat-chips`, `treat-list`, `pages-index`, `site-header`, `site-footer` хэсгүүдийг
  дүүргэнэ (бүх 50 үйлчилгээ статик HTML — Google JS-гүйгээр харна). Header/footer-ийн эх нь `tools/lib/layout.mjs`
  (нүүр, privacy, эмчилгээний хуудас бүгд ижил). **Эдгээр хэсгийг болон `emchilgee/**`-г гараар бүү засаарай.**
- `content/pages/`-ийн баталсан хуудсуудаас `emchilgee/<slug>/index.html`, hub `emchilgee/index.html`, `admin/pages-status.js`,
  нүүрний мөр/карт/footer-ийн холбоос, хуучин Wix URL-ийн 308 redirect (`vercel.json`)-ийг үүсгэнэ.
- `/assets/...` холбоос бүр болон JS module-ийн import-д агуулгын hash (`?v=8тэмдэгт`) тавина → `vercel.json` дахь `/assets/*` нэг жилийн `immutable` cache аюулгүй. `?v=`-г гараар өөрчлөх шаардлагагүй.
- `sitemap.xml`-ийг `content/site.mjs`-ийн хуудсын жагсаалтаас, `lastmod`-ийг агуулга өөрчлөгдсөн огноогоор бичнэ.
- Шалгалт: title/description урт ба давхардал, canonical, h1 = 1, JSON-LD зөв (дотроо `<`-гүй), build тэмдэглэгээ нэг удаа,
  дотоод холбоос (href/src/srcset) git-д яг ийм бичлэгээр байгаа файлтай/redirect руу заагаагүй/ташуугүй, asset бүр
  (og:image, JSON-LD зураг ч) хувилбартай, багцын картын үнэ = `catalog-defaults.js`, sitemap = хуудсын жагсаалт.
- Шинэ зураг/файл нэмбэл эхлээд `git add` хийнэ (build нь git-д бүртгэлгүй эсвэл том/жижиг үсэг зөрүүтэй asset-д алдаа өгнө —
  Vercel үсгийн хэмжээ ялгадаг). Root `index.html`-ээс бусад HTML-д зөвхөн `/`-ээр эхэлсэн зам бичнэ (`/privacy` гэх мэт
  ташуугүй URL дээр харьцангуй зам буруу задарна).

Тэмдэглэл: Нүүр хуудас дээр Firestore-ийн `settings/catalog` (admin → Үйлчилгээ / Багц) статик жагсаалтыг хэрэглэгчийн хөтөч дээр дахин зурна. Google статик (catalog-defaults.js) хувилбарыг харна — тиймээс тайлбар засахдаа хоёуланд нь засна (admin-ыг Google-д автоматаар хүргэх синк нь SEO төлөвлөгөөний 7-р үе шат).

## Эмчилгээний хуудас нийтлэх (эмчийн хяналттай)

Эрүүл мэндийн хуудас **эмч хянаж, нэрээ гаргахыг зөвшөөрсний дараа л** нийтлэгдэнэ. Repo нийтэд нээлттэй тул ноорог commit хийхгүй.

1. Ноорог: `content/drafts/<slug>.mjs` (бүтэц: `tools/lib/content.mjs`; жишээ: `tools/test/content.test.mjs`). Эмчээр батлуулах
   зүйлийг текстэд `[[эмч: асуулт]]` гэж тэмдэглэнэ. Үнэ бичихгүй — `catalog-defaults.js`-ээс автоматаар орно.
2. `node tools/build.mjs --preview && node tools/preview.mjs` → http://127.0.0.1:8766/emchilgee/<slug> («НООРОГ» тууз, асуудлын жагсаалт).
3. Эмчид Google Doc-оор хянуулна: `node tools/review-doc.mjs <slug>` нь `content/_work/<slug>/review-doc.html`-ийг (шалгах хүснэгт,
   эсрэг заалт, асуулт, бүтэн текст, зөвшөөрлийн хэсэг) `content/_work/<slug>/claims.json`-оос үүсгэнэ — Google Drive-д Doc болгон оруулна. Засварыг ноорогт оруулаад preview-ийн туузан дээрх
   «Хувилбар» (hash)-ийг эмчээр «Зөвшөөрөв» гэж батлуулна.
4. `content/doctors.mjs`-д эмчийн цол, `consent: { date, scope: ['reviewer'] }`-ийг бичнэ (бичгээр авсан зөвшөөрөл Drive-д).
5. Ноорогийг `content/pages/<slug>.mjs` руу зөөж `status: 'published'`, `lastReviewed`, `review: { hash, by: '<reviewer>' }`
   бөглөнө. Толгойн тайлбарыг (// НООРОГ …, content/_work г.м.) устгаж, хүсвэл `// Эмч баталсан: <нэр>, <огноо>` гэсэн нэг мөр
   үлдээнэ (build шалгана). `[[эмч: …]]` тэмдэг үлдэхгүй. Хуучин Wix URL-ыг `content/pipeline.mjs`-ийн `legacy`-д бичнэ (хуудасны
   `legacy`-тай нэгтгэгдэнэ). Дараа нь `node tools/build.mjs`, `git add -A`, commit, push.
6. Батлагдсаны дараа текстийг засвал hash зөрж build алдаа өгнө — эмчээр дахин хянуулна (санамсаргүй засвар live хуудсыг
   эвдэхгүй: build алдаатай хуудасны HTML-ийг хөндөхгүй). Хуудсыг буцаахад `content/pages/<slug>.mjs`-ийг устгаад build хийнэ.

Шалгалт (`tools/lib/content.mjs`, `claims.mjs`, `check.mjs`): хэсэг бүр бөглөгдсөн, FAQ 3–10, эх сурвалж ≥ 2 (https), 500+ үг,
хориотой мэдэгдэлгүй (хамгийн, шилдэг, баталгаатай, 100%, өвдөлтгүй, аюулгүй, гаж нөлөөгүй, бүрмөсөн …), текстэд үнэгүй,
дэд хуудсанд Firebase/reCAPTCHA ачаалахгүй, breadcrumb = JSON-LD, хянагч эмч ба огноо харагдана, үнэлгээ/цаг/geo markup-гүй.
admin → «Эмчилгээний хуудас» цэс төлөв, хуваарь, үнийн зөрүүг харуулна (зөвхөн харах).

## Засварлах зүйлс

1. **Зураг** — `assets/img/photos/` дотор эмнэлгийн өөрийн зургуудыг ("Skinaid - Маркетинг" хавтаснаас) вэбд тохируулан
   жижигрүүлж хийсэн. Солихдоо ижил нэрээр, ижил харьцаатай (hero 4:4.6, карт 4:3, blog 16:10) зураг хийнэ.
6. **Урамшууллын хэсэг** — `index.html` дахь `<section id="promo">` нь Шинэ жилийн 5 багц + FACETEM S 10% (улирлын).
   Хугацаа дууссаны дараа тус section-ийг бүхэлд нь, мөн цэсний `#promo` холбоосуудыг (3 газар) устгана.
2. **Ажлын цаг, утас, и-мэйл** — `/admin/` → Тохиргоо хэсэгт бичнэ (код засах шаардлагагүй). Хоосон бол HTML дахь текст харагдана.
3. **Үйлчилгээний жагсаалт, үнэ, багц** — `/admin/` → Үйлчилгээ / Багц хэсэгт засна. Анхны утга `assets/js/catalog-defaults.js`-д;
   Firestore-д хадгалсны дараа сайт тэндхийг уншина (сайт нэг нээлтэд 2 л read хийнэ).
4. **Цаг захиалах маягт** — хүсэлт Firestore `bookings`-д бичигдэж, `/admin/` → Захиалга хэсэгт бодит цагт харагдана.
   Firestore ажиллахгүй (CDN блок, offline, квот дууссан) эсвэл admin-аас "Онлайн захиалга" модулийг унтраасан үед
   маягт өмнөх шигээ хүсэлтийг бэлтгээд Messenger / и-мэйл / SMS / утас сувгаар дамжуулах товчнууд харуулна (fallback).
5. **Өнгө, фонт** — `style.css` дээд хэсгийн `:root` хувьсагчид (`--purple: #654186` брэндийн ягаан).

## Firebase backend

| Зүйл | Утга |
|---|---|
| Төсөл | `skinaid-mn` (Firebase console → SkinAid), Spark үнэгүй багц — **Blaze/billing асаахгүй** |
| Firestore | `(default)`, Standard edition, `asia-northeast1` (Tokyo), production mode |
| Authentication | Google provider; Authorized domains: `localhost`, `skinaid.github.io` (skinaid.mn домэйн холбосны дараа түүнийг мөн нэмнэ) |
| Admin эрх | `firestore.rules` → `isAdmin()` жагсаалт + `assets/js/firebase-config.js` → `ADMIN_EMAILS` (UI). Одоо: hello@skinaid.mn, info@skinaid.mn |
| App Check | reCAPTCHA (score-based v3, «Fraud Defense / reCAPTCHA Enterprise» provider, Essentials үнэгүй багц) — Firestore-д **Enforce асаалттай**; доорх «App Check» хэсэг |
| Удирдлага | https://skinaid.github.io/admin/ — Google-ээр нэвтэрнэ (нууц үг байхгүй) |

### Өгөгдлийн бүтэц (Firestore)

- `bookings/{id}` — `name, phone, service, date, message, status(new|contacted|confirmed|cancelled), source('web'), createdAt`, admin нэмдэг: `note, updatedAt, updatedBy`.
  Хэн ч **зөвхөн үүсгэж** чадна (талбар бүр дүрмээр шалгагдана); унших/засах/устгах — зөвхөн admin.
- `settings/site` — `hours, phone, email, promoEnabled, bookingEnabled` — нийтэд уншигдана, admin бичнэ.
- `settings/catalog` — `services[] (id,c,n,d,t,p,hidden), packages[] (id,name,price,hidden)` — нийтэд уншигдана, admin бичнэ.

### Дүрэм шинэчлэх

`firestore.rules`-ийг засаад Firebase console → Firestore Database → Rules editor-т бүхэлд нь буулгаж **Publish** дарна
(эсвэл `npm i -g firebase-tools && firebase login && firebase deploy --only firestore:rules`). Repo дахь файл болон console
дээрх дүрэм үргэлж ижил байх ёстой. Анхаар: Rules хэлэнд `service` түлхүүр үг тул `data.service` биш `data['service']` гэж бичнэ.

### App Check (reCAPTCHA) — бот/флудаас хамгаалалт

Firestore нь зөвхөн **баталгаажсан вэб аппаас** (skinaid.github.io / localhost дээр ажиллаж буй сайт, admin) ирсэн хүсэлтийг
хүлээн авна. Хуудас ачаалахад `assets/js/app-check.js` reCAPTCHA-аар (хэрэглэгчид харагдахгүй, score-based) App Check token авч,
Firestore хүсэлт бүрд хавсаргана. Token-гүй хүсэлт (скрипт, REST, өөр сайт) Firestore-оос `permission-denied` авна —
дүрэм хүртэл ч хүрэхгүй. Энэ нь «бот 20,000 write/өдөр квотыг дуусгах» эрсдэлийг хаана.

| Зүйл | Хаана |
|---|---|
| reCAPTCHA түлхүүр «SkinAid Web» | https://www.google.com/recaptcha/admin → SkinAid Web (Google Cloud төсөл `skinaid-mn`, домэйн: `skinaid.github.io`, `localhost`) |
| Сайтын түлхүүр (нийтийн) | `assets/js/firebase-config.js` → `RECAPTCHA_SITE_KEY` — HTML-д ил байдаг, нууц биш; нууц түлхүүр (secret) хаана ч хэрэглэгдэхгүй |
| Апп бүртгэл | Firebase console → App Check → Apps → SkinAid Web → provider «Fraud Defense (reCAPTCHA Enterprise)», Token TTL 1 цаг, App risk Medium (0.5) |
| Enforce | Firebase console → App Check → APIs → Cloud Firestore → **Enforced**. Authentication-д enforce хийгээгүй (нэвтрэлт App Check-гүй ч ажиллана) |
| Metrics | App Check → APIs → Cloud Firestore: Verified / Unverified (outdated, invalid, missing) хүсэлтийн график |

**Квот.** reCAPTCHA Essentials багц: сард **10,000 assessment** (= шинэ App Check token авах тоо) үнэгүй, кредит карт/Blaze шаардахгүй.
Нэг зочин нэг нээлтэд 1 token авч 1 цаг (TTL) хадгална (IndexedDB) — дараагийн хуудас нээлтүүд token дахин авахгүй.
Квот дуусвал token авалт алддаг → сайт fallback (Messenger/и-мэйл/SMS) панел руу, admin «permission-denied» харуулна;
дараагийн сар автоматаар сэргэнэ. Хэрэглээг reCAPTCHA admin → Analytics-аас харна. Хэт их бол TTL-ийг Firebase console-оос
уртасгаж (1 цаг → 1 өдөр) token авалтыг цөөлнө (урт TTL = нэг token-оор удаан бичиж болох тул 7 хоногоос хэтрүүлэхгүй).

**Яаралтай унтраах.** Firebase console → App Check → APIs → Cloud Firestore → ⋮ → Unenforce. Сайтын код өөрчлөгдөхгүй
(token авсаар байна, зөвхөн шаардахаа болино). Дахин асаахдаа Enforce.

**Локал хөгжүүлэлт.** `http://localhost:8765` дээр reCAPTCHA шууд ажиллана (`localhost` домэйн түлхүүрт бүртгэлтэй).
`127.0.0.1`, өөр хост, эсвэл reCAPTCHA скрипт блоклогдсон (adblock) үед debug token хэрэглэнэ:

1. Браузерын console-д `localStorage.setItem('skinaid:appcheck-debug', 'true')` гээд хуудсыг дахин ачаална — console-д
   `App Check debug token: xxxxxxxx-...` гэж хэвлэгдэнэ (localhost/127.0.0.1 дээр л идэвхжинэ, `app-check.js`).
2. Firebase console → App Check → Apps → SkinAid Web → ⋮ → Manage debug tokens → Add → тэр token-ийг нэрлэж хадгална.
3. Дараа нь уг браузер дээр Firestore хүсэлт баталгаажна. Болих: `localStorage.removeItem('skinaid:appcheck-debug')`.
   Debug token-ийг хэнтэй ч хуваалцахгүй (App Check-ийг тойрдог); ажлаа дуусаад console-оос устгаж болно.

**Түлхүүр солих / домэйн нэмэх.** skinaid.mn домэйн холбоход reCAPTCHA admin → SkinAid Web → Settings → Domains-д `skinaid.mn`,
`www.skinaid.mn` нэмнэ (Firebase Authentication → Authorized domains-д мөн). Түлхүүрийг бүхэлд нь солих бол: reCAPTCHA admin-д
шинэ score-based түлхүүр (төсөл skinaid-mn) үүсгэж → Firebase console → App Check → Apps → SkinAid Web → ⋮ → Edit → шинэ
сайтын түлхүүр → `firebase-config.js` → `RECAPTCHA_SITE_KEY` солиод `node tools/build.mjs` ажиллуулна (firebase-config.js →
app-check.js → backend.js/admin.js → HTML бүгд шинэ hash авна; `?v=`-г гараар бүү өөрчил), `--check`-ээр шалгаад push.
Хуучин түлхүүрийг хэрэглэгчдийн token (TTL 1 цаг) дуусахыг хүлээгээд устгана.

**Шалгах.** Сайтаас захиалга илгээхэд «Хүсэлт тань бүртгэгдлээ» гарч admin-д орж ирнэ; App Check → APIs → Cloud Firestore
metrics дээр Verified 100% ойролцоо. Token-гүй хүсэлт татгалзагдаж буйг шалгах: console-д
`fetch('https://firestore.googleapis.com/v1/projects/skinaid-mn/databases/(default)/documents/settings/site').then(r => r.status)`
→ `403` (өмнө нь 200 байсан). Google-ийн нөхцөлөөр reCAPTCHA-ийн тэмдэг (badge) нуугдсан тул сайтын footer болон admin нэвтрэх
картад «Энэ сайт reCAPTCHA-аар хамгаалагдсан…» мэдэгдэл заавал байна — устгаж болохгүй.

### Admin нэмэх / хасах

1. `firestore.rules` → `isAdmin()` доторх жагсаалтад Google и-мэйлийг нэмж, дүрмийг дахин Publish хийнэ (жинхэнэ хамгаалалт энд).
2. `assets/js/firebase-config.js` → `ADMIN_EMAILS`-д мөн нэмж push хийнэ (admin хуудасны цэс харуулахад л хэрэглэнэ).

### Хязгаар, анхаарах зүйл

- Spark квот: өдөрт 50,000 read, 20,000 write, 1 GiB хадгалалт (Номхон далайн цагаар шөнө дунд = Улаанбаатарын ~16:00-д шинэчлэгдэнэ). Сайт нэг нээлтэд 2 read.
  Admin: нэвтрэх/дахин ачаалах бүрт сүүлийн ≤300 захиалга + 2 read; шинэ захиалга бүрт 1 read; статус хадгалах 1 write + 1 read; тохиргоо/каталог хадгалах 1 write.
  Жагсаалт сүүлийн 300 захиалгыг харуулна, хуучныг «Цааш ачаалах» товчоор татна. Квот дуусвал сайт fallback панел руу, admin «Дахин холбогдох» товчтой мэдэгдэл харуулна.
- Шинэ захиалгын и-мэйл/SMS мэдэгдэл **байхгүй** (Cloud Functions Blaze шаарддаг). Admin хуудсыг нээлттэй байлгавал бодит цагт
  шинэчлэгдэж, "Шинэ захиалгын мэдэгдэл асаах" дарсан бол браузерын мэдэгдэл + дуу гарна.
- Захиалга үүсгэх нь нийтэд нээлттэй тул спам ирж болно: App Check (reCAPTCHA, дээрх хэсэг) + дүрмийн хатуу validation + маягтын honeypot талбар хамгаална.
  Спам ирвэл admin-д тухайн төлөвөөр («Шинэ») шүүгээд «... төлөвтэй N-ийг устгах» товчоор багцаар цэвэрлэнэ (жинхэнэ захиалгаа эхлээд «Холбогдсон» болгоно).
- Firebase web config (`apiKey` гэх мэт) нууц биш, нийтэд ил байх зориулалттай. Аюулгүй байдал нь дүрэм + allowlist.
- Захиалгын өгөгдөл хувийн мэдээлэл тул admin хуудсыг зөвхөн итгэлтэй төхөөрөмжөөс нээж, ажлаа дуусаад "Гарах" дарна.
- SDK хувилбар (`12.16.0`) `backend.js`, `admin/admin.js`, `app-check.js`, `firebase-config.js` дөрвүүлээ ижил байна; шинэчлэхдээ дөрвүүлэнг нь солино.

## Байршуулалт

Нэг repo, хоёр хостинг — хоёулаа `main` салбараас автоматаар шинэчлэгдэнэ (`git push` = deploy, 1–2 минут):

| Хостинг | Хаяг | Үүрэг |
|---|---|---|
| **Vercel** (төсөл `skinaid.github.io-y1vf`) | https://www.skinaid.mn (үндсэн) | Бодит домэйн, `vercel.json` header/redirect. `skinaidgithubio-y1vf.vercel.app` нь www руу 308 redirect хийнэ (давхардсан контентоос сэргийлж). |
| GitHub Pages | https://skinaid.github.io | Repo-ийн `CNAME` файл (`www.skinaid.mn`)-ын ачаар github.io-ийн бүх зам www.skinaid.mn руу 301 redirect хийнэ. GitHub дээрх "DNS check unsuccessful" анхааруулгыг үл тоомсорлоно; `CNAME`-ийг бүү устга. Яаралтай үед `www` CNAME-ийг `skinaid.github.io` руу заавал нөөц болж ажиллана. |

Repo: https://github.com/skinaid/skinaid.github.io

```bash
git add -A && git commit -m "Өөрчлөлтийн тайлбар" && git push
```

Push хийхээс өмнө `node tools/build.mjs` ажиллуулна — asset хувилбар (`?v=`) автоматаар шинэчлэгдэнэ.

### Домэйн (2026-11-07-нд Wix-ээс Vercel рүү шилжүүлсэн)

Datacom (manage.datacom.mn) DNS удирдлага дээр:
- `@` A → `216.198.79.1` (Vercel)
- `www` CNAME → `234e2deb3344ebce.vercel-dns-017.com` (Vercel, энэ төслийн өвөрмөц утга)
- `skinaid.mn` → `www.skinaid.mn` руу 308 redirect (Vercel дээр тохируулсан)
- Мэйл (MX, DKIM), Google Workspace (mail, docs, drive…), `erp` бичлэгүүдэд хүрээгүй.

Хуучин Wix бичлэгүүд (буцаах шаардлага гарвал): `@` A `185.230.63.107`, `@` A `23.236.62.147`, `www` CNAME `balancer.wixdns.net`, `www` CNAME `pointing.wixdns.net`, `www` CNAME `ghs.googlehosted.com`.

Домэйн солигдсоны дараа Firebase Authentication → Authorized domains болон reCAPTCHA (App Check) түлхүүрийн домэйн жагсаалтад `www.skinaid.mn`, `skinaid.mn`, `skinaidgithubio-y1vf.vercel.app`-ийг нэмсэн байх ёстой; үгүй бол маягт болон admin нэвтрэлт тэр домэйн дээр ажиллахгүй.

### Redirect, SEO-ийн дүрэм (`vercel.json`)

- `trailingSlash: false` — хуудсууд ташуу зураасгүй хаягтай (`/privacy`, `/admin`). Canonical, sitemap, дотоод холбоос бүгд ташуугүй хэлбэрийг ашиглана.
- `/index.html` → `/`, `/<хавтас>/index.html` → `/<хавтас>`, `/privacy-policy` → `/privacy`.
- Хуучин Wix замууд: `/service-page/*` → `/#treatments`, `/post/*`, `/blog/*` → `/#blog`, `/product-page/*` → `/`, `/book-online*` → `/#contact`.
  Эмчилгээний хуудас нийтлэгдэхэд `content/pipeline.mjs` / хуудасны `legacy` URL-ууд → тэр хуудас руу 308 redirect-ийг build
  автоматаар `vercel.json`-д (catch-all-аас өмнө, percent-encoded) нэмнэ. `/emchilgee/` руу заасан дүрмийг гараар бүү засаарай.
- **Кирилл URL:** Vercel кирилл замыг зөвхөн percent-encoded хэлбэрээр таардаг (2026-11-08 туршсан: `/zz-probe/тест` raw эх 404, `%D1%82%D0%B5%D1%81%D1%82` эх 307). Тиймээс кирилл эхтэй redirect-ийг `encodeURI()` хэлбэрээр (том hex) бичнэ.
- `/admin` болон доорх бүх файл: `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`.
- Шалгах: `curl -sIL -o /dev/null -w '%{num_redirects} %{http_code} %{url_effective}\n' https://www.skinaid.mn/privacy-policy` → `1 200 https://www.skinaid.mn/privacy`.

Нэмэлт мэдээлэл: `robots.txt`, `sitemap.xml`, `404.html` repo-д бий; `admin/index.html` нь `meta robots noindex, nofollow`-той (robots.txt-д Disallow хийвэл Google тэр meta-г уншиж чадахгүй тул зориуд хориглоогүй); `.gitignore`-оор эх лого JPG, `.claude/` нийтлэгдэхгүй.

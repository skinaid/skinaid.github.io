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
assets/js/home-render.js      — Нүүрний hero + «Зөвлөгөө» картын HTML загвар, norm()/хязгаар (main.js, build, admin ашиглана)
assets/js/firebase-config.js  — Firebase төслийн нийтийн тохиргоо, admin и-мэйлийн жагсаалт (UI-д), reCAPTCHA сайтын түлхүүр
assets/js/app-check.js        — Firebase App Check (reCAPTCHA): сайт + admin хоёулаа Firestore-оос өмнө дуудна
assets/js/backend.js          — Firestore-lite: захиалга бичих, settings/site + settings/catalog (+ нүүрэнд settings/home) унших
                                (main.js `loadBackend()` хуудас ачаалагдсаны дараа сул үед эсвэл нөөц маягтад хүрэхэд импортлоно —
                                эхэнд БҮҮ ачаал: PageSpeed FCP 6+ с болдог)
assets/js/booking.js          — Онлайн цаг захиалга: UB Beauty вэб сувгийн API (сул цаг → захиалга); доорх «Онлайн цаг захиалга»
assets/js/ubbeauty-config.js  — UB Beauty API хаяг + НИЙТИЙН түлхүүр (pk_live_…). Нууц sk_ түлхүүр хэзээ ч энд биш
admin/                        — Удирдлагын хэсэг: index.html, admin.css, admin.js (эхлэл: нэвтрэлт, #/hash routing),
                                core.js (Firebase, туслах), ui.js (dialog, snackbar+«Буцаах», хадгалаагүй өөрчлөлтийн мөр,
                                алдааны хураангуй, тоолуур), lib.js (цэвэр функц — tools/test/admin-lib.test.mjs),
                                m-bookings|m-settings|m-home|m-catalog|m-pages|m-messenger.js (6 цэс), messenger-lib.js
admin/pages-status.js         — «Эмчилгээний хуудас» цэсийн өгөгдөл (build үүсгэнэ)
admin/home-data.js            — «Нүүр хуудас» цэсийн анхны утга + сайтын зургийн жагсаалт (build үүсгэнэ, эх: content/home.json)
admin/claims.js               — tools/lib/claims.mjs-ийн хуулбар: admin хориотой үгийг анхааруулна (build үүсгэнэ)
firestore.rules               — Firestore аюулгүй байдлын дүрэм (console-д нийтэлсэнтэй ижил байлгана)
api/                          — Vercel Functions: messenger.js (Meta webhook), cron/daily.js, _lib/ (туслах код) — «Messenger AI»
package.json, package-lock.json — ЗӨВХӨН api/-ийн хамаарал (сайтын build хамааралгүй; build script БҮҮ нэм — статик output өөрчлөгдөнө)
tools/evals/messenger.jsonl   — Messenger AI-ийн eval кейс (126 зохиомол; offline: tools/test/messenger-policy.test.mjs; бодит Claude: admin «Eval», tools/evals/messenger-live.mjs)
firebase.json, .firebaserc    — Firebase CLI хэрэглэх үед (заавал биш)
assets/img/                   — Лого (logo.png, logo-white.png), favicon, og-image; өөрийн зургуудаа энд хийнэ
tools/build.mjs (+ tools/lib) — Build: header/footer, JSON-LD, статик жагсаалт, эмчилгээний хуудсууд, asset хувилбар,
                                sitemap, redirect; --check шалгалт, --preview ноорог
tools/preview.mjs             — Ноорог харах локал сервер (127.0.0.1:8766)
tools/ub-mock-server.mjs      — UB Beauty API-ийн локал хуурамч сервер (зөвхөн хөгжүүлэлтэд)
tools/test/                   — node --test 'tools/test/*.test.mjs'
tools/leak-scan.mjs           — pre-push: push хийх commit бүрийн content/pages-д ноорогийн тэмдэглэл үлдсэн эсэх
emchilgee/                    — Эмчилгээний хуудсууд ба hub (build үүсгэнэ — гараар бүү засаарай)
content/site.mjs              — Эмнэлгийн баталгаатай мэдээлэл (NAP, JSON-LD), байнгын хуудсууд, footer
content/home.json             — Нүүрний hero + «Зөвлөгөө» картуудын СТАТИК хувилбар (= Firestore settings/home-ийн бүтэц)
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

**Нүүрний hero ба «Зөвлөгөө» картууд** (admin → Нүүр хуудас). Статик HTML-ийг `content/home.json`-оос build бичнэ
(`<!-- build:home-hero -->`, `<!-- build:home-posts -->`); admin Firestore `settings/home`-д хадгалбал `main.js` зочны
хөтөч дээр ЗӨВХӨН ялгаатай хэсгийг сольж давхарлана (ижил бол DOM-д хүрэхгүй). Google, JS-гүй хөтөч, Firestore унасан үед
статик хувилбар харагдана. Admin-ий өөрчлөлтийг Google-д хүргэх (7-р үе шатны синк хүртэл): admin → «Хөгжүүлэгчид илгээх
JSON хуулах» → `content/home.json`-д тавих → `node tools/build.mjs` → commit. `content/home.json` өөрчлөгдөхөд index.html-ийн
`data-home-rev` шинэчлэгдэж, түүнээс өмнө admin-д хадгалсан хувилбарыг сайт давхарлахаа болино (repo ялна; admin дахин
хадгалбал буцна). Build `content/home.json`-ийг `tools/lib/home.mjs`-ээр шалгана: хэвшсэн (`norm()`-той ижил,
updatedAt/updatedBy-гүй), дор хаяж 1 харагдах карт, дотоод холбоос байгаа хуудас руу, зураг git-д, хориотой үггүй
(`HOME_CLAIMS_ALLOW`).

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
4. **Цаг захиалах** — үндсэн нь онлайн цаг захиалга (UB Beauty, доорх «Онлайн цаг захиалга»): үйлчлүүлэгч бодит сул цагаас
   сонгож захиалах ба захиалга эмнэлгийн UB Beauty календарьт шууд орно. UB Beauty-ийн API ажиллахгүй (сүлжээ, серверийн
   алдаа, суваг түр зогссон) эсвэл `ubbeauty-config.js`-д түлхүүр хоосон бол хуучин «хүсэлт илгээх» маягт (`#bookForm`)
   нөөц болж гарна: хүсэлт Firestore `bookings`-д бичигдэж, `/admin/` → Захиалга хэсэгт бодит цагт харагдана.
   Firestore ч ажиллахгүй (CDN блок, offline, квот дууссан) эсвэл admin-аас "Онлайн захиалга" модулийг унтраасан үед
   уг маягт хүсэлтийг бэлтгээд Messenger / и-мэйл / SMS / утас сувгаар дамжуулах товчнууд харуулна. Admin-ийн тэр
   тохиргоо зөвхөн нөөц маягтад хамаарна — онлайн захиалгыг түр зогсоох бол UB Beauty OS → Холболт → Вэб суваг.
5. **Өнгө, фонт** — `style.css` дээд хэсгийн `:root` хувьсагчид (`--purple: #654186` брэндийн ягаан).
   Фонт (Manrope, Montserrat) Google Fonts-оос асинхрон (`media="print" onload`) ачаалагдана. ⚠ Өөрийн домэйноос
   ачаалах туршилт (2026-11-24/25, PR #8–#10: preload, local() size-adjust fallback, асинхрон fonts.css) гурван хэлбэрээрээ
   PageSpeed-ийн гар утасны гүйцэтгэлийг 96 → 55–61 (FCP 1.0 → 6.3–6.7 с) болгосон тул буцаав (PR #11). Фонт солихоосоо
   өмнө PageSpeed-ээр хэмж.

## Онлайн цаг захиалга (UB Beauty вэб суваг)

`#contact` хэсгийн «Цаг захиалах» = `assets/js/booking.js`. Урсгал: үйлчилгээ (`GET /services`) → тэр үйлчилгээг хийдэг
мэргэжилтэн (`GET /doctors?service_id=`, доорх «Үйлчилгээ ↔ мэргэжилтэн») → 2 долоо хоногийн хуанли (`/availability`,
`/clinic`-ийн `horizon_days`-ээр хязгаарлана) → сул цаг → нэр, утас (8 оронтой гар утас), тэмдэглэл (≤ 300) →
`POST /bookings`. API-г хуудас ачаалахад биш, захиалгын хэсэг ойртох эсвэл `#contact` холбоос дарах үед л дуудна.
API баримт: UB Beauty репо `docs/API-WEB-CHANNEL.md`.

**Үйлчилгээ ↔ мэргэжилтэн.** Хэн аль үйлчилгээг хийхийг **UB Beauty OS → Тохиргоо → Үйлчилгээ → Үзүүлэх ажилтан**
(`os.ubbeauty.mn/clinic/services/staff`)-д тохируулна — хадгалмагц сайт шууд мөрдөнө (код, deploy хэрэггүй). Сайт
үйлчилгээ сонгох бүрд `GET /doctors?service_id=` дуудаж (нэг зочлолтод кэшлэнэ), дүрэм нь `assets/js/booking-staff.js`
(цэвэр модуль, `tools/test/booking-staff.test.mjs`):
- **Тохируулсан** үйлчилгээ → яг тэр хүмүүс (OS-д ресепшн сонгосон бол ч; гэхдээ захиалга авдаг БҮХ ажилтныг сонгосон
  бол тохируулаагүйтэй ялгагдахгүй тул ресепшн, менежер нуугдана). Шошго үүргээс: бүгд эмч → «Эмч», бүгд гоо
  засалч → «Гоо засалч», холимог → «Мэргэжилтэн» (баримт, хураангуйд ч). Ганц хүн → автоматаар («Энэ үйлчилгээг … хийнэ»),
  олон → «Сул цагтай эмч/гоо засалч/…» (ЗӨВХӨН энэ жагсаалтын сул цагийг нэгтгэнэ) + нэрс. Хэн ч үгүй → утас, Messenger.
- **Тохируулаагүй** үйлчилгээ = API захиалга авдаг бүх ажилтныг буцаана (ялгах туг байхгүй тул шүүлтгүй `/doctors`-той
  тулгаж таньна) → өмнөх түр дүрэм: ресепшн, менежерийг нууж, «Аль нь ч болно»-д эмч → гоо засалч → массаж → сувилагч.
  ⚠ Ийм үйлчилгээг гоо засалчийнх байсан ч эмч дээр захиалж болно — бүх үйлчилгээг OS-д тохируулах нь зөв шийдэл.
- Өөр үйлчилгээ рүү шилжихэд үйлчлүүлэгчийн ӨӨРӨӨ сонгосон хүн шинэ үйлчилгээг бас хийдэг бол хадгалагдана.
- `DOCTOR_UNAVAILABLE` (зочлолтын явцад OS-ийн тохиргоо өөрчлөгдсөн, эсвэл ажилтан идэвхгүй/захиалга авахгүй болсон):
  сул цаг ачаалах эсвэл илгээх үед жагсаалтыг (шүүлтгүй `/doctors`-ийн хамт) нэг удаа шинэчилж, хасагдсан хүний нэрээр
  мэдэгдэнэ. Mock: `/__mock?staff=<service_id>:<doctor_id,…>` (хоосон = тохиргоог арилгах), `/__mock?unbook=<doctor_id>`
  (захиалга авахаа больсон; `rebook=` буцаана), mock-д «AHA 70% Химийн гуужуулалт» → 2 эмч, «Үрэвсэлт батганы нэг удаагийн эмчилгээ» → 2 гоо засалч,
  «Карбокситой нүүрний массаж» → 1 гоо засалч.

| Зүйл | Утга |
|---|---|
| API | `https://www.ubbeauty.mn/api/v1/web` (`ubbeauty-config.js` → `API_BASE`) |
| Түлхүүр | **Нийтийн** `pk_live_…` (`ubbeauty-config.js` → `PUBLISHABLE_KEY`), `X-Api-Key` толгойд. Хоосон бол онлайн захиалга унтарч нөөц маягт ажиллана. Нууц `sk_live_…` түлхүүрийг сайтад, git-д ХЭЗЭЭ Ч бүү тавь |
| Түлхүүр үүсгэх | os.ubbeauty.mn → Холболт → Вэб суваг → Түлхүүр (нийтийн). Зөвхөн нэг удаа харагдана |
| Зөвшөөрсөн домэйн | OS → Вэб суваг → «Зөвшөөрсөн домэйн»: `https://www.skinaid.mn` (яг энэ, ташуугүй). Зөвхөн https; localhost/wildcard хориотой. Бүртгэлгүй домэйноос хөтөч «network error» авч нөөц маягт гарна |
| Горим | OS → Вэб суваг: «Шууд батлах» (захиалга `confirmed`) эсвэл «Ресепшн батална» (`pending_confirmation` — сайт «Хүсэлтийг хүлээн авлаа» гэж харуулж, товч «Хүсэлт илгээх» болно) |
| Түр зогсоох | OS → Вэб суваг → зогсоох (сайт автоматаар нөөц маягт руу шилжинэ, код өөрчлөхгүй) |
| Давхардал | Илгээх бүрт шинэ `Idempotency-Key`; сүлжээ тасарч дахин илгээхэд (ижил агуулга) ижил түлхүүр → давхар захиалга үүсэхгүй |
| Хязгаар | Нэг IP-ээс минутад 60 уншилт (үйлчилгээ солих бүрд 1 + «Аль нь ч болно»-д хүн бүрт 1), өдөрт 10 захиалга; бүх сайтад (нэг түлхүүр) цагт 20 захиалга; нэг утсанд идэвхтэй захиалга ≤ 3 |

**Түлхүүр солих.** OS-д шинэ нийтийн түлхүүр үүсгэх → `ubbeauty-config.js`-д солих → `node tools/build.mjs` → push →
сайт шинэчлэгдсэний дараа OS-оос хуучныг «Хүчингүй болгох».

**Төлбөрөөр баталгаажих (QPay).** OS → Холболт → Вэб суваг-д «Төлбөрөөр баталгаажуулах (QPay)» горим (+ Холболт → QPay-д
мерчант креденшил) сонгосон бол `/clinic` → `new_booking_status: "pending_payment"`, `prepay: { amount, hold_min, ready }`.
`booking.js`: «Төлбөр төлж захиалах» → `POST /bookings` → `payment` (QR зураг, утсанд банкны аппын товч, QPay богино
холбоос, 15 минутын тоолуур) → `GET /bookings/{id}` 4 сек тутам (зөвхөн DB), `POST /bookings/{id}/payment/check` товч
дээр + 30 сек тутам (QPay-ээс бодит шалгалт, захиалга бүрт ≤ 6/мин) → `confirmed` = «Төлбөр төлөгдөж… баталгаажлаа»;
hold дуусвал «хугацаа дууслаа» + «Дахин захиалах». Хуудас дахин ачаалагдвал (банкны аппаас буцахад) `sessionStorage`
(`skinaid:ub-pay`)-оос үргэлжилнэ. `prepay.ready: false` эсвэл `PAYMENT_UNAVAILABLE` → нөөц маягт. Mock:
`/__mock?mode=prepay&hold_sec=30` → захиалга; `/__mock?pay=<id>` төлсөн болгоно, `?expire=<id>` hold дуусгана; утас
`99000007` = 2 дахь «Төлбөр шалгах»-д төлөгдөнө.

**Үнийг нуусан үйлчилгээ.** Эмнэлэг UB Beauty OS → Тохиргоо → Үйлчилгээ-д «Үнийг нийтэд харуулах»-ыг унтраасан бол
`/services` тэр үйлчилгээг `price: null, price_hidden: true`-тай өгнө (UB Beauty docs/API-WEB-CHANNEL.md §2.1б).
`booking.js` түүнийг хасахгүй — «нэр · хугацаа» хэлбэрээр (үнэгүй) харуулж, prepay-д «Төлөх дүн төлбөрийн алхамд
харагдана» гэнэ; дүн зөвхөн төлбөрийн самбарт (`payment.amount`). Mock: «REJURAN Healer 2 мл» (нуусан, ₮750,000).

**Preview дээр бодит туршилт.** Vercel preview хаяг (`https://…vercel.app`) нь «Зөвшөөрсөн домэйн»-д байхгүй тул тэнд нөөц
маягт гарна. Бодит туршихдаа тэр ЯГ хаягийг OS-д түр нэмж, туршаад (захиалга SkinAid-ийн ЖИНХЭНЭ календарьт орно —
ресепшнээс цуцална) хаягийг хасна.

**Локал хөгжүүлэлт.** Жинхэнэ API localhost-оос ажиллахгүй. Хуурамч сервер:

```bash
node tools/ub-mock-server.mjs
```
Хөтчийн console-д (http://localhost:8765): `localStorage.setItem('skinaid:ub-api', 'http://127.0.0.1:8787')` → дахин ачаална.
Болих: `localStorage.removeItem('skinaid:ub-api')`. Горим (`request`, `paused`, нэр нуух) болон алдааны туршилтын утасны
дугааруудыг (`99000001` = SLOT_TAKEN, `99000003` = хариу тасрах г.м.) `tools/ub-mock-server.mjs`-ийн эхэнд бичсэн.
Нөөц маягтыг локалаас бүү илгээ — жинхэнэ Firestore-д бичигдэнэ.

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
- `settings/home` — `hero{badge,titlePre,titleEm,titlePost,text,btnPrimary,btnSecondary,stats[≤3]{num,suffix,label}}, posts[≤12]{id,cat,title,text,by,img,url,hidden}, baseRev` —
  нийтэд уншигдана (зөвхөн нүүр хуудас; нүүр нээх бүрт 3 read болно), admin «Нүүр хуудас» бичнэ. Урт, төрөл, escape: `assets/js/home-render.js`
  LIMITS + norm() (сайт, admin, build бүгд дамжуулна). `firestore.rules` validHero/validPost нь зөвхөн бүтэц (түлхүүр, ≤3 / ≤12) ба
  зураг/холбоосын схемийг шалгана — Firestore дүрэм нэг хүсэлтэд ≤ 1000 илэрхийлэл үнэлдэг тул талбар бүрийг шалгадаг хувилбар
  хадгалалт бүрийг «Эрх хүрэхгүй» болгож байсан (2026-11-26). `baseRev` = хадгалах үеийн `content/home.json`-ийн хувилбар (index.html `data-home-rev`).

- `messenger_*`, `ai_runs` — Messenger AI (доорх «Messenger AI» хэсэг).

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
- SDK хувилбар (`12.16.0`) `firebase-config.js`-ийн `SDK_VERSION` болон `assets/js/*.js`, `admin/*.js` доторх бүх gstatic import URL-д ижил байна; шинэчлэхдээ бүгдийг нь солино (`node tools/build.mjs --check` зөрүүг илрүүлнэ).

## Messenger AI (Facebook Messenger-ийн AI туслах)

**1-р үе шат — «Суурь, сүүдэр» (2026-11-25):** Messenger-т ирсэн асуулт бүрт AI хариуны НООРОГ бичнэ. **Үйлчлүүлэгч рүү юу ч
илгээхгүй** — илгээх код (Send API) огт байхгүй (`tools/test/messenger-architecture.test.mjs` шалгана). Ажилтан Meta Inbox-оос
өөрөө хариулж, admin → «Messenger AI» → «Ноорог»-д «Зөв / Засвартай / Буруу» гэж үнэлнэ. Эмнэлгийн асуулт, гаж нөлөө, зураг/видео/дуу,
гомдол, мөнгө буцаалт, хөнгөлөлт, жирэмсэн/хүүхэд үргэлж «Ажилтанд шилжүүлнэ» (код шийднэ, AI биш — `api/_lib/social/policy.js`).
Дараагийн үе шат: 2 = сургалт ба eval (доорх «Сургалт»), 3 = туслах → зөвшөөрсөн сэдвээр автомат (эзэмшигчийн шийдвэрээр).

```
Messenger → Meta → POST https://www.skinaid.mn/api/messenger
  X-Hub-Signature-256 (түүхий body) → event (давхардалгүй) → 200 → waitUntil:
  echo ангилал (манай бот / Meta-ийн автомат хариу / ажилтан) → зураг = LLM-гүй → нууцлах (утас, имэйл, РД)
  → мэдлэг (settings/site + settings/catalog + эмчилгээний хуудас + нийтэлсэн FAQ + жишээ) → Claude (claude-opus-5-5,
  effort low) → бодлого → messenger_drafts
Өдөр бүр УБ 04:00: /api/cron/daily — гацсан event, хадгалах хугацаа, статус
```

| Файл | Үүрэг |
|---|---|
| `api/messenger.js`, `api/_lib/webhook.js` | GET verify (`META_VERIFY_TOKEN`), POST гарын үсэг (`META_APP_SECRET`), event хадгалах |
| `api/_lib/pipeline.js`, `store.js` | Ярианы түгжээ, echo загвар, төлвийн машин, гацсан event нөхөх (2 мин), Firestore |
| `api/_lib/agent.js`, `claude.js`, `knowledge.js` | Мэдлэг → prompt (кэштэй) → Claude (`fallbacks: "default"`) → бодлого → ноорог |
| `api/_lib/social/` | UB Beauty-ээс (skinaid/ubbeauty@1a43c95c) шилжүүлсэн цэвэр модулиуд (файл бүрийн толгойд эх сурвалж) |
| `api/_lib/firestore.js`, `gcp-auth.js` | Firestore REST (firebase-admin-гүй), Google-ийн серверийн эрх (WIF / SA key) |
| `admin/m-messenger.js` | «Ноорог» (үнэлгээ, «Жишээ болгох»), «Тохиргоо» (горим, яаралтай зогсоолт, сарын хязгаар, серверийн төлөв) |
| `admin/m-messenger-train.js` | «Сургалт»: туршилтын асуулт, мэдлэг (FAQ, брэнд дуу хоолой), жишээ, «AI-д юу орж байна», Eval |
| `admin/m-messenger-overview.js`, `messenger-api.js` | «Тойм» (өдрийн нэгтгэл, үнэлгээний нарийвчлал, 3-р үе шатны зорилт); `/api/admin` дуудлага |
| `api/_lib/crisis.js`, `eval.js` | Хямралын автомат зогсолт; eval-ийн дүгнэлт (offline ба бодит) |
| `api/admin.js`, `api/_lib/admin-api.js`, `admin-auth.js` | Admin-ийн серверийн үйлдэл (Firebase ID token шалгана) — `knowledge`, `test`, `eval_*`, `crisis_check` |
| `api/_lib/generated/pages-knowledge.js` | `node tools/build.mjs` үүсгэнэ: нийтлэгдсэн эмчилгээний хуудсын товч тайлбар, явц, хугацаа (гараар бүү засаарай) |

**Холбоо барих (утас, имэйл).** Эмнэлгийн нийтийн утас, имэйлийн УТГА LLM-д очихгүй — мэдлэгт зөвхөн «contact» баримт («утас,
имэйл бий — чи бичихгүй, систем нэмнэ»). Үйлчлүүлэгч эмнэлгийн утас/имэйлийг асуувал AI товч хариулж (`intent: contact`), КОД
хариуны доор «Холбоо барих: утас … · имэйл …» мөрийг нэмнэ (`disclosure.js contactLine`) — сэдэв нь contact эсвэл хариу «contact»
баримтыг иш татсан үед («Хаяг, утсаа хэлээч»). Утас = `settings/site.phone` (нэг дугаар, 7–12 цифр), имэйл = `settings/site.email`
зөв хэлбэртэй бол; эс бөгөөс сайт шиг тогтмол утга (`clinic-facts.js`). AI дугаар, хаягийг өөрөө бичвэл автоматаар явахгүй (PII lint).
Ажилтанд шилжсэн хариунд нэмэхгүй. Үйлчлүүлэгч ӨӨР рүүгээ залгуулахыг хүсвэл («над руу залгаарай», «эргээд залгаарай») = ажилтан
(кодын дохио `human_request` — AI буруу ангилсан ч шилжинэ).

**Хувийн мэдээлэл.** PSID хадгалахгүй (`PSID_SALT`-аар HMAC → `psidHash`). Текст ЗӨВХӨН нууцалсан. Зураг/видео/дууны зөвхөн төрөл
(URL-гүй), LLM руу хэзээ ч явахгүй. Захиалгын (`bookings`) өгөгдөлд хүрэхгүй. `ai_runs`-д текст байхгүй (токен, зардал, хугацаа л).
Хадгалах хугацаа (cron устгана): event 30, ярианы мессеж 180, ноорог 180, `ai_runs` 400, echo загвар 90 хоног; audit — хязгааргүй.

**Firestore** (бүгдийг admin уншина; сервер IAM-аар бичнэ — rules серверт хамаарахгүй):
`messenger_settings/main` (admin: горим off|shadow, killSwitch, сарын хязгаар — өөрчлөлт бүр `messenger_audit`-д нэг batch-д),
`messenger_drafts` (сервер үүсгэнэ, admin зөвхөн `rating/note/ratedAt/ratedBy`), `messenger_threads/{psidHash}` + `messages`,
`messenger_events`, `ai_runs`, `messenger_usage/{YYYY-MM}`, `messenger_status/main`, `messenger_echo_templates`,
`messenger_kb` (admin «Сургалт» → мэдлэг: `title, body, status draft|published`; id `voice` = брэнд дуу хоолой),
`messenger_examples` (`kind good|bad, userText, reply, note`; ноорогоос үүссэн жишээ = `x_<ноорогийн id>`).
`messenger_usage/<YYYY-MM-DD>` = өдрийн тоологч ба «Тойм»-ын нэгтгэл (90 хоног). `messenger_status/eval_*` = eval-ийн тайлан.
Query бүр composite index ШААРДАХГҮЙ.
Spark квот: нэг хэрэглэгчийн мессежид ойролцоогоор 11 write + 20 read (өдөрт ~1,500 мессеж хүртэл багтана); нэг ярианд өдөрт ≤ 40 удаа AI (нэг хэрэглэгч квот, сарын хязгаарыг дуусгахгүй); admin «Ноорог» нэг нээлтэд ≤ 30 + 3 read.

### Сургалт (2-р үе шат, 2026-11-27)

Admin → **Messenger AI → «Сургалт»**. Модель дахин сургадаггүй — AI-д өгөх мэдлэг, жишээг эзэмшигч өөрөө удирдана:

- **Мэдлэг (FAQ, бодлого).** Зогсоол, төлбөрийн хэлбэр, цуцлах нөхцөл г.м. «Нийтэлсэн» бичлэг AI-ийн мэдлэгт `kb:<id>` баримт
  болж орно (≤ 1 минутад — доорх «кэш»). Эзэмшигчийн шийдвэр (2026-11-26): нийтэлсэн мэдлэгт бичсэн ₮ дүн, хувь, хөнгөлөлтийг AI
  хэлж болно — ЗӨВХӨН тухайн бичлэгийг иш татахад («хөнгөлөлт байхгүй» гэсэн өгүүлбэр хөнгөлөлтийг зөвшөөрөхгүй). Утас/имэйл/РД/
  урт дугаартай бичлэг AI-д ОРОХГҮЙ (нууцлахгүй, бүхэлд нь хасна). Агуулга ≤ 1500, нийт ≤ 24,000 тэмдэгт, ≤ 60 бичлэг.
  «Брэнд дуу хоолой, заавар» (id `voice`) — өнгө аяс; хатуу дүрмийг (эмнэлгийн зөвлөгөө, үнэ зохиохгүй) өөрчилж чадахгүй.
- **Жишээ.** «Ноорог» картад үнэлгээ хадгалсны дараа «Жишээ болгох» → урьдчилан бөглөсөн засварлагч (Засвартай → сайн жишээ
  /ажилтны зөв хариу/, Зөв → сайн, Буруу → муу /тэмдэглэл = яагаад/): үйлчлүүлэгчийн нэр, нас, эрүүл мэндийн мэдээллийг арилгаад
  хадгална (жишээ AI-ийн бүх ярианд ордог). Үнэлгээ өөрчлөгдвөл «Жишээг шинэчлэх». Ноорогоос үүссэн жишээ (`x_…`) сүүлд засснаас
  хойш 180 хоногийн дараа cron устгана. Prompt-ийн 3-р кэштэй блок, хамгийн шинэ ≤ 30 (≤ 12,000 тэмдэгт); жишээн дэх үнэ баримт биш.
- **Туршилтын асуулт.** Үйлдвэрлэлийн ижил мэдлэг/prompt/бодлогоор ноорог авна; хэнд ч илгээхгүй, ноорог хадгалахгүй
  (`ai_runs.kind = admin_test`). Нэг удаа ≈ $0.01–0.02 (кэш дулаан үед); сүүлийн 1 цагт AI ажиллаагүй бол эхний дуудлага ≈ $0.07
  — 1 цагийн кэш бичих нь оролтын 2× үнэтэй (production 2026-11-26: 7,554 токен бичээд $0.068; кэшээс уншсан ноорог $0.008–0.011).
  Сарын хязгаарт тоологдоно; өдөрт ≤ 100, сард ≤ сарын AI хязгаарын 20%
  (Claude-ийг дуудахаас ӨМНӨ тоолно). Яаралтай зогсоолт асаалттай бол хаалттай; горим «Унтраалттай» үед ч ажиллана.
- **AI-д юу орж байна.** Серверээс (LLM-гүй) — аль бичлэг орсон, аль нь яагаад ороогүй, AI хэлж болох дүн, мэдлэгийн бүтэн текст.
- **Эмчилгээний хуудас.** `content/pages`-д нийтлэгдсэн хуудсын товч тайлбар, хугацаа/давтамж/сэргэлт, «юу вэ», «явц» л
  (эсрэг заалт, гаж нөлөө, арчилгаа ОРОХГҮЙ — тэр асуулт үргэлж эмч, ажилтанд). `node tools/build.mjs` → `api/_lib/generated/pages-knowledge.js`;
  иш нь ганц хуудастай бол захиалгын холбоос `?svc=<slug>`.

`POST /api/admin` (зөвхөн `https://www.skinaid.mn` Origin, `Authorization: Bearer <Firebase ID token>`): token-ийг firebase-admin-гүй
шалгана (Google securetoken-ийн x509 түлхүүр, `aud/iss = skinaid-mn`, `email_verified`, и-мэйл = `firestore.rules isAdmin()`
жагсаалт — тест тулгана). Шинэ env, rules өөрчлөлт ШААРДЛАГАГҮЙ.

**Кэш, квот.** Admin мэдлэг/жишээ хадгалах, устгах бүрт `messenger_kb/_rev` тэмдгийг НЭГ batch-д шинэчилнэ (ноорог төлөвтэй —
AI-д орохгүй). Сервер ≥ 1 минут тутам зөвхөн «толгой»-г (settings/site, settings/catalog, voice, `_rev` = 4 read) шалгаж, өөрчлөгдсөн
бол л мэдлэгийг (≤ 70 + 40 read) дахин ачаална, эс бөгөөс 30 минут тутам. Уншиж чадаагүй бол сүүлийн зөв мэдлэгээр үргэлжилнэ.
«Сургалт» таб анх нээхэд ≤ 200 read (жишээг ноорогийн цэс уншсан бол дахин уншихгүй). Prompt-ийн кэш 1 цаг (`ttl: 1h` — мессеж
сийрэг ирдэг тул 5 минутын кэш бараг бүр удаа дахин бичигддэг).

### Eval (2-р үе шат)

`tools/evals/messenger.jsonl` — **126 зохиомол кейс** (бодит мессеж биш): мэнд, цаг, хаяг, үйлчилгээ, нийтийн/нуусан үнэ, багц,
захиалга, латин үсгээр бичсэн монгол, олон мөрт яриа + **62 эрсдэлтэй** (эмнэлгийн, гаж нөлөө, гомдол, буцаалт, хөнгөлөлт гуйх,
хууль, жирэмсэн/хүүхэд, хүн хүсэх, prompt injection, үнэ зохиолгох уруу таталт). Кейс бүр `expect.handoff` (true | false | 'any' —
мэдлэгээс хамаарна), `intents`, `must_not`; offline-д `gold` (тэнцэх ёстой), `bad` (унах ёстой), `trap` (LLM буруу ангилсан ч КОД
хүнд шилжүүлэх ёстой — кодын хамгаалалтын тест). Дүгнэлт = `api/_lib/eval.js` (offline ба бодит eval хоёулаа).

- **Offline** (`node --test`) — gold/bad/trap саналаар бодлогыг шалгана, төлбөргүй.
- **Бодит Claude** — admin → Messenger AI → Сургалт → **Eval**: НИЙТЭЛСЭН мэдлэгтэй, 6 кейс тутам (`/api/admin` eval_start →
  eval_chunk → eval_finish), ≈ $2–3 нэг удаа (нэг ажиллагаа $5-д хүрвэл зогсоно — хэтрэлт ≤ нэг хэсэг), өдөрт ≤ 3. Зардал сарын
  хязгаарт ба туршилттай ИЖИЛ admin-ий дэд хязгаарт (сарын зардлын 20%, `testCostMicroUsd`) тоологдоно — бүтэн ажиллагаанд
  хүрэлцэхгүй бол эхлэхгүй, үйлдвэрлэлийн ноорогт 80% үлдэнэ. Хэсгийг Claude-ийг дуудахаас ӨМНӨ эзэмшинэ (давхар/зэрэг хүсэлт хоёр
  удаа төлөхгүй; тасарсан түгжээ 90 с-ийн дараа чөлөөлөгдөнө); admin түр алдаанд 3 удаа хүртэл дахин илгээнэ (давтсан хэсэг үнэгүй).
  AI-ийн гаралт буруу/татгалзсан (кодын нөөц шилжүүлэлт) тэнцсэнд тоологдохгүй. Унасан кейс бүрт бодлогын шалтгааны код
  хадгалагдаж (`failures[].reasons`), тайлан «Шаардлагагүй шилжүүлсэн шалтгаан»-ыг тоогоор харуулна (`summary.handoffReasons`) —
  «AI өөрөө ажилтанд даатгасан», «AI итгэл бага» нь ихэвчлэн мэдлэг дутуу гэсэн үг. Тайлан + өмнөх БҮТЭН ажиллагаатай харьцуулалт
  `messenger_status/eval_<id>`, түүх `messenger_status/evals` (сүүлийн 10; нэг ч кейс дуусаагүй ажиллагаа орохгүй); орхисон
  ажиллагаа 7 хоногт устна. Явж байхад хуудсыг хаах/дахин ачаалах/гарахад анхааруулж, хагас тайланг хадгалуулна. Кейсүүд функцэд
  `node tools/build.mjs` → `api/_lib/generated/eval-cases.js`.
- **Локал CLI** (хөгжүүлэгч, өөрийн түлхүүр shell-д): `node tools/evals/messenger-live.mjs --dry-run` (тооцоо), `--limit`, `--only`,
  `--max-usd`, `--compare` — сайтын анхдагч каталогтой; тайлан `.preview/evals/` (git-д орохгүй).

2026-11-27: eval кодын эрсдэлийн дохионы 5 цоорхойг илрүүлж зассан («буцааж авмаар», «үнээ буулгаач», «хүнтэй ярих», «идээ гарсан»,
«хөх ягаан болсон» — өмнө нь LLM буруу ангилбал хүнд шилждэггүй байв). «Буцааж залгаарай / холбогдоорой / бичээрэй» мөнгө буцаалт
биш. Аюулгүй тал руу алдах (хүнд шилжүүлэх) хуурамч дохио үлдсэн: «Цагаан сарын идээ гаргах», «хөх ягаан өнгө», «цагаан идээтэй
хооллох» — eval-ийн «Шаардлагагүй ажилтанд шилжүүлсэн»-ээр харагдана.

Анхны бодит ажиллагаа (production, 2026-11-26): 124 кейс ≈ 4 минут, $0.95; тэнцсэн 97 (78.2%), эрсдэлтэй 59/60, AI алдаа 0, зохиосон
үнэ/санал 8 (бүгдийг код барьсан). Унасан 27 бүгд аюулгүй тал руу (26 шаардлагагүй шилжүүлэлт): 15 нь production-ий мэдлэгт ажлын
цаг, HIFU байхгүйгээс — кейсүүд анхдагч каталогт тулгуурласан тул мэдлэгээс хамаарах кейс «уналт» болж харагдана. 2 дахь
ажиллагаа (шалтгаантай): 96/124; шаардлагагүй шилжүүлсэн 27 бүгд AI-ийн өөрийн шийдвэр (өөрөө даатгасан 24, итгэл бага 24) — кодын
бодлого нэгийг ч буруу шилжүүлээгүй. Үүнээс гарсан засвар: утас/имэйлийн асуултад код «Холбоо барих» мөр нэмдэг болсон (дээр).
3 дахь ажиллагаа (засварын дараа): 104/126, contact 3/3, шинээр унасан алга; $1.32 — кэш хоосон (заавар өөрчлөгдсөн) үед эхний
хэсгийн зэрэг 6 дуудлага тус бүр кэшээ бичсэн (+$0.33). Одоо эхний хэсгийн эхний кейс ГАНЦААР явж кэшийг бичүүлнэ (≤ 8 с
хүлээнэ), үлдсэн нь түүний дараа зэрэг — мэдлэг/заавар өөрчилсний дараах eval ≈ $1 (кэш дулаан үед $0.95).

2026-11-26 (эзэмшигч): эмнэлэгт **Ультраформер / HIFU төхөөрөмж байхгүй** (production каталогоос 11-24-нд хасагдсан). HIFU-д
тулгуурласан 16 кейсийг каталогт БАЙГАА зүйлээр сольсон: үйлчилгээний асуулт → «Моно Thread утсан эмчилгээ» (үнийг ажилтан хэлнэ),
хугацаа → арьсны үзлэг, үнийн асуулт → «Glow Start» багц (ил үнэтэй; сэдэв price эсвэл promotion). Нэр нь өөрчлөгдсөн 5 кейс
(`svc-thread`, `svc-exam-duration`, `price-package`, `price-package-typo`, `lure-package-150`) өмнөх ажиллагаатай харьцуулагдахгүй.

### Тойм ба хямралын автомат зогсолт (2-р үе шат)

**«Тойм» таб** (admin → Messenger AI): сүүлийн 7/30 хоногийн (УБ-ын хуанлийн өдөр) ноорог, үнэлгээний «Зөв / Засвартай / Буруу» хувь,
3-р үе шатны зорилт — «Автомат боломжтой» ноорогийн ≥ 85% нь шууд эсвэл бага засвартай (`editRatio < 0.3`, ≥ 50 үнэлгээ), чиглэл,
сэдэв, AI хариуны ба туршилт/eval-ийн зардал, алдаа, кэшийн хувь, пэйжийн хариу (echo) хэнийх. Өдрийн тоо `messenger_usage/<YYYY-MM-DD>`
(90 хоног) — сервер ноорогтой НЭГ commit-д нэмнэ (давхар тоологдохгүй). Таб нээх/хугацаа солих бүрт ≤ 32 + ≤ 500 read.

**Автомат зогсолт** (`api/_lib/crisis.js`; эзэмшигчийн шийдвэр 2026-11-26 — сүүдэрт ч БОДИТООР зогсооно). Аль нэг нь биелбэл
`messenger_settings/main.killSwitch = true` (горим, хязгаар хэвээр, `updatedBy: system`) + `messenger_audit` (`auto_stop`) +
`messenger_status/main.autoStop` — НЭГ commit, эзэмшигч яг тэр мөчид хадгалсан бол дарахгүй:
- сүүлийн 24 цагт үнэлсэн, одоогийн prompt-ийн хувилбартай ноорогийн ≥ 5 нь «Буруу» ба ≥ 50% (автомат зогсолтын дараа дахин
  асаасан бол түүнээс хойш үүссэн ноорог л — хуучин ноорогийг үнэлээд дахин зогсохгүй; анхны дахин асаасан мөч
  `autoStop.resumedAt`-д тэмдэглэгдэнэ);
- Claude дараалан ≥ 5 удаа ЗАСАГДАХГҮЙ алдаа (түлхүүр, кредит, хүсэлт буруу) — түр зуурын алдаа (timeout, 429, 5xx) дахин
  оролдогддог тул тоологдохгүй;
- өнөөдрийн үйлдвэрлэлийн зардал ≥ сарын зардлын хязгаарын 20% (туршилт, eval тоологдохгүй; өнөөдөр ЭНЭ шалтгаанаар зогссоны дараа
  дахин асаасан бол маргааш хүртэл үгүй).

Шалгалт: агентын ажиллагаа бүрийн дараа (алдаа/зардал — +3 read), admin «Буруу» хадгалсны дараа (`crisis_check`, ≤ 53 read,
инстанст 30 с-д ≤ 1 — хоцорсон бол admin дахин нэг удаа илгээнэ), өдрийн cron. Admin-д улаан тууз шалтгаантай; дахин асаах =
«Тохиргоо»-д яаралтай зогсоолтыг унтрааж хадгалах. Тохиргоог ачаалснаас хойш систем зогсоосон бол хуучин маягтын хадгалалт
татгалзагдаж (transaction + `lastAuditId`), шинэ утга ачаалагдана — AI чимээгүй дахин асахгүй. «Яаралтай зогсоох» товч хуучирсан
хуудаснаас ч татгалзахгүй (одоогийн утган дээр зогсооно).

**Echo-гийн шалтгаан** (`classifyEchoWhy`): `own_app`, `known_app`, `template` (≥ 3 ярианд ижил текст), `no_user`, `fast_gap`
(хэрэглэгчээс ≤ 15 с), `default` (= ажилтан). Production-ийн бодит мета (2026-11-27, текст уншаагүй): Meta-ийн автомат хариу 2–4 с,
ажилтан ≈ 1 цаг — босго хэвээр. 3-р үе шатны `strict` бодлого (одоо ИДЭВХГҮЙ): хэрэглэгч бичээгүй яриан дахь echo = ажилтан,
хурдан хариуны босго 8 с. Багцыг дахин боловсруулахад аль хэдийн хадгалсан echo-гийн ангиллыг хэвээр авна (pipeline мессежийг
уншина, +1 read/echo), шинэ echo-г ӨМНӨХ хэрэглэгчийн мессежтэй харьцуулна (бот 12 цаг дуугүй болохгүй); хоцорч ирсэн echo
(өмнөх мөч тодорхойгүй) = ажилтан; echo-гийн өдрийн тоо мессеж анх бичигдэхэд л.

### Эзэмшигчийн алхам (нэг удаа)

1. **Google Cloud (төсөл skinaid-mn) — Workload Identity Federation** (урт хугацааны түлхүүргүй; https://vercel.com/docs/oidc/gcp):
   APIs & Services → «IAM Service Account Credentials API», «Security Token Service API» асаах → IAM & Admin → Workload Identity
   Federation → Create pool `vercel` → Provider: OIDC, ID `vercel`, Issuer `https://oidc.vercel.com/<team-slug>`, Audience: Allowed
   audiences = `https://vercel.com/<team-slug>`, Attribute mapping `google.subject` = `assertion.sub` → Service Accounts → Create
   `messenger-ai`, role **Cloud Datastore User** (өөр эрхгүй) → тэр service account → Permissions → Grant access: principal
   `principal://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/vercel/subject/owner:<team-slug>:project:skinaid.github.io-y1vf:environment:production`,
   role **Workload Identity User** (`<team-slug>`, төслийн нэрийг Vercel → Settings → General-оос яг хуулна). (Байгууллагын бодлого service account key үүсгэхийг зөвшөөрдөг бол нөөц зам: key JSON →
   `FIREBASE_SERVICE_ACCOUNT`. WIF-ийг санал болгоно.)
2. **Vercel → Settings → Environment Variables (Production):** `GCP_PROJECT_ID=skinaid-mn`, `GCP_PROJECT_NUMBER`,
   `GCP_SERVICE_ACCOUNT_EMAIL`, `GCP_WORKLOAD_IDENTITY_POOL_ID=vercel`, `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=vercel`,
   `ANTHROPIC_API_KEY`, `PSID_SALT` (≥ 32 санамсаргүй тэмдэгт), `CRON_SECRET` (≥ 16). Meta апп үүссэний дараа: `META_APP_SECRET`,
   `META_VERIFY_TOKEN` (өөрөө зохиосон урт мөр), `META_APP_ID`, `META_PAGE_ID` (SkinAid пэйжийн id). `META_PAGE_TOKEN` 1-р үе шатанд
   зөвхөн cron-ын token шалгалтад (заавал биш). Нууцыг git, чат, лог-д ХЭЗЭЭ Ч бүү бич. Env солисны дараа Redeploy.
3. **Rules нийтлэх:** `firestore.rules`-ийг console → Firestore → Rules-д буулгаж Publish (доорх «Rules шалгах»).
4. **Meta developer апп → Webhooks:** Callback URL `https://www.skinaid.mn/api/messenger`, Verify token = `META_VERIFY_TOKEN`,
   field: `messages`, `message_echoes`, `messaging_postbacks`, `messaging_referrals`, `messaging_handovers`, `standby`.
5. **Admin → Messenger AI → Тохиргоо → «Сүүдэр»** → Хадгалах. «Серверийн төлөв»-д webhook-ийн сүүлийн цаг гарч эхэлнэ.

**Яаралтай зогсоох:** admin → Messenger AI → «Яаралтай зогсоох» (нэг товч; мессеж хадгалагдахаа больж, AI ажиллахгүй). Бүрэн
салгах: Vercel env-ээс `ANTHROPIC_API_KEY`-г устгах эсвэл Meta аппын webhook-ийг унтраах.

**Rules шалгах** (emulator-гүй — Java байхгүй): нийтлэхээс өмнө console → Rules → Rules Playground; нийтэлсний дараа admin хуудаснаас
(App Check-тэй хөтөч) зөвшөөрөгдсөн: тохиргоо+audit batch, ноорогийн үнэлгээ; хориотой: audit-гүй тохиргоо, audit засах/устгах, ноорогийн
`reply` засах, ноорог үүсгэх, `messenger_events`/`ai_runs`/`messenger_status` бичих, нэвтрээгүй унших. Туршилтын мөрийг устгана.

**Тест:** `node --test 'tools/test/*.test.mjs'` — `messenger-*.test.mjs` (webhook задлалт, echo, бодлого, eval 124 кейс, санах ойн
хуурамч Firestore REST-тэй бүтэн урсгал, архитектур, rules, мэдлэг, admin, сургалт, admin API/token). Сүлжээ, `npm install` шаардахгүй. Бодит Meta-тай E2E нь
Meta апп (0-р үе шат) үүссэний дараа.

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
- Хуучин Wix замууд: `/service-page/*` → `/emchilgee` (hub, 307), `/post/*`, `/blog/*` → `/#blog`, `/book-online*` → `/#contact`.
  `content/pipeline.mjs`-д тулгагдсан хуучин URL нь тухайн хуудас гарах хүртэл hub-ийн ангилал руу (`/emchilgee#<category>`, 307),
  гарсны дараа хуудас руу 308 — хоёуланг нь build удирдана.
  `/product-page/*` (хуучин онлайн дэлгүүрийн 25 бараа) зориуд redirect-гүй — 404 өгч индексээс хурдан гарна (2026-11-24 аудит:
  нүүр рүү бөөнөөр redirect хийхийг Google «soft 404» гэж үздэг, сайт бараа зардаггүй).
  Эмчилгээний хуудас нийтлэгдэхэд `content/pipeline.mjs` / хуудасны `legacy` URL-ууд → тэр хуудас руу 308 redirect-ийг build
  автоматаар `vercel.json`-д (catch-all-аас өмнө, percent-encoded) нэмнэ. `/emchilgee/` руу заасан дүрмийг гараар бүү засаарай.
- **Кирилл URL:** Vercel кирилл замыг зөвхөн percent-encoded хэлбэрээр таардаг (2026-11-08 туршсан: `/zz-probe/тест` raw эх 404, `%D1%82%D0%B5%D1%81%D1%82` эх 307). Тиймээс кирилл эхтэй redirect-ийг `encodeURI()` хэлбэрээр (том hex) бичнэ.
- `/admin` болон доорх бүх файл: `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`.
- Шалгах: `curl -sIL -o /dev/null -w '%{num_redirects} %{http_code} %{url_effective}\n' https://www.skinaid.mn/privacy-policy` → `1 200 https://www.skinaid.mn/privacy`.

Нэмэлт мэдээлэл: `robots.txt`, `sitemap.xml`, `404.html` repo-д бий; `admin/index.html` нь `meta robots noindex, nofollow`-той (robots.txt-д Disallow хийвэл Google тэр meta-г уншиж чадахгүй тул зориуд хориглоогүй); `.gitignore`-оор эх лого JPG, `.claude/` нийтлэгдэхгүй.

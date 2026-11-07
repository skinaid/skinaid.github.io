# SkinAid.mn — вэб сайт

Арьсны өвчин, гоо заслын SkinAid эмнэлгийн орчин үеийн нэг хуудаст (single-page) вэб сайт.
Цэвэр HTML + CSS + JavaScript — ямар ч framework, build алхам шаардлагагүй.
Backend: **Firebase (Spark үнэгүй багц)** — захиалга Firestore-д хадгалагдаж, `/admin/` удирдлагын хэсгээр Google-ээр нэвтэрч удирдана.

## Файлын бүтэц

```
index.html                    — Үндсэн хуудас (бүх хэсэг)
assets/css/style.css          — Загвар (өнгө, фонт, responsive)
assets/js/main.js             — Цэс, анимаци, үйлчилгээний шүүлтүүр, FAQ, маягт (Firestore + fallback), тохиргоо унших
assets/js/catalog-defaults.js — Үйлчилгээ/ангилал/багцын АНХНЫ утга (сайт + admin хоёулаа ашиглана)
assets/js/firebase-config.js  — Firebase төслийн нийтийн тохиргоо, admin и-мэйлийн жагсаалт (UI-д)
assets/js/backend.js          — Firestore-lite: захиалга бичих, settings/site + settings/catalog унших
admin/                        — Удирдлагын хэсэг (index.html, admin.js, admin.css): Google нэвтрэлт, 3 модуль
firestore.rules               — Firestore аюулгүй байдлын дүрэм (console-д нийтэлсэнтэй ижил байлгана)
firebase.json, .firebaserc    — Firebase CLI хэрэглэх үед (заавал биш)
assets/img/                   — Лого (logo.png, logo-white.png), favicon, og-image; өөрийн зургуудаа энд хийнэ
```

## Локал дээр үзэх

```bash
python3 -m http.server 8765
```
Дараа нь браузерт http://localhost:8765 нээнэ.

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

### Admin нэмэх / хасах

1. `firestore.rules` → `isAdmin()` доторх жагсаалтад Google и-мэйлийг нэмж, дүрмийг дахин Publish хийнэ (жинхэнэ хамгаалалт энд).
2. `assets/js/firebase-config.js` → `ADMIN_EMAILS`-д мөн нэмж push хийнэ (admin хуудасны цэс харуулахад л хэрэглэнэ).

### Хязгаар, анхаарах зүйл

- Spark квот: өдөрт 50,000 read, 20,000 write, 1 GiB хадгалалт. Сайт нэг нээлтэд 2 read; admin хуудас нээлттэй үед захиалга бүрт 1 read.
- Шинэ захиалгын и-мэйл/SMS мэдэгдэл **байхгүй** (Cloud Functions Blaze шаарддаг). Admin хуудсыг нээлттэй байлгавал бодит цагт
  шинэчлэгдэж, "Шинэ захиалгын мэдэгдэл асаах" дарсан бол браузерын мэдэгдэл + дуу гарна.
- Захиалга үүсгэх нь нийтэд нээлттэй тул спам ирж болно: дүрмийн хатуу validation + маягтын honeypot талбар хамгаална.
  Хэрэгтэй бол дараагийн алхам — Firebase App Check (reCAPTCHA) асаах.
- Firebase web config (`apiKey` гэх мэт) нууц биш, нийтэд ил байх зориулалттай. Аюулгүй байдал нь дүрэм + allowlist.
- Захиалгын өгөгдөл хувийн мэдээлэл тул admin хуудсыг зөвхөн итгэлтэй төхөөрөмжөөс нээж, ажлаа дуусаад "Гарах" дарна.
- SDK хувилбар (`12.16.0`) `backend.js`, `admin/admin.js`, `firebase-config.js` гурвуулаа ижил байна; шинэчлэхдээ гурвууланг нь солино.

## Байршуулалт (GitHub Pages)

Амьд хаяг: **https://skinaid.github.io/**
Repo: https://github.com/skinaid/skinaid.github.io (`main` салбарын root-оос шууд нийтлэгдэнэ).

Шинэчлэх алхам — файлаа зассаны дараа:

```bash
git add -A && git commit -m "Өөрчлөлтийн тайлбар" && git push
```

Push хийснээс 1–2 минутын дараа сайт шинэчлэгдэнэ (Actions таб дээр "pages build and deployment" ажиллана).
CSS/JS-ийн өөрчлөлт хэрэглэгчдэд шууд харагдахын тулд `index.html` дахь `style.css?v=...`, `main.js?v=...` дугаарыг өөрчилнө.

### skinaid.mn домэйныг холбох (бэлэн болсон үед)

1. Repo-ийн root-д `CNAME` файл үүсгэж дотор нь `www.skinaid.mn` гэж бичээд push хийнэ.
2. Домэйн бүртгэгч (DNS) дээрээ:
   - `www` → CNAME `skinaid.github.io`
   - `@` (root) → A бичлэгүүд: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
3. GitHub → Settings → Pages → Custom domain-д `www.skinaid.mn` оруулж, "Enforce HTTPS"-ийг идэвхжүүлнэ (сертификат автоматаар гарна).
4. Wix-ийн DNS бичлэгүүдийг устгана. DNS шинэчлэгдэх хүртэл 1–24 цаг.

Нэмэлт мэдээлэл: `robots.txt` (`/admin/`-ийг индекслэхгүй), `sitemap.xml`, `404.html` repo-д бий; `.gitignore`-оор эх лого JPG, `.claude/` нийтлэгдэхгүй.

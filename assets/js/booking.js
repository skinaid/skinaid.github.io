/* ==========================================================================
   SKIN AID — booking.js (ES module)
   Онлайн цаг захиалга: UB Beauty «Вэб суваг» REST API (UB Beauty репо → docs/API-WEB-CHANNEL.md).
   Урсгал: үйлчилгээ → тэр үйлчилгээг хийдэг мэргэжилтэн (GET /doctors?service_id=, OS «Үзүүлэх ажилтан»; дүрэм
   booking-staff.js) → өдөр → тэр өдрийн сул цаг → нэр, утас, тэмдэглэл → POST /bookings.

   - API-г хуудас ачаалахад БИШ, захиалгын хэсэг ойртох / «Цаг захиалах» дарах үед л дуудна.
   - Нийтийн түлхүүр (pk_…) `X-Api-Key` толгойд. Сайтын origin нь OS → Вэб суваг → «Зөвшөөрсөн домэйн»-д
     байх ёстой, эс бөгөөс хөтөч зөвхөн «network error» харна (CORS).
   - Илгээх оролдлого бүрт ШИНЭ Idempotency-Key; сүлжээ тасарч ИЖИЛ агуулгаар дахин илгээхэд ИЖИЛ түлхүүр
     (сервер давхар захиалга үүсгэхгүй, анхны захиалгаа буцаана).
   - API ашиглах боломжгүй (сүлжээ, 5xx, суваг зогссон, түлхүүр хоосон…) бол #bookForm (Firestore хүсэлт,
     main.js) нөөц болж гарна. Алдааны дотоод мэдээллийг үйлчлүүлэгчид харуулахгүй — кодоор нь өөрсдийн текст.
   - «Төлбөрөөр баталгаажих» горим (OS → Вэб суваг → prepay, UB Beauty 0202): захиалга pending_payment-ээр үүсч
     15 минут цаг хадгалагдана; хариуны `payment` (QR зураг, банкны аппын холбоос, богино холбоос)-ийг харуулж,
     GET /bookings/{id}-ээр (4 сек) төлөвийг, POST /bookings/{id}/payment/check-ээр (товч + 30 сек тутам) QPay-г
     шалгана; confirmed болмогц «баталгаажлаа». Хуудас дахин ачаалагдвал sessionStorage-оос үргэлжилнэ.
   Локал хөгжүүлэлт: README → «Онлайн цаг захиалга» (tools/ub-mock-server.mjs).
   ========================================================================== */
import { API_BASE, PUBLISHABLE_KEY } from './ubbeauty-config.js?v=8eb0f74a';
import { cleanStaff, providersFor, roleWords, personWords, keepChoice } from './booking-staff.js?v=c2cd0d52';

const form = document.getElementById('ubForm');
if (form) setup(form);

function setup(form) {
  'use strict';

  /* ---------- Тохиргоо ---------- */
  const TEL = 'tel:+97676000505';
  const PHONE_TXT = '7600-0505';
  const MESSENGER = 'https://m.me/Skinaid.mn';
  const RANGE_DAYS = 14;          // API: /availability муж ≤ 14 хоног
  const NOTE_MAX = 300;
  const WD_SHORT = ['Да', 'Мя', 'Лх', 'Пү', 'Ба', 'Бя', 'Ня'];
  const WD_LONG = ['Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба', 'Ням'];
  const PAY_POLL_MS = 4000;        // GET /bookings/{id} — зөвхөн DB (QPay руу хандахгүй)
  const PAY_CHECK_MS = 30000;      // POST …/payment/check — QPay-ээс бодит шалгалт (захиалга бүрт ≤ 6/мин)
  const PAY_KEY = 'skinaid:ub-pay';

  let apiBase = API_BASE;
  let apiKey = String(PUBLISHABLE_KEY || '').trim();
  // Локал хөгжүүлэлт: localhost дээр л mock сервер рүү чиглүүлж болно (жинхэнэ API localhost origin-ийг зөвшөөрдөггүй).
  // localStorage.setItem('skinaid:ub-api', 'http://127.0.0.1:8787') → README.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    try {
      const local = localStorage.getItem('skinaid:ub-api');
      if (local && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(local)) { apiBase = local; apiKey = 'pk_test_local_mock'; }
    } catch (_) { /* localStorage хаалттай */ }
  }
  // Зөвхөн нийтийн түлхүүр. Нууц (sk_) түлхүүр хөтчид хэзээ ч ажиллахгүй, ил гарвал аюултай.
  if (apiKey && !/^pk_/.test(apiKey)) {
    console.error('[booking] ubbeauty-config.js: зөвхөн нийтийн (pk_) түлхүүр тавина.');
    apiKey = '';
  }

  /* ---------- Туслах ---------- */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Огноо = Улаанбаатарын 'YYYY-MM-DD'. Монгол 2017 оноос хойш зуны цаг хэрэглэдэггүй (UTC+8 тогтмол).
  const DAY = 86400000;
  const ubToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const dayNum = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY;
  const addDays = (d, n) => new Date((dayNum(d) + n) * DAY).toISOString().slice(0, 10);
  const weekday = (d) => (new Date(dayNum(d) * DAY).getUTCDay() + 6) % 7;   // 0 = Даваа
  const monday = (d) => addDays(d, -weekday(d));
  const monthDay = (d) => `${+d.slice(5, 7)}-р сарын ${+d.slice(8, 10)}`;
  const dateLong = (d) => `${monthDay(d)} (${WD_LONG[weekday(d)]})`;
  const money = (n) => '₮' + Math.round(n).toLocaleString('en-US');
  // Эмнэлэг үнийг нуусан үйлчилгээ (UB Beauty 0212): API `price: null, price_hidden: true` — үнийг огт харуулахгүй,
  // төлөх дүн зөвхөн төлбөрийн алхамд (`payment.amount`).
  // Эзэмшигч 2026-11-27: UB Beauty-д үнэ нийтэд ил байсан ч ЭНЭ маягтад төлбөрийн алхмаас өмнө үнэ харуулахгүй
  // (үйлчилгээний жагсаалт = нэр · хугацаа; сонгосны дараа «Төлөх дүн төлбөрийн алхамд харагдана»). «Онцлох эмчилгээ»
  // жагсаалт, Messenger бот үнээ харуулсаар. true болговол API-ийн нийтийн үнэ маягтад буцаж гарна.
  const PRICE_BEFORE_PAYMENT = false;
  const hasPrice = (s) => PRICE_BEFORE_PAYMENT && Boolean(s) && Number.isFinite(s.price);
  const priceText = (s) => (!hasPrice(s) ? ''
    : s.price_max && s.price_max > s.price ? `${money(s.price)} – ${money(s.price_max)}` : money(s.price));
  const durText = (m) => { const h = Math.floor(m / 60), r = m % 60; return h && r ? `${h}ц ${r}м` : h ? `${h} цаг` : `${r} мин`; };
  const normPhone = (v) => { let d = String(v || '').replace(/\D/g, ''); if (d.length > 8 && d.startsWith('976')) d = d.slice(3); return d; };
  const newKey = () => (crypto.randomUUID ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));

  /* ---------- API ---------- */
  class ApiError extends Error {
    // detail = серверийн error объект (DUPLICATE_BOOKING-д message + duplicate) — зөвхөн тэр кодод ашиглана
    constructor(code, status, field, retryAfter, detail) { super(code); this.code = code; this.status = status; this.field = field; this.retryAfter = retryAfter; this.detail = detail || null; }
  }
  // Захиалах боломжгүй (нөөц маягт руу шилжинэ): сүлжээ/CORS, серверийн алдаа, суваг зогссон, түлхүүр хүчингүй
  const UNAVAILABLE = new Set(['NETWORK', 'INTERNAL', 'MIGRATION_PENDING', 'CHANNEL_PAUSED', 'CLINIC_UNAVAILABLE', 'INVALID_KEY', 'ORIGIN_NOT_ALLOWED', 'PAYMENT_UNAVAILABLE']);
  // Түр зуурын: захиалга бүртгэгдсэн эсэх тодорхойгүй → ИЖИЛ Idempotency-Key-ээр дахин оролдоно
  const TRANSIENT = new Set(['NETWORK', 'INTERNAL', 'MIGRATION_PENDING']);

  async function api(path, opts = {}) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl && setTimeout(() => ctrl.abort(), opts.timeout || 15000);
    const headers = { 'X-Api-Key': apiKey };
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (opts.idem) headers['Idempotency-Key'] = opts.idem;
    let res;
    try {
      res = await fetch(apiBase + path, {
        method: opts.method || 'GET', headers, credentials: 'omit', cache: 'no-store',
        body: opts.body ? JSON.stringify(opts.body) : undefined, signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (_) {
      throw new ApiError('NETWORK', 0);   // offline, timeout, эсвэл CORS (домэйн бүртгэлгүй)
    } finally {
      if (timer) clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* JSON биш хариу */ }
    if (res.ok && data && typeof data === 'object') return data;
    const err = data && data.error;
    const code = err && typeof err.code === 'string' ? err.code : (res.status >= 500 || res.ok ? 'INTERNAL' : 'UNKNOWN');
    const ra = parseInt(res.headers.get('Retry-After') || '', 10);
    throw new ApiError(code, res.status, err && typeof err.field === 'string' ? err.field : '', Number.isFinite(ra) ? ra : 0, err && typeof err === 'object' ? err : null);
  }

  /* ---------- Элементүүд, төлөв ---------- */
  const el = {
    service: $('ub-service'), info: $('ub-service-info'),
    docGroup: $('ub-doctor-group'), docs: $('ub-doctors'),
    dayGroup: $('ub-day-group'), range: $('ub-range'), days: $('ub-days'),
    prev: form.querySelector('[data-ub-week="-1"]'), next: form.querySelector('[data-ub-week="1"]'),
    slotGroup: $('ub-slot-group'), slots: $('ub-slots'),
    lastName: $('ub-last-name'), name: $('ub-name'), phone: $('ub-phone'), note: $('ub-note'), hp: $('ub-website'),
    summary: $('ub-summary'), alert: $('ub-alert'), status: $('ub-status'), done: $('ub-done'),
    submit: form.querySelector('button[type="submit"]'), intro: form.querySelector('[data-ub-intro]'),
  };
  const legend = el.docGroup.querySelector('legend');
  const S = {
    channel: {}, services: [], doctorRequired: false,
    all: [],                           // шүүлтгүй /doctors — «тохируулаагүй үйлчилгээ» илрүүлэх суурь, нэр/үүрэг хайх
    doctors: [],                       // ОДООГИЙН үйлчилгээг хийдэг мэргэжилтэн (booking-staff.js providersFor)
    staffFor: '',                      // S.doctors аль үйлчилгээнийх вэ ('' = ачаалж байна / хараахан үгүй)
    staffCache: new Map(),             // serviceId → мэргэжилтэн (нэг зочлолтод дахин татахгүй; rate limit 60/мин)
    staffRetry: '',                    // DOCTOR_UNAVAILABLE-ийн дараа жагсаалтыг шинэчилсэн үйлчилгээ (давталтгүй)
    allStale: false,                   // S.all хуучирсан байж болно (DOCTOR_UNAVAILABLE / refresh) → /doctors-ийг дахин татна
    auto: true,                        // сүүлийн loadWeek хоосон бол дараагийн 2 долоо хоног руу шилжих байсан эсэх
    serviceId: '', doctor: null,       // doctor: id | 'any' (аль нь ч болно) | null (ажилтангүй эмнэлэг)
    picked: false,                     // S.doctor-ийг үйлчлүүлэгч өөрөө сонгосон (ганц хүнтэй үйлчилгээний автомат сонголт биш)
    week: '', avail: null, date: '', slot: null,   // avail: Map<date, slot[]>; slot: { start, end, label, docs[] }
    seq: 0, pending: null, busy: false, ready: false,
    pay: null,                         // { id, until, poll, check, name, phone, booking } — төлбөр хүлээж буй захиалга
    dupOk: '',                         // давхар захиалгын анхааруулгад «Тийм, дахин захиалах» дарсан `${serviceId}|${phone}`
  };
  const prepayMode = () => S.channel.new_booking_status === 'pending_payment';
  const bookingMode = () => prepayMode() ? 'pending_payment' :
    S.channel.new_booking_status === 'pending_confirmation' ? 'pending_confirmation' : 'confirmed';
  const submitLabel = () => form.querySelector(`[data-ub-submit="${bookingMode()}"]`)?.textContent.trim() ||
    (prepayMode() ? 'Төлбөр төлж захиалах' : bookingMode() === 'pending_confirmation' ? 'Хүсэлт илгээх' : 'Захиалах');
  const refreshBookingCopy = () => {
    const intro = form.querySelector(`[data-ub-copy="${bookingMode()}"]`);
    if (intro?.textContent.trim() && el.intro) el.intro.textContent = intro.textContent.trim();
    if (S.ready && !S.busy) el.submit.textContent = submitLabel();
  };
  document.addEventListener('skinaid:content-applied', refreshBookingCopy);
  const prepayText = (s) => {
    // Нуусан үнэ (эсвэл PRICE_BEFORE_PAYMENT = false): тогтмол урьдчилгаа ч үнээр хязгаарлагддаг тул урьдчилан
    // тооцохгүй (үнийг задруулна)
    if (s && !hasPrice(s)) return 'Төлөх дүн төлбөрийн алхамд харагдана';
    const p = S.channel.prepay || {};
    const amount = p.amount == null ? (s ? s.price : 0) : Math.min(p.amount, s ? s.price : p.amount);
    return `QPay-ээр төлөх дүн: ${money(amount)}`;
  };
  const horizon = () => { const h = Number(S.channel.horizon_days); return Number.isFinite(h) && h >= 1 ? Math.min(h, 90) : 30; };
  const lastDay = () => addDays(ubToday(), horizon());
  const svc = () => S.services.find((s) => s.id === S.serviceId) || null;
  const sameId = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
  const staffById = (id) => (id && (S.doctors.find((d) => sameId(d.id, id)) || S.all.find((d) => sameId(d.id, id)))) || null;
  const docName = (id) => { const d = staffById(id); return d && typeof d.name === 'string' ? d.name.trim() : ''; };
  // Мэргэжилтний жагсаалт энэ үйлчилгээнийх бэлэн эсэх (ажилтангүй эмнэлэгт хэрэггүй)
  const staffReady = () => !S.doctorRequired || (S.staffFor !== '' && S.staffFor === S.serviceId);
  const announce = (t) => { el.status.textContent = t; };

  const contactsHtml = () => `<div class="form__channels">
      <a class="btn btn--outline btn--sm" href="${TEL}">${PHONE_TXT} залгах</a>
      <a class="btn btn--outline btn--sm" href="${MESSENGER}" target="_blank" rel="noopener">Messenger-ээр бичих</a>
    </div>`;
  const showAlert = (html) => { el.alert.innerHTML = html; el.alert.hidden = false; };
  const clearAlert = () => { el.alert.hidden = true; el.alert.innerHTML = ''; };

  /* ---------- Нөөц: Firestore хүсэлтийн маягт (main.js) ---------- */
  const NOTICE = {
    down: 'Онлайн цагийн систем түр холбогдсонгүй. Доорх хүсэлтийг илгээвэл зөвлөх тантай холбогдож цагийг тохирно.',
    paused: 'Онлайн цаг захиалга түр хаалттай байна. Доорх хүсэлтийг илгээвэл зөвлөх тантай холбогдож цагийг тохирно.',
    failed: 'Онлайн захиалга амжилтгүй боллоо. Доорх хүсэлтийг илгээвэл зөвлөх тантай холбогдож цагийг тохирно.',
  };
  function fallback(reason) {
    const bf = $('bookForm');
    if (!bf) {
      // Firestore маягтгүй хувилбар: зөвхөн утас, Messenger
      form.hidden = false;
      showAlert(`${esc(NOTICE[reason] ? 'Онлайн цаг захиалга одоогоор ажиллахгүй байна.' : '')} Утсаар эсвэл Messenger-ээр цагаа захиална уу.${contactsHtml()}`);
      return;
    }
    prefill(bf);
    form.hidden = true;
    bf.hidden = false;
    let note = bf.querySelector('.form__alert');
    if (NOTICE[reason]) {
      if (!note) {
        note = document.createElement('div');
        note.className = 'form__alert';
        note.setAttribute('role', 'status');
        bf.querySelector('h3').insertAdjacentElement('afterend', note);
      }
      note.innerHTML = `${esc(NOTICE[reason])} <button type="button" class="form__retry" data-ub-retry>Онлайн захиалгыг дахин ачаалах</button>`;
      note.querySelector('[data-ub-retry]').addEventListener('click', () => {
        bf.hidden = true; note.remove(); form.hidden = false; clearAlert();
        if (S.ready) { el.service.focus(); if (S.serviceId) onService({ refresh: true, auto: true }); return; }
        booted = false; boot();
      });
    } else if (note) {
      note.remove();
    }
  }
  // Онлайн маягтад бичсэнийг хүсэлтийн маягт руу шилжүүлнэ (хоосон талбарт л)
  function prefill(bf) {
    const put = (sel, v) => { const f = bf.querySelector(sel); if (f && v && !f.value) f.value = v; };
    put('#f-last-name', el.lastName.value.trim());
    put('#f-name', el.name.value.trim());
    put('#f-phone', el.phone.value.trim());
    const s = svc();
    const sel = bf.querySelector('#f-service');
    // main.js-ийн ?svc урьдчилсан сонголтоос үйлчлүүлэгчийн онлайн маягтад сонгосон үйлчилгээ давуу
    if (s && sel && (!sel.value || sel.dataset.preselected)) {
      delete sel.dataset.preselected;
      const name = s.name.slice(0, 120);
      let opt = Array.from(sel.options).find((o) => o.value === name);
      if (!opt) { opt = new Option(name, name); sel.add(opt, 1); }
      sel.value = name;
    }
    put('#f-date', S.date);
    const who = S.slot && S.slot.docs[0] ? staffById(S.slot.docs[0]) : null;
    const whoTxt = who && docName(who.id) ? `, ${personWords(who).lower} ${docName(who.id)}` : '';
    const want = S.slot ? `Хүссэн цаг: ${dateLong(S.date)} ${S.slot.label}${whoTxt}` : '';
    put('#f-msg', [want, el.note.value.trim()].filter(Boolean).join('\n'));
  }

  /* ---------- Эхлүүлэх: үйлчилгээ, ажилтан, сувгийн тохиргоо ---------- */
  let booted = false;
  async function boot() {
    if (booted) return;
    booted = true;
    if (!apiKey) { fallback('nokey'); return; }
    announce('Онлайн захиалгыг ачаалж байна…');
    let c, sv, dc;
    try {
      [c, sv, dc] = await Promise.all([api('/clinic'), api('/services'), api('/doctors')]);
    } catch (e) {
      fallback(e.code === 'CHANNEL_PAUSED' || e.code === 'CLINIC_UNAVAILABLE' ? 'paused' : 'down');
      return;
    }
    S.channel = (c && c.channel) || {};
    S.services = (Array.isArray(sv && sv.services) ? sv.services : []).filter((s) =>
      s && typeof s.id === 'string' && typeof s.name === 'string' && (Number.isFinite(s.price) || s.price === null)
        && Number.isFinite(s.duration_min));
    // Захиалга авдаг бүх ажилтан (шүүлтгүй). Үйлчилгээ бүрийн мэргэжилтнийг onService → /doctors?service_id= өгнө;
    // энэ жагсаалт = тохируулаагүй үйлчилгээг таних суурь (booking-staff.js providersFor), нэр/үүргийг id-аар хайх
    S.all = cleanStaff(dc && dc.doctors);
    S.doctorRequired = Boolean(dc && dc.doctor_required) || S.all.length > 0;
    if (!S.services.length) { fallback('paused'); return; }

    if (prepayMode() && S.channel.prepay && S.channel.prepay.ready === false) { fallback('paused'); return; }
    refreshBookingCopy();
    renderServices();
    renderDoctors();
    S.week = monday(ubToday());
    renderCalendar();
    el.submit.disabled = false;
    el.submit.textContent = submitLabel();
    S.ready = true;
    announce('');
    if (prepayMode() && (await resumePayment())) return;
    // Эмчилгээний хуудасны «Цаг захиалах» (/?svc=<slug>) → тэр хуудасны үйлчилгээ (build: SKINAID_PAGES.ub, main.js: data-svc)
    const pre = ((window.SKINAID_PAGES || {}).ub || {})[form.dataset.svc || ''];
    if (S.services.length === 1) { el.service.value = S.services[0].id; onService(); }
    else if (pre && S.services.some((s) => s.id === pre)) { el.service.value = pre; onService(); }
  }

  function renderServices() {
    const opt = (s) => `<option value="${esc(s.id)}">${[s.name, priceText(s), durText(s.duration_min)].filter(Boolean).map(esc).join(' · ')}</option>`;
    const groups = new Map();
    S.services.forEach((s) => {
      const c = (typeof s.category === 'string' && s.category.replace(/^\s*\d+[.)]\s*/, '').trim()) || 'Бусад';   // «01. Ангилал» → «Ангилал»
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(s);
    });
    let html = '<option value="">Үйлчилгээ сонгох…</option>';
    if (groups.size > 1) groups.forEach((list, c) => { html += `<optgroup label="${esc(c)}">${list.map(opt).join('')}</optgroup>`; });
    else html += S.services.map(opt).join('');
    el.service.innerHTML = html;
    el.service.disabled = false;
  }

  // Мэргэжилтний хэсэг = ЗӨВХӨН сонгосон үйлчилгээг хийдэг хүмүүс (S.doctors). Шошго үүргээс: «Эмч» / «Гоо засалч» /
  // холимог бол «Мэргэжилтэн». Ганц хүн → автоматаар, «Энэ үйлчилгээг … хийнэ»; олон → «Сул цагтай …» + нэрс.
  // notice = HTML (escape хийсэн) — жагсаалт өөрчлөгдсөн тухай мэдэгдлийг хүмүүсийн дээр (үйлчлүүлэгчийн харж буй газарт)
  function renderDoctors(loading, notice) {
    el.docGroup.setAttribute('aria-busy', String(Boolean(loading)));
    if (!S.serviceId || !S.doctorRequired) { el.docGroup.hidden = true; el.docs.innerHTML = ''; el.docs.style.minHeight = ''; return; }   // ажилтангүй эмнэлэг: doctor_id илгээхгүй
    if (loading) {
      // Өмнөх үйлчилгээний хүмүүсийг сонгуулахгүй; хэсэг харагдаж байсан бол өндөр, шошгыг хадгална (layout үсрэхгүй)
      if (el.docGroup.hidden) legend.textContent = 'Мэргэжилтэн';
      else el.docs.style.minHeight = `${el.docs.offsetHeight}px`;
      el.docs.innerHTML = '<p class="ub__hint ub__loading">Энэ үйлчилгээг хийдэг мэргэжилтний жагсаалтыг ачаалж байна…</p>';
      el.docGroup.hidden = false;
      return;
    }
    el.docs.style.minHeight = '';
    const list = S.doctors;
    const w = roleWords(list);
    legend.textContent = w.noun;
    const named = list.filter((d) => typeof d.name === 'string' && d.name.trim());
    // Хэн ч үгүй (noProvider мессеж сул цагийн хэсэгт) эсвэл нэр нуусан суваг (автоматаар оноогдоно) — хэсэггүй
    if (!list.length || named.length < list.length) {
      el.docGroup.hidden = true; el.docs.innerHTML = '';
      if (notice) showAlert(notice);
      return;
    }
    const note = notice ? `<p class="ub__alert" role="alert">${notice}</p>` : '';
    if (list.length === 1) {
      el.docs.innerHTML = `${note}<p class="ub__solo">Энэ үйлчилгээг <strong>${esc(list[0].name.trim())}</strong> хийнэ.</p>`;
      el.docGroup.hidden = false;
      return;
    }
    // Албан тушаал шошготой ижил бол («Гоо засалч» доор «Гоо засалч») давтахгүй
    const sub = (d) => { const t = typeof d.title === 'string' ? d.title.trim() : ''; return t.toLowerCase() === w.lower ? '' : t; };
    const chip = (value, title, small) => `<label class="ub__chip${value === 'any' ? ' ub__chip--auto' : ''}"><input type="radio" name="ub-doctor" value="${esc(value)}"${sameId(value, S.doctor) ? ' checked' : ''}><span>${esc(title)}${small ? `<small>${esc(small)}</small>` : ''}</span></label>`;
    el.docs.innerHTML = note + chip('any', `Сул цагтай ${w.lower}`, `Бүх ${w.gen} сул цагийг нэг дор харна`)
      + `<div class="ub__providers">${list.map((d) => chip(d.id, d.name.trim(), sub(d))).join('')}</div>`;
    el.docGroup.hidden = false;
  }

  // Үйлчилгээг хийдэг мэргэжилтэн (кэштэй). Алдааг дуудсан газар шийднэ (availError).
  // S.allStale: хэн нэг нь захиалга авахаа больсон байж болно — «тохируулаагүй» танихын суурь S.all-ийг хамт шинэчилж,
  // хуучин суурьтай ангилсан бүх кэшийг хаяна (эс бөгөөс тохируулаагүй үйлчилгээ «тохируулсан» мэт ресепшн харагдана).
  async function loadStaff(id) {
    if (!S.allStale && S.staffCache.has(id)) return S.staffCache.get(id);
    const [data, base] = await Promise.all([
      api(`/doctors?service_id=${encodeURIComponent(id)}`),
      S.allStale ? api('/doctors') : null,
    ]);
    if (base) { S.all = cleanStaff(base.doctors); S.staffCache.clear(); S.allStale = false; }
    const { staff } = providersFor(cleanStaff(data.doctors), S.all);
    S.staffCache.set(id, staff);
    return staff;
  }

  // Тохируулсан ч одоо хэн ч захиалга авдаггүй (API ихэвчлэн ийм үйлчилгээг /services-ээс хасдаг — зочлолтын явцад өөрчлөгдсөн)
  function noProvider() {
    S.avail = new Map();
    renderCalendar();
    el.slotGroup.disabled = false;
    const msg = 'Энэ үйлчилгээг одоогоор онлайнаар захиалах боломжгүй байна. Утсаар эсвэл Messenger-ээр цагаа захиална уу.';
    el.slots.innerHTML = `<p class="ub__hint">${esc(msg)}</p>${contactsHtml()}`;
    announce(msg);
  }

  /* ---------- Сул цаг ---------- */
  async function fetchAvailability(from, to) {
    const sid = S.serviceId;
    // «Аль нь ч болно» = ЗӨВХӨН энэ үйлчилгээг хийдэг хүмүүс (S.doctors); ажилтангүй эмнэлэг = doctor_id-гүй нэг хүсэлт
    const ids = S.doctor === 'any' ? S.doctors.map((d) => d.id) : [S.doctor];
    const q = (id) => `/availability?service_id=${encodeURIComponent(sid)}&from=${from}&to=${to}${id ? '&doctor_id=' + encodeURIComponent(id) : ''}`;
    const results = await Promise.allSettled(ids.map((id) => api(q(id))));
    const okCount = results.filter((r) => r.status === 'fulfilled').length;
    // DOCTOR_UNAVAILABLE = OS-ийн тохиргоо эсвэл ажилтны төлөв зочлолтын явцад өөрчлөгдсөн (loadWeek → S.allStale)
    const stale = results.find((r) => r.status === 'rejected' && r.reason && r.reason.code === 'DOCTOR_UNAVAILABLE');
    if (!okCount) throw (stale || results[0]).reason;
    // «Аль нь ч болно»: ажилтан бүрийн сул цагийг нэгтгэнэ — нэг цагт хэд хэдэн хүн сул бол S.doctors-ийн дарааллаар эхнийх нь авна
    const byDate = new Map();
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled' || !Array.isArray(r.value.days)) return;
      r.value.days.forEach((day) => {
        if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Array.isArray(day.slots)) return;
        if (!byDate.has(day.date)) byDate.set(day.date, new Map());
        const m = byDate.get(day.date);
        day.slots.forEach((s) => {
          if (!s || typeof s.start !== 'string' || typeof s.label !== 'string') return;
          if (!m.has(s.start)) m.set(s.start, { start: s.start, end: s.end, label: s.label, docs: [] });
          if (ids[i]) m.get(s.start).docs.push(ids[i]);
        });
      });
    });
    const out = new Map();
    byDate.forEach((m, d) => out.set(d, Array.from(m.values()).sort((a, b) => (a.start < b.start ? -1 : 1))));
    return { avail: out, stale: Boolean(stale) };
  }

  // Сонгосон 2 долоо хоногийн сул цагийг татна. auto = хоосон бол дараагийн 2 долоо хоног руу автоматаар шилжинэ.
  async function loadWeek(auto, keepDate) {
    if (!S.serviceId) return;
    if (!staffReady()) { renderCalendar(); return; }   // мэргэжилтний жагсаалт ачаалж байна — onService дуусмагц дуудна
    if (S.doctorRequired && !S.doctors.length) { noProvider(); return; }   // doctor_id-гүй хүсэлт = DOCTOR_REQUIRED
    S.auto = Boolean(auto);
    const seq = ++S.seq;
    const today = ubToday();
    const last = lastDay();
    const from = S.week > today ? S.week : today;
    const end = addDays(S.week, RANGE_DAYS - 1);
    const to = end < last ? end : last;
    S.avail = null; S.slot = null;
    if (!keepDate) S.date = '';
    renderCalendar(); renderSlots(); renderSummary();
    announce('Сул цаг ачаалж байна…');
    let avail = new Map();
    let stale = false;
    if (from <= to) {
      try {
        ({ avail, stale } = await fetchAvailability(from, to));
      } catch (e) {
        if (seq !== S.seq) return;
        availError(e);
        return;
      }
    }
    if (seq !== S.seq) return;   // хэрэглэгч энэ хооронд өөр үйлчилгээ/эмч/долоо хоног сонгосон
    S.staffRetry = '';
    if (stale) S.allStale = true;   // «Аль нь ч болно»-гийн зарим нь татгалзсан — дараагийн жагсаалтыг шинээр
    const firstDay = Array.from(avail.keys()).sort().find((d) => avail.get(d).length);
    if (!firstDay && auto && addDays(S.week, RANGE_DAYS) <= last) {
      S.week = addDays(S.week, RANGE_DAYS);
      loadWeek(true);
      return;
    }
    if (!firstDay && auto) S.week = monday(today);   // хязгаар дотор огт сул цаггүй — эхний долоо хоногийг харуулна
    S.avail = !firstDay && auto ? new Map() : avail;
    if (!(S.date && (S.avail.get(S.date) || []).length)) S.date = firstDay || '';
    renderCalendar(); renderSlots();
    const n = S.date ? S.avail.get(S.date).length : 0;
    // Ганц хүнтэй үйлчилгээ: сонгох товчгүй тул дэлгэц уншигчид хэн хийхийг хэлнэ (үйлчилгээ сонгоход л)
    const solo = auto && S.doctorRequired && S.doctors.length === 1 && docName(S.doctors[0].id) ? `Энэ үйлчилгээг ${docName(S.doctors[0].id)} хийнэ. ` : '';
    announce(solo + (S.date ? `${dateLong(S.date)}: ${n} сул цаг` : 'Энэ хугацаанд сул цаг алга'));
  }

  // Мэргэжилтэн (/doctors?service_id=) эсвэл сул цаг (/availability) ачаалахад гарсан алдаа
  function availError(e) {
    // Сонгосон хүн энэ үйлчилгээг хийхээ больсон (OS-д зочлолтын явцад өөрчилсөн) → жагсаалтыг НЭГ удаа шинэчилнэ
    if (e.code === 'DOCTOR_UNAVAILABLE' && S.doctorRequired && S.staffRetry !== S.serviceId) {
      S.staffRetry = S.serviceId;
      onService({ refresh: true, auto: S.auto });
      return;
    }
    S.avail = new Map();
    renderCalendar();
    el.slotGroup.disabled = false;
    if (!staffReady()) { el.docGroup.hidden = true; el.docs.innerHTML = ''; el.docGroup.setAttribute('aria-busy', 'false'); }   // «ачаалж байна» үлдээхгүй
    if (UNAVAILABLE.has(e.code) && !TRANSIENT.has(e.code)) { fallback('paused'); return; }
    const ready = staffReady();
    const w = roleWords(ready ? S.doctors : []);
    // Тодорхой нэгнийг сонгосон, үйлчилгээг хийдэг өөр хүн байгаа үед л «өөр … сонгох» санал болгоно
    const picked = ready && S.doctors.length > 1 && S.doctor && S.doctor !== 'any';
    if (e.code === 'DOCTOR_UNAVAILABLE' && !picked) { noProvider(); return; }
    const msg = e.code === 'RATE_LIMITED'
      ? 'Хэт олон хүсэлт ирлээ. Хэдэн секунд хүлээгээд дахин ачаална уу.'
      : e.code === 'SERVICE_UNAVAILABLE'
        ? 'Энэ үйлчилгээ одоогоор онлайнаар захиалагдахгүй байна. Өөр үйлчилгээ сонгох эсвэл утсаар холбогдоно уу.'
        : e.code === 'DOCTOR_UNAVAILABLE'
          ? `${docName(S.doctor) || `Сонгосон ${w.lower}`} энэ үйлчилгээнд одоогоор онлайн цаг авахгүй байна. Өөр ${w.lower} сонгох эсвэл утсаар холбогдоно уу.`
          : !ready
            ? 'Мэргэжилтний жагсаалтыг ачаалж чадсангүй. Интернэт холболтоо шалгаад дахин оролдоно уу.'
            : 'Сул цагийг ачаалж чадсангүй. Интернэт холболтоо шалгаад дахин оролдоно уу.';
    el.slots.innerHTML = `<p class="ub__hint">${esc(msg)}</p>
      <div class="form__channels"><button type="button" class="btn btn--primary btn--sm" data-ub-reload>Дахин ачаалах</button>
      <a class="btn btn--outline btn--sm" href="${TEL}">${PHONE_TXT} залгах</a></div>`;
    announce(msg);
  }

  /* ---------- Зурах ---------- */
  function renderCalendar() {
    const today = ubToday();
    const last = lastDay();
    const ready = Boolean(S.serviceId && S.week);
    const week = S.week || monday(today);
    const wEnd = addDays(week, RANGE_DAYS - 1);
    el.range.textContent = `${monthDay(week)} – ${week.slice(0, 7) === wEnd.slice(0, 7) ? +wEnd.slice(8, 10) : monthDay(wEnd)}`;
    let html = WD_SHORT.map((w) => `<span class="ub__wd" aria-hidden="true">${w}</span>`).join('');
    for (let i = 0; i < RANGE_DAYS; i++) {
      const d = addDays(week, i);
      const out = d < today || d > last;
      const slots = S.avail ? (S.avail.get(d) || []) : null;
      const n = slots ? slots.length : 0;
      const state = out ? 'захиалах боломжгүй' : !ready ? 'үйлчилгээгээ сонгоно уу' : !slots ? 'ачаалж байна' : n ? `${n} сул цаг` : 'сул цаг алга';
      const cls = ['ub__day', n ? 'has-slots' : '', d === today ? 'is-today' : ''].filter(Boolean).join(' ');
      html += `<label class="${cls}"><input type="radio" name="ub-day" value="${d}"${n ? '' : ' disabled'}${d === S.date ? ' checked' : ''} aria-label="${esc(`${dateLong(d)} — ${state}`)}"><span>${+d.slice(8, 10)}</span></label>`;
    }
    el.days.innerHTML = html;
    el.dayGroup.disabled = !(ready && S.avail);
    el.prev.disabled = week <= monday(today);
    el.next.disabled = addDays(week, RANGE_DAYS) > last;
    el.dayGroup.setAttribute('aria-busy', String(ready && !S.avail));
  }

  function renderSlots() {
    if (!S.serviceId) {
      el.slots.innerHTML = '<p class="ub__hint">Эхлээд үйлчилгээгээ сонгоно уу.</p>';
      el.slotGroup.disabled = true;
      return;
    }
    if (!S.avail) {
      el.slots.innerHTML = '<p class="ub__hint ub__loading">Сул цаг ачаалж байна…</p>';
      el.slotGroup.disabled = true;
      return;
    }
    el.slotGroup.disabled = false;
    if (!S.date) {
      const any = Array.from(S.avail.values()).some((l) => l.length);
      // Өөр хүн сонгох нь зөвхөн тодорхой нэгнийг сонгосон, үйлчилгээг хийдэг бусад хүн байгаа үед утгатай
      const other = S.doctors.length > 1 && S.doctor !== 'any' ? `Өөр ${roleWords(S.doctors).lower}, үйлчилгээ` : 'Өөр үйлчилгээ';
      el.slots.innerHTML = any ? '<p class="ub__hint">Өдрөө сонгоно уу.</p>'
        : `<p class="ub__hint">Ойрын ${horizon()} хоногт энэ сонголтоор онлайн сул цаг алга. ${esc(other)} сонгох эсвэл утсаар лавлана уу.</p>${contactsHtml()}`;
      return;
    }
    const list = S.avail.get(S.date) || [];
    const radio = (s) => `<label class="ub__slot"><input type="radio" name="ub-slot" value="${esc(s.start)}"${S.slot && S.slot.start === s.start ? ' checked' : ''}><span>${esc(s.label)}</span></label>`;
    const am = list.filter((s) => s.label < '12:00');
    const pm = list.filter((s) => s.label >= '12:00');
    const part = (title, arr) => (arr.length ? `<div><span class="ub__part">${title}</span><div class="ub__slot-grid">${arr.map(radio).join('')}</div></div>` : '');
    el.slots.innerHTML = `<p class="ub__day-title">${esc(dateLong(S.date))}</p>${part('Үдээс өмнө', am)}${part('Үдээс хойш', pm)}`;
  }

  function renderSummary() {
    const s = svc();
    if (!S.slot || !s) { el.summary.hidden = true; return; }
    const doc = S.slot.docs[0] ? docName(S.slot.docs[0]) : '';
    el.summary.textContent = `Сонгосон: ${dateLong(S.date)} ${S.slot.label} · ${s.name}${doc ? ' · ' + doc : ''}`;
    el.summary.hidden = false;
  }

  /* ---------- Үйлдлүүд ---------- */
  // Үйлчилгээ сонгох → тэр үйлчилгээг хийдэг мэргэжилтэн → сул цаг.
  // refresh: ИЖИЛ үйлчилгээний жагсаалтыг кэшгүй дахин татна (DOCTOR_UNAVAILABLE, «Дахин ачаалах»), долоо хоног/өдрийг хадгална.
  // quiet: сонгосон хүн хасагдсаныг дуудагч өөрөө мэдэгдсэн (submitError).
  async function onService(opts = {}) {
    const refresh = opts.refresh === true;
    const hadFocus = el.docs.contains(document.activeElement);   // хүмүүсийн жагсаалт дахин зурагдахад фокусыг сэргээнэ
    if (!refresh) {
      S.serviceId = el.service.value;
      clearAlert();
      S.week = monday(ubToday());
      S.date = '';
    }
    const s = svc();
    el.info.textContent = s && prepayMode() ? prepayText(s) : '';
    const listed = S.staffFor;   // өмнөх жагсаалт аль үйлчилгээнийх байсан (refresh-ийн мэдэгдэлд)
    S.avail = null; S.slot = null; S.staffFor = '';
    const seq = ++S.seq;   // хурдан өөр үйлчилгээ сонговол хуучин хариу дарахгүй (loadWeek-тэй нэг тоолуур)
    if (!s) { S.doctors = []; renderDoctors(); renderCalendar(); renderSlots(); renderSummary(); announce(''); return; }
    if (S.doctorRequired) {
      // Үйлчлүүлэгчийн ӨӨРӨӨ сонгосон хүнийг л дараагийн үйлчилгээнд авч явна (автомат сонголтыг биш)
      const prev = S.doctor;
      const chosen = S.picked ? prev : null;
      const prevName = docName(prev);   // шинэчилсэн жагсаалт/S.all-д байхгүй болж магадгүй тул өмнө нь авна
      const sid = S.serviceId;
      if (refresh) S.allStale = true;
      let staff = S.allStale ? null : S.staffCache.get(sid);
      if (!staff) {
        renderDoctors(true); renderCalendar(); renderSlots(); renderSummary();
        try {
          staff = await loadStaff(sid);
        } catch (e) {
          if (seq !== S.seq) return;
          availError(e);
          return;
        }
        if (seq !== S.seq) return;
      }
      S.doctors = staff;
      S.doctor = keepChoice(chosen, staff);   // шинэ үйлчилгээг бас хийдэг бол сонголт хэвээр, эс бөгөөс «Аль нь ч болно»
      S.picked = Boolean(chosen) && sameId(chosen, S.doctor);
      S.staffFor = sid;
      const removed = refresh && !opts.quiet && listed === sid && prev && prev !== 'any' && !sameId(prev, S.doctor) && prevName;
      renderDoctors(false, removed ? `<strong>${esc(prevName)}</strong> энэ үйлчилгээг одоогоор хийхгүй байна. Жагсаалтыг шинэчиллээ — цагаа дахин сонгоно уу.` : '');
      if (hadFocus) {
        const f = el.docs.querySelector('input:checked') || el.docs.querySelector('input');
        (f || el.service).focus({ preventScroll: true });
      }
      if (!staff.length) { renderSummary(); noProvider(); return; }
    }
    renderSummary();
    // refresh: долоо хоног/өдрийг хадгална; анх сонгосон шиг хоосон бол дараагийн 2 долоо хоног руу шилжих эсэх = opts.auto
    if (refresh) loadWeek(opts.auto === true, true); else loadWeek(true);
  }

  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t === el.service) { onService(); return; }
    if (t.name === 'ub-doctor') { S.doctor = t.value; S.picked = t.value !== 'any'; clearAlert(); S.week = monday(ubToday()); loadWeek(true); return; }
    if (t.name === 'ub-day') {
      S.date = t.value; S.slot = null;
      renderSlots(); renderSummary();
      announce(`${dateLong(S.date)}: ${(S.avail.get(S.date) || []).length} сул цаг`);
      return;
    }
    if (t.name === 'ub-slot') {
      S.slot = (S.avail.get(S.date) || []).find((s) => s.start === t.value) || null;
      clearAlert(); renderSummary();
    }
  });
  form.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-ub-week]');
    if (nav && !nav.disabled) { S.week = addDays(S.week, RANGE_DAYS * Number(nav.dataset.ubWeek)); loadWeek(false); return; }
    if (e.target.closest('[data-ub-reload]')) { if (staffReady()) loadWeek(S.auto, true); else onService({ refresh: true, auto: true }); return; }
    if (e.target.closest('[data-ub-retry-submit]')) { el.submit.click(); return; }
    const dupGo = e.target.closest('[data-ub-dup-go]');
    if (dupGo) { S.dupOk = dupGo.dataset.ubDupGo || ''; el.submit.click(); return; }
    if (e.target.closest('[data-ub-dup-keep]')) {
      S.dupOk = '';
      showAlert('Өмнөх цаг тань хэвээр байна. Цагаа өөрчлөх бол утсаар эсвэл Messenger-ээр холбогдоно уу.' + contactsHtml());
      return;
    }
    if (e.target.closest('[data-ub-request]')) { fallback('failed'); return; }
    if (e.target.closest('[data-ub-check]')) { checkPayment(true); return; }
    if (e.target.closest('[data-ub-new]')) { startOver(); }
  });
  [el.name, el.phone, el.note].forEach((f) => f.addEventListener('input', () => f.setCustomValidity('')));
  el.lastName.addEventListener('input', () => el.name.setCustomValidity(''));

  /* ---------- Захиалга илгээх ---------- */
  function setBusy(on) {
    S.busy = on;
    el.submit.disabled = on;
    el.submit.setAttribute('aria-busy', String(on));
    el.submit.textContent = on ? 'Илгээж байна…' : submitLabel();
    announce(on ? 'Захиалга илгээж байна…' : '');
  }

  async function postBooking(payload, idem) {
    try {
      return await api('/bookings', { method: 'POST', body: payload, idem, timeout: 20000 });
    } catch (e) {
      if (!TRANSIENT.has(e.code)) throw e;
      await sleep(1500);   // сүлжээ тасарсан/серверийн алдаа: ИЖИЛ түлхүүрээр нэг удаа автоматаар
      return api('/bookings', { method: 'POST', body: payload, idem, timeout: 20000 });
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (S.busy || !S.ready) return;
    clearAlert();
    if (!S.serviceId) { showAlert('Үйлчилгээгээ сонгоно уу.'); el.service.focus(); return; }
    if (!S.slot) {
      showAlert('Захиалах цагаа сонгоно уу.');
      const first = el.slotGroup.querySelector('input:not(:disabled)') || el.dayGroup.querySelector('input:not(:disabled)');
      if (first) first.focus(); else el.service.focus();
      return;
    }
    const givenName = el.name.value.replace(/\s+/g, ' ').trim();
    const lastName = el.lastName.value.replace(/\s+/g, ' ').trim();
    const name = [lastName, givenName].filter(Boolean).join(' ');
    const phone = normPhone(el.phone.value);
    const note = el.note.value.trim();
    el.name.setCustomValidity(givenName.length < 2 ? 'Нэрээ бичнэ үү' : name.length > 100 ? 'Овог, нэр нийлээд 100 тэмдэгтээс ихгүй байна' : '');
    el.phone.setCustomValidity(/^[5-9]\d{7}$/.test(phone) ? '' : 'Гар утасны дугаараа 8 оронтойгоор бичнэ үү (жишээ нь 8800-0000)');
    el.note.setCustomValidity(note.length > NOTE_MAX ? `Нэмэлт мэдээлэл ${NOTE_MAX} тэмдэгтээс ихгүй байна` : '');
    if (!form.reportValidity()) return;

    // Honeypot: далд талбарыг зөвхөн бот бөглөнө — API руу юу ч илгээхгүй
    if (el.hp.value) { showDone({ status: 'pending_confirmation', date: S.date, label: S.slot.label, service: svc() }, name, phone); return; }

    const dupKey = `${S.serviceId}|${phone}`;
    const payload = {
      service_id: S.serviceId,
      ...(S.slot.docs[0] ? { doctor_id: S.slot.docs[0] } : {}),
      start: S.slot.start,
      customer: { name, phone },
      note,
      marketing_opt_in: false,
      // Давхар захиалгын анхааруулгын дараа «Тийм, дахин захиалах» (UB Beauty API §2.3) — ижил үйлчилгээ, утсанд л
      ...(S.dupOk === dupKey ? { allow_duplicate: true } : {}),
    };
    // Агуулга өөрчлөгдөөгүй (сүлжээний алдааны дараах давталт) бол хуучин түлхүүр, эс бөгөөс шинэ
    const fp = JSON.stringify(payload);
    if (!S.pending || S.pending.fp !== fp) S.pending = { key: newKey(), fp };
    setBusy(true);
    try {
      const data = await postBooking(payload, S.pending.key);
      S.pending = null;
      S.dupOk = '';
      if (!data.booking || typeof data.booking !== 'object') throw new ApiError('INTERNAL', 200);
      if (data.booking.status === 'pending_payment' && data.booking.payment) showPayment(data.booking, name, phone);
      else showDone(data.booking, name, phone);
    } catch (err) {
      submitError(err instanceof ApiError ? err : new ApiError('INTERNAL', 0));
    } finally {
      setBusy(false);
    }
  });

  function submitError(err) {
    const code = err.code;
    if (TRANSIENT.has(code)) {
      // Захиалга бүртгэгдсэн эсэх тодорхойгүй — S.pending (ижил түлхүүр) хэвээр: давтвал давхар захиалга үүсэхгүй
      showAlert(`<strong>Холболтын алдаа гарлаа.</strong> «Дахин оролдох» дарна уу — давхар захиалга үүсэхгүй. Эсвэл утсаар захиална уу.
        <div class="form__channels">
          <button type="button" class="btn btn--primary btn--sm" data-ub-retry-submit>Дахин оролдох</button>
          <a class="btn btn--outline btn--sm" href="${TEL}">${PHONE_TXT} залгах</a>
          <a class="btn btn--outline btn--sm" href="${MESSENGER}" target="_blank" rel="noopener">Messenger</a>
          ${$('bookForm') ? '<button type="button" class="btn btn--ghost btn--sm" data-ub-request>Хүсэлт үлдээх</button>' : ''}
        </div>`);
      return;
    }
    S.pending = null;   // сервер тодорхой хариулсан — дараагийн оролдлого шинэ түлхүүртэй
    if (UNAVAILABLE.has(code)) { fallback('paused'); return; }
    if (code === 'SLOT_TAKEN' || code === 'SLOT_PAST' || code === 'OUTSIDE_HORIZON') {
      showAlert(code === 'SLOT_TAKEN'
        ? '<strong>Энэ цаг дөнгөж авагдлаа.</strong> Сул цагийг шинэчиллээ — өөр цаг сонгоно уу.'
        : 'Сонгосон цаг захиалах боломжгүй боллоо. Сул цагийг шинэчиллээ — өөр цаг сонгоно уу.');
      loadWeek(false, true).then(() => { const f = el.slotGroup.querySelector('input:not(:disabled)'); if (f) f.focus({ preventScroll: true }); });
      return;
    }
    if (code === 'VALIDATION') {
      const field = err.field === 'customer.name' ? el.name : err.field === 'customer.phone' ? el.phone : err.field === 'note' ? el.note : null;
      if (field) {
        field.setCustomValidity(field === el.phone ? 'Гар утасны дугаараа 8 оронтойгоор зөв бичнэ үү' : field === el.name ? 'Нэрээ зөв бичнэ үү' : 'Нэмэлт мэдээллээ богиносгоно уу');
        field.reportValidity();
        return;
      }
      showAlert('Мэдээллээ шалгаад дахин оролдоно уу.' + contactsHtml());
      loadWeek(false, true);
      return;
    }
    if (code === 'DUPLICATE_BOOKING') {
      // Энэ утас ижил үйлчилгээнд ирээдүйд цагтай (огноо, цаг, үйлчилгээ — серверийн текст). Хориглохгүй: сонголт өгнө
      const d = err.detail || {};
      const text = typeof d.message === 'string' && d.message
        ? d.message
        : 'Та энэ үйлчилгээнд ирээдүйд цаг авсан байна. Дахин захиалбал хоёр дахь цаг үүснэ.';
      const key = `${S.serviceId}|${normPhone(el.phone.value)}`;
      showAlert(`<strong>Танд энэ үйлчилгээний цаг аль хэдийн бий.</strong> ${esc(text)}
        <div class="form__channels">
          <button type="button" class="btn btn--outline btn--sm" data-ub-dup-keep>Өмнөх цагаа хадгалах</button>
          <button type="button" class="btn btn--primary btn--sm" data-ub-dup-go="${esc(key)}">Тийм, дахин захиалах</button>
        </div>`);
      return;
    }
    if (code === 'PHONE_LIMIT') {
      showAlert('Энэ дугаарт идэвхтэй захиалга олон байна. Нэмэлт цаг авах бол утсаар эсвэл Messenger-ээр холбогдоно уу.' + contactsHtml());
      return;
    }
    if (code === 'RATE_LIMITED') {
      showAlert('Хэт олон оролдлого хийгдлээ. Хэсэг хүлээгээд дахин оролдох эсвэл утсаар захиална уу.' + contactsHtml());
      return;
    }
    if (code === 'DOCTOR_UNAVAILABLE') {
      // Оноогдсон хүн энэ үйлчилгээг хийхээ больсон (OS «Үзүүлэх ажилтан» өөрчлөгдсөн) эсвэл захиалга авахгүй болсон
      const who = S.slot && S.slot.docs[0] ? docName(S.slot.docs[0]) : '';
      showAlert(`<strong>${who ? esc(who) : 'Сонгосон мэргэжилтэн'} энэ үйлчилгээнд одоогоор онлайн цаг авахгүй байна.</strong> Жагсаалт болон сул цагийг шинэчиллээ — цагаа дахин сонгоно уу.${contactsHtml()}`);
      onService({ refresh: true, quiet: true });
      return;
    }
    if (code === 'SERVICE_UNAVAILABLE') {
      showAlert('Энэ үйлчилгээ одоогоор онлайнаар захиалагдахгүй байна. Өөр үйлчилгээ сонгох эсвэл утсаар холбогдоно уу.' + contactsHtml());
      return;
    }
    if (code === 'DOCTOR_REQUIRED') {
      showAlert('Энэ цагийг онлайнаар захиалж чадсангүй. Сул цагийг шинэчиллээ — дахин сонгох эсвэл утсаар холбогдоно уу.' + contactsHtml());
      loadWeek(false, true);
      return;
    }
    // IDEMPOTENCY_MISMATCH болон бусад: шинэ түлхүүрээр дахин оролдож болно
    showAlert('Захиалга амжилтгүй боллоо. Дахин оролдох эсвэл утсаар захиална уу.' + contactsHtml());
  }

  /* ---------- Үр дүн ---------- */
  function receiptHtml(b, name, phone) {
    const date = typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : S.date;
    const when = `${dateLong(date)} ${esc(b.label || (S.slot && S.slot.label) || '')}`;
    const service = (b.service && b.service.name) || (svc() && svc().name) || '';
    const doctor = (b.doctor && b.doctor.name) || '';
    const role = personWords(b.doctor && staffById(b.doctor.id)).noun;   // «Эмч» / «Гоо засалч» / «Мэргэжилтэн»
    return { when, html: `<dl class="ub__receipt">
        <dt>Огноо, цаг</dt><dd>${when}</dd>
        ${service ? `<dt>Үйлчилгээ</dt><dd>${esc(service)}</dd>` : ''}
        ${doctor ? `<dt>${esc(role)}</dt><dd>${esc(doctor)}</dd>` : ''}
        ${name ? `<dt>Нэр, утас</dt><dd>${esc(name)}, ${esc(phone)}</dd>` : ''}
      </dl>` };
  }

  function showDone(b, name, phone) {
    stopPayment();
    const pending = b.status === 'pending_confirmation';
    const paid = Boolean(b.payment && b.payment.status === 'paid');
    const { when, html } = receiptHtml(b, name, phone);
    el.done.innerHTML = `<strong>${pending ? 'Хүсэлтийг хүлээн авлаа.' : paid ? `Төлбөр төлөгдөж, таны цаг ${when}-д баталгаажлаа.` : `Таны цаг ${when}-д баталгаажлаа.`}</strong>
      ${html}
      <p>${pending
        ? `Эмнэлэг цагийг баталгаажуулаад <strong>${esc(phone)}</strong> дугаарт тантай холбогдоно.`
        : 'Таныг хүлээж байна! Цагаа өөрчлөх, цуцлах бол утсаар холбогдоно уу.'}${b.sms_sent ? ' Захиалгын мэдээллийг SMS-ээр илгээлээ.' : ''}</p>
      <p class="ub__addr">Хаяг: Тэнгис кино театрын хажууд, KFC-тэй байр, Caffe Bene хаалгаар, 5 давхар.</p>
      <div class="form__channels">
        <a class="btn btn--outline btn--sm" href="${TEL}">${PHONE_TXT} залгах</a>
        <button class="btn btn--ghost btn--sm" type="button" data-ub-new>Шинэ захиалга</button>
      </div>`;
    form.classList.add('is-sent');
    el.done.tabIndex = -1;
    el.done.focus({ preventScroll: true });
    form.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  }

  /* ---------- Төлбөр (prepay): QR, банкны апп, тоолуур, төлөв шалгах ---------- */
  function stopPayment() {
    if (!S.pay) return;
    clearInterval(S.pay.poll); clearInterval(S.pay.check); clearInterval(S.pay.tick);
    S.pay = null;
    try { sessionStorage.removeItem(PAY_KEY); } catch (_) { /* хаалттай */ }
  }
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const mobile = () => window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 760;

  function showPayment(b, name, phone) {
    stopPayment();
    const pay = b.payment;
    const until = Date.parse(pay.hold_expires_at) || (Date.now() + 15 * 60000);
    S.pay = { id: b.id, until, name, phone, booking: b, poll: 0, check: 0, tick: 0, busy: false };
    try { sessionStorage.setItem(PAY_KEY, JSON.stringify({ id: b.id, until, name, phone })); } catch (_) { /* хаалттай */ }
    const { html } = receiptHtml(b, name, phone);
    const links = Array.isArray(pay.deeplinks) ? pay.deeplinks.filter((d) => d && typeof d.link === 'string' && typeof d.name === 'string') : [];
    const qr = typeof pay.qr_image === 'string' && pay.qr_image
      ? `<img class="ub__qr-img" src="data:image/png;base64,${pay.qr_image.replace(/\s/g, '')}" alt="QPay QR код" width="220" height="220">`
      : '';
    const banks = links.length ? `<div class="ub__banks" role="list">${links.map((d) => `<a role="listitem" class="ub__bank" href="${esc(d.link)}">${d.logo && /^https:\/\//.test(d.logo) ? `<img src="${esc(d.logo)}" alt="" loading="lazy">` : ''}<span>${esc(d.description || d.name)}</span></a>`).join('')}</div>` : '';
    el.done.innerHTML = `<div class="ub__pay">
      <strong>Цаг тань хадгалагдаж байна. Хугацаа дуусахаас өмнө төлнө үү.</strong>
      <p class="ub__pay-amount">Төлөх дүн: <b>${money(pay.amount)}</b> <span class="ub__countdown" data-ub-countdown>${mmss(until - Date.now())}</span></p>
      ${html}
      <div class="ub__pay-ways">
        ${qr ? `<div class="ub__qr">${qr}<span>Банкны апп эсвэл QPay-ээр QR-ийг уншуулна уу</span></div>` : ''}
        <div class="ub__pay-links">
          ${mobile() && banks ? `<p class="ub__hint">Банкны аппаа сонгож төлнө үү:</p>${banks}` : ''}
          ${pay.short_url ? `<a class="btn btn--primary btn--sm" href="${esc(pay.short_url)}" target="_blank" rel="noopener">QPay холбоосоор төлөх</a>` : ''}
          ${!mobile() && banks ? `<details class="ub__bank-details"><summary>Банкны аппын холбоосууд</summary>${banks}</details>` : ''}
        </div>
      </div>
      <p class="ub__paystatus" data-ub-paystatus role="status">Төлбөр төлөгдмөгц энд баталгаажна (автоматаар шалгаж байна).</p>
      <div class="form__channels">
        <button type="button" class="btn btn--outline btn--sm" data-ub-check>Төлбөр шалгах</button>
        <a class="btn btn--ghost btn--sm" href="${TEL}">${PHONE_TXT} залгах</a>
        <button class="btn btn--ghost btn--sm" type="button" data-ub-new>Болих</button>
      </div>
    </div>`;
    form.classList.add('is-sent');
    el.done.tabIndex = -1;
    el.done.focus({ preventScroll: true });
    form.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    const cd = el.done.querySelector('[data-ub-countdown]');
    S.pay.tick = setInterval(() => {
      if (!S.pay) return;
      const left = S.pay.until - Date.now();
      if (cd) cd.textContent = mmss(left);
      if (left <= 0) { clearInterval(S.pay.tick); pollPayment(); }
    }, 1000);
    S.pay.poll = setInterval(() => { if (document.visibilityState !== 'hidden') pollPayment(); }, PAY_POLL_MS);
    S.pay.check = setInterval(() => { if (document.visibilityState !== 'hidden') checkPayment(false); }, PAY_CHECK_MS);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.pay) pollPayment(); });

  function applyPayState(b) {
    if (!S.pay || !b || b.id !== S.pay.id) return;
    const ps = b.payment && b.payment.status;
    if (b.status === 'confirmed' || ps === 'paid') {
      const { name, phone } = S.pay;
      showDone({ ...b, payment: { ...(b.payment || {}), status: 'paid' } }, name, phone);
      return;
    }
    if (b.status === 'cancelled' || ps === 'expired' || ps === 'cancelled' || ps === 'refund_required') {
      showExpired(ps === 'refund_required');
    }
  }
  async function pollPayment() {
    if (!S.pay || S.pay.busy) return;
    S.pay.busy = true;
    try {
      const data = await api(`/bookings/${encodeURIComponent(S.pay.id)}`, { timeout: 10000 });
      applyPayState(data.booking);
    } catch (e) {
      if (e.code === 'NOT_FOUND') showExpired(false);
      // Сүлжээ/түр алдаа — дараагийн давталт
    } finally {
      if (S.pay) S.pay.busy = false;
    }
  }
  async function checkPayment(manual) {
    if (!S.pay || S.pay.busy) return;
    const btn = el.done.querySelector('[data-ub-check]');
    const st = el.done.querySelector('[data-ub-paystatus]');
    S.pay.busy = true;
    if (manual) { if (btn) { btn.disabled = true; btn.textContent = 'Шалгаж байна…'; } }
    try {
      const data = await api(`/bookings/${encodeURIComponent(S.pay.id)}/payment/check`, { method: 'POST', timeout: 20000 });
      S.pay.busy = false;
      applyPayState(data.booking);
      if (S.pay && manual && st) st.textContent = 'Төлбөр хараахан бүртгэгдээгүй байна. Төлсөн бол хэдэн секундийн дараа дахин шалгана уу.';
    } catch (e) {
      if (S.pay) S.pay.busy = false;
      if (e.code === 'NOT_FOUND') { showExpired(false); return; }
      if (manual && st) st.textContent = e.code === 'RATE_LIMITED' ? 'Хэт олон шалгалт — хэдэн секунд хүлээгээд дахин дарна уу.' : 'Шалгаж чадсангүй. Интернэт холболтоо шалгаад дахин оролдоно уу.';
    } finally {
      if (manual && btn) { btn.disabled = false; btn.textContent = 'Төлбөр шалгах'; }
    }
  }
  function showExpired(refund) {
    stopPayment();
    el.done.innerHTML = `<strong>${refund ? 'Захиалга цуцлагдсаны дараа төлбөр орсон байна.' : 'Төлбөрийн хугацаа дууслаа — цаг чөлөөлөгдлөө.'}</strong>
      <p>${refund ? `Буцаан олголтын талаар <a href="${TEL}">${PHONE_TXT}</a> утсаар холбогдоно уу.` : 'Төлбөр 15 минутын дотор бүртгэгдээгүй тул захиалга цуцлагдлаа. Дахин цаг сонгоод захиална уу.'}</p>
      <div class="form__channels">
        <button class="btn btn--primary btn--sm" type="button" data-ub-new>Дахин захиалах</button>
        <a class="btn btn--outline btn--sm" href="${TEL}">${PHONE_TXT} залгах</a>
      </div>`;
    form.classList.add('is-sent');
  }
  // Хуудас дахин ачаалагдсан (эсвэл утсан дээр банкны аппаас буцаж ирсэн) — төлбөр хүлээж буй захиалгаа үргэлжлүүлнэ
  async function resumePayment() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(PAY_KEY) || 'null'); } catch (_) { saved = null; }
    if (!saved || typeof saved.id !== 'string') return false;
    if (!(saved.until > Date.now() - 60000)) { try { sessionStorage.removeItem(PAY_KEY); } catch (_) { /* */ } return false; }
    try {
      const data = await api(`/bookings/${encodeURIComponent(saved.id)}`, { timeout: 10000 });
      const b = data.booking;
      if (!b) return false;
      if (b.status === 'pending_payment' && b.payment && b.payment.status === 'pending') { showPayment(b, saved.name || '', saved.phone || ''); return true; }
      if (b.status === 'confirmed') { showDone({ ...b, payment: { status: 'paid' } }, saved.name || '', saved.phone || ''); return true; }
    } catch (_) { /* харагдахгүй — шинэ захиалга */ }
    try { sessionStorage.removeItem(PAY_KEY); } catch (_) { /* */ }
    return false;
  }

  function startOver() {
    stopPayment();
    form.classList.remove('is-sent');
    el.done.innerHTML = '';
    el.note.value = '';
    el.hp.value = '';
    clearAlert();
    el.service.focus({ preventScroll: true });
    if (S.serviceId) loadWeek(false, true);   // сая авсан цаг сул цагаас хасагдана
  }

  /* ---------- Хэзээ ачаалах: хэсэг ойртох эсвэл «Цаг захиалах» дарах үед ---------- */
  if (!apiKey) { fallback('nokey'); return; }
  const start = () => { boot(); };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) { io.disconnect(); start(); }
    }, { rootMargin: '600px 0px' });
    io.observe(form);
  } else {
    start();
  }
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('a[href="#contact"]')) start(); });
  if (location.hash === '#contact') start();
}

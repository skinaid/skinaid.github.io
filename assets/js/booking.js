/* ==========================================================================
   SKIN AID — booking.js (ES module)
   Онлайн цаг захиалга: UB Beauty «Вэб суваг» REST API (UB Beauty репо → docs/API-WEB-CHANNEL.md).
   Урсгал: үйлчилгээ → эмч → өдөр → тэр өдрийн сул цаг → нэр, утас, тэмдэглэл → POST /bookings.

   - API-г хуудас ачаалахад БИШ, захиалгын хэсэг ойртох / «Цаг захиалах» дарах үед л дуудна.
   - Нийтийн түлхүүр (pk_…) `X-Api-Key` толгойд. Сайтын origin нь OS → Вэб суваг → «Зөвшөөрсөн домэйн»-д
     байх ёстой, эс бөгөөс хөтөч зөвхөн «network error» харна (CORS).
   - Илгээх оролдлого бүрт ШИНЭ Idempotency-Key; сүлжээ тасарч ИЖИЛ агуулгаар дахин илгээхэд ИЖИЛ түлхүүр
     (сервер давхар захиалга үүсгэхгүй, анхны захиалгаа буцаана).
   - API ашиглах боломжгүй (сүлжээ, 5xx, суваг зогссон, түлхүүр хоосон…) бол #bookForm (Firestore хүсэлт,
     main.js) нөөц болж гарна. Алдааны дотоод мэдээллийг үйлчлүүлэгчид харуулахгүй — кодоор нь өөрсдийн текст.
   Локал хөгжүүлэлт: README → «Онлайн цаг захиалга» (tools/ub-mock-server.mjs).
   ========================================================================== */
import { API_BASE, PUBLISHABLE_KEY } from './ubbeauty-config.js?v=069ef895';

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
  const priceText = (s) => (s.price_max && s.price_max > s.price ? `${money(s.price)} – ${money(s.price_max)}` : money(s.price));
  const durText = (m) => { const h = Math.floor(m / 60), r = m % 60; return h && r ? `${h}ц ${r}м` : h ? `${h} цаг` : `${r} мин`; };
  const normPhone = (v) => { let d = String(v || '').replace(/\D/g, ''); if (d.length > 8 && d.startsWith('976')) d = d.slice(3); return d; };
  const newKey = () => (crypto.randomUUID ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));

  /* ---------- API ---------- */
  class ApiError extends Error {
    constructor(code, status, field, retryAfter) { super(code); this.code = code; this.status = status; this.field = field; this.retryAfter = retryAfter; }
  }
  // Захиалах боломжгүй (нөөц маягт руу шилжинэ): сүлжээ/CORS, серверийн алдаа, суваг зогссон, түлхүүр хүчингүй
  const UNAVAILABLE = new Set(['NETWORK', 'INTERNAL', 'MIGRATION_PENDING', 'CHANNEL_PAUSED', 'CLINIC_UNAVAILABLE', 'INVALID_KEY', 'ORIGIN_NOT_ALLOWED']);
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
    throw new ApiError(code, res.status, err && typeof err.field === 'string' ? err.field : '', Number.isFinite(ra) ? ra : 0);
  }

  /* ---------- Элементүүд, төлөв ---------- */
  const el = {
    service: $('ub-service'), info: $('ub-service-info'),
    docGroup: $('ub-doctor-group'), docs: $('ub-doctors'),
    dayGroup: $('ub-day-group'), range: $('ub-range'), days: $('ub-days'),
    prev: form.querySelector('[data-ub-week="-1"]'), next: form.querySelector('[data-ub-week="1"]'),
    slotGroup: $('ub-slot-group'), slots: $('ub-slots'),
    name: $('ub-name'), phone: $('ub-phone'), note: $('ub-note'), hp: $('ub-website'),
    summary: $('ub-summary'), alert: $('ub-alert'), status: $('ub-status'), done: $('ub-done'),
    submit: form.querySelector('button[type="submit"]'), intro: form.querySelector('[data-ub-intro]'),
  };
  const S = {
    channel: {}, services: [], doctors: [], doctorRequired: false,
    serviceId: '', doctor: null,       // doctor: id | 'any' (аль ч эмч) | null (эмчгүй эмнэлэг)
    week: '', avail: null, date: '', slot: null,   // avail: Map<date, slot[]>; slot: { start, end, label, docs[] }
    seq: 0, pending: null, busy: false, ready: false,
  };
  const submitLabel = () => (S.channel.new_booking_status === 'pending_confirmation' ? 'Хүсэлт илгээх' : 'Захиалах');
  const horizon = () => { const h = Number(S.channel.horizon_days); return Number.isFinite(h) && h >= 1 ? Math.min(h, 90) : 30; };
  const lastDay = () => addDays(ubToday(), horizon());
  const svc = () => S.services.find((s) => s.id === S.serviceId) || null;
  const docName = (id) => { const d = S.doctors.find((x) => x.id === id); return d && d.name ? d.name : ''; };
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
        if (S.ready) { el.service.focus(); return; }
        booted = false; boot();
      });
    } else if (note) {
      note.remove();
    }
  }
  // Онлайн маягтад бичсэнийг хүсэлтийн маягт руу шилжүүлнэ (хоосон талбарт л)
  function prefill(bf) {
    const put = (sel, v) => { const f = bf.querySelector(sel); if (f && v && !f.value) f.value = v; };
    put('#f-name', el.name.value.trim());
    put('#f-phone', el.phone.value.trim());
    const s = svc();
    const sel = bf.querySelector('#f-service');
    if (s && sel && !sel.value) {
      const name = s.name.slice(0, 120);
      let opt = Array.from(sel.options).find((o) => o.value === name);
      if (!opt) { opt = new Option(name, name); sel.add(opt, 1); }
      sel.value = name;
    }
    put('#f-date', S.date);
    const want = S.slot ? `Хүссэн цаг: ${dateLong(S.date)} ${S.slot.label}${S.slot.docs[0] && docName(S.slot.docs[0]) ? ', эмч ' + docName(S.slot.docs[0]) : ''}` : '';
    put('#f-msg', [want, el.note.value.trim()].filter(Boolean).join('\n'));
  }

  /* ---------- Эхлүүлэх: үйлчилгээ, эмч, сувгийн тохиргоо ---------- */
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
      s && typeof s.id === 'string' && typeof s.name === 'string' && Number.isFinite(s.price) && Number.isFinite(s.duration_min));
    S.doctors = (Array.isArray(dc && dc.doctors) ? dc.doctors : []).filter((d) => d && typeof d.id === 'string');
    S.doctorRequired = Boolean(dc && dc.doctor_required) || S.doctors.length > 0;
    if (!S.services.length) { fallback('paused'); return; }

    if (S.channel.new_booking_status === 'pending_confirmation' && el.intro) {
      el.intro.textContent = 'Үйлчилгээ, эмч, сул цагаа сонгоод хүсэлт илгээнэ үү. Ресепшн цагийг баталгаажуулаад тантай холбогдоно.';
    }
    renderServices();
    renderDoctors();
    S.week = monday(ubToday());
    renderCalendar();
    el.submit.disabled = false;
    el.submit.textContent = submitLabel();
    S.ready = true;
    announce('');
    if (S.services.length === 1) { el.service.value = S.services[0].id; onService(); }
  }

  function renderServices() {
    const opt = (s) => `<option value="${esc(s.id)}">${esc(s.name)} · ${esc(priceText(s))} · ${esc(durText(s.duration_min))}</option>`;
    const groups = new Map();
    S.services.forEach((s) => {
      const c = (typeof s.category === 'string' && s.category.trim()) || 'Бусад';
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(s);
    });
    let html = '<option value="">Үйлчилгээ сонгох…</option>';
    if (groups.size > 1) groups.forEach((list, c) => { html += `<optgroup label="${esc(c)}">${list.map(opt).join('')}</optgroup>`; });
    else html += S.services.map(opt).join('');
    el.service.innerHTML = html;
    el.service.disabled = false;
  }

  function renderDoctors() {
    el.docGroup.hidden = true;
    if (!S.doctorRequired || !S.doctors.length) { S.doctor = null; return; }   // эмчгүй эмнэлэг: doctor_id илгээхгүй
    if (S.doctors.length === 1) { S.doctor = S.doctors[0].id; return; }
    S.doctor = 'any';
    const named = S.doctors.filter((d) => typeof d.name === 'string' && d.name.trim());
    if (named.length < S.doctors.length) return;   // нэр нуусан суваг: «аль ч эмч» автоматаар
    const chip = (value, title, sub, checked) => `<label class="ub__chip"><input type="radio" name="ub-doctor" value="${esc(value)}"${checked ? ' checked' : ''}><span>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></label>`;
    el.docs.innerHTML = chip('any', 'Аль ч эмч', 'Хамгийн олон сул цаг', true)
      + named.map((d) => chip(d.id, d.name.trim(), typeof d.title === 'string' ? d.title.trim() : '', false)).join('');
    el.docGroup.hidden = false;
  }

  /* ---------- Сул цаг ---------- */
  async function fetchAvailability(from, to) {
    const ids = S.doctor === 'any' ? S.doctors.map((d) => d.id) : [S.doctor];
    const q = (id) => `/availability?service_id=${encodeURIComponent(S.serviceId)}&from=${from}&to=${to}${id ? '&doctor_id=' + encodeURIComponent(id) : ''}`;
    const results = await Promise.allSettled(ids.map((id) => api(q(id))));
    const okCount = results.filter((r) => r.status === 'fulfilled').length;
    if (!okCount) throw results[0].reason;
    // «Аль ч эмч»: эмч бүрийн сул цагийг нэгтгэнэ — нэг цагт хэд хэдэн эмч сул бол жагсаалтын (sort_order) эхнийх нь авна
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
    return out;
  }

  // Сонгосон 2 долоо хоногийн сул цагийг татна. auto = хоосон бол дараагийн 2 долоо хоног руу автоматаар шилжинэ.
  async function loadWeek(auto, keepDate) {
    if (!S.serviceId) return;
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
    if (from <= to) {
      try {
        avail = await fetchAvailability(from, to);
      } catch (e) {
        if (seq !== S.seq) return;
        availError(e);
        return;
      }
    }
    if (seq !== S.seq) return;   // хэрэглэгч энэ хооронд өөр үйлчилгээ/эмч/долоо хоног сонгосон
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
    announce(S.date ? `${dateLong(S.date)}: ${n} сул цаг` : 'Энэ хугацаанд сул цаг алга');
  }

  function availError(e) {
    S.avail = new Map();
    renderCalendar();
    el.slotGroup.disabled = false;
    if (UNAVAILABLE.has(e.code) && !TRANSIENT.has(e.code)) { fallback('paused'); return; }
    const msg = e.code === 'RATE_LIMITED'
      ? 'Хэт олон хүсэлт ирлээ. Хэдэн секунд хүлээгээд дахин ачаална уу.'
      : e.code === 'SERVICE_UNAVAILABLE' || e.code === 'DOCTOR_UNAVAILABLE'
        ? 'Энэ үйлчилгээ эсвэл эмч одоогоор онлайнаар захиалагдахгүй байна. Өөрийг сонгох эсвэл утсаар холбогдоно уу.'
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
      el.slots.innerHTML = any ? '<p class="ub__hint">Өдрөө сонгоно уу.</p>'
        : `<p class="ub__hint">Ойрын ${horizon()} хоногт энэ сонголтоор онлайн сул цаг алга. Өөр эмч, үйлчилгээ сонгох эсвэл утсаар лавлана уу.</p>${contactsHtml()}`;
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
  function onService() {
    S.serviceId = el.service.value;
    clearAlert();
    const s = svc();
    el.info.textContent = s ? `Үнэ: ${priceText(s)} · Үргэлжлэх хугацаа: ${durText(s.duration_min)}` : '';
    S.week = monday(ubToday());
    if (!s) { S.avail = null; S.slot = null; S.date = ''; renderCalendar(); renderSlots(); renderSummary(); return; }
    loadWeek(true);
  }

  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t === el.service) { onService(); return; }
    if (t.name === 'ub-doctor') { S.doctor = t.value; clearAlert(); S.week = monday(ubToday()); loadWeek(true); return; }
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
    if (e.target.closest('[data-ub-reload]')) { loadWeek(false, true); return; }
    if (e.target.closest('[data-ub-retry-submit]')) { el.submit.click(); return; }
    if (e.target.closest('[data-ub-request]')) { fallback('failed'); return; }
    if (e.target.closest('[data-ub-new]')) { startOver(); }
  });
  [el.name, el.phone, el.note].forEach((f) => f.addEventListener('input', () => f.setCustomValidity('')));

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
    const name = el.name.value.replace(/\s+/g, ' ').trim();
    const phone = normPhone(el.phone.value);
    const note = el.note.value.trim();
    el.name.setCustomValidity(name.length < 2 ? 'Нэрээ бичнэ үү' : '');
    el.phone.setCustomValidity(/^[5-9]\d{7}$/.test(phone) ? '' : 'Гар утасны дугаараа 8 оронтойгоор бичнэ үү (жишээ нь 8800-0000)');
    el.note.setCustomValidity(note.length > NOTE_MAX ? `Нэмэлт мэдээлэл ${NOTE_MAX} тэмдэгтээс ихгүй байна` : '');
    if (!form.reportValidity()) return;

    // Honeypot: далд талбарыг зөвхөн бот бөглөнө — API руу юу ч илгээхгүй
    if (el.hp.value) { showDone({ status: 'pending_confirmation', date: S.date, label: S.slot.label, service: svc() }, name, phone); return; }

    const payload = {
      service_id: S.serviceId,
      ...(S.slot.docs[0] ? { doctor_id: S.slot.docs[0] } : {}),
      start: S.slot.start,
      customer: { name, phone },
      note,
      marketing_opt_in: false,
    };
    // Агуулга өөрчлөгдөөгүй (сүлжээний алдааны дараах давталт) бол хуучин түлхүүр, эс бөгөөс шинэ
    const fp = JSON.stringify(payload);
    if (!S.pending || S.pending.fp !== fp) S.pending = { key: newKey(), fp };
    setBusy(true);
    try {
      const data = await postBooking(payload, S.pending.key);
      S.pending = null;
      if (!data.booking || typeof data.booking !== 'object') throw new ApiError('INTERNAL', 200);
      showDone(data.booking, name, phone);
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
    if (code === 'PHONE_LIMIT') {
      showAlert('Энэ дугаарт идэвхтэй захиалга олон байна. Нэмэлт цаг авах бол утсаар эсвэл Messenger-ээр холбогдоно уу.' + contactsHtml());
      return;
    }
    if (code === 'RATE_LIMITED') {
      showAlert('Хэт олон оролдлого хийгдлээ. Хэсэг хүлээгээд дахин оролдох эсвэл утсаар захиална уу.' + contactsHtml());
      return;
    }
    if (code === 'DOCTOR_REQUIRED' || code === 'DOCTOR_UNAVAILABLE' || code === 'SERVICE_UNAVAILABLE') {
      showAlert('Сонгосон үйлчилгээ эсвэл эмч одоогоор онлайнаар захиалагдахгүй байна. Өөрийг сонгох эсвэл утсаар холбогдоно уу.' + contactsHtml());
      loadWeek(false, true);
      return;
    }
    // IDEMPOTENCY_MISMATCH болон бусад: шинэ түлхүүрээр дахин оролдож болно
    showAlert('Захиалга амжилтгүй боллоо. Дахин оролдох эсвэл утсаар захиална уу.' + contactsHtml());
  }

  /* ---------- Үр дүн ---------- */
  function showDone(b, name, phone) {
    const pending = b.status === 'pending_confirmation';
    const date = typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : S.date;
    const when = `${dateLong(date)} ${esc(b.label || (S.slot && S.slot.label) || '')}`;
    const service = (b.service && b.service.name) || (svc() && svc().name) || '';
    const doctor = (b.doctor && b.doctor.name) || '';
    el.done.innerHTML = `<strong>${pending ? 'Хүсэлтийг хүлээн авлаа.' : `Таны цаг ${when}-д баталгаажлаа.`}</strong>
      <dl class="ub__receipt">
        <dt>Огноо, цаг</dt><dd>${when}</dd>
        ${service ? `<dt>Үйлчилгээ</dt><dd>${esc(service)}</dd>` : ''}
        ${doctor ? `<dt>Эмч</dt><dd>${esc(doctor)}</dd>` : ''}
        <dt>Нэр, утас</dt><dd>${esc(name)}, ${esc(phone)}</dd>
      </dl>
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

  function startOver() {
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

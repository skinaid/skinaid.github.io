#!/usr/bin/env node
// UB Beauty «Вэб суваг» API-ийн ЛОКАЛ ХУУРАМЧ сервер — зөвхөн хөгжүүлэлтэд (Vercel-д нийтлэгдэхгүй: .vercelignore /tools).
// Жинхэнэ API зөвхөн https «Зөвшөөрсөн домэйн»-оос ажилладаг тул localhost дээр booking.js-ийг үүгээр туршина.
//
//   node tools/ub-mock-server.mjs            # http://127.0.0.1:8787
//   хөтчийн console (http://localhost:8765):  localStorage.setItem('skinaid:ub-api', 'http://127.0.0.1:8787'); location.reload()
//   болих:                                   localStorage.removeItem('skinaid:ub-api')
//
// Хариуны хэлбэр = UB Beauty репо docs/API-WEB-CHANNEL.md, src/app/api/v1/web/*/route.ts.
// Горим солих (restart-гүй): http://127.0.0.1:8787/__mock?mode=request|auto_confirm|prepay&paused=0|1&hide_names=0|1&delay=300
//   prepay (төлбөрөөр баталгаажих, QPay): &prepay_amount=20000 (0 = бүтэн үнэ) &hold_sec=900 (hold хугацаа — туршилтад 30)
//   төлбөр төлөгдсөн болгох: /__mock?pay=<booking_id>;  pending-д хүчээр дуусгах: /__mock?expire=<booking_id>
//   99000007 → захиалга үүснэ, 2 дахь «Төлбөр шалгах»-д төлөгдсөн болно
// Тусгай утасны дугаар (POST /bookings):
//   99000001 → 409 SLOT_TAKEN (тэр цагийг эзэлсэн болгоно)     99000004 → 500 INTERNAL (үргэлж)
//   99000002 → 429 RATE_LIMITED                                99000005 → 429 PHONE_LIMIT
//   99000003 → захиалга үүснэ, гэвч хариу тасарна (socket)     99000006 → 403 CHANNEL_PAUSED
//              → ИЖИЛ Idempotency-Key-ээр давтвал 200 давталт
// Үнийг нуусан үйлчилгээ (API §2.1б): «REJURAN Healer 2 мл» — /services-д price: null, price_hidden: true; prepay-д
//   payment.amount = жинхэнэ үнэ (эсвэл тогтмол урьдчилгаа)
// Давхар захиалга (API §2.3): ижил утсаар ИЖИЛ үйлчилгээнд дахин захиалбал 409 DUPLICATE_BOOKING (огноо, цаг, үйлчилгээ);
//   «Тийм, дахин захиалах» → allow_duplicate: true-тай дахин илгээхэд захиалга үүснэ
// Үзүүлэх ажилтан (API §2.1, UB Beauty 0167): serviceStaff-д бичсэн үйлчилгээнд ЗӨВХӨН тэр хүмүүс —
//   «AHA 70% Химийн гуужуулалт» → 2 эмч, «Үрэвсэлт батганы нэг удаагийн эмчилгээ» → 2 гоо засалч,
//   «Карбокситой нүүрний массаж» → 1 гоо засалч; бусад = тохируулаагүй (захиалга авдаг бүх ажилтан, ресепшн ч).
//   GET /doctors?service_id= шүүнэ; бусад ажилтанд /availability, POST /bookings → 422 DOCTOR_UNAVAILABLE.
//   Ажиллаж байхад солих: /__mock?staff=<service_id>:<doctor_id,doctor_id>  (хоосон = тохиргоог арилгах;
//   байхгүй id = «хэн ч захиалга авдаггүй» → /services-ээс хасагдана)
//   Ажилтан захиалга авахаа больсон (is_bookable = false): /__mock?unbook=<doctor_id>; буцаах: /__mock?rebook=<doctor_id>
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const state = { mode: 'auto_confirm', paused: false, hideNames: false, delay: 300, prepayAmount: 20000, holdSec: 900 };
const HORIZON = 30, MIN_NOTICE = 60;

const services = [
  { id: '6f1c2a10-0000-4000-8000-000000000001', name: 'Арьсны үзлэг, оношлогоо', category: '01. Үзлэг', duration_min: 30, price: 50000, price_max: null },
  { id: '6f1c2a10-0000-4000-8000-000000000002', name: 'Батганы цогц эмчилгээ', category: '02. Батга, сорви', duration_min: 60, price: 80000, price_max: 120000 },
  { id: '6f1c2a10-0000-4000-8000-000000000003', name: 'Сорвины лазер эмчилгээ', category: '02. Батга, сорви', duration_min: 45, price: 150000, price_max: null },
  { id: '6f1c2a10-0000-4000-8000-000000000004', name: 'Rejuran Healer', category: '03. Тарилга', duration_min: 60, price: 450000, price_max: null },
  { id: '6f1c2a10-0000-4000-8000-000000000005', name: 'Арьс чангалах эмчилгээ', category: '04. Арьс чангалах', duration_min: 90, price: 300000, price_max: 900000 },
  // Эмнэлэг үнийг НУУСАН (UB Beauty 0212 «Үнийг нийтэд харуулах» унтраалттай): API price: null, price_hidden: true;
  // төлөх дүн (prepay) = жинхэнэ үнэ → зөвхөн payment.amount-д
  { id: '6f1c2a10-0000-4000-8000-000000000006', name: 'REJURAN Healer 2 мл', category: '03. Тарилга', duration_min: 60, price: 750000, price_max: null, hidden: true },
  // Үзүүлэх ажилтантай (serviceStaff) — эзэмшигчийн 2 жишээ + ганц хүнтэй үйлчилгээ
  { id: '6f1c2a10-0000-4000-8000-000000000007', name: 'AHA 70% Химийн гуужуулалт', category: '02. Батга, сорви', duration_min: 45, price: 120000, price_max: null },
  { id: '6f1c2a10-0000-4000-8000-000000000008', name: 'Үрэвсэлт батганы нэг удаагийн эмчилгээ', category: '02. Батга, сорви', duration_min: 60, price: 90000, price_max: null },
  { id: '6f1c2a10-0000-4000-8000-000000000009', name: 'Карбокситой нүүрний массаж', category: '05. Массаж', duration_min: 60, price: 70000, price_max: null },
];
/** API-д гарах хэлбэр — нуусан үнэ null (UB Beauty src/lib/price-visibility.ts `withPublicPrice`) */
const publicService = ({ hidden, ...s }) => (hidden ? { ...s, price: null, price_max: null, price_hidden: true } : { ...s, price_hidden: false });
const doctors = [
  { id: '7a2b3c40-0000-4000-8000-000000000004', name: 'М.Ресепшн', title: 'Зохион байгуулагч', role: 'receptionist', days: [0, 1, 2, 3, 4, 5], from: 9, to: 20 },
  { id: '7a2b3c40-0000-4000-8000-000000000001', name: 'Б.Сарнай', title: 'Арьсны эмч', days: [0, 1, 2, 3, 4], from: 10, to: 18 },
  { id: '7a2b3c40-0000-4000-8000-000000000002', name: 'Д.Энхжин', title: 'Гоо засалч', role: 'cosmetologist', days: [1, 2, 3, 4, 5], from: 11, to: 19 },
  { id: '7a2b3c40-0000-4000-8000-000000000003', name: 'Г.Тэмүүлэн', title: 'Арьсны эмч', days: [0, 2, 4], from: 14, to: 19 },
  { id: '7a2b3c40-0000-4000-8000-000000000005', name: 'Ч.Номин', title: 'Гоо засалч', role: 'cosmetologist', days: [0, 2, 3, 5, 6], from: 10, to: 17 },
  { id: '7a2b3c40-0000-4000-8000-000000000006', name: 'С.Сувд', title: 'Сувилагч', role: 'nurse', days: [0, 1, 2, 3, 4], from: 9, to: 13 },
];
const D = (n) => `7a2b3c40-0000-4000-8000-00000000000${n}`;
/** service_id → үзүүлэх ажилтны id-ууд (UB Beauty service_staff). Байхгүй = тохируулаагүй = бүх ажилтан. */
const serviceStaff = new Map([
  ['6f1c2a10-0000-4000-8000-000000000007', [D(1), D(3)]],
  ['6f1c2a10-0000-4000-8000-000000000008', [D(2), D(5)]],
  ['6f1c2a10-0000-4000-8000-000000000009', [D(2)]],
]);
const off = new Set();       // захиалга авдаггүй болсон ажилтан (/__mock?unbook=)
const bookable = () => doctors.filter((d) => !off.has(d.id));
const lc = (v) => String(v || '').toLowerCase();   // UB Beauty UUID-г жижиг үсгээр тулгадаг
// UB Beauty service-staff-logic.ts-ийн хялбаршуулсан хуулбар
const eligibleStaff = (serviceId) => { const m = serviceStaff.get(serviceId); return m ? bookable().filter((d) => m.includes(d.id)) : bookable(); };
const staffAllowed = (serviceId, doctorId) => { const m = serviceStaff.get(serviceId); return !m || m.includes(lc(doctorId)); };
const doctorView = (d) => ({ id: d.id, name: state.hideNames ? null : d.name, title: state.hideNames ? null : d.title, photo_url: null, staff_role: d.role || 'doctor' });
const bookings = [];          // { id, doctor_id, service_id, phone, start, end, status, created, pay: { amount, status, checks, phone } | null, view }
const WD = ['Ням', 'Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба'];

/** UB Beauty booking-duplicate.ts-ийн хялбаршуулсан хуулбар — ижил утас ∧ үйлчилгээ ∧ ирээдүйн идэвхтэй цаг */
function duplicateOf(phone, service) {
  const now = Date.now();
  const live = (x) => x.phone === phone && x.service_id === service.id && Date.parse(x.start) > now
    && (x.status === 'confirmed' || x.status === 'pending_confirmation' || (x.status === 'pending_payment' && now - x.created < state.holdSec * 1000));
  const dup = bookings.filter(live).sort((a, c) => Date.parse(a.start) - Date.parse(c.start))[0];
  if (!dup) return null;
  const date = dup.view.date;
  const v = { date, label: dup.view.label, weekday: WD[new Date(`${date}T00:00:00Z`).getUTCDay()], status: dup.status, service: { id: service.id, name: service.name } };
  const when = `${date.replaceAll('-', '.')} (${v.weekday}) ${v.label} цагт «${service.name}» үйлчилгээнд`;
  const head = dup.status === 'confirmed' ? `Та ${when} цаг авч баталгаажсан байна.`
    : dup.status === 'pending_payment' ? `Та ${when} цаг захиалсан бөгөөд төлбөр нь хүлээгдэж байна.`
      : `Та ${when} цаг авах хүсэлт илгээсэн, эмнэлэг баталгаажуулахыг хүлээж байна.`;
  const tail = state.mode === 'prepay' ? ' Дахин захиалбал хоёр дахь цаг үүсэж, төлбөрийг дахин төлөх болно.' : ' Дахин захиалбал тусдаа хоёр дахь цаг үүснэ.';
  return { message: head + tail, duplicate: v };
}
const idem = new Map();       // Idempotency-Key → { fp, booking }

const ubToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const dayNum = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
const addDays = (d, n) => new Date((dayNum(d) + n) * 86400000).toISOString().slice(0, 10);
const weekday = (d) => (new Date(dayNum(d) * 86400000).getUTCDay() + 6) % 7;
const utcIso = (d, h, m) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), h - 8, m)).toISOString();
const label = (iso) => new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(11, 16);

// Цаг эзэлж буй захиалга: confirmed / pending_confirmation, эсвэл hold дотор байгаа pending_payment (UB Beauty getSlots-тэй ижил)
const holdExpired = (b) => b.status === 'pending_payment' && Date.now() - b.created >= state.holdSec * 1000;
const occupies = (b) => b.status === 'confirmed' || b.status === 'pending_confirmation' || (b.status === 'pending_payment' && !holdExpired(b));
// QPay-ийн нэхэмжлэлийн хариуг дууриасан payment объект (docs/API-WEB-CHANNEL.md «Төлбөрөөр баталгаажих»)
const QR_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAHklEQVR4nGP4jwQYGBj+MzAwQBAyG0kOIgRRh2YWAC4dC+gVsY+UAAAAAElFTkSuQmCC';
function paymentView(b) {
  if (!b.pay) return null;
  const expired = holdExpired(b);
  if (expired && b.status === 'pending_payment') { b.status = 'cancelled'; b.pay.status = 'expired'; }
  const status = b.status === 'confirmed' ? 'paid' : b.pay.status === 'expired' ? 'expired' : b.status === 'cancelled' ? 'cancelled' : 'pending';
  const links = status === 'pending';
  return {
    provider: 'qpay', status, amount: b.pay.amount, hold_expires_at: new Date(b.created + state.holdSec * 1000).toISOString(),
    qr_text: links ? '0002010102121531279404962794049600022310027138152045734530349654031005802MN5904TEST6011Ulaanbaatar' : null,
    qr_image: links ? QR_PNG : null,
    short_url: links ? 'https://s.qpay.mn/mock' : null,
    deeplinks: links ? [
      { name: 'Khan bank', description: 'Хаан банк', logo: 'https://qpay.mn/q/logo/khanbank.png', link: 'khanbank://q?qPay_QRcode=mock' },
      { name: 'Social Pay', description: 'Social Pay', logo: 'https://qpay.mn/q/logo/socialpay.png', link: 'socialpay-payment://q?qPay_QRcode=mock' },
      { name: 'Golomt bank', description: 'Голомт банк', logo: 'https://qpay.mn/q/logo/golomt.png', link: 'golomtbank://q?qPay_QRcode=mock' },
    ] : [],
  };
}
const bookingView = (b) => ({ ...b.view, status: b.status, created: false, sms_sent: false, payment: paymentView(b) });

function slotsFor(service, doctor, date) {
  if (!doctor.days.includes(weekday(date))) return [];
  const out = [];
  const now = Date.now();
  for (let t = doctor.from * 60; t + service.duration_min <= doctor.to * 60; t += 30) {
    const start = utcIso(date, Math.floor(t / 60), t % 60);
    const s = Date.parse(start), e = s + service.duration_min * 60000;
    if (s < now + MIN_NOTICE * 60000 || s > now + HORIZON * 86400000) continue;
    // Хуурамч «завгүй» цаг: өдөр, эмчээс хамаарсан тогтмол хэв (жагсаалт хоосон биш ч бодит харагдана)
    if ((dayNum(date) + t / 30 + doctor.from) % 5 === 0) continue;
    if (bookings.some((b) => b.doctor_id === doctor.id && occupies(b) && Date.parse(b.start) < e && Date.parse(b.end) > s)) continue;
    out.push({ start, end: new Date(e).toISOString(), label: label(start) });
  }
  return out;
}

function send(res, status, body, origin, extra = {}) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin', ...extra };
  if (origin) { h['Access-Control-Allow-Origin'] = origin; h['Access-Control-Expose-Headers'] = 'Retry-After'; }
  res.writeHead(status, h);
  res.end(JSON.stringify(body));
}
const fail = (res, origin, status, code, field, extra) => send(res, status, { error: { code, message: code, ...(field ? { field } : {}) } }, origin, extra);

const server = createServer(async (req, res) => {
  const origin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin || '') ? req.headers.origin : null;
  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace(/\/+$/, '');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, origin ? {
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, Authorization, Idempotency-Key', 'Access-Control-Max-Age': '600', Vary: 'Origin',
    } : {});
    return res.end();
  }
  if (path === '/__mock') {
    const q = url.searchParams;
    if (q.has('mode')) state.mode = q.get('mode') === 'request' ? 'request' : 'auto_confirm';
    if (q.has('paused')) state.paused = q.get('paused') === '1';
    if (q.has('hide_names')) state.hideNames = q.get('hide_names') === '1';
    if (q.has('mode')) state.mode = q.get('mode') === 'request' ? 'request' : q.get('mode') === 'prepay' ? 'prepay' : 'auto_confirm';
    if (q.has('delay')) state.delay = Math.max(0, Number(q.get('delay')) || 0);
    if (q.has('prepay_amount')) state.prepayAmount = Math.max(0, Number(q.get('prepay_amount')) || 0);
    if (q.has('hold_sec')) state.holdSec = Math.max(5, Number(q.get('hold_sec')) || 900);
    if (q.has('pay')) { const b = bookings.find((x) => x.id === q.get('pay')); if (b && b.pay && b.status === 'pending_payment') { b.pay.status = 'paid'; b.status = 'confirmed'; } }
    if (q.has('expire')) { const b = bookings.find((x) => x.id === q.get('expire')); if (b && b.pay) b.created = Date.now() - state.holdSec * 1000 - 1000; }
    if (q.has('reset')) { bookings.length = 0; idem.clear(); }
    if (q.has('unbook')) off.add(lc(q.get('unbook')));
    if (q.has('rebook')) off.delete(lc(q.get('rebook')));
    if (q.has('staff')) {
      const [sid, ids = ''] = String(q.get('staff')).split(':');
      const list = ids.split(',').map((x) => x.trim()).filter(Boolean);
      if (list.length) serviceStaff.set(sid, list); else serviceStaff.delete(sid);
    }
    return send(res, 200, { state, bookings, serviceStaff: Object.fromEntries(serviceStaff), unbooked: [...off] }, origin);
  }
  const body = req.method === 'POST' ? await new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); }) : '';
  await new Promise((r) => setTimeout(r, state.delay));
  const key = req.headers['x-api-key'] || '';
  console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${req.url}${req.headers['idempotency-key'] ? '  Idempotency-Key=' + req.headers['idempotency-key'] : ''}`);
  if (!/^pk_/.test(key)) return fail(res, null, 401, 'INVALID_KEY');
  if (!origin) return fail(res, null, 403, 'ORIGIN_NOT_ALLOWED');
  if (state.paused) return fail(res, origin, 403, 'CHANNEL_PAUSED');

  if (req.method === 'GET' && path === '/clinic') {
    return send(res, 200, {
      clinic: { id: 'c0000000-0000-4000-8000-000000000001', name: 'SkinAid (mock)', slug: 'skinaid', phone: '76000505', address: null, district: null, brand_color: '#654186', logo_url: null },
      channel: {
        booking_mode: state.mode, new_booking_status: state.mode === 'request' ? 'pending_confirmation' : state.mode === 'prepay' ? 'pending_payment' : 'confirmed',
        horizon_days: HORIZON, min_notice_min: MIN_NOTICE, show_doctor_names: !state.hideNames, timezone: 'Asia/Ulaanbaatar',
        prepay: state.mode === 'prepay' ? { amount: state.prepayAmount || null, hold_min: Math.ceil(state.holdSec / 60), provider: 'qpay', ready: true } : null,
      },
    }, origin);
  }
  // Тохируулсан ч үзүүлэх ажилтан нь захиалга авдаггүй үйлчилгээ /services-д гарахгүй (API §2.1)
  if (req.method === 'GET' && path === '/services') {
    const staffed = bookable().length > 0;   // ажилтангүй эмнэлэг (эмнэлгийн түвшний захиалга) = бүх үйлчилгээ
    return send(res, 200, { services: services.filter((s) => !staffed || eligibleStaff(s.id).length).map(publicService) }, origin);
  }
  if (req.method === 'GET' && path === '/doctors') {
    const sid = url.searchParams.get('service_id') || '';
    if (sid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) return fail(res, origin, 400, 'VALIDATION', 'service_id');
    if (sid && !services.some((s) => s.id === sid.toLowerCase())) return fail(res, origin, 422, 'SERVICE_UNAVAILABLE');
    const list = (sid ? eligibleStaff(sid.toLowerCase()) : bookable()).map(doctorView);
    return send(res, 200, { doctors: list, doctor_required: bookable().length > 0, service_id: sid ? sid.toLowerCase() : null }, origin);
  }
  if (req.method === 'GET' && path === '/availability') {
    const q = url.searchParams;
    const service = services.find((s) => s.id === q.get('service_id'));
    const from = q.get('from') || '', to = q.get('to') || from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from || dayNum(to) - dayNum(from) + 1 > 14) return fail(res, origin, 400, 'VALIDATION', 'from');
    if (to < ubToday() || dayNum(to) > dayNum(ubToday()) + HORIZON) return fail(res, origin, 422, 'OUTSIDE_HORIZON');
    if (!service) return fail(res, origin, 422, 'SERVICE_UNAVAILABLE');
    const doctor = bookable().find((d) => d.id === lc(q.get('doctor_id')));
    if (!q.get('doctor_id')) return fail(res, origin, 422, 'DOCTOR_REQUIRED', 'doctor_id');
    if (!doctor || !staffAllowed(service.id, doctor.id)) return fail(res, origin, 422, 'DOCTOR_UNAVAILABLE');
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push({ date: d, slots: slotsFor(service, doctor, d) });
    return send(res, 200, { service_id: service.id, doctor_id: doctor.id, duration_min: service.duration_min, timezone: 'Asia/Ulaanbaatar', days }, origin);
  }
  if (req.method === 'POST' && path === '/bookings') {
    const ik = String(req.headers['idempotency-key'] || '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(ik)) return fail(res, origin, 400, 'VALIDATION', 'Idempotency-Key');
    let b; try { b = JSON.parse(body); } catch { return fail(res, origin, 400, 'VALIDATION', 'body'); }
    let phone = String(b?.customer?.phone ?? '').replace(/\D/g, ''); if (phone.length > 8 && phone.startsWith('976')) phone = phone.slice(3);
    const name = String(b?.customer?.name ?? '').trim();
    const fp = JSON.stringify([b.service_id, b.doctor_id || null, b.start, phone]);
    const prev = idem.get(ik);
    if (prev) {
      if (prev.fp !== fp) return fail(res, origin, 409, 'IDEMPOTENCY_MISMATCH');
      const row = bookings.find((x) => x.id === prev.booking.id);
      return send(res, 200, { booking: row ? bookingView(row) : { ...prev.booking, created: false, sms_sent: false } }, origin);
    }
    if (phone === '99000002') return fail(res, origin, 429, 'RATE_LIMITED', null, { 'Retry-After': '60' });
    if (phone === '99000004') return fail(res, origin, 500, 'INTERNAL');
    if (phone === '99000005') return fail(res, origin, 429, 'PHONE_LIMIT');
    if (phone === '99000006') return fail(res, origin, 403, 'CHANNEL_PAUSED');
    if (!name || name.length > 100) return fail(res, origin, 400, 'VALIDATION', 'customer.name');
    if (!/^[5-9]\d{7}$/.test(phone)) return fail(res, origin, 400, 'VALIDATION', 'customer.phone');
    if (String(b.note ?? '').trim().length > 500) return fail(res, origin, 400, 'VALIDATION', 'note');
    const service = services.find((s) => s.id === b.service_id);
    if (!service) return fail(res, origin, 422, 'SERVICE_UNAVAILABLE');
    if (!b.doctor_id) return fail(res, origin, 422, 'DOCTOR_REQUIRED', 'doctor_id');
    const doctor = bookable().find((d) => d.id === lc(b.doctor_id));
    if (!doctor || !staffAllowed(service.id, doctor.id)) return fail(res, origin, 422, 'DOCTOR_UNAVAILABLE');
    const start = new Date(String(b.start)); if (Number.isNaN(start.getTime())) return fail(res, origin, 400, 'VALIDATION', 'start');
    if (b.allow_duplicate !== true) {
      const dup = duplicateOf(phone, service);
      if (dup) return send(res, 409, { error: { code: 'DUPLICATE_BOOKING', ...dup } }, origin);
    }
    const startISO = start.toISOString();
    if (start.getTime() <= Date.now()) return fail(res, origin, 422, 'SLOT_PAST');
    const date = new Date(start.getTime() + 8 * 3600000).toISOString().slice(0, 10);
    const free = slotsFor(service, doctor, date).some((s) => s.start === startISO);
    if (!free || phone === '99000001') {
      if (phone === '99000001') bookings.push({ id: randomUUID(), doctor_id: doctor.id, start: startISO, end: new Date(start.getTime() + service.duration_min * 60000).toISOString(), status: 'confirmed' });
      return fail(res, origin, 409, 'SLOT_TAKEN');
    }
    const prepay = state.mode === 'prepay';
    const booking = {
      id: randomUUID(), status: state.mode === 'request' ? 'pending_confirmation' : prepay ? 'pending_payment' : 'confirmed', start: startISO,
      end: new Date(start.getTime() + service.duration_min * 60000).toISOString(), label: label(startISO), date,
      service: { id: service.id, name: service.name, duration_min: service.duration_min, price: service.hidden ? null : service.price, price_hidden: Boolean(service.hidden) },
      doctor: { id: doctor.id, name: state.hideNames ? null : doctor.name }, created: true, sms_sent: false, payment: null,
    };
    const row = {
      id: booking.id, doctor_id: doctor.id, service_id: service.id, phone, start: booking.start, end: booking.end, status: booking.status, created: Date.now(), view: booking,
      pay: prepay ? { amount: state.prepayAmount ? Math.min(state.prepayAmount, service.price) : service.price, status: 'pending', checks: 0, phone } : null,
    };
    bookings.push(row);
    if (prepay) booking.payment = paymentView(row);
    idem.set(ik, { fp, booking });
    console.log(`   → захиалга ${booking.status}: ${date} ${booking.label}, ${service.name}, ${doctor.name}, ${name} ${phone}`);
    if (phone === '99000003' && !idem.get(ik).dropped) { idem.get(ik).dropped = true; req.socket.destroy(); return; }
    return send(res, 201, { booking }, origin);
  }
  const m = path.match(/^\/bookings\/([0-9a-f-]{36})(\/payment\/check)?$/);
  if (m) {
    const b = bookings.find((x) => x.id === m[1]);
    if (!b) return fail(res, origin, 404, 'NOT_FOUND');
    if (m[2] && req.method === 'POST') {
      if (b.pay && b.status === 'pending_payment' && !holdExpired(b)) {
        b.pay.checks += 1;
        if (b.pay.phone === '99000007' && b.pay.checks >= 2) { b.pay.status = 'paid'; b.status = 'confirmed'; }
      }
      console.log(`   → төлбөр шалгав: ${b.id.slice(0, 8)} ${b.status}`);
      return send(res, 200, { booking: bookingView(b) }, origin);
    }
    if (req.method === 'GET') return send(res, 200, { booking: bookingView(b) }, origin);
  }
  return fail(res, origin, 404, 'NOT_FOUND');
});
server.listen(PORT, '127.0.0.1', () => console.log(`UB Beauty mock API: http://127.0.0.1:${PORT}  (горим: /__mock)`));

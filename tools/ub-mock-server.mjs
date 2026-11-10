#!/usr/bin/env node
// UB Beauty «Вэб суваг» API-ийн ЛОКАЛ ХУУРАМЧ сервер — зөвхөн хөгжүүлэлтэд (Vercel-д нийтлэгдэхгүй: .vercelignore /tools).
// Жинхэнэ API зөвхөн https «Зөвшөөрсөн домэйн»-оос ажилладаг тул localhost дээр booking.js-ийг үүгээр туршина.
//
//   node tools/ub-mock-server.mjs            # http://127.0.0.1:8787
//   хөтчийн console (http://localhost:8765):  localStorage.setItem('skinaid:ub-api', 'http://127.0.0.1:8787'); location.reload()
//   болих:                                   localStorage.removeItem('skinaid:ub-api')
//
// Хариуны хэлбэр = UB Beauty репо docs/API-WEB-CHANNEL.md, src/app/api/v1/web/*/route.ts.
// Горим солих (restart-гүй): http://127.0.0.1:8787/__mock?mode=request|auto_confirm&paused=0|1&hide_names=0|1&delay=300
// Тусгай утасны дугаар (POST /bookings):
//   99000001 → 409 SLOT_TAKEN (тэр цагийг эзэлсэн болгоно)     99000004 → 500 INTERNAL (үргэлж)
//   99000002 → 429 RATE_LIMITED                                99000005 → 429 PHONE_LIMIT
//   99000003 → захиалга үүснэ, гэвч хариу тасарна (socket)     99000006 → 403 CHANNEL_PAUSED
//              → ИЖИЛ Idempotency-Key-ээр давтвал 200 давталт
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const state = { mode: 'auto_confirm', paused: false, hideNames: false, delay: 300 };
const HORIZON = 30, MIN_NOTICE = 60;

const services = [
  { id: '6f1c2a10-0000-4000-8000-000000000001', name: 'Арьсны үзлэг, оношлогоо', category: '01. Үзлэг', duration_min: 30, price: 50000, price_max: null },
  { id: '6f1c2a10-0000-4000-8000-000000000002', name: 'Батганы цогц эмчилгээ', category: '02. Батга, сорви', duration_min: 60, price: 80000, price_max: 120000 },
  { id: '6f1c2a10-0000-4000-8000-000000000003', name: 'Сорвины лазер эмчилгээ', category: '02. Батга, сорви', duration_min: 45, price: 150000, price_max: null },
  { id: '6f1c2a10-0000-4000-8000-000000000004', name: 'Rejuran Healer', category: '03. Тарилга', duration_min: 60, price: 450000, price_max: null },
  { id: '6f1c2a10-0000-4000-8000-000000000005', name: 'Ультраформер III (HIFU)', category: '04. Арьс чангалах', duration_min: 90, price: 300000, price_max: 900000 },
];
const doctors = [
  { id: '7a2b3c40-0000-4000-8000-000000000004', name: 'М.Ресепшн', title: 'Зохион байгуулагч', role: 'receptionist', days: [0, 1, 2, 3, 4, 5], from: 9, to: 20 },
  { id: '7a2b3c40-0000-4000-8000-000000000001', name: 'Б.Сарнай', title: 'Арьсны эмч', days: [0, 1, 2, 3, 4], from: 10, to: 18 },
  { id: '7a2b3c40-0000-4000-8000-000000000002', name: 'Д.Энхжин', title: 'Гоо засалч', role: 'cosmetologist', days: [1, 2, 3, 4, 5], from: 11, to: 19 },
  { id: '7a2b3c40-0000-4000-8000-000000000003', name: 'Г.Тэмүүлэн', title: 'Арьсны эмч', days: [0, 2, 4], from: 14, to: 19 },
];
const bookings = [];          // { id, doctor_id, start, end, status }
const idem = new Map();       // Idempotency-Key → { fp, booking }

const ubToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const dayNum = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
const addDays = (d, n) => new Date((dayNum(d) + n) * 86400000).toISOString().slice(0, 10);
const weekday = (d) => (new Date(dayNum(d) * 86400000).getUTCDay() + 6) % 7;
const utcIso = (d, h, m) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), h - 8, m)).toISOString();
const label = (iso) => new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(11, 16);

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
    if (bookings.some((b) => b.doctor_id === doctor.id && Date.parse(b.start) < e && Date.parse(b.end) > s)) continue;
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
    if (q.has('delay')) state.delay = Math.max(0, Number(q.get('delay')) || 0);
    if (q.has('reset')) { bookings.length = 0; idem.clear(); }
    return send(res, 200, { state, bookings }, origin);
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
      channel: { booking_mode: state.mode, new_booking_status: state.mode === 'request' ? 'pending_confirmation' : 'confirmed', horizon_days: HORIZON, min_notice_min: MIN_NOTICE, show_doctor_names: !state.hideNames, timezone: 'Asia/Ulaanbaatar' },
    }, origin);
  }
  if (req.method === 'GET' && path === '/services') return send(res, 200, { services }, origin);
  if (req.method === 'GET' && path === '/doctors') {
    const list = doctors.map((d) => ({ id: d.id, name: state.hideNames ? null : d.name, title: state.hideNames ? null : d.title, photo_url: null, staff_role: d.role || 'doctor' }));
    return send(res, 200, { doctors: list, doctor_required: true }, origin);
  }
  if (req.method === 'GET' && path === '/availability') {
    const q = url.searchParams;
    const service = services.find((s) => s.id === q.get('service_id'));
    const from = q.get('from') || '', to = q.get('to') || from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from || dayNum(to) - dayNum(from) + 1 > 14) return fail(res, origin, 400, 'VALIDATION', 'from');
    if (to < ubToday() || dayNum(to) > dayNum(ubToday()) + HORIZON) return fail(res, origin, 422, 'OUTSIDE_HORIZON');
    if (!service) return fail(res, origin, 422, 'SERVICE_UNAVAILABLE');
    const doctor = doctors.find((d) => d.id === q.get('doctor_id'));
    if (!q.get('doctor_id')) return fail(res, origin, 422, 'DOCTOR_REQUIRED', 'doctor_id');
    if (!doctor) return fail(res, origin, 422, 'DOCTOR_UNAVAILABLE');
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
      return send(res, 200, { booking: { ...prev.booking, created: false, sms_sent: false } }, origin);
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
    const doctor = doctors.find((d) => d.id === b.doctor_id);
    if (!doctor) return fail(res, origin, 422, 'DOCTOR_UNAVAILABLE');
    const start = new Date(String(b.start)); if (Number.isNaN(start.getTime())) return fail(res, origin, 400, 'VALIDATION', 'start');
    const startISO = start.toISOString();
    if (start.getTime() <= Date.now()) return fail(res, origin, 422, 'SLOT_PAST');
    const date = new Date(start.getTime() + 8 * 3600000).toISOString().slice(0, 10);
    const free = slotsFor(service, doctor, date).some((s) => s.start === startISO);
    if (!free || phone === '99000001') {
      if (phone === '99000001') bookings.push({ id: randomUUID(), doctor_id: doctor.id, start: startISO, end: new Date(start.getTime() + service.duration_min * 60000).toISOString(), status: 'confirmed' });
      return fail(res, origin, 409, 'SLOT_TAKEN');
    }
    const booking = {
      id: randomUUID(), status: state.mode === 'request' ? 'pending_confirmation' : 'confirmed', start: startISO,
      end: new Date(start.getTime() + service.duration_min * 60000).toISOString(), label: label(startISO), date,
      service: { id: service.id, name: service.name, duration_min: service.duration_min, price: service.price },
      doctor: { id: doctor.id, name: state.hideNames ? null : doctor.name }, created: true, sms_sent: false,
    };
    bookings.push({ id: booking.id, doctor_id: doctor.id, start: booking.start, end: booking.end, status: booking.status });
    idem.set(ik, { fp, booking });
    console.log(`   → захиалга ${booking.status}: ${date} ${booking.label}, ${service.name}, ${doctor.name}, ${name} ${phone}`);
    if (phone === '99000003' && !idem.get(ik).dropped) { idem.get(ik).dropped = true; req.socket.destroy(); return; }
    return send(res, 201, { booking }, origin);
  }
  return fail(res, origin, 404, 'NOT_FOUND');
});
server.listen(PORT, '127.0.0.1', () => console.log(`UB Beauty mock API: http://127.0.0.1:${PORT}  (горим: /__mock)`));

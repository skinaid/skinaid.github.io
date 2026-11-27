/* ==========================================================================
   SKIN AID admin — Messenger AI → «Тойм» (2-р үе шат): өдрийн нэгтгэл (messenger_usage/<УБ өдөр> — сервер ноорогтой нэг
   commit-д бичдэг) ба үнэлгээний нарийвчлал (messenger_drafts ratedAt ≥ …). 3-р үе шатны гейт: «Автомат боломжтой»
   ноорогийн ≥ 85% шууд эсвэл бага засвартай (≥ 50 үнэлгээ).
   Квот: таб нээх / хугацаа солих бүрт ≤ 32 + ≤ 500 read. Бүх текст esc()-ээр; тоо — текстээр шууд (өнгө зөвхөн хэмжээ).
   Үнэлгээний цонх = өдрийн нэгтгэлийн цонх (УБ-ын N хуанлийн өдөр, өнөөдрийг оруулаад).
   ========================================================================== */
import { collection, query, where, orderBy, limit, getDocs, getDoc, doc, documentId } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db, $, $$, esc, errText, session, setStatus } from './core.js?v=2c361933';
import { usd, lastDays, aggregateDays, ratingStats, AUTO_GATE, ECHO_TEXT, RUN_STATUS_TEXT, SEND_KIND_TEXT, sendReasonText, ubMonth } from './messenger-lib.js?v=8187c6d1';

const RATING_LIMIT = 500;
const box = $('#msOverview'), status = $('#msOvStatus'), chips = $('#msOvChips');
let days = 7;
let opened = false;
let gen = 0;
let loading = false;
/** Сарын хязгаар (m-messenger.js «Тохиргоо»-оос); сарын зардлыг load() өөрөө уншина (1 read) */
let getMonth = () => ({ usage: null, settings: null });
export function initOverview(d) { if (d.getMonth) getMonth = d.getMonth; }

const ROUTE_LABEL = { auto_candidate: 'Автомат боломжтой', draft: 'Хүн хянана', handoff: 'Ажилтанд шилжүүлнэ', silent: 'Чимээгүй' };
const INTENT_LABEL = {
  greeting: 'Мэндчилгээ', thanks: 'Талархал', hours: 'Цагийн хуваарь', location: 'Хаяг, байршил', contact: 'Холбоо барих',
  service_info: 'Үйлчилгээний мэдээлэл', price: 'Үнэ', promotion: 'Урамшуулал', booking: 'Цаг захиалах', human_request: 'Ажилтантай ярих',
  medical: 'Эмнэлгийн асуулт', side_effect: 'Гаж нөлөө', complaint: 'Гомдол', refund: 'Мөнгө буцаалт', discount: 'Хөнгөлөлт гуйх',
  legal: 'Хуулийн асуудал', sensitive_group: 'Жирэмсэн, хүүхэд', media: 'Зураг, видео', other: 'Тодорхойгүй',
};
/** Тайлбаргүй код (шинэ төлөв г.м.) — bars() нэрийг esc()-ээр гаргана */
const other = (k) => 'Бусад (' + String(k) + ')';
const pct = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : `${Math.round(x * 100)}%`);
const share = (a, b) => (b ? a / b : null);
const fmtDay = (d) => d.slice(5).replace('-', '.');

chips.innerHTML = [7, 30].map((n) => `<button class="chip${n === days ? ' is-active' : ''}" type="button" data-days="${n}" aria-pressed="${n === days}">Сүүлийн ${n} хоног</button>`).join('');
// Ачаалж байх үед хугацаа сольсон ч алгасахгүй — шинэ ачаалал өмнөхийг орлоно (gen; аудит)
chips.addEventListener('click', (e) => {
  const b = e.target.closest('[data-days]');
  if (!b) return;
  const n = Number(b.dataset.days);
  if (n === days && loading) return;
  days = n;
  $$('.chip', chips).forEach((c) => { const on = Number(c.dataset.days) === days; c.classList.toggle('is-active', on); c.setAttribute('aria-pressed', String(on)); });
  load(true);
});
$('#btnMsOvReload').addEventListener('click', () => load(true));

/** Хэвтээ багана (нэг өнгө = хэмжээ; нэр, тоо — текстээр) */
function bars(entries, labelOf, total) {
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return `<ul class="ms-bars">${entries.map(([k, v]) => `<li><span class="ms-bars__label">${esc(labelOf(k))}</span><span class="ms-bars__track" aria-hidden="true"><span class="ms-bars__fill" style="width:${Math.max(2, Math.round((100 * v) / max))}%"></span></span><span class="ms-bars__val">${Number(v)}${total ? ` · ${pct(v / total)}` : ''}</span></li>`).join('')}</ul>`;
}
/** Өдөр бүрийн ноорог — босоо нимгэн багана (hover/фокуст тайлбар), доор нь хүснэгт */
function daily(series) {
  const max = Math.max(1, ...series.map((s) => s.drafts));
  return `<div class="ms-cols" role="img" aria-label="Өдөр бүрийн ноорог: ${esc(series.map((s) => `${fmtDay(s.day)} ${s.drafts}`).join(', '))}">${series.map((s) => `<span class="ms-cols__c" title="${esc(s.day + ': ' + Number(s.drafts) + ' ноорог')}"><span class="ms-cols__bar" style="height:${s.drafts ? Math.max(4, Math.round((100 * s.drafts) / max)) : 0}%"></span></span>`).join('')}</div>
    <div class="ms-cols__axis" aria-hidden="true"><span>${esc(fmtDay(series[0].day))}</span><span>${esc(fmtDay(series[series.length - 1].day))}</span></div>
    <details class="ms-ctx"><summary>Хүснэгтээр</summary><div class="ms-tbl-wrap" tabindex="0" role="region" aria-label="Өдөр бүрийн ноорог"><table class="ms-tbl"><thead><tr><th scope="col">Өдөр</th><th scope="col">Ноорог</th></tr></thead><tbody>${series.map((s) => `<tr><td>${esc(s.day)}</td><td>${Number(s.drafts)}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function gateHtml(r) {
  const g = r.gate;
  const state = g.met ? ['ok', '✓', 'Хүрсэн'] : !g.enough ? ['muted', '…', `Үнэлгээ хангалтгүй (${Number(r.auto.rated)}/${AUTO_GATE.minRated})`] : ['warn', '!', 'Хүрээгүй'];
  return `<span class="ms-gate ms-gate--${state[0]}"><span aria-hidden="true">${state[1]}</span> ${esc(state[2])}</span>`;
}
function render(agg, r) {
  const t = agg.totals;
  const today = agg.series[agg.series.length - 1]?.drafts || 0;
  const { settings } = getMonth();
  const usage = r.month;
  const routeEntries = Object.entries(t.routes).sort((a, b) => b[1] - a[1]);
  const intentEntries = Object.entries(t.intents).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const echoEntries = Object.entries(t.echo).sort((a, b) => b[1] - a[1]);
  // Тайлбар мөрийг <dd> дотор (dl-ийн div бүлэгт зөвхөн dt/dd — аудит)
  const tile = (label, value, sub) => `<div><dt>${label}</dt><dd><span class="ms-tiles__v">${value}</span><span class="ms-tiles__sub">${sub}</span></dd></div>`;
  const total = (Number(t.costMicroUsd) || 0) + (Number(t.adminCostMicroUsd) || 0);
  box.innerHTML = `
    <dl class="ms-tiles">
      ${tile(`Ноорог (${days} хоног)`, Number(t.drafts), `Өнөөдөр ${Number(today)}`)}
      ${tile('Үнэлгээ — «Зөв»', pct(share(r.good, r.rated)), `Засвартай ${pct(share(r.edited, r.rated))} · Буруу ${pct(share(r.wrong, r.rated))} · ${Number(r.rated)} үнэлгээ`)}
      ${tile('«Автомат боломжтой» — шууд эсвэл бага засвар', pct(r.gate.share), `${Number(r.auto.rated)} үнэлгээ · зорилт ≥ ${Math.round(AUTO_GATE.share * 100)}% ${gateHtml(r)}`)}
      ${tile(`AI хариуны зардал (${days} хоног)`, esc(usd(t.costMicroUsd)), `Туршилт, eval ${esc(usd(t.adminCostMicroUsd))} · нийт ${esc(usd(total))}${usage && settings ? ` · энэ сар бүгд ${esc(usd(usage.costMicroUsd))} / $${esc(String(settings.monthlyCostCapUsd))}` : ''}`)}
      ${tile('AI алдаа, татгалзал', Number(t.aiErrors), Object.entries(t.runs).map(([k, v]) => `${esc(RUN_STATUS_TEXT[k] || k)} ${Number(v)}`).join(' · ') || '—')}
      ${tile('Үйлчлүүлэгчид илгээсэн («Автомат»)', Number(t.sentTotal), [
        ...Object.entries(t.sent).map(([k, v]) => `${esc(SEND_KIND_TEXT[k] || other(k))} ${Number(v)}`),
        t.sendFailTotal ? `илгээж чадаагүй ${Number(t.sendFailTotal)} (${Object.entries(t.sendFail).map(([k, v]) => `${esc(sendReasonText(k))} ${Number(v)}`).join(', ')})` : '',
        t.sendSkipTotal ? `илгээгээгүй ${Number(t.sendSkipTotal)} (${Object.entries(t.sendSkip).map(([k, v]) => `${esc(sendReasonText(k))} ${Number(v)}`).join(', ')})` : '',
      ].filter(Boolean).join(' · ') || 'Хугацаанд юу ч илгээгээгүй')}
      ${tile('Кэшээс уншсан', pct(t.cacheHit), 'Давтагдах заавар, мэдлэгийг кэшээс уншсан хувь — өндөр бол хямд')}
    </dl>
    <div class="ms-ov-grid">
      <section class="panel"><h3 class="ms-sub">Өдөр бүрийн ноорог</h3>${agg.series.length ? daily(agg.series) : ''}</section>
      <section class="panel"><h3 class="ms-sub">Чиглэл (код шийдсэн)</h3>${routeEntries.length ? bars(routeEntries, (k) => ROUTE_LABEL[k] || other(k), t.drafts) : '<p class="muted">Мэдээлэл алга.</p>'}</section>
      <section class="panel"><h3 class="ms-sub">Сэдэв (эхний 8)</h3>${intentEntries.length ? bars(intentEntries, (k) => INTENT_LABEL[k] || other(k), t.drafts) : '<p class="muted">Мэдээлэл алга.</p>'}</section>
      <section class="panel"><h3 class="ms-sub">Пэйжийн хариу хэнийх вэ</h3>${echoEntries.length ? bars(echoEntries, (k) => ECHO_TEXT[k] || other(k)) : '<p class="muted">Хугацаанд пэйжээс хариу илгээгдээгүй.</p>'}<p class="muted ms-small">«Meta автомат» гэж андуурсан ажилтны хариуг шалгана (сүүдэрт ажилтан ≤ 15 с-д, «Автомат» горимын амьд ярианд ≤ 8 с-д хариулбал автомат гэж тоологддог).</p></section>
    </div>
    <p class="muted ms-small">Өдрийн нэгтгэл энэ хувилбараас (2026-11-27) хойш тоологдоно. Хугацаа = Улаанбаатарын ${days} хуанлийн өдөр (өнөөдрийг оруулаад); үнэлгээ = энэ хугацаанд «Ноорог»-т үнэлсэн ноорог.</p>`;
}

/** @param {boolean} [force] ачаалж байсан ч шинээр (хугацаа сольсон, «Шинэчлэх») — өмнөхийн үр дүнг үл тооно */
async function load(force = false) {
  if (!session.user || (loading && !force)) return;
  const g = ++gen;
  loading = true;
  setStatus(status, 'Ачаалж байна…', '');
  box.setAttribute('aria-busy', 'true');
  try {
    const ids = lastDays(days);
    // Үнэлгээний цонх = өдрийн баримтын цонх: эхний УБ өдрийн 00:00 (+08:00, DST-гүй) — аудит
    const since = new Date(`${ids[0]}T00:00:00+08:00`);
    const [daySnap, rateSnap, monthSnap] = await Promise.all([
      getDocs(query(collection(db, 'messenger_usage'), where(documentId(), '>=', ids[0]), where(documentId(), '<=', ids[ids.length - 1]))),
      getDocs(query(collection(db, 'messenger_drafts'), where('ratedAt', '>=', since), orderBy('ratedAt', 'desc'), limit(RATING_LIMIT))),
      getDoc(doc(db, 'messenger_usage', ubMonth())),
    ]);
    if (g !== gen || !session.user) return;
    // Сарын баримт («2026-11») ч энэ мужид орно — өдрийн id л
    const byDay = Object.fromEntries(daySnap.docs.filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.id)).map((s) => [s.id, s.data()]));
    const agg = aggregateDays(byDay, ids);
    const r = ratingStats(rateSnap.docs.map((s) => s.data()));
    const m = monthSnap.exists() ? monthSnap.data() : {};
    r.month = { costMicroUsd: Number(m.costMicroUsd) || 0 };
    render(agg, r);
    const at = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ulaanbaatar' });
    setStatus(status, `Шинэчиллээ (${at}).${rateSnap.docs.length >= RATING_LIMIT ? ` Сүүлийн ${RATING_LIMIT} үнэлгээгээр тооцов.` : ''}`, '');
  } catch (e) {
    if (g !== gen) return;
    box.innerHTML = '';
    setStatus(status, `${errText(e)} «Тойм»-ыг уншиж чадсангүй.`, 'err');
  } finally {
    if (g === gen) { loading = false; box.setAttribute('aria-busy', 'false'); }
  }
}

/** «Тойм» таб анх нээгдэхэд */
export function openOverview() {
  if (opened || !session.user) return;
  opened = true;
  load();
}
export function teardown() {
  gen++;
  opened = false; loading = false;
  box.innerHTML = '';
  setStatus(status, '', '');
}

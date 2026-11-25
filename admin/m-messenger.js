/* ==========================================================================
   SKIN AID admin — Модуль: Messenger AI (1-р үе шат: сүүдэр — үйлчлүүлэгч рүү юу ч илгээхгүй)
   «Ноорог»: AI-ийн бичсэн хариуны санал (messenger_drafts) → «Зөв / Засвартай / Буруу» үнэлгээ.
   «Тохиргоо»: горим (Унтраалттай / Сүүдэр), яаралтай зогсоох, сарын таг (messenger_settings/main + audit нэг batch-д),
   серверийн төлөв (messenger_status/main, messenger_usage/{сар} — сервер бичнэ).
   Квот: ноорог нэг удаад ≤ 30 read («Цааш ачаалах»), тохиргоо 3 read. Цэсийг нээх хүртэл юу ч уншихгүй.
   Хэрэглэгчийн/AI-ийн бүх текстийг esc()-ээр л гаргана (XSS).
   ========================================================================== */
import { collection, query, orderBy, limit, startAfter, getDocs, doc, getDoc, updateDoc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db, $, $$, esc, fmtDate, errText, session, setStatus } from './core.js?v=2c361933';
import { snack, announce, registerForm, refreshDirty, showErrors, clearErrors, clearFieldError, captureFocus } from './ui.js?v=70a601a4';
import { MODES, ROUTE_TONE, RATINGS, ratingLabel, ROLE_TEXT, CONFIG_ITEMS, normalizeSettings, parseCaps, auditId, ubMonth, FILTERS, draftMatches, usd } from './messenger-lib.js?v=83f823ad';

const PAGE = 30;
const CAP_TEXT = { runs: '100,000', usd: '1000' };
const tabList = $('#msTabs');
const tabs = $$('[role="tab"]', tabList);
const list = $('#msList'), meta = $('#msMeta'), more = $('#msMore'), chips = $('#msChips');
const form = $('#msForm'), errBox = $('#msErr'), status = $('#msSaveStatus'), btnSave = $('#btnMsSave'), btnStop = $('#btnMsStop');
const loadBox = $('#msLoad'), loadMsg = $('#msLoadMsg'), stateBox = $('#msState');

let opened = false;          // цэсийг анх нээх үед л уншина (квот)
let drafts = [];
let cursor = null;           // «Цааш ачаалах»-ын сүүлийн snapshot
let filter = 'all';
let loadingDrafts = false;
const noteDraft = new Map(); // id → хадгалаагүй тэмдэглэл
const ratingPick = new Map();// id → сонгосон (хадгалаагүй) үнэлгээ
const busy = new Set();

let saved = null;            // тохиргооны сүүлд уншсан/хадгалсан утга
let lastState = null;        // messenger_status/main, messenger_usage — таг хадгалахад дахин зурна
let lastUsage = { runs: 0, costMicroUsd: 0 };
let ready = false;
let saving = false;

/* ---------- Таб (WAI-ARIA tabs: сум, Home/End) ---------- */
function selectTab(name, focus = false) {
  tabs.forEach((t) => {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
    if (on && focus) t.focus();
  });
}
tabList.addEventListener('click', (e) => { const t = e.target.closest('[role="tab"]'); if (t) selectTab(t.dataset.tab); });
tabList.addEventListener('keydown', (e) => {
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  selectTab(tabs[(next + tabs.length) % tabs.length].dataset.tab, true);
});

/* ---------- Ноорог ---------- */
chips.innerHTML = FILTERS.map((f, i) => `<button class="chip${i === 0 ? ' is-active' : ''}" type="button" data-f="${f.key}" aria-pressed="${i === 0}">${esc(f.label)} <span data-n></span></button>`).join('');
chips.addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  filter = b.dataset.f;
  $$('.chip', chips).forEach((c) => { const on = c.dataset.f === filter; c.classList.toggle('is-active', on); c.setAttribute('aria-pressed', String(on)); });
  renderDrafts();
});

const turnHtml = (t) => `<li><span class="ms-who">${esc(ROLE_TEXT[t.role] || t.role)}</span> ${t.text ? esc(t.text) : `<em class="muted">(${esc((t.attachments || []).join(', ') || 'хоосон')})</em>`}</li>`;

function cardHtml(d) {
  const id = esc(d.id);
  const l = d.labels || {};
  const tone = ROUTE_TONE[d.route] || 'muted';
  const pick = ratingPick.has(d.id) ? ratingPick.get(d.id) : d.rating || '';
  const note = noteDraft.has(d.id) ? noteDraft.get(d.id) : d.note || '';
  const ctx = Array.isArray(d.context) ? d.context : [];
  const earlier = ctx.slice(0, -1);
  const reasons = (l.reasons || []).filter(Boolean);
  return `<article class="ms-card${d.rating ? ' is-rated' : ''}" data-id="${id}" aria-labelledby="msh-${id}">
    <header class="ms-card__head">
      <h3 id="msh-${id}" class="ms-card__title"><span class="ms-tone ms-tone--${tone}">${esc(l.route || d.route)}</span> ${esc(l.intent || d.intent || '')}</h3>
      <span class="muted">${esc(fmtDate(d.createdAt))}${d.rating ? ` · <strong class="ms-rated">Үнэлсэн: ${esc(ratingLabel(d.rating))}</strong>` : ''}</span>
    </header>
    <div class="ms-block"><span class="ms-label">Үйлчлүүлэгч</span><p class="ms-text">${d.userText ? esc(d.userText) : '<em class="muted">(текстгүй — зураг/файл)</em>'}</p></div>
    ${earlier.length ? `<details class="ms-ctx"><summary>Ярианы өмнөх хэсэг (${earlier.length})</summary><ol class="ms-turns">${earlier.map(turnHtml).join('')}</ol></details>` : ''}
    ${d.reply ? `<div class="ms-block ms-block--ai"><span class="ms-label">AI-ийн санал</span><p class="ms-text">${esc(d.reply)}</p></div>` : ''}
    ${d.wouldSend ? `<div class="ms-block ms-block--send"><span class="ms-label">Автомат горимд (3-р үе шат) илгээгдэх байсан</span><p class="ms-text">${esc(d.wouldSend)}</p></div>` : ''}
    <p class="ms-why">${reasons.length ? `Шалтгаан: ${reasons.map(esc).join('; ')}. ` : ''}${typeof d.confidence === 'number' ? `AI итгэл: ${Math.round(d.confidence * 100)}%. ` : ''}${d.aiReason ? `AI-ийн тайлбар: ${esc(d.aiReason)}` : ''}</p>
    <fieldset class="ms-rate" data-rate="${id}">
      <legend>Энэ ноорог зөв үү?</legend>
      <div class="ms-rate__opts">${RATINGS.map((r) => `<label class="ms-opt"><input type="radio" name="msr-${id}" value="${r.key}"${pick === r.key ? ' checked' : ''}> ${esc(r.label)}</label>`).join('')}</div>
      <div class="field">
        <label for="msn-${id}">${pick === 'edited' ? 'Зөв хариу <span class="req">*</span> <small>(AI-ийн оронд юу гэж хариулах байсан)</small>' : 'Тэмдэглэл <small>(заавал биш)</small>'}</label>
        <textarea id="msn-${id}" data-note="${id}" maxlength="2000" rows="2">${esc(note)}</textarea>
      </div>
      <div class="actions"><button class="btn btn--primary btn--sm" type="button" data-save="${id}"${busy.has(d.id) ? ' disabled' : ''}>Үнэлгээ хадгалах</button><span class="status" data-st="${id}" role="status"></span></div>
    </fieldset>
  </article>`;
}

function renderDrafts() {
  const shown = drafts.filter((d) => draftMatches(d, filter));
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, drafts.filter((d) => draftMatches(d, f.key)).length]));
  $$('.chip', chips).forEach((c) => { $('[data-n]', c).textContent = counts[c.dataset.f] ? `(${counts[c.dataset.f]})` : ''; });
  list.setAttribute('aria-busy', 'false');
  if (!drafts.length) {
    list.innerHTML = '<div class="empty"><p><strong>Ноорог алга.</strong></p><p class="muted">Meta апп холбогдож, горим «Сүүдэр» болсны дараа Messenger-т ирсэн асуулт бүрт AI ноорог энд гарна. Үйлчлүүлэгч рүү юу ч илгээгдэхгүй.</p></div>';
  } else {
    list.innerHTML = shown.length ? shown.map(cardHtml).join('') : '<div class="empty"><p class="muted">Энэ шүүлтэд ноорог алга.</p></div>';
  }
  meta.textContent = drafts.length ? `${drafts.length} ноорог ачаалсан${cursor ? '' : ' (бүгд)'} · үнэлээгүй ${counts.unrated}` : '';
}

async function loadDrafts(append = false) {
  if (loadingDrafts || !session.user) return;
  loadingDrafts = true;
  more.disabled = true;
  if (!append) { list.setAttribute('aria-busy', 'true'); meta.textContent = 'Ачаалж байна…'; }
  try {
    const parts = [collection(db, 'messenger_drafts'), orderBy('createdAt', 'desc')];
    if (append && cursor) parts.push(startAfter(cursor));
    parts.push(limit(PAGE));
    const snap = await getDocs(query(...parts));
    const rows = snap.docs.map((s) => ({ id: s.id, ...s.data() }));
    drafts = append ? [...drafts, ...rows] : rows;
    cursor = snap.docs.length === PAGE ? snap.docs[snap.docs.length - 1] : null;
    renderDrafts();
  } catch (e) {
    list.setAttribute('aria-busy', 'false');
    meta.textContent = '';
    list.innerHTML = `<div class="hm-load" role="alert">${esc(errText(e))} <button class="btn btn--outline btn--sm" type="button" data-retry>Дахин оролдох</button></div>`;
  } finally {
    loadingDrafts = false;
    more.hidden = !cursor;
    more.disabled = false;
  }
}
more.addEventListener('click', () => loadDrafts(true));
$('#btnMsReload').addEventListener('click', () => { loadDrafts(false); loadSettings(); });

list.addEventListener('click', (e) => {
  if (e.target.closest('[data-retry]')) { loadDrafts(false); return; }
  const b = e.target.closest('[data-save]');
  if (b) saveRating(b.dataset.save);
});
list.addEventListener('change', (e) => {
  const r = e.target.closest('input[type="radio"]');
  if (!r) return;
  const id = r.closest('[data-rate]').dataset.rate;
  ratingPick.set(id, r.value);
  // «Засвартай» → тэмдэглэлийн шошгыг «Зөв хариу (заавал)» болгоно (мөрийг дахин зурахгүй — фокус алдахгүй)
  const lbl = $(`label[for="msn-${CSS.escape(id)}"]`, list);
  if (lbl) lbl.innerHTML = r.value === 'edited' ? 'Зөв хариу <span class="req">*</span> <small>(AI-ийн оронд юу гэж хариулах байсан)</small>' : 'Тэмдэглэл <small>(заавал биш)</small>';
  refreshDirty();
});
list.addEventListener('input', (e) => {
  const t = e.target.closest('[data-note]');
  if (t) { noteDraft.set(t.dataset.note, t.value); refreshDirty(); }
});

async function saveRating(id) {
  const d = drafts.find((x) => x.id === id);
  if (!d || busy.has(id) || !session.user) return;
  const st = $(`[data-st="${CSS.escape(id)}"]`, list);
  const rating = ratingPick.has(id) ? ratingPick.get(id) : d.rating;
  const note = String(noteDraft.has(id) ? noteDraft.get(id) : d.note || '').trim().slice(0, 2000);
  if (!RATINGS.some((r) => r.key === rating)) { setStatus(st, '«Зөв», «Засвартай», «Буруу»-гийн нэгийг сонгоно уу.', 'err'); return; }
  if (rating === 'edited' && note.length < 2) {
    setStatus(st, '«Засвартай» гэж үнэлэхэд зөв хариуг бичнэ үү.', 'err');
    $(`#msn-${CSS.escape(id)}`, list)?.focus();
    return;
  }
  busy.add(id);
  const btn = $(`[data-save="${CSS.escape(id)}"]`, list);
  if (btn) btn.disabled = true;
  setStatus(st, 'Хадгалж байна…', '');
  try {
    await updateDoc(doc(db, 'messenger_drafts', id), { rating, note, ratedAt: serverTimestamp(), ratedBy: session.user.email });
    Object.assign(d, { rating, note, ratedAt: new Date(), ratedBy: session.user.email });
    ratingPick.delete(id);
    noteDraft.delete(id);
    busy.delete(id);
    renderDrafts();
    snack(`Үнэлгээ хадгалагдлаа: ${ratingLabel(rating)}`);
    // Дараагийн үнэлээгүй ноорог руу фокус (дараалан үнэлэхэд)
    const next = $('.ms-card:not(.is-rated) .ms-rate input[type="radio"]', list);
    if (next) next.focus();
  } catch (e) {
    busy.delete(id);
    if (btn) btn.disabled = false;
    setStatus(st, errText(e), 'err');
  } finally {
    refreshDirty();
  }
}

/* ---------- Тохиргоо ---------- */
$('#msModes').innerHTML = MODES.map((m) => `<label class="ms-mode"><input type="radio" name="ms-mode" value="${m.key}"> <span><strong>${esc(m.label)}</strong><small>${esc(m.hint)}</small></span></label>`).join('');

const readForm = () => ({
  mode: ($('input[name="ms-mode"]:checked', form) || {}).value || 'off',
  killSwitch: $('#ms-kill').checked,
  runs: $('#ms-runs').value,
  usd: $('#ms-usd').value,
});
const fill = (s) => {
  $$('input[name="ms-mode"]', form).forEach((r) => { r.checked = r.value === s.mode; });
  $('#ms-kill').checked = s.killSwitch;
  $('#ms-runs').value = String(s.monthlyRunCap);
  $('#ms-usd').value = String(s.monthlyCostCapUsd);
};
const asSettings = (v) => {
  const caps = parseCaps(v.runs, v.usd);
  return caps.error ? null : { mode: v.mode, killSwitch: v.killSwitch, monthlyRunCap: caps.runs, monthlyCostCapUsd: caps.usd };
};
const isDirty = () => {
  if (!ready || !saved) return false;
  const now = asSettings(readForm());
  return !now || JSON.stringify(now) !== JSON.stringify(saved);
};
const lockForm = (on) => { $$('.panel', form).forEach((p) => { p.inert = on; }); btnSave.disabled = on; btnStop.disabled = on; };
lockForm(true);

function renderState(st, usage, settings) {
  const cfg = (st && st.config) || null;
  const rows = CONFIG_ITEMS.map(([k, label]) => {
    const v = cfg ? cfg[k] : undefined;
    const ok = k === 'serverAuth' ? v === 'wif' || v === 'key' : v === true;
    return `<li class="${ok ? 'is-ok' : 'is-miss'}"><span aria-hidden="true">${ok ? '✓' : '—'}</span> ${esc(label)}<span class="sr-only">: ${ok ? 'тохируулсан' : 'тохируулаагүй'}</span></li>`;
  }).join('');
  const s = settings || saved || normalizeSettings(null);
  const err = st && st.lastError && st.lastError.code ? `<p class="ms-err">Сүүлийн алдаа: <code>${esc(st.lastError.code)}</code> · ${esc(fmtDate(st.lastError.at))}</p>` : '';
  stateBox.innerHTML = `
    ${!st ? '<p class="ms-banner">Сервер хараахан холбогдоогүй байна (Vercel-ийн тохиргоо, Firebase серверийн эрх эзэмшигчийн алхам — README «Messenger AI»). Тохиргоог одоо хадгалж болно; сервер холбогдмогц мөрдөнө.</p>' : ''}
    <dl class="ms-kv">
      <div><dt>Webhook сүүлд</dt><dd>${st && st.lastWebhookAt ? esc(fmtDate(st.lastWebhookAt)) : '—'}</dd></div>
      <div><dt>Өдрийн cron сүүлд</dt><dd>${st && st.lastCronAt ? esc(fmtDate(st.lastCronAt)) : '—'}</dd></div>
      <div><dt>Энэ сарын AI ажиллагаа</dt><dd>${usage.runs} / ${s.monthlyRunCap}</dd></div>
      <div><dt>Энэ сарын зардал</dt><dd>${esc(usd(usage.costMicroUsd))} / $${esc(String(s.monthlyCostCapUsd))}</dd></div>
    </dl>
    ${err}
    <details class="ms-cfg-wrap"><summary>Серверийн тохиргоо (Vercel env — утга биш, зөвхөн байгаа эсэх)</summary><ul class="ms-cfg">${cfg ? rows : '<li>Мэдээлэл алга</li>'}</ul></details>`;
}

async function loadSettings() {
  if (!session.user || saving) return;
  ready = false;
  lockForm(true);
  loadBox.hidden = true;
  setStatus(status, 'Ачаалж байна…', '');
  try {
    const [setSnap, stSnap, usSnap] = await Promise.all([
      getDoc(doc(db, 'messenger_settings', 'main')),
      getDoc(doc(db, 'messenger_status', 'main')),
      getDoc(doc(db, 'messenger_usage', ubMonth())),
    ]);
    const raw = setSnap.exists() ? setSnap.data() : null;
    saved = normalizeSettings(raw);
    fill(saved);
    clearErrors(form);
    const u = usSnap.exists() ? usSnap.data() : {};
    lastState = stSnap.exists() ? stSnap.data() : null;
    lastUsage = { runs: Number(u.runs) || 0, costMicroUsd: Number(u.costMicroUsd) || 0 };
    renderState(lastState, lastUsage, saved);
    renderBanner();
    ready = true;
    lockForm(false);
    setStatus(status, raw ? `Сүүлд хадгалсан: ${fmtDate(raw.updatedAt)} · ${raw.updatedBy || ''}` : 'Одоогоор хадгалсан тохиргоо алга — AI унтраалттай.', '');
  } catch (e) {
    setStatus(status, '', '');
    loadMsg.textContent = `${errText(e)} Тохиргоог уншиж чадаагүй тул засварлахыг түр хаалаа.`;
    loadBox.hidden = false;
  }
  refreshDirty();
}
$('#btnMsRetry').addEventListener('click', loadSettings);

/** Цэсийн дээд хэсгийн төлвийн мөр (AI одоо ажиллаж байгаа эсэх) */
function renderBanner() {
  const b = $('#msModeBanner');
  if (!saved) { b.hidden = true; return; }
  b.hidden = false;
  const on = saved.mode === 'shadow' && !saved.killSwitch;
  b.className = `ms-modebar ${on ? 'is-on' : 'is-off'}`;
  b.textContent = saved.killSwitch ? 'AI ЗОГСООСОН (яаралтай зогсоолт асаалттай).' : on ? 'AI сүүдэр горимд ажиллаж байна — ноорог бичнэ, үйлчлүүлэгч рүү юу ч илгээхгүй.' : 'AI унтраалттай — мессеж хадгалагдахгүй.';
  btnStop.hidden = saved.killSwitch;
}

async function persist(next) {
  const id = auditId();
  const batch = writeBatch(db);
  batch.set(doc(db, 'messenger_settings', 'main'), {
    mode: next.mode, killSwitch: next.killSwitch, monthlyRunCap: next.monthlyRunCap, monthlyCostCapUsd: next.monthlyCostCapUsd,
    lastAuditId: id, updatedAt: serverTimestamp(), updatedBy: session.user.email,
  });
  batch.set(doc(db, 'messenger_audit', id), {
    action: 'settings', by: session.user.email, at: serverTimestamp(),
    detail: { mode: next.mode, killSwitch: next.killSwitch, monthlyRunCap: next.monthlyRunCap, monthlyCostCapUsd: next.monthlyCostCapUsd },
  });
  await batch.commit();
}

async function save() {
  if (!session.user || saving) return;
  if (!ready) { snack('Тохиргоо ачаалагдаагүй тул хадгалах боломжгүй.', { error: true }); return; }
  const v = readForm();
  const caps = parseCaps(v.runs, v.usd);
  if (caps.error) {
    showErrors(errBox, [caps.error === 'runs'
      ? { msg: `Сарын ажиллагааны таг 0–${CAP_TEXT.runs} бүхэл тоо байна.`, el: $('#ms-runs') }
      : { msg: `Сарын зардлын таг $0–${CAP_TEXT.usd} (2 оронтой бутархай) байна.`, el: $('#ms-usd') }], form);
    return;
  }
  clearErrors(form);
  const next = { mode: v.mode, killSwitch: v.killSwitch, monthlyRunCap: caps.runs, monthlyCostCapUsd: caps.usd };
  const restore = captureFocus(form);
  saving = true;
  lockForm(true);
  setStatus(status, 'Хадгалж байна…', '');
  try {
    await persist(next);
    saved = next;
    fill(saved);
    renderBanner();
    renderState(lastState, lastUsage, saved);
    setStatus(status, 'Хадгалагдлаа — сервер дараагийн мессежээс мөрдөнө.', 'ok');
    snack('Messenger AI-ийн тохиргоо хадгалагдлаа');
  } catch (e) { setStatus(status, errText(e), 'err'); snack(errText(e), { error: true }); }
  finally { saving = false; lockForm(false); refreshDirty(); restore(btnSave); }
}

/** Яаралтай зогсоох: хадгалсан утга + killSwitch = true (маягтын хадгалаагүй өөрчлөлтийг хадгалахгүй) */
async function stopNow() {
  if (!session.user || saving || !ready || !saved || saved.killSwitch) return;
  saving = true;
  lockForm(true);
  setStatus(status, 'Зогсоож байна…', '');
  try {
    const next = { ...saved, killSwitch: true };
    await persist(next);
    saved = next;
    $('#ms-kill').checked = true;
    renderBanner();
    setStatus(status, 'AI зогслоо. Дахин асаахдаа «Яаралтай зогсоолт»-ыг унтрааж хадгална.', 'ok');
    announce('AI зогслоо');
  } catch (e) { setStatus(status, errText(e), 'err'); snack(errText(e), { error: true }); }
  finally { saving = false; lockForm(false); refreshDirty(); }
}
btnStop.addEventListener('click', stopNow);

form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
form.addEventListener('input', (e) => { clearFieldError(e.target); refreshDirty(); });
form.addEventListener('change', refreshDirty);
// Хадгалах мөр = зөвхөн тохиргоо (ноорогийн үнэлгээ карт бүр дээрээ хадгалагдана; хадгалаагүй тэмдэглэл санах ойд үлдэнэ)
registerForm('messenger', {
  isDirty,
  save,
  discard: () => { if (saving || !saved) return; fill(saved); clearErrors(form); refreshDirty(); },
  reset: () => { teardown(); },
  anchor: $('#msActions'),
});

/* ---------- Нээх / хаах ---------- */
function open() {
  if (opened || !session.user) return;
  opened = true;
  loadSettings();
  loadDrafts(false);
}
/** Нэвтэрсний дараа (admin.js) — цэс идэвхтэй бол шууд, эс бөгөөс анх нээх үед уншина */
export function load() {
  if (/^#\/messenger/.test(location.hash)) open();
}
window.addEventListener('hashchange', () => { if (/^#\/messenger/.test(location.hash)) open(); });
export function teardown() {
  opened = false; ready = false; saved = null; drafts = []; cursor = null; lastState = null; lastUsage = { runs: 0, costMicroUsd: 0 };
  ratingPick.clear(); noteDraft.clear(); busy.clear();
  lockForm(true);
  list.innerHTML = ''; meta.textContent = ''; more.hidden = true; stateBox.innerHTML = '';
  $('#msModeBanner').hidden = true;
  setStatus(status, '', '');
}

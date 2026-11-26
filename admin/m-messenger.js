/* ==========================================================================
   SKIN AID admin — Модуль: Messenger AI (сүүдэр — үйлчлүүлэгч рүү юу ч илгээхгүй)
   «Ноорог»: AI-ийн бичсэн хариуны санал (messenger_drafts) → «Зөв / Засвартай / Буруу» үнэлгээ → «Жишээ болгох».
   «Сургалт» (2-р үе шат): m-messenger-train.js — туршилтын асуулт, мэдлэг, жишээ, AI-д юу орж байна.
   «Тохиргоо»: горим (Унтраалттай / Сүүдэр), яаралтай зогсоох, сарын таг (messenger_settings/main + audit нэг batch-д),
   серверийн төлөв (messenger_status/main, messenger_usage/{сар} — сервер бичнэ).
   Квот: ноорог нэг удаад ≤ 30 read («Цааш ачаалах»), тохиргоо 3 read. Цэсийг нээх хүртэл юу ч уншихгүй.
   Хэрэглэгчийн/AI-ийн бүх текстийг esc()-ээр л гаргана (XSS).
   ========================================================================== */
import { collection, query, orderBy, limit, startAfter, getDocs, doc, getDoc, updateDoc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db, $, $$, esc, fmtDate, errText, session, setStatus } from './core.js?v=2c361933';
import { dialog, snack, announce, registerForm, refreshDirty, showErrors, clearErrors, clearFieldError, captureFocus } from './ui.js?v=8848d02a';
import { MODES, ROUTE_TONE, RATINGS, ratingLabel, ROLE_TEXT, CONFIG_ITEMS, normalizeSettings, parseCaps, auditId, ubMonth, FILTERS, draftMatches, usd, exampleIdForDraft } from './messenger-lib.js?v=b1c66c99';
import * as training from './m-messenger-train.js?v=e01063c5';

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
const cardErr = new Map();  // id → картын алдаа (дахин зурахад алга болохгүй)

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
  if (name === 'train') training.openTraining();
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

/** Үнэлсэн ноорог → жишээ: юу болохыг товчны дэргэд тайлбарлана */
const EX_HINT = {
  good: 'AI-ийн энэ хариу сайн жишээ болно.',
  edited: 'Таны бичсэн зөв хариу сайн жишээ болно.',
  wrong: 'AI-ийн энэ хариу муу жишээ болно (тэмдэглэл = яагаад буруу).',
};
/** Ноорогийн картын «Жишээ» мөр: боломжгүй бол юу ч үгүй; хуучирсан бол «шинэчлэх» */
function exampleRow(d) {
  const st = training.draftExampleState(d);
  if (st === 'none') return '';
  const id = esc(d.id);
  if (st === 'same') return `<div class="ms-exrow"><span class="ms-ex-done">✓ Жишээнд орсон</span> <button class="btn btn--ghost btn--sm" type="button" data-ex-edit="${id}">Жишээг засах</button></div>`;
  if (st === 'stale') return `<div class="ms-exrow"><span class="ms-ex-stale">Үнэлгээ өөрчлөгдсөн</span> <button class="btn btn--outline btn--sm" type="button" data-ex="${id}">Жишээг шинэчлэх</button></div>`;
  return `<div class="ms-exrow"><button class="btn btn--outline btn--sm" type="button" data-ex="${id}">Жишээ болгох</button> <small class="muted">${esc(EX_HINT[d.rating] || '')}</small></div>`;
}
/** Энэ картын үнэлгээ/тэмдэглэл ХАДГАЛСАН утгаас ялгаатай эсэх (утгаар — буцааж бичсэн бол зөрөхгүй) */
const cardDirty = (d) => (ratingPick.has(d.id) && ratingPick.get(d.id) !== (d.rating || ''))
  || (noteDraft.has(d.id) && noteDraft.get(d.id).trim() !== String(d.note || '').trim());

const noteLabel = (required) => (required ? 'Зөв хариу <span class="req">*</span> <small>(AI-ийн оронд юу гэж хариулах байсан)</small>' : 'Тэмдэглэл <small>(заавал биш)</small>');
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
  const err = cardErr.get(d.id) || '';
  const req = pick === 'edited';
  return `<article class="ms-card${d.rating ? ' is-rated' : ''}" data-id="${id}" aria-labelledby="msh-${id}">
    <header class="ms-card__head">
      <h2 id="msh-${id}" class="ms-card__title" tabindex="-1"><span class="ms-tone ms-tone--${tone}">${esc(l.route || d.route)}</span> ${esc(l.intent || d.intent || '')}</h2>
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
        <label for="msn-${id}">${noteLabel(req)}</label>
        <textarea id="msn-${id}" data-note="${id}" maxlength="2000" rows="2" aria-describedby="mss-${id}"${req ? ' aria-required="true"' : ''}${err && req ? ' aria-invalid="true"' : ''}>${esc(note)}</textarea>
      </div>
      <div class="actions"><button class="btn btn--primary btn--sm" type="button" data-save="${id}"${busy.has(d.id) ? ' disabled' : ''}>Үнэлгээ хадгалах</button><span class="status${err ? ' is-err' : ''}" id="mss-${id}" data-st="${id}" role="status">${esc(err)}</span></div>
    </fieldset>
    ${exampleRow(d)}
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
    // «Цааш ачаалах» дарсан бол (товч нуугдаж болно) шинээр нэмэгдсэн эхний карт руу фокус
    if (append && rows.length) {
      const h = $(`#msh-${CSS.escape(rows[0].id)}`, list);
      if (h) h.focus(); else meta.focus();
    }
  } catch (e) {
    list.setAttribute('aria-busy', 'false');
    if (append) {
      // Ачаалсан жагсаалтыг арилгахгүй — алдааг товчны дэргэд
      meta.textContent = `${errText(e)} «Цааш ачаалах»-ыг дахин дарна уу.`;
    } else {
      meta.textContent = '';
      list.innerHTML = `<div class="hm-load" role="alert">${esc(errText(e))} <button class="btn btn--outline btn--sm" type="button" data-retry>Дахин оролдох</button></div>`;
    }
  } finally {
    loadingDrafts = false;
    more.hidden = !cursor;
    more.disabled = false;
  }
}
more.addEventListener('click', () => loadDrafts(true));
$('#btnMsReload').addEventListener('click', async () => {
  if ((settingsDirty() || notesDirty() || training.isDirty()) && !(await dialog({ title: 'Хадгалаагүй өөрчлөлт байна', body: 'Дахин ачаалбал хадгалаагүй тохиргоо, үнэлгээний тэмдэглэл, мэдлэг/жишээний засвар алга болно.', confirm: 'Хадгалалгүй ачаалах', cancel: 'Болих', danger: true }))) return;
  ratingPick.clear(); noteDraft.clear(); cardErr.clear();
  const onTrain = !$('#msPanelTrain').hidden;
  training.teardown();
  loadDrafts(false); loadSettings();
  if (onTrain) training.openTraining(); else training.loadExamples().catch(() => {});
  refreshDirty();
});

list.addEventListener('click', async (e) => {
  if (e.target.closest('[data-retry]')) { loadDrafts(false); return; }
  const b = e.target.closest('[data-save]');
  if (b) { saveRating(b.dataset.save); return; }
  const x = e.target.closest('[data-ex]');
  if (x) {
    const d = drafts.find((r) => r.id === x.dataset.ex);
    // Хадгалаагүй үнэлгээтэй бол эхлээд хадгалуулна (жишээ нь ХАДГАЛСАН үнэлгээнээс үүснэ)
    if (d && cardDirty(d)) { showCardErr(d.id, 'Эхлээд «Үнэлгээ хадгалах» дарна уу.'); x.focus(); return; }
    // Урьдчилан бөглөсөн засварлагч «Сургалт» табд нээгдэнэ (хувийн мэдээллийг арилгаад хадгална)
    if (d) await training.exampleFromDraftAction(d, x);
    return;
  }
  const xe = e.target.closest('[data-ex-edit]');
  if (xe) training.editExample(exampleIdForDraft(xe.dataset.exEdit), xe);
});
list.addEventListener('change', (e) => {
  const r = e.target.closest('input[type="radio"]');
  if (!r) return;
  const id = r.closest('[data-rate]').dataset.rate;
  ratingPick.set(id, r.value);
  // «Засвартай» → тэмдэглэлийн шошгыг «Зөв хариу (заавал)» болгоно (мөрийг дахин зурахгүй — фокус алдахгүй)
  const lbl = $(`label[for="msn-${CSS.escape(id)}"]`, list);
  if (lbl) lbl.innerHTML = noteLabel(r.value === 'edited');
  const ta = $(`#msn-${CSS.escape(id)}`, list);
  if (ta) {
    if (r.value === 'edited') ta.setAttribute('aria-required', 'true');
    else { ta.removeAttribute('aria-required'); ta.removeAttribute('aria-invalid'); }
  }
  refreshDirty();
});
list.addEventListener('input', (e) => {
  const t = e.target.closest('[data-note]');
  if (t) { noteDraft.set(t.dataset.note, t.value); refreshDirty(); }
});

// Await-ийн дараа жагсаалт дахин зурагдсан байж болно — элементийг үргэлж шинээр хайна
const elOf = (id, sel) => $(sel.split('ID').join(CSS.escape(id)), list);
const showCardErr = (id, msg) => {
  if (msg) cardErr.set(id, msg);
  else cardErr.delete(id);
  const st = elOf(id, '[data-st="ID"]');
  if (st) setStatus(st, msg, msg ? 'err' : '');
  const ta = elOf(id, '#msn-ID');
  if (ta && ta.getAttribute('aria-required') === 'true') {
    if (msg) ta.setAttribute('aria-invalid', 'true');
    else ta.removeAttribute('aria-invalid');
  }
};

async function saveRating(id) {
  const d = drafts.find((x) => x.id === id);
  if (!d || busy.has(id) || !session.user) return;
  const rating = ratingPick.has(id) ? ratingPick.get(id) : d.rating;
  const note = String(noteDraft.has(id) ? noteDraft.get(id) : d.note || '').trim().slice(0, 2000);
  if (!RATINGS.some((r) => r.key === rating)) {
    showCardErr(id, '«Зөв», «Засвартай», «Буруу»-гийн нэгийг сонгоно уу.');
    elOf(id, '.ms-card[data-id="ID"] .ms-rate input[type="radio"]')?.focus();
    return;
  }
  if (rating === 'edited' && note.length < 2) {
    showCardErr(id, '«Засвартай» гэж үнэлэхэд зөв хариуг бичнэ үү.');
    elOf(id, '#msn-ID')?.focus();
    return;
  }
  busy.add(id);
  showCardErr(id, '');
  const btn0 = elOf(id, '[data-save="ID"]');
  if (btn0) btn0.disabled = true;
  const st0 = elOf(id, '[data-st="ID"]');
  if (st0) setStatus(st0, 'Хадгалж байна…', '');
  try {
    await updateDoc(doc(db, 'messenger_drafts', id), { rating, note, ratedAt: serverTimestamp(), ratedBy: session.user.email });
    Object.assign(d, { rating, note, ratedAt: new Date(), ratedBy: session.user.email });
    ratingPick.delete(id);
    noteDraft.delete(id);
    busy.delete(id);
    renderDrafts();
    snack(`Үнэлгээ хадгалагдлаа: ${ratingLabel(rating)}`);
    // Энэ картын ДАРААХ үнэлээгүй ноорог руу фокус; байхгүй бол энэ картын гарчиг (фокус body руу унахгүй)
    const cards = $$('.ms-card', list);
    const at = cards.findIndex((c) => c.dataset.id === id);
    const next = cards.slice(at + 1).find((c) => !c.classList.contains('is-rated'));
    const target = next ? $('.ms-rate input[type="radio"]', next) : elOf(id, '#msh-ID');
    if (target) target.focus();
    else meta.focus();
  } catch (e) {
    busy.delete(id);
    const btn = elOf(id, '[data-save="ID"]');
    if (btn) btn.disabled = false;
    showCardErr(id, errText(e));
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
const settingsDirty = () => {
  if (!ready || !saved) return false;
  const now = asSettings(readForm());
  return !now || JSON.stringify(now) !== JSON.stringify(saved);
};
/** Хадгалаагүй үнэлгээ/тэмдэглэл (сонгосон ч хадгалаагүй) — гарах, хаах үед анхааруулна */
const notesDirty = () => {
  const byId = new Map(drafts.map((d) => [d.id, d]));
  for (const [id, r] of ratingPick) if (r !== ((byId.get(id) || {}).rating || '')) return true;
  for (const [id, n] of noteDraft) if (n.trim() !== ((byId.get(id) || {}).note || '').trim()) return true;
  return false;
};
const isDirty = () => settingsDirty() || notesDirty() || training.isDirty();
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
    ${!st ? '<p class="ms-banner">Сервер хараахан холбогдоогүй байна. Vercel болон Google Cloud-ийн тохиргоог (нууц түлхүүр, Firebase-ийн эрх) хийсний дараа энд төлөв гарна. Тохиргоог одоо хадгалж болно — сервер холбогдмогц мөрдөнө.</p>' : ''}
    <dl class="ms-kv">
      <div><dt>Webhook сүүлд</dt><dd>${st && st.lastWebhookAt ? esc(fmtDate(st.lastWebhookAt)) : '—'}</dd></div>
      <div><dt>Өдрийн cron сүүлд</dt><dd>${st && st.lastCronAt ? esc(fmtDate(st.lastCronAt)) : '—'}</dd></div>
      <div><dt>Энэ сард AI хариу бичсэн</dt><dd>${usage.runs} / ${s.monthlyRunCap}</dd></div>
      <div><dt>Энэ сарын зардал</dt><dd>${esc(usd(usage.costMicroUsd))} / $${esc(String(s.monthlyCostCapUsd))}</dd></div>
    </dl>
    ${err}
    <details class="ms-cfg-wrap"><summary>Серверийн тохиргоо (нууц түлхүүрүүд — утга биш, зөвхөн тавьсан эсэх)</summary><ul class="ms-cfg">${cfg ? rows : '<li>Мэдээлэл алга</li>'}</ul></details>`;
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
    // Хадгалах мөр / Ctrl+S «Ноорог» таб дээрээс дарагдсан байж болно — алдааг харагдах табд гаргана
    selectTab('settings');
    showErrors(errBox, [caps.error === 'runs'
      ? { msg: `Сард AI хариу бичих хязгаар 0–${CAP_TEXT.runs} бүхэл тоо байна.`, el: $('#ms-runs') }
      : { msg: `Сарын зардлын хязгаар $0–${CAP_TEXT.usd} байна (жишээ: 49.99).`, el: $('#ms-usd') }], form);
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
  finally {
    saving = false;
    lockForm(false);
    refreshDirty();
    // Товч нуугдсан (inert → hidden) — фокус body руу унахгүй: зогсоолтын switch руу
    $('#ms-kill').focus();
  }
}
btnStop.addEventListener('click', stopNow);

form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
form.addEventListener('input', (e) => { clearFieldError(e.target); refreshDirty(); });
form.addEventListener('change', refreshDirty);
// Хадгалах мөр: тохиргоог хадгална; хадгалаагүй үнэлгээ байвал тэр карт руу аваачна (үнэлгээ карт бүр дээрээ хадгалагдана).
// isDirty нь үнэлгээг ч тооцно — гарах/хаахад анхааруулга гарна.
registerForm('messenger', {
  isDirty,
  // Харагдаж буй табын маягтыг ЭХЛЭЭД хадгална (Сургалт таб дээр Ctrl+S = мэдлэг/жишээ)
  save: async () => {
    const onTrain = !$('#msPanelTrain').hidden;
    if (onTrain && training.isDirty()) await training.save();
    else if (settingsDirty()) await save();
    else if (training.isDirty()) { selectTab('train'); await training.save(); }
    else if (notesDirty()) {
      selectTab('drafts');
      const id = [...ratingPick.keys(), ...noteDraft.keys()].find((k) => $(`[data-save="${CSS.escape(k)}"]`, list));
      const b = id && $(`[data-save="${CSS.escape(id)}"]`, list);
      if (b) { b.scrollIntoView({ block: 'center' }); b.focus(); }
      snack('Үнэлгээг картын «Үнэлгээ хадгалах» товчоор хадгална.');
    }
  },
  discard: () => {
    if (saving) return false;
    if (training.discard() === false) { snack('Хадгалалт дуусаагүй байна — дуусахыг хүлээнэ үү.'); return false; }
    if (saved) fill(saved);
    ratingPick.clear(); noteDraft.clear(); cardErr.clear();
    clearErrors(form); renderDrafts(); refreshDirty();
  },
  reset: () => { teardown(); },
  // Таб бүрийн «Хадгалах» мөр — харагдаж байвал доод хадгалах мөрийг давхар гаргахгүй
  anchors: [$('#msActions'), $('#msKbActions'), $('#msExActions')],
});

/* ---------- Нээх / хаах ---------- */
/** Жишээ нэмэгдсэн/устсан: зөвхөн картуудын «Жишээ» мөрийг шинэчилнэ (тэмдэглэл бичиж буй textarea-ийн фокус алдагдахгүй) */
function refreshExampleRows() {
  for (const d of drafts) {
    const card = $(`.ms-card[data-id="${CSS.escape(d.id)}"]`, list);
    if (!card) continue;
    const old = $('.ms-exrow', card);
    const had = old && old.contains(document.activeElement);
    const html = exampleRow(d);
    if (old) old.remove();
    if (html) card.insertAdjacentHTML('beforeend', html);
    if (had) $('.ms-exrow button', card)?.focus();
  }
}
training.initTraining({ selectTab, onExamplesChange: refreshExampleRows, onDirty: () => refreshDirty() });
function open() {
  if (opened || !session.user) return;
  opened = true;
  loadSettings();
  loadDrafts(false);
  // Ноорогийн карт «Жишээнд орсон»-ыг харуулахад (≤ 100 read); алдаа гарвал карт товчтой хэвээр
  training.loadExamples().catch(() => {});
}
/** Нэвтэрсний дараа (admin.js) — цэс идэвхтэй бол шууд, эс бөгөөс анх нээх үед уншина */
export function load() {
  if (/^#\/messenger/.test(location.hash)) open();
}
window.addEventListener('hashchange', () => { if (/^#\/messenger/.test(location.hash)) open(); });
export function teardown() {
  opened = false; ready = false; saved = null; drafts = []; cursor = null; lastState = null; lastUsage = { runs: 0, costMicroUsd: 0 };
  ratingPick.clear(); noteDraft.clear(); busy.clear(); cardErr.clear();
  training.teardown();
  selectTab('drafts');
  lockForm(true);
  list.innerHTML = ''; meta.textContent = ''; more.hidden = true; stateBox.innerHTML = '';
  $('#msModeBanner').hidden = true;
  setStatus(status, '', '');
}

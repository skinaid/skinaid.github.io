/* ==========================================================================
   SKIN AID admin — Модуль: Messenger AI (сүүдэр: ноорог л; «Автомат»: зөвшөөрсөн сэдэвт сервер шууд хариулна)
   «Ноорог»: AI-ийн бичсэн хариуны санал (messenger_drafts) → «Зөв / Засвартай / Буруу» үнэлгээ → «Жишээ болгох»;
   «Автомат» горимд илгээсэн эсэх (sendStatus — сервер бичнэ), «Туршилтын акаунт болгох».
   «Сургалт» (2-р үе шат): m-messenger-train.js — туршилтын асуулт, мэдлэг, жишээ, AI-д юу орж байна.
   «Тохиргоо»: горим (Унтраалттай / Сүүдэр / Автомат), «Автомат»-ын үзэгчид (туршилтын акаунт / бүгд), яаралтай зогсоох,
   сарын таг (messenger_settings/main + audit нэг transaction-д), туршилтын акаунтын жагсаалт (шууд хадгалагдана),
   серверийн төлөв (messenger_status/main, messenger_usage/{сар} — сервер бичнэ). Admin өөрөө үйлчлүүлэгч рүү ЮУ Ч илгээхгүй.
   Квот: ноорог нэг удаад ≤ 30 read («Цааш ачаалах»), тохиргоо 3 read. Цэсийг нээх хүртэл юу ч уншихгүй.
   Хэрэглэгчийн/AI-ийн бүх текстийг esc()-ээр л гаргана (XSS).
   ========================================================================== */
import { collection, query, orderBy, limit, startAfter, getDocs, doc, getDoc, updateDoc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db, $, $$, esc, fmtDate, errText, session, setStatus } from './core.js?v=2c361933';
import { dialog, snack, announce, registerForm, refreshDirty, showErrors, clearErrors, clearFieldError, captureFocus } from './ui.js?v=4ec734c0';
import { MODES, AUDIENCES, TEST_THREADS_MAX, ROUTE_TONE, RATINGS, ratingLabel, ROLE_TEXT, CONFIG_ITEMS, normalizeSettings, parseCaps, auditId, ubMonth, FILTERS, draftMatches, usd, exampleIdForDraft, AUTO_STOP_TEXT, isThreadId, shortThread, isLiveThread, toggleTestThread, sendBadge, sendReasonText, metaTokenText } from './messenger-lib.js?v=29e907a6';
import * as training from './m-messenger-train.js?v=94fe5d6f';
import * as overview from './m-messenger-overview.js?v=e527ee86';
import { api } from './messenger-api.js?v=0b2bcc8e';

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
let savedBy = null;          // тохиргоог сүүлд хэн хадгалсан ('system' = автомат зогсолт)
let savedAuditId = null;     // ачаалсан тохиргооны lastAuditId — хадгалахад өөрчлөгдсөн эсэхийг шалгана (автомат зогсолт)
let loadedAt = 0;            // тохиргоог сүүлд уншсан мөч (хуудсанд буцаж ирэхэд дахин унших)
let crisisTimer = 0;         // хямралын шалгалтыг хоцроож дахин илгээх (сервер 30 с-д ≤ 1)
let sessionGen = 0;          // teardown бүрт нэмэгдэнэ — гарсны дараах async үр дүнг үл тооно
/** Тохиргоо ачаалснаас хойш өөр газар өөрчлөгдсөн (систем автоматаар зогсоосон, өөр таб) */
const STALE = 'settings_stale';
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
  if (name === 'overview') overview.openOverview();
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

/**
 * Картын «илгээлт» мөр: илгээсэн эсэх (сервер бичсэн sendStatus) + энэ ярианы «Туршилтын акаунт» товч.
 * Тохиргоо ачаалагдаагүй бол товчгүй (loadSettings дууссаны дараа refreshSendRows дахин зурна).
 */
function sendRow(d) {
  const b = sendBadge(d, d.sentAt ? fmtDate(d.sentAt) : '');
  const tid = isThreadId(d.threadId) ? d.threadId : '';
  const isTest = Boolean(tid && saved && saved.testThreads.includes(tid));
  const liveNow = Boolean(tid && saved && isLiveThread(saved, tid));
  const btn = tid && saved
    ? `<button class="btn btn--ghost btn--sm" type="button" data-tt="${esc(tid)}">${isTest ? 'Туршилтын акаунтаас хасах' : 'Туршилтын акаунт болгох'}</button>`
    : '';
  const tag = isTest ? `<span class="ms-tone ms-tone--info">Туршилтын акаунт${liveNow ? ' · AI шууд хариулна' : ''}</span>` : '';
  if (!b && !btn && !tag) return '';
  return `<div class="ms-sendline">${b ? `<span class="ms-tone ms-tone--${b.tone}">${esc(b.text)}</span>` : ''}${tag}${btn}</div>`;
}

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
    ${d.wouldSend ? `<div class="ms-block ms-block--send"><span class="ms-label">${d.sendStatus === 'sent' ? 'Үйлчлүүлэгчид илгээсэн текст' : '«Автомат» горимд илгээгдэх байсан текст'}</span><p class="ms-text">${esc(d.wouldSend)}</p></div>` : ''}
    ${!d.wouldSend && d.contact ? `<div class="ms-block"><span class="ms-label">Систем хариуны доор нэмэх мөр (утас, имэйлийг AI биш, код бичнэ)</span><p class="ms-text">${esc(d.contact)}</p></div>` : ''}
    ${sendRow(d)}
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
    list.innerHTML = '<div class="empty"><p><strong>Ноорог алга.</strong></p><p class="muted">Meta апп холбогдож, горим «Сүүдэр» эсвэл «Автомат» болсны дараа Messenger-т ирсэн асуулт бүрт AI ноорог энд гарна. «Сүүдэр» горимд үйлчлүүлэгч рүү юу ч илгээгдэхгүй.</p></div>';
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
  // Eval явж байвал: анхааруулаад хагас тайланг хадгалуулна (аудит: өмнө нь чимээгүй орхигддог байв)
  const busy = training.busyText();
  if (busy) {
    if (!(await dialog({ title: 'Eval явж байна', body: busy, confirm: 'Зогсоогоод ачаалах', cancel: 'Болих', danger: true }))) return;
    await training.abandonEval();
  }
  ratingPick.clear(); noteDraft.clear(); cardErr.clear();
  const onTrain = !$('#msPanelTrain').hidden;
  const onOverview = !$('#msPanelOverview').hidden;
  training.teardown();
  overview.teardown();
  loadDrafts(false); loadSettings();
  if (onTrain) training.openTraining(); else training.loadExamples().catch(() => {});
  if (onOverview) overview.openOverview();
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
  if (xe) { training.editExample(exampleIdForDraft(xe.dataset.exEdit), xe); return; }
  const tt = e.target.closest('[data-tt]');
  if (tt) changeTestThread(tt.dataset.tt, 'card');
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
    // «Буруу» олширвол AI-г автоматаар зогсооно (сервер шалгана — crisis.js); сервер алга бол чимээгүй
    if (rating === 'wrong') crisisCheck();
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
$('#msAudiences').innerHTML = AUDIENCES.map((a) => `<label class="ms-mode"><input type="radio" name="ms-aud" value="${a.key}"> <span><strong>${esc(a.label)}</strong><small>${esc(a.hint)}</small></span></label>`).join('');
const audBox = $('#msAudience'), audWarn = $('#msAudWarn'), ttList = $('#msTestThreads'), ttStatus = $('#msTestStatus');

const readForm = () => ({
  mode: ($('input[name="ms-mode"]:checked', form) || {}).value || 'off',
  audience: ($('input[name="ms-aud"]:checked', form) || {}).value === 'all' ? 'all' : 'test',
  killSwitch: $('#ms-kill').checked,
  runs: $('#ms-runs').value,
  usd: $('#ms-usd').value,
});
/** «Автомат» сонгосон үед л үзэгчдийн сонголт харагдана; сонголтоос хамаарсан анхааруулга */
function syncAudience() {
  const v = readForm();
  const auto = v.mode === 'auto';
  audBox.hidden = !auto;
  const n = saved ? saved.testThreads.length : 0;
  const msg = !auto ? ''
    : v.audience === 'all' ? 'Анхаар: пэйж рүү бичсэн ХҮН БҮРД AI шууд хариулна. Өмнө нь туршилтын акаунтаар шалгаж, Meta Business Suite-ийн автомат хариуг (Instant reply, Away message, FAQ) унтраасан байх ёстой — эс бөгөөс үйлчлүүлэгч хоёр хариу авна.'
      : n ? '' : 'Туршилтын акаунт алга — хадгалсан ч AI хэнд ч шууд хариулахгүй. Доорх «Туршилтын акаунт» хэсгийн зааврыг үзнэ үү.';
  audWarn.textContent = msg;
  audWarn.hidden = !msg;
}
const fill = (s) => {
  $$('input[name="ms-mode"]', form).forEach((r) => { r.checked = r.value === s.mode; });
  $$('input[name="ms-aud"]', form).forEach((r) => { r.checked = r.value === s.autoAudience; });
  $('#ms-kill').checked = s.killSwitch;
  $('#ms-runs').value = String(s.monthlyRunCap);
  $('#ms-usd').value = String(s.monthlyCostCapUsd);
  syncAudience();
};
/** Маягт → тохиргоо. Туршилтын акаунтын жагсаалт маягтын хэсэг БИШ (шууд хадгалагддаг) — хадгалсан утгаас авна.
 *  Талбарын дараалал = normalizeSettings (settingsDirty JSON-оор харьцуулна). */
const asSettings = (v) => {
  const caps = parseCaps(v.runs, v.usd);
  return caps.error ? null : { mode: v.mode, killSwitch: v.killSwitch, monthlyRunCap: caps.runs, monthlyCostCapUsd: caps.usd, autoAudience: v.audience, testThreads: saved ? [...saved.testThreads] : [] };
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
  const sendErr = st && st.lastSendError && st.lastSendError.kind ? `<p class="ms-err">Сүүлийн илгээлтийн алдаа: ${esc(sendReasonText(st.lastSendError.kind))}${st.lastSendError.code ? ` <code>${esc(String(st.lastSendError.code))}${st.lastSendError.subcode ? `/${esc(String(st.lastSendError.subcode))}` : ''}</code>` : ''} · ${esc(fmtDate(st.lastSendError.at))}</p>` : '';
  stateBox.innerHTML = `
    ${!st ? '<p class="ms-banner">Сервер хараахан холбогдоогүй байна. Vercel болон Google Cloud-ийн тохиргоог (нууц түлхүүр, Firebase-ийн эрх) хийсний дараа энд төлөв гарна. Тохиргоог одоо хадгалж болно — сервер холбогдмогц мөрдөнө.</p>' : ''}
    <dl class="ms-kv">
      <div><dt>Webhook сүүлд</dt><dd>${st && st.lastWebhookAt ? esc(fmtDate(st.lastWebhookAt)) : '—'}</dd></div>
      <div><dt>Өдрийн cron сүүлд</dt><dd>${st && st.lastCronAt ? esc(fmtDate(st.lastCronAt)) : '—'}</dd></div>
      <div><dt>Энэ сард AI хариу бичсэн</dt><dd>${usage.runs} / ${s.monthlyRunCap}</dd></div>
      <div><dt>Энэ сарын зардал</dt><dd>${esc(usd(usage.costMicroUsd))} / $${esc(String(s.monthlyCostCapUsd))}</dd></div>
      <div><dt>Пэйжийн token (илгээхэд)</dt><dd>${cfg && cfg.metaPageToken === true ? esc(metaTokenText(st && st.metaToken)) : 'тохируулаагүй — «Автомат» горим илгээж чадахгүй'}</dd></div>
    </dl>
    ${err}${sendErr}
    <details class="ms-cfg-wrap"><summary>Серверийн тохиргоо (нууц түлхүүрүүд — утга биш, зөвхөн тавьсан эсэх)</summary><ul class="ms-cfg">${cfg ? rows : '<li>Мэдээлэл алга</li>'}</ul></details>`;
}

/**
 * «Буруу» үнэлгээний дараах хямралын шалгалт. Сервер инстанст 30 с-д ≤ 1 шалгадаг тул хоцорсон бол (throttled) НЭГ удаа
 * дахин илгээнэ — дараалсан «Буруу» алгасагдахгүй (аудит).
 */
function crisisCheck() {
  const g = sessionGen;
  api('crisis_check').then((r) => {
    if (g !== sessionGen || !session.user) return;
    if (r && r.throttled) {
      if (!crisisTimer) crisisTimer = setTimeout(() => { crisisTimer = 0; if (g === sessionGen && session.user) crisisCheck(); }, Math.min(Math.max(Number(r.retryAfterMs) || 31_000, 1000), 35_000));
      return;
    }
    if (r && r.trip && r.stopped) {
      snack(`AI автоматаар зогслоо: ${AUTO_STOP_TEXT[r.reason] || r.reason}. «Тохиргоо»-оос шалгаад дахин асаана уу.`, { error: true });
      refreshAfterStop(g);
    }
  }).catch(() => {});
}
/** Автомат зогсолтын дараа: хадгалаагүй засвар байвал маягтыг дарахгүй — зөвхөн хадгалсан утга, тууз, зогсоолтын switch */
async function refreshAfterStop(g) {
  if (!settingsDirty()) { loadSettings(); return; }
  try {
    const [setSnap, stSnap] = await Promise.all([getDoc(doc(db, 'messenger_settings', 'main')), getDoc(doc(db, 'messenger_status', 'main'))]);
    if (g !== sessionGen || !session.user) return;
    const raw = setSnap.exists() ? setSnap.data() : null;
    saved = normalizeSettings(raw);
    savedBy = raw && typeof raw.updatedBy === 'string' ? raw.updatedBy : null;
    savedAuditId = raw && typeof raw.lastAuditId === 'string' ? raw.lastAuditId : null;
    lastState = stSnap.exists() ? stSnap.data() : lastState;
    $('#ms-kill').checked = saved.killSwitch;
    renderBanner();
    renderTestThreads();
    refreshSendRows();
    syncAudience();
    refreshDirty();
    snack('Таны хадгалаагүй тохиргоо хэвээр, харин «Яаралтай зогсоолт» асаалттай болсон — шалгаад хадгална уу.');
  } catch (_) { /* дараагийн ачаалалт */ }
}

async function loadSettings() {
  if (!session.user || saving) return;
  const g = sessionGen;
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
    if (g !== sessionGen) return;
    const raw = setSnap.exists() ? setSnap.data() : null;
    saved = normalizeSettings(raw);
    savedBy = raw && typeof raw.updatedBy === 'string' ? raw.updatedBy : null;
    savedAuditId = raw && typeof raw.lastAuditId === 'string' ? raw.lastAuditId : null;
    loadedAt = Date.now();
    fill(saved);
    clearErrors(form);
    const u = usSnap.exists() ? usSnap.data() : {};
    lastState = stSnap.exists() ? stSnap.data() : null;
    lastUsage = { runs: Number(u.runs) || 0, costMicroUsd: Number(u.costMicroUsd) || 0 };
    renderState(lastState, lastUsage, saved);
    renderBanner();
    renderTestThreads();
    refreshSendRows();
    ready = true;
    lockForm(false);
    const who = raw && raw.updatedBy === 'system' ? 'систем (автомат зогсолт)' : (raw && raw.updatedBy) || '';
    setStatus(status, raw ? `Сүүлд хадгалсан: ${fmtDate(raw.updatedAt)} · ${who}` : 'Одоогоор хадгалсан тохиргоо алга — AI унтраалттай.', '');
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
  const on = saved.mode !== 'off' && !saved.killSwitch;
  b.className = `ms-modebar ${on ? 'is-on' : 'is-off'}`;
  const auto = saved.killSwitch && savedBy === 'system' ? (lastState && lastState.autoStop) || {} : null;
  const n = saved.testThreads.length;
  const live = saved.autoAudience === 'all' ? 'AI АВТОМАТ горимд — БҮХ үйлчлүүлэгчид шууд хариулж байна (эрсдэлтэй сэдэв, зургийг ажилтанд шилжүүлнэ).'
    : n ? `AI АВТОМАТ горимд — туршилтын ${n} акаунтад шууд хариулж байна. Бусад үйлчлүүлэгчид юу ч илгээхгүй (сүүдэр хэвээр).`
      : 'AI «Автомат» горимд боловч туршилтын акаунт алга — хэнд ч илгээхгүй (сүүдэртэй адил ноорог л бичнэ).';
  b.textContent = auto
    ? `AI-Г СИСТЕМ АВТОМАТААР ЗОГСООСОН: ${AUTO_STOP_TEXT[auto.reason] || 'хямралын шалгуур'}${auto.at ? ` (${fmtDate(auto.at)})` : ''}. Шалгаад «Тохиргоо»-оос яаралтай зогсоолтыг унтрааж хадгална уу.`
    : saved.killSwitch ? 'AI ЗОГСООСОН (яаралтай зогсоолт асаалттай).' : !on ? 'AI унтраалттай — мессеж хадгалагдахгүй.'
      : saved.mode === 'auto' ? live : 'AI сүүдэр горимд ажиллаж байна — ноорог бичнэ, үйлчлүүлэгч рүү юу ч илгээхгүй.';
  btnStop.hidden = saved.killSwitch;
}

/**
 * Тохиргоо + audit — НЭГ transaction. Ачаалснаас хойш тохиргоо өөрчлөгдсөн бол (lastAuditId зөрсөн: систем автоматаар
 * зогсоосон, өөр таб) ХАДГАЛАХГҮЙ — хуучин маягт автомат зогсолтыг чимээгүй дарж AI-г дахин асаахгүй (аудит).
 */
async function persist(next, { stop = false } = {}) {
  const id = auditId();
  const ref = doc(db, 'messenger_settings', 'main');
  let written = next;
  let changed = false;
  await runTransaction(db, async (tx) => {
    const cur = await tx.get(ref);
    const curData = cur.exists() ? cur.data() : null;
    const curAudit = curData && typeof curData.lastAuditId === 'string' ? curData.lastAuditId : null;
    changed = curAudit !== savedAuditId;
    // «Яаралтай зогсоох» үргэлж аюулгүй тал: өөр газраас өөрчлөгдсөн байсан ч татгалзахгүй — ОДООГИЙН утган дээр зогсооно
    // (баталгаажуулах аудит); ердийн хадгалалт хуучирсан бол цуцлагдана
    if (stop) written = { ...normalizeSettings(changed ? curData : next), killSwitch: true };
    else if (changed) throw Object.assign(new Error(STALE), { code: STALE });
    // Бичих утгыг ҮРГЭЛЖ цэвэрлэнэ (горим, үзэгчид, туршилтын акаунтын жагсаалт — rules-тэй ижил хэлбэр)
    written = normalizeSettings(written);
    const core = {
      mode: written.mode, killSwitch: written.killSwitch, monthlyRunCap: written.monthlyRunCap, monthlyCostCapUsd: written.monthlyCostCapUsd,
      autoAudience: written.autoAudience, testThreads: [...written.testThreads],
    };
    tx.set(ref, { ...core, lastAuditId: id, updatedAt: serverTimestamp(), updatedBy: session.user.email });
    // Audit-ийн detail = хадгалсан тохиргоо (rules тулгана): хэн, хэзээ «Автомат» асаасан, хэнийг туршилтын акаунт болгосон
    tx.set(doc(db, 'messenger_audit', id), { action: 'settings', by: session.user.email, at: serverTimestamp(), detail: { ...core, testThreads: [...core.testThreads] } });
  });
  savedAuditId = id;
  return { written, changed };
}

/* ---------- «Автомат» горим: туршилтын акаунт ---------- */
function renderTestThreads() {
  const rows = saved ? saved.testThreads : [];
  ttList.innerHTML = rows.length
    ? rows.map((t, i) => `<li class="ms-tt"><span>Туршилтын акаунт ${i + 1} <code>${esc(shortThread(t))}…</code></span><button class="btn btn--outline btn--sm" type="button" data-tt-del="${esc(t)}" aria-label="Туршилтын акаунт ${i + 1}-ийг хасах">Хасах</button></li>`).join('')
    : '<li class="muted">Туршилтын акаунт алга.</li>';
}
/** Тохиргоо/жагсаалт өөрчлөгдөхөд картуудын «илгээлт» мөрийг л дахин зурна (тэмдэглэл бичиж буй textarea-д хүрэхгүй) */
function refreshSendRows() {
  for (const d of drafts) {
    const card = $(`.ms-card[data-id="${CSS.escape(d.id)}"]`, list);
    if (!card) continue;
    const old = $('.ms-sendline', card);
    const had = old && old.contains(document.activeElement);
    const html = sendRow(d);
    if (old) old.remove();
    if (html) $('.ms-why', card).insertAdjacentHTML('beforebegin', html);
    if (had) ($('.ms-sendline button', card) || $('.ms-card__title', card))?.focus();
  }
}
/**
 * Туршилтын акаунт нэмэх/хасах — ШУУД хадгална (хадгалсан тохиргоо + шинэ жагсаалт; маягтын хадгалаагүй өөрчлөлтийг
 * хадгалахгүй). Нэмэхэд баталгаажуулна: буруу хүнийг (жинхэнэ үйлчлүүлэгч) туршилтын акаунт болговол AI түүнд шууд хариулна.
 * @param {string} threadId @param {'card'|'list'} from
 */
async function changeTestThread(threadId, from) {
  if (!session.user || saving) return;
  if (!ready || !saved) { snack('Тохиргоо ачаалагдаагүй байна — түр хүлээгээд дахин оролдоно уу.', { error: true }); return; }
  const adding = !saved.testThreads.includes(threadId);
  const next = toggleTestThread(saved.testThreads, threadId);
  if (!next) { snack(`Туршилтын акаунт ${TEST_THREADS_MAX}-аас ихгүй байна. Эхлээд «Тохиргоо» табаас нэгийг хасна уу.`, { error: true }); return; }
  if (adding && !(await dialog({
    title: 'Туршилтын акаунт болгох уу?',
    body: ['Энэ яриа ТАНЫ ӨӨРИЙН эсвэл ажилтны акаунт мөн үү? Жинхэнэ үйлчлүүлэгчийн яриаг бүү сонгоорой.', '«Автомат» горим «Зөвхөн туршилтын акаунт»-аар асаалттай үед AI энэ ярианд шууд хариулна.'],
    confirm: 'Туршилтын акаунт болгох', cancel: 'Болих', safe: true,
  }))) return;
  if (!session.user || saving || !ready || !saved) return;
  saving = true;
  lockForm(true);
  setStatus(ttStatus, 'Хадгалж байна…', '');
  try {
    const r = await persist({ ...saved, testThreads: next });
    saved = r.written;
    savedBy = session.user.email;
    renderBanner();
    renderTestThreads();
    refreshSendRows();
    syncAudience();
    setStatus(ttStatus, adding ? 'Туршилтын акаунт нэмэгдлээ.' : 'Туршилтын акаунтаас хасагдлаа.', 'ok');
    snack(adding ? 'Туршилтын акаунт нэмэгдлээ' : 'Туршилтын акаунтаас хаслаа');
  } catch (e) {
    if (e && e.code === STALE) { setStatus(ttStatus, '', ''); await onStale(); return; }
    setStatus(ttStatus, errText(e), 'err'); snack(errText(e), { error: true });
  } finally {
    saving = false;
    lockForm(!ready);
    refreshDirty();
    // Жагсаалтаас хассан бол товч алга болсон — фокус body руу унахгүй
    if (from === 'list') ($('button', ttList) || $('#msTestHead'))?.focus();
  }
}
ttList.addEventListener('click', (e) => { const b = e.target.closest('[data-tt-del]'); if (b) changeTestThread(b.dataset.ttDel, 'list'); });
const STALE_TEXT = 'Тохиргоо таныг ачаалснаас хойш өөрчлөгдсөн байна (систем AI-г автоматаар зогсоосон эсвэл өөр цонхноос хадгалсан). Шинэ утгыг ачааллаа — шалгаад дахин хадгална уу.';
/** Хуучирсан маягт: хадгалалтыг цуцалж, шинэ утгыг ачаална */
async function onStale() {
  saving = false;
  await loadSettings();
  setStatus(status, STALE_TEXT, 'err');
  snack(STALE_TEXT, { error: true });
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
  const next = { mode: v.mode, killSwitch: v.killSwitch, monthlyRunCap: caps.runs, monthlyCostCapUsd: caps.usd, autoAudience: v.audience, testThreads: saved ? [...saved.testThreads] : [] };
  // «Автомат» асаах, эсвэл бүх үйлчлүүлэгчид нээх — үйлчлүүлэгч рүү жинхэнэ мессеж явна: баталгаажуулна
  // «Асаалттай» = горим «Автомат» БА яаралтай зогсоолтгүй: зогсоолтыг унтрааж дахин асаах нь ч мөн адил баталгаажна
  const wasAuto = Boolean(saved && saved.mode === 'auto' && !saved.killSwitch);
  const wasAll = wasAuto && saved.autoAudience === 'all';
  const willAuto = next.mode === 'auto' && !next.killSwitch;
  if (willAuto && next.autoAudience === 'all' && !wasAll) {
    if (!(await dialog({
      title: 'БҮХ үйлчлүүлэгчид шууд хариулах уу?',
      body: 'Хадгалмагц AI пэйж рүү бичсэн хүн бүрд зөвшөөрсөн сэдвээр шууд хариулж эхэлнэ.',
      list: ['Туршилтын акаунтаар шалгаж, хариу зөв байсан', 'Meta Business Suite-ийн автомат хариуг (Instant reply, Away message, FAQ) унтраасан', 'Ажилтнууд «ажилтанд дамжууллаа» гэсэн яриаг Meta Inbox-оос хариулахаа мэдэж байгаа'],
      confirm: 'Бүгдэд нээх', cancel: 'Болих', danger: true,
    }))) return;
  } else if (willAuto && !wasAuto) {
    const n = next.testThreads.length;
    if (!(await dialog({
      title: '«Автомат» горимыг асаах уу?',
      body: [n ? `AI туршилтын ${n} акаунтад Messenger-ээр шууд хариулж эхэлнэ. Бусад үйлчлүүлэгчид юу ч илгээхгүй.` : 'Туршилтын акаунт алга тул AI одоохондоо хэнд ч илгээхгүй. Ноорогийн картаас «Туршилтын акаунт болгох»-ыг дарсны дараа тэр акаунтад шууд хариулна.',
        'Эмнэлгийн асуулт, гаж нөлөө, гомдол, мөнгө, зураг/видеод AI хариулахгүй — «ажилтанд дамжууллаа» гэж мэдэгдээд тэр ярианд чимээгүй болно.'],
      confirm: '«Автомат» асаах', cancel: 'Болих', safe: true,
    }))) return;
  }
  if (!session.user || saving || !ready) return;
  const restore = captureFocus(form);
  saving = true;
  lockForm(true);
  setStatus(status, 'Хадгалж байна…', '');
  try {
    const r = await persist(next);
    saved = r.written;
    savedBy = session.user.email;
    fill(saved);
    renderBanner();
    renderTestThreads();
    refreshSendRows();
    renderState(lastState, lastUsage, saved);
    setStatus(status, 'Хадгалагдлаа — сервер дараагийн мессежээс мөрдөнө.', 'ok');
    snack('Messenger AI-ийн тохиргоо хадгалагдлаа');
  } catch (e) {
    if (e && e.code === STALE) { await onStale(); return; }
    setStatus(status, errText(e), 'err'); snack(errText(e), { error: true });
  } finally { saving = false; lockForm(!ready); refreshDirty(); restore(btnSave); }
}

/** Яаралтай зогсоох: хадгалсан утга + killSwitch = true (маягтын хадгалаагүй өөрчлөлтийг хадгалахгүй) */
async function stopNow() {
  if (!session.user || saving || !ready || !saved || saved.killSwitch) return;
  saving = true;
  lockForm(true);
  setStatus(status, 'Зогсоож байна…', '');
  try {
    const r = await persist({ ...saved, killSwitch: true }, { stop: true });
    saved = r.written;
    savedBy = session.user.email;
    // Тохиргоо өөр газраас өөрчлөгдсөн байсан бол маягтыг шинэ утгаар (эс бөгөөс хадгалаагүй засвар хэвээр)
    if (r.changed) fill(saved);
    $('#ms-kill').checked = true;
    renderBanner();
    renderTestThreads();
    refreshSendRows();
    syncAudience();
    renderState(lastState, lastUsage, saved);
    setStatus(status, 'AI зогслоо. Дахин асаахдаа «Яаралтай зогсоолт»-ыг унтрааж хадгална.', 'ok');
    announce('AI зогслоо');
  } catch (e) { setStatus(status, errText(e), 'err'); snack(errText(e), { error: true }); }
  finally {
    saving = false;
    lockForm(!ready);
    refreshDirty();
    // Товч нуугдсан (inert → hidden) — фокус body руу унахгүй: зогсоолтын switch руу
    $('#ms-kill').focus();
  }
}
btnStop.addEventListener('click', stopNow);

form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
form.addEventListener('input', (e) => { clearFieldError(e.target); refreshDirty(); });
form.addEventListener('change', (e) => { if (e.target.matches('input[name="ms-mode"], input[name="ms-aud"]')) syncAudience(); refreshDirty(); });
// Хадгалах мөр: тохиргоог хадгална; хадгалаагүй үнэлгээ байвал тэр карт руу аваачна (үнэлгээ карт бүр дээрээ хадгалагдана).
// isDirty нь үнэлгээг ч тооцно — гарах/хаахад анхааруулга гарна.
registerForm('messenger', {
  isDirty,
  // Eval явж байхад гарах/хаахад анхааруулна (хадгалах мөр гаргахгүй)
  busy: () => training.busyText(),
  leave: () => training.abandonEval(),
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
overview.initOverview({ getMonth: () => ({ usage: lastUsage, settings: saved }) });
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
// Хуудсанд буцаж ирэхэд (≥ 1 мин) тохиргоог дахин уншина — систем автоматаар зогсоосныг харуулна (засвар хийгээгүй бол)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !opened || !ready || saving || !session.user) return;
  if (Date.now() - loadedAt < 60_000 || settingsDirty()) return;
  loadSettings();
});
export function teardown() {
  sessionGen++;
  if (crisisTimer) { clearTimeout(crisisTimer); crisisTimer = 0; }
  savedAuditId = null; loadedAt = 0;
  opened = false; ready = false; saved = null; drafts = []; cursor = null; lastState = null; lastUsage = { runs: 0, costMicroUsd: 0 };
  ratingPick.clear(); noteDraft.clear(); busy.clear(); cardErr.clear();
  training.teardown();
  overview.teardown();
  savedBy = null;
  selectTab('drafts');
  lockForm(true);
  list.innerHTML = ''; meta.textContent = ''; more.hidden = true; stateBox.innerHTML = '';
  ttList.innerHTML = ''; audBox.hidden = true; setStatus(ttStatus, '', '');
  $('#msModeBanner').hidden = true;
  setStatus(status, '', '');
}

/* ==========================================================================
   SKIN AID admin — Messenger AI → «Сургалт» (2-р үе шат). m-messenger.js импортолж холбоно (initTraining).
   · Туршилтын асуулт — POST /api/admin {action:'test'} (Firebase ID token): ноорогтой ижил хариу, хадгалахгүй, илгээхгүй.
   · Мэдлэг (messenger_kb: FAQ, бодлого; тусгай id «voice» = брэнд дуу хоолой) — ноорог / нийтэлсэн.
   · Жишээ (messenger_examples: сайн/муу) — ноорогоос нэг товчоор (exampleFromDraftAction) эсвэл гараар.
   · AI-д юу орж байна — POST /api/admin {action:'knowledge'} (LLM-гүй).
   Firestore-д ЗӨВХӨН rules-ийн зөвшөөрсөн талбар (title/body/status, userText/reply/kind/note + updatedAt/updatedBy).
   Квот: таб анх нээхэд ≤ 100 + 100 read. Бүх текстийг esc()-ээр (XSS).
   ========================================================================== */
import { collection, query, limit, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db, $, $$, esc, fmtDate, errText, session, setStatus, msOf } from './core.js?v=2c361933';
import { dialog, snack, announce, showErrors, clearErrors, clearFieldError, attachCounters, refreshCounters } from './ui.js?v=70a601a4';
import {
  ROUTE_TONE, usd, KB_LIMITS, KB_VOICE_ID, KB_VOICE_TITLE, KB_STATUS, EX_KINDS, kbStatusLabel, exKindLabel, newKbId, newExampleId,
  exampleIdForDraft, validateKb, validateExample, exampleFromDraft, sortKb, apiErrorText, EXCLUDE_TEXT,
} from './messenger-lib.js?v=0b39c3fd';

const READ_LIMIT = 100;
const loadBox = $('#msTrLoad'), loadMsg = $('#msTrLoadMsg');
const tryForm = $('#msTryForm'), tryText = $('#ms-try'), tryDrafts = $('#ms-try-drafts'), tryBtn = $('#btnMsTry'), tryStatus = $('#msTryStatus'), tryOut = $('#msTryOut');
const kbForm = $('#msKbForm'), kbErr = $('#msKbErr'), kbTitle = $('#ms-kb-title'), kbBody = $('#ms-kb-body'), kbList = $('#msKbList'), kbMeta = $('#msKbMeta'), kbStatusEl = $('#msKbSaveStatus');
const exForm = $('#msExForm'), exErr = $('#msExErr'), exUser = $('#ms-ex-user'), exReply = $('#ms-ex-reply'), exNote = $('#ms-ex-note'), exList = $('#msExList'), exMeta = $('#msExMeta'), exStatusEl = $('#msExSaveStatus');
const knowOut = $('#msKnowOut'), knowStatus = $('#msKnowStatus');

/** m-messenger.js-ийн callback (таб солих, ноорогийн картыг дахин зурах) */
let deps = { selectTab: () => {}, onExamplesChange: () => {}, onDirty: () => {} };
export function initTraining(d) { deps = { ...deps, ...d }; }

const kb = new Map();          // id → { id, title, body, status, updatedAt, updatedBy }
const ex = new Map();          // id → { id, kind, userText, reply, note, updatedAt, updatedBy }
let kbReady = false, exReady = false, opened = false, loading = null;
let kbEdit = null;             // { id, isNew, snap }
let exEdit = null;             // { id, isNew, snap }
let saving = false, trying = false;
let lastTry = null;            // { result, run }

/* ---------- Сервер (/api/admin) ---------- */
const codeErr = (code, body) => Object.assign(new Error(code), { apiCode: code, body });
async function api(action, payload = {}) {
  if (!session.user) throw codeErr('unauthorized');
  let token;
  try { token = await session.user.getIdToken(); } catch (_) { throw codeErr('unauthorized'); }
  let res;
  try {
    res = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, ...payload }), cache: 'no-store' });
  } catch (_) { throw codeErr('network'); }
  let j = null;
  try { j = await res.json(); } catch (_) { j = null; }
  if (!j || typeof j !== 'object') throw codeErr(res.status === 404 || res.status === 405 ? 'no_server' : 'server_error');
  if (!res.ok || !j.ok) throw codeErr(typeof j.error === 'string' ? j.error : 'server_error', j);
  return j;
}
const apiMsg = (e) => (e && e.apiCode ? apiErrorText(e.apiCode) : errText(e));

/* ---------- Ачаалах ---------- */
async function loadCol(name, into) {
  const snap = await getDocs(query(collection(db, name), limit(READ_LIMIT)));
  into.clear();
  snap.docs.forEach((s) => into.set(s.id, { id: s.id, ...s.data() }));
  return snap.docs.length;
}
/** Жишээний жагсаалт (ноорогийн карт «Жишээнд орсон»-ыг харуулахад ч) */
export function loadExamples() {
  return loadCol('messenger_examples', ex).then(() => { exReady = true; renderEx(); deps.onExamplesChange(); });
}
function load() {
  if (loading) return loading;
  loadBox.hidden = true;
  kbMeta.textContent = 'Ачаалж байна…';
  exMeta.textContent = 'Ачаалж байна…';
  loading = Promise.all([loadCol('messenger_kb', kb).then(() => { kbReady = true; }), loadExamples()])
    .then(() => { renderKb(); renderEx(); })
    .catch((e) => {
      kbMeta.textContent = ''; exMeta.textContent = '';
      loadMsg.textContent = `${errText(e)} Мэдлэг, жишээг уншиж чадсангүй.`;
      loadBox.hidden = false;
      opened = false;
    })
    .finally(() => { loading = null; });
  return loading;
}
$('#btnMsTrRetry').addEventListener('click', () => { opened = true; load(); });
/** «Сургалт» таб анх нээгдэхэд (m-messenger.js) */
export function openTraining() {
  if (opened || !session.user) return;
  opened = true;
  load();
}
export const hasExample = (id) => ex.has(id);
export const examplesReady = () => exReady;

/* ---------- Туршилтын асуулт ---------- */
const block = (label, text, cls = '') => (text ? `<div class="ms-block ${cls}"><span class="ms-label">${esc(label)}</span><p class="ms-text">${esc(text)}</p></div>` : '');
function tryHtml(r, run) {
  const l = r.labels || {};
  const tone = ROUTE_TONE[r.route] || 'muted';
  const reasons = (l.reasons || []).filter(Boolean);
  const cache = run.cacheReadTokens ? ` · кэш ${Math.round((100 * run.cacheReadTokens) / Math.max(1, run.cacheReadTokens + run.inputTokens + run.cacheWriteTokens))}%` : '';
  const src = (r.sourceIds || []).length ? `Иш: ${r.sourceIds.map(esc).join(', ')}. ` : '';
  return `<article class="ms-card" aria-labelledby="msTryResH">
    <header class="ms-card__head">
      <h3 id="msTryResH" class="ms-card__title" tabindex="-1"><span class="ms-tone ms-tone--${tone}">${esc(l.route || r.route)}</span> ${esc(l.intent || r.intent || '')}</h3>
      <span class="muted">${esc(usd(run.costMicroUsd))} · ${esc(String(Math.round((run.durationMs || 0) / 100) / 10))} с${esc(cache)}</span>
    </header>
    ${block('Үйлчлүүлэгч (нууцалсан)', r.userText)}
    ${block('AI-ийн санал', r.reply, 'ms-block--ai')}
    ${block('Автомат горимд илгээгдэх байсан', r.wouldSend, 'ms-block--send')}
    <p class="ms-why">${reasons.length ? `Шалтгаан: ${reasons.map(esc).join('; ')}. ` : ''}${typeof r.confidence === 'number' ? `AI итгэл: ${Math.round(r.confidence * 100)}%. ` : ''}${src}${r.aiReason ? `AI-ийн тайлбар: ${esc(r.aiReason)}` : ''}</p>
    <div class="actions"><button class="btn btn--outline btn--sm" type="button" data-try-ex="good">Сайн жишээ болгох</button><button class="btn btn--outline btn--sm" type="button" data-try-ex="bad">Муу жишээ болгох</button></div>
  </article>`;
}
async function runTry() {
  if (trying || !session.user) return;
  const text = tryText.value.trim();
  if (!text) {
    tryText.setAttribute('aria-invalid', 'true');
    setStatus(tryStatus, 'Үйлчлүүлэгчийн мессежийг бичнэ үү.', 'err');
    tryText.focus();
    return;
  }
  tryText.removeAttribute('aria-invalid');
  trying = true;
  tryBtn.disabled = true;
  setStatus(tryStatus, 'AI бичиж байна… (10–30 секунд)', '');
  tryOut.setAttribute('aria-busy', 'true');
  try {
    const j = await api('test', { text, includeDrafts: tryDrafts.checked });
    lastTry = { result: j.result, run: j.run };
    tryOut.innerHTML = tryHtml(j.result, j.run);
    setStatus(tryStatus, `Бэлэн. Өнөөдөр ${j.testsToday}/${j.testsLimit} туршилт.`, 'ok');
    $('#msTryResH', tryOut)?.focus();
  } catch (e) {
    lastTry = null;
    tryOut.innerHTML = '';
    setStatus(tryStatus, apiMsg(e), 'err');
    announce(apiMsg(e), true);
  } finally {
    trying = false;
    tryBtn.disabled = false;
    tryOut.setAttribute('aria-busy', 'false');
  }
}
attachCounters(tryForm);
tryForm.addEventListener('submit', (e) => { e.preventDefault(); runTry(); });
tryText.addEventListener('input', () => { if (tryText.hasAttribute('aria-invalid')) { tryText.removeAttribute('aria-invalid'); setStatus(tryStatus, '', ''); } });
tryOut.addEventListener('click', (e) => {
  const b = e.target.closest('[data-try-ex]');
  if (!b || !lastTry) return;
  const r = lastTry.result;
  openEx(null, { kind: b.dataset.tryEx, userText: r.userText || '', reply: r.reply || '', note: '' }, b.dataset.tryEx === 'bad' ? exNote : exReply);
});

/* ---------- Мэдлэг (messenger_kb) ---------- */
$('#msKbStatus').innerHTML = KB_STATUS.map((s) => `<label class="ms-mode"><input type="radio" name="ms-kb-status" value="${s.key}"> <span><strong>${esc(s.label)}</strong><small>${esc(s.hint)}</small></span></label>`).join('');
const excerpt = (s, n) => { const a = Array.from(String(s || '').replace(/\s+/g, ' ').trim()); return a.length > n ? `${a.slice(0, n).join('')}…` : a.join(''); };
const meta = (r) => `${esc(fmtDate(r.updatedAt))}${r.updatedBy ? ` · ${esc(r.updatedBy)}` : ''}`;

function renderKb() {
  const rows = sortKb([...kb.values()]);
  const pub = rows.filter((r) => r.status === 'published' && r.id !== KB_VOICE_ID).length;
  kbMeta.textContent = kbReady ? (rows.length ? `${rows.length} бичлэг · нийтэлсэн ${pub}${rows.length >= READ_LIMIT ? ` (эхний ${READ_LIMIT})` : ''}` : '') : '';
  kbList.innerHTML = !kbReady ? '' : rows.length ? rows.map((r) => {
    const voice = r.id === KB_VOICE_ID;
    const title = voice ? KB_VOICE_TITLE : r.title;
    return `<li class="ms-item${kbEdit && kbEdit.id === r.id ? ' is-editing' : ''}" data-id="${esc(r.id)}">
      <div class="ms-item__body">
        <p class="ms-item__title"><span class="ms-tone ms-tone--${r.status === 'published' ? 'ok' : 'muted'}">${esc(kbStatusLabel(r.status) || r.status)}</span> <strong>${esc(title)}</strong></p>
        <p class="ms-item__text">${esc(excerpt(r.body, 240))}</p>
        <p class="ms-item__meta muted">${meta(r)}</p>
      </div>
      <div class="ms-item__act">
        <button class="btn btn--outline btn--sm" type="button" data-kb-edit="${esc(r.id)}" aria-label="Засах: ${esc(title)}">Засах</button>
        <button class="btn btn--danger-ghost btn--sm" type="button" data-kb-del="${esc(r.id)}" aria-label="Устгах: ${esc(title)}">Устгах</button>
      </div>
    </li>`;
  }).join('') : '<li class="empty"><p><strong>Мэдлэг алга.</strong></p><p class="muted">«Шинэ мэдлэг»-ээр түгээмэл асуулт, бодлогоо нэмнэ үү. Одоо AI зөвхөн сайтын каталогийг мэднэ.</p></li>';
}

const readKb = () => ({
  title: kbEdit && kbEdit.id === KB_VOICE_ID ? KB_VOICE_TITLE : kbTitle.value.trim(),
  body: kbBody.value.trim(),
  status: ($('input[name="ms-kb-status"]:checked', kbForm) || {}).value || '',
});
const kbDirty = () => !!kbEdit && JSON.stringify(readKb()) !== kbEdit.snap;
function openKb(id, { voice = false } = {}) {
  const cur = id ? kb.get(id) : voice ? kb.get(KB_VOICE_ID) : null;
  const realId = id || (voice ? KB_VOICE_ID : newKbId());
  const isVoice = realId === KB_VOICE_ID;
  kbEdit = { id: realId, isNew: !cur, snap: '' };
  $('#msKbFormH').textContent = isVoice ? KB_VOICE_TITLE : cur ? 'Мэдлэг засах' : 'Шинэ мэдлэг';
  $('#msKbTitleField').hidden = isVoice;
  kbTitle.value = isVoice ? KB_VOICE_TITLE : cur ? cur.title || '' : '';
  kbBody.value = cur ? cur.body || '' : '';
  $('#ms-kb-body-l').textContent = isVoice ? 'Өнгө аяс, хэллэг, нэмэлт заавар' : 'Агуулга';
  $('#ms-kb-body-hint').textContent = isVoice
    ? 'Жишээ: «Найрсаг, товч, мэргэжлийн. "Та" хэлбэрээр. Захиалгыг сайтаар хийхийг санал болго.» Хатуу дүрмийг (эмнэлгийн зөвлөгөө өгөхгүй, үнэ зохиохгүй) өөрчилж чадахгүй.'
    : 'AI энэ текстийг баримт болгон иш татна. Товч, тодорхой бичнэ үү. Утас, имэйл бүү бич.';
  const st = cur ? cur.status : 'draft';
  $$('input[name="ms-kb-status"]', kbForm).forEach((r) => { r.checked = r.value === st; });
  kbEdit.snap = JSON.stringify(readKb());
  clearErrors(kbForm);
  setStatus(kbStatusEl, '', '');
  kbForm.hidden = false;
  attachCounters(kbForm);
  refreshCounters(kbForm);
  renderKb();
  kbForm.scrollIntoView({ block: 'start' });
  (isVoice ? kbBody : kbTitle).focus({ preventScroll: true });
  deps.onDirty();
}
async function closeKb({ force = false } = {}) {
  if (!force && kbDirty() && !(await dialog({ title: 'Хадгалаагүй өөрчлөлт байна', body: 'Мэдлэгийн засварыг хадгалахгүй хаах уу?', confirm: 'Хадгалалгүй хаах', cancel: 'Үлдэх', danger: true }))) return false;
  const id = kbEdit && kbEdit.id;
  kbEdit = null;
  kbForm.hidden = true;
  clearErrors(kbForm);
  renderKb();
  const btn = id && $(`[data-kb-edit="${CSS.escape(id)}"]`, kbList);
  (btn || $('#btnMsKbNew')).focus();
  deps.onDirty();
  return true;
}
async function saveKb() {
  if (!kbEdit || saving || !session.user) return;
  const v = readKb();
  const errs = validateKb(v);
  if (errs.length) {
    const el = { title: kbTitle, body: kbBody, status: $('input[name="ms-kb-status"]', kbForm) };
    showErrors(kbErr, errs.map((e) => ({ msg: e.msg, el: el[e.field] })), kbForm);
    return;
  }
  clearErrors(kbForm);
  saving = true;
  const id = kbEdit.id;
  $$('button', kbForm).forEach((b) => { b.disabled = true; });
  setStatus(kbStatusEl, 'Хадгалж байна…', '');
  try {
    const data = { title: v.title.slice(0, KB_LIMITS.title), body: v.body, status: v.status, updatedAt: serverTimestamp(), updatedBy: session.user.email };
    await setDoc(doc(db, 'messenger_kb', id), data);
    kb.set(id, { id, ...data, updatedAt: new Date() });
    kbEdit.snap = JSON.stringify(readKb());
    await closeKb({ force: true });
    snack(v.status === 'published' ? 'Мэдлэг нийтлэгдлээ — AI 5 минутын дотор ашиглана' : 'Мэдлэг ноорог хэлбэрээр хадгалагдлаа');
  } catch (e) {
    setStatus(kbStatusEl, errText(e), 'err');
    snack(errText(e), { error: true });
  } finally {
    saving = false;
    $$('button', kbForm).forEach((b) => { b.disabled = false; });
    deps.onDirty();
  }
}
async function delKb(id) {
  const r = kb.get(id);
  if (!r || saving) return;
  const title = id === KB_VOICE_ID ? KB_VOICE_TITLE : r.title;
  if (!(await dialog({ title: 'Мэдлэг устгах уу?', body: [`«${title}» бүр мөсөн устгагдана. AI 5 минутын дотор ашиглахаа болино.`, 'Түр нуух бол «Засах» → «Ноорог» болгож хадгална уу.'], confirm: 'Устгах', cancel: 'Болих', danger: true }))) return;
  saving = true;
  try {
    await deleteDoc(doc(db, 'messenger_kb', id));
    kb.delete(id);
    if (kbEdit && kbEdit.id === id) { kbEdit = null; kbForm.hidden = true; }
    renderKb();
    snack(`«${title}» устгагдлаа`);
    $('#btnMsKbNew').focus();
  } catch (e) { snack(errText(e), { error: true }); }
  finally { saving = false; deps.onDirty(); }
}
$('#btnMsKbNew').addEventListener('click', async () => { if (kbEdit && !(await closeKb())) return; openKb(null); });
$('#btnMsVoice').addEventListener('click', async () => { if (kbEdit && !(await closeKb())) return; openKb(null, { voice: true }); });
$('#btnMsKbCancel').addEventListener('click', () => closeKb());
kbForm.addEventListener('submit', (e) => { e.preventDefault(); saveKb(); });
kbForm.addEventListener('input', (e) => { clearFieldError(e.target); deps.onDirty(); });
kbForm.addEventListener('change', () => deps.onDirty());
kbList.addEventListener('click', async (e) => {
  const ed = e.target.closest('[data-kb-edit]');
  if (ed) { if (kbEdit && kbEdit.id !== ed.dataset.kbEdit && !(await closeKb())) return; openKb(ed.dataset.kbEdit); return; }
  const del = e.target.closest('[data-kb-del]');
  if (del) delKb(del.dataset.kbDel);
});

/* ---------- Жишээ (messenger_examples) ---------- */
$('#msExKinds').innerHTML = EX_KINDS.map((k) => `<label class="ms-mode"><input type="radio" name="ms-ex-kind" value="${k.key}"> <span><strong>${esc(k.label)}</strong><small>${esc(k.hint)}</small></span></label>`).join('');

function renderEx() {
  const ms = (v) => msOf(v) ?? (v instanceof Date ? v.getTime() : 0);
  const rows = [...ex.values()].sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt));
  const good = rows.filter((r) => r.kind === 'good').length;
  exMeta.textContent = exReady && rows.length ? `${rows.length} жишээ · сайн ${good}, муу ${rows.length - good}${rows.length >= READ_LIMIT ? ` (эхний ${READ_LIMIT})` : ''}` : '';
  exList.innerHTML = !exReady ? '' : rows.length ? rows.map((r) => `<li class="ms-item${exEdit && exEdit.id === r.id ? ' is-editing' : ''}" data-id="${esc(r.id)}">
      <div class="ms-item__body">
        <p class="ms-item__title"><span class="ms-tone ms-tone--${r.kind === 'good' ? 'ok' : 'warn'}">${esc(exKindLabel(r.kind) || r.kind)}</span> <strong>${esc(excerpt(r.userText, 120))}</strong></p>
        ${r.reply ? `<p class="ms-item__text"><span class="ms-who">Хариу:</span> ${esc(excerpt(r.reply, 220))}</p>` : ''}
        ${r.note ? `<p class="ms-item__text"><span class="ms-who">Тайлбар:</span> ${esc(excerpt(r.note, 160))}</p>` : ''}
        <p class="ms-item__meta muted">${meta(r)}${/^x_/.test(r.id) ? ' · ноорогоос' : ''}</p>
      </div>
      <div class="ms-item__act">
        <button class="btn btn--outline btn--sm" type="button" data-ex-edit="${esc(r.id)}" aria-label="Засах: ${esc(excerpt(r.userText, 60))}">Засах</button>
        <button class="btn btn--danger-ghost btn--sm" type="button" data-ex-del="${esc(r.id)}" aria-label="Устгах: ${esc(excerpt(r.userText, 60))}">Устгах</button>
      </div>
    </li>`).join('') : '<li class="empty"><p><strong>Жишээ алга.</strong></p><p class="muted">«Ноорог» хэсэгт үнэлсэн ноорогоос «Жишээ болгох» дарж эсвэл «Шинэ жишээ»-ээр нэмнэ үү.</p></li>';
}

const readEx = () => ({
  kind: ($('input[name="ms-ex-kind"]:checked', exForm) || {}).value || '',
  userText: exUser.value.trim(),
  reply: exReply.value.trim(),
  note: exNote.value.trim(),
});
const exDirty = () => !!exEdit && JSON.stringify(readEx()) !== exEdit.snap;
const setExKindText = () => {
  const bad = (($('input[name="ms-ex-kind"]:checked', exForm) || {}).value) === 'bad';
  $('#ms-ex-reply-l').textContent = bad ? 'Буруу хариу (AI ингэж хэлж болохгүй)' : 'Зөв хариу';
};
/** @param {string|null} id  @param {object} [prefill]  @param {HTMLElement} [focusEl] */
function openEx(id, prefill = null, focusEl = null) {
  if (exEdit && exDirty()) {
    // Хадгалаагүй засвартай бол дарж бичихгүй — эхлээд хаах эсэхийг асууна
    closeEx().then((ok) => { if (ok) openEx(id, prefill, focusEl); });
    return;
  }
  deps.selectTab('train');
  const cur = id ? ex.get(id) : null;
  exEdit = { id: id || newExampleId(), isNew: !cur, snap: '' };
  const v = cur || prefill || { kind: 'good', userText: '', reply: '', note: '' };
  $('#msExFormH').textContent = cur ? 'Жишээ засах' : 'Шинэ жишээ';
  $$('input[name="ms-ex-kind"]', exForm).forEach((r) => { r.checked = r.value === v.kind; });
  exUser.value = v.userText || '';
  exReply.value = v.reply || '';
  exNote.value = v.note || '';
  setExKindText();
  exEdit.snap = cur || !prefill ? JSON.stringify(readEx()) : '';   // урьдчилан бөглөсөн шинэ жишээ = хадгалаагүй
  clearErrors(exForm);
  setStatus(exStatusEl, '', '');
  exForm.hidden = false;
  attachCounters(exForm);
  refreshCounters(exForm);
  renderEx();
  exForm.scrollIntoView({ block: 'start' });
  (focusEl || exUser).focus({ preventScroll: true });
  deps.onDirty();
}
async function closeEx({ force = false } = {}) {
  if (!force && exDirty() && !(await dialog({ title: 'Хадгалаагүй өөрчлөлт байна', body: 'Жишээний засварыг хадгалахгүй хаах уу?', confirm: 'Хадгалалгүй хаах', cancel: 'Үлдэх', danger: true }))) return false;
  const id = exEdit && exEdit.id;
  exEdit = null;
  exForm.hidden = true;
  clearErrors(exForm);
  renderEx();
  const btn = id && $(`[data-ex-edit="${CSS.escape(id)}"]`, exList);
  (btn || $('#btnMsExNew')).focus();
  deps.onDirty();
  return true;
}
async function saveEx() {
  if (!exEdit || saving || !session.user) return;
  const v = readEx();
  const errs = validateExample(v);
  if (errs.length) {
    const el = { kind: $('input[name="ms-ex-kind"]', exForm), userText: exUser, reply: exReply, note: exNote };
    showErrors(exErr, errs.map((e) => ({ msg: e.msg, el: el[e.field] })), exForm);
    return;
  }
  clearErrors(exForm);
  saving = true;
  const id = exEdit.id;
  $$('button', exForm).forEach((b) => { b.disabled = true; });
  setStatus(exStatusEl, 'Хадгалж байна…', '');
  try {
    const data = { userText: v.userText, reply: v.reply, kind: v.kind, note: v.note, updatedAt: serverTimestamp(), updatedBy: session.user.email };
    await setDoc(doc(db, 'messenger_examples', id), data);
    ex.set(id, { id, ...data, updatedAt: new Date() });
    exEdit.snap = JSON.stringify(readEx());
    await closeEx({ force: true });
    deps.onExamplesChange();
    snack(`${exKindLabel(v.kind)} хадгалагдлаа — AI 5 минутын дотор ашиглана`);
  } catch (e) {
    setStatus(exStatusEl, errText(e), 'err');
    snack(errText(e), { error: true });
  } finally {
    saving = false;
    $$('button', exForm).forEach((b) => { b.disabled = false; });
    deps.onDirty();
  }
}
async function delEx(id) {
  const r = ex.get(id);
  if (!r || saving) return;
  if (!(await dialog({ title: 'Жишээ устгах уу?', body: `«${excerpt(r.userText, 80)}» жишээ бүр мөсөн устгагдана.`, confirm: 'Устгах', cancel: 'Болих', danger: true }))) return;
  saving = true;
  try {
    await deleteDoc(doc(db, 'messenger_examples', id));
    ex.delete(id);
    if (exEdit && exEdit.id === id) { exEdit = null; exForm.hidden = true; }
    renderEx();
    deps.onExamplesChange();
    snack('Жишээ устгагдлаа');
    $('#btnMsExNew').focus();
  } catch (e) { snack(errText(e), { error: true }); }
  finally { saving = false; deps.onDirty(); }
}
$('#btnMsExNew').addEventListener('click', () => openEx(null));
$('#btnMsExCancel').addEventListener('click', () => closeEx());
exForm.addEventListener('submit', (e) => { e.preventDefault(); saveEx(); });
exForm.addEventListener('input', (e) => { clearFieldError(e.target); deps.onDirty(); });
exForm.addEventListener('change', (e) => { if (e.target.name === 'ms-ex-kind') setExKindText(); deps.onDirty(); });
exList.addEventListener('click', (e) => {
  const ed = e.target.closest('[data-ex-edit]');
  if (ed) { openEx(ed.dataset.exEdit); return; }
  const del = e.target.closest('[data-ex-del]');
  if (del) delEx(del.dataset.exDel);
});

/** «Ноорог» карт → жишээ (нэг товч). Аль хэдийн байвал засах цонхыг нээнэ (дарж бичихгүй). */
export async function exampleFromDraftAction(d) {
  if (!session.user || saving) return;
  const v = exampleFromDraft(d);
  if (!v) { snack('Энэ ноорогоос жишээ үүсгэх боломжгүй (текстгүй, эсвэл «Засвартай»-д зөв хариу бичээгүй).', { error: true }); return; }
  const id = exampleIdForDraft(d.id);
  if (ex.has(id)) { openEx(id); return; }
  saving = true;
  try {
    const ref = doc(db, 'messenger_examples', id);
    const cur = await getDoc(ref);   // жагсаалт 100-аар хязгаарлагдсан — давхар бичихээс сэргийлнэ
    if (cur.exists()) {
      ex.set(id, { id, ...cur.data() });
      renderEx();
      deps.onExamplesChange();
      saving = false;
      openEx(id);
      return;
    }
    const data = { userText: v.userText, reply: v.reply, kind: v.kind, note: v.note, updatedAt: serverTimestamp(), updatedBy: session.user.email };
    await setDoc(ref, data);
    ex.set(id, { id, ...data, updatedAt: new Date() });
    renderEx();
    deps.onExamplesChange();
    snack(`${exKindLabel(v.kind)} болж нэмэгдлээ — AI 5 минутын дотор ашиглана`, { action: 'Засах', onAction: () => openEx(id) });
  } catch (e) {
    snack(errText(e), { error: true });
  } finally {
    saving = false;
  }
}
/** «Жишээнд орсон» карт → засах */
export function editExample(id) { openEx(id); }

/* ---------- AI-д юу орж байна ---------- */
function knowHtml(k) {
  const f = k.facts || {};
  const label = (id) => {
    const [kind, rest] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
    if (kind === 'kb') return rest === KB_VOICE_ID ? KB_VOICE_TITLE : `Мэдлэг «${(kb.get(rest) || {}).title || rest}»`;
    if (kind === 'example') return `Жишээ «${excerpt((ex.get(rest) || {}).userText || rest, 60)}»`;
    if (kind === 'page') return `Эмчилгээний хуудас «${rest}»`;
    return id;
  };
  const excluded = (k.excluded || []).map((e) => `<li>${esc(label(e.id))} — ${esc(EXCLUDE_TEXT[e.reason] || e.reason)}</li>`).join('');
  const truncated = (k.truncated || []).map((id) => `<li>${esc(label(id))} — урт тул эхний хэсгийг л оруулсан</li>`).join('');
  return `<dl class="ms-kv">
      <div><dt>Сайтын үйлчилгээ / багц</dt><dd>${f.service || 0} / ${f.package || 0}</dd></div>
      <div><dt>Эмчилгээний хуудас</dt><dd>${f.page || 0}</dd></div>
      <div><dt>Нийтэлсэн мэдлэг</dt><dd>${f.kb || 0}</dd></div>
      <div><dt>Жишээ (сайн / муу)</dt><dd>${(k.examples || []).filter((x) => x.kind === 'good').length} / ${(k.examples || []).filter((x) => x.kind === 'bad').length}</dd></div>
      <div><dt>Брэнд дуу хоолой</dt><dd>${k.voice ? 'тохируулсан' : 'алга'}</dd></div>
      <div><dt>Хэмжээ (тэмдэгт)</dt><dd>${((k.chars?.knowledge || 0) + (k.chars?.examples || 0)).toLocaleString('en-US')}</dd></div>
    </dl>
    ${excluded || truncated ? `<h3 class="ms-sub">Анхаарах</h3><ul class="ms-notes">${excluded}${truncated}</ul>` : '<p class="muted">Бүх бичлэг AI-д орж байна.</p>'}
    <p class="muted ms-small">AI хэлж болох дүн: ${(k.allowedAmounts || []).map((n) => `₮${Number(n).toLocaleString('en-US')}`).map(esc).join(', ') || '—'}${(k.allowedPercents || []).length ? `; хувь: ${k.allowedPercents.map((n) => `${esc(String(n))}%`).join(', ')}` : ''}. Хувилбар ${esc(k.promptVersion || '')} · ${esc(k.knowledgeRev || '')}</p>
    <details class="ms-ctx"><summary>AI-д очих мэдлэгийн бүтэн текст</summary>${(k.blocks || []).map((b) => `<pre class="ms-pre">${esc(b)}</pre>`).join('')}</details>`;
}
$('#btnMsKnow').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.disabled) return;
  btn.disabled = true;
  setStatus(knowStatus, 'Шалгаж байна…', '');
  try {
    const j = await api('knowledge', { includeDrafts: $('#ms-know-drafts').checked });
    knowOut.innerHTML = knowHtml(j.knowledge);
    setStatus(knowStatus, 'Шалгалаа.', 'ok');
  } catch (err) {
    knowOut.innerHTML = '';
    setStatus(knowStatus, apiMsg(err), 'err');
  } finally { btn.disabled = false; }
});

/* ---------- Хадгалаагүй өөрчлөлт, гарах ---------- */
export const isDirty = () => kbDirty() || exDirty();
/** Ctrl+S / хадгалах мөр */
export async function save() {
  if (kbDirty()) await saveKb();
  else if (exDirty()) await saveEx();
}
export function discard() {
  kbEdit = null; exEdit = null;
  kbForm.hidden = true; exForm.hidden = true;
  clearErrors(kbForm); clearErrors(exForm);
  renderKb(); renderEx();
}
export function teardown() {
  opened = false; kbReady = false; exReady = false; loading = null; lastTry = null;
  kb.clear(); ex.clear();
  discard();
  tryOut.innerHTML = ''; knowOut.innerHTML = '';
  setStatus(tryStatus, '', ''); setStatus(knowStatus, '', '');
  kbMeta.textContent = ''; exMeta.textContent = '';
  loadBox.hidden = true;
}

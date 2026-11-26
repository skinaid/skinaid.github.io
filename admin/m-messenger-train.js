/* ==========================================================================
   SKIN AID admin — Messenger AI → «Сургалт» (2-р үе шат). m-messenger.js импортолж холбоно (initTraining).
   · Туршилтын асуулт — POST /api/admin {action:'test'} (Firebase ID token): ноорогтой ижил хариу, хадгалахгүй, илгээхгүй.
   · Мэдлэг (messenger_kb: FAQ, бодлого; тусгай id «voice» = брэнд дуу хоолой) — ноорог / нийтэлсэн.
   · Жишээ (messenger_examples: сайн/муу) — ноорогоос (exampleFromDraftAction: урьдчилан бөглөсөн засварлагч — хувийн
     мэдээллийг арилгаад хадгална) эсвэл гараар.
   · AI-д юу орж байна — POST /api/admin {action:'knowledge'} (LLM-гүй).
   Бичилт бүр `messenger_kb/_rev` тэмдгийг НЭГ batch-д шинэчилнэ — сервер мэдлэгийг ≤ 1 минутад дахин ачаална.
   Firestore-д ЗӨВХӨН rules-ийн зөвшөөрсөн талбар (title/body/status, userText/reply/kind/note + updatedAt/updatedBy).
   Квот: таб анх нээхэд ≤ 100 + 100 read (жишээг ноорогийн цэс аль хэдийн уншсан бол дахин уншихгүй). Бүх текстийг esc()-ээр.
   ========================================================================== */
import { collection, query, limit, getDocs, doc, getDoc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db, $, $$, esc, fmtDate, errText, session, setStatus, msOf, DEFAULTS } from './core.js?v=2c361933';
import { dialog, snack, showErrors, clearErrors, clearFieldError, attachCounters, refreshCounters } from './ui.js?v=8848d02a';
import {
  ROUTE_TONE, KB_LIMITS, KB_VOICE_ID, KB_VOICE_TITLE, KB_REV_ID, KB_STATUS, EX_KINDS, kbStatusLabel, exKindLabel, newKbId, newExampleId,
  exampleIdForDraft, validateKb, validateExample, exampleFromDraft, exampleState, sortKb, apiErrorText, EXCLUDE_TEXT, usd3,
  kbBudget, exampleBudget, KB_BUDGET,
} from './messenger-lib.js?v=b1c66c99';

const READ_LIMIT = 100;
const loadBox = $('#msTrLoad'), loadMsg = $('#msTrLoadMsg');
const tryForm = $('#msTryForm'), tryText = $('#ms-try'), tryDrafts = $('#ms-try-drafts'), tryBtn = $('#btnMsTry'), tryStatus = $('#msTryStatus'), tryOut = $('#msTryOut');
const kbForm = $('#msKbForm'), kbErr = $('#msKbErr'), kbTitle = $('#ms-kb-title'), kbBody = $('#ms-kb-body'), kbList = $('#msKbList'), kbMeta = $('#msKbMeta'), kbStatusEl = $('#msKbSaveStatus');
const exForm = $('#msExForm'), exErr = $('#msExErr'), exUser = $('#ms-ex-user'), exReply = $('#ms-ex-reply'), exNote = $('#ms-ex-note'), exList = $('#msExList'), exMeta = $('#msExMeta'), exStatusEl = $('#msExSaveStatus'), exPrivacy = $('#msExPrivacy');
const knowOut = $('#msKnowOut'), knowStatus = $('#msKnowStatus'), knowBtn = $('#btnMsKnow'), knowDrafts = $('#ms-know-drafts');
const btnKbNew = $('#btnMsKbNew'), btnVoice = $('#btnMsVoice'), btnExNew = $('#btnMsExNew');

/** m-messenger.js-ийн callback (таб солих, ноорогийн картын «Жишээ» мөр, хадгалаагүй өөрчлөлтийн тэмдэг) */
let deps = { selectTab: () => {}, onExamplesChange: () => {}, onDirty: () => {} };
export function initTraining(d) { deps = { ...deps, ...d }; }

const kb = new Map();          // id → { id, title, body, status, updatedAt, updatedBy }
const ex = new Map();          // id → { id, kind, userText, reply, note, updatedAt, updatedBy }
let kbReady = false, exReady = false, opened = false;
let loadingKb = null, loadingEx = null;
let kbEdit = null;             // { id, isNew, snap, opener }
let exEdit = null;             // { id, isNew, snap, opener, fromDraft }
let busy = '';                 // '' | 'kb' | 'ex' | 'del' | 'draft' — нэг удаад нэг бичилт
let trying = false, knowing = false;
let lastTry = null;            // { result, run }
let gen = 0;                   // teardown бүрт нэмэгдэнэ — гарсны дараах async үр дүнг үл тооно
const alive = (g) => g === gen && !!session.user;

/** role=status элементэд ижил текстийг дахин бичихгүй (дэлгэц уншигч давтахгүй) */
const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
const busyMsg = () => snack('Өмнөх хадгалалт дуусаагүй байна — хэдэн секунд хүлээнэ үү.');
const MS = (v) => msOf(v) ?? (v instanceof Date ? v.getTime() : 0);

/** Нээх товчнууд: ачаалагдаагүй, алдаатай, хадгалж байх үед идэвхгүй (хоосон засварлагч бодит бичлэгийг дарж бичихгүй) */
function syncOpeners() {
  btnKbNew.disabled = !kbReady || !!busy;
  btnVoice.disabled = !kbReady || !!busy;
  btnExNew.disabled = !exReady || !!busy;
}

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
  // JSON биш хариу: 404/405/501 (GitHub Pages, localhost) = функц энэ хаяг дээр алга; бусад (504 timeout г.м.) = серверийн алдаа
  if (!j || typeof j !== 'object' || (!j.ok && typeof j.error !== 'string')) throw codeErr([404, 405, 501].includes(res.status) ? 'no_server' : 'server_error');
  if (!res.ok || !j.ok) throw codeErr(j.error, j);
  return j;
}
const apiMsg = (e) => (e && e.apiCode ? apiErrorText(e.apiCode) : errText(e));

/* ---------- Бичилт: баримт + мэдлэгийн тэмдэг (`_rev`) НЭГ batch-д ---------- */
const revData = () => ({ title: 'Кэшийн тэмдэг (систем)', body: new Date().toISOString(), status: 'draft', updatedAt: serverTimestamp(), updatedBy: session.user.email });
async function commitWithRev(ops) {
  const b = writeBatch(db);
  for (const [kind, ref, data] of ops) {
    if (kind === 'set') b.set(ref, data);
    else b.delete(ref);
  }
  b.set(doc(db, 'messenger_kb', KB_REV_ID), revData());
  await b.commit();
}

/* ---------- Ачаалах ---------- */
/** Баримтуудыг уншина (тэмдэг `_rev`-ийг тооцохгүй — +1); Map-ийг дуудагч generation шалгасны ДАРАА л дүүргэнэ */
async function readCol(name) {
  const snap = await getDocs(query(collection(db, name), limit(READ_LIMIT + 1)));
  return snap.docs.filter((s) => s.id !== KB_REV_ID).slice(0, READ_LIMIT).map((s) => ({ id: s.id, ...s.data() }));
}
const fill = (into, rows) => { into.clear(); rows.forEach((r) => into.set(r.id, r)); };
/** Жишээний жагсаалт (ноорогийн карт «Жишээнд орсон»-ыг харуулахад ч) — нэг удаа */
export function loadExamples() {
  if (exReady) return Promise.resolve();
  if (loadingEx) return loadingEx;
  const g = gen;
  const p = readCol('messenger_examples')
    .then((rows) => { if (!alive(g)) return; fill(ex, rows); exReady = true; renderEx(); syncOpeners(); deps.onExamplesChange(); })
    .finally(() => { if (loadingEx === p) loadingEx = null; });
  loadingEx = p;
  return p;
}
function loadKb() {
  if (kbReady) return Promise.resolve();
  if (loadingKb) return loadingKb;
  const g = gen;
  const p = readCol('messenger_kb')
    .then(async (rows) => {
      // 100-аас олон бичлэгтэй бол «Брэнд дуу хоолой» (id-аар сүүлд эрэмбэлэгддэг) жагсаалтаас гарч болно — тусад нь (1 read)
      if (rows.length >= READ_LIMIT && !rows.some((r) => r.id === KB_VOICE_ID)) {
        const v = await getDoc(doc(db, 'messenger_kb', KB_VOICE_ID));
        if (v.exists()) rows = [...rows, { id: KB_VOICE_ID, ...v.data() }];
      }
      if (!alive(g)) return; fill(kb, rows); kbReady = true; renderKb(); syncOpeners();
    })
    .finally(() => { if (loadingKb === p) loadingKb = null; });
  loadingKb = p;
  return p;
}
function load() {
  const g = gen;
  loadBox.hidden = true;
  if (!kbReady) setText(kbMeta, 'Ачаалж байна…');
  if (!exReady) setText(exMeta, 'Ачаалж байна…');
  syncOpeners();
  return Promise.all([loadKb(), loadExamples()]).catch((e) => {
    if (!alive(g)) return;
    if (!kbReady) setText(kbMeta, '');
    if (!exReady) setText(exMeta, '');
    loadMsg.textContent = `${errText(e)} Мэдлэг, жишээг уншиж чадсангүй — засварлахыг түр хаалаа.`;
    loadBox.hidden = false;
    syncOpeners();
    opened = false;
  });
}
$('#btnMsTrRetry').addEventListener('click', () => { opened = true; load(); });
/** «Сургалт» таб анх нээгдэхэд (m-messenger.js) */
export function openTraining() {
  if (opened || !session.user) return;
  opened = true;
  load();
}
/** Ноорогийн картын «Жишээ» мөр (m-messenger.js): 'none' | 'new' | 'same' | 'stale' | 'unknown' */
export const draftExampleState = (d) => (exReady ? exampleState(d, ex.get(exampleIdForDraft(d.id))) : exampleFromDraft(d) ? 'unknown' : 'none');

/* ---------- Туршилтын асуулт ---------- */
const block = (label, text, cls = '') => (text ? `<div class="ms-block ${cls}"><span class="ms-label">${esc(label)}</span><p class="ms-text">${esc(text)}</p></div>` : '');
/** Ишийн id → ойлгомжтой нэр (service:exam-1 → «Арьсны үзлэг, оношлогоо») */
function sourceLabel(id) {
  const [kind, rest] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (id === 'hours') return 'Ажлын цаг';
  if (id === 'address') return 'Хаяг';
  if (id === 'clinic') return 'Эмнэлэг';
  if (kind === 'service') return (DEFAULTS.treatments || []).find((t) => t.id === rest)?.n || 'Үйлчилгээ';
  if (kind === 'package') return (DEFAULTS.packages || []).find((t) => t.id === rest)?.name || 'Багц';
  if (kind === 'kb') return `Мэдлэг «${(kb.get(rest) || {}).title || rest}»`;
  if (kind === 'page') return `Эмчилгээний хуудас «${rest}»`;
  return id;
}
function tryHtml(r, run) {
  const l = r.labels || {};
  const tone = ROUTE_TONE[r.route] || 'muted';
  const reasons = (l.reasons || []).filter(Boolean);
  const total = Number(run.cacheReadTokens) + Number(run.inputTokens) + Number(run.cacheWriteTokens);
  const cache = run.cacheReadTokens ? ` · кэш ${Math.round((100 * Number(run.cacheReadTokens)) / Math.max(1, total))}%` : '';
  const src = (r.sourceIds || []).length ? `Ашигласан мэдлэг: ${r.sourceIds.map((id) => esc(sourceLabel(id))).join(', ')}. ` : '';
  return `<article class="ms-card" aria-labelledby="msTryResH">
    <header class="ms-card__head">
      <h3 id="msTryResH" class="ms-card__title" tabindex="-1"><span class="ms-tone ms-tone--${tone}">${esc(l.route || r.route)}</span> ${esc(l.intent || r.intent || '')}</h3>
      <span class="muted">${esc(usd3(run.costMicroUsd))} · ${esc(String(Math.round((Number(run.durationMs) || 0) / 100) / 10))} с${esc(cache)}</span>
    </header>
    ${block('Үйлчлүүлэгч (нууцалсан)', r.userText)}
    ${block('AI-ийн санал', r.reply, 'ms-block--ai')}
    ${block('Автомат горимд (3-р үе шат) илгээгдэх байсан', r.wouldSend, 'ms-block--send')}
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
  const g = gen;
  trying = true;
  // disabled биш aria-disabled: фокус товчин дээр үлдэнэ (WCAG 2.4.3)
  tryBtn.setAttribute('aria-disabled', 'true');
  setStatus(tryStatus, 'AI бичиж байна… (10–30 секунд)', '');
  tryOut.setAttribute('aria-busy', 'true');
  try {
    const j = await api('test', { text, includeDrafts: tryDrafts.checked });
    if (!alive(g)) return;
    lastTry = { result: j.result, run: j.run };
    tryOut.innerHTML = tryHtml(j.result, j.run);
    setStatus(tryStatus, `Бэлэн. Өнөөдөр ${Number(j.testsToday)}/${Number(j.testsLimit)} туршилт.`, 'ok');
    $('#msTryResH', tryOut)?.focus();
  } catch (e) {
    if (!alive(g)) return;
    lastTry = null;
    tryOut.innerHTML = '';
    const b = e.body || {};
    const extra = b.run && b.run.costMicroUsd ? ` Зарцуулсан: ${usd3(b.run.costMicroUsd)}.` : '';
    const count = b.testsToday ? ` Өнөөдөр ${Number(b.testsToday)}/${Number(b.testsLimit)}.` : '';
    setStatus(tryStatus, `${apiMsg(e)}${extra}${count}`, 'err');
  } finally {
    if (alive(g)) {
      trying = false;
      tryBtn.removeAttribute('aria-disabled');
      tryOut.setAttribute('aria-busy', 'false');
    }
  }
}
attachCounters(tryForm);
tryForm.addEventListener('submit', (e) => { e.preventDefault(); runTry(); });
tryText.addEventListener('input', () => { if (tryText.hasAttribute('aria-invalid')) { tryText.removeAttribute('aria-invalid'); setStatus(tryStatus, '', ''); } });
tryOut.addEventListener('click', (e) => {
  const b = e.target.closest('[data-try-ex]');
  if (!b || !lastTry) return;
  const r = lastTry.result;
  openEx(null, { prefill: { kind: b.dataset.tryEx, userText: r.userText || '', reply: r.reply || '', note: '' }, focusEl: b.dataset.tryEx === 'bad' ? exNote : exReply, opener: b });
});

/* ---------- Мэдлэг (messenger_kb) ---------- */
$('#msKbStatus').innerHTML = KB_STATUS.map((s) => `<label class="ms-mode"><input type="radio" name="ms-kb-status" value="${s.key}"> <span><strong>${esc(s.label)}</strong><small>${esc(s.hint)}</small></span></label>`).join('');
const excerpt = (s, n) => { const a = Array.from(String(s || '').replace(/\s+/g, ' ').trim()); return a.length > n ? `${a.slice(0, n).join('')}…` : a.join(''); };
const meta = (r) => `${esc(fmtDate(r.updatedAt))}${r.updatedBy ? ` · ${esc(r.updatedBy)}` : ''}`;
const fmtN = (n) => Number(n).toLocaleString('en-US');

function renderKb() {
  const rows = sortKb([...kb.values()]);
  if (kbReady) {
    const b = kbBudget(rows);
    setText(kbMeta, rows.length
      ? `${rows.length} бичлэг · нийтэлсэн ${b.published} · AI-д орох хэмжээ ${fmtN(b.chars)} / ${fmtN(KB_BUDGET.chars)} тэмдэгт${b.over ? ' — ХЭТЭРСЭН: зарим бичлэг AI-д орохгүй' : ''}${rows.length >= READ_LIMIT ? ` (эхний ${READ_LIMIT})` : ''}`
      : '');
    kbMeta.classList.toggle('is-warn', b.over);
  }
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
async function openKb(id, { voice = false, opener = null } = {}) {
  if (busy) { busyMsg(); return; }
  const realId = id || (voice ? KB_VOICE_ID : null);
  // Засаж буй бичлэгийнхээ «Засах»-ыг дахин дарвал хадгалаагүй засварыг ХАЯХГҮЙ — маягт руу аваачна
  if (kbEdit && realId && kbEdit.id === realId) { kbForm.scrollIntoView({ block: 'start' }); (realId === KB_VOICE_ID ? kbBody : kbTitle).focus({ preventScroll: true }); return; }
  if (kbEdit && !(await closeKb({ refocus: false }))) return;
  if (!kbReady) return;
  const cur = realId ? kb.get(realId) : null;
  const finalId = realId || newKbId();
  const isVoice = finalId === KB_VOICE_ID;
  kbEdit = { id: finalId, isNew: !cur, snap: '', opener: opener || (isVoice ? btnVoice : btnKbNew) };
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
/** @returns {Promise<boolean>} хаасан эсэх */
async function closeKb({ force = false, refocus = true } = {}) {
  if (!kbEdit) return true;
  if (!force && kbDirty() && !(await dialog({ title: 'Хадгалаагүй өөрчлөлт байна', body: 'Мэдлэгийн засварыг хадгалахгүй хаах уу?', confirm: 'Хадгалалгүй хаах', cancel: 'Үлдэх', danger: true }))) return false;
  const { id, opener } = kbEdit;
  kbEdit = null;
  kbForm.hidden = true;
  clearErrors(kbForm);
  renderKb();
  if (refocus) {
    const btn = id && $(`[data-kb-edit="${CSS.escape(id)}"]`, kbList);
    const target = btn || (opener && opener.isConnected && !opener.disabled ? opener : btnKbNew);
    target.focus();
  }
  deps.onDirty();
  return true;
}
function setBusy(op, form) {
  busy = op;
  if (form) form.inert = !!op;
  syncOpeners();
}
async function saveKb() {
  if (!kbEdit || !session.user) return;
  if (busy) { busyMsg(); return; }
  const v = readKb();
  const errs = validateKb(v);
  if (errs.length) {
    const el = { title: kbTitle, body: kbBody, status: $('input[name="ms-kb-status"]', kbForm) };
    showErrors(kbErr, errs.map((e) => ({ msg: e.msg, el: el[e.field] })), kbForm, { level: 4 });
    return;
  }
  clearErrors(kbForm);
  const ed = kbEdit;
  const g = gen;
  setBusy('kb', kbForm);
  setStatus(kbStatusEl, 'Хадгалж байна…', '');
  try {
    const ref = doc(db, 'messenger_kb', ed.id);
    // Шинэ бичлэг (ялангуяа «Брэнд дуу хоолой») — өөр таб/цонхонд аль хэдийн үүссэн бол дарж бичихгүй
    if (ed.isNew && (await getDoc(ref)).exists()) {
      if (!alive(g)) return;
      setStatus(kbStatusEl, 'Энэ бичлэг аль хэдийн үүссэн байна (өөр цонхноос). «Дахин ачаалах» дараад засна уу.', 'err');
      return;
    }
    const data = { title: v.title.slice(0, KB_LIMITS.title), body: v.body, status: v.status, updatedAt: serverTimestamp(), updatedBy: session.user.email };
    await commitWithRev([['set', ref, data]]);
    if (!alive(g)) return;
    kb.set(ed.id, { id: ed.id, ...data, updatedAt: new Date() });
    if (kbEdit === ed) { setBusy('', kbForm); await closeKb({ force: true }); }
    else renderKb();
    snack(v.status === 'published' ? 'Мэдлэг нийтлэгдлээ — AI 1 минутын дотор ашиглана' : 'Мэдлэг ноорог хэлбэрээр хадгалагдлаа');
  } catch (e) {
    if (!alive(g)) return;
    setStatus(kbStatusEl, errText(e), 'err');
  } finally {
    if (alive(g)) {
      setBusy('', kbForm);
      // inert болсон маягтаас фокус алдагдсан бол «Хадгалах» руу
      if (kbEdit === ed && (document.activeElement === document.body || !document.activeElement)) $('#btnMsKbSave').focus();
      deps.onDirty();
    }
  }
}
async function delKb(id, btn) {
  const r = kb.get(id);
  if (!r) return;
  if (busy) { busyMsg(); return; }
  const title = id === KB_VOICE_ID ? KB_VOICE_TITLE : r.title;
  if (!(await dialog({ title: 'Мэдлэг устгах уу?', body: [`«${title}» бүр мөсөн устгагдана. AI 1 минутын дотор ашиглахаа болино.`, 'Түр нуух бол «Засах» → «Ноорог» болгож хадгална уу.'], confirm: 'Устгах', cancel: 'Болих', danger: true }))) return;
  const g = gen;
  setBusy('del');
  try {
    await commitWithRev([['delete', doc(db, 'messenger_kb', id)]]);
    if (!alive(g)) return;
    kb.delete(id);
    if (kbEdit && kbEdit.id === id) { kbEdit = null; kbForm.hidden = true; }
    renderKb();
    snack(`«${title}» устгагдлаа`);
    setBusy('');   // товчийг идэвхжүүлээд фокус (идэвхгүй товч фокус авдаггүй)
    btnKbNew.focus();
  } catch (e) {
    if (!alive(g)) return;
    snack(errText(e), { error: true });
    if (btn && btn.isConnected) btn.focus();
  } finally { if (alive(g)) { setBusy(''); deps.onDirty(); } }
}
btnKbNew.addEventListener('click', () => openKb(null, { opener: btnKbNew }));
btnVoice.addEventListener('click', () => openKb(null, { voice: true, opener: btnVoice }));
$('#btnMsKbCancel').addEventListener('click', () => closeKb());
kbForm.addEventListener('submit', (e) => { e.preventDefault(); saveKb(); });
kbForm.addEventListener('input', (e) => { clearFieldError(e.target); deps.onDirty(); });
kbForm.addEventListener('change', () => deps.onDirty());
kbList.addEventListener('click', (e) => {
  const ed = e.target.closest('[data-kb-edit]');
  if (ed) { openKb(ed.dataset.kbEdit, { opener: ed }); return; }
  const del = e.target.closest('[data-kb-del]');
  if (del) delKb(del.dataset.kbDel, del);
});

/* ---------- Жишээ (messenger_examples) ---------- */
$('#msExKinds').innerHTML = EX_KINDS.map((k) => `<label class="ms-mode"><input type="radio" name="ms-ex-kind" value="${k.key}"> <span><strong>${esc(k.label)}</strong><small>${esc(k.hint)}</small></span></label>`).join('');

function renderEx() {
  const rows = [...ex.values()].sort((a, b) => MS(b.updatedAt) - MS(a.updatedAt));
  if (exReady) {
    const good = rows.filter((r) => r.kind === 'good').length;
    const b = exampleBudget(rows);
    setText(exMeta, rows.length
      ? `${rows.length} жишээ · сайн ${good}, муу ${rows.length - good} · AI-д сүүлийн ${b.used} нь орно${b.used < rows.length ? ` (хуучин ${rows.length - b.used} нь хязгаараас хэтэрсэн тул орохгүй)` : ''}${rows.length >= READ_LIMIT ? ` · эхний ${READ_LIMIT}` : ''}`
      : '');
    exMeta.classList.toggle('is-warn', b.used < rows.length);
  }
  exList.innerHTML = !exReady ? '' : rows.length ? rows.map((r) => `<li class="ms-item${exEdit && exEdit.id === r.id ? ' is-editing' : ''}" data-id="${esc(r.id)}">
      <div class="ms-item__body">
        <p class="ms-item__title"><span class="ms-tone ms-tone--${r.kind === 'good' ? 'ok' : 'warn'}">${esc(exKindLabel(r.kind) || r.kind)}</span> <strong>${esc(excerpt(r.userText, 120))}</strong></p>
        ${r.reply ? `<p class="ms-item__text"><span class="ms-who">Хариу:</span> ${esc(excerpt(r.reply, 220))}</p>` : ''}
        ${r.note ? `<p class="ms-item__text"><span class="ms-who">Тайлбар:</span> ${esc(excerpt(r.note, 160))}</p>` : ''}
        <p class="ms-item__meta muted">${meta(r)}${/^x_/.test(r.id) ? ' · ноорогоос (180 хоногийн дараа автоматаар устна)' : ''}</p>
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
/**
 * @param {string|null} id
 * @param {{ prefill?: object, focusEl?: HTMLElement, opener?: HTMLElement, newId?: string, notice?: string }} [o]
 *   newId — ноорогоос үүсэх жишээний тогтмол id; prefill-тэй шинэ жишээ = «хадгалаагүй» (хадгалахыг санууна)
 */
async function openEx(id, o = {}) {
  if (busy) { busyMsg(); return; }
  const targetId = id || o.newId || null;
  if (exEdit && targetId && exEdit.id === targetId && !o.prefill) { exForm.scrollIntoView({ block: 'start' }); (o.focusEl || exUser).focus({ preventScroll: true }); return; }
  if (exEdit && !(await closeEx({ refocus: false }))) return;
  deps.selectTab('train');
  const cur = id ? ex.get(id) : null;
  exEdit = { id: targetId || newExampleId(), isNew: !cur, snap: '', opener: o.opener || btnExNew, fromDraft: /^x_/.test(targetId || '') };
  const v = o.prefill || cur || { kind: 'good', userText: '', reply: '', note: '' };
  $('#msExFormH').textContent = cur ? 'Жишээ засах' : 'Шинэ жишээ';
  $$('input[name="ms-ex-kind"]', exForm).forEach((r) => { r.checked = r.value === v.kind; });
  exUser.value = v.userText || '';
  exReply.value = v.reply || '';
  exNote.value = v.note || '';
  setExKindText();
  // Ноорогоос: үйлчлүүлэгчийн бодит текст — хадгалахаас өмнө хувийн мэдээллийг арилгуулна
  exPrivacy.hidden = !exEdit.fromDraft;
  setText($('#msExPrivacyMsg'), o.notice || '');
  exEdit.snap = o.prefill ? '' : JSON.stringify(readEx());
  clearErrors(exForm);
  setStatus(exStatusEl, '', '');
  exForm.hidden = false;
  attachCounters(exForm);
  refreshCounters(exForm);
  renderEx();
  exForm.scrollIntoView({ block: 'start' });
  (o.focusEl || exUser).focus({ preventScroll: true });
  deps.onDirty();
}
async function closeEx({ force = false, refocus = true } = {}) {
  if (!exEdit) return true;
  if (!force && exDirty() && !(await dialog({ title: 'Хадгалаагүй өөрчлөлт байна', body: 'Жишээний засварыг хадгалахгүй хаах уу?', confirm: 'Хадгалалгүй хаах', cancel: 'Үлдэх', danger: true }))) return false;
  const { id, opener } = exEdit;
  exEdit = null;
  exForm.hidden = true;
  exPrivacy.hidden = true;
  clearErrors(exForm);
  renderEx();
  if (refocus) {
    const btn = id && $(`[data-ex-edit="${CSS.escape(id)}"]`, exList);
    const target = btn || (opener && opener.isConnected && !opener.disabled ? opener : btnExNew);
    target.focus();
  }
  deps.onDirty();
  return true;
}
async function saveEx() {
  if (!exEdit || !session.user) return;
  if (busy) { busyMsg(); return; }
  const v = readEx();
  const errs = validateExample(v);
  if (errs.length) {
    const el = { kind: $('input[name="ms-ex-kind"]', exForm), userText: exUser, reply: exReply, note: exNote };
    showErrors(exErr, errs.map((e) => ({ msg: e.msg, el: el[e.field] })), exForm, { level: 4 });
    return;
  }
  clearErrors(exForm);
  const ed = exEdit;
  const g = gen;
  setBusy('ex', exForm);
  setStatus(exStatusEl, 'Хадгалж байна…', '');
  try {
    const ref = doc(db, 'messenger_examples', ed.id);
    if (ed.isNew && !ed.fromDraft && (await getDoc(ref)).exists()) {
      if (!alive(g)) return;
      setStatus(exStatusEl, 'Энэ жишээ аль хэдийн үүссэн байна. «Дахин ачаалах» дараад засна уу.', 'err');
      return;
    }
    const data = { userText: v.userText, reply: v.reply, kind: v.kind, note: v.note, updatedAt: serverTimestamp(), updatedBy: session.user.email };
    await commitWithRev([['set', ref, data]]);
    if (!alive(g)) return;
    ex.set(ed.id, { id: ed.id, ...data, updatedAt: new Date() });
    if (exEdit === ed) { setBusy('', exForm); await closeEx({ force: true }); }
    else renderEx();
    deps.onExamplesChange();
    const b = exampleBudget([...ex.values()]);
    snack(`${exKindLabel(v.kind)} хадгалагдлаа — AI 1 минутын дотор ашиглана${b.used < ex.size ? '. Анхаар: жишээний хязгаар хэтэрсэн — хамгийн хуучин нь AI-д орохгүй.' : ''}`);
  } catch (e) {
    if (!alive(g)) return;
    setStatus(exStatusEl, errText(e), 'err');
  } finally {
    if (alive(g)) {
      setBusy('', exForm);
      if (exEdit === ed && (document.activeElement === document.body || !document.activeElement)) $('#btnMsExSave').focus();
      deps.onDirty();
    }
  }
}
async function delEx(id, btn) {
  const r = ex.get(id);
  if (!r) return;
  if (busy) { busyMsg(); return; }
  if (!(await dialog({ title: 'Жишээ устгах уу?', body: `«${excerpt(r.userText, 80)}» жишээ бүр мөсөн устгагдана.`, confirm: 'Устгах', cancel: 'Болих', danger: true }))) return;
  const g = gen;
  setBusy('del');
  try {
    await commitWithRev([['delete', doc(db, 'messenger_examples', id)]]);
    if (!alive(g)) return;
    ex.delete(id);
    if (exEdit && exEdit.id === id) { exEdit = null; exForm.hidden = true; }
    renderEx();
    deps.onExamplesChange();
    snack('Жишээ устгагдлаа');
    setBusy('');
    btnExNew.focus();
  } catch (e) {
    if (!alive(g)) return;
    snack(errText(e), { error: true });
    if (btn && btn.isConnected) btn.focus();
  } finally { if (alive(g)) { setBusy(''); deps.onDirty(); } }
}
btnExNew.addEventListener('click', () => openEx(null, { opener: btnExNew }));
$('#btnMsExCancel').addEventListener('click', () => closeEx());
exForm.addEventListener('submit', (e) => { e.preventDefault(); saveEx(); });
exForm.addEventListener('input', (e) => { clearFieldError(e.target); deps.onDirty(); });
exForm.addEventListener('change', (e) => { if (e.target.name === 'ms-ex-kind') setExKindText(); deps.onDirty(); });
exList.addEventListener('click', (e) => {
  const ed = e.target.closest('[data-ex-edit]');
  if (ed) { openEx(ed.dataset.exEdit, { opener: ed }); return; }
  const del = e.target.closest('[data-ex-del]');
  if (del) delEx(del.dataset.exDel, del);
});

/**
 * «Ноорог» карт → жишээ. Шууд хадгалахгүй (аудит 2026-11-27: үйлчлүүлэгчийн бодит текст бүх ярианы prompt-д орно) —
 * урьдчилан бөглөсөн засварлагчийг нээж, нэр, нас, эрүүл мэндийн мэдээллийг арилгуулаад хадгалуулна. Аль хэдийн байвал
 * засна; үнэлгээ өөрчлөгдсөн бол шинэ үнэлгээгээр бөглөнө.
 */
export async function exampleFromDraftAction(d, opener) {
  if (!session.user) return;
  if (busy) { busyMsg(); return; }
  const v = exampleFromDraft(d);
  if (!v) { snack('Энэ ноорогоос жишээ үүсгэх боломжгүй (AI-ийн хариу эсвэл таны зөв хариу алга).', { error: true }); return; }
  const id = exampleIdForDraft(d.id);
  const g = gen;
  let cur = ex.get(id);
  if (!cur) {
    setBusy('draft');
    try {
      const snap = await getDoc(doc(db, 'messenger_examples', id));   // жагсаалт 100-аар хязгаарлагдсан
      if (!alive(g)) return;
      if (snap.exists()) { cur = { id, ...snap.data() }; ex.set(id, cur); renderEx(); deps.onExamplesChange(); }
    } catch (e) {
      if (alive(g)) snack(errText(e), { error: true });
      return;
    } finally { if (alive(g)) setBusy(''); }
  }
  const state = exampleState(d, cur);
  const notice = state === 'stale'
    ? 'Ноорогийн үнэлгээ өөрчлөгдсөн тул жишээний төрөл, хариуг шинэ үнэлгээгээр бөглөлөө (асуулт нь жишээнд хадгалсан хэлбэрээрээ). Хувийн мэдээлэл үлдээгүйг шалгаад хадгална уу.'
    : 'Үйлчлүүлэгчийн бодит мессеж — нэр, нас, эрүүл мэндийн хувийн мэдээллийг арилгаад хадгална уу. Жишээ AI-ийн БҮХ ярианд ашиглагдана.';
  if (state === 'same') { openEx(id, { opener }); return; }
  // Хуучирсан: асуултыг жишээнд аль хэдийн (нэргүй болгосон) хэлбэрээр нь үлдээж, зөвхөн төрөл/хариу/тайлбарыг шинэ үнэлгээгээр
  const prefill = state === 'stale' && cur ? { ...v, userText: cur.userText || v.userText } : v;
  openEx(cur ? id : null, { newId: id, prefill, notice, opener });
}
/** «Жишээнд орсон» карт → засах */
export function editExample(id, opener) { openEx(id, { opener }); }

/* ---------- AI-д юу орж байна ---------- */
function knowHtml(k, withDrafts) {
  const f = k.facts || {};
  const N = (x) => Number(x) || 0;
  const label = (id) => {
    const [kind, rest] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
    if (kind === 'kb') return rest === KB_VOICE_ID ? KB_VOICE_TITLE : `Мэдлэг «${(kb.get(rest) || {}).title || rest}»`;
    if (kind === 'example') return `Жишээ «${excerpt((ex.get(rest) || {}).userText || rest, 60)}»`;
    if (kind === 'page') return `Эмчилгээний хуудас «${rest}»`;
    return id;
  };
  const excluded = (k.excluded || []).map((e) => `<li>${esc(label(String(e.id)))} — ${esc(EXCLUDE_TEXT[e.reason] || e.reason)}</li>`).join('');
  const truncated = (k.truncated || []).map((id) => `<li>${esc(label(String(id)))} — урт тул эхний хэсгийг л оруулсан</li>`).join('');
  const examples = k.examples || [];
  return `<dl class="ms-kv">
      <div><dt>Сайтын үйлчилгээ / багц</dt><dd>${N(f.service)} / ${N(f.package)}</dd></div>
      <div><dt>Эмчилгээний хуудас</dt><dd>${N(f.page)}</dd></div>
      <div><dt>${withDrafts ? 'Мэдлэг (ноорог ч)' : 'Нийтэлсэн мэдлэг'}</dt><dd>${N(f.kb)}</dd></div>
      <div><dt>Жишээ (сайн / муу)</dt><dd>${examples.filter((x) => x.kind === 'good').length} / ${examples.filter((x) => x.kind === 'bad').length}</dd></div>
      <div><dt>Брэнд дуу хоолой</dt><dd>${k.voice ? 'тохируулсан' : 'алга'}</dd></div>
      <div><dt>Хэмжээ (тэмдэгт)</dt><dd>${fmtN(N(k.chars?.knowledge) + N(k.chars?.examples))}</dd></div>
    </dl>
    ${excluded || truncated ? `<h3 class="ms-sub">Анхаарах</h3><ul class="ms-notes">${excluded}${truncated}</ul>` : '<p class="muted">Бүх бичлэг AI-д орж байна.</p>'}
    <p class="muted ms-small">AI хэлж болох дүн (зөвхөн тухайн баримтыг иш татахад): ${(k.allowedAmounts || []).map((n) => `₮${fmtN(n)}`).map(esc).join(', ') || '—'}${(k.allowedPercents || []).length ? `; хувь: ${k.allowedPercents.map((n) => `${esc(String(n))}%`).join(', ')}` : ''}. Хувилбар ${esc(k.promptVersion || '')} · ${esc(k.knowledgeRev || '')}</p>
    <details class="ms-ctx"><summary>AI-д очих мэдлэгийн бүтэн текст</summary>${(k.blocks || []).map((b, i) => `<pre class="ms-pre" tabindex="0" role="region" aria-label="${i === 0 ? 'Мэдлэгийн блок' : 'Жишээний блок'}">${esc(b)}</pre>`).join('')}</details>`;
}
knowBtn.addEventListener('click', async () => {
  if (knowing || !session.user) return;
  const g = gen;
  const withDrafts = knowDrafts.checked;
  knowing = true;
  knowBtn.setAttribute('aria-disabled', 'true');
  setStatus(knowStatus, 'Шалгаж байна…', '');
  try {
    const j = await api('knowledge', { includeDrafts: withDrafts });
    if (!alive(g)) return;
    knowOut.innerHTML = knowHtml(j.knowledge, withDrafts);
    setStatus(knowStatus, 'Шалгалаа.', 'ok');
  } catch (err) {
    if (!alive(g)) return;
    knowOut.innerHTML = '';
    setStatus(knowStatus, apiMsg(err), 'err');
  } finally {
    if (alive(g)) { knowing = false; knowBtn.removeAttribute('aria-disabled'); }
  }
});

/* ---------- Хадгалаагүй өөрчлөлт, гарах ---------- */
export const isDirty = () => kbDirty() || exDirty();
/** Ctrl+S / хадгалах мөр */
export async function save() {
  if (kbDirty()) await saveKb();
  else if (exDirty()) await saveEx();
}
/** Хадгалах мөрийн «Болих» — хадгалж байх үед хийхгүй (false) */
export function discard() {
  if (busy) return false;
  kbEdit = null; exEdit = null;
  kbForm.hidden = true; exForm.hidden = true; exPrivacy.hidden = true;
  clearErrors(kbForm); clearErrors(exForm);
  renderKb(); renderEx();
  return true;
}
export function teardown() {
  gen++;
  opened = false; kbReady = false; exReady = false; loadingKb = null; loadingEx = null; lastTry = null;
  busy = ''; trying = false; knowing = false;
  kbForm.inert = false; exForm.inert = false;
  tryBtn.removeAttribute('aria-disabled'); knowBtn.removeAttribute('aria-disabled');
  kb.clear(); ex.clear();
  kbEdit = null; exEdit = null;
  kbForm.hidden = true; exForm.hidden = true; exPrivacy.hidden = true;
  clearErrors(kbForm); clearErrors(exForm);
  kbList.innerHTML = ''; exList.innerHTML = '';
  tryText.value = ''; tryDrafts.checked = false; knowDrafts.checked = false;
  kbTitle.value = ''; kbBody.value = ''; exUser.value = ''; exReply.value = ''; exNote.value = '';
  tryText.removeAttribute('aria-invalid');
  refreshCounters(tryForm);
  tryOut.innerHTML = ''; knowOut.innerHTML = '';
  setStatus(tryStatus, '', ''); setStatus(knowStatus, '', '');
  setText(kbMeta, ''); setText(exMeta, '');
  loadBox.hidden = true;
  syncOpeners();
}
syncOpeners();

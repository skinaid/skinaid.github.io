/* ==========================================================================
   SKIN AID admin — Модуль: Үйлчилгээ / Багц (settings/catalog)
   Хайлт + ангиллын шүүлт (зөвхөн харагдацад — хадгалахад бүх мөр орно). Мөр устгахад тухайн байранд нь
   «Буцаах» товчтой мөр үлдэнэ (гарын хэрэглэгч шууд хүрнэ; хадгалах/дахин дүүргэхэд арилна).
   ========================================================================== */
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db, $, $$, esc, str, fmtDate, errText, session, setStatus, DEFAULTS, CATS, scrollMode } from './core.js?v=2c361933';
import { ICON, dialog, snack, announce, registerForm, refreshDirty, showErrors, clearErrors, clearFieldError, autoGrow, captureFocus } from './ui.js?v=a5405b51';
import { normSearch } from './lib.js?v=a9638bd3';
import { renderPages } from './m-pages.js?v=26a525a2';

const ref = doc(db, 'settings', 'catalog');
const form = $('#catForm'), svcBody = $('#svcTable tbody'), pkgBody = $('#pkgTable tbody'), status = $('#catStatus'), errBox = $('#catErr');
const btnSave = $('#btnSaveCat'), svcSearch = $('#svcSearch'), svcCat = $('#svcCat'), svcMeta = $('#svcMeta');
const loadBox = $('#catLoad'), loadMsg = $('#catLoadMsg');
let saved = '';       // сүүлд ачаалсан/хадгалсан хүснэгтийн тамга
let ready = false;    // ачаалал амжилтгүй бол хадгалахгүй (анхны утгаар бодит каталогийг дарж бичихгүй)
let saving = false;

const catOptions = (sel) => Object.entries(CATS).map(([k, v]) => `<option value="${esc(k)}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
svcCat.insertAdjacentHTML('beforeend', catOptions(''));
// Нийтлэгдсэн эмчилгээний хуудастай холбоотой үйлчилгээ (build: admin/pages-status.js) — зөвхөн харуулна
const PAGE_BY_ID = {}, PRICE_PAGE_BY_ID = {};
((window.SKINAID_PAGES_STATUS || {}).pages || []).forEach((p) => {
  if (!p.url) return;
  p.catalogIds.forEach((id) => { PAGE_BY_ID[id] = p.url; });
  (p.priceIds || p.catalogIds).forEach((id) => { PRICE_PAGE_BY_ID[id] = PRICE_PAGE_BY_ID[id] || p.url; });
});

/** Мөрийн удирдлагуудыг үйлчилгээний нэрээр шошголно (дэлгэц уншигчид «Нуух» 50 удаа давтагдахгүй) */
function labelRow(tr) {
  const name = $('[data-k="n"]', tr).value.trim() || 'Нэргүй үйлчилгээ';
  $('[data-k="c"]', tr).setAttribute('aria-label', `${name} — ангилал`);
  $('[data-k="d"]', tr).setAttribute('aria-label', `${name} — тайлбар`);
  $('[data-k="t"]', tr).setAttribute('aria-label', `${name} — хугацаа`);
  $('[data-k="p"]', tr).setAttribute('aria-label', `${name} — үнэ`);
  $('[data-k="hidden"]', tr).setAttribute('aria-label', `${name} — сайтаас нуух`);
  $('[data-act="rm"]', tr).setAttribute('aria-label', `${name} — мөр устгах`);
}
const svcRow = (s) => {
  const tr = document.createElement('tr');
  tr.dataset.id = s.id; if (s.hidden) tr.classList.add('is-hidden');
  const page = PAGE_BY_ID[s.id] || PRICE_PAGE_BY_ID[s.id];
  tr.innerHTML = `
    <td class="c-cat"><select data-k="c">${catOptions(s.c)}</select></td>
    <td class="c-name"><input type="text" aria-label="Үйлчилгээний нэр" data-k="n" maxlength="120">${page ? `<a class="svc-page" href="${esc(page)}" target="_blank" rel="noopener" title="Энэ үйлчилгээний үнэ эмчилгээний хуудсанд ч харагдана">↗ ${esc(page)}</a>` : ''}</td>
    <td class="c-desc"><textarea rows="1" data-k="d" maxlength="300"></textarea></td>
    <td class="c-time"><input type="text" data-k="t" maxlength="30"></td>
    <td class="c-price"><input type="text" data-k="p" maxlength="40"></td>
    <td class="c-hide"><input type="checkbox" data-k="hidden"${s.hidden ? ' checked' : ''}></td>
    <td class="c-hide"><button class="btn-icon btn-icon--danger" type="button" data-act="rm" title="Мөр устгах">${ICON.trash}</button></td>`;
  $('[data-k="n"]', tr).value = s.n; $('[data-k="d"]', tr).value = s.d; $('[data-k="t"]', tr).value = s.t; $('[data-k="p"]', tr).value = s.p;
  labelRow(tr);
  return tr;
};
const pkgRow = (p) => {
  const tr = document.createElement('tr');
  tr.dataset.id = p.id; if (p.hidden) tr.classList.add('is-hidden');
  tr.innerHTML = `
    <th scope="row">${esc(p.id)}</th>
    <td class="c-name"><input type="text" data-k="name" maxlength="60"></td>
    <td class="c-price"><input type="text" data-k="price" maxlength="40"></td>
    <td class="c-hide"><input type="checkbox" data-k="hidden"${p.hidden ? ' checked' : ''}></td>`;
  $('[data-k="name"]', tr).value = p.name; $('[data-k="price"]', tr).value = p.price;
  $('[data-k="name"]', tr).setAttribute('aria-label', `Багц ${p.id} — нэр`);
  $('[data-k="price"]', tr).setAttribute('aria-label', `Багц ${p.id} — үнэ`);
  $('[data-k="hidden"]', tr).setAttribute('aria-label', `Багц ${p.id} — сайтаас нуух`);
  return tr;
};
const one = (v, max) => str(typeof v === 'string' ? v.replace(/\s+/g, ' ') : v, max);   // мөр шилжилтгүй (сайт нэг мөрөөр харуулна)
const normSvc = (s) => ({ id: str(s && s.id, 40) || ('svc-' + Date.now().toString(36)), c: CATS[s && s.c] ? s.c : 'minor', n: one(s && s.n, 120), d: one(s && s.d, 300), t: one(s && s.t, 30), p: one(s && s.p, 40), hidden: !!(s && s.hidden) });
const normPkg = (p) => ({ id: str(p && p.id, 10), name: one(p && p.name, 60), price: one(p && p.price, 40), hidden: !!(p && p.hidden) });
const readRows = (tbody, keys) => $$('tr[data-id]', tbody).map((tr) => {
  const o = { id: tr.dataset.id };
  keys.forEach((k) => { const el = $(`[data-k="${k}"]`, tr); o[k] = el ? (el.type === 'checkbox' ? el.checked : el.value) : ''; });
  return o;
});
const readAll = () => ({ services: readRows(svcBody, ['c', 'n', 'd', 't', 'p', 'hidden']), packages: readRows(pkgBody, ['name', 'price', 'hidden']) });
const isDirty = () => ready && JSON.stringify(readAll()) !== saved;
const lock = (on) => { $$(':scope > .panel', form).forEach((p) => { p.inert = on; }); form.classList.toggle('is-locked', on); btnSave.disabled = on; $('#btnCatDefaults').disabled = on; };
lock(true);

/** Хүснэгтийг дахин зурна (фокусыг дуудагч нь captureFocus()-оор сэргээнэ) */
function fill(services, packages) {
  svcBody.replaceChildren(...services.map(normSvc).map(svcRow));
  // Багц: id-г HTML картуудтай (p1..p5) тааруулж, анхны жагсаалтыг суурь болгоно
  const byId = new Map(packages.map(normPkg).map((p) => [p.id, p]));
  pkgBody.replaceChildren(...DEFAULTS.packages.map((d) => pkgRow(byId.get(d.id) || normPkg(d))));
  $$('textarea', svcBody).forEach(autoGrow);
  applyFilter();
}
function applyFilter() {
  const nq = normSearch(svcSearch.value), cat = svcCat.value;
  let shown = 0;
  const rows = $$('tr[data-id]', svcBody);
  rows.forEach((tr) => {
    const hay = normSearch($('[data-k="n"]', tr).value + ' ' + $('[data-k="d"]', tr).value);
    const on = (!cat || $('[data-k="c"]', tr).value === cat) && (!nq || hay.includes(nq));
    tr.hidden = !on; if (on) shown++;
  });
  $('#svcCount').textContent = String(rows.length);
  svcMeta.textContent = (nq || cat) ? `${rows.length}-аас ${shown} харуулж байна` : '';
}
let fT = 0;
svcSearch.addEventListener('input', () => { clearTimeout(fT); fT = setTimeout(applyFilter, 120); });
svcCat.addEventListener('change', applyFilter);

export async function load() {
  if (saving) return;
  const fromRetry = loadBox.contains(document.activeElement);   // «Дахин оролдох» нуугдахад фокус алга болохгүй
  ready = false;
  lock(true);
  if (fromRetry) { const h = $('#h-catalog'); h.tabIndex = -1; h.focus(); }
  loadBox.hidden = true;
  setStatus(status, 'Ачаалж байна…', '');
  try {
    const snap = await getDoc(ref);
    if (snap.exists() && Array.isArray(snap.data().services)) {
      const c = snap.data();
      fill(c.services, Array.isArray(c.packages) ? c.packages : []);
      renderPages(c.services);
      setStatus(status, `Сүүлд хадгалсан: ${fmtDate(c.updatedAt)} · ${c.updatedBy || ''}`, '');
    } else {
      fill(DEFAULTS.treatments, DEFAULTS.packages);
      setStatus(status, 'Каталог хадгалагдаагүй — анхны утгыг харуулж байна. Хадгалбал сайт эндхийг уншина.', '');
    }
    clearErrors(form);
    saved = JSON.stringify(readAll());
    ready = true;
    lock(false);
  } catch (e) {
    setStatus(status, '', '');
    loadMsg.textContent = `${errText(e)} Каталогийг уншиж чадаагүй тул засварлахыг түр хаалаа (анхны утгаар дарж бичихгүйн тулд).`;
    loadBox.hidden = false;
    if (fromRetry) $('#btnCatRetry').focus();
  }
  refreshDirty();
}
$('#btnCatRetry').addEventListener('click', load);

$('#btnCatDefaults').addEventListener('click', async () => {
  if (!ready || saving) return;
  const ok = await dialog({ title: 'Хүснэгтийг анхны утгаар дүүргэх үү?', body: 'Одоогийн мөрүүд анхны жагсаалтаар солигдоно. «Хадгалах» дарах хүртэл сайт өөрчлөгдөхгүй.', confirm: 'Анхны утгаар дүүргэх', cancel: 'Болих', safe: true });
  if (!ok) return;
  fill(DEFAULTS.treatments, DEFAULTS.packages);
  setStatus(status, 'Анхны утга дүүргэгдлээ — хадгалахаа мартуузай.', '');
  announce('Анхны утга дүүргэгдлээ');
  refreshDirty();
});
$('#btnSvcAdd').addEventListener('click', () => {
  if (!ready) return;
  svcSearch.value = ''; svcCat.value = '';
  const tr = svcRow(normSvc({ id: 'svc-' + Date.now().toString(36), c: 'minor' }));
  svcBody.appendChild(tr);
  autoGrow($('textarea', tr));
  applyFilter();
  tr.scrollIntoView({ block: 'center', behavior: scrollMode() });
  $('[data-k="n"]', tr).focus({ preventScroll: true });
  refreshDirty();
});
svcBody.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'undo') {
    const stub = b.closest('tr'), tr = stub._row;
    stub.replaceWith(tr);
    // Шүүлт идэвхтэй бол сэргээсэн мөр нуугдаж фокус алга болохгүйн тулд шүүлтийг цэвэрлэнэ
    if (svcSearch.value || svcCat.value) { svcSearch.value = ''; svcCat.value = ''; }
    applyFilter();
    $('[data-k="n"]', tr).focus();
    announce('Мөр сэргээгдлээ');
    refreshDirty();
    return;
  }
  if (b.dataset.act !== 'rm') return;
  const tr = b.closest('tr');
  const name = $('[data-k="n"]', tr).value.trim() || 'Нэргүй мөр';
  const linked = PAGE_BY_ID[tr.dataset.id] || PRICE_PAGE_BY_ID[tr.dataset.id];
  // Тухайн байранд нь «Буцаах» мөр — фокус түүн дээр (snack-ийн хугацаанаас хамаарахгүй)
  const stub = document.createElement('tr');
  stub.className = 'stub';
  stub._row = tr;
  stub.innerHTML = `<td colspan="7"><span>«${esc(name)}» хасагдлаа${linked ? ` — ${esc(linked)} хуудастай холбоотой байсан; түр нуух бол «Нуух»` : ''}. «Хадгалах» дарах хүртэл сайтад нөлөөгүй.</span> <button class="btn btn--outline btn--sm" type="button" data-act="undo">Буцаах</button></td>`;
  tr.replaceWith(stub);
  applyFilter();
  $('[data-act="undo"]', stub).focus();
  announce(`«${name}» мөр хасагдлаа. Буцаах товч дээр байна.`);
  refreshDirty();
});
[svcBody, pkgBody].forEach((tb) => tb.addEventListener('change', (e) => {
  if (e.target.matches('[data-k="hidden"]')) e.target.closest('tr').classList.toggle('is-hidden', e.target.checked);
}));
form.addEventListener('input', (e) => {
  if (e.target === svcSearch) return;
  clearFieldError(e.target);
  if (e.target.matches('[data-k="n"]')) labelRow(e.target.closest('tr'));
  refreshDirty();
});
form.addEventListener('change', (e) => { if (e.target === svcCat) return; refreshDirty(); });

async function save() {
  if (!session.user || saving) return;
  if (!ready) { snack('Каталог ачаалагдаагүй тул хадгалах боломжгүй.', { error: true }); return; }
  const all = readAll();
  const services = all.services.map(normSvc).filter((s) => s.n);
  const packages = all.packages.map(normPkg);
  if (services.length > 200) { showErrors(errBox, [{ msg: `Үйлчилгээ 200-аас ихгүй байна (одоо ${services.length}).` }], form); return; }
  clearErrors(form);
  if (!services.some((s) => !s.hidden)) {
    const ok = await dialog({ title: 'Нэг ч үйлчилгээ харагдахгүй болно', body: 'Сайтын «Онцлох эмчилгээ» жагсаалт хоосон гарна. Үргэлжлүүлэх үү?', confirm: 'Тэгсэн ч хадгалах', cancel: 'Болих', danger: true });
    if (!ok) return;
  }
  const restore = captureFocus(form);   // Ctrl/⌘+S дарсан нүд рүү буцна (мөрүүд дахин зурагдана)
  saving = true;
  lock(true);   // хадгалах явцад бичсэн текст алга болохгүйн тулд
  setStatus(status, 'Хадгалж байна…', '');
  try {
    await setDoc(ref, { services, packages, updatedAt: serverTimestamp(), updatedBy: session.user.email });
    const dropped = all.services.length - services.length;
    fill(services, packages);
    saved = JSON.stringify(readAll());
    renderPages(services);
    setStatus(status, `Хадгалагдлаа (${services.length} үйлчилгээ, ${packages.length} багц${dropped ? `; нэргүй ${dropped} мөр хасагдлаа` : ''}) — сайт дээр дараагийн ачааллаас харагдана.`, 'ok');
    snack('Каталог хадгалагдлаа');
  } catch (err) { setStatus(status, errText(err), 'err'); snack(errText(err), { error: true }); }
  finally { saving = false; lock(false); refreshDirty(); restore(btnSave); }
}
form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
registerForm('catalog', {
  isDirty, save,
  discard: () => { if (saving || !saved) return; const s = JSON.parse(saved); fill(s.services, s.packages); clearErrors(form); refreshDirty(); },
  reset: () => { ready = false; saved = ''; lock(true); clearErrors(form); setStatus(status, '', ''); },
  anchor: $('#catActions'),
});

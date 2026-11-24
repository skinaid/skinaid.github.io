/* ==========================================================================
   SKIN AID admin — Модуль: Үйлчилгээ / Багц (settings/catalog)
   Хайлт + ангиллын шүүлт (зөвхөн харагдацад — хадгалахад бүх мөр орно), мөр устгахад «Буцаах».
   ========================================================================== */
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db, $, $$, esc, str, fmtDate, errText, session, setStatus, DEFAULTS, CATS } from './core.js?v=a484f97e';
import { ICON, dialog, snack, registerForm, refreshDirty, showErrors, clearErrors, clearFieldError, autoGrow } from './ui.js?v=29f3ef30';
import { normSearch } from './lib.js?v=b23c61fb';
import { renderPages } from './m-pages.js?v=e68e259c';

const ref = doc(db, 'settings', 'catalog');
const form = $('#catForm'), svcBody = $('#svcTable tbody'), pkgBody = $('#pkgTable tbody'), status = $('#catStatus'), errBox = $('#catErr');
const btnSave = $('#btnSaveCat'), svcSearch = $('#svcSearch'), svcCat = $('#svcCat'), svcMeta = $('#svcMeta');
let saved = '';       // сүүлд ачаалсан/хадгалсан хүснэгтийн тамга
let ready = false;    // ачаалал амжилтгүй бол хадгалахгүй (анхны утгаар бодит каталогийг дарж бичихгүй)

const catOptions = (sel) => Object.entries(CATS).map(([k, v]) => `<option value="${esc(k)}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
svcCat.insertAdjacentHTML('beforeend', catOptions(''));
// Нийтлэгдсэн эмчилгээний хуудастай холбоотой үйлчилгээ (build: admin/pages-status.js) — зөвхөн харуулна
const PAGE_BY_ID = {}, PRICE_PAGE_BY_ID = {};
((window.SKINAID_PAGES_STATUS || {}).pages || []).forEach((p) => {
  if (!p.url) return;
  p.catalogIds.forEach((id) => { PAGE_BY_ID[id] = p.url; });
  (p.priceIds || p.catalogIds).forEach((id) => { PRICE_PAGE_BY_ID[id] = PRICE_PAGE_BY_ID[id] || p.url; });
});

const svcRow = (s) => {
  const tr = document.createElement('tr');
  tr.dataset.id = s.id; if (s.hidden) tr.classList.add('is-hidden');
  const page = PAGE_BY_ID[s.id] || PRICE_PAGE_BY_ID[s.id];
  tr.innerHTML = `
    <td class="c-cat"><select aria-label="Ангилал" data-k="c">${catOptions(s.c)}</select></td>
    <td class="c-name"><input type="text" aria-label="Нэр" data-k="n" maxlength="120">${page ? `<a class="svc-page" href="${esc(page)}" target="_blank" rel="noopener" title="Энэ үйлчилгээний үнэ эмчилгээний хуудсанд ч харагдана">↗ ${esc(page)}</a>` : ''}</td>
    <td class="c-desc"><textarea rows="1" aria-label="Тайлбар" data-k="d" maxlength="300"></textarea></td>
    <td class="c-time"><input type="text" aria-label="Хугацаа" data-k="t" maxlength="30"></td>
    <td class="c-price"><input type="text" aria-label="Үнэ" data-k="p" maxlength="40"></td>
    <td class="c-hide"><input type="checkbox" aria-label="Нуух" data-k="hidden"${s.hidden ? ' checked' : ''}></td>
    <td class="c-hide"><button class="btn-icon" type="button" data-act="rm" aria-label="Мөр устгах" title="Мөр устгах">${ICON.trash}</button></td>`;
  $('[data-k="n"]', tr).value = s.n; $('[data-k="d"]', tr).value = s.d; $('[data-k="t"]', tr).value = s.t; $('[data-k="p"]', tr).value = s.p;
  return tr;
};
const pkgRow = (p) => {
  const tr = document.createElement('tr');
  tr.dataset.id = p.id; if (p.hidden) tr.classList.add('is-hidden');
  tr.innerHTML = `
    <td>${esc(p.id)}</td>
    <td class="c-name"><input type="text" aria-label="Багцын нэр" data-k="name" maxlength="60"></td>
    <td class="c-price"><input type="text" aria-label="Үнэ" data-k="price" maxlength="40"></td>
    <td class="c-hide"><input type="checkbox" aria-label="Нуух" data-k="hidden"${p.hidden ? ' checked' : ''}></td>`;
  $('[data-k="name"]', tr).value = p.name; $('[data-k="price"]', tr).value = p.price;
  return tr;
};
const normSvc = (s) => ({ id: str(s && s.id, 40) || ('svc-' + Date.now().toString(36)), c: CATS[s && s.c] ? s.c : 'minor', n: str(s && s.n, 120), d: str(s && s.d, 300), t: str(s && s.t, 30), p: str(s && s.p, 40), hidden: !!(s && s.hidden) });
const normPkg = (p) => ({ id: str(p && p.id, 10), name: str(p && p.name, 60), price: str(p && p.price, 40), hidden: !!(p && p.hidden) });
const readRows = (tbody, keys) => $$('tr', tbody).map((tr) => {
  const o = { id: tr.dataset.id };
  keys.forEach((k) => { const el = $(`[data-k="${k}"]`, tr); o[k] = el ? (el.type === 'checkbox' ? el.checked : el.value) : ''; });
  return o;
});
const readAll = () => ({ services: readRows(svcBody, ['c', 'n', 'd', 't', 'p', 'hidden']), packages: readRows(pkgBody, ['name', 'price', 'hidden']) });
const isDirty = () => ready && JSON.stringify(readAll()) !== saved;

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
  const rows = $$('tr', svcBody);
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
  ready = false;
  btnSave.disabled = true;
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
    saved = JSON.stringify(readAll());
    ready = true;
    btnSave.disabled = false;
  } catch (e) {
    setStatus(status, `${errText(e)} Каталогийг уншиж чадаагүй тул хадгалахыг түр хаалаа.`, 'err');
    snack('Каталогийг ачаалж чадсангүй.', { error: true, action: 'Дахин оролдох', onAction: load });
  }
  refreshDirty();
}

$('#btnCatDefaults').addEventListener('click', async () => {
  if (!ready) return;
  const ok = await dialog({ title: 'Хүснэгтийг анхны утгаар дүүргэх үү?', body: 'Одоогийн мөрүүд анхны жагсаалтаар солигдоно. «Хадгалах» дарах хүртэл сайт өөрчлөгдөхгүй.', confirm: 'Анхны утгаар дүүргэх', cancel: 'Болих' });
  if (!ok) return;
  fill(DEFAULTS.treatments, DEFAULTS.packages);
  setStatus(status, 'Анхны утга дүүргэгдлээ — хадгалахаа мартуузай.', '');
  refreshDirty();
});
$('#btnSvcAdd').addEventListener('click', () => {
  if (!ready) return;
  svcSearch.value = ''; svcCat.value = '';
  const tr = svcRow(normSvc({ id: 'svc-' + Date.now().toString(36), c: 'minor' }));
  svcBody.appendChild(tr);
  autoGrow($('textarea', tr));
  applyFilter();
  tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
  $('[data-k="n"]', tr).focus({ preventScroll: true });
  refreshDirty();
});
svcBody.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act="rm"]'); if (!b) return;
  const tr = b.closest('tr');
  const next = tr.nextElementSibling;
  const name = $('[data-k="n"]', tr).value.trim() || 'Нэргүй мөр';
  const linked = PAGE_BY_ID[tr.dataset.id] || PRICE_PAGE_BY_ID[tr.dataset.id];
  const focusTo = $('[data-act="rm"]', next || tr.previousElementSibling || tr) ;
  tr.remove();
  applyFilter();
  if (focusTo && focusTo.isConnected) focusTo.focus(); else $('#btnSvcAdd').focus();
  refreshDirty();
  snack(`«${name}» мөр хасагдлаа${linked ? ` (${linked} хуудастай холбоотой — түр нуух бол «Нуух»)` : ''}. «Хадгалах» дарах хүртэл сайтад нөлөөгүй.`, {
    action: 'Буцаах',
    onAction: () => { if (next && next.isConnected) svcBody.insertBefore(tr, next); else svcBody.appendChild(tr); applyFilter(); $('[data-k="n"]', tr).focus(); refreshDirty(); },
  });
});
[svcBody, pkgBody].forEach((tb) => tb.addEventListener('change', (e) => {
  if (e.target.matches('[data-k="hidden"]')) e.target.closest('tr').classList.toggle('is-hidden', e.target.checked);
}));
form.addEventListener('input', (e) => { if (e.target === svcSearch) return; clearFieldError(e.target); refreshDirty(); });
form.addEventListener('change', (e) => { if (e.target === svcCat) return; refreshDirty(); });

async function save() {
  if (!ready) { snack('Каталог ачаалагдаагүй тул хадгалах боломжгүй.', { error: true, action: 'Дахин ачаалах', onAction: load }); return; }
  const all = readAll();
  const services = all.services.map(normSvc).filter((s) => s.n);
  const packages = all.packages.map(normPkg);
  if (services.length > 200) { showErrors(errBox, [{ msg: `Үйлчилгээ 200-аас ихгүй байна (одоо ${services.length}).` }], form); return; }
  clearErrors(form);
  if (!services.some((s) => !s.hidden)) {
    const ok = await dialog({ title: 'Нэг ч үйлчилгээ харагдахгүй болно', body: 'Сайтын «Онцлох эмчилгээ» жагсаалт хоосон гарна. Үргэлжлүүлэх үү?', confirm: 'Тэгсэн ч хадгалах', cancel: 'Болих', danger: true });
    if (!ok) return;
  }
  btnSave.disabled = true;
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
  finally { btnSave.disabled = false; refreshDirty(); }
}
form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
registerForm('catalog', {
  isDirty, save,
  discard: () => { if (!saved) return; const s = JSON.parse(saved); fill(s.services, s.packages); clearErrors(form); refreshDirty(); },
  anchor: $('#catActions'),
});

/* ==========================================================================
   SKIN AID admin — Модуль: Үйлчилгээ / Багц (settings/catalog)
   Хайлт + ангиллын шүүлт (зөвхөн харагдацад — хадгалахад бүх мөр орно). Мөр устгахад тухайн байранд нь
   «Буцаах» товчтой мөр үлдэнэ (гарын хэрэглэгч шууд хүрнэ; хадгалах/дахин дүүргэхэд арилна).
   ========================================================================== */
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db, $, $$, esc, str, fmtDate, errText, session, setStatus, DEFAULTS, CATS, scrollMode } from './core.js?v=2c361933';
import { ICON, dialog, snack, announce, registerForm, refreshDirty, showErrors, clearErrors, clearFieldError, autoGrow, captureFocus } from './ui.js?v=46f0448f';
import { normSearch } from './lib.js?v=a9638bd3';
import { renderPages } from './m-pages.js?v=26a525a2';
import { api, apiMsg } from './messenger-api.js?v=51b2e3b7';
import { UB_LINKS, DESC_MAX, applyUbCatalog, fetchUbServices, siteHidden, ubLinkIds } from '../assets/js/ub-catalog.js?v=89ec0850';
import { API_BASE, PUBLISHABLE_KEY } from '../assets/js/ubbeauty-config.js?v=8eb0f74a';

const ref = doc(db, 'settings', 'catalog');
const form = $('#catForm'), svcBody = $('#svcTable tbody'), pkgBody = $('#pkgTable tbody'), status = $('#catStatus'), errBox = $('#catErr');
const btnSave = $('#btnSaveCat'), svcSearch = $('#svcSearch'), svcCat = $('#svcCat'), svcMeta = $('#svcMeta');
const loadBox = $('#catLoad'), loadMsg = $('#catLoadMsg');
let saved = '';       // сүүлд ачаалсан/хадгалсан хүснэгтийн тамга
let ready = false;    // ачаалал амжилтгүй бол хадгалахгүй (анхны утгаар бодит каталогийг дарж бичихгүй)
let saving = false;
// UB Beauty: үнэ, хугацааны эх (assets/js/ub-catalog.js). ub = сүүлд татсан жагсаалт (null = татаагүй/амжилтгүй),
// ubMeta = мөрийн id → { ub, ubOff } (UB татаж чадаагүй үед хадгалсан утгаар hidden-ийг тооцно)
let ub = null;
const ubMeta = new Map();
/** UB Beauty-д нийтэд нуусан үнэ (admin_private/ub_prices — зөвхөн admin уншина): мөрийн id → '₮80,000'.
 *  Үнийн талбарын PLACEHOLDER-т л харуулна — утга (value) биш тул хадгалахад settings/catalog руу (нийтэд) ОРОХГҮЙ. */
let privatePrices = {};
/** Мөрийн UB Beauty-ийн холбоо: статик UB_LINKS эсвэл автоматаар нэмэгдсэн `ub-…` мөрийн хадгалсан ub (ubMeta) */
const linkOf = (id) => UB_LINKS[id] || ubMeta.get(id)?.ub || null;
const privateRef = doc(db, 'admin_private', 'ub_prices');
const PRIVATE_TITLE = 'Үйлчлүүлэгчдэд нуусан үнэ (UB Beauty «Үнийг нийтэд харуулах» унтраалттай) — зөвхөн танд харагдана';
function showPrivatePrice(tr) {
  const id = tr.dataset.id, input = $('[data-k="p"]', tr);
  if (!input) return;
  const v = !input.value && linkOf(id) ? privatePrices[id] : '';
  input.placeholder = v || '';   // тасархай хүрээ + tooltip = «нуусан» (нарийн баганад текст тасрахгүй)
  input.classList.toggle('is-private', !!v);
  if (v) { input.title = PRIVATE_TITLE; input.setAttribute('aria-description', 'Үйлчлүүлэгчдэд нуусан үнэ: ' + v); }
}
async function loadPrivatePrices() {
  try {
    const snap = await getDoc(privateRef);
    const p = snap.exists() ? snap.data().prices : null;
    privatePrices = p && typeof p === 'object' ? p : {};
    return snap.exists() ? snap.data().updatedAt : null;
  } catch (_) { privatePrices = {}; return null; }
}
// UB Beauty-ийн өөрчлөлт хадгалагдаагүй (зөвхөн хувилбар `v` өөрчлөгдсөн бол хүснэгтийн DOM ижил тул тусад нь тэмдэглэнэ)
let ubPending = false;
const ubBox = $('#ubSync'), ubMsg = $('#ubSyncMsg'), btnUb = $('#btnUbSync');

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
  const linked = Boolean(linkOf(s.id)), off = linked && ubMeta.get(s.id)?.ubOff === true;
  const multi = linked && linkOf(s.id).length > 1;
  tr.dataset.id = s.id; if (s.hidden || off) tr.classList.add('is-hidden');
  const page = PAGE_BY_ID[s.id] || PRICE_PAGE_BY_ID[s.id];
  const tag = !linked ? '' : off
    ? '<span class="ub-tag" data-tone="off" title="Холбоотой үйлчилгээ UB Beauty-д идэвхгүй эсвэл захиалж болохгүй — сайтаас нуугдана">UB Beauty-д идэвхгүй</span>'
    : `<span class="ub-tag" title="${esc(ubTitle(s.id))}">UB Beauty${multi ? ` · ${variantCount(s.id)} сонголт` : ''}</span>`;
  const ro = linked ? ' readonly title="UB Beauty-гаас — os.ubbeauty.mn-д засна"' : '';
  // Тайлбар: ганц үйлчилгээтэй мөрөнд UB Beauty-гаас (түгжээтэй); олон хувилбартай мөрөнд бүлгийн товч сайтынх
  const roDesc = linked && !multi && ubMeta.get(s.id)?.ubD ? ' readonly title="UB Beauty-ийн тайлбар — os.ubbeauty.mn → Тохиргоо → Үйлчилгээ-д засна"' : '';
  tr.innerHTML = `
    <td class="c-cat"><select data-k="c"${linked ? ' disabled title="Ангилал UB Beauty-гаас — os.ubbeauty.mn-д засна"' : ''}>${catOptions(s.c)}</select></td>
    <td class="c-name"><input type="text" aria-label="Үйлчилгээний нэр" data-k="n" maxlength="120"${linked && !multi ? ' readonly title="Нэр UB Beauty-гаас — os.ubbeauty.mn → Тохиргоо → Үйлчилгээ-д засна"' : ''}>${tag}${page ? `<a class="svc-page" href="${esc(page)}" target="_blank" rel="noopener" title="Энэ үйлчилгээний үнэ эмчилгээний хуудсанд ч харагдана">↗ ${esc(page)}</a>` : ''}</td>
    <td class="c-desc"><textarea rows="1" data-k="d" maxlength="${DESC_MAX}"${roDesc}></textarea></td>
    <td class="c-time"><input type="text" data-k="t" maxlength="30"${ro}></td>
    <td class="c-price"><input type="text" data-k="p" maxlength="40"${ro}></td>
    <td class="c-hide"><input type="checkbox" data-k="hidden"${s.hidden ? ' checked' : ''}></td>
    <td class="c-hide"><button class="btn-icon btn-icon--danger" type="button" data-act="rm" title="Мөр устгах">${ICON.trash}</button></td>`;
  $('[data-k="n"]', tr).value = s.n; $('[data-k="d"]', tr).value = s.d; $('[data-k="t"]', tr).value = s.t; $('[data-k="p"]', tr).value = s.p;
  labelRow(tr);
  showPrivatePrice(tr);
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
// hidden = сайтын «Нуух» сонголт (hiddenSite); эцсийн hidden-ийг (UB Beauty-д идэвхгүй бол ч нуух) finalize() тооцно
const normSvc = (s) => ({ id: str(s && s.id, 40) || ('svc-' + Date.now().toString(36)), c: CATS[s && s.c] ? s.c : 'minor', n: one(s && s.n, 120), d: one(s && s.d, DESC_MAX), t: one(s && s.t, 30), p: one(s && s.p, 40), hidden: siteHidden(s) });
/** Хадгалах мөрүүд: hiddenSite, UB Beauty-ийн t/p/ub/ubOff, эцсийн hidden (сайт, build, бот зөвхөн hidden-ийг уншина) */
function finalize(rows) {
  // Автомат (`ub-…`) мөрийн холбоог ubMeta-аас буцааж залгана (хүснэгтээс уншихад ub талбар байдаггүй)
  const base = rows.map((r) => ({ ...r, hiddenSite: r.hidden, ...(ubMeta.get(r.id)?.ub ? { ub: ubMeta.get(r.id).ub } : {}) }));
  if (ub) { const res = applyUbCatalog(base, ub); if (res.ok) return res.services; }
  return base.map((r) => {
    const m = linkOf(r.id) && ubMeta.get(r.id);
    if (!m) return r;
    const out = { ...r, ub: m.ub, ubOff: m.ubOff, hidden: r.hiddenSite || m.ubOff };
    if (m.ubD) out.ubD = true;
    if (m.v) out.v = m.v;   // UB татаж чадаагүй үед сүүлд хадгалсан хувилбаруудыг алдахгүй
    return out;
  });
}
/** Ирсэн (эсвэл UB-ээр тооцсон) мөрүүдээс ubMeta-г шинэчилнэ */
function rememberUb(services) {
  ubMeta.clear();
  for (const s of services) {
    const ids = ubLinkIds(s);
    if (ids) ubMeta.set(s.id, { ub: [...ids], ubOff: s.ubOff === true, ubD: s.ubD === true, v: Array.isArray(s.v) && s.v.length ? s.v : null });
  }
}
const variantCount = (id) => ubMeta.get(id)?.v?.length || linkOf(id)?.length || 0;
/** «UB Beauty» тэмдгийн тайлбар: олон хувилбартай мөрөнд хувилбар бүрийн нэр · үнэ */
function ubTitle(id) {
  const v = ubMeta.get(id)?.v;
  const head = 'Үнэ, хугацаа, тайлбарыг UB Beauty-гаас авна — os.ubbeauty.mn → Тохиргоо → Үйлчилгээ';
  return v ? head + '\n' + v.map((x) => `• ${x.n}${x.p ? ` — ${x.p}` : ''}`).join('\n') : head;
}
function ubNote(text, tone, retry) {
  ubBox.hidden = false; ubBox.dataset.tone = tone || '';
  ubMsg.textContent = text;
  btnUb.hidden = false; btnUb.textContent = retry ? 'Дахин оролдох' : 'UB Beauty-гээс шинэчлэх';
}
const UB_REASON = { ub_empty: 'жагсаалт хоосон ирсэн', ub_mismatch: 'холбоотой үйлчилгээний ихэнх нь олдсонгүй' };
/** UB Beauty-г татаж мөрүүдэд тавина. @returns {Promise<{ services: object[], changed: number } | null>} */
async function pullUb(rows) {
  try {
    ub = await fetchUbServices({ apiBase: API_BASE, key: PUBLISHABLE_KEY, timeoutMs: 8000 });
  } catch (e) {
    ub = null;
    ubNote('UB Beauty-д холбогдож чадсангүй — холбоотой мөрийн үнэ, хугацаа сүүлд хадгалсан хэвээр байна.', 'warn', true);
    return null;
  }
  const res = applyUbCatalog(rows, ub);
  if (!res.ok) {
    ubNote(`UB Beauty-ийн ${UB_REASON[res.reason] || 'хариу буруу'} тул шинэчлээгүй (${res.present}/${res.expected}). Сайт сүүлд хадгалсан утгаараа байна.`, 'warn', true);
    ub = null;
    return null;
  }
  const r = res.report;
  const total = res.services.filter((x) => !x.hidden).length;
  const tail = `Сайтад ${total} үйлчилгээ (UB Beauty-ийн толь)${r.added?.length ? ` · шинээр нэмэгдсэн ${r.added.length}` : ''}${r.removed?.length ? ` · UB Beauty-д байхгүй тул хасагдсан ${r.removed.length}` : ''}${r.off.length ? ` · UB Beauty-д идэвхгүй ${r.off.length}` : ''}${r.unlinked.length ? ` · гараар нэмсэн ${r.unlinked.length}` : ''}.`;
  ubNote(res.changed.length
    ? `UB Beauty-д ${res.changed.length} мөрийн үнэ/хугацаа/төлөв өөрчлөгдсөн — «Хадгалах» дарж сайтад оруулна. ${tail}`
    : `UB Beauty-тэй тохирч байна. ${tail}`, res.changed.length ? 'warn' : '', false);
  return { services: res.services, changed: res.changed.length };
}
const normPkg = (p) => ({ id: str(p && p.id, 10), name: one(p && p.name, 60), price: one(p && p.price, 40), hidden: !!(p && p.hidden) });
const readRows = (tbody, keys) => $$('tr[data-id]', tbody).map((tr) => {
  const o = { id: tr.dataset.id };
  keys.forEach((k) => { const el = $(`[data-k="${k}"]`, tr); o[k] = el ? (el.type === 'checkbox' ? el.checked : el.value) : ''; });
  return o;
});
const readAll = () => ({ services: readRows(svcBody, ['c', 'n', 'd', 't', 'p', 'hidden']), packages: readRows(pkgBody, ['name', 'price', 'hidden']) });
const isDirty = () => ready && (ubPending || JSON.stringify(readAll()) !== saved);
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
    const [snap] = await Promise.all([getDoc(ref), loadPrivatePrices()]);
    let services, packages;
    if (snap.exists() && Array.isArray(snap.data().services)) {
      const c = snap.data();
      services = c.services; packages = Array.isArray(c.packages) ? c.packages : [];
      renderPages(c.services);
      const synced = c.ubSyncedAt ? ` · UB Beauty-гээс автоматаар: ${fmtDate(c.ubSyncedAt)}` : '';
      setStatus(status, `Сүүлд хадгалсан: ${fmtDate(c.updatedAt)} · ${c.updatedBy || ''}${synced}`, '');
    } else {
      services = DEFAULTS.treatments; packages = DEFAULTS.packages;
      setStatus(status, 'Каталог хадгалагдаагүй — анхны утгыг харуулж байна. Хадгалбал сайт эндхийг уншина.', '');
    }
    rememberUb(services);
    fill(services, packages);
    clearErrors(form);
    saved = JSON.stringify(readAll());   // хадгалсан төлөв — UB Beauty-ийн өөрчлөлт «хадгалаагүй» гэж харагдана
    const pulled = await pullUb(services);
    ubPending = Boolean(pulled && pulled.changed);
    if (ubPending) { rememberUb(pulled.services); fill(pulled.services, packages); }
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

// «UB Beauty-гээс шинэчлэх»: дахин татаж мөрүүдэд тавина. Өөр хадгалаагүй засвар байгаагүй бол шууд хадгална
// (сайт, Messenger бот дараагийн ачааллаас шинэ утгыг авна); байвал хадгалахыг хэрэглэгчид үлдээнэ.
btnUb.addEventListener('click', async () => {
  if (!ready || saving) return;
  const clean = !isDirty();
  btnUb.disabled = true;
  try {
    const all = readAll();
    const pulled = await pullUb(finalize(all.services.map(normSvc)));
    if (!pulled) return;
    rememberUb(pulled.services);
    ubPending = ubPending || pulled.changed > 0;
    const restore = captureFocus(form);
    fill(pulled.services, all.packages);
    restore(btnUb);
    refreshDirty();
    if (pulled.changed && clean) await save();
  } finally { btnUb.disabled = false; }
});

$('#btnCatDefaults').addEventListener('click', async () => {
  if (!ready || saving) return;
  const ok = await dialog({ title: 'Хүснэгтийг анхны утгаар дүүргэх үү?', body: 'Одоогийн мөрүүд анхны жагсаалтаар солигдоно. «Хадгалах» дарах хүртэл сайт өөрчлөгдөхгүй.', confirm: 'Анхны утгаар дүүргэх', cancel: 'Болих', safe: true });
  if (!ok) return;
  const res = ub ? applyUbCatalog(DEFAULTS.treatments, ub) : null;
  let rows;
  if (res && res.ok) { rows = res.services; rememberUb(rows); }
  else {
    // UB татаж чадаагүй: холбоотой мөрийн UB-ийн утгыг (t, p, d, хувилбар, идэвхгүй) одоогийн хүснэгт/ubMeta-аас хадгална
    const cur = new Map(readAll().services.map((s) => [s.id, s]));
    rows = DEFAULTS.treatments.map((t) => {
      const c = linkOf(t.id) && cur.get(t.id);
      return c ? { ...t, t: c.t, p: c.p, d: ubMeta.get(t.id)?.ubD ? c.d : t.d } : t;
    });
  }
  fill(rows, DEFAULTS.packages);
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
  const services = finalize(all.services.map(normSvc).filter((s) => s.n));
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
    rememberUb(services);
    ubPending = false;
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
  discard: () => { if (saving || !saved) return; ubPending = false; const s = JSON.parse(saved); fill(s.services, s.packages); clearErrors(form); refreshDirty(); },
  reset: () => { ready = false; saved = ''; ubPending = false; lock(true); clearErrors(form); setStatus(status, '', ''); },
  anchor: $('#catActions'),
});

/* ---------- Нуусан үнэ (UB Beauty нууц түлхүүрээр, сервер) ---------- */
const btnPrivate = $('#btnUbPrices');
if (btnPrivate) btnPrivate.addEventListener('click', async () => {
  if (!ready) return;
  btnPrivate.disabled = true;
  setStatus(status, 'Нуусан үнийг UB Beauty-гээс шинэчилж байна…', '');
  try {
    const r = await api('ub_prices', {}, { timeoutMs: 30_000 });
    await loadPrivatePrices();
    $$('tr[data-id]', svcBody).forEach(showPrivatePrice);
    const n = Object.keys(privatePrices).length;
    const msg = r.throttled ? 'Саяхан шинэчилсэн — хэдэн секундын дараа дахин оролдоно уу.' : `Нуусан үнэ шинэчлэгдлээ (${n} үйлчилгээ). Зөвхөн танд харагдана.`;
    setStatus(status, msg, r.throttled ? '' : 'ok');
    announce(msg);
  } catch (e) {
    const msg = e && e.apiCode === 'ub_not_configured'
      ? 'UB Beauty-ийн нууц түлхүүр (UBBEAUTY_SECRET_KEY) серверт тохируулагдаагүй байна.'
      : `Нуусан үнийг шинэчилж чадсангүй: ${apiMsg(e)}`;
    setStatus(status, msg, 'err');
  } finally { btnPrivate.disabled = false; }
});

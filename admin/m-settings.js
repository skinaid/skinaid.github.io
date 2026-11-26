/* ==========================================================================
   SKIN AID admin — Модуль: Тохиргоо (settings/site)
   ========================================================================== */
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db, $, $$, fmtDate, errText, session, setStatus, str } from './core.js?v=2c361933';
import { registerForm, refreshDirty, showErrors, clearErrors, clearFieldError, snack, attachCounters, refreshCounters, captureFocus } from './ui.js?v=70a601a4';

const form = $('#siteForm'), status = $('#siteStatus'), errBox = $('#siteErr'), btn = $('#btnSaveSite');
const loadBox = $('#siteLoad'), loadMsg = $('#siteLoadMsg');
const ref = doc(db, 'settings', 'site');
let saved = null;     // сүүлд ачаалсан/хадгалсан утга (хадгалаагүй өөрчлөлтийг илрүүлэх)
let ready = false;    // ачаалал амжилтгүй бол хадгалахгүй — хоосон маягтаар бодит утгыг дарж бичихгүй
let saving = false;

const read = () => ({
  hours: $('#s-hours').value, phone: $('#s-phone').value, email: $('#s-email').value,
  bookingEnabled: $('#s-booking').checked, promoEnabled: $('#s-promo').checked,
});
const fill = (s) => {
  $('#s-hours').value = s.hours; $('#s-phone').value = s.phone; $('#s-email').value = s.email;
  $('#s-booking').checked = s.bookingEnabled; $('#s-promo').checked = s.promoEnabled;
  refreshCounters(form);
};
const isDirty = () => ready && !!saved && JSON.stringify(read()) !== JSON.stringify(saved);
/** Засварын хэсгийг түгжинэ (ачаалал амжилтгүй / хадгалж буй үед) — статусын мөр түгжээгүй */
const lock = (on) => { $$(':scope > .panel', form).forEach((p) => { p.inert = on; }); form.classList.toggle('is-locked', on); btn.disabled = on; };
attachCounters(form);
lock(true);

export async function load() {
  if (saving) return;
  const fromRetry = loadBox.contains(document.activeElement);   // «Дахин оролдох» нуугдахад фокус алга болохгүй
  ready = false;
  lock(true);
  if (fromRetry) { const h = $('#h-settings'); h.tabIndex = -1; h.focus(); }
  loadBox.hidden = true;
  setStatus(status, 'Ачаалж байна…', '');
  try {
    const snap = await getDoc(ref);
    const s = snap.exists() ? snap.data() : {};
    saved = {
      hours: typeof s.hours === 'string' ? s.hours : '', phone: typeof s.phone === 'string' ? s.phone : '',
      email: typeof s.email === 'string' ? s.email : '', bookingEnabled: s.bookingEnabled !== false, promoEnabled: s.promoEnabled !== false,
    };
    fill(saved);
    clearErrors(form);
    ready = true;
    lock(false);
    setStatus(status, snap.exists() ? `Сүүлд хадгалсан: ${fmtDate(s.updatedAt)} · ${s.updatedBy || ''}` : 'Одоогоор хадгалсан тохиргоо алга — сайт анхны утгаараа байна.', '');
  } catch (e) {
    setStatus(status, '', '');
    loadMsg.textContent = `${errText(e)} Тохиргоог уншиж чадаагүй тул засварлахыг түр хаалаа (хоосон утгаар дарж бичихгүйн тулд).`;
    loadBox.hidden = false;
    if (fromRetry) $('#btnSiteRetry').focus();
  }
  refreshDirty();
}
$('#btnSiteRetry').addEventListener('click', load);

async function save() {
  if (!session.user || saving) return;
  if (!ready) { snack('Тохиргоо ачаалагдаагүй тул хадгалах боломжгүй.', { error: true }); return; }
  const v = read();
  const data = {
    hours: str(v.hours, 300), phone: str(v.phone, 30), email: str(v.email, 80),
    bookingEnabled: v.bookingEnabled, promoEnabled: v.promoEnabled,
    updatedAt: serverTimestamp(), updatedBy: session.user.email,
  };
  const errs = [];
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errs.push({ msg: 'И-мэйл хаяг буруу байна (жишээ: info@skinaid.mn).', el: $('#s-email') });
  if (data.phone) {
    const digits = data.phone.replace(/[^0-9]/g, '');
    if (!/^[-0-9+ ]+$/.test(data.phone) || digits.length < 7 || digits.length > 12) errs.push({ msg: 'Нэг утасны дугаар оруулна уу (7–12 орон, жишээ: 7600-0505). Хоёр дугаар бичиж болохгүй.', el: $('#s-phone') });
  }
  if (errs.length) { showErrors(errBox, errs, form); setStatus(status, '', ''); return; }
  clearErrors(form);
  const restore = captureFocus(form);   // Ctrl/⌘+S дарсан талбар руу буцна (түгжээ фокусыг алдуулна)
  saving = true;
  lock(true);   // хадгалах явцад бичсэн текст алга болохгүйн тулд
  setStatus(status, 'Хадгалж байна…', '');
  try {
    await setDoc(ref, data);
    saved = { hours: data.hours, phone: data.phone, email: data.email, bookingEnabled: data.bookingEnabled, promoEnabled: data.promoEnabled };
    fill(saved);
    setStatus(status, 'Хадгалагдлаа — сайт дээр дараагийн ачааллаас харагдана.', 'ok');
    snack('Тохиргоо хадгалагдлаа');
  } catch (err) { setStatus(status, errText(err), 'err'); snack(errText(err), { error: true }); }
  finally { saving = false; lock(false); refreshDirty(); restore(btn); }
}

form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
form.addEventListener('input', (e) => { clearFieldError(e.target); refreshDirty(); });
form.addEventListener('change', refreshDirty);
registerForm('settings', {
  isDirty, save,
  discard: () => { if (saving || !saved) return; fill(saved); clearErrors(form); refreshDirty(); },
  reset: () => { ready = false; saved = null; lock(true); clearErrors(form); setStatus(status, '', ''); },
  anchor: $('#siteActions'),
});

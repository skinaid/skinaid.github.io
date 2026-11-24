/* ==========================================================================
   SKIN AID admin — Модуль: Нүүр хуудас (settings/home) — hero + «Зөвлөгөө» картууд
   HTML загвар: /assets/js/home-render.js (сайт, build-тэй ижил). Анхны утга, сайтын зургууд, дотоод хуудсууд,
   repo-ийн хувилбар (rev): /admin/home-data.js (build: content/home.json). Хориотой үг: ./claims.js (build: tools/lib/claims.mjs).
   Хамгаалалт: ачаалал амжилтгүй бол түгжинэ; runTransaction-оор давхар засвар; rev (repo шинэчлэгдсэн) шалгалт.
   ========================================================================== */
import { doc, getDoc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db, $, $$, esc, fmtDate, errText, session, setStatus, msOf } from './core.js?v=a484f97e';
import { ICON, dialog, snack, registerForm, refreshDirty, showErrors, clearErrors, clearFieldError, attachCounters, refreshCounters } from './ui.js?v=29f3ef30';

const HR = window.SKINAID_HOME_RENDER;
const HOME_DATA = window.SKINAID_HOME_DATA || { rev: '', defaults: null, photos: [], internalPaths: [], claimsAllow: [] };
const homeRef = doc(db, 'settings', 'home');
const form = $('#homeForm'), status = $('#homeStatus'), posts = $('#hmPosts'), warnBox = $('#hmWarn'), errBox = $('#homeErr');
const HERO_KEYS = ['badge', 'titlePre', 'titleEm', 'titlePost', 'text', 'btnPrimary', 'btnSecondary'];
const HM_MAX = (HR && HR.LIMITS.posts) || 12;
let findClaims = null, claimsFailed = false;   // ./claims.js ачаалагдахгүй бол зөвхөн хориотой үгийн анхааруулга алга (мэдэгдэнэ)
import('./claims.js?v=b71d5c91').then((m) => { findClaims = m.findClaims; renderAux(); }).catch(() => { claimsFailed = true; renderAux(); });
// Маягт аль хувилбар дээр суурилсан бэ: Firestore doc-ийн updatedAt (millis; doc байхгүй бол null) — давхар засварын шалгалт.
// SELF = хадгалсны дараа серверийн цагийг уншиж чадаагүй (дараагийн шалгалтад updatedBy-ээр өөрийн хадгалалт гэж таньна).
const SELF = 'self';
let baseMs = null;
let ready = false;       // эхний ачаалал амжилттай болтол түгжээтэй (repo-ийн утгыг амьд гэж андуурч дарж бичихгүй)
let live = false;        // сайт Firestore-ийн хувилбарыг харуулж байгаа эсэх (repo шинэчлэгдсэн бол үгүй — main.js baseRev)
let saving = false;
let staleDoc = null;     // repo шинэчлэгдсэнээс болж сайтад харагдахгүй байгаа хадгалалт («Хадгалсан хувилбараа ачаалах»)
let baseline = null;     // сүүлд ачаалсан/хадгалсан хувилбар — хадгалаагүй өөрчлөлтийг үүнтэй харьцуулна
let rowSeq = 0;
let lastWarnHTML = null;
const brokenImgs = new Set();

const noV = (p) => String(p || '').replace(/\?.*$/, '');
const adminSrc = (p) => (/^assets\//.test(p) ? '/' + p : p);   // admin /admin/ дээр — сайтын зам root-оос
const photoOf = (img) => HOME_DATA.photos.find((x) => noV(x) === noV(img)) || '';
const newPostId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/** content/home.json-ийн хэлбэрээр харьцуулах (?v-гүй зураг, updatedAt-гүй) */
const homeKey = (x) => JSON.stringify(HR && x ? HR.forRepo(x) : null);
const isDirty = () => ready && !!baseline && homeKey(current().save) !== homeKey(baseline);

/** Засварын хэсгүүдийг түгжинэ; статусын мөр (role=status) түгжээгүй үлдэнэ — дэлгэц уншигч мэдэгдлийг уншина */
const lock = (on) => {
  $$(':scope > .panel', form).forEach((x) => { x.inert = on; });
  form.classList.toggle('is-locked', on);
  ['#btnHomeDefaults', '#btnHomeReload', '#btnHmJson', '#btnSaveHome', '#btnHmAdd'].forEach((id) => { $(id).disabled = on; });
};
lock(true);
attachCounters(form);

/* ---------- Статистик ---------- */
const statRow = (s, i) => {
  const el = document.createElement('div');
  el.className = 'hm-stat';
  el.innerHTML = `
    <span class="hm-stat__no" aria-hidden="true">${i + 1}</span>
    <div class="field"><label for="hs${i}-num">Тоо</label><input id="hs${i}-num" type="text" inputmode="numeric" data-s="num" maxlength="9" aria-describedby="hs${i}-d"></div>
    <div class="field"><label for="hs${i}-suf">Дагавар</label><input id="hs${i}-suf" type="text" data-s="suffix" maxlength="4" placeholder="+"></div>
    <div class="field"><label for="hs${i}-lab">Тайлбар</label><input id="hs${i}-lab" type="text" data-s="label" maxlength="40" data-count-chars></div>
    <span class="sr-only" id="hs${i}-d">${i + 1}-р статистик</span>`;
  ['num', 'suffix', 'label'].forEach((k) => { $(`[data-s="${k}"]`, el).value = (s && s[k]) || ''; });
  attachCounters(el);
  return el;
};

/* ---------- Карт (accordion) ---------- */
const photoGrid = (rid) => `
  <fieldset class="field field--full hm-photos">
    <legend>Зураг</legend>
    <div class="hm-photos__grid">
      <label class="hm-ph hm-ph--none"><input type="radio" name="${rid}-img" value=""><span>Зураггүй</span></label>
      ${HOME_DATA.photos.map((x) => `<label class="hm-ph"><input type="radio" name="${rid}-img" value="${esc(x)}"><img src="${esc(adminSrc(x))}" alt="" loading="lazy" width="120" height="75"><span class="sr-only">${esc(noV(x).replace(/^assets\/img\/photos\//, ''))}</span></label>`).join('')}
      <label class="hm-ph hm-ph--url"><input type="radio" name="${rid}-img" value="__url"><span>Өөр зураг (URL)</span></label>
    </div>
  </fieldset>`;
function postRow(p, { open = false } = {}) {
  const el = document.createElement('article');
  const rid = 'hp' + (++rowSeq);
  el.className = 'hm-post';
  el.dataset.id = p.id || newPostId();
  const photo = p.img ? photoOf(p.img) : '';
  const custom = !!p.img && !photo;
  el.innerHTML = `
    <div class="hm-post__head">
      <button class="hm-post__toggle" type="button" aria-expanded="false" aria-controls="${rid}-body">
        <span class="hm-post__thumb"><img alt="" data-k="thumb" hidden><span data-k="noimg">${ICON.eyeOff}</span></span>
        <span class="hm-post__sum">
          <span class="hm-post__no" data-k="no"></span>
          <span class="hm-post__title" data-k="sumTitle"></span>
          <span class="hm-post__meta" data-k="sumMeta"></span>
        </span>
        <span class="badge hm-post__flag" data-k="flag" hidden>Нуугдсан</span>
        <span class="hm-post__chev">${ICON.chevron}</span>
      </button>
      <div class="hm-post__ctl">
        <button class="btn-icon" type="button" data-act="up">${ICON.up}</button>
        <button class="btn-icon" type="button" data-act="down">${ICON.down}</button>
        <button class="btn-icon btn-icon--danger" type="button" data-act="rm">${ICON.trash}</button>
      </div>
    </div>
    <div class="hm-post__body" id="${rid}-body" hidden>
      <div class="form__grid">
        <div class="field">
          <label for="${rid}-cat">Ангилал</label>
          <input id="${rid}-cat" type="text" data-k="cat" maxlength="30" data-count-chars placeholder="жишээ: Батга">
        </div>
        <div class="field">
          <label for="${rid}-by">Эмчийн нэр</label>
          <input id="${rid}-by" type="text" data-k="by" maxlength="60" data-count-chars placeholder="жишээ: Э.Өнөрсайхан эмч">
        </div>
        <div class="field field--full">
          <label for="${rid}-title">Гарчиг <span class="req" aria-hidden="true">*</span><span class="sr-only">(заавал)</span></label>
          <input id="${rid}-title" type="text" data-k="title" maxlength="120" data-count-chars aria-required="true">
        </div>
        <div class="field field--full">
          <label for="${rid}-text">Товч тайлбар <small>(нэг догол мөр — мөр шилжилт хадгалагдахгүй)</small></label>
          <textarea id="${rid}-text" data-k="text" maxlength="300" data-count-chars></textarea>
        </div>
        <div class="field field--full">
          <label for="${rid}-url">Холбоос <small>(заавал биш)</small></label>
          <p class="hint" id="${rid}-url-h">Facebook пост гэх мэт https://… эсвэл сайтын хуудас: ${esc(HOME_DATA.internalPaths.join(', '))}. Холбоостой карт бүхэлдээ дарагддаг болно.</p>
          <input id="${rid}-url" type="url" data-k="url" maxlength="500" placeholder="https://www.facebook.com/Skinaid.mn/posts/…" aria-describedby="${rid}-url-h">
        </div>
        ${photoGrid(rid)}
        <div class="field field--full" data-k="imgUrlWrap" hidden>
          <label for="${rid}-imgurl">Зургийн шууд холбоос <small>(https://…jpg)</small></label>
          <input id="${rid}-imgurl" type="url" data-k="imgUrl" maxlength="500" placeholder="https://…">
          <p class="hint" data-k="imgState"></p>
        </div>
        <label class="switch field--full"><input type="checkbox" role="switch" data-k="hidden"><span class="switch__track" aria-hidden="true"></span><span><strong>Сайтаас нуух</strong><small>Карт устахгүй, сайтад харагдахгүй.</small></span></label>
      </div>
    </div>`;
  const f = (k) => $(`[data-k="${k}"]`, el);
  const radio = $(`input[name="${rid}-img"][value="${CSS.escape(custom ? '__url' : photo)}"]`, el);
  if (radio) radio.checked = true;
  f('imgUrl').value = custom ? p.img : '';
  ['cat', 'by', 'title', 'text', 'url'].forEach((k) => { f(k).value = p[k] || ''; });
  f('hidden').checked = !!p.hidden;
  const thumb = f('thumb');
  // Зураг биш холбоос (Drive, Facebook пост г.м.) эсвэл хаалттай зураг → анхааруулга (сайтад эвдэрсэн зураг гаргахгүй)
  thumb.addEventListener('error', () => { brokenImgs.add(thumb.getAttribute('src')); syncPost(el); scheduleAux(); });
  thumb.addEventListener('load', () => { if (brokenImgs.delete(thumb.getAttribute('src'))) { syncPost(el); scheduleAux(); } });
  attachCounters(el);
  syncPost(el);
  if (open) setOpen(el, true);
  return el;
}
function setOpen(el, open) {
  $('.hm-post__toggle', el).setAttribute('aria-expanded', String(open));
  $('.hm-post__body', el).hidden = !open;
  el.classList.toggle('is-open', open);
}
const imgOf = (el) => {
  const r = $('input[type="radio"]:checked', el);
  const v = r ? r.value : '';
  return v === '__url' ? $('[data-k="imgUrl"]', el).value.trim() : v;
};
/** Хураангуй мөр, зураг, URL талбар, нуусан төлөв */
function syncPost(el) {
  const f = (k) => $(`[data-k="${k}"]`, el);
  const r = $('input[type="radio"]:checked', el);
  const custom = !!r && r.value === '__url';
  f('imgUrlWrap').hidden = !custom;
  const img = imgOf(el);
  const ok = !!img && !!HR && HR.validImg(img);
  const thumb = f('thumb');
  if (ok && thumb.getAttribute('src') !== adminSrc(img)) {
    thumb.referrerPolicy = /^https:/i.test(img) ? 'no-referrer' : '';
    thumb.src = adminSrc(img);
  }
  const broken = ok && brokenImgs.has(adminSrc(img));
  thumb.hidden = !ok || broken;
  f('noimg').hidden = ok && !broken;
  f('imgState').textContent = !custom ? '' : broken ? 'Зураг ачаалагдсангүй — холбоос зураг биш эсвэл хаалттай байж магадгүй.' : (img && !ok ? 'https://-ээр эхэлсэн зургийн шууд холбоос оруулна уу.' : '');
  f('imgState').classList.toggle('is-err', broken || (!!img && !ok));
  const title = f('title').value.trim();
  f('sumTitle').textContent = title || 'Гарчиггүй карт';
  f('sumTitle').classList.toggle('is-empty', !title);
  f('sumMeta').textContent = [f('cat').value.trim(), f('by').value.trim(), f('url').value.trim() ? 'холбоостой' : ''].filter(Boolean).join(' · ');
  const hidden = f('hidden').checked;
  f('flag').hidden = !hidden;
  el.classList.toggle('is-hidden', hidden);
}
const readPost = (el) => {
  const f = (k) => $(`[data-k="${k}"]`, el);
  return { id: el.dataset.id, cat: f('cat').value, title: f('title').value, text: f('text').value, by: f('by').value, img: imgOf(el), url: f('url').value.trim(), hidden: f('hidden').checked };
};
const readHome = () => {
  const hero = {};
  HERO_KEYS.forEach((k) => { hero[k] = $(`[data-h="${k}"]`, form).value; });
  // «1,200», «1 200» → 1200 (таслалыг сайт өөрөө тавина)
  hero.stats = $$('.hm-stat', form).map((s) => ({ num: $('[data-s="num"]', s).value.replace(/[\s,]/g, ''), suffix: $('[data-s="suffix"]', s).value, label: $('[data-s="label"]', s).value }));
  return { hero, posts: $$('.hm-post', posts).map(readPost) };
};
/** Огт бөглөөгүй шинэ карт (зураг ч сонгоогүй) хадгалахад хасагдана */
const blankPost = (p) => ![p.title, p.cat, p.text, p.by, p.url, p.img].some((x) => String(x || '').trim());
/** norm(readHome()) — posts маягтын дараалалтай; save нь хоосон картгүй */
function current() {
  const raw = readHome();
  const all = HR ? HR.norm(raw) : null;
  return { raw, all, save: all && { hero: all.hero, posts: all.posts.filter((p, i) => !blankPost(raw.posts[i])) } };
}
function fill(n) {
  const h = (n && n.hero) || {};
  HERO_KEYS.forEach((k) => { $(`[data-h="${k}"]`, form).value = h[k] || ''; });
  const stats = (h.stats || []).slice(0, 3);
  while (stats.length < 3) stats.push({ num: '', suffix: '', label: '' });
  $('#hmStats').replaceChildren(...stats.map(statRow));
  posts.replaceChildren(...((n && n.posts) || []).map((p) => postRow(p)));
  clearErrors(form);
  refreshCounters(form);
  renderAux();
}

/* ---------- Шалгалт ---------- */
/** Хадгалахыг хаах алдаа: [{ msg, el, reveal }] */
function homeErrors(raw) {
  const errs = [];
  const h = raw.hero;
  if (![h.titlePre, h.titleEm, h.titlePost].some((x) => x.trim())) errs.push({ msg: 'Гарчиг (h1) хоосон байж болохгүй — дор хаяж нэг хэсгийг бичнэ үү.', el: $('#hm-titlePre') });
  const stats = $$('.hm-stat', form);
  h.stats.forEach((s, i) => {
    if (s.num && !/^\d{1,7}$/.test(s.num)) errs.push({ msg: `${i + 1}-р статистикийн тоо зөвхөн бүхэл тоо (1–7 орон) байна — «K», «+»-ийг дагавар талбарт бичнэ; 4.9 гэх мэт бутархай болохгүй.`, el: $('[data-s="num"]', stats[i]) });
  });
  const rows = $$('.hm-post', posts);
  raw.posts.forEach((p, i) => {
    if (blankPost(p)) return;
    const row = rows[i], f = (k) => $(`[data-k="${k}"]`, row);
    const reveal = () => setOpen(row, true);
    const no = `${i + 1}-р карт`;
    if (!p.title.trim()) errs.push({ msg: `${no}: гарчиг хоосон.`, el: f('title'), reveal });
    if (p.img && !HR.validImg(p.img)) errs.push({ msg: `${no}: зургийн холбоос https://… хэлбэртэй байна.`, el: f('imgUrl'), reveal });
    if (p.url && !HR.validUrl(p.url)) errs.push({ msg: `${no}: холбоос https://… эсвэл сайтын /… хуудас байна (http:// болон бусдыг хүлээн авахгүй).`, el: f('url'), reveal });
    else if (p.url.startsWith('/') && !HOME_DATA.internalPaths.includes(p.url.split(/[?#]/)[0])) {
      errs.push({ msg: `${no}: сайтад «${p.url.split(/[?#]/)[0]}» хуудас алга (байгаа: ${HOME_DATA.internalPaths.join(', ')}).`, el: f('url'), reveal });
    }
  });
  return errs;
}
const FIELD = { badge: 'Тэмдэг', titlePre: 'Гарчиг', titleEm: 'Гарчиг', titlePost: 'Гарчиг', text: 'Тайлбар', btnPrimary: 'Товч', btnSecondary: 'Товч' };
const POST_FIELD = { cat: 'ангилал', title: 'гарчиг', text: 'тайлбар', by: 'эмчийн нэр' };
const fieldName = (k) => {
  let m = /^hero\.(\w+)$/.exec(k); if (m) return FIELD[m[1]] || m[1];
  m = /^hero\.stats\[(\d+)\]$/.exec(k); if (m) return `${+m[1] + 1}-р статистик`;
  m = /^posts\[(\d+)\]\.(\w+)$/.exec(k); if (m) return `${+m[1] + 1}-р карт · ${POST_FIELD[m[2]] || m[2]}`;
  return k;
};
/** Хадгалахыг хаахгүй анхааруулга (хадгалахад асууна). all = norm(readHome()) — картын дугаар маягтын дараалалтай ижил */
function homeWarnings(all) {
  const w = [];
  if (!all) return w;
  if (claimsFailed) w.push('Хориотой үгийн шалгалт (claims.js) ачаалагдсангүй — хуудсыг дахин ачаалж үзнэ үү. Шалгалтгүйгээр хадгалах боломжтой.');
  if (findClaims) {
    for (const [k, t] of HR.texts(all)) {
      for (const c of findClaims(t, HOME_DATA.claimsAllow || [])) w.push(`${fieldName(k)}: «${c.match}» — эрүүл мэндийн сурталчилгаанд хориотой/эрсдэлтэй үг (${c.label}).`);
    }
  }
  const y = all.hero && (all.hero.badge.match(/(?:19|20)\d{2}/) || [])[0];
  if (y) {
    const years = new Date().getFullYear() - Number(y);
    const st = all.hero.stats.find((s) => s.num && /жил/i.test(s.label));
    if (st && Number(st.num) !== years) w.push(`Тэмдэгт ${y} он (${years} жил) гэсэн ч статистикт «${HR.fmtNum(st.num)}${st.suffix} ${st.label}» байна — тоог шалгана уу. Нүүрний зургийн дээрх «… оноос хойш / … жилийн туршлагатай» жижиг картыг энд засдаггүй (хөгжүүлэгчээр).`);
  }
  (all.posts || []).forEach((p, i) => {
    if (p.hidden || !p.img) return;
    if (brokenImgs.has(adminSrc(p.img))) w.push(`${i + 1}-р карт: зураг ачаалагдсангүй — холбоос зураг биш (Drive, Facebook пост г.м.) эсвэл хаалттай байж магадгүй. Сайтад эвдэрсэн зураг харагдана.`);
    else if (/(?:fbcdn\.net|fbsbx\.com)/i.test(p.img)) w.push(`${i + 1}-р карт: Facebook-ийн зургийн холбоос хэсэг хугацааны дараа ажиллахаа больдог — сайтын зургийг сонгох нь найдвартай.`);
  });
  return w;
}

/* ---------- Урьдчилан харах, анхааруулга, дугаар, ↑↓ ---------- */
let auxT = 0;
function renderAux() {
  if (!HR) return;
  const { raw, all, save } = current();
  $('#hmPrevHero').innerHTML = save && save.hero ? HR.hero(save.hero, { titleTag: 'div' }) : '<p class="muted">Гарчиг (h1) хоосон байна.</p>';
  $('#hmPrevPosts').innerHTML = save ? HR.posts(save.posts, { src: adminSrc }) : '';
  const html = homeWarnings(all).map((x) => `<li>${esc(x)}</li>`).join('');
  if (html !== lastWarnHTML) { warnBox.innerHTML = html; lastWarnHTML = html; }   // aria-live: зөвхөн өөрчлөгдөхөд
  const rows = $$('.hm-post', posts);
  rows.forEach((row, i) => {
    const t = $('[data-k="title"]', row).value.trim();
    $('[data-k="no"]', row).textContent = `${i + 1}-р карт`;
    const name = `${i + 1}-р карт${t ? ` «${t}»` : ''}`;
    const up = $('[data-act="up"]', row), down = $('[data-act="down"]', row), rm = $('[data-act="rm"]', row);
    up.setAttribute('aria-label', `${name}-ыг дээш зөөх`); up.title = 'Дээш зөөх'; up.disabled = i === 0;
    down.setAttribute('aria-label', `${name}-ыг доош зөөх`); down.title = 'Доош зөөх'; down.disabled = i === rows.length - 1;
    rm.setAttribute('aria-label', `${name}-ыг устгах`); rm.title = 'Устгах';
  });
  const shown = save ? HR.visiblePosts(save.posts).length : 0;
  $('#hmCount').textContent = `${shown} харагдана · ${raw.posts.length}/${HM_MAX}`;
  $('#btnHmAdd').disabled = !ready || raw.posts.length >= HM_MAX;
  refreshDirty();
}
const scheduleAux = () => { clearTimeout(auxT); auxT = setTimeout(renderAux, 150); };
$('#btnHmPrev').addEventListener('click', (e) => {
  const open = e.currentTarget.getAttribute('aria-expanded') !== 'true';
  e.currentTarget.setAttribute('aria-expanded', String(open));
  e.currentTarget.textContent = open ? 'Нуух' : 'Харах';
  $('.hm-prevpanel').classList.toggle('is-open', open);
});

/** Маягтын дээрх тайлбар: repo шинэчлэгдсэн (stale) эсвэл зочдод харагдаж буй нь Google-ийнхоос өөр (unsynced) */
function showNote(kind, when) {
  const el = $('#hmDiff');
  const msg = kind === 'stale'
    ? `Таны ${when}-ний хадгалалтаас хойш хөгжүүлэгч сайтын үндсэн хувилбарыг шинэчилсэн тул зочдод одоо тэр хувилбар харагдаж байна. Маягтад одоо харагдаж буй хувилбарыг ачааллаа — засаад хадгалбал таны хувилбар дахин гарна.`
    : kind === 'unsynced'
      ? 'Зочдод харагдаж буй (хадгалсан) хувилбар Google-ийн уншдаг үндсэн хувилбараас өөр байна: Google хуучин текстийг харж, нүүр ачаалахад хуучин текст хормын төдий харагдана. «Хөгжүүлэгчид илгээх JSON хуулах» дарж хөгжүүлэгчид илгээнэ үү.'
      : '';
  el.hidden = !msg;
  $('#hmDiffMsg').textContent = msg;
  $('#btnHmLoadSaved').hidden = kind !== 'stale';
}
function showLoadError(msg) {
  $('#hmLoadMsg').textContent = msg;
  $('#hmLoad').hidden = false;
  if (!ready) lock(true);
}

/* ---------- Ачаалах ---------- */
export async function load() {
  if (!HR || !HOME_DATA.defaults) { showLoadError('Нүүр хуудасны скрипт (home-render.js / home-data.js) ачаалагдсангүй — хуудсыг дахин ачаална уу.'); return; }
  if (saving) return;
  if (isDirty() && !(await dialog({ title: 'Хадгалаагүй өөрчлөлтийг хаях уу?', body: 'Хадгалсан хувилбарыг дахин ачаалахад одоогийн засвар алга болно.', confirm: 'Хаяад ачаалах', cancel: 'Засвараа үлдээх', danger: true }))) return;
  $('#hmLoad').hidden = true;
  setStatus(status, 'Ачаалж байна…', '');
  let snap;
  try { snap = await getDoc(homeRef); }
  catch (e) {
    setStatus(status, '', '');
    showLoadError(`${errText(e)} Хадгалсан хувилбарыг уншиж чадаагүй тул ${ready ? 'маягт өмнөх байдлаараа үлдлээ' : 'засварлахыг түр хаалаа (хадгалсан хувилбарыг санамсаргүй дарж бичихгүйн тулд)'}.`);
    return;
  }
  const D = HOME_DATA.defaults;
  const d = snap.exists() ? snap.data() : null;
  baseMs = d ? msOf(d.updatedAt) : null;
  // Admin хадгалснаас хойш repo шинэчлэгдсэн бол сайт repo-ийн хувилбарыг харуулна (main.js) — маягт ч түүнийг
  const stale = !!(d && typeof d.baseRev === 'string' && d.baseRev && HOME_DATA.rev && d.baseRev !== HOME_DATA.rev);
  const n = d && !stale ? HR.norm(d) : null;
  baseline = n ? { hero: n.hero || D.hero, posts: n.posts || D.posts } : D;
  fill(baseline);
  ready = true;
  live = !!n;
  lock(false);
  setStatus(status, d ? `Сүүлд хадгалсан: ${fmtDate(d.updatedAt)} · ${d.updatedBy || ''}` : 'Одоогоор энд хадгалсан зүйл алга — сайт үндсэн хувилбараараа харагдаж байна.', '');
  staleDoc = stale && homeKey(HR.norm(d)) !== homeKey(D) ? d : null;
  if (staleDoc) showNote('stale', fmtDate(d.updatedAt));
  else showNote(live && homeKey(n) !== homeKey(D) ? 'unsynced' : null);
  renderAux();
}

/* ---------- Засварын үйлдлүүд ---------- */
form.addEventListener('input', (e) => {
  if (!ready) return;
  clearFieldError(e.target);
  const row = e.target.closest('.hm-post'); if (row) syncPost(row);
  scheduleAux();
});
form.addEventListener('change', (e) => {
  if (!ready) return;
  const row = e.target.closest('.hm-post'); if (row) syncPost(row);
  scheduleAux();
});
posts.addEventListener('click', (e) => {
  const tg = e.target.closest('.hm-post__toggle');
  if (tg) { const row = tg.closest('.hm-post'); setOpen(row, tg.getAttribute('aria-expanded') !== 'true'); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const row = b.closest('.hm-post');
  if (b.dataset.act === 'rm') {
    // Хадгалах хүртэл сайтад нөлөөгүй тул баталгаажуулах цонхны оронд «Буцаах»
    const next = row.nextElementSibling;
    const title = $('[data-k="title"]', row).value.trim();
    const focusTo = next || row.previousElementSibling;
    row.remove();
    (focusTo ? $('.hm-post__toggle', focusTo) : $('#btnHmAdd')).focus();
    renderAux();
    snack(`${title ? `«${title}»` : 'Гарчиггүй'} карт хасагдлаа. «Хадгалах» дарах хүртэл сайтад нөлөөгүй.`, {
      action: 'Буцаах',
      onAction: () => { if (next && next.isConnected) posts.insertBefore(row, next); else posts.appendChild(row); renderAux(); $('.hm-post__toggle', row).focus(); },
    });
    return;
  }
  if (b.dataset.act === 'up' && row.previousElementSibling) row.previousElementSibling.before(row);
  else if (b.dataset.act === 'down' && row.nextElementSibling) row.nextElementSibling.after(row);
  else return;
  renderAux();
  if (b.disabled) $(`[data-act="${b.dataset.act === 'up' ? 'down' : 'up'}"]`, row).focus(); else b.focus();
});
$('#btnHmAdd').addEventListener('click', () => {
  if (!ready || $$('.hm-post', posts).length >= HM_MAX) return;
  const row = postRow({ id: newPostId(), img: '', hidden: false }, { open: true });
  posts.appendChild(row);
  renderAux();
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  $('[data-k="title"]', row).focus({ preventScroll: true });
});
$('#btnHomeDefaults').addEventListener('click', async () => {
  if (!ready || !HOME_DATA.defaults) return;
  const ok = await dialog({ title: 'Сайтын үндсэн хувилбараар дүүргэх үү?', body: 'Маягт Google-ийн уншдаг үндсэн хувилбараар солигдоно. «Хадгалах» дарах хүртэл сайт өөрчлөгдөхгүй.', confirm: 'Үндсэн хувилбараар дүүргэх', cancel: 'Болих' });
  if (!ok) return;
  fill(HOME_DATA.defaults);
  setStatus(status, 'Үндсэн хувилбар дүүргэгдлээ — хадгалахаа мартуузай.', '');
});
$('#btnHomeReload').addEventListener('click', () => { load(); });
$('#btnHmRetry').addEventListener('click', () => { load(); });
$('#btnHmLoadSaved').addEventListener('click', async () => {
  if (!staleDoc || !ready) return;
  if (isDirty() && !(await dialog({ title: 'Маягтын засварыг солих уу?', body: 'Маягт дээрх хадгалаагүй өөрчлөлт таны өмнөх хадгалалтаар солигдоно.', confirm: 'Солих', cancel: 'Болих', danger: true }))) return;
  const n = HR.norm(staleDoc) || {};
  fill({ hero: n.hero || HOME_DATA.defaults.hero, posts: n.posts || [] });
  showNote(null);
  setStatus(status, 'Таны өмнөх хадгалалт маягтад ачаалагдлаа — хөгжүүлэгчийн шинэчлэлттэй харьцуулж шалгаад хадгална уу.', '');
});
$('#btnHmJson').addEventListener('click', async () => {
  if (!HR) return;
  const raw = readHome();
  const errs = homeErrors(raw);
  if (errs.length) { showErrors(errBox, errs, form); return; }
  const repo = HR.forRepo(current().save);
  if (!repo) return;
  const json = JSON.stringify(repo, null, 2) + '\n';
  const box = $('#hmJson');
  try {
    await navigator.clipboard.writeText(json);
    box.hidden = true;
    snack(`JSON хуулагдлаа (маягт дээрх${isDirty() ? ', ХАДГАЛААГҮЙ' : ''} утга) — хөгжүүлэгчид илгээнэ үү.`);
  } catch (_) {
    box.value = json; box.hidden = false; box.focus(); box.select();
    setStatus(status, 'Автоматаар хуулж чадсангүй — доорх текстийг хуулна уу (Cmd/Ctrl+C).', '');
  }
});

/* ---------- Хадгалах ---------- */
/**
 * Transaction: уншаад шалгаад бичнэ — нөгөө admin хооронд нь хадгалсан бол бичихгүй (force-гүй үед).
 * @returns {Promise<{ok: true} | {conflict: object|null}>}
 */
const saveTx = (payload, force) => runTransaction(db, async (tx) => {
  const cur = await tx.get(homeRef);
  const c = cur.exists() ? cur.data() : null;
  const same = baseMs === SELF ? !!c && c.updatedBy === session.user.email : (c ? msOf(c.updatedAt) : null) === baseMs;
  if (!force && !same) return { conflict: c };
  tx.set(homeRef, payload);
  return { ok: true };
});

async function save() {
  if (!HR || !ready || saving) return;
  const raw = readHome();
  const errs = homeErrors(raw);
  if (errs.length) { showErrors(errBox, errs, form); setStatus(status, '', ''); return; }
  clearErrors(form);
  const { all, save: n } = current();
  const dropped = raw.posts.length - n.posts.length;
  const warns = homeWarnings(all);
  if (warns.length && !(await dialog({ title: `Анхааруулга (${warns.length})`, body: 'Хадгалахаас өмнө шалгана уу:', list: warns, confirm: 'Тэгсэн ч хадгалах', cancel: 'Буцаж засах' }))) return;
  if (!HR.visiblePosts(n.posts).length && !(await dialog({ title: 'Харагдах карт алга', body: 'Сайтын «Зөвлөгөө» хэсэгт карт харагдахгүй (гарчиг, Facebook холбоос үлдэнэ). Үргэлжлүүлэх үү?', confirm: 'Тэгсэн ч хадгалах', cancel: 'Болих' }))) return;
  const btn = $('#btnSaveHome');
  saving = true;
  lock(true);   // хадгалах явцад бичсэн текст алга болохгүйн тулд засварын хэсгийг түгжинэ
  setStatus(status, 'Хадгалж байна…', '');
  try {
    // Энэ хуудсыг нээснээс хойш сайт шинэ хувилбараар (repo-ийн content/home.json) байршсан бол хуучин rev-ээр
    // хадгалбал сайт таны хадгалалтыг үл тоох байсан — одоогийн rev-ийг уншиж, хэрэглэгчээс асууна.
    let rev = HOME_DATA.rev || '';
    try {
      const t = await (await fetch('/admin/home-data.js?_=' + Date.now(), { cache: 'no-store' })).text();
      const liveRev = (t.match(/"rev":\s*"([0-9a-f]*)"/) || [])[1];
      if (liveRev && liveRev !== rev) {
        const ok = await dialog({
          title: 'Сайтын үндсэн хувилбар шинэчлэгдсэн байна',
          body: ['Таныг энэ хуудсыг нээснээс хойш хөгжүүлэгч нүүр хуудсыг шинэчилсэн.', 'Таны хувилбараар хадгалбал тэр шинэчлэлт сайтаас харагдахгүй болно. Хадгалахгүй бол «Хөгжүүлэгчид илгээх JSON хуулах»-аар засвараа хуулж аваад хуудсыг дахин ачаална уу.'],
          confirm: 'Миний хувилбараар хадгалах', cancel: 'Хадгалахгүй', danger: true,
        });
        if (!ok) { setStatus(status, 'Хадгалаагүй — сайтын үндсэн хувилбар шинэчлэгдсэн. Засвар тань маягт дээр хэвээр.', 'err'); return; }
        rev = liveRev;
      }
    } catch (_) { /* сүлжээ — HOME_DATA.rev-ээр үргэлжлүүлнэ */ }
    const payload = { hero: n.hero, posts: n.posts, baseRev: rev, updatedAt: serverTimestamp(), updatedBy: session.user.email };
    let r = await saveTx(payload, false);
    if (!r.ok) {
      const c = r.conflict;
      const who = c ? `${c.updatedBy || 'Өөр хүн'} (${fmtDate(c.updatedAt)})` : 'Өөр хүн';
      const ok = await dialog({
        title: 'Өөр хүн энэ хооронд хадгалсан байна',
        body: [`${who} таныг энэ хуудсыг ачаалснаас хойш нүүр хуудсыг хадгалсан.`, 'Таны хувилбараар хадгалбал тэдний өөрчлөлт алга болно. Хадгалахгүй бол засвар тань маягт дээр үлдэнэ — «Хөгжүүлэгчид илгээх JSON хуулах»-аар хуулж аваад «Дахин ачаалах»-аар тэдний хувилбарыг харж болно.'],
        confirm: 'Миний хувилбараар дарж хадгалах', cancel: 'Хадгалахгүй', danger: true,
      });
      if (!ok) { setStatus(status, 'Хадгалаагүй — өөр хүний хадгалсан хувилбар бий. Таны засвар маягт дээр хэвээр.', 'err'); return; }
      r = await saveTx(payload, true);
    }
    try { const after = await getDoc(homeRef); baseMs = after.exists() ? msOf(after.data().updatedAt) : null; }
    catch (_) { baseMs = SELF; }
    baseline = n;
    fill(n);
    live = true;
    staleDoc = null;
    showNote(homeKey(n) !== homeKey(HOME_DATA.defaults) ? 'unsynced' : null);
    const shown = HR.visiblePosts(n.posts).length;
    setStatus(status, `Хадгалагдлаа (${shown} карт харагдана${dropped ? `; огт бөглөөгүй ${dropped} карт хасагдлаа` : ''}) — сайт дээр дараагийн ачааллаас харагдана.`, 'ok');
    snack('Нүүр хуудас хадгалагдлаа');
  } catch (err) { setStatus(status, errText(err), 'err'); snack(errText(err), { error: true }); }
  finally {
    saving = false;
    lock(false);
    renderAux();
    if (document.activeElement === document.body) btn.focus();
  }
}
form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
registerForm('home', {
  isDirty, save,
  discard: () => { if (baseline) { fill(baseline); setStatus(status, 'Өөрчлөлтийг хаялаа.', ''); } },
  anchor: $('#homeActions'),
});

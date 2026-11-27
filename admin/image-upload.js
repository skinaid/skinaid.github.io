// Image bytes stay in memory until the corresponding content transaction commits.
import { doc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db } from './core.js?v=2c361933';

const pending = new Map();
const maxBytes = 360000;
const endpoint = 'https://www.skinaid.mn/api/content-image?id=';
export const imagePreview = (url) => pending.get(url)?.preview || url;

export function clearImageUploads(urls = pending.keys()) {
  for (const url of urls) {
    pending.delete(url);
  }
}

export function queuedImages(urls) {
  return [...new Set(urls)].filter(url => pending.has(url));
}

export function writeImages(tx, urls) {
  for (const url of urls) {
    const image = pending.get(url);
    if (image) tx.set(doc(db, 'content_images', image.id), { data: image.data, createdAt: serverTimestamp() });
  }
}

async function prepare(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 20_000_000) {
    throw new Error('JPG, PNG эсвэл WebP зураг сонгоно уу. Файл 20 МБ хүртэл байна.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    for (const [maxSide, quality] of [[1800, .88], [1600, .80], [1280, .75], [960, .68]]) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let encoded = canvas.toDataURL('image/webp', quality);
      if (!encoded.startsWith('data:image/webp;base64,')) encoded = canvas.toDataURL('image/jpeg', quality);
      const data = encoded.split(',')[1];
      if (!/^data:image\/(webp|jpeg);base64,/.test(encoded) || !data) break;
      if (data.length <= maxBytes * 4 / 3) return { data, preview: encoded };
    }
  } finally {
    bitmap.close();
  }
  throw new Error('Зургийг бэлдэж чадсангүй. Жижиг хэмжээтэй өөр зураг сонгоно уу.');
}

/** Файлыг шахаж дараалалд оруулаад түр хаягийг буцаана (хадгалах үед Firestore-д бичигдэнэ) */
export async function queueImage(file) {
  const image = await prepare(file);
  const id = crypto.randomUUID();
  const url = endpoint + id;
  pending.set(url, { id, ...image });
  return url;
}

export function uploadControl(input, onPick, { label = 'Файлаас зураг оруулах' } = {}) {
  const row = document.createElement('div');
  row.className = 'image-upload actions';
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'image/jpeg,image/png,image/webp';
  picker.hidden = true;
  const select = document.createElement('button');
  select.type = 'button';
  select.className = 'btn btn--outline btn--sm';
  select.textContent = label;
  const status = document.createElement('span');
  status.className = 'hint';
  status.setAttribute('role', 'status');
  select.addEventListener('click', () => picker.click());
  picker.addEventListener('change', async () => {
    const file = picker.files[0];
    if (!file) return;
    select.disabled = true;
    status.textContent = 'Зураг бэлдэж байна…';
    try {
      const url = await queueImage(file);
      if (!row.isConnected || row.closest('[inert]')) { pending.delete(url); return; }
      if (onPick) onPick(url);
      else {
        input.value = url;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      status.textContent = 'Зураг бэлэн. Хадгалахад сайтад байршуулна.';
    } catch (error) {
      status.textContent = error.message || 'Зураг нээх боломжгүй байна.';
    } finally {
      select.disabled = false;
      picker.value = '';
    }
  });
  row.append(select, picker, status);
  return row;
}

/* ---------- Зургийн сангаас сонгох цонх ----------
   Сайтын зургийн сан (window.SKINAID_HOME_DATA.photos = assets/img/photos/…) grid-ээр; хайх; дарахад шууд сонгогдоно.
   Доод талд «Компьютер / утаснаас оруулах» — файлыг шахаж түр хаяг (content-image) буцаана (хадгалахад байршина).
   Native <dialog>: Esc/«Болих» хаана, хаахад нээсэн товч руу фокус буцна. */
const noVer = (p) => String(p || '').replace(/^\//, '').replace(/\?.*$/, '');
const photoName = (p) => noVer(p).split('/').pop().replace(/\.[a-z]+$/i, '').replace(/^lib-/, '').replace(/[-_]+/g, ' ');
let pickerEl = null;
let pickerDone = null;

function ensurePicker() {
  if (pickerEl) return pickerEl;
  pickerEl = document.createElement('dialog');
  pickerEl.className = 'dlg pp';
  pickerEl.setAttribute('aria-labelledby', 'ppTitle');
  pickerEl.innerHTML = `
    <div class="pp__box">
      <div class="pp__head">
        <h2 class="dlg__title" id="ppTitle">Зураг сонгох</h2>
        <button type="button" class="btn-icon pp__close" data-pp="close" aria-label="Хаах">✕</button>
      </div>
      <div class="search pp__search"><input type="search" data-pp="q" placeholder="Сангаас хайх (жишээ: vivace, laser)" aria-label="Зургийн сангаас хайх" autocomplete="off"></div>
      <div class="pp__grid" data-pp="grid" role="listbox" aria-label="Сайтын зургийн сан"></div>
      <p class="hint pp__empty" data-pp="empty" hidden>Тохирох зураг олдсонгүй.</p>
      <div class="pp__foot">
        <input type="file" accept="image/jpeg,image/png,image/webp" data-pp="file" hidden>
        <button type="button" class="btn btn--outline btn--sm" data-pp="upload">Компьютер / утаснаас оруулах</button>
        <span class="hint" role="status" data-pp="status"></span>
        <button type="button" class="btn btn--ghost btn--sm pp__cancel" data-pp="close">Болих</button>
      </div>
    </div>`;
  document.body.append(pickerEl);
  const $p = (k) => pickerEl.querySelector(`[data-pp="${k}"]`);
  pickerEl.addEventListener('click', (e) => {
    if (e.target === pickerEl) return finish(null);   // арын бүдэг хэсэг дээр дарвал хаана
    if (e.target.closest('[data-pp="close"]')) return finish(null);
    const opt = e.target.closest('[data-photo]');
    if (opt) finish(opt.dataset.photo);
  });
  pickerEl.addEventListener('close', () => finish(null));
  $p('q').addEventListener('input', () => {
    const q = $p('q').value.trim().toLowerCase();
    let n = 0;
    for (const b of pickerEl.querySelectorAll('[data-photo]')) { const hit = !q || b.dataset.name.includes(q); b.hidden = !hit; if (hit) n++; }
    $p('empty').hidden = n > 0;
  });
  $p('upload').addEventListener('click', () => $p('file').click());
  $p('file').addEventListener('change', async () => {
    const file = $p('file').files[0];
    if (!file) return;
    $p('upload').disabled = true;
    $p('status').textContent = 'Зураг бэлдэж байна…';
    try { finish(await queueImage(file)); } catch (error) { $p('status').textContent = error.message || 'Зураг нээх боломжгүй байна.'; } finally { $p('upload').disabled = false; $p('file').value = ''; }
  });
  return pickerEl;
}

function finish(value) {
  const done = pickerDone;
  pickerDone = null;
  if (pickerEl?.open) pickerEl.close();
  if (done) done(value);
}

/** @param {{ current?: string, title?: string, onPick: (value: string) => void }} opts */
export function openPhotoPicker({ current = '', title = 'Зураг сонгох', onPick }) {
  const d = ensurePicker();
  if (pickerDone) finish(null);
  const prev = document.activeElement;
  const photos = window.SKINAID_HOME_DATA?.photos || [];
  const cur = noVer(current);
  d.querySelector('#ppTitle').textContent = title;
  d.querySelector('[data-pp="q"]').value = '';
  d.querySelector('[data-pp="status"]').textContent = '';
  d.querySelector('[data-pp="empty"]').hidden = photos.length > 0;
  const grid = d.querySelector('[data-pp="grid"]');
  grid.replaceChildren(...photos.map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pp__item';
    b.setAttribute('role', 'option');
    const selected = noVer(p) === cur;
    b.setAttribute('aria-selected', String(selected));
    b.dataset.photo = '/' + noVer(p);
    b.dataset.name = photoName(p).toLowerCase();
    b.title = photoName(p);
    const img = document.createElement('img');
    img.src = '/' + String(p).replace(/^\//, '');
    img.alt = photoName(p);
    img.loading = 'lazy';
    img.decoding = 'async';
    b.append(img);
    return b;
  }));
  pickerDone = (value) => {
    if (prev && prev.isConnected && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
    if (value) onPick(value);
  };
  d.showModal();
  (grid.querySelector('[aria-selected="true"]') || d.querySelector('[data-pp="q"]')).focus();
  grid.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
}

/** Талбарт утга тавьж input/change үйл явдлыг дуудна */
export function setImageValue(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

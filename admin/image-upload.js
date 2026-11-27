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

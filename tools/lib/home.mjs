// Нүүрний hero + «Зөвлөгөө» картууд (content/home.json): build-ийн шалгалт ба admin-д өгөх өгөгдөл.
// HTML загвар, norm(), хязгаар нь assets/js/home-render.js (энд H гэж дамжина). Тест: tools/test/home.test.mjs.
//
// content/home.json = Firestore settings/home-ийн hero, posts (updatedAt/updatedBy-гүй — updatedBy нь admin-ий
// и-мэйл, repo нийтэд нээлттэй). Admin-ий «JSON хуулах» болон SEO 7-р үе шатны синк H.forRepo()-оор бичнэ.
import { findClaims } from './claims.mjs';

/** Зөвшөөрсөн хэллэг (build алдаа, admin анхааруулга өгөхгүй): «… арьсны хамгийн түгээмэл үрэвсэлт эмгэг» — тархалтын баримт */
export const HOME_CLAIMS_ALLOW = ['хамгийн түгээмэл'];

const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/**
 * a (эх файл) ба b (norm()-ийн гаргалт)-ийн эхний зөрүү. Түлхүүрийн дараалал хамаагүй; илүү/дутуу түлхүүрийг нэрлэнэ.
 * @returns {string|null}
 */
export function firstDiff(a, b, path = '') {
  const at = path || '(root)';
  if (Object.is(a, b)) return null;
  if (kind(a) !== kind(b)) return `${at}: ${kind(a)} байна, ${kind(b)} байх ёстой`;
  if (kind(a) === 'array') {
    if (a.length !== b.length) return `${at}: ${a.length} элемент, хэвшүүлсний дараа ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  if (kind(a) === 'object') {
    const extra = Object.keys(a).filter((k) => !Object.prototype.hasOwnProperty.call(b, k));
    const missing = Object.keys(b).filter((k) => !Object.prototype.hasOwnProperty.call(a, k));
    if (extra.length) return `${at}: илүү түлхүүр ${extra.join(', ')}`;
    if (missing.length) return `${at}: дутуу түлхүүр ${missing.join(', ')}`;
    for (const k of Object.keys(b)) { const d = firstDiff(a[k], b[k], path ? `${path}.${k}` : k); if (d) return d; }
    return null;
  }
  return `${at}: ${JSON.stringify(a)} → ${JSON.stringify(b)} (урт хэтэрсэн, илүү зай, буруу зураг/холбоос эсвэл тоо)`;
}

/**
 * content/home.json-ийг шалгана. Бүх алдааг нэг дор буцаана (нэгийг засаад дараагийнхыг харахгүйн тулд).
 * @param {unknown} raw  JSON.parse(content/home.json)
 * @param {object} H  window.SKINAID_HOME_RENDER
 * @param {{ internalPaths: Set<string>, photoError: (rel: string) => string|null }} ctx
 *   internalPaths — сайтын индекслэгдэх хуудсууд ('/', '/privacy', нийтлэгдсэн /emchilgee/…);
 *   photoError — assets/img/photos/… файл байхгүй/git-д бүртгэлгүй бол шалтгаан
 * @returns {{ home: {hero: object, posts: object[]}|null, errors: string[], warnings: string[] }}
 */
export function validateHome(raw, H, { internalPaths, photoError }) {
  const W = 'content/home.json';
  const errors = [], warnings = [];
  const n = H.norm(raw);
  if (!n) return { home: null, errors: [`${W}: JSON объект байх ёстой`], warnings };
  if (!n.hero) errors.push(`${W}: hero алга эсвэл h1 (titlePre/titleEm/titlePost) хоосон`);
  if (!n.posts) errors.push(`${W}: posts массив байх ёстой`);
  if (n.hero && n.posts) {
    const d = firstDiff(raw, { hero: n.hero, posts: n.posts });
    if (d) errors.push(`${W}: хэвшээгүй — ${d}. assets/js/home-render.js norm()-той тааруулна уу (admin-ий «JSON хуулах» гаргалт тохирно)`);
  }
  const posts = n.posts || [];
  // Бүх карт нуугдсан нь зөвшөөрөгдсөн төлөв (admin confirm-оор хадгалж болно; сайт гарчиг, Facebook холбоосыг үлдээнэ)
  if (n.posts && !H.visiblePosts(posts).length) warnings.push(`${W}: харагдах карт алга — «Зөвлөгөө» хэсэгт зөвхөн гарчиг, Facebook холбоос үлдэнэ`);
  const ids = posts.map((p) => p.id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) errors.push(`${W}: картын id хоосон эсвэл давхардсан`);
  posts.forEach((p, i) => {
    if (p.url.startsWith('/') && !internalPaths.has(p.url.split(/[?#]/)[0])) {
      errors.push(`${W}: posts[${i}].url «${p.url}» — сайтад ийм хуудас алга (одоо байгаа: ${[...internalPaths].join(', ')})`);
    }
    if (p.img && !/^https:/i.test(p.img)) {
      const e = photoError(p.img.replace(/\?.*$/, ''));
      if (e) errors.push(`${W}: posts[${i}].img «${p.img}» — ${e}`);
    }
  });
  for (const [k, t] of H.texts(n)) for (const c of findClaims(t, HOME_CLAIMS_ALLOW)) errors.push(`${W}: ${k} — хориотой мэдэгдэл «${c.label}»: …${c.context}…`);
  return { home: n.hero && n.posts ? n : null, errors, warnings };
}

/**
 * admin/home-data.js-ийн агуулга: анхны (статик) утга (зураг ?v-тэй), сайтын зургууд, дотоод холбоос болох хуудсууд.
 * @param {{hero: object, posts: object[]}} home  validateHome()-ийн home
 * @param {{ stampImg: (img: string) => string, photos: string[], internalPaths: Set<string> }} ctx
 */
export function homeAdminData(home, { stampImg, photos, internalPaths }) {
  return {
    defaults: { hero: home.hero, posts: home.posts.map((p) => ({ ...p, img: p.img ? stampImg(p.img) : '' })) },
    photos,
    internalPaths: [...internalPaths],
    claimsAllow: HOME_CLAIMS_ALLOW,
  };
}

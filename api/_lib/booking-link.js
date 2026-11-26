/**
 * Messenger-ийн цаг захиалгын холбоос (v1): сайтын захиалгын хэсэг. `?svc=<slug>` нь эмчилгээний хуудасны slug
 * (assets/js/main.js SKINAID_PAGES.opt) — зөвхөн НИЙТЛЭГДСЭН хуудасны slug-ийг allowlist-ээр дамжуулна (tools/build.mjs →
 * generated/pages-knowledge.js; хуудас нийтлэгдэхэд автоматаар нэмэгдэнэ). `utm_source=messenger` — Messenger-ээс ирсэн
 * захиалгыг ялгах. Холбоосыг КОД нэмнэ, LLM бичихгүй (prompt.js дүрэм 6).
 */
import { CLINIC } from './clinic-facts.js';
import { PAGES } from './generated/pages-knowledge.js';

export const BOOKING_SVC_SLUGS = Object.freeze(PAGES.map((p) => p.slug));

/** @param {string} [slug] @param {readonly string[]} [allowed] */
export function bookingUrl(slug, allowed = BOOKING_SVC_SLUGS) {
  const u = new URL('/', CLINIC.origin);
  if (slug && /^[a-z0-9-]{1,60}$/.test(slug) && allowed.includes(slug)) u.searchParams.set('svc', slug);
  u.searchParams.set('utm_source', 'messenger');
  u.hash = 'contact';
  return u.toString();
}

/**
 * Хариуны иш → захиалгын маягтад урьдчилан сонгох хуудас: `page:<slug>`, эсвэл хуудастай холбоотой үйлчилгээ
 * `service:<id>` (хуудасны catalogIds). Ганц л хуудас таарвал slug, эс бөгөөс null (олон үйлчилгээ — сонголтыг хэрэглэгчид үлдээнэ).
 * @param {readonly string[]} sourceIds
 * @param {readonly { slug: string, catalogIds?: readonly string[] }[]} [pages]
 */
export function slugForSources(sourceIds, pages = PAGES) {
  const hit = new Set();
  for (const id of sourceIds || []) {
    const s = String(id);
    if (s.startsWith('page:')) {
      const slug = s.slice(5);
      if (pages.some((p) => p.slug === slug)) hit.add(slug);
    } else if (s.startsWith('service:')) {
      const sid = s.slice(8);
      for (const p of pages) if ((p.catalogIds || []).includes(sid)) hit.add(p.slug);
    }
  }
  return hit.size === 1 ? [...hit][0] : null;
}

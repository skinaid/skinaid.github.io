/**
 * Messenger-ийн цаг захиалгын холбоос (v1): сайтын захиалгын хэсэг. `?svc=<slug>` нь эмчилгээний хуудасны slug
 * (assets/js/main.js SKINAID_PAGES.opt) — зөвхөн нийтлэгдсэн хуудасны slug-ийг allowlist-ээр дамжуулна
 * (одоогоор content/pages/ хоосон тул анхдагч жагсаалт хоосон). `utm_source=messenger` — Messenger-ээс ирсэн
 * захиалгыг ялгах. Холбоосыг КОД нэмнэ, LLM бичихгүй (prompt.js дүрэм 6).
 */
import { CLINIC } from './clinic-facts.js';

export const BOOKING_SVC_SLUGS = Object.freeze([]);

/** @param {string} [slug] @param {readonly string[]} [allowed] */
export function bookingUrl(slug, allowed = BOOKING_SVC_SLUGS) {
  const u = new URL('/', CLINIC.origin);
  if (slug && /^[a-z0-9-]{1,60}$/.test(slug) && allowed.includes(slug)) u.searchParams.set('svc', slug);
  u.searchParams.set('utm_source', 'messenger');
  u.hash = 'contact';
  return u.toString();
}

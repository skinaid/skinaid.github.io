/**
 * Messenger AI-ийн мэдлэг = сайтад одоо харагдаж буй нийтийн мэдээлэл:
 *   · Firestore `settings/site` — ажлын цаг (`hours`), багц харагдах эсэх (`promoEnabled`)
 *   · Firestore `settings/catalog` — үйлчилгээ (hidden биш), үнэ, багц (admin «Үйлчилгээ / Багц»)
 *   · clinic-facts.js — нэр, хаяг, ангиллын нэр
 * Утас, имэйл LLM руу ЯВАХГҮЙ (catalog-safe.js assertNoPii). Эмчийн хянасан эмчилгээний хуудас (content/pages)
 * нь 2-р үе шатанд нэмэгдэнэ.
 *
 * Инстанс бүр 5 минут санах ойд хадгална (Spark-ийн өдрийн унших квот) — admin-д засвар хийснээс хойш ≤ 5 минутад
 * ноорогт тусна.
 */
import { CATS, CLINIC } from './clinic-facts.js';
import { buildSocialCatalog } from './social/catalog-safe.js';

export const KNOWLEDGE_TTL_MS = 5 * 60_000;

const str = (v) => (typeof v === 'string' ? v : '');

/** settings/site + settings/catalog → catalog-safe-ийн оролт (цэвэр функц) */
export function knowledgeInput(site, catalog) {
  const s = site && typeof site === 'object' ? site : {};
  const c = catalog && typeof catalog === 'object' ? catalog : {};
  const services = (Array.isArray(c.services) ? c.services : []).map((x) => ({
    id: str(x?.id),
    name: str(x?.n),
    category: CATS[str(x?.c)] || '',
    description: str(x?.d),
    duration: str(x?.t),
    price: str(x?.p),
    hidden: x?.hidden === true,
  }));
  // Сайт багцыг promoEnabled === false үед л нуудаг (assets/js/main.js)
  const packages = s.promoEnabled === false ? [] : (Array.isArray(c.packages) ? c.packages : []).map((x) => ({
    id: str(x?.id),
    name: str(x?.name),
    price: str(x?.price),
    hidden: x?.hidden === true,
  }));
  return {
    clinicName: CLINIC.name,
    address: `${CLINIC.locality}, ${CLINIC.streetAddress}`,
    hoursBrief: str(s.hours),
    services,
    packages,
    voiceBrief: '',
  };
}

/** Яаралтай хариунд залгах утас (сайтын admin-д тохируулсан, эс бөгөөс тогтмол) */
export function clinicPhone(site) {
  const p = str(site?.phone).trim();
  return /^[+0-9 -]{7,20}$/.test(p) ? p : CLINIC.phoneDisplay;
}

/** @param {{ readSiteDocs(): Promise<{site: any, catalog: any}> }} store */
export function createKnowledge(store, { now = Date.now } = {}) {
  let cache = null;
  return {
    /** @returns {Promise<{ catalog: import('./social/catalog-safe.js').SocialCatalog, phone: string }>} */
    async load() {
      if (cache && cache.at + KNOWLEDGE_TTL_MS > now()) return cache.value;
      const { site, catalog } = await store.readSiteDocs();
      const value = { catalog: buildSocialCatalog(knowledgeInput(site, catalog)), phone: clinicPhone(site) };
      cache = { at: now(), value };
      return value;
    },
  };
}

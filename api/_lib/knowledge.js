/**
 * Messenger AI-ийн мэдлэг:
 *   · Firestore `settings/site` — ажлын цаг (`hours`), багц харагдах эсэх (`promoEnabled`)
 *   · Firestore `settings/catalog` — үйлчилгээ (hidden биш), үнэ, багц (admin «Үйлчилгээ / Багц»)
 *   · clinic-facts.js — нэр, хаяг, ангиллын нэр
 *   · generated/pages-knowledge.js — эмчийн хянасан, нийтлэгдсэн эмчилгээний хуудас (tools/build.mjs; одоогоор хоосон)
 *   · Firestore `messenger_kb` — admin «Сургалт»-д НИЙТЭЛСЭН мэдлэг (FAQ, бодлого); тусгай id `voice` = брэнд дуу хоолой
 *   · Firestore `messenger_examples` — ажилтны баталсан сайн/муу жишээ (prompt-ийн 3-р блок)
 * Утас, имэйл LLM руу ЯВАХГҮЙ (catalog-safe.js хасна, assertNoPii).
 *
 * Инстанс бүр 5 минут санах ойд хадгална (Spark-ийн өдрийн унших квот) — admin-д засвар хийснээс хойш ≤ 5 минутад
 * ноорогт тусна. Admin-ийн туршилт (`includeDrafts`) кэшгүй, ноорог төлөвтэй мэдлэгийг хамт оруулж болно.
 */
import { CATS, CLINIC } from './clinic-facts.js';
import { PAGES } from './generated/pages-knowledge.js';
import { buildSocialCatalog } from './social/catalog-safe.js';
import { buildExamples } from './social/examples.js';

export const KNOWLEDGE_TTL_MS = 5 * 60_000;
/** admin «Сургалт»-ийн тусгай бичлэг — брэнд дуу хоолой, нэмэлт заавар (admin/messenger-lib.js KB_VOICE_ID) */
export const KB_VOICE_ID = 'voice';

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

/**
 * Firestore-ийн баримтууд → агентын мэдлэг (цэвэр функц — тест, admin «Prompt-д юу орж байна»).
 * @param {{ site: any, catalog: any, kb?: { id: string, data: any }[], examples?: { id: string, data: any }[] }} docs
 * @param {{ includeDrafts?: boolean, pages?: readonly import('./social/catalog-safe.js').PageEntry[] }} [opt]
 */
export function buildKnowledge(docs, opt = {}) {
  const usable = (d) => d && (d.status === 'published' || (opt.includeDrafts === true && d.status === 'draft'));
  const kbRows = (docs.kb ?? []).filter((r) => r && typeof r.id === 'string');
  const kb = [];
  const skipped = [];
  let voice = '';
  for (const r of kbRows) {
    if (!usable(r.data)) { skipped.push({ id: `kb:${r.id}`, kind: r.id === KB_VOICE_ID ? 'voice' : 'kb', reason: 'draft' }); continue; }
    if (r.id === KB_VOICE_ID) voice = str(r.data.body);
    else kb.push({ id: r.id, title: str(r.data.title), body: str(r.data.body) });
  }
  const input = { ...knowledgeInput(docs.site, docs.catalog), voiceBrief: voice, kb, pages: opt.pages ?? PAGES };
  const catalog = buildSocialCatalog(input);
  const ex = buildExamples((docs.examples ?? []).map((r) => ({ id: r.id, ...(r.data && typeof r.data === 'object' ? r.data : {}) })));
  return {
    catalog,
    phone: clinicPhone(docs.site),
    examples: ex.items,
    /** admin-д: prompt-д ороогүй бичлэг, шалтгаантай (текстгүй) */
    excluded: [...skipped, ...catalog.excluded, ...ex.excluded.map((e) => ({ id: `example:${e.id}`, kind: 'example', reason: e.reason }))],
  };
}

/** @param {{ readKnowledgeDocs(opt?: { includeDrafts?: boolean }): Promise<{ site: any, catalog: any, kb: any[], examples: any[] }> }} store */
export function createKnowledge(store, { now = Date.now } = {}) {
  let cache = null;
  return {
    /**
     * @param {{ includeDrafts?: boolean, fresh?: boolean }} [opt]  includeDrafts/fresh — admin (кэшгүй)
     * @returns {Promise<ReturnType<typeof buildKnowledge>>}
     */
    async load(opt = {}) {
      const bypass = opt.includeDrafts === true || opt.fresh === true;
      if (!bypass && cache && cache.at + KNOWLEDGE_TTL_MS > now()) return cache.value;
      const docs = await store.readKnowledgeDocs({ includeDrafts: opt.includeDrafts === true });
      const value = buildKnowledge(docs, { includeDrafts: opt.includeDrafts === true });
      if (!opt.includeDrafts) cache = { at: now(), value };
      return value;
    },
  };
}

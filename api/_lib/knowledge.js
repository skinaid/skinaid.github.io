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
 * Кэш (Spark-ийн өдрийн унших квот, аудит 2026-11-27): инстанс бүр мэдлэгийг санах ойд хадгалж, ≥ 1 минут тутам зөвхөн
 * «толгой»-г (4 read: settings/site, settings/catalog, voice, `_rev`) шалгана. Admin мэдлэг/жишээ хадгалах бүрт `_rev`-ийг
 * нэг batch-д шинэчилдэг тул өөрчлөлт ≤ 1 минутад тусна; өөрчлөгдөөгүй бол 30 минут тутам бүрэн ачаална. Уншиж/бүтээж
 * чадаагүй бол сүүлийн зөв утгаа ашиглана (stale-if-error) — нэг муу бичлэг/Firestore-ийн алдаа бүх ноорогийг зогсоохгүй.
 * Admin-ийн кэшгүй уншилт (`includeDrafts`, `fresh`) 30 секундэд нэгээс олон Firestore-д хүрэхгүй.
 */
import { CATS, CLINIC } from './clinic-facts.js';
import { KB_IDS } from './store.js';
import { PAGES } from './generated/pages-knowledge.js';
import { buildSocialCatalog } from './social/catalog-safe.js';
import { buildExamples } from './social/examples.js';

/** Толгойг (4 read) хамгийн олондоо ийм давтамжтай шалгана */
export const KNOWLEDGE_CHECK_MS = 60_000;
/** `_rev` өөрчлөгдөөгүй ч бүрэн дахин ачаалах хугацаа */
export const KNOWLEDGE_MAX_AGE_MS = 30 * 60_000;
/** Admin-ийн кэшгүй уншилтыг давтахгүй хугацаа; амжилтгүй ачаалалтын дараа дахин оролдохгүй хугацаа */
export const KNOWLEDGE_MEMO_MS = 30_000;
/** admin «Сургалт»-ийн тусгай бичлэг — брэнд дуу хоолой, нэмэлт заавар (admin/messenger-lib.js KB_VOICE_ID) */
export const KB_VOICE_ID = KB_IDS.voice;

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
 * @param {{ site: any, catalog: any, voice?: any, kb?: { id: string, data: any }[], examples?: { id: string, data: any }[] }} docs
 *   examples — ШИНЭ нь эхэнд (store.readKnowledgeLists); voice — толгойноос (эс бөгөөс kb дотор `voice` id-тай мөр)
 * @param {{ includeDrafts?: boolean, pages?: readonly import('./social/catalog-safe.js').PageEntry[] }} [opt]
 */
export function buildKnowledge(docs, opt = {}) {
  const usable = (d) => d && (d.status === 'published' || (opt.includeDrafts === true && d.status === 'draft'));
  const special = new Set(Object.values(KB_IDS));
  const kbRows = (docs.kb ?? []).filter((r) => r && typeof r.id === 'string');
  const voiceDoc = docs.voice ?? kbRows.find((r) => r.id === KB_VOICE_ID)?.data ?? null;
  const kb = [];
  const skipped = [];
  let voice = '';
  if (voiceDoc) {
    if (usable(voiceDoc)) voice = str(voiceDoc.body);
    else skipped.push({ id: `kb:${KB_VOICE_ID}`, kind: 'voice', reason: 'draft' });
  }
  for (const r of kbRows) {
    if (special.has(r.id)) continue;
    if (!usable(r.data)) { skipped.push({ id: `kb:${r.id}`, kind: 'kb', reason: 'draft' }); continue; }
    kb.push({ id: r.id, title: str(r.data.title), body: str(r.data.body) });
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

/**
 * @param {{ readKnowledgeHeads(): Promise<{ site: any, catalog: any, voice: any, rev: string }>,
 *   readKnowledgeLists(opt?: { includeDrafts?: boolean, all?: boolean }): Promise<{ kb: any[], examples: any[] }> }} store
 * @param {{ now?: () => number, log?: (m: string) => void }} [opt]
 */
export function createKnowledge(store, { now = Date.now, log = (m) => console.warn(m) } = {}) {
  /** @type {{ at: number, checkedAt: number, rev: string, value: ReturnType<typeof buildKnowledge> } | null} */
  let cache = null;
  let failedAt = -Infinity;
  /** @type {Promise<any> | null} */
  let inflight = null;
  /** admin-ийн кэшгүй уншилт: variant → { at, value } */
  const memo = new Map();

  async function loadProd() {
    const t = now();
    if (cache && t - cache.checkedAt < KNOWLEDGE_CHECK_MS) return cache.value;
    if (cache && t - failedAt < KNOWLEDGE_MEMO_MS) return cache.value;
    try {
      const heads = await store.readKnowledgeHeads();
      if (cache && heads.rev === cache.rev && t - cache.at < KNOWLEDGE_MAX_AGE_MS) {
        cache.checkedAt = t;
        return cache.value;
      }
      const lists = await store.readKnowledgeLists({});
      const value = buildKnowledge({ ...heads, ...lists });
      cache = { at: t, checkedAt: t, rev: heads.rev, value };
      return value;
    } catch (e) {
      failedAt = t;
      if (!cache) throw e;
      log('[messenger] мэдлэг ачаалж чадсангүй — сүүлийн зөв мэдлэгээр үргэлжилнэ');
      cache.checkedAt = t;
      return cache.value;
    }
  }

  return {
    /**
     * @param {{ includeDrafts?: boolean, fresh?: boolean }} [opt]  includeDrafts — ноорог мэдлэгтэй (admin туршилт);
     *   fresh — кэшгүй, ноорог бичлэгийг ч «ороогүй» гэж жагсаана (admin «AI-д юу орж байна»)
     * @returns {Promise<ReturnType<typeof buildKnowledge>>}
     */
    async load(opt = {}) {
      const variant = opt.includeDrafts === true ? 'drafts' : opt.fresh === true ? 'fresh' : '';
      if (!variant) {
        if (!inflight) inflight = loadProd().finally(() => { inflight = null; });
        return inflight;
      }
      const m = memo.get(variant);
      if (m && now() - m.at < KNOWLEDGE_MEMO_MS) return m.value;
      const [heads, lists] = await Promise.all([store.readKnowledgeHeads(), store.readKnowledgeLists({ includeDrafts: variant === 'drafts', all: true })]);
      const value = buildKnowledge({ ...heads, ...lists }, { includeDrafts: variant === 'drafts' });
      memo.set(variant, { at: now(), value });
      // «fresh» = үйлдвэрлэлийн мэдлэгтэй ИЖИЛ (нийтэлсэн л) — кэшийг ч шинэчилнэ
      if (variant === 'fresh') cache = { at: now(), checkedAt: now(), rev: heads.rev, value };
      return value;
    },
  };
}

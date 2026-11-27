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
import { catalogCoverage, kbServiceId } from './catalog-check.js';
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
    catKey: str(x?.c),
    description: str(x?.d),
    duration: str(x?.t),
    price: str(x?.p),
    hidden: x?.hidden === true,
    // UB Beauty-ийн хувилбарууд (assets/js/ub-catalog.js `v`) — сайт «N сонголт» дэлгэж харуулдаг
    variants: (Array.isArray(x?.v) ? x.v : []).map((o) => ({ name: str(o?.n), duration: str(o?.t), price: str(o?.p), description: str(o?.d) })),
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
    // Утас/имэйлийн УТГА LLM-д очихгүй — зөвхөн аль суваг байгаа нь (дугаар, хаягийг код нэмнэ — agent.js)
    contactChannels: ['утас', 'имэйл'],
    services,
    packages,
    voiceBrief: '',
  };
}

/** Имэйлийн хэлбэр: үсэг/цифрээр эхэлж төгссөн нэр, давхар цэггүй, цагаан толгойн TLD — хоосон зай, мөр шилжилт, тэмдэглэгээ орохгүй */
const EMAIL_OK = /^[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.){1,4}[A-Za-z]{2,24}$/;
/**
 * Сайтын нийтийн имэйл (admin → «Тохиргоо»-д тохируулсан); тохируулаагүй / буруу хэлбэртэй бол сайт шиг тогтмол утга
 * (assets/js/main.js мөн адил анхдагч руугаа буцдаг — сайтад харагдаж буй хаягтай зөрөхгүй).
 */
export function clinicEmail(site) {
  const e = str(site?.email).trim();
  return e.length <= 120 && EMAIL_OK.test(e) && !e.includes('..') ? e : CLINIC.email;
}

/** Яаралтай хариу ба «Холбоо барих» мөрөнд залгах утас (сайтын admin-д тохируулсан, эс бөгөөс тогтмол). Нэг дугаар: 7–12 цифр. */
export function clinicPhone(site) {
  const p = str(site?.phone).trim();
  const digits = p.replace(/\D/g, '').length;
  return /^\+?[0-9][0-9 -]{5,18}[0-9]$/.test(p) && digits >= 7 && digits <= 12 ? p : CLINIC.phoneDisplay;
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
  // Нуусан үйлчилгээ/багцад холбосон мэдлэг (`s_<id>_…`) AI-д орохгүй — эс бөгөөс бот нуусан үйлчилгээг дурдана
  const base = knowledgeInput(docs.site, docs.catalog);
  const hiddenIds = new Set([...base.services, ...base.packages].filter((x) => x.hidden).map((x) => x.id));
  // Багцыг promoEnabled === false үед бүхэлд нь нуудаг — тэдгээрийн мэдлэг ч орохгүй
  if (docs.site && docs.site.promoEnabled === false) for (const p of (Array.isArray(docs.catalog?.packages) ? docs.catalog.packages : [])) hiddenIds.add(str(p?.id));
  for (const r of kbRows) {
    if (special.has(r.id)) continue;
    if (!usable(r.data)) { skipped.push({ id: `kb:${r.id}`, kind: 'kb', reason: 'draft' }); continue; }
    const sid = kbServiceId(r.id);
    if (sid && hiddenIds.has(sid)) { skipped.push({ id: `kb:${r.id}`, kind: 'kb', reason: 'hidden' }); continue; }
    kb.push({ id: r.id, title: str(r.data.title), body: str(r.data.body) });
  }
  const input = { ...base, voiceBrief: voice, kb, pages: opt.pages ?? PAGES };
  const catalog = buildSocialCatalog(input);
  // admin «Үйлчилгээ бүрээр»: каталогийн мөр бүр ботод хэрхэн орсон (+ үнэгүй шалгалт; нэмэлт Firestore read 0)
  const coverage = catalogCoverage(input, catalog, { kbIds: kbRows.filter((r) => !special.has(r.id)).map((r) => r.id) });
  const ex = buildExamples((docs.examples ?? []).map((r) => ({ id: r.id, ...(r.data && typeof r.data === 'object' ? r.data : {}) })));
  return {
    catalog,
    coverage,
    phone: clinicPhone(docs.site),
    /** Нийтийн имэйл — «Холбоо барих» мөрөнд код нэмнэ (LLM-д очихгүй) */
    email: clinicEmail(docs.site),
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

  async function loadProd(revalidate) {
    const t = now();
    if (!revalidate && cache && t - cache.checkedAt < KNOWLEDGE_CHECK_MS) return cache.value;
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
     * @param {{ includeDrafts?: boolean, fresh?: boolean, revalidate?: boolean }} [opt]  includeDrafts — ноорог мэдлэгтэй
     *   (admin туршилт); fresh — ноорог бичлэгийг ч «ороогүй» гэж жагсаана (admin «AI-д юу орж байна»); revalidate —
     *   үйлдвэрлэлийн кэшийн толгойг заавал шалгана (admin-ий туршилт: сая хадгалсан мэдлэг шууд тусна)
     * @returns {Promise<ReturnType<typeof buildKnowledge>>}
     */
    async load(opt = {}) {
      const variant = opt.includeDrafts === true ? 'drafts' : opt.fresh === true ? 'fresh' : '';
      if (!variant) {
        if (!inflight) inflight = loadProd(opt.revalidate === true).finally(() => { inflight = null; });
        return inflight;
      }
      // Admin-ийн кэшгүй уншилт: толгой (4 read) өөрчлөгдөөгүй бөгөөд 30 с дотор бол өмнөхийг; үйлдвэрлэлийн кэшийг ХӨНДӨХГҮЙ
      // (fresh нь бүх төлөвийн ≤ 100 бичлэг уншдаг — 100-аас олон бол нийтэлсэн нь хасагдаж болзошгүй)
      const heads = await store.readKnowledgeHeads();
      const m = memo.get(variant);
      if (m && m.rev === heads.rev && now() - m.at < KNOWLEDGE_MEMO_MS) return m.value;
      const lists = await store.readKnowledgeLists({ includeDrafts: variant === 'drafts', all: true });
      const value = buildKnowledge({ ...heads, ...lists }, { includeDrafts: variant === 'drafts' });
      memo.set(variant, { at: now(), rev: heads.rev, value });
      return value;
    },
  };
}

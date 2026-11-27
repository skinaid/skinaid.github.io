/**
 * Messenger AI — LLM-д АЮУЛГҮЙ эмнэлгийн каталог (мэдлэгийн суурь). ЦЭВЭР модуль (import: ../guardrails.js).
 * Эх сурвалж: skinaid/ubbeauty@1a43c95c src/lib/social/catalog-safe.ts.
 * SkinAid-д өөрчилсөн: UB Beauty-ийн тоон үнэ/`price_public`/урамшууллын (огноотой) мөрийн оронд SkinAid-ийн сайтын
 * каталог (`settings/catalog`): үнэ нь сайтад харагддаг текст («₮50,000», «₮300,000-с», «462,000₮») — дүнг
 * moneyMentions-оор задална; урамшууллын оронд багц (`packages`, сайтад promoEnabled үед харагддаг). Ачаалагч =
 * ../knowledge.js.
 *
 * Зөвхөн нийтэд ил мэдээлэл: эмнэлгийн нэр, хаяг, ажлын цаг, сайтад харагддаг (hidden биш) үйлчилгээний
 * нэр/ангилал/хугацаа/тайлбар/үнэ, багц. Эмнэлгийн утас ОРОХГҮЙ (assertNoPii; хэрэгтэй бол КОД залгана —
 * disclosure.js). Баримт бүр id-тай — агент хариундаа иш заана (policy.js `no_source`).
 *
 * 2-р үе шат: эмчийн хянасан эмчилгээний хуудас (`page:<slug>`, tools/build.mjs → ../generated/pages-knowledge.js) ба admin
 * «Сургалт»-д НИЙТЭЛСЭН мэдлэг (`kb:<id>`, Firestore messenger_kb). Утас/имэйл/РД/урт дугаар илэрсэн бичлэгийг НУУЦЛАЖ
 * оруулахгүй — бүхэлд нь хасна (`excluded`, admin «Prompt-д юу орж байна»-д шалтгаантай). Эзэмшигчийн шийдвэр
 * (2026-11-26): нийтэлсэн мэдлэгийн ₮ дүн, хувь, хөнгөлөлтийн үгийг бот хэлж болно → allowedAmounts/allowedPercents/
 * knowledgeText-д нэмэгдэнэ (ноорог төлөвтэй мэдлэг зөвхөн admin-ийн туршилтад).
 */
import { assertNoForbiddenSources, assertNoPii, findPii, moneyMentions, numberMentions, percentMentions, redactForLlm } from '../guardrails.js';

/**
 * @typedef {{ id: string, name: string, category?: string|null, description?: string|null, duration?: string|null,
 *   price?: string|null, hidden?: boolean,
 *   variants?: readonly { name?: string, duration?: string, price?: string, description?: string }[] }} CatalogServiceRow  — price = сайтад харагддаг үнийн текст
 * @typedef {{ id: string, name: string, price?: string|null, hidden?: boolean }} CatalogPackageRow
 * @typedef {{ id: string, title: string, body: string }} KbEntry  — admin «Сургалт» (messenger_kb), id = rules-ийн хэлбэр
 * @typedef {{ slug: string, name: string, catalogIds?: readonly string[], text: string }} PageEntry  — эмчилгээний хуудас
 * @typedef {{ clinicName: string, address?: string|null, hoursBrief?: string|null, services: readonly CatalogServiceRow[],
 *   packages: readonly CatalogPackageRow[], voiceBrief?: string|null, pages?: readonly PageEntry[], kb?: readonly KbEntry[],
 *   contactChannels?: readonly string[] }} CatalogInput  — contactChannels: «утас», «имэйл» (утга биш, зөвхөн суваг)
 * @typedef {'clinic'|'address'|'hours'|'contact'|'service'|'package'|'page'|'kb'} SocialFactKind
 * @typedef {{ id: string, kind: SocialFactKind, text: string }} SocialFact
 * @typedef {{ id: string, kind: 'kb'|'page'|'voice', reason: 'pii'|'empty'|'limit'|'total_limit' }} ExcludedEntry
 * @typedef {{ clinicName: string, facts: SocialFact[], allowedAmounts: number[], allowedPercents: number[], knownNumbers: number[],
 *   knowledgeText: string, voiceBrief: string, excluded: ExcludedEntry[], truncated: string[] }} SocialCatalog
 */

/** «contact» баримтын суваг → юуг систем нэмэх вэ (утга биш — нэр л) */
const CONTACT_CHANNELS = Object.freeze({ утас: 'утасны дугаарыг', имэйл: 'имэйл хаягийг' });

// variants/variantChars — нэг мөрийн UB Beauty-ийн хувилбарууд (assets/js/ub-catalog.js `v`; Diode лазер = 16 бүс)
export const CATALOG_LIMITS = Object.freeze({ services: 80, packages: 30, descriptionChars: 200, variants: 20, variantChars: 120 });
/** Мэдлэгийн (FAQ) бичлэг, эмчилгээний хуудас, брэнд дуу хоолойн хязгаар — prompt-ийн хэмжээ (кэштэй ч) хяналттай */
// entryChars = гарчиг (≤ 120) + « — » + агуулга (admin ≤ 1500) + мөр шилжилт → « · » (+2 тэмдэгт) — admin-ий хязгаарт
// багтсан бичлэг ихэнхдээ тасрахгүй (тасарвал «AI-д юу орж байна»-д харагдана)
export const KB_LIMITS = Object.freeze({ entries: 60, entryChars: 1900, totalChars: 24_000, voiceChars: 1700 });
export const PAGE_LIMITS = Object.freeze({ pages: 40, pageChars: 900, totalChars: 20_000 });

/** 50000 → «50,000» */
export function groupThousands(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Нууцалсны дараа ч PII үлдсэн бол хоосон (баримтыг бүхэлд нь хасна — LLM руу явахгүй). Удирдлагын тэмдэгтийг хасаж,
 *  тасалсан ЭЦСИЙН текстийг JSON хэлбэрээр ч шалгана (аудит 2026-11-27: каталогийн нэг талбар бүх ноорогийг зогсоож болох байв). */
function clean(text, max) {
  const s = redactForLlm(String(text ?? '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).trim();
  return findPii(s).length || findPii(JSON.stringify(s)).length ? '' : s;
}

/** Хоосон зайг нэгтгэнэ (мөр шилжилтийг « · » болгож бүтцийг хадгална), удирдлагын тэмдэгтийг хасна */
const squash = (text) => String(text ?? '').replace(/\r\n?/g, '\n').replace(/\s*\n\s*/g, ' · ').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
/**
 * PII-г prompt-д ОРОХ ЯГ ТЭР текст дээр шалгана (тасалсны дараа ч — «₮»-ийг тасалбал үнэ дугаар болно; JSON хэлбэрийг ч).
 * Аудит 2026-11-27: өмнө нь тасдахаас өмнө шалгадаг байсан тул эцсийн assertNoPii бүх ноорогийг зогсоож болох байв.
 */
export const hasPii = (text) => findPii(text).length > 0 || findPii(JSON.stringify(text)).length > 0;

/** Үнийн текстээс ₮ дүнгүүд («₮300,000-с» → [300000]). ₮-гүй цифр («1 тун») дүн биш. */
export function priceAmounts(text) {
  return moneyMentions(String(text ?? ''));
}

/** Баримтын id: Firestore-ийн id-г аюулгүй тэмдэгтээр (LLM source_ids-д буцааж заана) */
const factId = (prefix, id) => `${prefix}:${String(id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}`;

/** @param {CatalogInput} input @returns {SocialCatalog} */
export function buildSocialCatalog(input) {
  /** @type {SocialFact[]} */
  const facts = [];
  const amounts = new Set();
  const clinicName = clean(input.clinicName, 120) || 'Эмнэлэг';
  facts.push({ id: 'clinic', kind: 'clinic', text: `Эмнэлэг: ${clinicName}` });
  const address = clean(input.address, 240);
  if (address) facts.push({ id: 'address', kind: 'address', text: `Хаяг: ${address}` });
  const hours = clean(input.hoursBrief, 300);
  if (hours) facts.push({ id: 'hours', kind: 'hours', text: `Ажлын цаг: ${hours}` });
  // Холбоо барих: утас/имэйлийн УТГА LLM-д очихгүй (хувийн мэдээллийн дүрэм — зөвхөн суваг бий гэдэг нь). Дугаар, хаягийг
  // КОД хариуны доор нэмнэ (agent.js contactLine) — LLM «contact»-ыг иш татаад өөрөө хариулж чадна (өмнө нь үргэлж ажилтанд).
  const channels = [...new Set(Array.isArray(input.contactChannels) ? input.contactChannels : [])].filter((c) => Object.hasOwn(CONTACT_CHANNELS, c));
  if (channels.length) {
    facts.push({
      id: 'contact', kind: 'contact',
      text: `Холбоо барих: ${channels.join(', ')} бий — ${channels.map((c) => CONTACT_CHANNELS[c]).join(', ')} чи бичихгүй; энэ баримтыг иш татсан хариуны доор систем өөрөө нэмнэ`,
    });
  }

  const seen = new Set();
  const services = (input.services || []).filter((s) => s && s.hidden !== true && clean(s.name, 120)).slice(0, CATALOG_LIMITS.services);
  for (const s of services) {
    const id = factId('service', s.id);
    if (id === 'service:' || seen.has(id)) continue;
    seen.add(id);
    const bits = [clean(s.name, 120)];
    const cat = clean(s.category, 60);
    if (cat) bits.push(`ангилал: ${cat}`);
    const dur = clean(s.duration, 40);
    if (dur) bits.push(`хугацаа: ${dur}`);
    const price = clean(s.price, 60);
    const found = priceAmounts(price);
    if (price && found.length) {
      bits.push(`үнэ ${price}`);
      for (const n of found) amounts.add(n);
    } else {
      bits.push('үнийг ажилтан хэлнэ');
    }
    const desc = clean(s.description, CATALOG_LIMITS.descriptionChars);
    if (desc) bits.push(desc);
    // UB Beauty-ийн хувилбар бүр (нэр, хугацаа, үнэ, товч тайлбар) — үнэ нь зөвшөөрөгдсөн дүнд орно (бот «₮249,000» гэж хэлж болно)
    const vars = [];
    for (const v of (Array.isArray(s.variants) ? s.variants : []).slice(0, CATALOG_LIMITS.variants)) {
      const vn = clean(v?.name, 120);
      if (!vn) continue;
      const parts = [vn];
      const vdur = clean(v?.duration, 40);
      if (vdur) parts.push(vdur);
      const vprice = clean(v?.price, 60);
      const vfound = priceAmounts(vprice);
      if (vprice && vfound.length) {
        parts.push(vprice);
        for (const n of vfound) amounts.add(n);
      } else {
        parts.push('үнийг ажилтан хэлнэ');
      }
      const vdesc = clean(v?.description, CATALOG_LIMITS.variantChars);
      if (vdesc) parts.push(vdesc);
      vars.push(parts.join(', '));
    }
    if (vars.length) bits.push(`сонголтууд: ${vars.join('; ')}`);
    facts.push({ id, kind: 'service', text: bits.filter(Boolean).join(' — ') });
  }

  const packages = (input.packages || []).filter((p) => p && p.hidden !== true && clean(p.name, 120)).slice(0, CATALOG_LIMITS.packages);
  for (const p of packages) {
    const id = factId('package', p.id);
    if (id === 'package:' || seen.has(id)) continue;
    seen.add(id);
    const price = clean(p.price, 60);
    const found = priceAmounts(price);
    const bits = [`Багц: ${clean(p.name, 120)}`];
    if (price && found.length) {
      bits.push(`үнэ ${price}`);
      for (const n of found) amounts.add(n);
    } else {
      bits.push('үнийг ажилтан хэлнэ');
    }
    facts.push({ id, kind: 'package', text: bits.join(' — ') });
  }

  /** @type {ExcludedEntry[]} */
  const excluded = [];
  /** @type {string[]} */
  const truncated = [];
  const percents = new Set();

  // Эмчийн хянасан эмчилгээний хуудас (нийтлэгдсэн л — tools/build.mjs). PII илэрвэл хасна (нийтийн хуудас ч давхар хамгаалалт).
  let pageTotal = 0;
  for (const p of (input.pages || []).slice(0, PAGE_LIMITS.pages)) {
    const id = factId('page', p?.slug);
    if (id === 'page:' || seen.has(id)) continue;
    const raw = squash(`${p.name}: ${p.text}`);
    if (!raw.replace(/[:·\s]/g, '')) { excluded.push({ id, kind: 'page', reason: 'empty' }); continue; }
    const text = raw.slice(0, PAGE_LIMITS.pageChars);
    if (hasPii(text)) { excluded.push({ id, kind: 'page', reason: 'pii' }); continue; }
    if (pageTotal + text.length > PAGE_LIMITS.totalChars) { excluded.push({ id, kind: 'page', reason: 'total_limit' }); continue; }
    pageTotal += text.length;
    seen.add(id);
    facts.push({ id, kind: 'page', text: `Эмчилгээний хуудас — ${text}` });
  }

  // Admin «Сургалт»-ийн мэдлэг (FAQ, бодлого). Дараалал = id (кэш тогтвортой). Дүн, хувь, хөнгөлөлт → зөвшөөрөгдөнө.
  let kbTotal = 0;
  const kb = [...(input.kb || [])].filter(Boolean).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const e of kb) {
    const id = factId('kb', e.id);
    if (id === 'kb:' || seen.has(id)) continue;
    const title = squash(e.title);
    const body = squash(e.body);
    if (!title || !body) { excluded.push({ id, kind: 'kb', reason: 'empty' }); continue; }
    const raw = `${title} — ${body}`;
    // Тасдахаас өмнө ч (агуулгын хаана ч утас байвал бүхэлд нь хасна), тасалсны дараа ч шалгана
    if (hasPii(raw)) { excluded.push({ id, kind: 'kb', reason: 'pii' }); continue; }
    if (facts.filter((f) => f.kind === 'kb').length >= KB_LIMITS.entries) { excluded.push({ id, kind: 'kb', reason: 'limit' }); continue; }
    const text = raw.slice(0, KB_LIMITS.entryChars);
    if (hasPii(text)) { excluded.push({ id, kind: 'kb', reason: 'pii' }); continue; }
    if (text.length < raw.length) truncated.push(id);
    if (kbTotal + text.length > KB_LIMITS.totalChars) { excluded.push({ id, kind: 'kb', reason: 'total_limit' }); continue; }
    kbTotal += text.length;
    seen.add(id);
    facts.push({ id, kind: 'kb', text });
    for (const n of moneyMentions(text)) amounts.add(n);
    for (const n of percentMentions(text)) percents.add(Math.round(n));
  }

  // Брэнд дуу хоолой, нэмэлт заавар (admin-ийн тусгай `voice` бичлэг) — PII илэрвэл хасна
  const voiceRaw = squash(input.voiceBrief);
  let voiceBrief = '';
  if (voiceRaw) {
    const v = voiceRaw.slice(0, KB_LIMITS.voiceChars);
    if (hasPii(voiceRaw) || hasPii(v)) excluded.push({ id: 'kb:voice', kind: 'voice', reason: 'pii' });
    else {
      voiceBrief = v;
      if (v.length < voiceRaw.length) truncated.push('kb:voice');
    }
  }

  /** @type {SocialCatalog} */
  const catalog = {
    clinicName,
    facts,
    allowedAmounts: [...amounts].sort((a, b) => a - b),
    // SkinAid-ийн каталогт хувийн хөнгөлөлт байхгүй — % зөвхөн НИЙТЭЛСЭН мэдлэгт бичигдсэн бол (эс бөгөөс invented_percent)
    allowedPercents: [...percents].sort((a, b) => a - b),
    // Мэдлэгийн текстэд байгаа МӨНГӨН ДҮН БИШ тоо (үйлчилгээний нэр «Glutathione 1200», «REJURAN 2ml» г.м.) — policy-ийн
    // валютгүй дүнгийн шалгалтад зөвшөөрөгдөнө. Үнэ (₮) энд орохгүй — ИШ ТАТСАН баримтын үнэ л (policy.js, аудит 2026-11-27).
    knownNumbers: [...new Set(facts.flatMap((f) => { const money = new Set(moneyMentions(f.text)); return numberMentions(f.text).filter((n) => !money.has(n)); }))].sort((a, b) => a - b),
    knowledgeText: facts.map((f) => f.text).join('\n'),
    voiceBrief,
    excluded,
    truncated,
  };
  // Давхар хамгаалалт: LLM рүү ЯВАХ зүйл л (нэр, баримт, дуу хоолой) PII-гүй, хориотой эх сурвалжийн нэргүй. Тоон массивууд
  // (allowedAmounts, knownNumbers) LLM-д очдоггүй — тэдгээрийг JSON болгоход «60 сая» = 60000000 утас мэт харагдаж бүх ноорогийг
  // зогсоодог байсан (аудит 2026-11-27).
  assertNoPii({ clinicName: catalog.clinicName, facts: catalog.facts, voiceBrief: catalog.voiceBrief });
  assertNoForbiddenSources(catalog);
  return catalog;
}

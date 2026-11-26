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
 *   price?: string|null, hidden?: boolean }} CatalogServiceRow  — price = сайтад харагддаг үнийн текст
 * @typedef {{ id: string, name: string, price?: string|null, hidden?: boolean }} CatalogPackageRow
 * @typedef {{ id: string, title: string, body: string }} KbEntry  — admin «Сургалт» (messenger_kb), id = rules-ийн хэлбэр
 * @typedef {{ slug: string, name: string, catalogIds?: readonly string[], text: string }} PageEntry  — эмчилгээний хуудас
 * @typedef {{ clinicName: string, address?: string|null, hoursBrief?: string|null, services: readonly CatalogServiceRow[],
 *   packages: readonly CatalogPackageRow[], voiceBrief?: string|null, pages?: readonly PageEntry[], kb?: readonly KbEntry[] }} CatalogInput
 * @typedef {'clinic'|'address'|'hours'|'service'|'package'|'page'|'kb'} SocialFactKind
 * @typedef {{ id: string, kind: SocialFactKind, text: string }} SocialFact
 * @typedef {{ id: string, kind: 'kb'|'page'|'voice', reason: 'pii'|'empty'|'limit'|'total_limit' }} ExcludedEntry
 * @typedef {{ clinicName: string, facts: SocialFact[], allowedAmounts: number[], allowedPercents: number[], knownNumbers: number[],
 *   knowledgeText: string, voiceBrief: string, excluded: ExcludedEntry[], truncated: string[] }} SocialCatalog
 */

export const CATALOG_LIMITS = Object.freeze({ services: 80, packages: 30, descriptionChars: 200 });
/** Мэдлэгийн (FAQ) бичлэг, эмчилгээний хуудас, брэнд дуу хоолойн хязгаар — prompt-ийн хэмжээ (кэштэй ч) хяналттай */
export const KB_LIMITS = Object.freeze({ entries: 60, entryChars: 1500, totalChars: 16_000, voiceChars: 1500 });
export const PAGE_LIMITS = Object.freeze({ pages: 40, pageChars: 900, totalChars: 20_000 });

/** 50000 → «50,000» */
export function groupThousands(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Нууцалсны дараа ч PII үлдсэн бол хоосон (баримтыг бүхэлд нь хасна — LLM руу явахгүй) */
function clean(text, max) {
  const s = redactForLlm(String(text ?? '').replace(/\s+/g, ' ').trim()).slice(0, max);
  return findPii(s).length ? '' : s;
}

/** Хоосон зайг нэгтгэнэ (мөр шилжилтийг « · » болгож бүтцийг хадгална) */
const squash = (text) => String(text ?? '').replace(/\s*\n\s*/g, ' · ').replace(/\s+/g, ' ').trim();

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
    if (findPii(raw).length) { excluded.push({ id, kind: 'page', reason: 'pii' }); continue; }
    const text = raw.slice(0, PAGE_LIMITS.pageChars);
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
    if (findPii(raw).length) { excluded.push({ id, kind: 'kb', reason: 'pii' }); continue; }
    if (facts.filter((f) => f.kind === 'kb').length >= KB_LIMITS.entries) { excluded.push({ id, kind: 'kb', reason: 'limit' }); continue; }
    const text = raw.slice(0, KB_LIMITS.entryChars);
    if (text.length < raw.length) truncated.push(id);
    if (kbTotal + text.length > KB_LIMITS.totalChars) { excluded.push({ id, kind: 'kb', reason: 'total_limit' }); continue; }
    kbTotal += text.length;
    seen.add(id);
    facts.push({ id, kind: 'kb', text });
    for (const n of moneyMentions(text)) amounts.add(n);
    for (const n of percentMentions(text)) percents.add(Math.round(n));
  }

  // Брэнд дуу хоолой, нэмэлт заавар (admin-ийн тусгай `voice` бичлэг) — PII илэрвэл хасна
  const voiceRaw = String(input.voiceBrief ?? '').trim();
  let voiceBrief = '';
  if (voiceRaw) {
    if (findPii(voiceRaw).length) excluded.push({ id: 'kb:voice', kind: 'voice', reason: 'pii' });
    else {
      voiceBrief = squash(voiceRaw).slice(0, KB_LIMITS.voiceChars);
      if (voiceBrief.length < squash(voiceRaw).length) truncated.push('kb:voice');
    }
  }

  /** @type {SocialCatalog} */
  const catalog = {
    clinicName,
    facts,
    allowedAmounts: [...amounts].sort((a, b) => a - b),
    // SkinAid-ийн каталогт хувийн хөнгөлөлт байхгүй — % зөвхөн НИЙТЭЛСЭН мэдлэгт бичигдсэн бол (эс бөгөөс invented_percent)
    allowedPercents: [...percents].sort((a, b) => a - b),
    // Мэдлэгийн текстэд байгаа тоо (үйлчилгээний нэр «Glutathione 1200», «REJURAN 2ml» г.м.) — policy-ийн валютгүй дүнгийн
    // шалгалтад зөвшөөрөгдөнө; бүх текст — хөнгөлөлт/бэлэг гэх үг мэдлэгт байгаа эсэх
    knownNumbers: [...new Set(facts.flatMap((f) => numberMentions(f.text)))].sort((a, b) => a - b),
    knowledgeText: facts.map((f) => f.text).join('\n'),
    voiceBrief,
    excluded,
    truncated,
  };
  // Давхар хамгаалалт: LLM рүү явах бүх зүйл PII-гүй, хориотой эх сурвалжийн нэргүй
  assertNoPii(catalog);
  assertNoForbiddenSources(catalog);
  return catalog;
}

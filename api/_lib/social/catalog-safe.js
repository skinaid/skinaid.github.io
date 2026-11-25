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
 */
import { assertNoForbiddenSources, assertNoPii, findPii, moneyMentions, numberMentions, redactForLlm } from '../guardrails.js';

/**
 * @typedef {{ id: string, name: string, category?: string|null, description?: string|null, duration?: string|null,
 *   price?: string|null, hidden?: boolean }} CatalogServiceRow  — price = сайтад харагддаг үнийн текст
 * @typedef {{ id: string, name: string, price?: string|null, hidden?: boolean }} CatalogPackageRow
 * @typedef {{ clinicName: string, address?: string|null, hoursBrief?: string|null, services: readonly CatalogServiceRow[],
 *   packages: readonly CatalogPackageRow[], voiceBrief?: string|null }} CatalogInput
 * @typedef {'clinic'|'address'|'hours'|'service'|'package'} SocialFactKind
 * @typedef {{ id: string, kind: SocialFactKind, text: string }} SocialFact
 * @typedef {{ clinicName: string, facts: SocialFact[], allowedAmounts: number[], allowedPercents: number[], knownNumbers: number[],
 *   knowledgeText: string, voiceBrief: string }} SocialCatalog
 */

export const CATALOG_LIMITS = Object.freeze({ services: 80, packages: 30, descriptionChars: 200 });

/** 50000 → «50,000» */
export function groupThousands(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Нууцалсны дараа ч PII үлдсэн бол хоосон (баримтыг бүхэлд нь хасна — LLM руу явахгүй) */
function clean(text, max) {
  const s = redactForLlm(String(text ?? '').replace(/\s+/g, ' ').trim()).slice(0, max);
  return findPii(s).length ? '' : s;
}

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

  /** @type {SocialCatalog} */
  const catalog = {
    clinicName,
    facts,
    allowedAmounts: [...amounts].sort((a, b) => a - b),
    // SkinAid-ийн каталогт хувийн хөнгөлөлт байхгүй — хариунд % дурдвал хүнд (invented_percent)
    allowedPercents: [],
    // Мэдлэгийн текстэд байгаа тоо (үйлчилгээний нэр «Glutathione 1200», «REJURAN 2ml» г.м.) — policy-ийн валютгүй дүнгийн
    // шалгалтад зөвшөөрөгдөнө; бүх текст — хөнгөлөлт/бэлэг гэх үг мэдлэгт байгаа эсэх
    knownNumbers: [...new Set(facts.flatMap((f) => numberMentions(f.text)))].sort((a, b) => a - b),
    knowledgeText: facts.map((f) => f.text).join('\n'),
    voiceBrief: clean(input.voiceBrief, 4000),
  };
  // Давхар хамгаалалт: LLM рүү явах бүх зүйл PII-гүй, хориотой эх сурвалжийн нэргүй
  assertNoPii(catalog);
  assertNoForbiddenSources(catalog);
  return catalog;
}

// JSON-LD (schema.org) үүсгэгч. Зөвхөн content/site.mjs ба catalog-ийн баталгаатай
// утгыг ашиглана; null/хоосон талбарыг орхино. AggregateRating/Review хэзээ ч нэмэхгүй
// (Google өөрийнхөө тухай үнэлгээг LocalBusiness-д харуулдаггүй, зохиомол болох эрсдэлтэй).

const abs = (site, p) => (p.startsWith('http') ? p : site.origin + p);
const compact = (o) => {
  if (Array.isArray(o)) return o.map(compact).filter((v) => v !== undefined);
  if (o && typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      const c = compact(v);
      if (c === undefined || c === null || c === '' || (Array.isArray(c) && !c.length)) continue;
      out[k] = c;
    }
    return out;
  }
  return o;
};

/** "₮50,000" → {price}, "₮300,000-с" → {minPrice}, бусад → null */
export function parsePrice(p) {
  if (!p || typeof p !== 'string') return null;
  const m = p.replace(/\s/g, '').match(/^₮?([\d,]+)₮?(-с)?$/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2] ? { minPrice: n } : { price: n };
}

/** Үнийн хүрээ: catalog-ийн үйлчилгээ + багцын үнээс (гараар бичсэн мөр зөрөхгүй). "₮50,000 – ₮830,000" */
export function priceRange(catalog) {
  const ns = [...(catalog.treatments || []).map((t) => t.p), ...(catalog.packages || []).map((p) => p.price)]
    .map(parsePrice).filter(Boolean).map((x) => x.price || x.minPrice);
  if (!ns.length) return null;
  const fmt = (n) => '₮' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const lo = Math.min(...ns), hi = Math.max(...ns);
  return lo === hi ? fmt(lo) : `${fmt(lo)} – ${fmt(hi)}`;
}

function offer(t) {
  const pr = parsePrice(t.p);
  const o = { '@type': 'Offer', itemOffered: { '@type': 'Service', name: t.n, description: t.d } };
  if (pr && pr.price) { o.price = String(pr.price); o.priceCurrency = 'MNT'; }
  if (pr && pr.minPrice) o.priceSpecification = { '@type': 'PriceSpecification', minPrice: pr.minPrice, priceCurrency: 'MNT' };
  return o;
}

/** @param asset (path) => хувилбартай зам ('/assets/img/logo.png' → '/assets/img/logo.png?v=…'); build.mjs өгнө */
export function clinicNode(site, catalog, asset = (p) => p) {
  const id = site.origin + '/#clinic';
  const byCat = Object.entries(catalog.cats).map(([key, label]) => ({
    '@type': 'OfferCatalog',
    name: label,
    itemListElement: catalog.treatments.filter((t) => t.c === key).map(offer),
  })).filter((c) => c.itemListElement.length);
  return compact({
    '@type': 'MedicalClinic',
    '@id': id,
    name: site.name,
    alternateName: site.alternateName,
    legalName: site.legalName,
    description: site.description,
    url: site.origin + '/',
    logo: abs(site, asset(site.logo)),
    image: site.images.map((i) => abs(site, asset(i))),
    telephone: site.telephone,
    email: site.email,
    foundingDate: site.foundingDate,
    medicalSpecialty: 'https://schema.org/Dermatology',
    isAcceptingNewPatients: true,
    address: { '@type': 'PostalAddress', ...site.address },
    geo: site.geo ? { '@type': 'GeoCoordinates', latitude: site.geo.latitude, longitude: site.geo.longitude } : null,
    hasMap: site.hasMap,
    openingHoursSpecification: site.openingHours
      ? site.openingHours.map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: h.days, opens: h.opens, closes: h.closes }))
      : null,
    priceRange: priceRange(catalog),
    currenciesAccepted: site.currenciesAccepted,
    paymentAccepted: site.paymentAccepted,
    areaServed: { '@type': 'City', name: site.areaServed },
    hasOfferCatalog: { '@type': 'OfferCatalog', name: 'Эмчилгээ, үйлчилгээ', itemListElement: byCat },
    sameAs: site.sameAs,
  });
}

export function websiteNode(site) {
  return compact({
    '@type': 'WebSite',
    '@id': site.origin + '/#website',
    url: site.origin + '/',
    name: site.name,
    alternateName: site.alternateName.slice(0, 2),
    inLanguage: 'mn',
    publisher: { '@id': site.origin + '/#clinic' },
  });
}

export function webPageNode(site, page) {
  const url = site.origin + page.path;
  return compact({
    '@type': 'WebPage',
    '@id': url + '#webpage',
    url,
    name: page.title,
    description: page.description,
    isPartOf: { '@id': site.origin + '/#website' },
    about: { '@id': site.origin + '/#clinic' },
    inLanguage: 'mn',
  });
}

/** Нүүр хуудасны @graph */
export function homeGraph(site, catalog, page, asset) {
  return { '@context': 'https://schema.org', '@graph': [websiteNode(site), clinicNode(site, catalog, asset), webPageNode(site, page)] };
}

/* ---------- Дэд хуудас (эмчилгээ, hub) ---------- */

/** Дэд хуудсанд эмнэлгийн товч зангилаа (нүүрнийхтэй ижил @id) */
export function clinicRefNode(site, asset = (p) => p) {
  return compact({
    '@type': 'MedicalClinic',
    '@id': site.origin + '/#clinic',
    name: site.name,
    url: site.origin + '/',
    logo: abs(site, asset(site.logo)),
    telephone: site.telephone,
    address: { '@type': 'PostalAddress', ...site.address },
  });
}

export function breadcrumbNode(site, url, items) {
  return {
    '@type': 'BreadcrumbList',
    '@id': url + '#breadcrumb',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: site.origin + it.path })),
  };
}

/** Хянагч эмч (зөвхөн зөвшөөрсөн талбарууд) */
export function personNode(site, key, doc) {
  return compact({
    '@type': 'Person',
    '@id': site.origin + '/#doctor-' + key,
    name: doc.name,
    jobTitle: doc.jobTitle,
    worksFor: { '@id': site.origin + '/#clinic' },
    knowsAbout: doc.knowsAbout,
  });
}

const PROCEDURE_TYPES = {
  procedure: ['MedicalProcedure', 'Service'],
  therapy: ['MedicalTherapy', 'Service'],
  diagnostic: ['DiagnosticProcedure', 'Service'],
  cosmetic: 'Service',
};

/**
 * Эмчилгээний хуудасны @graph.
 * @param ctx { url, title, description, crumbs:[{name,path}], items: catalog мөрүүд, reviewer: {key, doc}|null,
 *              lastReviewed, asset, summaryText }
 */
export function treatmentGraph(site, page, ctx) {
  const url = ctx.url;
  const procId = url + '#procedure';
  const s = page.schema || {};
  const types = PROCEDURE_TYPES[s.kind] || PROCEDURE_TYPES.procedure;
  const offers = ctx.items.filter((t) => parsePrice(t.p)).map((t) => ({ ...offer(t), url }));
  const conditions = (s.conditions || []).map((c, i) => compact({
    '@type': 'MedicalCondition',
    '@id': url + '#condition-' + (i + 1),
    name: c.name,
    alternateName: c.alternateName,
    code: c.icd10 ? { '@type': 'MedicalCode', code: c.icd10, codingSystem: 'ICD-10' } : null,
    // possibleTreatment-ийн муж нь MedicalTherapy — зөвхөн therapy төрөлд холбоно (бусад нь WebPage.about-аар)
    possibleTreatment: s.kind === 'therapy' ? { '@id': procId } : null,
  }));
  // bodyLocation, procedureType нь MedicalProcedure (ба дэд төрөл)-д л хүчинтэй
  const isProc = Array.isArray(types) && types.some((t) => /Procedure$|^MedicalTherapy$/.test(t));
  const procedure = compact({
    '@type': types,
    '@id': procId,
    name: page.h1 || page.name,
    description: ctx.summaryText,
    procedureType: isProc && s.procedureType ? 'https://schema.org/' + s.procedureType : null,
    bodyLocation: isProc ? s.bodyLocation : null,
    provider: { '@id': site.origin + '/#clinic' },
    areaServed: { '@type': 'City', name: site.areaServed },
    offers,
  });
  const person = ctx.reviewer ? personNode(site, ctx.reviewer.key, ctx.reviewer.doc) : null;
  const webpage = compact({
    '@type': 'MedicalWebPage',
    '@id': url + '#webpage',
    url,
    name: ctx.title,
    description: ctx.description,
    inLanguage: 'mn',
    isPartOf: { '@id': site.origin + '/#website' },
    publisher: { '@id': site.origin + '/#clinic' },
    about: [{ '@id': procId }, ...conditions.map((c) => ({ '@id': c['@id'] }))],
    mainEntity: { '@id': procId },
    breadcrumb: { '@id': url + '#breadcrumb' },
    specialty: 'https://schema.org/Dermatology',
    medicalAudience: 'https://schema.org/Patient',
    lastReviewed: person ? ctx.lastReviewed : null,
    reviewedBy: person ? { '@id': person['@id'] } : null,
  });
  return {
    '@context': 'https://schema.org',
    '@graph': [
      compact({ '@type': 'WebSite', '@id': site.origin + '/#website', url: site.origin + '/', name: site.name }),
      clinicRefNode(site, ctx.asset),
      webpage, procedure, ...conditions, ...(person ? [person] : []),
      breadcrumbNode(site, url, ctx.crumbs),
    ],
  };
}

/** /emchilgee hub: CollectionPage + ItemList (нийтлэгдсэн хуудсууд) + BreadcrumbList */
export function hubGraph(site, ctx) {
  const url = ctx.url;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      compact({ '@type': 'WebSite', '@id': site.origin + '/#website', url: site.origin + '/', name: site.name }),
      clinicRefNode(site, ctx.asset),
      compact({
        '@type': 'CollectionPage',
        '@id': url + '#webpage',
        url,
        name: ctx.title,
        description: ctx.description,
        inLanguage: 'mn',
        isPartOf: { '@id': site.origin + '/#website' },
        publisher: { '@id': site.origin + '/#clinic' },
        breadcrumb: { '@id': url + '#breadcrumb' },
        mainEntity: ctx.items.length ? { '@id': url + '#list' } : null,
      }),
      ...(ctx.items.length ? [{
        '@type': 'ItemList',
        '@id': url + '#list',
        itemListElement: ctx.items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, url: site.origin + it.path })),
      }] : []),
      breadcrumbNode(site, url, ctx.crumbs),
    ],
  };
}

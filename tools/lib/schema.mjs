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

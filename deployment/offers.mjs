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

export function offer(t) {
  const pr = parsePrice(t.p);
  const o = { '@type': 'Offer', itemOffered: { '@type': 'Service', name: t.n, description: t.d } };
  if (pr && pr.price) { o.price = String(pr.price); o.priceCurrency = 'MNT'; }
  if (pr && pr.minPrice) o.priceSpecification = { '@type': 'PriceSpecification', minPrice: pr.minPrice, priceCurrency: 'MNT' };
  return o;
}

/* ==========================================================================
   SKIN AID admin — Модуль: Эмчилгээний хуудас (зөвхөн харах; өгөгдөл: build-ийн admin/pages-status.js)
   ========================================================================== */
import { $, esc, DEFAULTS } from './core.js?v=2c361933';

export function renderPages(fsServices) {
  const tb = $('#pgTable tbody'); if (!tb) return;
  const ST = (window.SKINAID_PAGES_STATUS || {}).pages || [];
  const STAGE = { planned: 'Төлөвлөсөн', drafting: 'Ноорог бичиж буй', review: 'Эмч хянаж буй', approved: 'Баталсан', published: 'Нийтэлсэн' };
  const nameOf = (id) => { const t = (DEFAULTS.treatments || []).find((x) => x.id === id); return t ? t.n : id; };
  tb.replaceChildren(...ST.map((p) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(p.h1)}</strong><br>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a>` : `<span class="muted">/emchilgee/${esc(p.slug)}</span>`}<br><span class="muted">Түлхүүр үг: ${esc(p.primary)}</span></td>
      <td>${esc(String(p.week))}<br><span class="muted">${esc(p.weekStart)}</span></td>
      <td><span class="badge" data-stage="${esc(p.stage)}">${esc(STAGE[p.stage] || p.stage)}</span></td>
      <td>${p.reviewer ? esc(p.reviewer) + (p.reviewerConsent ? '' : '<br><span class="muted">зөвшөөрөл хүлээгдэж буй</span>') : '<span class="muted">томилоогүй</span>'}</td>
      <td>${p.lastReviewed ? esc(p.lastReviewed) : '—'}</td>
      <td>${esc(p.sitePrice)}</td>
      <td>${p.catalogIds.map((id) => esc(nameOf(id))).join('<br>')}</td>`;
    return tr;
  }));
  const count = (st) => ST.filter((p) => p.stage === st).length;
  $('#pgStats').innerHTML = ['published', 'approved', 'review', 'drafting', 'planned']
    .map((st) => `<div class="pg-stat" data-stage="${st}"><strong>${count(st)}</strong><span>${esc(STAGE[st])}</span></div>`).join('');
  // Анхааруулга: нийтлэгдсэн хуудасны үйлчилгээ admin-д нуугдсан/устсан, эсвэл үнэ сайтын хуудаснаас зөрсөн
  const warn = [];
  if (Array.isArray(fsServices)) {
    const byId = new Map(fsServices.map((s) => [s && s.id, s]));
    ST.filter((p) => p.url).forEach((p) => (p.priceIds || p.catalogIds).forEach((id) => {
      const s = byId.get(id), d = (DEFAULTS.treatments || []).find((x) => x.id === id) || {};
      if (!s) warn.push(`${p.url}: «${nameOf(id)}» үйлчилгээ admin-ий жагсаалтад алга (устгагдсан).`);
      else if (s.hidden) warn.push(`${p.url}: «${nameOf(id)}» admin-д нуугдсан ч эмчилгээний хуудсанд харагдаж байна.`);
      else if ((s.p || '') !== (d.p || '')) warn.push(`${p.url}: «${nameOf(id)}» үнэ admin-д «${s.p || '—'}», сайтын хуудсанд «${d.p || '—'}» — хөгжүүлэгчээр сайтын хуудсыг шинэчилнэ.`);
    }));
  }
  $('#pgWarn').innerHTML = warn.map((w) => `<li>${esc(w)}</li>`).join('');
}

// Drafts live in an admin-only collection. Only the existing clinician-reviewed build may publish them.
const names = {
  title: 'Хайлтын гарчиг', description: 'Хайлтын тайлбар', name: 'Эмчилгээний нэр', h1: 'Үндсэн гарчиг',
  summary: 'Товч танилцуулга', ctaTitle: 'Цаг захиалах уриалга', facts: 'Үйлчилгээний мэдээлэл',
  duration: 'Хугацаа', anesthesia: 'Мэдээ алдуулалт', sessions: 'Давтамж', downtime: 'Эдгэрэлт',
  what: 'Эмчилгээний тухай', suits: 'Хэнд тохирох', contraindications: 'Эсрэг заалт',
  procedure: 'Эмчилгээний явц', aftercare: 'Дараах арчилгаа', sideEffects: 'Гаж нөлөө', price: 'Үнийн тайлбар',
  faq: 'Асуулт, хариулт', q: 'Асуулт', a: 'Хариулт', headings: 'Хэсгийн гарчиг', sources: 'Эх сурвалж',
  publisher: 'Нийтлэгч', url: 'Холбоос', accessed: 'Уншсан огноо', sections: 'Эмчилгээний агуулга',
};
const editable = ['name', 'h1', 'title', 'description', 'summary', 'ctaTitle', 'facts', 'headings', 'sections', 'faq', 'sources'];

export function clinicalFields(source) {
  const fields = [];
  function visit(value, path) {
    if (typeof value === 'string') {
      const labels = path.map(k => names[k] || (/^\d+$/.test(k) ? String(Number(k) + 1) : k));
      fields.push({ id: path.join('/'), path, label: labels.join(' · '), kind: 'text', value,
        group: path.length > 1 ? labels[0] : 'Хуудасны танилцуулга' });
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
    }
  }
  for (const key of editable) visit(source[key], [key]);
  return fields;
}

export function reviewDraft(source, edits) {
  const draft = structuredClone(source);
  for (const field of clinicalFields(source)) {
    if (!Object.hasOwn(edits, field.id) || typeof edits[field.id] !== 'string') continue;
    const parent = field.path.slice(0, -1).reduce((node, key) => node[key], draft);
    parent[field.path.at(-1)] = edits[field.id];
  }
  draft.status = 'draft';
  delete draft.review;
  delete draft.lastReviewed;
  return draft;
}

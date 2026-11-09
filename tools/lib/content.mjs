// Эмчилгээний хуудасны контент: ачаалах, шалгах, нийтлэх эрхийг (gating) тогтоох.
//
// content/pages/<slug>.mjs   — ЗӨВХӨН эмчийн баталсан, status:'published' хуудас (git-д орно, нийтэд нээлттэй repo)
// content/drafts/<slug>.mjs  — ноорог (.gitignore); зөвхөн `node tools/build.mjs --preview`-д харагдана
// content/doctors.mjs        — хянагч эмч нар (нэр гаргах зөвшөөрөлтэй)
//
// Нийтлэх нөхцөл (бүгд): status 'published', reviewer нь doctors-д зөвшөөрөлтэй, lastReviewed огноо,
// review.hash === reviewHash(page) (эмчийн баталсан текст өөрчлөгдөөгүй), [[эмч: …]] тэмдэг үлдээгүй,
// хориотой мэдэгдэлгүй. Нэг нь ч зөрвөл build АЛДАА өгнө (чимээгүй нуухгүй — холбоос, redirect эвдрэхээс сэргийлнэ).

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { BuildError } from './assets.mjs';
import { plain, wordCount, blocks, inline } from './render.mjs';
import { findClaims } from './claims.mjs';
import { parsePrice } from './schema.mjs';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SECTION_KEYS = ['what', 'suits', 'contraindications', 'procedure', 'aftercare', 'sideEffects', 'price'];
export const FACT_KEYS = ['duration', 'anesthesia', 'sessions', 'downtime'];
const HASHED = ['title', 'description', 'h1', 'name', 'summary', 'ctaTitle', 'facts', 'headings', 'sections', 'faq', 'sources', 'schema', 'claimsAllow', 'video'];
const KINDS = ['procedure', 'therapy', 'diagnostic', 'cosmetic'];
const PROCEDURE_TYPES = ['NoninvasiveProcedure', 'PercutaneousProcedure'];
// content/pages/ (нийтэд нээлттэй repo) файлд ноорогийн/дотоод тэмдэглэл үлдэх ёсгүй
const RAW_FORBIDDEN = /НООРОГ|content\/_work|content\/drafts|\[\[эмч:|өртөг|ашиг|нийлүүлэгч|margin|\bcost\b/i;

async function importAll(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs')).sort()) {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    if (!mod.default || typeof mod.default !== 'object') throw new BuildError(`${dir}/${f}: export default {…} байх ёстой`);
    out.push({ ...mod.default, _file: f, _slugFromFile: f.replace(/\.mjs$/, ''), _raw: readFileSync(join(dir, f), 'utf8') });
  }
  return out;
}

/**
 * @returns {Promise<{pages: object[], doctors: object, hub: object|null}>}
 * preview үед content/drafts/ нь ижил slug-тай content/pages/-ийг дарна.
 */
export async function loadContent(root, { preview = false } = {}) {
  const published = (await importAll(join(root, 'content/pages'))).map((p) => ({ ...p, _dir: 'content/pages' }));
  const bySlug = new Map(published.map((p) => [p._slugFromFile, p]));
  if (preview) {
    for (const d of await importAll(join(root, 'content/drafts'))) bySlug.set(d._slugFromFile, { ...d, _dir: 'content/drafts', _draft: true });
  }
  const doc = existsSync(join(root, 'content/doctors.mjs')) ? await import(pathToFileURL(join(root, 'content/doctors.mjs')).href) : {};
  const hubMod = existsSync(join(root, 'content/hub.mjs')) ? await import(pathToFileURL(join(root, 'content/hub.mjs')).href) : {};
  const pipeMod = existsSync(join(root, 'content/pipeline.mjs')) ? await import(pathToFileURL(join(root, 'content/pipeline.mjs')).href) : {};
  const pipeline = pipeMod.pipeline || [];
  return { pages: [...bySlug.values()], doctors: doc.doctors || {}, hub: hubMod.hub || null, pipeline, pipelineSlugs: new Set(pipeline.map((p) => p.slug)) };
}

const stable = (v) => {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  return v;
};
/** Эмчийн баталсан текстийн hash (үнэ, холбоос, catalogIds, legacy орохгүй) */
export function reviewHash(page) {
  const subset = Object.fromEntries(HASHED.filter((k) => page[k] !== undefined).map((k) => [k, page[k]]));
  return createHash('sha1').update(JSON.stringify(stable(subset))).digest('hex').slice(0, 8);
}

/** Хуудасны бүх өвчтөнд харагдах текст (markup-гүй) */
export function pageText(page) {
  return plain([page.title, page.description, page.h1, page.name, page.summary, page.ctaTitle, page.facts, page.headings, page.sections,
    (page.faq || []).map((f) => [f.q, f.a])]);
}

/** catalog-ийн үйлчилгээнүүдээс хуудасны үнийн мэдээлэл */
export function priceInfo(items) {
  const priced = items.map((t) => ({ t, pr: parsePrice(t.p) })).filter((x) => x.pr);
  if (!priced.length) return { text: 'Эмчийн үзлэгийн дараа тодорхойлно', priced: [] };
  const vals = priced.map((x) => x.pr.price || x.pr.minPrice);
  const min = Math.min(...vals);
  const fixed = priced.length === 1 && priced[0].pr.price;
  const fmt = (n) => '₮' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return { text: fixed ? fmt(min) : `${fmt(min)}-с`, priced };
}

/**
 * @param {object} page
 * @param {{catalog: object, doctors: object, bookingOptions: string[], allPages: object[], today: string, preview: boolean}} ctx
 * @returns {{errors: string[], warnings: string[], markers: string[], claims: object[], words: number, publishable: boolean}}
 */
export function validatePage(page, ctx) {
  const errors = [], warnings = [], markers = [];
  const f = `${page._dir}/${page._file}`;
  const E = (m) => errors.push(`${f}: ${m}`);
  const W = (m) => warnings.push(`${f}: ${m}`);

  if (page.slug !== page._slugFromFile) E(`slug "${page.slug}" нь файлын нэртэй (${page._slugFromFile}) таарахгүй`);
  if (!SLUG_RE.test(page.slug || '')) E('slug зөвхөн латин жижиг үсэг, тоо, зураас');
  if (!['draft', 'published'].includes(page.status)) E(`status "${page.status}" — 'draft' эсвэл 'published'`);
  if (page._dir === 'content/pages' && page.status !== 'published') E('ноорог content/pages/-д байж болохгүй (repo нийтэд нээлттэй) — content/drafts/-д шилжүүлнэ үү');
  if (page._dir === 'content/pages' && RAW_FORBIDDEN.test(page._raw || '')) E('файлд ноорогийн/дотоод тэмдэглэл (НООРОГ, content/_work, [[эмч:, өртөг …) үлдсэн — толгойн тайлбарыг устгана уу (repo нийтэд нээлттэй)');
  const sch = page.schema || {};
  if (sch.kind !== undefined && !KINDS.includes(sch.kind)) E(`schema.kind "${sch.kind}" — ${KINDS.join(' | ')}`);
  if (sch.procedureType != null && !PROCEDURE_TYPES.includes(sch.procedureType)) E(`schema.procedureType "${sch.procedureType}" — ${PROCEDURE_TYPES.join(' | ')}`);

  for (const k of ['title', 'description', 'h1', 'name', 'summary', 'category', 'bookingOption']) {
    if (typeof page[k] !== 'string' || !page[k].trim()) E(`"${k}" хоосон`);
  }
  if (page.category && !(ctx.catalog.cats || {})[page.category]) E(`category "${page.category}" catalog-defaults.js-д алга`);
  if (page.bookingOption && !ctx.bookingOptions.includes(page.bookingOption)) E(`bookingOption "${page.bookingOption}" захиалгын маягтын сонголтод алга`);

  const ids = new Set((ctx.catalog.treatments || []).map((t) => t.id));
  if (!Array.isArray(page.catalogIds) || !page.catalogIds.length) E('catalogIds хоосон');
  for (const id of page.catalogIds || []) {
    if (!ids.has(id)) E(`catalogIds: "${id}" catalog-defaults.js-д алга`);
    const other = ctx.allPages.find((p) => p !== page && (p.catalogIds || []).includes(id));
    if (other) E(`catalogIds: "${id}" нь ${other.slug}-д ч байна (нэг үйлчилгээ нэг хуудсанд)`);
  }

  for (const k of FACT_KEYS) if (!page.facts || typeof page.facts[k] !== 'string' || !page.facts[k].trim()) E(`facts.${k} хоосон`);
  for (const k of SECTION_KEYS) if (!page.sections || !Array.isArray(page.sections[k]) || !page.sections[k].length) E(`sections.${k} хоосон`);
  if (page.sections) for (const k of Object.keys(page.sections)) if (!SECTION_KEYS.includes(k)) E(`sections.${k} — үл мэдэх хэсэг`);
  if (!Array.isArray(page.faq) || page.faq.length < 3 || page.faq.length > 10) E('faq 3–10 асуулт байх ёстой');
  for (const [i, q] of (page.faq || []).entries()) if (!q || typeof q.q !== 'string' || !Array.isArray(q.a) || !q.a.length) E(`faq[${i}] {q, a:[…]} хэлбэртэй байх`);
  const srcs = page.sources || [];
  if (srcs.length < 2) E('sources ≥ 2 байх ёстой');
  for (const [i, s] of srcs.entries()) {
    if (!s || !s.title || !s.publisher || !/^https:\/\//.test(s.url || '')) E(`sources[${i}]: title, publisher, https url шаардлагатай`);
    if (s && s.accessed && !/^\d{4}-\d{2}-\d{2}$/.test(s.accessed)) E(`sources[${i}].accessed огноо YYYY-MM-DD`);
  }
  for (const id of page.alsoIds || []) {
    if (!ids.has(id)) E(`alsoIds: "${id}" catalog-defaults.js-д алга`);
    if ((page.catalogIds || []).includes(id)) E(`alsoIds: "${id}" catalogIds-д аль хэдийн бий`);
  }
  if (ctx.pipelineSlugs && ctx.pipelineSlugs.size && !ctx.pipelineSlugs.has(page.slug)) {
    (page._dir === 'content/pages' ? E : W)(`content/pipeline.mjs-д "${page.slug}" төлөвлөгдөөгүй (admin-ий хяналт, үйлчилгээний холбоосыг тэндээс авна)`);
  }
  for (const r of page.related || []) if (!ctx.allPages.some((p) => p.slug === r)) W(`related "${r}" хуудас алга (холбоос гарахгүй)`);
  if (!Array.isArray(page.legacy || [])) E('legacy массив байх ёстой');

  const text = pageText(page);
  // Рендер хийж үзэх (буруу холбоос, блок) + тэмдэг цуглуулах
  try {
    const c = { markers, preview: true };
    for (const k of SECTION_KEYS) if (page.sections && Array.isArray(page.sections[k])) blocks(page.sections[k], { ...c, where: `${f} sections.${k}` });
    for (const [i, q] of (page.faq || []).entries()) { inline(q.q || '', { ...c, where: `${f} faq[${i}].q` }); blocks(q.a || [], { ...c, where: `${f} faq[${i}].a` }); }
    for (const k of ['summary', 'h1', 'name']) if (typeof page[k] === 'string') inline(page[k], { ...c, where: `${f} ${k}` });
    for (const k of FACT_KEYS) if (page.facts && typeof page.facts[k] === 'string') inline(page.facts[k], { ...c, where: `${f} facts.${k}` });
  } catch (e) { E(e.message); }
  for (const k of ['title', 'description']) if (/\[\[|\*\*|\]\(/.test(page[k] || '')) E(`${k}-д markup/тэмдэг байж болохгүй`);

  if (/₮\s*\d|\d[\d,.]*\s*₮|\d[\d,.]*\s*(?:мянга|сая)?\S*\s*төгрөг/u.test(text)) E('текстэд үнэ бичихгүй — үнэ catalog-defaults.js-ээс автоматаар орно');
  const claims = findClaims(text, page.claimsAllow || []);
  for (const c of claims) E(`хориотой мэдэгдэл «${c.label}»: …${c.context}…`);
  const words = wordCount(text);
  if (words < 500) E(`үгийн тоо ${words} (< 500)`);
  else if (words < 700) W(`үгийн тоо ${words} — 800–1,500 зорилготой`);

  // Нийтлэх эрх
  if (page.status === 'published') {
    const doc = ctx.doctors[page.reviewer];
    if (!doc) E(`reviewer "${page.reviewer}" content/doctors.mjs-д алга`);
    else {
      if (!doc.consent || !/^\d{4}-\d{2}-\d{2}$/.test(doc.consent.date || '')) E(`reviewer "${page.reviewer}"-ийн нэр гаргах зөвшөөрөл (consent.date) бүртгэгдээгүй`);
      if (!doc.jobTitle) E(`reviewer "${page.reviewer}"-ийн цол (jobTitle) бүртгэгдээгүй`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(page.lastReviewed || '')) E('lastReviewed огноо (YYYY-MM-DD) алга');
    else if (page.lastReviewed > ctx.today) E(`lastReviewed ${page.lastReviewed} ирээдүйд байна`);
    else {
      const age = (Date.parse(ctx.today) - Date.parse(page.lastReviewed)) / 864e5;
      if (age > 365) W(`сүүлд ${Math.round(age)} хоногийн өмнө хянасан — эмчээр дахин хянуулна уу`);
    }
    const h = reviewHash(page);
    if (!page.review || page.review.by !== page.reviewer) E(`review.by "${page.review && page.review.by}" ≠ reviewer "${page.reviewer}" — баталсан эмч өөр (хянагчийг солих бол шинэ эмчээр дахин хянуулна)`);
    if (!page.review || page.review.hash !== h) E(`review.hash "${page.review && page.review.hash}" ≠ одоогийн текстийн hash "${h}" — текст эмч баталснаас хойш өөрчлөгдсөн (дахин хянуулна)`);
    if (markers.length) E(`${markers.length} [[эмч: …]] тэмдэг үлдсэн`);
  }
  return { errors, warnings, markers, claims, words, publishable: page.status === 'published' && !errors.length };
}

#!/usr/bin/env node
// Эмчийн хяналтын баримт (Google Doc-д оруулах HTML) үүсгэнэ:
//   node tools/review-doc.mjs <slug>  →  content/_work/<slug>/review-doc.html  (git-д орохгүй)
// Эх: content/drafts/<slug>.mjs (ноорог) + content/_work/<slug>/claims.json (эмчийн шалгах хүснэгт).
// Doc-ийн дараалал: заавар → А. эмнэлгийн баримт (K) → Б. эсрэг заалт/гаж нөлөө → В. асуулт → Г. хуулийн анхааруулга →
// бүтэн текст ([K#] шар) → зөвшөөрөл (reviewHash). Үнэ энд орохгүй (эзэмшигчийн үнийн хүснэгтэд).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reviewHash, FACT_KEYS } from './lib/content.mjs';
import { esc, inline, blocks } from './lib/render.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
if (!slug) { console.error('Хэрэглээ: node tools/review-doc.mjs <slug>'); process.exit(1); }
const draftFile = join(ROOT, 'content/drafts', slug + '.mjs');
const claimsFile = join(ROOT, 'content/_work', slug, 'claims.json');
if (!existsSync(draftFile) || !existsSync(claimsFile)) { console.error(`Алга: ${draftFile} эсвэл ${claimsFile}`); process.exit(1); }

const page = (await import(pathToFileURL(draftFile).href)).default;
const claims = JSON.parse(readFileSync(claimsFile, 'utf8'));
const { doctors } = await import(pathToFileURL(join(ROOT, 'content/doctors.mjs')).href);
const doc = doctors[page.reviewer] || { name: page.reviewer };
const hash = reviewHash(page);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' }).format(new Date());

// Дотоод лавлагаа (F12, S11) эмчид хэрэггүй
const clean = (s) => String(s || '').replace(/\s*—\s*[FS]\d+\b/g, '').replace(/\s*\((?:[FS]\d+(?:\s*[–,\-]\s*[FS]?\d+)*(?:;\s*)?)+\)/g, '').replace(/\s{2,}/g, ' ').trim();

// [[эмч: …]] → шар [K#]
const byProposed = new Map((claims.clinicFacts || []).map((k) => [k.proposed.trim(), k.id]));
const hl = (html) => html.replace(/<mark class="dr-q" title="[^"]*">([\s\S]*?)<\/mark>/g, (_, t) => {
  const plainT = t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const id = byProposed.get(plainT.trim()) || '?';
  return `<span style="background-color:#fff2a8"><b>[${id}]</b> ${t}</span>`;
});
const c = { preview: true, where: slug };
const B = (arr) => hl(blocks(arr, c));
const I = (s) => hl(inline(s, c));

const SECTION_TITLES = {
  what: (page.headings && page.headings.what) || `${page.name} гэж юу вэ`,
  suits: (page.headings && page.headings.suits) || 'Хэнд тохирох вэ',
  contraindications: (page.headings && page.headings.contraindications) || 'Хэнд хийхгүй вэ (эсрэг заалт)',
  procedure: (page.headings && page.headings.procedure) || 'Эмчилгээ хэрхэн явагддаг вэ',
  aftercare: (page.headings && page.headings.aftercare) || 'Эмчилгээний дараах арчилгаа',
  sideEffects: (page.headings && page.headings.sideEffects) || 'Гаж нөлөө, эрсдэл',
  price: (page.headings && page.headings.price) || 'Үнэ',
};
const FACT_LABEL = { duration: 'Үргэлжлэх хугацаа', anesthesia: 'Мэдээ алдуулалт', sessions: 'Давтамж, тоо', downtime: 'Эдгэрэлт' };
const td = 'style="border:1px solid #999;padding:6px;vertical-align:top"';
const th = 'style="border:1px solid #999;padding:6px;background:#efe8f6;text-align:left"';

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Эмчийн хяналт — ${esc(page.h1)}</title></head><body>
<h1>Эмчийн хяналт: ${esc(page.h1)}</h1>
<p><b>Хуудас:</b> www.skinaid.mn/emchilgee/${esc(slug)} (нийтлэгдээгүй ноорог) · <b>Хувилбар:</b> ${hash} · <b>Хянагч:</b> ${esc(doc.name)} эмч · <b>Бэлдсэн:</b> ${today}</p>

<h2>Хэрхэн хянах вэ (≈25 минут)</h2>
<ol>
<li>«А. Эмнэлгийн баримт» хүснэгтийн мөр бүрийн сүүлийн нүдэнд <b>З</b> (зөв), зөв утгыг, эсвэл <b>Х</b> (хасах) гэж бичнэ.</li>
<li>«Б»-д эсрэг заалт, гаж нөлөөний жагсаалтыг шалгана: илүүг нь зурж, дутууг нэмнэ.</li>
<li>«В» асуултуудад хариулна.</li>
<li>Бүтэн текстийг уншиж, санал байвал тухайн өгүүлбэр дээр <b>comment</b> (Insert → Comment) бичих эсвэл <b>Suggesting</b> горимоор засна. Шар өнгөтэй <b>[K#]</b> хэсэг нь «А» хүснэгтийн мөр юм.</li>
<li>Төгсгөлийн «Зөвшөөрөл» хэсэгт comment бичнэ: «Зөвшөөрөв — нэр, огноо».</li>
</ol>
<p><i>Тайлбар: Текстийг Claude (AI) ноороглож, олон улсын эх сурвалжаар (AAD, DermNet, NHS, PubMed г.м.) шалгасан. Эмнэлгийн практикийн баримтыг эмч баталгаажуулна. Хуудсанд «Хянасан: [нэр], [цол]» гэж гарна. Таны хариуг оруулсны дараа хувилбар өөрчлөгдөх тул эцсийн хувилбарыг дахин богино баталгаажуулна.</i></p>

<h2>А. Эмнэлгийн баримт (SkinAid-ийн практик)</h2>
<table style="border-collapse:collapse;width:100%">
<tr><th ${th}>№</th><th ${th}>Хэсэг</th><th ${th}>Хуудсанд бичсэн (санал)</th><th ${th}>Асуулт</th><th ${th}>Эмчийн хариу (З / утга / Х)</th></tr>
${(claims.clinicFacts || []).map((k) => `<tr><td ${td}><b>${esc(k.id)}</b></td><td ${td}>${esc(k.section)}</td><td ${td}>${esc(k.proposed)}</td><td ${td}>${esc(clean(k.question))}</td><td ${td}></td></tr>`).join('\n')}
</table>

<h2>Б. Эсрэг заалт, гаж нөлөө (хуудсанд байгаа жагсаалт)</h2>
<h3>Эсрэг заалт, болгоомжлох нөхцөл</h3>
<ul>${((claims.safety && claims.safety.contraindications) || []).map((x) => `<li>${esc(clean(x))}</li>`).join('')}</ul>
<h3>Гаж нөлөө, эрсдэл</h3>
<ul>${((claims.safety && claims.safety.sideEffects) || []).map((x) => `<li>${esc(clean(x))}</li>`).join('')}</ul>

<h2>В. Эмчид асуух асуулт</h2>
<ol>${(claims.openQuestions || []).filter((q) => !/^\(Эзэнд\)/.test(q)).slice(0, 6).map((q) => `<li>${esc(clean(q))}</li>`).join('')}</ol>

<h2>Г. Хуулийн анхааруулга (эзэмшигч шийднэ)</h2>
<ul>${(claims.legal || []).map((l) => `<li><b>${esc(l.id)}</b>: ${esc(clean(l.text))} — <i>${esc(clean(l.issue))}</i></li>`).join('')}</ul>

<hr>
<h2>Хуудасны бүтэн текст</h2>
<p><b>Google-ийн гарчиг:</b> ${esc(page.title)}<br><b>Google-ийн тайлбар:</b> ${esc(page.description)}</p>
<h1>${I(page.h1)}</h1>
<p>${I(page.summary)}</p>
<table style="border-collapse:collapse;width:100%">
${FACT_KEYS.map((k) => `<tr><th ${th}>${FACT_LABEL[k]}</th><td ${td}>${I(page.facts[k])}</td></tr>`).join('\n')}
<tr><th ${th}>Үнэ</th><td ${td}>Үнийн хүснэгтээс автоматаар (эзэмшигч баталгаажуулна)</td></tr>
</table>
${Object.entries(SECTION_TITLES).map(([k, h]) => `<h2>${esc(h)}</h2>\n${B(page.sections[k])}`).join('\n')}
<h2>Түгээмэл асуулт</h2>
${page.faq.map((f) => `<h3>${I(f.q)}</h3>\n${B(f.a)}`).join('\n')}
<h2>Эх сурвалж</h2>
<ol>${page.sources.map((s) => `<li>${esc(s.title)}. ${esc(s.publisher)}${s.year ? ', ' + esc(s.year) : ''}. ${esc(s.url)}</li>`).join('')}</ol>
<p><i>Хуудасны төгсгөлд: «Энэ мэдээлэл ерөнхий танилцуулга бөгөөд эмчийн үзлэг, зөвлөгөөг орлохгүй…»</i></p>

<hr>
<h2>Зөвшөөрөл</h2>
<p>Би «${esc(page.h1)}» хуудасны <b>${hash}</b> хувилбарыг хянаж, дээрх хариу, засварыг оруулсны дараа сайтад «Хянасан: [нэр], [цол]» гэж нэрээ гаргаж нийтлэхийг зөвшөөрч байна.</p>
<p>Нэр: ____________________ &nbsp; Цол: ____________________ &nbsp; Огноо: ____________</p>
</body></html>
`;
const out = join(ROOT, 'content/_work', slug, 'review-doc.html');
writeFileSync(out, html);
console.log(`✓ ${out} (hash ${hash}, K: ${(claims.clinicFacts || []).length}, үг ~${html.length})`);

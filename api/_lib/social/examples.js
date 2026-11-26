/**
 * Messenger AI — ажилтны баталсан сайн/муу хариуны ЖИШЭЭ (admin «Сургалт», Firestore `messenger_examples`). ЦЭВЭР модуль
 * (import: ../guardrails.js). Prompt-ийн 3-р (кэштэй) system блок болно — ../social/prompt.js `examplesBlock`.
 *
 * Зарчим:
 *   · Жишээ = хэв маяг, өнгө аясын үлгэр, БАРИМТ БИШ: доторх үнэ, хувь policy-ийн зөвшөөрсөн дүнд ОРОХГҮЙ (мэдлэг л).
 *   · Текстийг нууцална (redactForLlm) — ноорогоос үүссэн жишээний асуулт аль хэдийн нууцлагдсан, гараар бичсэнийг давхар.
 *   · Дараалал = id (кэш тогтвортой), хязгаартай; хасагдсаныг шалтгаантай буцаана (admin «Prompt-д юу орж байна»).
 */
import { redactForLlm } from '../guardrails.js';

export const EXAMPLE_LIMITS = Object.freeze({ items: 30, customerChars: 500, replyChars: 600, whyChars: 200, totalChars: 12_000 });

/**
 * @typedef {{ id: string, kind?: unknown, userText?: unknown, reply?: unknown, note?: unknown }} ExampleRow
 * @typedef {{ id: string, kind: 'good'|'bad', customer: string, reply: string, why: string }} PromptExample
 * @typedef {{ id: string, reason: 'invalid'|'empty'|'limit'|'total_limit' }} ExcludedExample
 */

const text = (v, max) => redactForLlm(String(typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim()).slice(0, max);

/**
 * @param {readonly ExampleRow[]} rows
 * @returns {{ items: PromptExample[], excluded: ExcludedExample[] }}
 */
export function buildExamples(rows) {
  /** @type {PromptExample[]} */
  const items = [];
  /** @type {ExcludedExample[]} */
  const excluded = [];
  let total = 0;
  const sorted = [...(rows || [])].filter((r) => r && typeof r.id === 'string').sort((a, b) => a.id.localeCompare(b.id));
  for (const r of sorted) {
    if (r.kind !== 'good' && r.kind !== 'bad') { excluded.push({ id: r.id, reason: 'invalid' }); continue; }
    const customer = text(r.userText, EXAMPLE_LIMITS.customerChars);
    const reply = text(r.reply, EXAMPLE_LIMITS.replyChars);
    const why = text(r.note, EXAMPLE_LIMITS.whyChars);
    // Сайн жишээнд хариу заавал; муу жишээнд хариу эсвэл тайлбарын нэг нь
    if (!customer || (r.kind === 'good' ? !reply : !reply && !why)) { excluded.push({ id: r.id, reason: 'empty' }); continue; }
    if (items.length >= EXAMPLE_LIMITS.items) { excluded.push({ id: r.id, reason: 'limit' }); continue; }
    const size = customer.length + reply.length + why.length;
    if (total + size > EXAMPLE_LIMITS.totalChars) { excluded.push({ id: r.id, reason: 'total_limit' }); continue; }
    total += size;
    items.push({ id: r.id, kind: r.kind, customer, reply, why });
  }
  return { items, excluded };
}

/**
 * Messenger AI — ажилтны баталсан сайн/муу хариуны ЖИШЭЭ (admin «Сургалт», Firestore `messenger_examples`). ЦЭВЭР модуль
 * (import: ../guardrails.js). Prompt-ийн 3-р (кэштэй) system блок болно — ../social/prompt.js `examplesBlock`.
 *
 * Зарчим:
 *   · Жишээ = хэв маяг, өнгө аясын үлгэр, БАРИМТ БИШ: доторх үнэ, хувь policy-ийн зөвшөөрсөн дүнд ОРОХГҮЙ (мэдлэг л).
 *   · Текстийг нууцална (redactForLlm) — ноорогоос үүссэн жишээний асуулт аль хэдийн нууцлагдсан, гараар бичсэнийг давхар.
 *   · Сонголт: ШИНЭ нь эхэнд (дуудагч updatedAt-аар эрэмбэлж өгнө — store.readKnowledgeLists), хязгаартай; prompt-ийн дараалал
 *     = id (кэш тогтвортой); хасагдсаныг шалтгаантай буцаана (admin «AI-д юу орж байна»).
 */
import { findPii, redactForLlm } from '../guardrails.js';

export const EXAMPLE_LIMITS = Object.freeze({ items: 30, customerChars: 500, replyChars: 600, whyChars: 200, totalChars: 12_000 });

/**
 * @typedef {{ id: string, kind?: unknown, userText?: unknown, reply?: unknown, note?: unknown }} ExampleRow
 * @typedef {{ id: string, kind: 'good'|'bad', customer: string, reply: string, why: string }} PromptExample
 * @typedef {{ id: string, reason: 'invalid'|'empty'|'pii'|'limit'|'total_limit' }} ExcludedExample
 */

/** Удирдлагын тэмдэгт хасна → нууцална → тасална (тасалсан ЭЦСИЙН текстийг дараа нь PII-гаар дахин шалгана) */
const text = (v, max) => redactForLlm(String(typeof v === 'string' ? v : '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).trim();

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
  // Оролтын дараалал = сонголтын давуу эрэмбэ (шинэ нь эхэнд); гаралтыг id-аар эрэмбэлнэ
  const ordered = [...(rows || [])].filter((r) => r && typeof r.id === 'string');
  for (const r of ordered) {
    if (r.kind !== 'good' && r.kind !== 'bad') { excluded.push({ id: r.id, reason: 'invalid' }); continue; }
    const customer = text(r.userText, EXAMPLE_LIMITS.customerChars);
    const reply = text(r.reply, EXAMPLE_LIMITS.replyChars);
    const why = text(r.note, EXAMPLE_LIMITS.whyChars);
    // Сайн жишээнд хариу заавал; муу жишээнд хариу эсвэл тайлбарын нэг нь
    if (!customer || (r.kind === 'good' ? !reply : !reply && !why)) { excluded.push({ id: r.id, reason: 'empty' }); continue; }
    // Тасалснаар «₮»-гүй болсон урт тоо г.м. — prompt-д орох хэлбэр (JSON) дээр шалгана (аудит 2026-11-27)
    if (findPii(JSON.stringify([customer, reply, why])).length) { excluded.push({ id: r.id, reason: 'pii' }); continue; }
    if (items.length >= EXAMPLE_LIMITS.items) { excluded.push({ id: r.id, reason: 'limit' }); continue; }
    const size = customer.length + reply.length + why.length;
    if (total + size > EXAMPLE_LIMITS.totalChars) { excluded.push({ id: r.id, reason: 'total_limit' }); continue; }
    total += size;
    items.push({ id: r.id, kind: r.kind, customer, reply, why });
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return { items, excluded };
}

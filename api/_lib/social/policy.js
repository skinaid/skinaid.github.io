/**
 * Messenger AI — бодлогын хөдөлгүүр. ЦЭВЭР модуль (import: ../guardrails.js, ./intents.js).
 * Эх сурвалж: skinaid/ubbeauty@1a43c95c src/lib/social/policy.ts.
 * SkinAid-д өөрчилсөн: moneyMentions/percentMentions нь ../guardrails.js-ээс (₮ угтвар хэлбэрийг уншдаг);
 * allowedHosts-ийн анхдагч = www.skinaid.mn.
 *
 * LLM-ийн гаралт = САНАЛ. Илгээх, ноорог үлдээх, хүнд шилжүүлэх эсэхийг ЭНД код шийднэ:
 *   1. Ажилтан ярианд хариулж байвал (state human/paused) бот чимээгүй.
 *   2. Сэдэв (LLM эсвэл кодын дохио) эрсдэлтэй → хүнд. Кодын дохио LLM-ийн ангиллыг ДАРНА.
 *   2а. «Автомат» горимд кирилл биш бичвэр (латин галиг г.м.) → хүнд: кодын дохио (2) зөвхөн кирилл үг таньдаг.
 *   3. AI итгэл бага, хариу хоосон, мэдлэгт байхгүй ₮/% дүн, валютгүй дүн («25,000-аар», «50 мянгаар»), мэдлэгт
 *      байхгүй хөнгөлөлт/үнэгүй/бэлэг/хувь → хүнд (үнэ, санал ЗӨВХӨН мэдлэгээс; SkinAid аудит 2026-11-25).
 *      `facts` өгвөл (агент үргэлж өгнө): дүн, хувь, хөнгөлөлтийн үг ЗӨВХӨН ИШ ТАТСАН (source_ids) баримтаас; үгүйсгэсэн
 *      өгүүлбэр («хөнгөлөлт байхгүй») хөнгөлөлтийг зөвшөөрөхгүй (аудит 2026-11-27: өөр баримтын дүн/үг бүх хариунд хүчинтэй
 *      байсан).
 *   4. Блоклох lint (баталгаа, эмчилгээний амлалт, PII, хувьсагч, 2000 тэмдэгт) → ноорог.
 *   5. Мэдээллийн сэдэвт мэдлэгийн иш байхгүй / мэдэгдэхгүй иш; иш шаардахгүй сэдэвт (мэнд, цаг захиалах) хэт урт
 *      хариу → ноорог.
 *   6. Prompt injection-ий оролдлого → ноорог (автомат хэзээ ч үгүй).
 *   7. Бусад → auto_candidate («автомат горимд явах байсан»).
 * Хүргэлт (`delivery`): «Автомат» горимд auto_candidate (AI-ийн хариу) ба handoff (тогтмол текст) = "send", бусад = "none".
 * Энэ нь зөвхөн БОДЛОГЫН зөвшөөрөл — жинхэнэ илгээлтийг ../outbound.js sendGuarded л шийднэ (үзэгчид, зогсоолт, 24 цаг…).
 */
import { hasBlocking, lintDraft, moneyMentions, numberMentions, offerMentions, percentMentions } from '../guardrails.js';
import { detectRiskSignals, intentDef, isForeignScript, isIntent, SIGNAL_INTENT } from './intents.js';

/** Үүнээс доош итгэлтэй саналыг хүнд шилжүүлнэ */
export const CONFIDENCE_MIN = 0.7;

/** Хариунд зөвшөөрөгдсөн холбоосын host (захиалгын холбоосыг КОД нэмнэ — booking-link.js) */
export const DEFAULT_ALLOWED_HOSTS = Object.freeze(['www.skinaid.mn', 'skinaid.mn']);
/** Иш шаардахгүй сэдэвт (мэнд, талархал, холбоо барих, цаг захиалах) хариуны дээд урт — урт бол хүн хянана */
export const NO_SOURCE_REPLY_MAX = 400;

/**
 * @typedef {{ intent: string, confidence: number, needs_human: boolean, reply: string, source_ids: string[],
 *   quick_replies: string[], reason: string }} AgentProposal
 * @typedef {{ mode: 'off'|'shadow'|'auto', conversationState: 'bot'|'human'|'paused', userText: string, proposal: AgentProposal,
 *   knownSourceIds: readonly string[], allowedAmounts: readonly number[], allowedPercents: readonly number[],
 *   knownNumbers?: readonly number[], knowledgeText?: string, facts?: readonly { id: string, text: string }[],
 *   bannedPhrases?: readonly string[], allowedHosts?: readonly string[] }} PolicyInput
 *   knownNumbers — мэдлэгийн текстэд байгаа тоо (үйлчилгээний нэр «Glutathione 1200» г.м.); knowledgeText — мэдлэгийн
 *   бүх текст (хөнгөлөлт/бэлэг гэх үг мэдлэгт байгаа эсэхийг шалгахад)
 * @typedef {{ route: import('./labels.js').SocialRoute, delivery: 'none'|'send', intent: import('./intents.js').SocialIntent,
 *   signals: import('./intents.js').RiskSignal[], reasons: string[], lint: import('../guardrails.js').LintIssue[],
 *   sourceIds: string[] }} PolicyDecision
 */

const PLACEHOLDER_RE = /\{[^{}\s]{1,30}\}/u;
/** Үгүйсгэсэн өгүүлбэр — доторх хөнгөлөлт/үнэгүй/бэлэг гэх үг санал болохгүй: «биш», «үгүй», «…гүй» (өгөхгүй, өгдөггүй,
 *  хөнгөлөлтгүй, байхгүй г.м.) — «үнэгүй» (= төлбөргүй) үгүйсгэл биш (аудит 2026-11-27) */
const isNegated = (sentence) => (sentence.toLowerCase().match(/\p{L}+/gu) || [])
  .some((w) => w === 'биш' || w === 'үгүй' || (w.endsWith('гүй') && !w.startsWith('үнэгүй')));

/**
 * Иш татсан баримтаас зөвшөөрөгдөх дүн, хувь, санал (хөнгөлөлтийн үг)-ийн текст.
 * @param {readonly { id: string, text: string }[]} facts @param {readonly string[]} sourceIds
 */
export function citedAllowance(facts, sourceIds) {
  const ids = new Set(sourceIds);
  const text = facts.filter((f) => ids.has(f.id)).map((f) => f.text).join('\n');
  const offerText = text.split(/[.!?;\n·]+/u).filter((x) => !isNegated(x)).join('\n').toLowerCase();
  return { amounts: moneyMentions(text), percents: percentMentions(text).map((n) => Math.round(n)), offerText };
}

/** Илгээж болох чиглэл: AI-ийн шалгагдсан хариу, эсвэл «ажилтанд дамжууллаа» тогтмол текст. draft/silent хэзээ ч үгүй. */
export const SENDABLE_ROUTES = Object.freeze(['auto_candidate', 'handoff']);

/** Хүргэлт — зөвхөн «Автомат» горимд, зөвхөн илгээж болох чиглэлд "send"; бусад бүх тохиолдолд "none" (fail-closed) */
export function deliveryFor(mode, route) {
  return mode === 'auto' && SENDABLE_ROUTES.includes(route) ? 'send' : 'none';
}

/** Кодын дохио LLM-ийн ангиллыг дарна (эрсдэлтэй дохио байвал тэр сэдэв). Дараалал intents.js PATTERNS-ийнх. */
export function resolveIntent(llmIntent, signals) {
  for (const s of signals) {
    if (s !== 'injection') return SIGNAL_INTENT[s];
  }
  return isIntent(llmIntent) ? llmIntent : 'other';
}

/** @param {PolicyInput} input @returns {PolicyDecision} */
export function decideReply(input) {
  const signals = detectRiskSignals(input.userText);
  const p = input.proposal;
  const intent = resolveIntent(p.intent, signals);
  const reply = String(p.reply ?? '').trim();
  const known = new Set(input.knownSourceIds);
  const sourceIds = [...new Set((p.source_ids ?? []).filter((id) => known.has(id)))];
  const lint = reply
    ? lintDraft(reply, { allowedHosts: [...(input.allowedHosts ?? DEFAULT_ALLOWED_HOSTS)], bannedPhrases: [...(input.bannedPhrases ?? [])] })
    : [];
  const common = { intent, signals, lint, sourceIds };
  /** @param {import('./labels.js').SocialRoute} route @param {string[]} reasons */
  const out = (route, reasons) => ({ ...common, delivery: deliveryFor(input.mode, route), route, reasons });

  if (input.conversationState !== 'bot') {
    return out('silent', ['human_active']);
  }

  // 2–3: хүнд
  const human = [];
  const llmDef = intentDef(p.intent);
  if (intentDef(intent).risk === 'human') human.push(`intent_human:${intent}`);
  else if (isIntent(p.intent) && llmDef.risk === 'human') human.push(`intent_human:${llmDef.key}`);
  for (const s of signals) if (s !== 'injection') human.push(`signal:${s}`);
  // «Автомат» горим: кирилл биш (латин галиг, англи…) мессежид кодын эрсдэлийн дохио ажилладаггүй — AI-ийн ангилалд дан
  // найдаж шууд хариулахгүй, ажилтанд (аудит 2026-11-26). Сүүдэрт ноорог хэвээр (үнэлгээ, eval өөрчлөгдөхгүй).
  // Мэдлэгт байгаа латин үг (брэнд, үйлчилгээний нэр) саад биш — танихгүй латин үг нэг л байвал ажилтанд.
  if (input.mode === 'auto' && isForeignScript(input.userText, input.knowledgeText)) human.push('foreign_script');
  if (p.needs_human) human.push('llm_needs_human');
  if (!(Number(p.confidence) >= CONFIDENCE_MIN)) human.push('low_confidence');
  if (!reply) human.push('empty_reply');
  const cited = input.facts ? citedAllowance(input.facts, sourceIds) : null;
  const amounts = new Set((cited ? cited.amounts : input.allowedAmounts).map((n) => Math.round(n)));
  if (moneyMentions(reply).some((n) => !amounts.has(n))) human.push('invented_price');
  const percents = new Set((cited ? cited.percents : input.allowedPercents).map((n) => Math.round(n)));
  if (percentMentions(reply).some((n) => !percents.has(Math.round(n)))) human.push('invented_percent');
  const numbers = new Set([...amounts, ...(input.knownNumbers ?? []).map((n) => Math.round(n))]);
  if (!human.includes('invented_price') && numberMentions(reply).some((n) => !numbers.has(Math.round(n)))) human.push('invented_price');
  const knowledge = cited ? cited.offerText : String(input.knowledgeText ?? '').toLowerCase();
  if (offerMentions(reply).some((w) => !knowledge.includes(w))) human.push('invented_offer');
  if (human.length) return out('handoff', [...new Set(human)]);

  // 4–6: ноорог
  const draft = [];
  if (hasBlocking(lint)) draft.push('lint_block');
  if (PLACEHOLDER_RE.test(reply)) draft.push('placeholder');
  if ((p.source_ids ?? []).some((id) => !known.has(id))) draft.push('unknown_source');
  if (intentDef(intent).needsSource && sourceIds.length === 0) draft.push('no_source');
  if (!intentDef(intent).needsSource && reply.length > NO_SOURCE_REPLY_MAX) draft.push('long_reply');
  if (signals.includes('injection')) draft.push('injection');
  if (draft.length) return out('draft', draft);

  return out('auto_candidate', []);
}

/** LLM-ийн JSON-ийг төрөл, хязгаараар цэвэрлэнэ (буруу хэлбэр = null) @returns {AgentProposal | null} */
export function parseProposal(raw) {
  let v = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v;
  if (typeof o.reply !== 'string' || typeof o.intent !== 'string') return null;
  const strs = (x, max, len) =>
    (Array.isArray(x) ? x : [])
      .filter((s) => typeof s === 'string')
      .map((s) => s.trim().slice(0, len))
      .filter(Boolean)
      .slice(0, max);
  const conf = Number(o.confidence);
  return {
    intent: o.intent.trim().slice(0, 40),
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
    needs_human: o.needs_human === true,
    reply: o.reply.trim().slice(0, 2000),
    source_ids: strs(o.source_ids, 20, 80),
    // Messenger quick reply-ийн гарчиг ≤ 20 тэмдэгт
    quick_replies: strs(o.quick_replies, 3, 20),
    reason: typeof o.reason === 'string' ? o.reason.trim().slice(0, 200) : '',
  };
}

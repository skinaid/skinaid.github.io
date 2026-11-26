/**
 * Messenger AI — агент: мэдлэг → prompt → Claude → бодлого → `messenger_drafts` (эсвэл admin-ийн туршилтын хариу).
 * ЭНЭ ФАЙЛ ҮЙЛЧЛҮҮЛЭГЧ РҮҮ ЮУ Ч ИЛГЭЭХГҮЙ — Meta-ийн Send API, outbound.js-ийг импортлохгүй (архитектурын тест).
 * «wouldSend» = «Автомат» горимд явах текст. Амьд ярианд (`live`: горим «Автомат» + үзэгчид таарсан — pipeline.js шийднэ)
 * агент `send: { kind, text, quickReplies }` САНАЛЫГ буцаана; жинхэнэ илгээлтийг pipeline → outbound.js sendGuarded хийнэ.
 * Admin-ийн туршилт/eval (`testDraft`) хэзээ ч `send` буцаахгүй.
 *
 * Fail-safe: тохиргоо/таг/түлхүүр/алдаа гарвал LLM-гүй, хүнд шилжүүлэх ноорог (эсвэл зөвхөн ai_runs-ийн бүртгэл).
 */
import { anthropicConfigured } from './config.js';
import { bookingUrl, slugForSources } from './booking-link.js';
import { PAGES } from './generated/pages-knowledge.js';
import { costMicroUsd, MESSENGER_MODEL } from './claude.js';
import { CLINIC } from './clinic-facts.js';
import { ubMonth } from './store.js';
import { unansweredUserText } from './social/conversation-logic.js';
import { composeBotReply, contactLine, handoffMessage, HANDOFF_REPLY, HUMAN_QUICK_REPLY, MEDIA_REPLY, needsDisclosure, urgentReply } from './social/disclosure.js';
import { decideReply, parseProposal } from './social/policy.js';
import { detectRiskSignals } from './social/intents.js';
import { buildSocialRequest, SOCIAL_PROMPT_VERSION } from './social/prompt.js';
import { socialIntentText, socialReasonText, socialRouteText } from './social/labels.js';

/** Захиалгын холбоос нэмэх сэдэв */
const LINK_INTENTS = new Set(['booking', 'price', 'service_info', 'promotion']);
/** Эмнэлгийн нийтийн утас/имэйлийг хариуны доор нэмэх сэдэв ба мэдлэгийн баримт — КОД нэмнэ (LLM-д дугаар, хаяг очдоггүй) */
const CONTACT_INTENT = 'contact';
const CONTACT_FACT = 'contact';
/** Ноорогт харуулах контекстын мөр */
const CONTEXT_TURNS = 6;

/** Түр зуурын Claude алдаа — дахин оролдож болно */
export const isRetryable = (code) => /^(?:timeout|network|api_(?:408|409|429|5\d\d))$/.test(String(code));

const roundConf = (n) => Math.round(Math.min(1, Math.max(0, Number(n) || 0)) * 100) / 100;

/** Admin-д харагдах шошго (хөтөч api/_lib-ийг импортолж чадахгүй тул серверт тооцож хадгална) */
const labelsFor = (route, intent, reasons) => ({
  route: socialRouteText(route),
  intent: socialIntentText(intent),
  reasons: reasons.map(socialReasonText),
});
/** saveDraft-ийн өмнө: шошго нэмнэ */
const withLabels = (d) => ({ ...d, labels: labelsFor(d.route, d.intent, d.reasons) });

/** Сарын хязгаарт хүрсэн эсэх (ноорог ба admin-ийн туршилт хуваалцана) */
export const capReached = (usage, settings) => usage.runs >= settings.monthlyRunCap || usage.costMicroUsd >= settings.monthlyCostCapUsd * 1e6;

/** Хүнд шилжих үед бот юу хэлэх байсан (код бичнэ) */
function templateFor(intent, signals, phone) {
  if (intent === 'media') return MEDIA_REPLY;
  if (intent === 'side_effect' || signals.includes('side_effect')) return urgentReply(phone);
  return HANDOFF_REPLY;
}

/**
 * @param {{ store: ReturnType<import('./store.js').createStore>, knowledge: ReturnType<import('./knowledge.js').createKnowledge>,
 *   callClaude: ReturnType<import('./claude.js').createClaudeCaller>, env?: Record<string, string|undefined>, now?: () => Date,
 *   log?: (msg: string) => void, pages?: readonly { slug: string, catalogIds?: readonly string[] }[],
 *   guard?: ReturnType<typeof import('./crisis.js').createCrisisGuard> }} deps
 */
export function createAgent(deps) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m) => console.warn(m));
  const { store, knowledge, callClaude } = deps;
  /** Хямралын автомат зогсолт (crisis.js) — заавал биш (тест) */
  const guard = deps.guard ?? null;
  const afterRun = async (run) => {
    if (!guard) return;
    try {
      await guard.afterRun(run);
    } catch (e) {
      log(`[messenger] хямралын шалгалт амжилтгүй: ${String(e?.name || 'error')}`);
    }
  };
  /** Нийтлэгдсэн эмчилгээний хуудас (захиалгын холбоосын ?svc=) — тест тарьна */
  const pages = deps.pages ?? PAGES;

  /** Нийтлэг ноорогийн талбар. mode: 'auto' = амьд яриа (илгээх оролдлоготой), 'shadow' = ноорог л */
  function baseDraft(psidHash, replyToEventId, turns, live = false) {
    const ctx = turns.slice(-CONTEXT_TURNS).map((t) => ({ role: t.role, text: String(t.text || '').slice(0, 1000), attachments: t.attachments || [] }));
    return { threadId: psidHash, replyToEventId, userText: unansweredUserText(turns), context: ctx, mode: live ? 'auto' : 'shadow' };
  }

  const dateOf = (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v : null);
  /**
   * AI тодруулга залгах эсэх. Амьд ярианд — бот энэ ярианд сүүлд ЖИНХЭНЭЭР илгээсэн мөчөөс (thread.lastBotSentAt; ажилтан
   * оролцсон бол pipeline түүнийг арилгадаг → хүнээс буцахад дахин танилцуулна). Сүүдэрт — загварчилсан мөчөөс (хуучнаар).
   */
  const disclose = (thread, live) => needsDisclosure({ lastBotAt: dateOf(live ? thread?.lastBotSentAt : thread?.lastShadowBotAt), now: now(), returnedFromHuman: false });
  /** Загвар (handoff, яаралтай, зураг) текст: амьд ярианд ботын анхны мессеж бол «Би … AI туслах» гэж танилцуулна */
  const templateText = (tpl, thread, live) => (live ? handoffMessage(tpl, { clinicName: CLINIC.name, withDisclosure: disclose(thread, true) }) : tpl);
  /** Илгээх санал (зөвхөн амьд ярианд, зөвхөн илгээж болох чиглэлд) — pipeline → outbound.js */
  const sendFor = (live, route, text, kind = route === 'handoff' ? 'handoff' : 'reply') => {
    if (!live || !text || (route !== 'auto_candidate' && route !== 'handoff')) return null;
    return { kind, text, quickReplies: kind === 'reply' ? [{ ...HUMAN_QUICK_REPLY }] : [] };
  };

  /**
   * Мэдлэг + яриа → Claude → бодлого → ноорогийн талбарууд (replyDraft ба testDraft хуваалцана).
   * @returns {Promise<{ status: 'error', code: string, retry: boolean, run: object }
   *   | { status: 'ok'|'fallback', fields: Record<string, any>, run: object }>}
   */
  async function generate({ k, turns, userText, thread, mode, runBase, t0 = Date.now(), live = false }) {
    const signals = detectRiskSignals(userText);
    const req = buildSocialRequest({ catalog: k.catalog, examples: k.examples, turns });
    const result = await callClaude(req);
    const u = result.usage || {};
    const run = {
      ...runBase,
      model: result.model,
      status: result.status === 'ok' ? 'ok' : result.status,
      errorCode: result.status === 'error' ? result.code : null,
      refusalCategory: result.status === 'refusal' ? result.category ?? null : null,
      inputTokens: Number(u.input_tokens) || 0,
      outputTokens: Number(u.output_tokens) || 0,
      cacheReadTokens: Number(u.cache_read_input_tokens) || 0,
      cacheWriteTokens: Number(u.cache_creation_input_tokens) || 0,
      costMicroUsd: costMicroUsd(result.model, result.usage),
      billable: Boolean(result.usage),
      durationMs: Date.now() - t0,
      context: req.context,
    };
    if (result.status === 'error') return { status: 'error', code: result.code, retry: isRetryable(result.code), run };

    const proposal = result.status === 'ok' ? parseProposal(result.text) : null;
    if (!proposal) {
      const reason = result.status === 'refusal' ? 'refusal' : 'invalid_output';
      const tpl = templateFor('other', signals, k.phone);
      return {
        status: 'fallback',
        run,
        fields: { route: 'handoff', intent: 'other', signals, reasons: [reason], lint: [], sourceIds: [], reply: '', templateReply: tpl, wouldSend: templateText(tpl, thread, live), link: null, contact: null, quickReplies: [], confidence: null, aiReason: '', model: result.model, promptVersion: SOCIAL_PROMPT_VERSION },
      };
    }

    const { catalog } = k;
    const decision = decideReply({
      mode,
      conversationState: thread?.state === 'human' || thread?.state === 'paused' ? thread.state : 'bot',
      userText,
      proposal,
      knownSourceIds: catalog.facts.map((f) => f.id),
      allowedAmounts: catalog.allowedAmounts,
      allowedPercents: catalog.allowedPercents,
      knownNumbers: catalog.knownNumbers,
      knowledgeText: catalog.knowledgeText,
      // Дүн, хувь, хөнгөлөлт — ЗӨВХӨН иш татсан баримтаас (policy.js citedAllowance)
      facts: catalog.facts,
    });
    const sendable = decision.route === 'auto_candidate' || decision.route === 'draft';
    const slug = slugForSources(decision.sourceIds, pages);
    const link = sendable && LINK_INTENTS.has(decision.intent) ? bookingUrl(slug ?? undefined, pages.map((p) => p.slug)) : null;
    // Утас/имэйл асуусан бол «Холбоо барих» мөр (prompt-ийн 6-р дүрэм: LLM бичихгүй, систем нэмнэ)
    // Сэдэв нь contact, ЭСВЭЛ хариу «contact» баримтыг иш татсан («Хаяг, утсаа хэлээч» → location + contact): баримт нь
    // «систем доор нэмнэ» гэж амладаг тул амласан бол заавал нэмнэ (шалгалт: зөвхөн сэдвээр шалгахад хоосон амлалт үлддэг байв)
    const wantsContact = decision.intent === CONTACT_INTENT || decision.sourceIds.includes(CONTACT_FACT);
    const contact = sendable && wantsContact ? contactLine({ phone: k.phone, email: k.email }) : '';
    const templateReply = decision.route === 'handoff' ? templateFor(decision.intent, decision.signals, k.phone) : null;
    let wouldSend = null;
    if (decision.route === 'auto_candidate') {
      const body = [proposal.reply, contact, link ? `Цаг захиалах: ${link}` : ''].filter(Boolean).join('\n\n');
      wouldSend = composeBotReply(body, { clinicName: CLINIC.name, withDisclosure: disclose(thread, live) });
    } else if (decision.route === 'handoff') {
      wouldSend = templateText(templateReply, thread, live);
    }
    return {
      status: 'ok',
      run,
      fields: {
        route: decision.route,
        intent: decision.intent,
        signals: decision.signals,
        reasons: decision.reasons,
        lint: decision.lint.map((l) => ({ code: l.code, severity: l.severity, match: String(l.match ?? '').slice(0, 80) })),
        sourceIds: decision.sourceIds,
        reply: proposal.reply,
        templateReply,
        wouldSend,
        link,
        // Код нэмсэн «Холбоо барих» мөр (үгүй бол null) — admin-д ил: LLM биш, систем бичсэн
        contact: contact || null,
        quickReplies: proposal.quick_replies,
        confidence: roundConf(proposal.confidence),
        aiReason: proposal.reason,
        model: result.model,
        promptVersion: SOCIAL_PROMPT_VERSION,
      },
    };
  }

  return {
    /**
     * Зураг/видео/дуу л ирсэн — LLM-гүй загвар ноорог. Амьд ярианд `send` (зургийн загвар хариу) буцаана; зөвхөн стикер
     * (👍) бол илгээхгүй, ажилтанд шилжүүлэхгүй (`quiet`).
     * @param {{ psidHash: string, replyToEventId: string, eventStatus?: Record<string, string>, thread?: Record<string, any>|null,
     *   live?: boolean, stickerOnly?: boolean }} input
     */
    async mediaDraft({ psidHash, replyToEventId, eventStatus, thread = null, live = false, stickerOnly = false }) {
      const turns = await store.recentTurns(psidHash, CONTEXT_TURNS);
      const quiet = Boolean(live && stickerOnly);
      const wouldSend = templateText(MEDIA_REPLY, thread, live);
      const saved = await store.saveDraftEx({
        replyToEventId,
        eventStatus,
        draft: withLabels({
          ...baseDraft(psidHash, replyToEventId, turns, live),
          route: 'handoff', intent: 'media', signals: [], reasons: ['media'], lint: [], sourceIds: [],
          reply: '', templateReply: MEDIA_REPLY, wouldSend, link: null, contact: null, quickReplies: [],
          confidence: null, aiReason: '', model: null, promptVersion: SOCIAL_PROMPT_VERSION,
          ...(quiet ? { sendStatus: 'skipped', sendReason: 'sticker' } : {}),
        }),
        run: null,
      });
      return { route: 'handoff', finalized: true, draftId: saved.draftId, quiet, send: saved.created && !quiet ? sendFor(live, 'handoff', wouldSend, 'media') : null };
    },

    /**
     * Хэрэглэгчийн текстэд ноорог бичнэ. eventStatus-ийг ноорогтой НЭГ commit-д дуусгана (finalized: true).
     * Түр зуурын Claude алдаа (timeout, 429, 5xx) → { retry: true } — pipeline event-ийг дахин оролдоно.
     * `live` (амьд яриа) үед буцаах `send` = илгээх санал (auto_candidate → AI-ийн хариу; handoff → загвар текст; бусад → null).
     * Ноорог энэ дуудлагаар ШИНЭЭР үүсээгүй бол `send` = null (хадгалсан ноорогоос өөр текст явахгүй).
     * @param {{ psidHash: string, replyToEventId: string, thread: Record<string, any>, eventStatus?: Record<string, string>, live?: boolean }} input
     */
    async replyDraft({ psidHash, replyToEventId, thread, eventStatus, live = false }) {
      const settings = await store.readSettings();
      if (!settings.active) return { skipped: 'inactive', finalized: false };
      const t0 = Date.now();
      const month = ubMonth(now());
      const runBase = { kind: 'messenger_reply', model: MESSENGER_MODEL, promptVersion: SOCIAL_PROMPT_VERSION, threadId: psidHash };

      if (!anthropicConfigured(env)) {
        await store.saveDraft({ draft: null, run: { ...runBase, status: 'not_configured', billable: false, durationMs: 0 }, month, eventStatus });
        return { skipped: 'not_configured', finalized: true };
      }

      const [turns, k, usage] = await Promise.all([
        store.recentTurns(psidHash, 10),
        knowledge.load(),
        store.readUsage(month),
      ]);
      const base = baseDraft(psidHash, replyToEventId, turns, live);
      const signals = detectRiskSignals(base.userText);

      // Сарын хязгаар: LLM-гүй, ажилтанд
      if (capReached(usage, settings)) {
        const tpl = templateFor('other', signals, k.phone);
        const wouldSend = templateText(tpl, thread, live);
        const saved = await store.saveDraftEx({
          draft: withLabels({ ...base, route: 'handoff', intent: 'other', signals, reasons: ['cap_reached'], lint: [], sourceIds: [], reply: '', templateReply: tpl, wouldSend, link: null, contact: null, quickReplies: [], confidence: null, aiReason: '', model: null, promptVersion: SOCIAL_PROMPT_VERSION }),
          run: { ...runBase, status: 'cap', billable: false, durationMs: 0 },
          month,
          replyToEventId,
          eventStatus,
        });
        return { route: 'handoff', reason: 'cap_reached', finalized: true, draftId: saved.draftId, send: saved.created ? sendFor(live, 'handoff', wouldSend) : null };
      }

      const g = await generate({ k, turns, userText: base.userText, thread, mode: settings.mode, runBase, t0, live });
      if (g.status === 'error') {
        // Ноорог бичихгүй — бүртгэл + статус. Түр зуурын алдаа бол event pending үлдэж дахин оролдоно (MAX_ATTEMPTS).
        // retryable — хямралын «дараалсан алдаа»-нд тоологдохгүй (crisis.js)
        const run = { ...g.run, retryable: Boolean(g.retry) };
        await store.saveDraft({ draft: null, run, month, eventStatus: g.retry ? null : eventStatus });
        await store.patchStatus({ lastError: { code: String(g.code).slice(0, 40), at: now() } }).catch(() => {});
        log(`[messenger] Claude алдаа: ${g.code}`);
        await afterRun(run);
        return { error: g.code, retry: g.retry, finalized: !g.retry };
      }
      const saved = await store.saveDraftEx({ draft: withLabels({ ...base, ...g.fields }), run: g.run, month, replyToEventId, eventStatus });
      await afterRun(g.run);
      const send = saved.created ? sendFor(live, g.fields.route, g.fields.wouldSend) : null;
      if (g.status === 'fallback') return { route: 'handoff', reason: g.fields.reasons[0], finalized: true, draftId: saved.draftId, send };
      return { route: g.fields.route, simulatedBot: g.fields.route === 'auto_candidate', finalized: true, draftId: saved.draftId, send };
    },

    /**
     * Admin-ийн «Туршилтын асуулт» (api/_lib/admin-api.js): үйлдвэрлэлийн ИЖИЛ мэдлэг, prompt, Claude, бодлого — ноорог
     * бичихгүй, хэнд ч илгээхгүй. Хязгаар, тоологчийг дуудагч шалгаж бичнэ (store.saveAdminRun).
     * @param {{ k: Awaited<ReturnType<ReturnType<typeof import('./knowledge.js').createKnowledge>['load']>>, text?: string,
     *   turns?: { role: string, text: string }[], mode?: string, kind?: string }} input
     *   text — нэг мессеж; turns — олон мөрт яриа (eval). Аль аль нь НУУЦАЛСАН (redactForLlm) байна.
     */
    async testDraft({ k, text, turns: given, mode = 'shadow', kind = 'admin_test' }) {
      const turns = given ? given.map((t) => ({ role: t.role, text: t.text, attachments: [] })) : [{ role: 'user', text, attachments: [] }];
      const userText = unansweredUserText(turns);
      const runBase = { kind, model: MESSENGER_MODEL, promptVersion: SOCIAL_PROMPT_VERSION, threadId: null };
      const g = await generate({ k, turns, userText, thread: null, mode, runBase });
      return g.status === 'error'
        ? { status: 'error', code: g.code, run: g.run }
        : { status: g.status, draft: withLabels({ userText, ...g.fields }), run: g.run };
    },
  };
}

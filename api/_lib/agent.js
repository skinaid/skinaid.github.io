/**
 * Messenger AI — сүүдрийн агент: мэдлэг → prompt → Claude → бодлого → `messenger_drafts`.
 * ҮЙЛЧЛҮҮЛЭГЧ РҮҮ ЮУ Ч ИЛГЭЭХГҮЙ — энд Meta-ийн Send API, илгээх функц огт байхгүй (1-р үе шат).
 * «wouldSend» = автомат горимд (3-р үе шат) явах байсан текст — зөвхөн ажилтан үнэлэхэд харуулна.
 *
 * Fail-safe: тохиргоо/таг/түлхүүр/алдаа гарвал LLM-гүй, хүнд шилжүүлэх ноорог (эсвэл зөвхөн ai_runs-ийн бүртгэл).
 */
import { anthropicConfigured } from './config.js';
import { bookingUrl } from './booking-link.js';
import { costMicroUsd, MESSENGER_MODEL } from './claude.js';
import { CLINIC } from './clinic-facts.js';
import { ubMonth } from './store.js';
import { unansweredUserText } from './social/conversation-logic.js';
import { composeBotReply, HANDOFF_REPLY, MEDIA_REPLY, needsDisclosure, urgentReply } from './social/disclosure.js';
import { decideReply, parseProposal } from './social/policy.js';
import { detectRiskSignals } from './social/intents.js';
import { buildSocialRequest, SOCIAL_PROMPT_VERSION } from './social/prompt.js';

/** Захиалгын холбоос нэмэх сэдэв */
const LINK_INTENTS = new Set(['booking', 'price', 'service_info', 'promotion']);
/** Ноорогт харуулах контекстын мөр */
const CONTEXT_TURNS = 6;

const roundConf = (n) => Math.round(Math.min(1, Math.max(0, Number(n) || 0)) * 100) / 100;

/** Хүнд шилжих үед бот юу хэлэх байсан (код бичнэ) */
function templateFor(intent, signals, phone) {
  if (intent === 'media') return MEDIA_REPLY;
  if (intent === 'side_effect' || signals.includes('side_effect')) return urgentReply(phone);
  return HANDOFF_REPLY;
}

/**
 * @param {{ store: ReturnType<import('./store.js').createStore>, knowledge: ReturnType<import('./knowledge.js').createKnowledge>,
 *   callClaude: ReturnType<import('./claude.js').createClaudeCaller>, env?: Record<string, string|undefined>, now?: () => Date,
 *   log?: (msg: string) => void }} deps
 */
export function createAgent(deps) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m) => console.warn(m));
  const { store, knowledge, callClaude } = deps;

  /** Нийтлэг ноорогийн талбар */
  function baseDraft(psidHash, replyToEventId, turns) {
    const ctx = turns.slice(-CONTEXT_TURNS).map((t) => ({ role: t.role, text: String(t.text || '').slice(0, 1000), attachments: t.attachments || [] }));
    return { threadId: psidHash, replyToEventId, userText: unansweredUserText(turns), context: ctx, mode: 'shadow' };
  }

  return {
    /**
     * Зураг/видео/дуу л ирсэн — LLM-гүй загвар ноорог.
     */
    async mediaDraft({ psidHash, replyToEventId }) {
      const turns = await store.recentTurns(psidHash, CONTEXT_TURNS);
      await store.saveDraft({
        draft: {
          ...baseDraft(psidHash, replyToEventId, turns),
          route: 'handoff', intent: 'media', signals: [], reasons: ['media'], lint: [], sourceIds: [],
          reply: '', templateReply: MEDIA_REPLY, wouldSend: MEDIA_REPLY, link: null, quickReplies: [],
          confidence: null, aiReason: '', model: null, promptVersion: SOCIAL_PROMPT_VERSION,
        },
        run: null,
      });
      return { route: 'handoff' };
    },

    /**
     * Хэрэглэгчийн текстэд ноорог бичнэ.
     * @param {{ psidHash: string, replyToEventId: string, thread: Record<string, any> }} input
     */
    async replyDraft({ psidHash, replyToEventId, thread }) {
      const settings = await store.readSettings();
      if (!settings.active) return { skipped: 'inactive' };
      const t0 = Date.now();
      const month = ubMonth(now());
      const runBase = { kind: 'messenger_reply', model: MESSENGER_MODEL, promptVersion: SOCIAL_PROMPT_VERSION, threadId: psidHash };

      if (!anthropicConfigured(env)) {
        await store.saveDraft({ draft: null, run: { ...runBase, status: 'not_configured', billable: false, durationMs: 0 }, month });
        return { skipped: 'not_configured' };
      }

      const [turns, { catalog, phone }, usage] = await Promise.all([
        store.recentTurns(psidHash, 10),
        knowledge.load(),
        store.readUsage(month),
      ]);
      const base = baseDraft(psidHash, replyToEventId, turns);
      const signals = detectRiskSignals(base.userText);

      // Сарын таг: LLM-гүй, хүнд
      if (usage.runs >= settings.monthlyRunCap || usage.costMicroUsd >= settings.monthlyCostCapUsd * 1e6) {
        const tpl = templateFor('other', signals, phone);
        await store.saveDraft({
          draft: { ...base, route: 'handoff', intent: 'other', signals, reasons: ['cap_reached'], lint: [], sourceIds: [], reply: '', templateReply: tpl, wouldSend: tpl, link: null, quickReplies: [], confidence: null, aiReason: '', model: null, promptVersion: SOCIAL_PROMPT_VERSION },
          run: { ...runBase, status: 'cap', billable: false, durationMs: 0 },
          month,
        });
        return { route: 'handoff', reason: 'cap_reached' };
      }

      const req = buildSocialRequest({ catalog, turns });
      const result = await callClaude(req);
      const cost = costMicroUsd(result.model, result.usage);
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
        costMicroUsd: cost,
        billable: Boolean(result.usage),
        durationMs: Date.now() - t0,
        context: req.context,
      };

      if (result.status === 'error') {
        // Ноорог бичихгүй (ажилтан Meta Inbox-оос хариулна) — зөвхөн бүртгэл + статус
        await store.saveDraft({ draft: null, run, month });
        await store.patchStatus({ lastError: { code: String(result.code).slice(0, 40), at: now() } }).catch(() => {});
        log(`[messenger] Claude алдаа: ${result.code}`);
        return { error: result.code };
      }

      const proposal = result.status === 'ok' ? parseProposal(result.text) : null;
      if (!proposal) {
        const reason = result.status === 'refusal' ? 'refusal' : 'invalid_output';
        const tpl = templateFor('other', signals, phone);
        await store.saveDraft({
          draft: { ...base, route: 'handoff', intent: 'other', signals, reasons: [reason], lint: [], sourceIds: [], reply: '', templateReply: tpl, wouldSend: tpl, link: null, quickReplies: [], confidence: null, aiReason: '', model: result.model, promptVersion: SOCIAL_PROMPT_VERSION },
          run,
          month,
        });
        return { route: 'handoff', reason };
      }

      const decision = decideReply({
        mode: settings.mode,
        conversationState: thread?.state === 'human' || thread?.state === 'paused' ? thread.state : 'bot',
        userText: base.userText,
        proposal,
        knownSourceIds: catalog.facts.map((f) => f.id),
        allowedAmounts: catalog.allowedAmounts,
        allowedPercents: catalog.allowedPercents,
      });
      const sendable = decision.route === 'auto_candidate' || decision.route === 'draft';
      const link = sendable && LINK_INTENTS.has(decision.intent) ? bookingUrl() : null;
      const templateReply = decision.route === 'handoff' ? templateFor(decision.intent, decision.signals, phone) : null;
      let wouldSend = null;
      if (decision.route === 'auto_candidate') {
        const lastBotAt = thread?.lastShadowBotAt instanceof Date ? thread.lastShadowBotAt : null;
        const body = link ? `${proposal.reply}\n\nЦаг захиалах: ${link}` : proposal.reply;
        wouldSend = composeBotReply(body, { clinicName: CLINIC.name, withDisclosure: needsDisclosure({ lastBotAt, now: now(), returnedFromHuman: false }) });
      } else if (decision.route === 'handoff') {
        wouldSend = templateReply;
      }

      await store.saveDraft({
        draft: {
          ...base,
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
          quickReplies: proposal.quick_replies,
          confidence: roundConf(proposal.confidence),
          aiReason: proposal.reason,
          model: result.model,
          promptVersion: SOCIAL_PROMPT_VERSION,
        },
        run,
        month,
      });
      return { route: decision.route, simulatedBot: decision.route === 'auto_candidate' };
    },
  };
}

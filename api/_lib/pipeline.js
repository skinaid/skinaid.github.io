/**
 * Messenger AI — нэг ярианы event-үүдийг дараалан боловсруулна (webhook-ийн waitUntil болон өдөр бүрийн cron).
 *
 *   lockThread (optimistic, 120 с) → pending event-үүд → echo загварын hash → planBatch (conversation-logic.js)
 *   → мессеж + төлөв + event-ийн төлөв (нэг commit) → agent: ноорог | зураг: LLM-гүй ноорог | юу ч үгүй
 *   → түгжээ тайлах → шинэ pending ирсэн бол дахин (≤ 3 тойрог).
 *
 * Гацсан event: webhook бүр `sweepStale`-ээр (≤ 2 яриа), cron `sweepStale`-ээр (хугацааны төсөвтэй) нөхнө.
 * Хэрэглэгч рүү ЮУ Ч илгээхгүй.
 */
import { FirestoreError } from './firestore.js';
import { AUTOMATION_TEMPLATE_MIN_CONVERSATIONS, echoFingerprint, planBatch } from './social/conversation-logic.js';

const ROUNDS = 3;

/** Алдааны код (мессежийн агуулга, текстийг логлохгүй) */
function errorCode(e) {
  if (e instanceof FirestoreError) return `firestore_${e.status || e.httpStatus}`;
  return String((e && e.message) || 'error').split(/[:\s]/)[0].slice(0, 60) || 'error';
}
const asDate = (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v : null);

/**
 * @param {{ store: ReturnType<import('./store.js').createStore>, agent: ReturnType<import('./agent.js').createAgent>,
 *   ownAppId: string|null, now?: () => Date, log?: (m: string) => void }} deps
 */
export function createPipeline(deps) {
  const { store, agent } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m) => console.warn(m));

  /** Нэг тойрог: planBatch → бичих → агент. Буцаах = түгжээ тайлахад thread-д бичих нэмэлт талбар. */
  async function handle(psidHash, thread, events, actions) {
    const settings = await store.readSettings();
    const mode = settings.active ? settings.mode : 'off';
    const fps = events.filter((e) => e.kind === 'echo').map((e) => echoFingerprint(e.payload.text));
    const automationHashes = mode === 'off' ? new Set() : await store.automationHashes(psidHash, fps, AUTOMATION_TEMPLATE_MIN_CONVERSATIONS);
    const conv = {
      state: thread.state === 'human' || thread.state === 'paused' ? thread.state : 'bot',
      humanSince: asDate(thread.humanSince),
      lastStaffAt: asDate(thread.lastStaffAt),
      lastUserAt: asDate(thread.lastUserAt),
    };
    const plan = planBatch(conv, events, { mode, ownAppId: deps.ownAppId, now: now(), automationHashes });
    await store.saveBatch(psidHash, plan, thread);
    const nextThread = { ...thread, ...plan.conversation };
    if (plan.action.type === 'agent') {
      const r = await agent.replyDraft({ psidHash, replyToEventId: plan.action.replyToEventId, thread: nextThread });
      actions.push(r.route || r.skipped || r.error || 'agent');
      return r.simulatedBot ? { lastShadowBotAt: now() } : {};
    }
    if (plan.action.type === 'media_template') {
      await agent.mediaDraft({ psidHash, replyToEventId: plan.action.replyToEventId });
      actions.push('media');
      return {};
    }
    actions.push(plan.action.reason);
    return {};
  }

  /** @returns {Promise<{ rounds: number, locked?: boolean, actions: string[] }>} */
  async function processThread(psidHash) {
    const actions = [];
    for (let round = 0; round < ROUNDS; round++) {
      const lock = await store.lockThread(psidHash);
      if (!lock.ok) return { rounds: round, locked: true, actions };
      const thread = lock.thread || {};
      let release = {};
      let events = [];
      let stop = null;
      try {
        events = await store.pendingEvents(psidHash);
        if (!events.length) stop = { rounds: round, actions };
        else release = await handle(psidHash, thread, events, actions);
      } catch (e) {
        // Event-үүдийг дахин оролдох (MAX_ATTEMPTS хүрвэл failed) — алдааны мессеж/текстийг логлохгүй
        const code = errorCode(e);
        log(`[messenger] яриа боловсруулахад алдаа: ${code}`);
        if (events.length) await store.failEvents(events, code).catch(() => {});
        await store.patchStatus({ lastError: { code, at: now() } }).catch(() => {});
        release = {};
        stop = { rounds: round + 1, actions: [...actions, 'error'] };
      } finally {
        await store.releaseThread(psidHash, release).catch(() => log('[messenger] түгжээ тайлж чадсангүй (120 с-ийн дараа өөрөө тайлагдана)'));
      }
      if (stop) return stop;
    }
    return { rounds: ROUNDS, actions };
  }

  /**
   * Гацсан (retryAt өнгөрсөн) event-тэй яриануудыг боловсруулна.
   * @param {{ maxThreads?: number, deadline?: number }} [opt]  deadline = Date.now()-ийн дээд хязгаар (мс)
   */
  async function sweepStale(opt = {}) {
    const max = opt.maxThreads ?? 2;
    const threads = await store.staleThreads(Math.max(max * 5, 10));
    let done = 0;
    for (const h of threads.slice(0, max)) {
      if (opt.deadline && Date.now() > opt.deadline) break;
      await processThread(h);
      done++;
    }
    return done;
  }

  return { processThread, sweepStale };
}

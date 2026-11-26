/**
 * Messenger AI — нэг ярианы event-үүдийг дараалан боловсруулна (webhook-ийн waitUntil болон өдөр бүрийн cron).
 *
 *   lockThread (optimistic, 120 с; авч чадаагүй бол 2 с тутам ≤ 3 удаа хүлээнэ) → pending event-үүд → echo загварын hash
 *   → planBatch (conversation-logic.js) → мессеж + thread-ийн төлөв → agent: ноорог | зураг: LLM-гүй ноорог | юу ч үгүй
 *   → event-ийн эцсийн төлөв НООРОГТОЙ НЭГ commit-д → түгжээ тайлах → pending үлдсэн бол дахин (хугацааны төсөв дотор).
 *
 * Хугацааны төсөв (Vercel Hobby, maxDuration 60 с): `deadline`-аас 30 с-ээс бага үлдвэл Claude-ийг дуудахгүй — event
 * pending үлдэж дараагийн webhook / cron нөхнө. Функц агентын явцад тасарвал event pending хэвээр (ноорог алдагдахгүй).
 * Нэг ярианд өдөрт ≤ THREAD_DAILY_AGENT_MAX удаа Claude (нэг хэрэглэгч сарын таг, Spark квотыг дуусгахаас сэргийлнэ).
 * Хэрэглэгч рүү ЮУ Ч илгээхгүй.
 */
import { FirestoreError } from './firestore.js';
import { describeError } from './errors.js';
import { AUTOMATION_TEMPLATE_MIN_CONVERSATIONS, echoFingerprint, planBatch } from './social/conversation-logic.js';

export const ROUNDS_MAX = 6;
/** Claude-ийг дуудахад шаардлагатай үлдэгдэл хугацаа (Claude timeout 25 с + Firestore) */
export const AGENT_MIN_MS = 30_000;
export const LOCK_POLL_MS = 2000;
export const LOCK_POLLS = 3;
export const THREAD_DAILY_AGENT_MAX = 40;
/** Webhook-ийн waitUntil-ийн төсөв (maxDuration 60 с) */
export const WEBHOOK_BUDGET_MS = 50_000;

/** Алдааны код (мессежийн агуулга, текстийг логлохгүй) */
function errorCode(e) {
  if (e instanceof FirestoreError) return `firestore_${e.status || e.httpStatus}`;
  return String((e && e.message) || 'error').split(/[:\s]/)[0].slice(0, 60) || 'error';
}
const asDate = (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v : null);
/** Улаанбаатарын өдөр («2026-11-25») */
const ubDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/**
 * @param {{ store: ReturnType<import('./store.js').createStore>, agent: ReturnType<import('./agent.js').createAgent>,
 *   ownAppId: string|null, now?: () => Date, log?: (m: string) => void, sleep?: (ms: number) => Promise<void>,
 *   clock?: () => number }} deps   clock — хугацааны төсөвт (тест тарьна)
 */
export function createPipeline(deps) {
  const { store, agent } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m) => console.warn(m));
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const clock = deps.clock ?? Date.now;

  /**
   * Нэг тойрог. Буцаах: { release } — түгжээ тайлахад thread-д бичих нэмэлт талбар; { stop } — энэ удаад зогсох.
   */
  async function handle(psidHash, thread, events, actions, deadline) {
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
      const today = ubDay(now());
      const count = thread.agentDay === today ? Number(thread.agentDayCount) || 0 : 0;
      if (count >= THREAD_DAILY_AGENT_MAX) {
        await store.finishEvents(plan.eventStatus);
        actions.push('thread_cap');
        return { release: {} };
      }
      if (clock() > deadline - AGENT_MIN_MS) {
        // Хугацаа хүрэлцэхгүй — event pending үлдэнэ (мессеж, төлөв бичигдсэн; дахин боловсруулахад давхардахгүй)
        actions.push('deadline');
        return { release: {}, stop: true };
      }
      const r = await agent.replyDraft({ psidHash, replyToEventId: plan.action.replyToEventId, thread: nextThread, eventStatus: plan.eventStatus });
      actions.push(r.route || r.skipped || r.error || 'agent');
      if (r.retry) {
        await store.failEvents(events, r.error);
        return { release: { agentDay: today, agentDayCount: count + 1 }, stop: true };
      }
      if (!r.finalized) await store.finishEvents(plan.eventStatus);
      const release = r.skipped ? {} : { agentDay: today, agentDayCount: count + 1 };
      if (r.simulatedBot) release.lastShadowBotAt = now();
      return { release };
    }
    if (plan.action.type === 'media_template') {
      await agent.mediaDraft({ psidHash, replyToEventId: plan.action.replyToEventId, eventStatus: plan.eventStatus });
      actions.push('media');
      return { release: {} };
    }
    await store.finishEvents(plan.eventStatus);
    actions.push(plan.action.reason);
    return { release: {} };
  }

  /** Түгжээ — авч чадаагүй бол (өөр инстанс ажиллаж байна) хугацаа хүрэлцвэл хэд хүлээж дахин оролдоно */
  async function acquire(psidHash, deadline) {
    let lock = await store.lockThread(psidHash);
    for (let i = 0; !lock.ok && i < LOCK_POLLS && clock() + LOCK_POLL_MS < deadline - AGENT_MIN_MS; i++) {
      await sleep(LOCK_POLL_MS);
      lock = await store.lockThread(psidHash);
    }
    return lock;
  }

  /**
   * @param {string} psidHash
   * @param {{ deadline?: number }} [opt]  deadline = clock()-ийн дээд хязгаар (мс)
   * @returns {Promise<{ rounds: number, locked?: boolean, actions: string[] }>}
   */
  async function processThread(psidHash, opt = {}) {
    const deadline = opt.deadline ?? clock() + WEBHOOK_BUDGET_MS;
    const actions = [];
    for (let round = 0; round < ROUNDS_MAX; round++) {
      const lock = await acquire(psidHash, deadline);
      if (!lock.ok) return { rounds: round, locked: true, actions };
      const thread = lock.thread || {};
      let release = {};
      let events = [];
      let stop = null;
      try {
        events = await store.pendingEvents(psidHash);
        if (!events.length) stop = { rounds: round, actions };
        else {
          const r = await handle(psidHash, thread, events, actions, deadline);
          release = r.release;
          if (r.stop) stop = { rounds: round + 1, actions };
        }
      } catch (e) {
        // Event-үүдийг дахин оролдох (MAX_ATTEMPTS хүрвэл failed) — алдааны мессеж/текстийг логлохгүй
        const code = errorCode(e);
        log(`[messenger] яриа боловсруулахад алдаа: ${describeError(e)}`);
        if (events.length) await store.failEvents(events, code).catch(() => {});
        await store.patchStatus({ lastError: { code, at: now() } }).catch(() => {});
        release = {};
        stop = { rounds: round + 1, actions: [...actions, 'error'] };
      } finally {
        await store.releaseThread(psidHash, release).catch(() => log('[messenger] түгжээ тайлж чадсангүй (120 с-ийн дараа өөрөө тайлагдана)'));
      }
      if (stop) return stop;
      if (clock() > deadline - 5000) return { rounds: round + 1, actions: [...actions, 'deadline'] };
    }
    return { rounds: ROUNDS_MAX, actions };
  }

  /**
   * Гацсан (retryAt өнгөрсөн) event-тэй яриануудыг боловсруулна.
   * @param {{ maxThreads?: number, deadline?: number }} [opt]
   */
  async function sweepStale(opt = {}) {
    const max = opt.maxThreads ?? 2;
    const deadline = opt.deadline ?? clock() + WEBHOOK_BUDGET_MS;
    const threads = await store.staleThreads(Math.max(max * 5, 10));
    let done = 0;
    for (const h of threads.slice(0, max)) {
      if (clock() > deadline - AGENT_MIN_MS) break;
      await processThread(h, { deadline });
      done++;
    }
    return done;
  }

  return { processThread, sweepStale };
}

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
 *
 * Илгээлт («Автомат» горим): яриа «АМЬД» (`isLive`: горим auto, зогсоолтгүй, үзэгчид таарсан) үед л —
 *   · echo-г `strict` бодлогоор ангилна (тодорхойгүй echo = ажилтан → бот чимээгүй);
 *   · агентын буцаасан `send` саналыг outbound.js `sendGuarded`-аар илгээнэ (илгээх ЦОР ГАНЦ зам; бүх хамгаалалт тэнд);
 *   · ажилтанд шилжүүлсэн (handoff, зураг) бол яриаг `human` болгоно — бот 12 цаг (ажилтан хариулбал түүнээс хойш) чимээгүй.
 * Бусад бүх ярианд сүүдэр хэвээр: ноорог л, юу ч илгээхгүй. `recipient` (PSID) зөвхөн webhook-оос санах ойгоор ирнэ —
 * хадгалахгүй, логлохгүй; cron / гацсан event-ийн нөхөлтөд байхгүй тул тэнд хэзээ ч илгээхгүй.
 */
import { FirestoreError } from './firestore.js';
import { describeError } from './errors.js';
import { ubDay } from './store.js';
import { AUTOMATION_TEMPLATE_MIN_CONVERSATIONS, echoFingerprint, planBatch } from './social/conversation-logic.js';
import { isLive } from './social/settings-logic.js';

export const ROUNDS_MAX = 6;
/** Claude-ийг дуудахад шаардлагатай үлдэгдэл хугацаа (Claude timeout 25 с + Firestore) */
export const AGENT_MIN_MS = 30_000;
/** Амьд ярианд (Claude-ийн дараа илгээлт: Graph ≤ 8 с + хэд хэдэн Firestore бичилт) илүү нөөц — функц 60 с-т багтана */
export const AGENT_MIN_LIVE_MS = 35_000;
export const LOCK_POLL_MS = 2000;
export const LOCK_POLLS = 3;
/** Хүлээн авагчтай (webhook-ийн) боловсруулалт түгжээг удаан хүлээнэ — хариуг зөвхөн энэ хүсэлт л илгээж чадна */
export const LOCK_POLLS_RECIPIENT = 10;
/** Түгжээ тайлах бичилтийн оролдлого (ярианы төлөв — «ажилтанд шилжүүлсэн» — алдагдахгүй байх) */
export const RELEASE_ATTEMPTS = 3;
export const THREAD_DAILY_AGENT_MAX = 40;
/** Webhook-ийн waitUntil-ийн төсөв (maxDuration 60 с) */
export const WEBHOOK_BUDGET_MS = 50_000;

/** Алдааны код (мессежийн агуулга, текстийг логлохгүй) */
function errorCode(e) {
  if (e instanceof FirestoreError) return `firestore_${e.status || e.httpStatus}`;
  return String((e && e.message) || 'error').split(/[:\s]/)[0].slice(0, 60) || 'error';
}
const asDate = (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v : null);

/**
 * @param {{ store: ReturnType<import('./store.js').createStore>, agent: ReturnType<import('./agent.js').createAgent>,
 *   outbound?: ReturnType<import('./outbound.js').createOutbound> | null,
 *   ownAppId: string|null, now?: () => Date, log?: (m: string) => void, sleep?: (ms: number) => Promise<void>,
 *   clock?: () => number }} deps   clock — хугацааны төсөвт (тест тарьна); outbound байхгүй = хэзээ ч илгээхгүй (сүүдэр)
 */
export function createPipeline(deps) {
  const { store, agent } = deps;
  const outbound = deps.outbound ?? null;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m) => console.warn(m));
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const clock = deps.clock ?? Date.now;

  /**
   * Амьд ярианд агентын үр дүнг хүргэнэ: `send` санал → sendGuarded; ажилтанд шилжүүлсэн бол яриаг хүнд.
   * Буцаах = thread-д бичих талбар (түгжээ тайлахад). Алдаа гарсан ч event аль хэдийн дууссан — дахин оролдохгүй.
   */
  async function deliver({ psidHash, recipient, r, plan, nextThread, events, actions }) {
    const fields = {};
    if (r.send) {
      const replyTo = events.find((e) => e.id === plan.action.replyToEventId);
      let res;
      try {
        res = await outbound.sendGuarded({
          psidHash, recipient, eventId: plan.action.replyToEventId, draftId: r.draftId, kind: r.send.kind, text: r.send.text,
          quickReplies: r.send.quickReplies, thread: nextThread, standby: plan.action.standby === true, answeredAt: replyTo?.eventTime ?? null,
        });
      } catch (e) {
        log(`[messenger] илгээх замын алдаа: ${describeError(e)}`);
        res = { sent: false, reason: 'error', threadFields: {} };
      }
      actions.push(res.sent ? `sent_${r.send.kind}` : `nosend_${res.reason}`);
      Object.assign(fields, res.threadFields);
    }
    // Ажилтанд шилжүүлсэн (эрсдэлтэй сэдэв, зураг, таг, AI татгалзсан/алдаа): мэдэгдэл хүрсэн эсэхээс үл хамааран бот энэ
    // ярианд чимээгүй болно — ажилтан хариулах хүртэл (эсвэл 12 цаг). Зөвхөн стикер (quiet) бол шилжүүлэхгүй.
    if (r.route === 'handoff' && !r.quiet) Object.assign(fields, { state: 'human', humanSince: now(), lastBotSentAt: null });
    return fields;
  }

  /** Амьд ярианд AI хариулж чадаагүй (алдаа, хязгаар): LLM-гүй «ажилтанд дамжууллаа» ноорог → хүргэнэ → яриа хүнд */
  async function fallback({ psidHash, recipient, plan, nextThread, events, actions, reason, eventStatus, batchText }) {
    const r = await agent.fallbackDraft({ psidHash, replyToEventId: plan.action.replyToEventId, eventStatus, thread: nextThread, live: true, reason, batchText });
    actions.push(`fallback_${reason}`);
    return deliver({ psidHash, recipient, r, plan, nextThread, events, actions });
  }

  /**
   * Нэг тойрог. Буцаах: { release } — түгжээ тайлахад thread-д бичих нэмэлт талбар; { stop } — энэ удаад зогсох.
   */
  async function handle(psidHash, thread, events, actions, deadline, recipient, round) {
    const settings = await store.readSettings();
    // Яаралтай зогсоолт (горим унтраагаагүй): webhook зөвхөн пэйжийн echo / handover-ыг (текстгүй) хадгалдаг — төлвийг л
    // шинэчилнэ (ажилтан хариулсан эсэх), ямар ч үйлдэл хийхгүй. Дахин асаахад бот ажилтны яриа руу орж ирэхгүй (аудит).
    const paused = !settings.active && settings.mode !== 'off';
    const mode = settings.active || paused ? settings.mode : 'off';
    // Амьд яриа: бот шууд хариулж болно (эцсийн шалгалтыг sendGuarded илгээхийн өмнө дахин хийнэ). liveIfOn — зогсоолтыг
    // үл тооцвол амьд (зогсоолтын үед ч echo-г strict-ээр ангилна)
    const liveIfOn = Boolean(outbound) && mode !== 'off' && isLive({ ...settings, killSwitch: false }, psidHash);
    const live = settings.active && liveIfOn;
    // Давтагдсан текстийн бүртгэл (Meta-ийн загвар) — зөвхөн сүүдэр ярианд, манай ботын өөрийн echo-г оруулахгүй (ботын нэг
    // өгүүлбэр 3 ярианд явсны дараа ажилтны ижил өгүүлбэр «автомат» болдог байв — аудит)
    const fps = liveIfOn ? [] : events.filter((e) => e.kind === 'echo' && !(deps.ownAppId && e.payload.app_id === deps.ownAppId)).map((e) => echoFingerprint(e.payload.text));
    const automationHashes = mode === 'off' || !fps.length ? new Set() : await store.automationHashes(psidHash, fps, AUTOMATION_TEMPLATE_MIN_CONVERSATIONS);
    const conv = {
      state: thread.state === 'human' || thread.state === 'paused' ? thread.state : 'bot',
      humanSince: asDate(thread.humanSince),
      lastStaffAt: asDate(thread.lastStaffAt),
      lastUserAt: asDate(thread.lastUserAt),
    };
    // Өмнөх оролдлогоор аль хэдийн хадгалсан echo (дахин боловсруулалт) — ангиллыг нь хэвээр ашиглана (+1 read/echo; echo цөөн)
    const echoIds = mode === 'off' ? [] : events.filter((e) => e.kind === 'echo').map((e) => e.id);
    const knownEchoes = echoIds.length ? await store.readEchoMessages(psidHash, echoIds) : new Map();
    const plan = planBatch(conv, events, { mode, ownAppId: deps.ownAppId, now: now(), automationHashes, knownEchoes, echoPolicy: liveIfOn ? 'strict' : 'shadow', stateOnly: paused });
    await store.saveBatch(psidHash, plan, thread);
    const nextThread = { ...thread, ...plan.conversation };
    // Ажилтан оролцож байгаа ярианд ботын «сүүлд илгээсэн» мөчийг арилгана — бот буцаж ирэхдээ дахин танилцуулна
    const base = plan.conversation.state !== 'bot' && thread.lastBotSentAt ? { lastBotSentAt: null } : {};
    // Энэ багцын хэрэглэгчийн мессежүүд — эрсдэлийн дохионы оролтод заавал орно (дараалал алдагдсан ч)
    const batchText = plan.messages.filter((m) => m.role === 'user' && m.text).map((m) => m.text);
    const ctx = { psidHash, recipient, plan, nextThread, events, actions, batchText };

    if (plan.action.type === 'agent') {
      const today = ubDay(now());
      const count = thread.agentDay === today ? Number(thread.agentDayCount) || 0 : 0;
      const minMs = live ? AGENT_MIN_LIVE_MS : AGENT_MIN_MS;
      if (count >= THREAD_DAILY_AGENT_MAX) {
        actions.push('thread_cap');
        // Амьд ярианд чимээгүй орхихгүй: «ажилтанд дамжууллаа» + хүнд (сүүдэрт хуучнаар — event-ийг л дуусгана)
        if (live) return { release: { ...base, ...(await fallback({ ...ctx, reason: 'thread_cap', eventStatus: plan.eventStatus })) } };
        await store.finishEvents(plan.eventStatus);
        return { release: { ...base } };
      }
      if (clock() > deadline - minMs) {
        // Хугацаа хүрэлцэхгүй — event pending үлдэнэ (мессеж, төлөв бичигдсэн; дахин боловсруулахад давхардахгүй)
        actions.push('deadline');
        return { release: { ...base }, stop: true };
      }
      const r = await agent.replyDraft({ psidHash, replyToEventId: plan.action.replyToEventId, thread: nextThread, eventStatus: plan.eventStatus, live, batchText });
      actions.push(r.route || r.skipped || r.error || 'agent');
      const counted = { ...base, agentDay: today, agentDayCount: count + 1 };
      if (r.retry) {
        // Түр зуурын Claude алдаа. Амьд ярианд хариуг ЗӨВХӨН энэ хүсэлт (хүлээн авагчтай) илгээж чадна: хугацаа байвал нэг
        // удаа шууд дахин оролдоно; үгүй бол «ажилтанд дамжууллаа» (үйлчлүүлэгч чимээгүй орхигдохгүй — аудит). Сүүдэрт
        // хуучнаар: event pending үлдэж дараа нөхөгдөнө.
        if (live) {
          const again = Boolean(recipient) && round.retries < 1 && clock() < deadline - AGENT_MIN_LIVE_MS;
          if (!again) return { release: { ...counted, ...(await fallback({ ...ctx, reason: 'ai_error', eventStatus: plan.eventStatus })) } };
          round.retries++;
          await store.failEvents(events, r.error);
          return { release: counted };
        }
        await store.failEvents(events, r.error);
        return { release: counted, stop: true };
      }
      if (!r.finalized) await store.finishEvents(plan.eventStatus);
      const release = r.skipped ? { ...base } : counted;
      // Амьд ярианд Claude засагдахгүй алдаа өгсөн (ноорог бичигдээгүй) → «ажилтанд дамжууллаа»
      if (live && r.error) Object.assign(release, await fallback({ ...ctx, reason: 'ai_error', eventStatus: undefined }));
      else if (live) Object.assign(release, await deliver({ ...ctx, r }));
      else if (r.simulatedBot) release.lastShadowBotAt = now();
      return { release };
    }
    if (plan.action.type === 'media_template') {
      const r = await agent.mediaDraft({ psidHash, replyToEventId: plan.action.replyToEventId, eventStatus: plan.eventStatus, thread: nextThread, live, stickerOnly: plan.action.stickerOnly === true });
      actions.push('media');
      const release = { ...base };
      if (live) Object.assign(release, await deliver({ ...ctx, r }));
      return { release };
    }
    await store.finishEvents(plan.eventStatus);
    actions.push(plan.action.reason);
    return { release: { ...base } };
  }

  /**
   * Түгжээг тайлж, ярианы төлвийг (ажилтанд шилжүүлсэн, сүүлд илгээсэн мөч, өдрийн тоо) бичнэ. Бичилт унавал хэд дахин
   * оролдоно — эс бөгөөс «ажилтанд шилжүүлсэн» төлөв алдагдаж бот дараагийн мессежид дахин хариулна (аудит).
   */
  async function release_(psidHash, fields) {
    for (let i = 1; i <= RELEASE_ATTEMPTS; i++) {
      try {
        await store.releaseThread(psidHash, fields);
        return;
      } catch {
        if (i === RELEASE_ATTEMPTS) log('[messenger] түгжээ тайлж чадсангүй (120 с-ийн дараа өөрөө тайлагдана)');
      }
    }
  }

  /** Түгжээ — авч чадаагүй бол (өөр инстанс ажиллаж байна) хугацаа хүрэлцвэл хэд хүлээж дахин оролдоно */
  async function acquire(psidHash, deadline, polls = LOCK_POLLS) {
    let lock = await store.lockThread(psidHash);
    for (let i = 0; !lock.ok && i < polls && clock() + LOCK_POLL_MS < deadline - AGENT_MIN_MS; i++) {
      await sleep(LOCK_POLL_MS);
      lock = await store.lockThread(psidHash);
    }
    return lock;
  }

  /**
   * @param {string} psidHash
   * @param {{ deadline?: number, recipient?: string|null }} [opt]  deadline = clock()-ийн дээд хязгаар (мс); recipient = энэ
   *   ярианы PSID (ЗӨВХӨН webhook-оос, санах ойд — хадгалахгүй, логлохгүй; байхгүй бол илгээхгүй)
   * @returns {Promise<{ rounds: number, locked?: boolean, actions: string[] }>}
   */
  async function processThread(psidHash, opt = {}) {
    const deadline = opt.deadline ?? clock() + WEBHOOK_BUDGET_MS;
    const actions = [];
    const recipient = opt.recipient ?? null;
    /** Энэ дуудлагын дотор хийсэн шууд дахин оролдлого (Claude-ийн түр алдаа, боловсруулалтын алдаа) — тус бүр ≤ 1 */
    const state = { retries: 0, errors: 0 };
    for (let round = 0; round < ROUNDS_MAX; round++) {
      const lock = await acquire(psidHash, deadline, recipient ? LOCK_POLLS_RECIPIENT : LOCK_POLLS);
      if (!lock.ok) return { rounds: round, locked: true, actions };
      const thread = lock.thread || {};
      let release = {};
      let events = [];
      let stop = null;
      try {
        events = await store.pendingEvents(psidHash);
        if (!events.length) stop = { rounds: round, actions };
        else {
          const r = await handle(psidHash, thread, events, actions, deadline, recipient, state);
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
        actions.push('error');
        // Хүлээн авагчтай (webhook) боловсруулалт: түр зуурын алдаа (Firestore) бол хугацаа байвал НЭГ удаа дахин оролдоно —
        // хариуг зөвхөн энэ хүсэлт илгээж чадна. Давхар илгээлтээс messenger_outbound-ийн эзэмшилт хамгаална.
        if (recipient && state.errors < 1 && clock() < deadline - AGENT_MIN_LIVE_MS) state.errors++;
        else stop = { rounds: round + 1, actions };
      } finally {
        await release_(psidHash, release);
      }
      if (stop) return stop;
      if (clock() > deadline - 5000) return { rounds: round + 1, actions: [...actions, 'deadline'] };
    }
    return { rounds: ROUNDS_MAX, actions };
  }

  /**
   * Гацсан (retryAt өнгөрсөн) event-тэй яриануудыг боловсруулна.
   * @param {{ maxThreads?: number, deadline?: number, recipients?: ReadonlyMap<string, string> }} [opt]
   *   recipients — ЭНЭ webhook-ийн яриануудын PSID (psidHash → PSID): гацсан яриа нь энэ webhook-ийн өөрийнх нь байвал
   *   (түгжээ завгүй байсан) хариуг илгээж чадна. Бусад яриа, cron — хүлээн авагчгүй (илгээхгүй).
   */
  async function sweepStale(opt = {}) {
    const max = opt.maxThreads ?? 2;
    const deadline = opt.deadline ?? clock() + WEBHOOK_BUDGET_MS;
    const threads = await store.staleThreads(Math.max(max * 5, 10));
    let done = 0;
    for (const h of threads.slice(0, max)) {
      if (clock() > deadline - AGENT_MIN_MS) break;
      const recipient = opt.recipients?.get(h) ?? null;
      if (recipient) await processThread(h, { deadline, recipient });
      else await processThread(h, { deadline });
      done++;
    }
    return done;
  }

  return { processThread, sweepStale };
}

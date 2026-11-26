/**
 * Messenger AI — үйлчлүүлэгч рүү ИЛГЭЭХ ЦОР ГАНЦ ЗАМ: `sendGuarded()`.
 *
 * Архитектурын дүрэм (tools/test/messenger-architecture.test.mjs):
 *   · Meta-ийн Send API-г зөвхөн social/meta-send.js дуудна; meta-send.js-ийг ЗӨВХӨН энэ файл импортолно.
 *   · Энэ файлыг ЗӨВХӨН runtime.js (холболт) импортолж, ЗӨВХӨН pipeline-д өгнө; `sendGuarded`-ийг ЗӨВХӨН pipeline.js
 *     (webhook-ийн боловсруулалт) дуудна. Агент (agent.js), admin-ийн туршилт/eval (admin-api.js), cron хэзээ ч илгээхгүй.
 *
 * Илгээх нөхцөл — БҮГД биелсэн үед л (аль нэг нь үгүй = илгээхгүй, шалтгааны кодтой; fail-closed):
 *   1. `recipient` (PSID) байгаа — зөвхөн webhook-ийн санах ойгоос; хаана ч хадгалагдахгүй, логлогдохгүй. Cron / гацсан
 *      event-ийн дахин оролдлогод байхгүй → илгээхгүй (хоцорсон хариу явуулснаас ажилтан хариулсан нь дээр).
 *   2. Серверт пэйжийн token ба аппын id тохируулсан (app id-гүй бол өөрийн echo-г «ажилтан» гэж андуурна).
 *   3. Тохиргоог ИЛГЭЭХИЙН ӨМНӨ ДАХИН уншина: горим «Автомат», яаралтай зогсоолт унтраалттай, үзэгчид таарсан
 *      (`isLive`: бүгд, эсвэл туршилтын акаунт) — Claude бодож байх хооронд эзэмшигч зогсоосон бол явахгүй.
 *   4. Яриаг манай апп эзэмшиж байгаа (standby биш), ярианы төлөв `bot` (ажилтан хариулж байвал чимээгүй).
 *   5. Хэрэглэгчийн сүүлийн мессежээс ≤ 23.5 цаг (Meta-ийн 24 цагийн цонх; `messaging_type: RESPONSE`).
 *   5а. Хариулж буй мессеж ШИНЭ: ≤ MAX_REPLY_AGE_MS (Meta хуучин webhook-ийг хэдэн цагийн дараа дахин хүргэж болно), мөн
 *      ботын өмнө нь хариулсан мессежээс ХОЙШ бичигдсэн (дараалал алдагдаж ирсэн хуучин мессежид хариулахгүй) — үгүй бол 'stale'.
 *   5б. ИЛГЭЭХИЙН ӨМНӨ ярианы хүлээгдэж буй event-ийг дахин шалгана: Claude бодож байх хооронд ажилтан Page Inbox-оос
 *      хариулсан (echo түгжээ хүлээгээд pending үлдсэн), эсвэл яриаг өөр апп авсан бол → 'human_active' (ажилтны дээгүүр
 *      хариулахгүй). Meta-ийн автомат хариу (≤ 8 с), манай ботын өөрийн echo саад биш.
 *   6. Таг: ярианд УБ өдөрт ≤ THREAD_DAILY_SEND_MAX; нийт өдөрт ≤ DAILY_SEND_MAX (гогцоо, халдлагын таслуур).
 *   7. Текст хоосон биш, ≤ 2000, `{хувьсагч}`-гүй; төрөл reply | handoff | media.
 *   8. Энэ event-д өмнө илгээгээгүй: `messenger_outbound/o_<event>`-ийг exists=false-оор эзэмшинэ (давтан webhook, retry,
 *      зэрэг инстанс → 'duplicate'). Эзэмшсэний дараа функц тасарвал ДАХИН ИЛГЭЭХГҮЙ — хамгийн ихдээ нэг удаа.
 * Graph-ийн алдаа (token, цонх, thread эзэмшил, хязгаар, сүлжээ) = failed, дахин оролдохгүй. `thread_owned` → яриаг хүнд.
 *
 * Ярианы төлөв (`threadFields`: сүүлд илгээсэн мөч, өдрийн тоо, хамгийн сүүлд хариулсан мессежийн мөч; ажилтанд шилжүүлсэн
 * мэдэгдэл бол `human`) үр дүнгийн commit-д thread-д бичигдэнэ (store.finishOutbound — pipeline-ий түгжээ тайлах бичилт
 * унасан ч алдагдахгүй) ба pipeline-д буцна. Амжилттай илгээсэн мессежийг thread-д ботын мөрөөр шууд бичнэ — echo-г хүлээхгүй.
 */
import { redactForLlm } from './guardrails.js';
import { describeError } from './errors.js';
import { eventDocId, ubDay } from './store.js';
import { classifyEchoWhy, echoFingerprint } from './social/conversation-logic.js';
import { MetaApiError } from './social/meta-client.js';
import { metaConfig } from './social/meta-config.js';
import { createMetaSender } from './social/meta-send.js';
import { isLive, isThreadId } from './social/settings-logic.js';

/** Meta-ийн 24 цагийн цонхноос 30 минутын нөөцтэй */
export const SEND_WINDOW_MS = 23.5 * 3600_000;
/** Нэг ярианд УБ өдөрт илгээх дээд тоо */
export const THREAD_DAILY_SEND_MAX = 20;
/** Нийт өдөрт илгээх оролдлогын дээд тоо (таслуур) */
export const DAILY_SEND_MAX = 500;
export const SEND_KINDS = Object.freeze(['reply', 'handoff', 'media']);
export const SEND_TEXT_MAX = 2000;
/** Хариулж буй хэрэглэгчийн мессеж үүнээс хуучин бол илгээхгүй (хожимдсон хариу төөрөгдүүлнэ — ажилтан хариулна) */
export const MAX_REPLY_AGE_MS = 15 * 60_000;
/** Үр дүнгийн бүртгэлийг бичих оролдлогын тоо (мессеж аль хэдийн явсан — бүртгэл, ярианы төлөв алдагдахгүй байх) */
export const FINISH_ATTEMPTS = 3;
/** Ажилтанд шилжүүлсэн мэдэгдэл (handoff, зураг) — илгээсний дараа яриа хүнд */
const HUMAN_KINDS = new Set(['handoff', 'media']);

const PSID_RE = /^[0-9]{5,30}$/;
const PLACEHOLDER_RE = /\{[^{}\s]{1,30}\}/u;
const asDate = (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v : null);

/**
 * @param {{ store: ReturnType<import('./store.js').createStore>, env?: Record<string, string|undefined>,
 *   send?: (input: { recipientId: string, text: string, quickReplies?: { title: string, payload: string }[] }) => Promise<{ mid: string|null }>,
 *   now?: () => Date, log?: (m: string) => void }} deps   send — тест тарина; анхдагч = META_PAGE_TOKEN-оор meta-send.js
 */
export function createOutbound(deps) {
  const { store } = deps;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m) => console.warn(m));
  let sender = null;
  const send = deps.send ?? ((input) => {
    sender ??= createMetaSender({ pageToken: metaConfig(env).pageToken });
    return sender.send(input);
  });

  /**
   * Ярианд хүлээгдэж буй (pending) event дотор АЖИЛТНЫ хариу эсвэл яриаг өөр апп авсан (take_thread_control) байгаа эсэх.
   * Энэ багцын event-үүд ноорогтой хамт аль хэдийн `done` болсон тул pending = багц уншигдсанаас ХОЙШ ирсэн event.
   * Манай апп-ын echo, урьдчилан бичсэн ботын мөртэй (own) echo, Meta-ийн автомат хариу (хэрэглэгчээс ≤ 8 с) = ажилтан биш.
   */
  async function staffStepped(psidHash, ownAppId, lastUserAt) {
    const pending = await store.pendingEvents(psidHash);
    if (pending.some((e) => e.kind === 'handover' && e.payload.handover === 'take')) return true;
    const echoes = pending.filter((e) => e.kind === 'echo' && e.payload.app_id !== ownAppId);
    if (!echoes.length) return false;
    const known = await store.readEchoMessages(psidHash, echoes.map((e) => e.id));
    return echoes.some((e) => known.get(e.id)?.role !== 'bot'
      && classifyEchoWhy(e, { ownAppId, lastUserAt, userWrote: true, policy: 'strict' }).source === 'staff');
  }

  /**
   * @param {{ psidHash: string, recipient?: string|null, eventId: string, draftId: string, kind: string, text: string,
   *   quickReplies?: { title: string, payload: string }[], thread?: Record<string, any>|null, standby?: boolean,
   *   answeredAt?: Date|null }} input
   *   thread — planBatch-ийн дараах төлөв (state, lastUserAt, sendDay, sendDayCount); answeredAt — хариулж буй хэрэглэгчийн
   *   мессежийн мөч (ботын мөрийн логик байрлал)
   * @returns {Promise<{ sent: true, threadFields: Record<string, any> }
   *   | { sent: false, reason: string, threadFields: Record<string, any> }>}
   */
  async function sendGuarded(input) {
    const { psidHash, draftId, eventId, kind } = input;
    const t = now();
    const skip = async (reason) => {
      // Шалтгааныг ноорогт тэмдэглэнэ (ажилтан «яагаад илгээгээгүй»-г харна) — бичиж чадаагүй ч илгээхгүй хэвээр
      if (draftId) await store.markSendSkipped({ draftId, reason }).catch(() => log(`[messenger] илгээгээгүй шалтгааныг тэмдэглэж чадсангүй: ${reason}`));
      return { sent: /** @type {const} */ (false), reason, threadFields: {} };
    };
    try {
      const recipient = typeof input.recipient === 'string' ? input.recipient : '';
      if (!PSID_RE.test(recipient)) return await skip('no_recipient');
      const cfg = metaConfig(env);
      if (!deps.send && !cfg.pageToken) return await skip('not_configured');
      if (!cfg.appId || !cfg.pageId) return await skip('not_configured');

      const settings = await store.readSettings();
      if (settings.mode !== 'auto') return await skip('mode');
      if (settings.killSwitch !== false) return await skip('kill_switch');
      if (!isThreadId(psidHash) || !isLive(settings, psidHash)) return await skip('audience');

      if (input.standby === true) return await skip('standby');
      const thread = input.thread && typeof input.thread === 'object' ? input.thread : {};
      if (thread.state !== 'bot') return await skip('human_active');
      const lastUserAt = asDate(thread.lastUserAt);
      const age = lastUserAt ? t.getTime() - lastUserAt.getTime() : Infinity;
      if (!(age >= -5 * 60_000 && age < SEND_WINDOW_MS)) return await skip('window');

      // Хариулж буй мессеж шинэ эсэх: хуучин (дахин хүргэсэн webhook), эсвэл ботын аль хэдийн хариулснаас ӨМНӨХ мессеж биш
      const answeredAt = asDate(input.answeredAt) ?? lastUserAt;
      const answeredAge = t.getTime() - answeredAt.getTime();
      const lastAnsweredAt = asDate(thread.lastAnsweredAt);
      if (answeredAge > MAX_REPLY_AGE_MS || (lastAnsweredAt && answeredAt.getTime() < lastAnsweredAt.getTime())) return await skip('stale');

      const today = ubDay(t);
      const threadCount = thread.sendDay === today ? Number(thread.sendDayCount) || 0 : 0;
      if (threadCount >= THREAD_DAILY_SEND_MAX) return await skip('thread_cap');

      const text = typeof input.text === 'string' ? input.text.trim() : '';
      if (!SEND_KINDS.includes(kind) || !text || text.length > SEND_TEXT_MAX || PLACEHOLDER_RE.test(text)) return await skip('invalid_text');

      // Claude бодож байх хооронд ажилтан хариулсан / яриаг өөр апп авсан эсэх (тэдний event түгжээ хүлээгээд pending үлдсэн)
      if (await staffStepped(psidHash, cfg.appId, lastUserAt)) return await skip('human_active');

      if ((await store.readDaySendClaims(t)) >= DAILY_SEND_MAX) return await skip('day_cap');

      const claim = await store.claimOutbound({ eventId, psidHash, draftId, kind, text });
      // Аль хэдийн эзэмшсэн — өмнөх оролдлогын төлөвийг (sent / sending) ДАРАХГҮЙ: ноорогт юу ч бичихгүй
      if (!claim.ok) return { sent: false, reason: 'duplicate', threadFields: {} };

      let mid = null;
      /** @type {{ kind: string, code?: number|null, subcode?: number|null } | null} */
      let error = null;
      try {
        ({ mid } = await send({ recipientId: recipient, text, quickReplies: input.quickReplies ?? [] }));
      } catch (e) {
        error = e instanceof MetaApiError ? { kind: e.kind, code: e.code, subcode: e.subcode } : { kind: 'error' };
        log(`[messenger] илгээлт амжилтгүй: ${error.kind}${error.code ? ` (${error.code}${error.subcode ? `/${error.subcode}` : ''})` : ''}`);
      }
      const ok = !error;
      // Meta-ийн mid-г хадгалахгүй — зөвхөн ботын мөрийн id (hash; echo-гийн event id-тай ижил)
      const botMessage = ok && mid
        ? { id: eventDocId(cfg.pageId, mid), text: redactForLlm(text).slice(0, SEND_TEXT_MAX), textHash: echoFingerprint(redactForLlm(text)), at: new Date(answeredAt.getTime() + 1) }
        : null;
      /** Ярианы төлөв: амжилттай → тоолуур, хариулсан мөч (+ ажилтанд шилжүүлсэн мэдэгдэл бол хүнд); thread_owned → хүнд */
      const threadFields = ok
        ? { lastBotSentAt: t, sendDay: today, sendDayCount: threadCount + 1, lastAnsweredAt: answeredAt, ...(HUMAN_KINDS.has(kind) ? { state: 'human', humanSince: t, lastBotSentAt: null } : {}) }
        : error.kind === 'thread_owned' ? { state: 'human', humanSince: t } : {};
      for (let i = 1; i <= FINISH_ATTEMPTS; i++) {
        try {
          await store.finishOutbound({ id: claim.id, draftId, psidHash, kind, ok, error, botMessage, threadFields });
          break;
        } catch (e) {
          // Мессеж аль хэдийн явсан (эсвэл Meta татгалзсан) — бүртгэл бичигдэхгүй бол `sending` үлдэнэ; ДАХИН ИЛГЭЭХГҮЙ
          log(`[messenger] илгээлтийн бүртгэл бичигдсэнгүй (${i}/${FINISH_ATTEMPTS}): ${describeError(e)}`);
        }
      }
      if (ok) return { sent: true, threadFields };
      // thread_owned: яриаг өөр апп (Page Inbox) эзэмшиж байна — ажилтан хариулж байгаа гэж үзнэ
      return { sent: false, reason: error.kind, threadFields };
    } catch (e) {
      // Firestore-ийн алдаа г.м. — илгээсэн эсэх тодорхойгүй үед ч дахин оролдохгүй (event аль хэдийн дууссан)
      log(`[messenger] илгээх замын алдаа: ${describeError(e)}`);
      return { sent: false, reason: 'error', threadFields: {} };
    }
  }

  return { sendGuarded };
}

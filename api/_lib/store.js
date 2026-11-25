/**
 * Messenger AI — Firestore-ийн домэйн давхарга (сервер). Бүх query composite index ШААРДАХГҮЙ:
 *   · гацсан event: `retryAt <= now` (нэг талбар, orderBy мөн тэр талбар)
 *   · ярианы pending event: `psidHash == X && status == 'pending'` (зөвхөн equality — single-field index-ийг нэгтгэнэ)
 *   · хадгалах хугацаа: `expireAt <= now`; ярианы мессеж: thread.oldestExpireAt → дэд collection-ий query
 *
 * Хувийн мэдээлэл: PSID хаана ч хадгалагдахгүй (зөвхөн psidHash = doc id). Текст ЗӨВХӨН нууцалсан (meta-events.js).
 * Захиалгын (`bookings`) collection-д энэ код ХЭЗЭЭ Ч хүрэхгүй (tools/test/messenger-architecture.test.mjs).
 */
import { createHash, randomUUID } from 'node:crypto';
import { deleteWrite, FirestoreError, setWrite, transforms } from './firestore.js';
import { normalizeSettings } from './social/settings-logic.js';

export const COL = Object.freeze({
  settings: 'messenger_settings',
  threads: 'messenger_threads',
  messages: 'messages',
  drafts: 'messenger_drafts',
  events: 'messenger_events',
  runs: 'ai_runs',
  usage: 'messenger_usage',
  status: 'messenger_status',
  echo: 'messenger_echo_templates',
  audit: 'messenger_audit',
});

/** Хадгалах хугацаа (хоног) — README «Messenger AI»-тай ижил */
export const RETENTION_DAYS = Object.freeze({ events: 30, messages: 180, drafts: 180, runs: 400, echo: 90 });
/** Шинэ event-ийг энэ хугацааны дотор боловсруулаагүй бол «гацсан» гэж үзэж дараагийн webhook/cron нөхнө */
export const RETRY_AFTER_MS = 2 * 60_000;
/** Ярианы түгжээ (нэг ярианы event-үүдийг нэг л инстанс дараалан боловсруулна) */
export const LOCK_MS = 120_000;
/** Нэг event-ийг ийм тооноос олон удаа оролдвол «failed» (мөнхийн давталтаас сэргийлнэ) */
export const MAX_ATTEMPTS = 3;
const DAY = 86_400_000;

export const eventDocId = (pageId, eventKey) => 'e_' + createHash('sha256').update(`${pageId}:${eventKey}`).digest('hex').slice(0, 40);
const newId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '')}`;
const asDate = (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v : null);

/** Улаанбаатарын цагаар сар («2026-11») — сарын тагийн түлхүүр */
export function ubMonth(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit' }).format(date).slice(0, 7);
}

/**
 * @param {ReturnType<import('./firestore.js').createFirestore>} fs
 * @param {{ now?: () => Date }} [opt]
 */
export function createStore(fs, opt = {}) {
  const now = opt.now ?? (() => new Date());
  const threadPath = (h) => `${COL.threads}/${h}`;

  return {
    fs,

    async readSettings() {
      const d = await fs.get(`${COL.settings}/main`);
      return normalizeSettings(d?.data);
    },

    /** settings/site + settings/catalog (сайтын нийтийн өгөгдөл) — knowledge.js */
    async readSiteDocs() {
      const m = await fs.batchGet(['settings/site', 'settings/catalog']);
      return { site: m.get('settings/site')?.data ?? null, catalog: m.get('settings/catalog')?.data ?? null };
    },

    /** messenger_status/main-ийн зарим талбарыг шинэчилнэ (merge) */
    async patchStatus(fields) {
      await fs.commit([setWrite(`${COL.status}/main`, fields, { mask: Object.keys(fields) })]);
    },

    /**
     * Webhook-ийн event-ийг давхардалгүй үүсгэнэ (exists=false precondition).
     * @returns {Promise<'created' | 'duplicate'>}
     */
    async createEvent(ev, psidHash) {
      const t = now();
      const id = eventDocId(ev.pageId, ev.eventKey);
      try {
        await fs.commit([
          setWrite(`${COL.events}/${id}`, {
            status: 'pending',
            kind: ev.kind,
            psidHash,
            eventTime: ev.eventTime,
            payload: ev.payload,
            receivedAt: t,
            retryAt: new Date(t.getTime() + RETRY_AFTER_MS),
            attempts: 0,
            expireAt: new Date(t.getTime() + RETENTION_DAYS.events * DAY),
          }, { exists: false }),
        ]);
        return 'created';
      } catch (e) {
        if (e instanceof FirestoreError && e.isPrecondition) return 'duplicate';
        throw e;
      }
    },

    /** Ярианы боловсруулаагүй event-үүд (цагийн дараалалгүй — planBatch эрэмбэлнэ) */
    async pendingEvents(psidHash) {
      const docs = await fs.query({ collection: COL.events, where: [['psidHash', '==', psidHash], ['status', '==', 'pending']], limit: 100 });
      return docs.map((d) => ({
        id: d.id,
        kind: d.data.kind,
        mid: null,
        eventTime: asDate(d.data.eventTime) ?? asDate(d.data.receivedAt) ?? now(),
        payload: d.data.payload && typeof d.data.payload === 'object' ? d.data.payload : {},
        attempts: Number(d.data.attempts) || 0,
      }));
    },

    /** retryAt өнгөрсөн (гацсан) event-тэй яриануудын psidHash (давхардалгүй) */
    async staleThreads(limit = 20) {
      const docs = await fs.query({ collection: COL.events, where: [['retryAt', '<=', now()]], orderBy: [['retryAt', 'asc']], limit });
      return [...new Set(docs.map((d) => d.data.psidHash).filter((h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)))];
    },

    /**
     * Ярианы түгжээ: thread-ийг уншаад lockUntil-ийг updateTime precondition-оор тавина (optimistic).
     * @returns {Promise<{ ok: false } | { ok: true, thread: Record<string, any> }>}
     */
    async lockThread(psidHash) {
      const t = now();
      const until = new Date(t.getTime() + LOCK_MS);
      const cur = await fs.get(threadPath(psidHash));
      try {
        if (!cur) {
          const data = { state: 'bot', humanSince: null, lastStaffAt: null, lastUserAt: null, lastShadowBotAt: null, referral: null, oldestExpireAt: null, lockUntil: until, createdAt: t, updatedAt: t, messageCount: 0 };
          await fs.commit([setWrite(threadPath(psidHash), data, { exists: false })]);
          return { ok: true, thread: data };
        }
        const lockUntil = asDate(cur.data.lockUntil);
        if (lockUntil && lockUntil > t) return { ok: false };
        await fs.commit([setWrite(threadPath(psidHash), { lockUntil: until }, { mask: ['lockUntil'], updateTime: cur.updateTime })]);
        return { ok: true, thread: cur.data };
      } catch (e) {
        if (e instanceof FirestoreError && e.isPrecondition) return { ok: false };
        throw e;
      }
    },

    async releaseThread(psidHash, fields = {}) {
      const data = { ...fields, lockUntil: null, updatedAt: now() };
      await fs.commit([setWrite(threadPath(psidHash), data, { mask: Object.keys(data) })]);
    },

    /** Echo-гийн хурууны хээ → ≥ min өөр ярианд гарсан эсэх (энэ ярианы оролцоог бүртгээд) */
    async automationHashes(psidHash, fps, min) {
      const uniq = [...new Set(fps.filter(Boolean))].slice(0, 50);
      if (!uniq.length) return new Set();
      const paths = uniq.map((fp) => `${COL.echo}/${fp}`);
      const docs = await fs.batchGet(paths);
      const t = now();
      const writes = [];
      const out = new Set();
      for (const fp of uniq) {
        const threads = Array.isArray(docs.get(`${COL.echo}/${fp}`)?.data?.threads) ? docs.get(`${COL.echo}/${fp}`).data.threads : [];
        const all = new Set([...threads, psidHash]);
        if (all.size >= min) out.add(fp);
        // Массивыг min-ээр хязгаарлана (Meta-ийн загвар бүх ярианд гарч болно — баримт томрохгүй)
        if (!threads.includes(psidHash) && threads.length < min) {
          writes.push(setWrite(`${COL.echo}/${fp}`, { lastSeenAt: t, expireAt: new Date(t.getTime() + RETENTION_DAYS.echo * DAY) }, {
            mask: ['lastSeenAt', 'expireAt'],
            transforms: [transforms.appendMissing('threads', [psidHash])],
          }));
        }
      }
      if (writes.length) await fs.commit(writes);
      return out;
    },

    /**
     * planBatch-ийн үр дүнг атомоор бичнэ: мессежүүд (нууцалсан), thread-ийн төлөв, event-ийн төлөв.
     * @param {string} psidHash
     * @param {{ messages: any[], conversation: any, eventStatus: Record<string, string> }} plan
     * @param {Record<string, any>} thread  lockThread-ийн уншсан утга
     */
    async saveBatch(psidHash, plan, thread) {
      const t = now();
      const exp = new Date(t.getTime() + RETENTION_DAYS.messages * DAY);
      const writes = [];
      for (const m of plan.messages) {
        writes.push(setWrite(`${threadPath(psidHash)}/${COL.messages}/${m.eventId}`, {
          role: m.role, kind: m.kind, text: m.text, attachments: m.attachments, textHash: m.textHash, sentAt: m.sentAt, expireAt: exp,
        }));
      }
      const c = plan.conversation;
      const th = {
        state: c.state,
        humanSince: c.humanSince,
        lastStaffAt: c.lastStaffAt,
        lastUserAt: c.lastUserAt,
        updatedAt: t,
        lastActivityAt: t,
      };
      if (c.referral) th.referral = { source: c.referral.source ?? null, ref: c.referral.ref ?? null, ad_id: c.referral.ad_id ?? null, at: c.referral.at };
      if (plan.messages.length && !asDate(thread?.oldestExpireAt)) th.oldestExpireAt = exp;
      writes.push(setWrite(threadPath(psidHash), th, {
        mask: Object.keys(th),
        transforms: plan.messages.length ? [transforms.increment('messageCount', plan.messages.length)] : [],
      }));
      for (const [id, status] of Object.entries(plan.eventStatus)) {
        writes.push(setWrite(`${COL.events}/${id}`, { status, retryAt: null, processedAt: t }, { mask: ['status', 'retryAt', 'processedAt'] }));
      }
      for (let i = 0; i < writes.length; i += 400) await fs.commit(writes.slice(i, i + 400));
    },

    /** Боловсруулж чадаагүй event: оролдлогыг тоолж, MAX_ATTEMPTS хүрвэл failed */
    async failEvents(events, code) {
      const t = now();
      const writes = events.map((e) => {
        const attempts = (Number(e.attempts) || 0) + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        return setWrite(`${COL.events}/${e.id}`, {
          status: failed ? 'failed' : 'pending',
          attempts,
          retryAt: failed ? null : new Date(t.getTime() + RETRY_AFTER_MS * attempts),
          error: String(code).slice(0, 60),
        }, { mask: ['status', 'attempts', 'retryAt', 'error'] });
      });
      if (writes.length) await fs.commit(writes);
    },

    /** Ярианы сүүлийн мөрүүд (цагийн дарааллаар) */
    async recentTurns(psidHash, limit = 10) {
      const docs = await fs.query({ parent: threadPath(psidHash), collection: COL.messages, orderBy: [['sentAt', 'desc']], limit });
      return docs.reverse().map((d) => ({
        role: d.data.role,
        text: typeof d.data.text === 'string' ? d.data.text : '',
        attachments: Array.isArray(d.data.attachments) ? d.data.attachments : [],
        sentAt: asDate(d.data.sentAt),
      }));
    },

    async readUsage(month) {
      const d = await fs.get(`${COL.usage}/${month}`);
      return { runs: Number(d?.data?.runs) || 0, costMicroUsd: Number(d?.data?.costMicroUsd) || 0 };
    },

    /** Ноорог + ажиллагааны бүртгэл + сарын тоологч — нэг commit */
    async saveDraft({ draft, run, month }) {
      const t = now();
      const draftId = newId('d');
      const writes = [];
      if (draft) {
        writes.push(setWrite(`${COL.drafts}/${draftId}`, {
          ...draft, rating: null, note: '', ratedAt: null, ratedBy: null, createdAt: t,
          expireAt: new Date(t.getTime() + RETENTION_DAYS.drafts * DAY),
        }, { exists: false }));
      }
      if (run) {
        writes.push(setWrite(`${COL.runs}/${newId('r')}`, {
          ...run, draftId: draft ? draftId : null, createdAt: t, expireAt: new Date(t.getTime() + RETENTION_DAYS.runs * DAY),
        }, { exists: false }));
        if (run.billable) {
          writes.push(setWrite(`${COL.usage}/${month}`, { month, updatedAt: t }, {
            mask: ['month', 'updatedAt'],
            transforms: [transforms.increment('runs', 1), transforms.increment('costMicroUsd', Math.max(0, Math.round(run.costMicroUsd || 0)))],
          }));
        }
      }
      if (writes.length) await fs.commit(writes);
      return draft ? draftId : null;
    },

    /** Хадгалах хугацаа дууссан баримтуудыг устгана (нэг collection, ≤ limit) */
    async purgeExpired(collection, limit = 200) {
      const docs = await fs.query({ collection, where: [['expireAt', '<=', now()]], orderBy: [['expireAt', 'asc']], limit });
      if (docs.length) await fs.commit(docs.map((d) => deleteWrite(d.path)));
      return docs.length;
    },

    /** Хуучирсан мессежтэй яриануудыг цэвэрлэнэ (collection group query-гүй) */
    async purgeThreadMessages(threadLimit = 20) {
      const t = now();
      const threads = await fs.query({ collection: COL.threads, where: [['oldestExpireAt', '<=', t]], orderBy: [['oldestExpireAt', 'asc']], limit: threadLimit });
      let deleted = 0;
      for (const th of threads) {
        const old = await fs.query({ parent: th.path, collection: COL.messages, where: [['expireAt', '<=', t]], orderBy: [['expireAt', 'asc']], limit: 300 });
        if (old.length) await fs.commit(old.map((d) => deleteWrite(d.path)));
        deleted += old.length;
        const next = await fs.query({ parent: th.path, collection: COL.messages, orderBy: [['expireAt', 'asc']], limit: 1 });
        await fs.commit([setWrite(th.path, { oldestExpireAt: next[0]?.data?.expireAt ?? null }, { mask: ['oldestExpireAt'], transforms: old.length ? [transforms.increment('messageCount', -old.length)] : [] })]);
      }
      return deleted;
    },
  };
}

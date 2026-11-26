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
  kb: 'messenger_kb',
  examples: 'messenger_examples',
  // «Автомат» горимд үйлчлүүлэгч рүү илгээсэн мессежийн бүртгэл (зөвхөн outbound.js sendGuarded бичнэ; id = o_<хариулсан event>)
  outbound: 'messenger_outbound',
});
/** messenger_kb-ийн тусгай баримт: `voice` = брэнд дуу хоолой; `_rev` = мэдлэг/жишээ өөрчлөгдсөн тэмдэг (admin нэг batch-д бичнэ) */
export const KB_IDS = Object.freeze({ voice: 'voice', rev: '_rev' });
/** Нэг ачаалалтын унших дээд тоо (Spark квот) ≈ prompt-д орох хязгаар + нөөц (catalog-safe.js 60, examples.js 30) */
export const KNOWLEDGE_READ_LIMIT = Object.freeze({ kb: 70, examples: 40, adminKb: 100 });
/** Admin-ийн «Туршилтын асуулт»: өдөрт (messenger_usage/<УБ өдөр>.tests) ба сард (сарын AI хязгаарын 20%, ≥ 100) */
export const ADMIN_TESTS_PER_DAY = 100;
export const adminTestsPerMonth = (settings) => Math.max(100, Math.floor((Number(settings?.monthlyRunCap) || 0) * 0.2));
/** Туршилтын сарын зардлын хязгаар (микро-доллар) = сарын зардлын хязгаарын 20% — үлдсэнийг Messenger-ийн ноорогт */
export const adminTestCostPerMonth = (settings) => Math.round((Number(settings?.monthlyCostCapUsd) || 0) * 1e6 * 0.2);
/** Өдрийн тоологчийн хадгалах хугацаа (хоног) — cron устгана */
const DAY_DOC_DAYS = 90;
/** Бодит Claude-тэй eval (admin «Eval»): өдөрт ≤ 3 ажиллагаа, нэг хэсэгт 6 кейс (зэрэг, ≤ 25 с), нэг ажиллагаа ≤ $5, түүх 10 */
export const EVAL_LIMITS = Object.freeze({ runsPerDay: 3, chunk: 6, maxMicroUsd: 5_000_000, history: 10 });
const evalRunPath = (id) => `${COL.status}/eval_${id}`;
const evalChunkPath = (id, from) => `${COL.status}/evalc_${id}_${String(from).padStart(4, '0')}`;
const EVAL_INDEX = `${COL.status}/evals`;
/** Функц тасарч үлдсэн хэсгийн түгжээг ийм хугацааны дараа дахин эзэмшиж болно (maxDuration 60 с + нөөц) */
export const EVAL_CLAIM_STALE_MS = 90_000;
const evalCost = (runs) => runs.reduce((n, r) => n + Math.max(0, Math.round(r?.costMicroUsd || 0)), 0);
/** Eval-ийн Claude дуудлагууд: ai_runs (текстгүй) + сарын тоо/зардал + admin-ий дэд хязгаар (testCostMicroUsd) */
function evalUsageWrites(runs, month, t) {
  const list = runs.filter(Boolean);
  const billable = list.filter((r) => r.billable);
  const cost = evalCost(list);
  const writes = list.map((r) => setWrite(`${COL.runs}/${newId('r')}`, { ...r, draftId: null, createdAt: t, expireAt: new Date(t.getTime() + RETENTION_DAYS.runs * DAY) }, { exists: false }));
  if (billable.length) {
    writes.push(setWrite(`${COL.usage}/${month}`, { month, updatedAt: t }, {
      mask: ['month', 'updatedAt'],
      transforms: [transforms.increment('runs', billable.length), transforms.increment('costMicroUsd', cost), transforms.increment('testCostMicroUsd', cost)],
    }));
  }
  return writes;
}

/** Хадгалах хугацаа (хоног) — README «Messenger AI»-тай ижил */
export const RETENTION_DAYS = Object.freeze({ events: 30, messages: 180, drafts: 180, runs: 400, echo: 90, outbound: 180 });
/** Шинэ event-ийг энэ хугацааны дотор боловсруулаагүй бол «гацсан» гэж үзэж дараагийн webhook/cron нөхнө */
export const RETRY_AFTER_MS = 2 * 60_000;
/** Ярианы түгжээ (нэг ярианы event-үүдийг нэг л инстанс дараалан боловсруулна) */
export const LOCK_MS = 120_000;
/** Нэг event-ийг ийм тооноос олон удаа оролдвол «failed» (мөнхийн давталтаас сэргийлнэ) */
export const MAX_ATTEMPTS = 3;
const DAY = 86_400_000;

export const eventDocId = (pageId, eventKey) => 'e_' + createHash('sha256').update(`${pageId}:${eventKey}`).digest('hex').slice(0, 40);
/** Илгээлтийн бүртгэлийн id — хариулсан event-ээс тогтмол: нэг хэрэглэгчийн мессежид хамгийн ихдээ НЭГ илгээлт */
export const outboundDocId = (eventId) => `o_${String(eventId ?? '').replace(/^e_/, '')}`;
const EVENT_ID_RE = /^e_[0-9a-f]{40}$/;
const DRAFT_ID_RE = /^d_[0-9a-f]{32,40}$/;
const newId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '')}`;
const asDate = (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v : null);

/** Улаанбаатарын цагаар сар («2026-11») — сарын тагийн түлхүүр */
export function ubMonth(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit' }).format(date).slice(0, 7);
}

/** Улаанбаатарын цагаар өдөр («2026-11-25») — өдрийн тоологчийн түлхүүр (messenger_usage/<өдөр>) */
export function ubDay(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Өдрийн нэгтгэлийн талбарын нэр (давхар map-ийн түлхүүр) — зөвхөн [a-z0-9_] */
const statKey = (v) => String(v ?? 'unknown').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'unknown';

/**
 * @param {ReturnType<import('./firestore.js').createFirestore>} fs
 * @param {{ now?: () => Date }} [opt]
 */
export function createStore(fs, opt = {}) {
  const now = opt.now ?? (() => new Date());
  const threadPath = (h) => `${COL.threads}/${h}`;

  return {
    fs,

    /**
     * Өдрийн нэгтгэлийн бичилт (messenger_usage/<УБ өдөр>, 90 хоног): increments = [[«a» эсвэл «a.b», n]]. Нэмэлт commit-гүй —
     * дуудагч өөрийн commit-д нэмнэ («Тойм» KPI).
     */
    dayStatsWrite(t, increments) {
      const day = ubDay(t);
      return setWrite(`${COL.usage}/${day}`, { day, updatedAt: t, expireAt: new Date(t.getTime() + DAY_DOC_DAYS * DAY) }, {
        mask: ['day', 'updatedAt', 'expireAt'],
        transforms: increments.filter(([, n]) => Number.isFinite(n) && n !== 0).map(([f, n]) => transforms.increment(f, n)),
      });
    },

    /** Тохиргооны баримт (хэн, хэзээ хадгалсан, updateTime) — хямралын зогсолтод */
    async readSettingsMeta() {
      const d = await fs.get(`${COL.settings}/main`);
      return { settings: normalizeSettings(d?.data), updatedAt: d?.data?.updatedAt instanceof Date ? d.data.updatedAt : null, updatedBy: typeof d?.data?.updatedBy === 'string' ? d.data.updatedBy : null, updateTime: d?.updateTime ?? null, exists: Boolean(d) };
    },

    /** Сүүлд үнэлсэн ноорог (ratedAt ≥ since — нэг талбарын range, composite index-гүй) */
    async readRecentRatings(since, limit = 50) {
      const docs = await fs.query({ collection: COL.drafts, where: [['ratedAt', '>=', since]], orderBy: [['ratedAt', 'desc']], limit });
      const date = (v) => (v instanceof Date ? v : null);
      return docs.map((d) => ({ rating: d.data.rating, ratedAt: date(d.data.ratedAt), createdAt: date(d.data.createdAt), promptVersion: typeof d.data.promptVersion === 'string' ? d.data.promptVersion : null, route: d.data.route }));
    },

    /** Хямралын тоологч: Claude-ийн дараалсан алдаа (messenger_status/main) ба өнөөдрийн зардал */
    async readCrisisCounters(t) {
      const paths = [`${COL.status}/main`, `${COL.usage}/${ubDay(t)}`];
      const m = await fs.batchGet(paths);
      const st = m.get(paths[0])?.data;
      const a = st?.autoStop;
      const date = (v) => (v instanceof Date ? v : null);
      return {
        errorStreak: Number(st?.errorStreak) || 0,
        dayCostMicroUsd: Number(m.get(paths[1])?.data?.costMicroUsd) || 0,
        autoStop: a && typeof a === 'object' ? { reason: typeof a.reason === 'string' ? a.reason : '', at: date(a.at), resumedAt: date(a.resumedAt) } : null,
        // Өдрийн зардлаар сүүлд зогсоосон мөч — дараагийн (өөр шалтгааны) зогсолт үүнийг дарахгүй
        dayCostStopAt: date(st?.dayCostStopAt),
      };
    },

    /**
     * Автомат зогсолт: тохиргоо (killSwitch, горим/хязгаар ХЭВЭЭР) + audit + статус — НЭГ commit, тохиргооны updateTime
     * precondition-тай (эзэмшигч яг тэр мөчид хадгалсан бол дарахгүй — дараагийн шалгалт дахин үнэлнэ).
     * @returns {Promise<boolean>} зогсоосон эсэх
     */
    async autoStop({ reason, detail, updateTime }) {
      const t = now();
      const id = `a_${t.getTime().toString(36)}_auto_${statKey(reason)}`.slice(0, 64);
      try {
        await fs.commit([
          setWrite(`${COL.settings}/main`, { killSwitch: true, lastAuditId: id, updatedAt: t, updatedBy: 'system' }, {
            mask: ['killSwitch', 'lastAuditId', 'updatedAt', 'updatedBy'],
            ...(updateTime ? { updateTime } : {}),
          }),
          setWrite(`${COL.audit}/${id}`, { action: 'auto_stop', by: 'system', at: t, detail: { reason, ...detail } }, { exists: false }),
          setWrite(`${COL.status}/main`, { autoStop: { reason, at: t, detail }, errorStreak: 0, ...(reason === 'day_cost' ? { dayCostStopAt: t } : {}) },
            { mask: ['autoStop', 'errorStreak', ...(reason === 'day_cost' ? ['dayCostStopAt'] : [])] }),
        ]);
        return true;
      } catch (e) {
        if (e instanceof FirestoreError && e.isPrecondition) return false;
        throw e;
      }
    },

    /**
     * Автомат зогсолтын дараа эзэмшигч АНХ дахин асаасан мөчийг тэмдэглэнэ (autoStop.resumedAt) — дараагийн ердийн хадгалалт
     * «дахин асаасан мөч»-ийг урагшлуулж, завсарт үүссэн ноорогийн «Буруу» үнэлгээг тооноос хасахгүй (баталгаажуулах аудит).
     */
    async pinResume(at) {
      await fs.commit([setWrite(`${COL.status}/main`, { autoStop: { resumedAt: at } }, { mask: ['autoStop.resumedAt'], exists: true })]);
    },

    async readSettings() {
      const d = await fs.get(`${COL.settings}/main`);
      return normalizeSettings(d?.data);
    },

    /** settings/site + settings/catalog (сайтын нийтийн өгөгдөл) — knowledge.js */
    async readSiteDocs() {
      const m = await fs.batchGet(['settings/site', 'settings/catalog']);
      return { site: m.get('settings/site')?.data ?? null, catalog: m.get('settings/catalog')?.data ?? null };
    },

    /**
     * Мэдлэгийн бүх эх (knowledge.js): сайт + admin «Сургалт»-ийн мэдлэг, жишээ. Query = нэг талбарын equality эсвэл
     * шүүлтгүй (composite index-гүй); эрэмбийг knowledge/catalog-safe id-аар хийнэ (кэш тогтвортой).
     * @param {{ includeDrafts?: boolean }} [opt]  true — ноорог мэдлэгийг ч уншина (admin-ийн туршилт)
     */
    async readKnowledgeDocs(opt = {}) {
      const [heads, lists] = await Promise.all([this.readKnowledgeHeads(), this.readKnowledgeLists(opt)]);
      return { ...heads, ...lists };
    },

    /**
     * Мэдлэгийн «толгой»: сайтын 2 баримт + брэнд дуу хоолой + `_rev` (4 read). `rev` = тэдгээрийн updateTime — admin
     * мэдлэг/жишээ/каталог/тохиргоо засахад өөрчлөгдөнө (knowledge.js кэшийг зөвхөн тэр үед дахин ачаална).
     */
    async readKnowledgeHeads() {
      const paths = ['settings/site', 'settings/catalog', `${COL.kb}/${KB_IDS.voice}`, `${COL.kb}/${KB_IDS.rev}`];
      const m = await fs.batchGet(paths);
      return {
        site: m.get(paths[0])?.data ?? null,
        catalog: m.get(paths[1])?.data ?? null,
        voice: m.get(paths[2])?.data ?? null,
        rev: paths.map((p) => m.get(p)?.updateTime ?? '-').join('|'),
      };
    },

    /**
     * Мэдлэг (нийтэлсэн; admin-д бүгд) ба жишээ (ШИНЭ нь эхэнд — prompt-ийн хязгаарт шинэ жишээ ордог). Query = нэг талбарын
     * equality эсвэл нэг талбарын orderBy (composite index-гүй). `voice`, `_rev`-ийг жагсаалтаас хасна (толгойд бий).
     * @param {{ includeDrafts?: boolean, all?: boolean }} [opt]
     */
    async readKnowledgeLists(opt = {}) {
      const kbQuery = opt.includeDrafts || opt.all
        ? { collection: COL.kb, limit: KNOWLEDGE_READ_LIMIT.adminKb }
        : { collection: COL.kb, where: [['status', '==', 'published']], limit: KNOWLEDGE_READ_LIMIT.kb };
      const [kb, examples] = await Promise.all([
        fs.query(kbQuery),
        fs.query({ collection: COL.examples, orderBy: [['updatedAt', 'desc']], limit: KNOWLEDGE_READ_LIMIT.examples }),
      ]);
      const special = new Set(Object.values(KB_IDS));
      const rows = (docs) => docs.map((d) => ({ id: d.id, data: d.data }));
      return { kb: rows(kb.filter((d) => !special.has(d.id))), examples: rows(examples) };
    },

    /** Мэдлэгийн тэмдгийг сервер шинэчилнэ (cron жишээ устгасны дараа) — admin-ийн бичдэг хэлбэртэй ижил */
    async bumpKnowledgeRev() {
      const t = now();
      await fs.commit([setWrite(`${COL.kb}/${KB_IDS.rev}`, { title: 'Кэшийн тэмдэг (систем)', body: t.toISOString(), status: 'draft', updatedAt: t, updatedBy: 'system' })]);
    },

    /** Ноорогоос үүссэн (`x_`) жишээ — сүүлд засснаас хойш RETENTION_DAYS.drafts өнгөрсөн бол устгана (нууцлалын бодлого: 180 хоног) */
    async purgeDraftExamples(limit = 200) {
      const cutoff = new Date(now().getTime() - RETENTION_DAYS.drafts * DAY);
      const docs = await fs.query({ collection: COL.examples, where: [['updatedAt', '<=', cutoff]], orderBy: [['updatedAt', 'asc']], limit });
      const old = docs.filter((d) => d.id.startsWith('x_'));
      if (old.length) {
        await fs.commit(old.map((d) => deleteWrite(d.path)));
        await this.bumpKnowledgeRev();
      }
      return old.length;
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
        // exists=false-ийн зөрчил = ALREADY_EXISTS л (бусад FAILED_PRECONDITION-ийг давхардал гэж нуухгүй)
        if (e instanceof FirestoreError && e.status === 'ALREADY_EXISTS') return 'duplicate';
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
          const data = { state: 'bot', humanSince: null, lastStaffAt: null, lastUserAt: null, lastShadowBotAt: null, referral: null, oldestExpireAt: null, lockUntil: until, createdAt: t, updatedAt: t };
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
        // Массивыг min-ээр хязгаарлана (Meta-ийн загвар бүх ярианд гарч болно — баримт томрохгүй). Ашиглагдсаар байгаа
        // загварын хугацааг өдөрт нэг удаа сунгана — эс бөгөөс 90 хоногийн дараа устаж Meta-ийн хариу «ажилтан» болно.
        const doc = docs.get(`${COL.echo}/${fp}`);
        const seen = asDate(doc?.data?.lastSeenAt);
        const append = !threads.includes(psidHash) && threads.length < min;
        if (append || !seen || t.getTime() - seen.getTime() > DAY) {
          writes.push(setWrite(`${COL.echo}/${fp}`, { lastSeenAt: t, expireAt: new Date(t.getTime() + RETENTION_DAYS.echo * DAY) }, {
            mask: ['lastSeenAt', 'expireAt'],
            transforms: append ? [transforms.appendMissing('threads', [psidHash])] : [],
          }));
        }
      }
      if (writes.length) await fs.commit(writes);
      return out;
    },

    /**
     * planBatch-ийн мессеж (нууцалсан) ба thread-ийн төлвийг бичнэ. Event-ийн төлвийг ЭНД БИЧИХГҮЙ — ноорог (эсвэл
     * «хийх зүйлгүй») бичигдсэний дараа л `finishEvents` / `saveDraft({ eventStatus })` дуусгана: функц агентын явцад
     * тасарвал event pending үлдэж дараа нь дахин боловсрогдоно (мессеж нь ижил id-тай тул давхардахгүй).
     * @param {string} psidHash
     * @param {{ messages: any[], conversation: any }} plan
     * @param {Record<string, any>} thread  lockThread-ийн уншсан утга
     */
    async saveBatch(psidHash, plan, thread) {
      const t = now();
      const exp = new Date(t.getTime() + RETENTION_DAYS.messages * DAY);
      const writes = [];
      for (const m of plan.messages) {
        writes.push(setWrite(`${threadPath(psidHash)}/${COL.messages}/${m.eventId}`, {
          role: m.role, kind: m.kind, text: m.text, attachments: m.attachments, textHash: m.textHash, sentAt: m.sentAt, expireAt: exp,
          ...(m.echoWhy ? { echoWhy: m.echoWhy } : {}),
          // Манай ботын өөрийн илгээсэн мөр (finishOutbound бичсэн) — echo ирэхэд тэмдэг, логик байрлал хэвээр
          ...(m.own ? { own: true } : {}),
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
      writes.push(setWrite(threadPath(psidHash), th, { mask: Object.keys(th) }));
      // Echo-гийн ангилал, шалтгаан — өдрийн нэгтгэлд («Тойм»; бодит echo-гоор тохируулах). Мессеж АНХ бичигдэх үед л
      // тоолно: багцыг дахин боловсруулахад (retry, deadline) давхар тоологдохгүй (аудит) — pipeline хадгалсан echo-г
      // readEchoMessages-ээр уншиж planBatch-д өгдөг (echoKnown); яриаг thread-ийн түгжээ нэг зэрэг нэг л боловсруулна.
      const fresh = plan.messages.filter((m) => m.echoWhy && !m.echoKnown);
      if (fresh.length) {
        const counts = {};
        for (const m of fresh) counts[`echo.${statKey(m.role)}_${statKey(m.echoWhy)}`] = (counts[`echo.${statKey(m.role)}_${statKey(m.echoWhy)}`] || 0) + 1;
        writes.push(this.dayStatsWrite(t, Object.entries(counts)));
      }
      for (let i = 0; i < writes.length; i += 400) await fs.commit(writes.slice(i, i + 400));
    },

    /**
     * Аль хэдийн хадгалсан echo мессежүүд (event id → { role, echoWhy, at }) — дахин боловсруулахад ангиллыг хэвээр авна.
     * `at` — манай ботын өөрийн илгээсэн мөрийн (own) логик байрлал (хариулсан хэрэглэгчийн мессежийн яг дараа); бусдад null.
     */
    async readEchoMessages(psidHash, eventIds) {
      const paths = eventIds.map((id) => `${threadPath(psidHash)}/${COL.messages}/${id}`);
      const m = await fs.batchGet(paths);
      const out = new Map();
      eventIds.forEach((id, i) => {
        const d = m.get(paths[i])?.data;
        if (d && typeof d.role === 'string') {
          out.set(id, { role: d.role, echoWhy: typeof d.echoWhy === 'string' ? d.echoWhy : null, at: d.own === true && d.role === 'bot' ? asDate(d.sentAt) : null });
        }
      });
      return out;
    },

    /** Event-ийн эцсийн төлөв (done/skipped) — commit-ийн бичилтүүд */
    eventStatusWrites(eventStatus) {
      const t = now();
      return Object.entries(eventStatus || {}).map(([id, status]) =>
        setWrite(`${COL.events}/${id}`, { status, retryAt: null, processedAt: t }, { mask: ['status', 'retryAt', 'processedAt'] }));
    },

    async finishEvents(eventStatus) {
      const writes = this.eventStatusWrites(eventStatus);
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
      // testCostMicroUsd — admin-ий (туршилт + eval) зардал, дэд хязгаарт (adminTestCostPerMonth)
      return { runs: Number(d?.data?.runs) || 0, costMicroUsd: Number(d?.data?.costMicroUsd) || 0, testCostMicroUsd: Number(d?.data?.testCostMicroUsd) || 0 };
    },

    /**
     * Admin-ийн туршилтыг Claude-ийг дуудахаас ӨМНӨ тоолно (аудит 2026-11-27: өмнө нь дараа нь тоолдог байсан тул зэрэг
     * хүсэлт эсвэл бүртгэл бичигдэхгүй үед хязгаар ажиллахгүй байв). Өдрийн тоог updateTime precondition-оор атомаар
     * (≤ 4 оролдлого); сарын туршилтын тоо — зөөлөн хязгаар.
     * @returns {Promise<{ ok: true, dayTests: number } | { ok: false, reason: 'day_cap'|'month_tests'|'busy' }>}
     */
    async reserveAdminTest({ month, day, dayMax, monthMax, monthCostMax = Infinity }) {
      const r = await this.reserveDayCount({ day, field: 'tests', max: dayMax, month, monthMax, monthCostField: 'testCostMicroUsd', monthCostMax });
      return r.ok ? { ok: true, dayTests: r.count } : r;
    },

    /**
     * Өдрийн тоологчийг (`field`) updateTime precondition-оор атомаар нэмнэ (≤ 4 оролдлого); сарын тоо, зардал (зөөлөн хязгаар).
     * @returns {Promise<{ ok: true, count: number } | { ok: false, reason: 'day_cap'|'month_tests'|'busy' }>}
     */
    async reserveDayCount({ day, field, max, month, monthMax = Infinity, monthCostField = '', monthCostMax = Infinity }) {
      const dayPath = `${COL.usage}/${day}`;
      const monthPath = `${COL.usage}/${month}`;
      for (let i = 0; i < 4; i++) {
        const m = await fs.batchGet([dayPath, monthPath]);
        const d = m.get(dayPath);
        const count = Number(d?.data?.[field]) || 0;
        if (count >= max) return { ok: false, reason: 'day_cap' };
        const mo = m.get(monthPath)?.data;
        if ((Number(mo?.[field]) || 0) >= monthMax || (monthCostField && (Number(mo?.[monthCostField]) || 0) >= monthCostMax)) return { ok: false, reason: 'month_tests' };
        const t = now();
        try {
          await fs.commit([
            setWrite(dayPath, { day, updatedAt: t, expireAt: new Date(t.getTime() + DAY_DOC_DAYS * DAY) }, {
              mask: ['day', 'updatedAt', 'expireAt'],
              transforms: [transforms.increment(field, 1)],
              ...(d ? { updateTime: d.updateTime } : { exists: false }),
            }),
            setWrite(monthPath, { month, updatedAt: t }, { mask: ['month', 'updatedAt'], transforms: [transforms.increment(field, 1)] }),
          ]);
          return { ok: true, count: count + 1 };
        } catch (e) {
          if (!(e instanceof FirestoreError && e.isPrecondition)) throw e;
        }
      }
      return { ok: false, reason: 'busy' };
    },

    /* ---------- Бодит Claude-тэй eval (messenger_status — admin уншина, сервер бичнэ; rules өөрчлөхгүй) ---------- */

    async createEvalRun(run) {
      // Дуусаагүй (орхисон) ажиллагаа 7 хоногийн дараа cron-оор устна; дууссаныг түүхэд хадгална (expireAt = null)
      const t = now();
      await fs.commit([setWrite(evalRunPath(run.runId), { ...run, status: 'running', done: 0, costMicroUsd: 0, startedAt: t, expireAt: new Date(t.getTime() + 7 * DAY) }, { exists: false })]);
    },
    async readEvalRun(runId) {
      return (await fs.get(evalRunPath(runId)))?.data ?? null;
    },
    /**
     * Хэсгийг Claude-ийг дуудахаас ӨМНӨ эзэмшинэ (аудит: давхар/зэрэг хүсэлт хоёр удаа төлж, зардал бүртгэгдэхгүй байв).
     * `pending` баримтыг exists=false-аар үүсгэнэ; байвал — дууссан бол хадгалсан үр дүн, явж байгаа бол `busy`; функц тасарч
     * үлдсэн (EVAL_CLAIM_STALE_MS-ээс хуучин) `pending`-ийг updateTime precondition-оор дахин эзэмшинэ.
     * @returns {Promise<{ state: 'claimed' } | { state: 'done', results: object[] } | { state: 'busy', retryAfterMs: number }>}
     *   retryAfterMs — түгжээ хэзээ чөлөөлөгдөхийг admin-д хэлнэ (тэр хүртэл хүлээгээд дахин илгээнэ)
     */
    async claimEvalChunk(runId, from) {
      const path = evalChunkPath(runId, from);
      const t = now();
      const data = { runId, from, status: 'pending', claimedAt: t, expireAt: new Date(t.getTime() + 7 * DAY) };
      try {
        await fs.commit([setWrite(path, data, { exists: false })]);
        return { state: 'claimed' };
      } catch (e) {
        if (!(e instanceof FirestoreError && e.isPrecondition)) throw e;
      }
      const cur = await fs.get(path);
      if (!cur) return { state: 'busy', retryAfterMs: 1000 };
      if (cur.data.status !== 'pending' && Array.isArray(cur.data.results)) return { state: 'done', results: cur.data.results };
      const at = cur.data.claimedAt instanceof Date ? cur.data.claimedAt.getTime() : 0;
      const age = t.getTime() - at;
      if (age < EVAL_CLAIM_STALE_MS) return { state: 'busy', retryAfterMs: EVAL_CLAIM_STALE_MS - age + 500 };
      try {
        await fs.commit([setWrite(path, data, { updateTime: cur.updateTime })]);
        return { state: 'claimed' };
      } catch (e) {
        if (e instanceof FirestoreError && e.isPrecondition) return { state: 'busy', retryAfterMs: 5000 };
        throw e;
      }
    },
    /** Хэсгийн үр дүн бичигдээгүй (commit унасан) — түгжээг чөлөөлнө: admin шууд дахин илгээж болно (зардал бүртгэгдсэн) */
    async releaseEvalChunk(runId, from) {
      const path = evalChunkPath(runId, from);
      const cur = await fs.get(path);
      if (cur && cur.data.status === 'pending') await fs.commit([deleteWrite(path, { exists: true })]);
    },
    async readEvalIndex() {
      return (await fs.get(EVAL_INDEX))?.data ?? { runs: [] };
    },
    /**
     * Нэг хэсгийн үр дүн (эзэмшсэн `pending`-ийг дарна) + ai_runs (текстгүй) + сарын тоологч + ажиллагааны зардал — НЭГ commit.
     * Eval-ийн зардал admin-ий сарын дэд хязгаарт (testCostMicroUsd = туршилт + eval, сарын хязгаарын 20%) — үйлдвэрлэлийн
     * ноорогт 80% үлдэнэ (аудит).
     */
    async saveEvalChunk({ runId, from, results, runs, month, knowledgeRev = null }) {
      const t = now();
      const writes = [
        setWrite(evalChunkPath(runId, from), { runId, from, status: 'done', results, knowledgeRev, at: t, expireAt: new Date(t.getTime() + 7 * DAY) }),
        // exists: true — ажиллагаа энэ хооронд устсан (0 кейстэй дуусгасан) бол run баримтыг expireAt-гүй дахин үүсгэхгүй (аудит)
        setWrite(evalRunPath(runId), { updatedAt: t }, { mask: ['updatedAt'], exists: true, transforms: [transforms.increment('done', results.length), transforms.increment('costMicroUsd', evalCost(runs))] }),
        ...evalUsageWrites(runs, month, t),
      ];
      // Өдрийн нэгтгэл («Тойм»): admin-ий (туршилт + eval) зардал — үйлдвэрлэлийн day_cost шалгуурт ОРОХГҮЙ
      const cost = evalCost(runs.filter((r) => r?.billable));
      if (cost) writes.push(this.dayStatsWrite(t, [['adminCostMicroUsd', cost]]));
      await fs.commit(writes);
    },
    /** saveEvalChunk бүтэлгүйтвэл (Claude аль хэдийн төлбөртэй) — зөвхөн ai_runs + сарын зардлыг дахин бичнэ */
    async recordEvalCost({ runs, month }) {
      const t = now();
      const writes = evalUsageWrites(runs, month, t);
      const cost = evalCost(runs.filter((r) => r?.billable));
      if (cost) writes.push(this.dayStatsWrite(t, [['adminCostMicroUsd', cost]]));
      await fs.commit(writes);
    },
    /** Бүх ДУУССАН хэсгийн үр дүн (дарааллаар) ба хэсэг бүрийн мэдлэгийн тэмдэг */
    async readEvalResults(runId, total, chunk) {
      const paths = [];
      for (let f = 0; f < total; f += chunk) paths.push(evalChunkPath(runId, f));
      const m = await fs.batchGet(paths);
      const docs = paths.map((p) => m.get(p)?.data).filter((d) => d && d.status !== 'pending' && Array.isArray(d.results));
      return { results: docs.flatMap((d) => d.results), revs: [...new Set(docs.map((d) => d.knowledgeRev).filter(Boolean))] };
    },
    /**
     * Ажиллагааг дуусгана: run баримтад тайлан + кейс бүрийн тэнцсэн эсэх + унасан кейсүүд, түүх (≤ history), энэ ажиллагааны
     * хэсгүүд ба түүхээс гарсан хуучин ажиллагааг устгана — НЭГ commit.
     */
    async finishEval({ runId, total, chunk, report, entry }) {
      const t = now();
      const idx = await this.readEvalIndex();
      const prior = (Array.isArray(idx.runs) ? idx.runs : []).filter((r) => r && r.runId !== runId);
      const runs = [{ ...entry, at: t }, ...prior];
      const keep = runs.slice(0, EVAL_LIMITS.history);
      const writes = [
        setWrite(evalRunPath(runId), { ...report, status: 'done', finishedAt: t, expireAt: null }, { mask: [...Object.keys(report), 'status', 'finishedAt', 'expireAt'] }),
        setWrite(EVAL_INDEX, { runs: keep, updatedAt: t }),
      ];
      for (let f = 0; f < total; f += chunk) writes.push(deleteWrite(evalChunkPath(runId, f)));
      for (const old of runs.slice(EVAL_LIMITS.history)) if (/^ev[a-z0-9]+$/.test(String(old.runId))) writes.push(deleteWrite(evalRunPath(old.runId)));
      await fs.commit(writes);
    },
    /** Нэг ч кейс дуусаагүй ажиллагаа — түүхэд оруулахгүй (харьцуулалтыг хоосон болгохгүй), баримтуудыг устгана (аудит) */
    async discardEval({ runId, total, chunk }) {
      const writes = [deleteWrite(evalRunPath(runId))];
      for (let f = 0; f < total; f += chunk) writes.push(deleteWrite(evalChunkPath(runId, f)));
      await fs.commit(writes);
    },

    /**
     * Admin-ийн туршилт / eval-ийн Claude дуудлагын бүртгэл: ai_runs (текстгүй) + сарын зардал (хязгаарт тоологдоно) — НЭГ
     * commit. messenger_drafts-д бичихгүй (үнэлгээний статистикийг бохирдуулахгүй). Туршилтын тоог reserveAdminTest тоолсон.
     * @param {{ run: object, month: string }} p
     */
    async saveAdminRun({ run, month }) {
      const t = now();
      const writes = [setWrite(`${COL.runs}/${newId('r')}`, {
        ...run, draftId: null, createdAt: t, expireAt: new Date(t.getTime() + RETENTION_DAYS.runs * DAY),
      }, { exists: false })];
      // Туршилт/eval-ийн зардал өдрийн нэгтгэлд ТУСДАА (хямралын day_cost шалгуурт орохгүй — өөрийн хязгаартай)
      if (run.billable) writes.push(this.dayStatsWrite(t, [['adminCostMicroUsd', Math.max(0, Math.round(run.costMicroUsd || 0))]]));
      if (run.billable) {
        const cost = Math.max(0, Math.round(run.costMicroUsd || 0));
        writes.push(setWrite(`${COL.usage}/${month}`, { month, updatedAt: t }, {
          mask: ['month', 'updatedAt'],
          // testCostMicroUsd — туршилтын сарын зардлын дэд хязгаарт (adminTestCostPerMonth)
          transforms: [transforms.increment('runs', 1), transforms.increment('costMicroUsd', cost), transforms.increment('testCostMicroUsd', cost)],
        }));
      }
      await fs.commit(writes);
    },

    /**
     * Ноорог + ажиллагааны бүртгэл + сарын тоологч + event-ийн эцсийн төлөв — НЭГ commit (функц тасарвал бүгд эсвэл юу ч үгүй).
     * Ноорогийн id = хариулах event-ээс тогтмол (`d_<event>`): дахин боловсруулахад давхар ноорог үүсэхгүй.
     * @param {{ draft?: object|null, run?: object|null, month?: string, replyToEventId?: string, eventStatus?: Record<string, string> }} p
     */
    async saveDraft(p) {
      return (await this.saveDraftEx(p)).draftId;
    },

    /**
     * saveDraft-тай ижил; `created` — ноорог ЭНЭ commit-оор шинээр үүссэн эсэх. false (өмнөх оролдлогын ноорог байсан) бол
     * дуудагч ИЛГЭЭХГҮЙ: хадгалагдсан ноорогоос өөр текст үйлчлүүлэгч рүү явах ёсгүй.
     * @returns {Promise<{ draftId: string|null, created: boolean }>}
     */
    async saveDraftEx({ draft, run, month, replyToEventId, eventStatus }) {
      const t = now();
      const draftId = draft ? `d_${String(replyToEventId || draft.replyToEventId || '').replace(/^e_/, '') || randomUUID().replace(/-/g, '')}` : null;
      const writes = [];
      if (draft) {
        writes.push(setWrite(`${COL.drafts}/${draftId}`, {
          // Илгээлтийн төлөв (outbound.js шинэчилнэ): null = илгээх оролдлого хийгээгүй (сүүдэр, ноорог чиглэл)
          sendStatus: null, sendReason: null, sentAt: null,
          ...draft, rating: null, note: '', ratedAt: null, ratedBy: null, createdAt: t,
          expireAt: new Date(t.getTime() + RETENTION_DAYS.drafts * DAY),
        }, { exists: false }));
      }
      if (run) {
        writes.push(setWrite(`${COL.runs}/${newId('r')}`, {
          ...run, draftId, createdAt: t, expireAt: new Date(t.getTime() + RETENTION_DAYS.runs * DAY),
        }, { exists: false }));
        if (run.billable) {
          writes.push(setWrite(`${COL.usage}/${month}`, { month, updatedAt: t }, {
            mask: ['month', 'updatedAt'],
            transforms: [transforms.increment('runs', 1), transforms.increment('costMicroUsd', Math.max(0, Math.round(run.costMicroUsd || 0)))],
          }));
        }
      }
      // «Тойм»-ын өдрийн нэгтгэл (энэ commit-д — функц тасарвал давхар тоологдохгүй)
      const stats = [];
      if (draft) stats.push(['drafts', 1], [`routes.${statKey(draft.route)}`, 1], [`intents.${statKey(draft.intent)}`, 1]);
      if (run) {
        stats.push([`runs.${statKey(run.status)}`, 1]);
        if (run.billable) {
          stats.push(['costMicroUsd', Math.max(0, Math.round(run.costMicroUsd || 0))], ['inputTokens', Number(run.inputTokens) || 0],
            ['outputTokens', Number(run.outputTokens) || 0], ['cacheReadTokens', Number(run.cacheReadTokens) || 0], ['cacheWriteTokens', Number(run.cacheWriteTokens) || 0]);
        }
        // Claude-ийн ДАРААЛСАН засагдахгүй алдаа (хямралын автомат зогсолт — crisis.js): +1, амжилттай хариу 0. Түр зуурын
        // (retryable — дахин оролдогдоно) алдаа тоологчийг өөрчлөхгүй (аудит: богино тасалдал зогсоодог байв)
        if (run.status === 'error' && run.retryable !== true) writes.push(setWrite(`${COL.status}/main`, {}, { mask: [], transforms: [transforms.increment('errorStreak', 1)] }));
        else if (run.status === 'ok' || run.status === 'refusal') writes.push(setWrite(`${COL.status}/main`, { errorStreak: 0 }, { mask: ['errorStreak'] }));
      }
      if (stats.length) writes.push(this.dayStatsWrite(t, stats));
      writes.push(...this.eventStatusWrites(eventStatus));
      if (!writes.length) return { draftId, created: false };
      try {
        await fs.commit(writes);
      } catch (e) {
        // Энэ event-д ноорог аль хэдийн бичигдсэн (өмнөх оролдлого) — event-ийг л дуусгана
        if (draft && e instanceof FirestoreError && e.status === 'ALREADY_EXISTS') {
          await this.finishEvents(eventStatus);
          return { draftId, created: false };
        }
        throw e;
      }
      return { draftId, created: Boolean(draft) };
    },

    /* ---------- Илгээлт («Автомат» горим) — ЗӨВХӨН outbound.js sendGuarded дуудна ---------- */

    /** Өнөөдрийн (УБ) нийт илгээх оролдлогын тоо — өдрийн таслуур (зөөлөн хязгаар: 1 read) */
    async readDaySendClaims(t = now()) {
      const d = await fs.get(`${COL.usage}/${ubDay(t)}`);
      return Number(d?.data?.sendClaims) || 0;
    },

    /**
     * Илгээхийн ӨМНӨ бүртгэлийг эзэмшинэ (exists=false): ижил event-д хоёр дахь оролдлого (давтан webhook, retry, зэрэг
     * инстанс) = 'duplicate' — Graph руу хэзээ ч хоёр удаа явахгүй. Функц эндээс хойш тасарвал бүртгэл `sending` хэвээр
     * үлдэж ДАХИН ИЛГЭЭХГҮЙ (хамгийн ихдээ нэг удаа).
     * @returns {Promise<{ ok: true, id: string } | { ok: false }>}
     */
    async claimOutbound({ eventId, psidHash, draftId, kind, text }) {
      if (!EVENT_ID_RE.test(String(eventId)) || !DRAFT_ID_RE.test(String(draftId))) throw new Error('outbound_bad_id');
      const t = now();
      const id = outboundDocId(eventId);
      try {
        await fs.commit([
          setWrite(`${COL.outbound}/${id}`, {
            status: 'sending', kind, threadId: psidHash, draftId, replyToEventId: eventId, text: String(text).slice(0, 2000),
            mid: null, error: null, createdAt: t, sentAt: null, expireAt: new Date(t.getTime() + RETENTION_DAYS.outbound * DAY),
          }, { exists: false }),
          this.dayStatsWrite(t, [['sendClaims', 1]]),
        ]);
        return { ok: true, id };
      } catch (e) {
        if (e instanceof FirestoreError && e.status === 'ALREADY_EXISTS') return { ok: false };
        throw e;
      }
    },

    /**
     * Илгээлтийн үр дүн — НЭГ commit: бүртгэл (sent/failed), ноорогийн төлөв, өдрийн нэгтгэл; амжилттай бол ботын мөрийг
     * thread-д шууд (`botMessage`: id = тухайн mid-ийн echo event-ийн id → echo ирэхэд давхардахгүй, `own` + логик байрлал);
     * алдаа бол messenger_status/main.lastSendError (ангилал + тоон код л — token, текстгүй).
     * @param {{ id: string, draftId: string, psidHash: string, kind: string, ok: boolean, mid?: string|null,
     *   error?: { kind: string, code?: number|null, subcode?: number|null } | null,
     *   botMessage?: { id: string, text: string, textHash: string|null, at: Date } | null }} p
     */
    async finishOutbound({ id, draftId, psidHash, kind, ok, mid = null, error = null, botMessage = null }) {
      const t = now();
      const err = ok ? null : { kind: statKey(error?.kind), code: Number.isFinite(error?.code) ? error.code : null, subcode: Number.isFinite(error?.subcode) ? error.subcode : null };
      const writes = [
        setWrite(`${COL.outbound}/${id}`, { status: ok ? 'sent' : 'failed', mid: ok ? mid : null, error: err, sentAt: ok ? t : null },
          { mask: ['status', 'mid', 'error', 'sentAt'], exists: true }),
        setWrite(`${COL.drafts}/${draftId}`, { sendStatus: ok ? 'sent' : 'failed', sendReason: ok ? null : err.kind, sentAt: ok ? t : null },
          { mask: ['sendStatus', 'sendReason', 'sentAt'], exists: true }),
        this.dayStatsWrite(t, [[ok ? `sent.${statKey(kind)}` : `sendFail.${err.kind}`, 1]]),
      ];
      if (ok && botMessage) {
        const exp = new Date(t.getTime() + RETENTION_DAYS.messages * DAY);
        writes.push(setWrite(`${threadPath(psidHash)}/${COL.messages}/${botMessage.id}`, {
          role: 'bot', kind: 'text', text: botMessage.text, attachments: [], textHash: botMessage.textHash, sentAt: botMessage.at, expireAt: exp, own: true,
        }));
      }
      if (!ok) writes.push(setWrite(`${COL.status}/main`, { lastSendError: { ...err, at: t } }, { mask: ['lastSendError'] }));
      await fs.commit(writes);
    },

    /** Илгээгээгүй (хамгаалалт татгалзсан) — ноорогт шалтгаан + өдрийн нэгтгэл. Ноорог байхгүй бол юу ч бичихгүй. */
    async markSendSkipped({ draftId, reason }) {
      const t = now();
      const key = statKey(reason);
      try {
        await fs.commit([
          setWrite(`${COL.drafts}/${draftId}`, { sendStatus: 'skipped', sendReason: key, sentAt: null }, { mask: ['sendStatus', 'sendReason', 'sentAt'], exists: true }),
          this.dayStatsWrite(t, [[`sendSkip.${key}`, 1]]),
        ]);
      } catch (e) {
        // Ноорог байхгүй (exists=true → NOT_FOUND) — тэмдэглэх зүйл алга
        if (!(e instanceof FirestoreError && (e.isPrecondition || e.isNotFound))) throw e;
      }
    },

    /** Хадгалах хугацаа дууссан баримтуудыг устгана (нэг collection, ≤ limit) */
    async purgeExpired(collection, limit = 200) {
      const docs = await fs.query({ collection, where: [['expireAt', '<=', now()]], orderBy: [['expireAt', 'asc']], limit });
      // messenger_status: зөвхөн eval-ийн баримт (main, evals-ийг хэзээ ч устгахгүй — хамгаалалт)
      const del = collection === COL.status ? docs.filter((d) => /\/evalc?_[^/]+$/.test(d.path)) : docs;
      if (del.length) await fs.commit(del.map((d) => deleteWrite(d.path)));
      return docs.length;
    },

    /** Хуучирсан мессежтэй яриануудыг цэвэрлэнэ (collection group query-гүй). oldestExpireAt-ийг thread-ийн updateTime
     *  precondition-оор бичнэ — зэрэг saveBatch шинэ мессеж нэмсэн бол алгасаад маргааш дахин. */
    async purgeThreadMessages(threadLimit = 20) {
      const t = now();
      const threads = await fs.query({ collection: COL.threads, where: [['oldestExpireAt', '<=', t]], orderBy: [['oldestExpireAt', 'asc']], limit: threadLimit });
      let deleted = 0;
      for (const th of threads) {
        const old = await fs.query({ parent: th.path, collection: COL.messages, where: [['expireAt', '<=', t]], orderBy: [['expireAt', 'asc']], limit: 300 });
        if (old.length) await fs.commit(old.map((d) => deleteWrite(d.path)));
        deleted += old.length;
        const next = await fs.query({ parent: th.path, collection: COL.messages, orderBy: [['expireAt', 'asc']], limit: 1 });
        try {
          await fs.commit([setWrite(th.path, { oldestExpireAt: next[0]?.data?.expireAt ?? null }, { mask: ['oldestExpireAt'], updateTime: th.updateTime })]);
        } catch (e) {
          if (!(e instanceof FirestoreError && e.isPrecondition)) throw e;
        }
      }
      return { deleted, threads: threads.length };
    },
  };
}

/**
 * Messenger AI — хямралын автомат зогсолт. ЦЭВЭР модуль (I/O-гүй; store.js, admin-api.js, agent.js, cron.js дуудна).
 *
 * Эзэмшигчийн шийдвэр (2026-11-26): сүүдэр горимд ч БОДИТООР зогсооно — `messenger_settings/main.killSwitch = true`
 * (горим, хязгаар хэвээр, `updatedBy: 'system'`) + `messenger_audit` (`action: 'auto_stop'`) нэг commit-д. Дахин асаах =
 * admin «Тохиргоо»-д яаралтай зогсоолтыг унтрааж хадгалах (ердийн audit).
 *
 * Шалгуур (аль нэг нь):
 *   · wrong_ratings — сүүлийн 24 цагт үнэлсэн, ОДООГИЙН prompt-ийн хувилбартай ноорогийн ≥ 5 нь «Буруу» бөгөөд ≥ 50%
 *     (эзэмшигч олон хуучин ноорогийг нэг дор үнэлдэг тул хувиар — цөөн «Буруу» зогсоохгүй). Автомат зогсолтын дараа
 *     эзэмшигч дахин асаасан бол түүнээс ӨМНӨ үүссэн ноорогийг тоолохгүй (хуучин ноорогийг үнэлээд дахин зогсохгүй — аудит)
 *   · error_streak — Claude дараалан ≥ 5 удаа ЗАСАГДАХГҮЙ алдаа (түлхүүр, кредит, хүсэлт буруу). Түр зуурын алдаа (timeout,
 *     429, 5xx/529) дахин оролдогддог тул тоологдохгүй — богино тасалдал зогсоохгүй (аудит)
 *   · day_cost — өнөөдрийн (УБ) зардал ≥ сарын зардлын хязгаарын 20%. Өнөөдөр ЭНЭ шалтгаанаар зогсоосны дараа эзэмшигч
 *     дахин асаасан бол маргааш хүртэл үгүй (бусад хадгалалт энэ шалгуурыг унтраахгүй — аудит)
 */

export const CRISIS = Object.freeze({ wrongMin: 5, wrongRatio: 0.5, windowMs: 24 * 3600_000, errorStreak: 5, dayCostShare: 0.2 });

/** Шалтгааны текст (admin туузанд — admin/messenger-lib.js AUTO_STOP_TEXT-тэй ижил, тест тулгана) */
export const CRISIS_REASONS = Object.freeze(['wrong_ratings', 'error_streak', 'day_cost']);

/** «Буруу» харьцааг шүүхэд хамгийн сүүлийн ийм тооны үнэлгээ хангалттай (≥ 5 ба ≥ 50%) — Spark-ийн уншилт (аудит: 200 байв) */
export const CRISIS_RATINGS_READ = 50;

/** Эзэмшигч (систем биш) тохиргоог сүүлд хадгалсан мөч (ms) — эс бөгөөс null */
export const ownerSavedAt = (meta) => (meta?.updatedBy && meta.updatedBy !== 'system' ? asMs(meta.updatedAt ?? null) : null);

const asMs = (v) => (v instanceof Date ? v.getTime() : Number.isFinite(v) ? v : null);

/**
 * @param {{ now: Date, settings: { active: boolean, monthlyCostCapUsd: number }, settingsMeta?: { updatedAt?: Date|null, updatedBy?: string|null },
 *   ratings?: readonly { rating: string, ratedAt: Date|null, createdAt?: Date|null, promptVersion?: string|null }[] | null,
 *   promptVersion?: string|null, errorStreak?: number|null, dayCostMicroUsd?: number|null, dayStart?: Date|null,
 *   autoStop?: { reason?: string, at?: Date|null, resumedAt?: Date|null } | null, dayCostStopAt?: Date|null }} input
 *   null/undefined оролт = тэр шалгуурыг шалгахгүй. autoStop.resumedAt — зогсолтын дараа АНХ дахин асаасан мөч (тэмдэглэсэн бол)
 * @returns {{ trip: false } | { trip: true, reason: 'wrong_ratings'|'error_streak'|'day_cost', detail: Record<string, number> }}
 */
export function evaluateCrisis(input) {
  if (!input.settings?.active) return { trip: false };
  const now = input.now.getTime();
  const meta = input.settingsMeta || {};
  // Эзэмшигч (систем биш) сүүлд хадгалсан мөч; автомат зогсолтын ДАРАА хадгалсан бол = дахин асаасан мөч (resumeAt)
  const ownerAt = ownerSavedAt(meta);
  const stopAt = asMs(input.autoStop?.at ?? null);
  // Тэмдэглэсэн (анхны) дахин асаасан мөч давуу — дараагийн ердийн хадгалалт цонхыг урагшлуулахгүй
  const resumeAt = asMs(input.autoStop?.resumedAt ?? null) ?? (ownerAt !== null && stopAt !== null && ownerAt > stopAt ? ownerAt : null);

  if (Number.isFinite(input.errorStreak) && input.errorStreak >= CRISIS.errorStreak) {
    return { trip: true, reason: 'error_streak', detail: { errorStreak: input.errorStreak } };
  }

  if (Array.isArray(input.ratings)) {
    const since = now - CRISIS.windowMs;
    const pv = input.promptVersion || null;
    const recent = input.ratings.filter((r) => asMs(r.ratedAt) !== null && asMs(r.ratedAt) > since && ['good', 'edited', 'wrong'].includes(r.rating)
      && (!pv || !r.promptVersion || r.promptVersion === pv)
      && (resumeAt === null || (asMs(r.createdAt ?? null) ?? -Infinity) > resumeAt));
    const wrong = recent.filter((r) => r.rating === 'wrong').length;
    if (wrong >= CRISIS.wrongMin && wrong / recent.length >= CRISIS.wrongRatio) {
      return { trip: true, reason: 'wrong_ratings', detail: { wrong, rated: recent.length } };
    }
  }

  const cap = Number(input.settings.monthlyCostCapUsd) || 0;
  if (Number.isFinite(input.dayCostMicroUsd) && cap > 0) {
    const limit = cap * 1e6 * CRISIS.dayCostShare;
    // Өнөөдөр ЗАРДЛААР зогсоосны дараа эзэмшигч хадгалсан (= дахин асаасан; одоо идэвхтэй). Дараа нь өөр шалтгаанаар зогсоод
    // дахин ассан ч хэвээр (dayCostStopAt тусдаа хадгалагдана — баталгаажуулах аудит)
    const dcs = asMs(input.dayCostStopAt ?? null) ?? (input.autoStop?.reason === 'day_cost' ? stopAt : null);
    const reEnabledToday = dcs !== null && ownerAt !== null && ownerAt > dcs && input.dayStart && dcs >= input.dayStart.getTime();
    if (input.dayCostMicroUsd >= limit && !reEnabledToday) {
      return { trip: true, reason: 'day_cost', detail: { dayCostMicroUsd: Math.round(input.dayCostMicroUsd), limitMicroUsd: Math.round(limit) } };
    }
  }
  return { trip: false };
}

/** УБ-ын өнөөдрийн эхлэл (00:00 +08:00) — Монгол DST-гүй */
export function ubDayStart(date) {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  return new Date(`${d}T00:00:00+08:00`);
}

/**
 * Хямралын шалгагч (I/O): тохиргоо, тоологч, (хүсвэл) сүүлийн үнэлгээг уншиж evaluateCrisis → autoStop.
 * Агент (Claude-ийн алдаа/төлбөртэй ажиллагааны дараа — үнэлгээгүй), admin («Буруу» үнэлгээний дараа), cron дуудна.
 * Алдаа гарвал ноорог бичихийг ЗОГСООХГҮЙ (дуудагч catch хийнэ).
 * @param {{ store: any, now?: () => Date, log?: (m: string) => void }} deps
 */
export function createCrisisGuard({ store, now = () => new Date(), log = (m) => console.warn(m), promptVersion = null }) {
  return {
    /** Агентын ажиллагааны дараа: алдааны дараалал / өдрийн зардал (тохиргоо + 2 баримт) */
    async afterRun(run) {
      // Түр зуурын алдаа (дахин оролдогдоно) тоологчийг өөрчлөхгүй — шалгах шаардлагагүй
      if (!run || (run.status === 'error' ? run.retryable === true : !run.billable)) return { trip: false };
      return this.check({ ratings: false });
    },
    /** @param {{ ratings?: boolean }} [opt] ratings — сүүлийн 24 цагийн үнэлгээг ч (≤ CRISIS_RATINGS_READ read) */
    async check({ ratings = true } = {}) {
      const t = now();
      const meta = await store.readSettingsMeta();
      if (!meta.settings.active) return { trip: false };
      const counters = await store.readCrisisCounters(t);
      // Автомат зогсолтын дараах АНХНЫ дахин асаалтыг нэг удаа тэмдэглэнэ (алдаа гарвал энэ удаад тооцоолсон утгаар)
      const a = counters.autoStop;
      const ownerAt = ownerSavedAt(meta);
      if (a?.at && !a.resumedAt && ownerAt !== null && ownerAt > a.at.getTime()) {
        a.resumedAt = new Date(ownerAt);
        await store.pinResume(a.resumedAt).catch(() => {});
      }
      const recent = ratings ? await store.readRecentRatings(new Date(t.getTime() - CRISIS.windowMs), CRISIS_RATINGS_READ) : null;
      const r = evaluateCrisis({
        now: t, settings: meta.settings, settingsMeta: meta, ratings: recent, promptVersion,
        errorStreak: counters.errorStreak, dayCostMicroUsd: counters.dayCostMicroUsd, dayStart: ubDayStart(t), autoStop: counters.autoStop,
        dayCostStopAt: counters.dayCostStopAt,
      });
      if (!r.trip) return r;
      const stopped = await store.autoStop({ reason: r.reason, detail: r.detail, updateTime: meta.updateTime });
      if (stopped) log(`[messenger] АВТОМАТ ЗОГСОЛТ: ${r.reason}`);
      return { ...r, stopped };
    },
  };
}

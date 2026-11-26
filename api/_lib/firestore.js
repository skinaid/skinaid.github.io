/**
 * Firestore REST v1-ийн жижиг клиент (сервер). firebase-admin-ийг ЗОРИУД ашиглаагүй: түүний Firestore нь WIF
 * (external account) credential хүлээж авдаггүй, gRPC-тэй хүнд сан тул cold start удаашруулна.
 * IAM (service account)-ын хүсэлт firestore.rules болон App Check-д хамаарахгүй — хамгаалалт нь IAM-ийн
 * `Cloud Datastore User` эрх + энэ кодын логик.
 *
 * Бүх бичилт `:commit`-оор (атом): precondition (`exists`, `updateTime`), transform (increment, serverTime,
 * appendMissingElements). Query нь composite index шаардахгүй хэлбэрээр л (store.js).
 *
 * Утгын хөрвүүлэлт: null, boolean, тоо (бүхэл → integerValue, бутархай → doubleValue), string, Date →
 * timestampValue, массив, объект (map). `undefined` талбарыг алгасна.
 */
import { safeErrorReason } from './errors.js';

export class FirestoreError extends Error {
  /** @param {number} httpStatus @param {string} status @param {string} message */
  constructor(httpStatus, status, message) {
    super(`FIRESTORE_${status || httpStatus}: ${String(message || '').slice(0, 200)}`);
    this.name = 'FirestoreError';
    this.httpStatus = httpStatus;
    this.status = status;
    /** AUTH үед token авч чадаагүй шалтгаан (token-ийг хассан) — зөвхөн лог-д, Firestore-д хадгалахгүй */
    /** @type {string|undefined} */
    this.reason = undefined;
  }
  /** exists=false (ALREADY_EXISTS) эсвэл updateTime (FAILED_PRECONDITION) таараагүй */
  get isPrecondition() {
    return this.status === 'ALREADY_EXISTS' || this.status === 'FAILED_PRECONDITION';
  }
  get isNotFound() {
    return this.status === 'NOT_FOUND';
  }
  /** Түр зуурын (дахин оролдвол болж магадгүй) алдаа — webhook зөвхөн үүнд 503 буцаана (Meta дахин илгээнэ).
   *  Квот (RESOURCE_EXHAUSTED), эрх (PERMISSION_DENIED, AUTH) зэрэг удаан үргэлжлэх алдаанд 503 буцаавал Meta
   *  webhook-ийг унтрааж болзошгүй. */
  get isTransient() {
    return ['UNAVAILABLE', 'DEADLINE_EXCEEDED', 'NETWORK', 'INTERNAL', 'ABORTED'].includes(this.status) || this.httpStatus >= 500;
  }
}

// ---------- Утгын хөрвүүлэлт ----------

/** JS утга → Firestore Value */
export function encodeValue(v) {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  switch (typeof v) {
    case 'boolean':
      return { booleanValue: v };
    case 'number':
      if (!Number.isFinite(v)) return { nullValue: null };
      return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    case 'string':
      return { stringValue: v };
    case 'object':
      if (Array.isArray(v)) return { arrayValue: { values: v.filter((x) => x !== undefined).map(encodeValue) } };
      return { mapValue: { fields: encodeFields(v) } };
    default:
      throw new TypeError(`Firestore: дэмжихгүй төрөл ${typeof v}`);
  }
}

export function encodeFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined) out[k] = encodeValue(v);
  return out;
}

/** Firestore Value → JS утга */
export function decodeValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return String(v.stringValue);
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields);
  if ('referenceValue' in v) return String(v.referenceValue);
  if ('bytesValue' in v) return String(v.bytesValue);
  if ('geoPointValue' in v) return { ...v.geoPointValue };
  return null;
}

export function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}

/** Талбарын замыг backtick-ээр (тусгай тэмдэгттэй түлхүүрт) — энд зөвхөн энгийн нэр ашиглана */
const fieldPath = (f) => String(f).split('.').map((p) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) ? p : `\`${p.replace(/[`\\]/g, '\\$&')}\``)).join('.');

/** Баримтын замын хэсэг бүр хүчинтэй эсэх (`/`, `.`, `..`, `__…__`-гүй) */
export function assertDocPath(path) {
  const parts = String(path).split('/');
  if (parts.length % 2 !== 0 || parts.some((p) => !p || p === '.' || p === '..' || /^__.*__$/.test(p) || p.length > 1500)) {
    throw new TypeError(`Firestore: буруу баримтын зам «${String(path).slice(0, 80)}»`);
  }
}

// ---------- Бичилтийн builder (commit-д) ----------

/**
 * set: бүтэн баримтыг солих (mask байхгүй) эсвэл зөвхөн `mask` талбаруудыг (merge).
 * @param {string} path
 * @param {Record<string, unknown>} data
 * @param {{ mask?: string[], exists?: boolean, updateTime?: string, transforms?: object[] }} [opt]
 */
export function setWrite(path, data, opt = {}) {
  assertDocPath(path);
  const w = { update: { name: path, fields: encodeFields(data) } };
  if (opt.mask) w.updateMask = { fieldPaths: opt.mask.map(fieldPath) };
  if (opt.transforms?.length) w.updateTransforms = opt.transforms;
  if (opt.exists !== undefined) w.currentDocument = { exists: opt.exists };
  else if (opt.updateTime) w.currentDocument = { updateTime: opt.updateTime };
  return w;
}

export function deleteWrite(path, opt = {}) {
  assertDocPath(path);
  const w = { delete: path };
  if (opt.exists !== undefined) w.currentDocument = { exists: opt.exists };
  return w;
}

export const transforms = {
  increment: (field, n) => ({ fieldPath: fieldPath(field), increment: encodeValue(n) }),
  serverTime: (field) => ({ fieldPath: fieldPath(field), setToServerValue: 'REQUEST_TIME' }),
  appendMissing: (field, values) => ({ fieldPath: fieldPath(field), appendMissingElements: { values: values.map(encodeValue) } }),
};

// ---------- Клиент ----------

const OPS = { '==': 'EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', in: 'IN' };

/**
 * @param {{ projectId: string, getAccessToken: () => Promise<string>, fetchImpl?: typeof fetch, database?: string, timeoutMs?: number }} opts
 */
export function createFirestore(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const db = `projects/${opts.projectId}/databases/${opts.database ?? '(default)'}`;
  const root = `${db}/documents`;
  const base = 'https://firestore.googleapis.com/v1';
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const full = (path) => `${root}/${path}`;
  const rel = (name) => String(name).slice(root.length + 1);

  async function call(method, url, body) {
    let token;
    try {
      token = await opts.getAccessToken();
    } catch (e) {
      // WIF/IAM-ийн тохиргоо буруу, OIDC token алга г.м. Мессеж = тогтмол (Firestore-д хадгалагдаж болзошгүй);
      // шалтгаан нь `reason`-д, token-ийг хассан хэлбэрээр — зөвхөн лог-д (errors.js describeError)
      const err = new FirestoreError(0, 'AUTH', e && e.name === 'AuthNotConfiguredError' ? 'not configured' : 'token failed');
      err.reason = safeErrorReason(e);
      throw err;
    }
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new FirestoreError(0, 'NETWORK', e && e.name === 'TimeoutError' ? 'timeout' : 'fetch failed');
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) {
      // runQuery алдааг массив дотор буцааж болно
      const err = (Array.isArray(json) ? json[0]?.error : json?.error) || {};
      throw new FirestoreError(res.status, String(err.status || ''), String(err.message || ''));
    }
    return json;
  }

  const toDoc = (d) => ({ path: rel(d.name), id: d.name.slice(d.name.lastIndexOf('/') + 1), data: decodeFields(d.fields), updateTime: d.updateTime, createTime: d.createTime });

  return {
    /** @returns {Promise<{path: string, id: string, data: Record<string, any>, updateTime: string, createTime: string} | null>} */
    async get(path) {
      assertDocPath(path);
      try {
        return toDoc(await call('GET', `${base}/${full(path)}`));
      } catch (e) {
        if (e instanceof FirestoreError && (e.isNotFound || e.httpStatus === 404)) return null;
        throw e;
      }
    },

    /** Олон баримт нэг дор (байхгүй нь null) @returns {Promise<Map<string, object|null>>} */
    async batchGet(paths) {
      const out = new Map();
      if (!paths.length) return out;
      for (const p of paths) assertDocPath(p);
      const res = await call('POST', `${base}/${root}:batchGet`, { documents: paths.map(full) });
      for (const r of res || []) {
        if (r.found) out.set(rel(r.found.name), toDoc(r.found));
        else if (r.missing) out.set(rel(r.missing), null);
      }
      return out;
    },

    /**
     * Атом бичилт. writes = setWrite/deleteWrite-ийн үр дүн (name нь харьцангуй зам) — энд бүтэн нэр болгоно.
     * @returns {Promise<{ commitTime: string, writeResults: { updateTime?: string }[] }>}
     */
    async commit(writes) {
      if (!writes.length) return { commitTime: '', writeResults: [] };
      if (writes.length > 500) throw new TypeError('Firestore: нэг commit-д 500-аас олон бичилт болохгүй');
      const body = {
        writes: writes.map((w) => {
          const x = { ...w };
          if (x.update) x.update = { ...x.update, name: full(x.update.name) };
          if (x.delete) x.delete = full(x.delete);
          return x;
        }),
      };
      const res = await call('POST', `${base}/${root}:commit`, body);
      return { commitTime: res?.commitTime ?? '', writeResults: res?.writeResults ?? [] };
    },

    /**
     * Нэг collection-ий query. where = [[field, op, value]...] (op: == < <= > >= in), orderBy = [[field, 'asc'|'desc']].
     * parent = дэд collection-ий эх баримт (жишээ: 'messenger_threads/abc').
     */
    async query({ collection, parent = '', where = [], orderBy = [], limit = 50 }) {
      const filters = where.map(([field, op, value]) => {
        if (!OPS[op]) throw new TypeError(`Firestore: дэмжихгүй оператор ${op}`);
        return { fieldFilter: { field: { fieldPath: fieldPath(field) }, op: OPS[op], value: encodeValue(value) } };
      });
      const sq = { from: [{ collectionId: collection }], limit };
      if (filters.length === 1) sq.where = filters[0];
      else if (filters.length > 1) sq.where = { compositeFilter: { op: 'AND', filters } };
      if (orderBy.length) sq.orderBy = orderBy.map(([field, dir]) => ({ field: { fieldPath: fieldPath(field) }, direction: dir === 'desc' ? 'DESCENDING' : 'ASCENDING' }));
      if (parent) assertDocPath(parent);
      const url = `${base}/${parent ? full(parent) : root}:runQuery`;
      const res = await call('POST', url, { structuredQuery: sq });
      return (res || []).filter((r) => r.document).map((r) => toDoc(r.document));
    },
  };
}

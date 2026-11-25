// Тестийн туслах (тест биш): Firestore REST v1-ийн санах ойн хуурамч сервер — `fetch`-ийн оронд тарина.
// api/_lib/firestore.js-ийн ашигладаг endpoint-ууд л: GET doc, :batchGet, :commit (precondition, mask, transform),
// :runQuery (EQUAL / range / IN, orderBy, limit, шууд хүүхэд collection). Утгуудыг Firestore Value хэлбэрээр хадгална.
import { decodeValue } from '../../api/_lib/firestore.js';

const RANGE = { LESS_THAN: (c) => c < 0, LESS_THAN_OR_EQUAL: (c) => c <= 0, GREATER_THAN: (c) => c > 0, GREATER_THAN_OR_EQUAL: (c) => c >= 0 };
const typeOf = (v) => (v === null ? 'null' : v instanceof Date ? 'date' : typeof v);
const cmp = (a, b) => (a instanceof Date ? a.getTime() - b.getTime() : a < b ? -1 : a > b ? 1 : 0);
const unquote = (f) => f.split('.').map((p) => p.replace(/^`|`$/g, '')).join('.');

export function createFakeFirestore({ projectId = 'skinaid-mn' } = {}) {
  const root = `projects/${projectId}/databases/(default)/documents`;
  /** name → { fields, createTime, updateTime } */
  const docs = new Map();
  let clock = Date.parse('2026-11-25T00:00:00Z');
  const tick = () => new Date(++clock).toISOString();
  const calls = [];
  const failNext = [];   // { match: (url) => bool, status, body }

  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const err = (status, st, message = st) => reply(status, { error: { code: status, status: st, message } });
  const out = (name, d) => ({ name, fields: d.fields, createTime: d.createTime, updateTime: d.updateTime });

  function applyTransform(fields, t, now) {
    const f = unquote(t.fieldPath);
    if (t.increment) {
      const cur = decodeValue(fields[f]) || 0;
      const inc = decodeValue(t.increment);
      const n = cur + inc;
      fields[f] = Number.isInteger(n) ? { integerValue: String(n) } : { doubleValue: n };
    } else if (t.setToServerValue) {
      fields[f] = { timestampValue: now };
    } else if (t.appendMissingElements) {
      const cur = fields[f]?.arrayValue?.values ?? [];
      const have = new Set(cur.map((v) => JSON.stringify(v)));
      const add = [];
      for (const v of t.appendMissingElements.values) {
        const k = JSON.stringify(v);
        if (!have.has(k)) { have.add(k); add.push(v); }
      }
      fields[f] = { arrayValue: { values: [...cur, ...add] } };
    }
  }

  function commit(writes) {
    // Precondition-ийг бүгдийг нь эхэлж шалгана (атом)
    for (const w of writes) {
      const name = w.update ? w.update.name : w.delete;
      const cur = docs.get(name);
      const pre = w.currentDocument;
      if (!pre) continue;
      if (pre.exists === false && cur) return err(409, 'ALREADY_EXISTS', `Document already exists: ${name}`);
      if (pre.exists === true && !cur) return err(404, 'NOT_FOUND');
      if (pre.updateTime && (!cur || cur.updateTime !== pre.updateTime)) return err(400, 'FAILED_PRECONDITION');
    }
    const now = tick();
    const results = [];
    for (const w of writes) {
      if (w.delete) {
        docs.delete(w.delete);
        results.push({});
        continue;
      }
      const name = w.update.name;
      const cur = docs.get(name);
      let fields;
      if (w.updateMask) {
        fields = { ...(cur?.fields ?? {}) };
        for (const p of w.updateMask.fieldPaths) {
          const f = unquote(p);
          if (f in w.update.fields) fields[f] = w.update.fields[f];
          else delete fields[f];
        }
      } else {
        fields = { ...w.update.fields };
      }
      for (const t of w.updateTransforms ?? []) applyTransform(fields, t, now);
      docs.set(name, { fields, createTime: cur?.createTime ?? now, updateTime: now });
      results.push({ updateTime: now });
    }
    return reply(200, { commitTime: now, writeResults: results });
  }

  function matches(d, filter) {
    if (!filter) return true;
    if (filter.compositeFilter) return filter.compositeFilter.filters.every((f) => matches(d, f));
    const ff = filter.fieldFilter;
    const v = decodeValue(d.fields[unquote(ff.field.fieldPath)]);
    const want = decodeValue(ff.value);
    if (ff.op === 'EQUAL') return typeOf(v) === typeOf(want) && cmp(v, want) === 0;
    if (ff.op === 'IN') return want.some((x) => typeOf(v) === typeOf(x) && cmp(v, x) === 0);
    if (RANGE[ff.op]) return v !== undefined && typeOf(v) === typeOf(want) && RANGE[ff.op](cmp(v, want));
    throw new Error(`fake: op ${ff.op}`);
  }

  function runQuery(parent, sq) {
    const col = sq.from[0].collectionId;
    const prefix = `${parent}/${col}/`;
    let rows = [...docs.entries()].filter(([n]) => n.startsWith(prefix) && !n.slice(prefix.length).includes('/')).map(([n, d]) => ({ n, d }));
    rows = rows.filter(({ d }) => matches(d, sq.where));
    for (const o of [...(sq.orderBy ?? [])].reverse()) {
      const f = unquote(o.field.fieldPath);
      const dir = o.direction === 'DESCENDING' ? -1 : 1;
      rows = rows.filter(({ d }) => d.fields[f] !== undefined);
      rows.sort((a, b) => {
        const x = decodeValue(a.d.fields[f]);
        const y = decodeValue(b.d.fields[f]);
        if (x === null || y === null) return (x === null ? -1 : 1) * dir;
        return cmp(x, y) * dir;
      });
    }
    rows = rows.slice(0, sq.limit ?? rows.length);
    return reply(200, rows.length ? rows.map(({ n, d }) => ({ document: out(n, d), readTime: tick() })) : [{ readTime: tick() }]);
  }

  async function fetchImpl(url, init = {}) {
    const u = String(url);
    calls.push({ url: u, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.Authorization });
    const f = failNext.findIndex((x) => x.match(u, init));
    if (f >= 0) {
      const x = failNext.splice(f, 1)[0];
      if (x.throw) throw x.throw;
      return reply(x.status, x.body);
    }
    const path = u.replace('https://firestore.googleapis.com/v1/', '');
    const body = init.body ? JSON.parse(init.body) : {};
    if (init.method === 'GET') {
      const d = docs.get(path);
      return d ? reply(200, out(path, d)) : err(404, 'NOT_FOUND');
    }
    if (path === `${root}:batchGet`) return reply(200, body.documents.map((n) => (docs.get(n) ? { found: out(n, docs.get(n)) } : { missing: n })));
    if (path === `${root}:commit`) return commit(body.writes);
    if (path.endsWith(':runQuery')) return runQuery(path.slice(0, -':runQuery'.length), body.structuredQuery);
    throw new Error(`fake firestore: ${init.method} ${u}`);
  }

  return {
    fetchImpl,
    calls,
    failNext,
    root,
    /** Тестэд: харьцангуй замаар уншина (JS утга) */
    read(path) {
      const d = docs.get(`${root}/${path}`);
      return d ? Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, decodeValue(v)])) : null;
    },
    list(prefix) {
      const p = `${root}/${prefix}`;
      return [...docs.keys()].filter((n) => n.startsWith(p)).map((n) => n.slice(root.length + 1));
    },
    /** Тестэд: шууд бичих (JS утга) */
    seed(path, data, encode) {
      docs.set(`${root}/${path}`, { fields: encode(data), createTime: tick(), updateTime: tick() });
    },
  };
}

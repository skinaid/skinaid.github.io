// Messenger AI-ийн архитектурын хамгаалалт (статик): үйлчлүүлэгч рүү ИЛГЭЭХ зам ЦОР ГАНЦ (meta-send.js ← outbound.js ←
// pipeline.js), захиалгын өгөгдөлд хүрэхгүй, SDK-г зөвхөн тодорхой файл импортолно, Vercel-ийн deploy (api/, package.json) эвдрэхгүй.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vercelIgnore } from '../lib/assets.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((n) => {
  const rel = `${dir}/${n}`;
  return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : rel.endsWith('.js') ? [rel] : [];
});
const API = walk('api');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const src = Object.fromEntries(API.map((f) => [f, stripComments(readFileSync(join(ROOT, f), 'utf8'))]));

const SEND = 'api/_lib/social/meta-send.js';
const OUTBOUND = 'api/_lib/outbound.js';
const PIPELINE = 'api/_lib/pipeline.js';
const RUNTIME = 'api/_lib/runtime.js';
/** Файл бүрийн харьцангуй import-ууд → api/-аас эхэлсэн зам */
const localImports = (f) => [...src[f].matchAll(/(?:from\s+|import\()\s*['"](\.[^'"]+)['"]/g)]
  .map((m) => join(f, '..', m[1]).split('\\').join('/'));

test('архитектур: Send API ЗӨВХӨН meta-send.js-д; sender_action, thread control, broadcast хаана ч байхгүй', () => {
  assert.ok(API.length >= 20, 'api/ файлууд олдсонгүй');
  // Хаана ч байж болохгүй (typing/mark_seen, яриаг булаах/дамжуулах, олноор илгээх, хуучин нэртэй илгээх функц)
  const FORBIDDEN = [
    /\bsendText\b/, /\bsendToUser\b/, /sender_action/, /\bsenderAction\b/,
    /\/me\/(?:pass|take|release)_thread_control/, /\bpassThreadControl\b/, /\btakeThreadControl\b/, /\breleaseThreadControl\b/,
    /message_creatives|broadcast_messages|\/me\/message_attachments/, /MESSAGE_TAG|\bmessaging_type:\s*['"`](?:UPDATE|MESSAGE_TAG)/,
  ];
  // Зөвхөн meta-send.js-д байж болно
  const SEND_ONLY = [/\/me\/messages/, /messaging_type/, /template_type/];
  for (const [f, s] of Object.entries(src)) {
    for (const re of FORBIDDEN) assert.ok(!re.test(s), `${f}: ${re}`);
    if (f !== SEND) for (const re of SEND_ONLY) assert.ok(!re.test(s), `${f}: ${re} — илгээх хүсэлт зөвхөн meta-send.js-д`);
  }
  // Илгээх хүсэлт бүр RESPONSE (24 цагийн цонх) — өөр төрөл байхгүй
  assert.deepEqual([...src[SEND].matchAll(/messaging_type:\s*['"`](\w+)['"`]/g)].map((m) => m[1]), ['RESPONSE']);
  assert.equal((src[SEND].match(/\/me\/messages/g) || []).length, 1);
  // Graph-ийн host зөвхөн meta-client.js-д (GRAPH_BASE); meta-send.js түүнийг импортолно
  for (const [f, s] of Object.entries(src)) {
    if (f.endsWith('social/meta-client.js')) continue;
    assert.ok(!/graph\.facebook\.com/.test(s), `${f}: Graph-д хандаж байна`);
  }
  assert.ok(!/['"`]POST['"`]\s*,\s*`\/me\b/.test(src['api/_lib/social/meta-client.js']));
  // Token зөвхөн Authorization толгойд (URL-д access_token параметр байхгүй)
  for (const [f, s] of Object.entries(src)) assert.ok(!/access_token/.test(s), `${f}: access_token (URL/биед token)`);
});

test('архитектур: илгээх ЦОР ГАНЦ зам — meta-send.js ← outbound.js ← (runtime.js холбоно) ← pipeline.js; агент, admin, cron илгээхгүй', () => {
  const importers = (target) => API.filter((f) => localImports(f).includes(target));
  assert.deepEqual(importers(SEND), [OUTBOUND], 'meta-send.js-ийг зөвхөн outbound.js импортолно');
  assert.deepEqual(importers(OUTBOUND), [RUNTIME], 'outbound.js-ийг зөвхөн runtime.js (холболт) импортолно');
  for (const [f, s] of Object.entries(src)) {
    if (f !== SEND && f !== OUTBOUND) assert.ok(!/\bcreateMetaSender\b/.test(s), `${f}: createMetaSender`);
    if (f !== OUTBOUND && f !== RUNTIME) assert.ok(!/\bcreateOutbound\b/.test(s), `${f}: createOutbound`);
    // sendGuarded-ийг зөвхөн pipeline.js дуудна (outbound.js тодорхойлно)
    if (f !== OUTBOUND && f !== PIPELINE) assert.ok(!/\bsendGuarded\b/.test(s), `${f}: sendGuarded`);
    // Илгээлтийн бүртгэлийг зөвхөн outbound.js бичнэ (store.js тодорхойлно)
    if (f !== OUTBOUND && f !== 'api/_lib/store.js') assert.ok(!/\b(?:claimOutbound|finishOutbound|markSendSkipped)\b/.test(s), `${f}: илгээлтийн бүртгэл`);
  }
  // runtime.js outbound-ийг ЗӨВХӨН pipeline-д өгнө (агент, admin, cron-д хүрэхгүй): cached-д гаргахгүй
  assert.match(src[RUNTIME], /createPipeline\(\{[^}]*\boutbound\b[^}]*\}\)/);
  assert.ok(!/cached = \{[^}]*\boutbound\b/.test(src[RUNTIME]), 'outbound-ийг runtime-ын бусад хэрэглэгчид (admin, cron) ил гаргахгүй');
  for (const f of ['api/_lib/agent.js', 'api/_lib/admin-api.js', 'api/_lib/cron.js', 'api/_lib/crisis.js', 'api/_lib/eval.js', 'api/_lib/knowledge.js', 'api/admin.js', 'api/cron/daily.js']) {
    assert.ok(!/\boutbound\b/i.test(src[f].replace(/COL\.outbound/g, '')), `${f}: outbound-д хүрч байна`);
  }
  // Хүлээн авагч (PSID) зөвхөн webhook → pipeline → outbound (санах ойд): гацсан event-ийн нөхөлт, cron-д байхгүй
  assert.match(src[PIPELINE], /async function sweepStale[\s\S]*?await processThread\(h, \{ deadline \}\);/, 'sweepStale recipient-гүй дуудна');
  assert.ok(!/recipient/.test(src['api/_lib/cron.js']));
  assert.ok(!/recipient/.test(src['api/_lib/store.js']), 'store.js хүлээн авагчийг хэзээ ч хүлээж авахгүй (хадгалахгүй)');
  assert.ok(!/recipient/.test(src['api/_lib/agent.js']), 'агент хүлээн авагчийг мэдэхгүй');
  // Илгээхийн өмнө: тохиргоог дахин уншина → эзэмшинэ (claimOutbound) → илгээнэ — энэ дарааллаар
  const o = src[OUTBOUND];
  const at = (re) => { const i = o.search(re); assert.ok(i >= 0, String(re)); return i; };
  assert.ok(at(/store\.readSettings\(\)/) < at(/store\.claimOutbound\(/));
  assert.ok(at(/store\.claimOutbound\(/) < at(/await send\(\{/));
  assert.equal((o.match(/await send\(\{/g) || []).length, 1, 'нэг л илгээх дуудлага (дахин оролдлого, давталтгүй)');
  assert.ok(!/console\.(?:log|warn|error)\([^)]*(?:recipient|text|token)/i.test(o + src[SEND]), 'PSID, текст, token-ийг логлохгүй');
});

test('архитектур: захиалгын (bookings) өгөгдөлд хүрэхгүй; PSID-г хадгалахгүй (psidHash л)', () => {
  for (const [f, s] of Object.entries(src)) {
    if (f.endsWith('guardrails.js')) continue;   // LLM_FORBIDDEN_SOURCES жагсаалт
    assert.ok(!/['"`/]bookings['"`/]/.test(s), `${f}: bookings collection`);
  }
  // store.js-д psid (hash-гүй) талбар бичигдэхгүй
  assert.ok(!/\bpsid\s*:/.test(src['api/_lib/store.js']));
  assert.ok(!/\.psid\b/.test(src['api/_lib/store.js']));
});

test('архитектур: SDK/сангийн import — Anthropic зөвхөн claude.js, GCP зөвхөн gcp-auth.js, @vercel/functions зөвхөн entry', () => {
  const importsOf = (s) => [...s.matchAll(/(?:from\s+|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const [f, s] of Object.entries(src)) {
    for (const spec of importsOf(s)) {
      if (spec.startsWith('.') || spec.startsWith('node:')) continue;
      const allowed = {
        '@anthropic-ai/sdk': ['api/_lib/claude.js'],
        'google-auth-library': ['api/_lib/gcp-auth.js'],
        '@vercel/oidc': ['api/_lib/gcp-auth.js'],
        '@vercel/functions': ['api/messenger.js'],
      }[spec];
      assert.ok(allowed, `${f}: зөвшөөрөөгүй сан ${spec}`);
      assert.ok(allowed.includes(f), `${f}: ${spec}-г энд импортлохгүй`);
    }
  }
  // claude.js, gcp-auth.js нь сангуудаа lazy import()-оор ачаална (тест npm install-гүй ажиллана)
  assert.ok(!/^import .*@anthropic-ai\/sdk/m.test(src['api/_lib/claude.js']));
  assert.ok(!/^import .*google-auth-library/m.test(src['api/_lib/gcp-auth.js']));
  for (const dep of ['@anthropic-ai/sdk', '@vercel/functions', '@vercel/oidc', 'google-auth-library']) {
    assert.ok(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies[dep], dep);
  }
});

test('архитектур: import() зөвхөн тогтмол нэрээр — Vercel-ийн bundler (nft) хувьсагчтай import-ийг функцийн багцад оруулдаггүй', () => {
  // 2026-11-26: gcp-auth.js/claude.js `import(name)` → production-д google-auth-library багцад ороогүй, cron 500
  for (const [f, s] of Object.entries(src)) {
    for (const m of s.matchAll(/\bimport\s*\(([^)]*)\)/g)) {
      assert.match(m[1].trim(), /^(['"])[^'"]+\1$/, `${f}: import(${m[1].trim()}) — тогтмол нэр биш (production-д модуль олдохгүй)`);
    }
  }
  const deps = Object.keys(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies);
  const imported = new Set(Object.values(src).flatMap((s) => [...s.matchAll(/(?:from\s+|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1])));
  for (const d of deps) assert.ok(imported.has(d), `${d}: api/**-д тогтмол нэрээр импортлогдоогүй — функцийн багцад орохгүй`);
});

test('сан: npm install хийсэн бол бодит API манай хэрэглээтэй таарна', {
  skip: !existsSync(join(ROOT, 'node_modules/google-auth-library')) && 'node_modules алга (npm install хийгээгүй)',
}, async () => {
  const gal = await import('google-auth-library');
  assert.equal(typeof gal.ExternalAccountClient.fromJSON, 'function');
  assert.equal(typeof gal.JWT, 'function');
  const oidc = await import('@vercel/oidc');
  assert.equal(typeof oidc.getVercelOidcToken, 'function');
  const SDK = (await import('@anthropic-ai/sdk')).default;
  assert.equal(typeof new SDK({ apiKey: 'test-not-real' }).beta.messages.create, 'function');
  const fns = await import('@vercel/functions');
  assert.equal(typeof fns.waitUntil, 'function');
});

test('архитектур: Claude-д зураг/видео/дуу явахгүй — хүсэлтэд зөвхөн текст (image/document блокгүй)', () => {
  const c = src['api/_lib/claude.js'] + src['api/_lib/social/prompt.js'];
  assert.ok(!/type:\s*['"](?:image|document)['"]/.test(c));
  assert.ok(!/base64|fbcdn|payload\.url/.test(c));
});

test('deploy: .vercelignore api/, package.json-ийг хаадаггүй; package.json-д build script алга (статик сайт хэвээр)', () => {
  const ignored = vercelIgnore(ROOT);
  for (const f of ['api/messenger.js', 'api/cron/daily.js', 'api/_lib/store.js', 'package.json', 'package-lock.json']) {
    assert.equal(ignored(f), false, f);
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.private, true);
  assert.ok(!pkg.scripts?.build && !pkg.scripts?.['vercel-build'], 'build script Vercel-ийн статик output-ийг өөрчилнө');
  assert.ok(existsSync(join(ROOT, 'package-lock.json')));
  const v = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  for (const fn of Object.keys(v.functions)) assert.ok(existsSync(join(ROOT, fn)), fn);
  assert.equal(v.functions['api/messenger.js'].maxDuration, 60);
  assert.deepEqual(v.crons, [{ path: '/api/cron/daily', schedule: '0 20 * * *' }]);
  assert.match(readFileSync(join(ROOT, '.gitignore'), 'utf8'), /^\/node_modules\/$/m);
  // api/-ийн доорх entry (Vercel функц) = зөвхөн эдгээр; туслах код «_»-тай хавтсанд
  assert.deepEqual(API.filter((f) => !relative('api', f).split('/').some((p) => p.startsWith('_'))).sort(), ['api/admin.js', 'api/content-image.js', 'api/cron/daily.js', 'api/messenger.js']);
  assert.equal(v.functions['api/admin.js'].maxDuration, 60);
});

test('нууц: api/**-д нууцын утга, түлхүүрийн хэлбэр алга; env-ийн утгыг логлохгүй', () => {
  for (const [f, s] of Object.entries(src)) {
    assert.ok(!/sk-ant-[A-Za-z0-9_-]{10,}|EAA[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(s), f);
    assert.ok(!/console\.(?:log|warn|error)\([^)]*process\.env/.test(s), `${f}: env-ийг логлож байна`);
    assert.ok(!/console\.log\(/.test(s), `${f}: console.log (body/текст алдагдах эрсдэл) — log()/console.warn тогтмол мессежтэй`);
  }
});

// Messenger AI-ийн архитектурын хамгаалалт (статик): 1-р үе шатанд үйлчлүүлэгч рүү ИЛГЭЭХ зам огт байхгүй, захиалгын
// өгөгдөлд хүрэхгүй, SDK-г зөвхөн тодорхой файл импортолно, Vercel-ийн deploy (api/, package.json) эвдрэхгүй.
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

test('архитектур: api/**-д Send API, илгээх функц ОГТ байхгүй (1-р үе шат — сүүдэр)', () => {
  assert.ok(API.length >= 20, 'api/ файлууд олдсонгүй');
  const FORBIDDEN = [
    /\/me\/messages/, /\bsendText\b/, /\bsendToUser\b/, /sender_action/, /\bsenderAction\b/, /messaging_type/,
    /\/me\/(?:pass|take|release)_thread_control/, /\bpassThreadControl\b/, /\btakeThreadControl\b/, /\breleaseThreadControl\b/,
    /message_creatives|broadcast_messages|\/me\/message_attachments/,
  ];
  for (const [f, s] of Object.entries(src)) {
    for (const re of FORBIDDEN) assert.ok(!re.test(s), `${f}: ${re}`);
  }
  // Graph руу хандах цорын ганц газар = meta-client.js (getPage, subscribed_apps)
  for (const [f, s] of Object.entries(src)) {
    if (f.endsWith('social/meta-client.js')) continue;
    assert.ok(!/graph\.facebook\.com/.test(s), `${f}: Graph-д хандаж байна`);
  }
  assert.ok(!/['"`]POST['"`]\s*,\s*`\/me\b/.test(src['api/_lib/social/meta-client.js']));
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
  assert.deepEqual(API.filter((f) => !relative('api', f).split('/').some((p) => p.startsWith('_'))).sort(), ['api/cron/daily.js', 'api/messenger.js']);
});

test('нууц: api/**-д нууцын утга, түлхүүрийн хэлбэр алга; env-ийн утгыг логлохгүй', () => {
  for (const [f, s] of Object.entries(src)) {
    assert.ok(!/sk-ant-[A-Za-z0-9_-]{10,}|EAA[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(s), f);
    assert.ok(!/console\.(?:log|warn|error)\([^)]*process\.env/.test(s), `${f}: env-ийг логлож байна`);
    assert.ok(!/console\.log\(/.test(s), `${f}: console.log (body/текст алдагдах эрсдэл) — log()/console.warn тогтмол мессежтэй`);
  }
});

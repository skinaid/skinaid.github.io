#!/usr/bin/env node
// Messenger AI — бодит Claude-тэй eval (локал). МӨНГӨ ЗАРЦУУЛНА: ажиллуулахаас өмнө эзэмшигчийн зөвшөөрөл ба --dry-run-ийн тооцоо.
//
//   node tools/evals/messenger-live.mjs --dry-run                 # кейсийн тоо, ойролцоо зардал (API дуудахгүй)
//   ANTHROPIC_API_KEY=… node tools/evals/messenger-live.mjs --limit 10 --max-usd 1
//   node tools/evals/messenger-live.mjs --only greeting,hours --compare .preview/evals/<өмнөх>.json
//
// Түлхүүрийг ЗӨВХӨН shell-ийн env-ээр (файл, чат, git-д хэзээ ч бүү бич). npm install шаардлагатай (@anthropic-ai/sdk).
// Мэдлэг = сайтын анхдагч каталог (assets/js/catalog-defaults.js) + тогтмол ажлын цаг — production-ийн FAQ/жишээ ОРОХГҮЙ.
// Production-ийн мэдлэгтэй eval = admin → Messenger AI → Сургалт → Eval (серверийн түлхүүрээр, сарын хязгаарт тоологдоно).
// Тайлан: .preview/evals/<огноо>.json (gitignore — нийтийн repo-д орохгүй).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildKnowledge } from '../../api/_lib/knowledge.js';
import { buildSocialRequest } from '../../api/_lib/social/prompt.js';
import { decideReply, parseProposal } from '../../api/_lib/social/policy.js';
import { redactForLlm } from '../../api/_lib/guardrails.js';
import { createClaudeCaller, costMicroUsd } from '../../api/_lib/claude.js';
import { compareRuns, gradeCase, summarize, userTextOf } from '../../api/_lib/eval.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, def = null) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : def; };
const flag = (name) => process.argv.includes(name);

const cases = readFileSync(join(ROOT, 'tools/evals/messenger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const only = arg('--only') ? new Set(arg('--only').split(',')) : null;
const selected = cases.filter((c) => !only || only.has(c.id)).slice(0, Number(arg('--limit', cases.length)));
const maxUsd = Number(arg('--max-usd', '5'));
const concurrency = Math.min(8, Math.max(1, Number(arg('--concurrency', '4'))));
/** Нэг кейсийн ойролцоо зардал (кэштэй 6–9K оролт + 300–800 гаралт/бодол, claude-opus-5-5) */
const EST_USD = 0.02;

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(ROOT, 'assets/js/catalog-defaults.js'), 'utf8'), sandbox);
const D = sandbox.window.SKINAID_DEFAULTS;
const k = buildKnowledge({ site: { hours: 'Өдөр бүр 09:00-19:00', promoEnabled: true }, catalog: { services: D.treatments, packages: D.packages }, kb: [], examples: [] }, { pages: [] });

console.log(`${selected.length} кейс (нийт ${cases.length}), зэрэг ${concurrency}, дээд зардал $${maxUsd}; ойролцоо зардал ≈ $${(selected.length * EST_USD).toFixed(2)}`);
if (flag('--dry-run')) process.exit(0);
if (!/^sk-ant-/.test(process.env.ANTHROPIC_API_KEY || '')) {
  console.error('ANTHROPIC_API_KEY (sk-ant-…) shell-д тавиагүй байна.');
  process.exit(1);
}

const call = createClaudeCaller({ log: (m) => console.warn(m) });
const results = [];
let spent = 0;
let stopped = false;
async function runOne(c) {
  if (stopped) return;
  const turns = c.turns.map((t) => ({ role: t.role, text: redactForLlm(t.text), attachments: [] }));
  const userText = userTextOf({ turns });
  const req = buildSocialRequest({ catalog: k.catalog, examples: k.examples, turns });
  const t0 = Date.now();
  const r = await call(req);
  const cost = costMicroUsd(r.model, r.usage);
  spent += cost;
  if (spent / 1e6 >= maxUsd) stopped = true;
  if (r.status === 'error') { results.push({ id: c.id, tags: c.tags, pass: false, why: 'error', error: r.code, costMicroUsd: cost }); return; }
  const p = r.status === 'ok' ? parseProposal(r.text) : null;
  if (!p) { results.push({ id: c.id, tags: c.tags, pass: c.expect.handoff !== false, why: c.expect.handoff !== false ? '' : r.status, route: 'handoff', reasons: [r.status], costMicroUsd: cost }); return; }
  const d = decideReply({ mode: 'shadow', conversationState: 'bot', userText, proposal: p, knownSourceIds: k.catalog.facts.map((f) => f.id), allowedAmounts: k.catalog.allowedAmounts, allowedPercents: k.catalog.allowedPercents, knownNumbers: k.catalog.knownNumbers, knowledgeText: k.catalog.knowledgeText, facts: k.catalog.facts });
  const g = gradeCase(c, d, p.reply);
  results.push({ id: c.id, tags: c.tags, ...g, route: d.route, intent: d.intent, reasons: d.reasons, reply: p.reply.slice(0, 300), ms: Date.now() - t0, costMicroUsd: cost });
}
const queue = [...selected];
await Promise.all(Array.from({ length: concurrency }, async () => { while (queue.length && !stopped) await runOne(queue.shift()); }));

const sum = summarize(results);
const out = arg('--out', join(ROOT, '.preview/evals', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), summary: sum, results }, null, 1));
console.log(`Тэнцсэн ${sum.pass}/${sum.done} (${sum.passRate}%), эрсдэлтэй ${sum.risky.pass}/${sum.risky.total}, зохиосон ${sum.invented}, алдаа ${sum.errors}, зардал $${(sum.costMicroUsd / 1e6).toFixed(3)}${stopped ? ' — дээд зардалд хүрч зогслоо' : ''}`);
for (const r of results.filter((x) => !x.pass)) console.log(`  ✗ ${r.id}: ${r.why}${r.error ? ` (${r.error})` : ''} — ${r.route || ''} ${r.intent || ''}`);
if (arg('--compare')) {
  const prev = JSON.parse(readFileSync(arg('--compare'), 'utf8'));
  const cmp = compareRuns(Object.fromEntries(prev.results.map((r) => [r.id, r.pass])), Object.fromEntries(results.map((r) => [r.id, r.pass])));
  console.log(`Шинээр унасан: ${cmp.newlyFailing.join(', ') || '—'}; шинээр тэнцсэн: ${cmp.newlyPassing.join(', ') || '—'}`);
}
console.log(`Тайлан: ${out}`);

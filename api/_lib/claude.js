/**
 * Messenger AI — Claude дуудлага (Anthropic Messages API, `@anthropic-ai/sdk`). Энэ файл л SDK-г импортолно
 * (tools/test/messenger-architecture.test.mjs). SDK-г lazy `import()` хийнэ — тестүүд хуурамч клиент тарьна.
 *
 *   · Модель `claude-opus-5-5`, effort `low` (Opus 5.5-д thinking унтраах боломжгүй, анхдагч `medium` тул тодорхой заана).
 *   · Structured output: `output_config.format` = prompt.js SOCIAL_OUTPUT_SCHEMA (json_schema).
 *   · Prompt caching: system-ийн 2 блок `cache_control: ephemeral` (prompt.js). `usage.cache_read_input_tokens`-оор шалгана.
 *   · Refusal: server-side `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) — татгалзвал Anthropic-ийн
 *     санал болгосон моделиор дахин оролдоно; бүх гинж татгалзвал `stop_reason: "refusal"` → policy хүнд шилжүүлнэ.
 *   · Нууц: ANTHROPIC_API_KEY-г SDK env-ээс уншина; лог, алдааны кодонд хэзээ ч гаргахгүй.
 */
import { SOCIAL_OUTPUT_SCHEMA } from './social/prompt.js';

export const MESSENGER_MODEL = 'claude-opus-5-5';
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** $/1M токен (2026-11, claude-api skill). Fallback моделиуд тусдаа үнэтэй; мэдэгдэхгүй бол хамгийн өндрийг авна. */
export const PRICES = Object.freeze({
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
});
const MAX_PRICE = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

/** usage → зардал (микро-доллар, бүхэл) */
export function costMicroUsd(model, usage) {
  const p = PRICES[model] ?? MAX_PRICE;
  const u = usage || {};
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const usd = (n(u.input_tokens) * p.input + n(u.output_tokens) * p.output
    + n(u.cache_read_input_tokens) * p.cacheRead + n(u.cache_creation_input_tokens) * p.cacheWrite) / 1e6;
  return Math.round(usd * 1e6);
}

/** API-ийн хүсэлтийн бие (цэвэр функц — тест шалгана) */
export function buildParams(req, model = MESSENGER_MODEL) {
  return {
    model,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SOCIAL_OUTPUT_SCHEMA } },
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
  };
}

/**
 * @typedef {{ status: 'ok', text: string, model: string, usage: any }
 *   | { status: 'refusal', category: string|null, model: string, usage: any }
 *   | { status: 'error', code: string, model: string, usage: any }} ClaudeResult
 */

/**
 * @param {{ client?: any, importer?: (name: string) => Promise<any>, model?: string }} [opts]
 * @returns {(req: { system: any[], user: string }) => Promise<ClaudeResult>}
 */
export function createClaudeCaller(opts = {}) {
  const model = opts.model ?? MESSENGER_MODEL;
  let client = opts.client ?? null;
  let SDK = null;
  const importer = opts.importer ?? ((name) => import(name));

  return async function callClaude(req) {
    try {
      if (!client) {
        SDK = (await importer('@anthropic-ai/sdk')).default;
        // Webhook-ийн waitUntil maxDuration (60 с) дотор багтаана: 1 дахин оролдлого, 25 с timeout
        client = new SDK({ maxRetries: 1, timeout: 25_000 });
      }
      const res = await client.beta.messages.create(buildParams(req, model));
      const usage = res.usage ?? null;
      const used = String(res.model || model);
      if (res.stop_reason === 'refusal') return { status: 'refusal', category: res.stop_details?.category ?? null, model: used, usage };
      if (res.stop_reason === 'max_tokens') return { status: 'error', code: 'max_tokens', model: used, usage };
      const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      return { status: 'ok', text, model: used, usage };
    } catch (e) {
      // Алдааны мессежийг хадгалахгүй (хүсэлтийн агуулга орж болзошгүй) — зөвхөн төрөл/код
      const status = Number(e?.status);
      const code = Number.isFinite(status) && status > 0 ? `api_${status}` : e?.name === 'APIConnectionTimeoutError' ? 'timeout' : 'network';
      return { status: 'error', code, model, usage: null };
    }
  };
}

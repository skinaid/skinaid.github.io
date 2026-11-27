/**
 * Жинхэнэ deps-ийг холбоно (нэг инстанст нэг удаа): GCP эрх → Firestore REST → store → мэдлэг, Claude → агент → pipeline
 * (+ outbound: «Автомат» горимд илгээх цор ганц зам).
 * webhook, cron, admin (api/admin.js — мэдлэг, агентыг шууд ашиглана) хуваалцана.
 * Серверийн эрх тохируулаагүй бол null (webhook 200 буцааж логлоно, cron 503).
 */
import { createGcpAuth } from './gcp-auth.js';
import { createFirestore } from './firestore.js';
import { createStore } from './store.js';
import { createKnowledge } from './knowledge.js';
import { createClaudeCaller } from './claude.js';
import { createAgent } from './agent.js';
import { createCrisisGuard } from './crisis.js';
import { createPipeline } from './pipeline.js';
import { createOutbound } from './outbound.js';
import { metaConfig } from './social/meta-config.js';
import { SOCIAL_PROMPT_VERSION } from './social/prompt.js';

let cached;

export function getRuntime(env = process.env) {
  if (cached !== undefined) return cached;
  const auth = createGcpAuth({ env });
  if (!auth.mode) {
    cached = null;
    return cached;
  }
  const fs = createFirestore({ projectId: auth.projectId, getAccessToken: () => auth.getAccessToken() });
  const store = createStore(fs);
  const knowledge = createKnowledge(store);
  // «Буруу» үнэлгээг ОДООГИЙН prompt-ийн хувилбартай ноорогт л тооцно (crisis.js)
  const guard = createCrisisGuard({ store, promptVersion: SOCIAL_PROMPT_VERSION });
  const agent = createAgent({ store, knowledge, callClaude: createClaudeCaller(), env, guard });
  // Илгээх цор ганц зам — зөвхөн pipeline-д (webhook-ийн боловсруулалт); admin-ийн туршилт/eval, cron-д өгөхгүй
  const outbound = createOutbound({ store, env });
  const pipeline = createPipeline({ store, agent, outbound, ownAppId: metaConfig(env).appId });
  cached = { store, pipeline, knowledge, agent, guard };
  return cached;
}

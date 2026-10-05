// Local adapter seam, NOT connected to stock runtime's whole-executor revision path.
import type { AgentContext, AgentObservation } from '@eris/sdk';
import { createAgent, createLiveAgent, PARAMS } from './v5.js';
import { createPolicyGate } from './policy.js';

export function createPilot(options: { frozen?: boolean; now?: () => number } = {}) {
  const gate = createPolicyGate(options.frozen ?? false);
  const core = createAgent(PARAMS, options.now, gate.params);
  const live = createLiveAgent(PARAMS, options.now, gate.params);
  // One driver must choose either sync replay or live for its lifetime, not mix them.
  return {
    gate,
    decide(obs: AgentObservation) { gate.observe(obs); return core(obs); },
    async decideLive(obs: AgentObservation, ctx?: AgentContext) {
      gate.observe(obs); return live(obs, ctx);
    },
  };
}

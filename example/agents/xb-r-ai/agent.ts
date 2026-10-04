// Stock runtime cannot enforce H1: refuse ON at module load, before any revision.
// A local trusted adapter must import engine.ts directly and keep its source fixed.
import { createPilot } from './engine.js';

if (process.env.ERIS_AGENT_FROZEN !== '1') {
  throw new Error('xb-r-ai: stock revision ON is unsupported; H1 requires a trusted data-only adapter');
}
export const decide = createPilot({ frozen: true }).decideLive;

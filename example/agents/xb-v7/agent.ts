import { createAgent, type Params } from "../xb-core/agent.js";

export const PARAMS: Params = Object.freeze({
  A_EDGE_BPS: 60,
  BID_MODE: "budget10",
  SIZ_MODE: "depth",
  INV_BAND: 0.2,
  MOD: "none",
  GATE: "pause new risk 3 blocks when fair moved >=75bps in one step, recoveries continue",
});

export const decide = createAgent(PARAMS);

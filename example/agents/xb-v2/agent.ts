import { createAgent, type Params } from "../xb-core/agent.js";

export const PARAMS: Params = Object.freeze({
  A_EDGE_BPS: 60,
  BID_MODE: "competitor+0.1gwei capped by the same 10% budget",
  SIZ_MODE: "depth",
  INV_BAND: 0.2,
  MOD: "none",
  GATE: "off",
});

export const decide = createAgent(PARAMS);

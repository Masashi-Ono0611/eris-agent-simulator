import { createAgent, type Params } from "../xb-core/agent.js";

export const PARAMS: Params = Object.freeze({
  A_EDGE_BPS: 20,
  BID_MODE: "budget10",
  SIZ_MODE: "depth",
  INV_BAND: 0.2,
  MOD: "none",
  GATE: "off",
});

export const decide = createAgent(PARAMS);

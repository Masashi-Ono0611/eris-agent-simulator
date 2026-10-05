import { createAgent, type Params } from "../xb-core/agent.js";

export const PARAMS: Params = Object.freeze({
  A_EDGE_BPS: 60,
  BID_MODE: "budget10",
  SIZ_MODE: "depth",
  INV_BAND: 0.2,
  MOD: "liquity-liquidate-redeem capped 1200 USDC with safe exit",
  GATE: "off",
});

export const decide = createAgent(PARAMS);

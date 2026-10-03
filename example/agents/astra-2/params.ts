// Fixed defaults; no environment-variable configuration or unseeded randomness.
export const PARAMS = {
  arbMarginBps: 55, arbMaxUsd: 1500, arbFractionBps: 900,
  singleMaxUsd: 700, singleFractionBps: 450, slippageBps: 45,
  shockBps: 180, shockWaitBlocks: 3,
  redemptionMarginBps: 100, redemptionExitBps: 65, redemptionMaxUsd: 1200,
  specialtyCloseBlocks: 30, entryStopBlocks: 60,
  daiMaxUsd: 350, daiRecoveryBps: 20, daiStopBps: 70, daiHoldBlocks: 18,
  launchMaxUsd: 250, launchTotalUsd: 750, launchReserveBps: 100,
  launchFlowBps: 25, launchHoldBlocks: 20, launchExitBlocks: 24,
  launchStopBps: 800, launchTrailBps: 500, launchTakeBps: 1000,
  launchEntrySlippageBps: 600, launchExitSlippageBps: 900,
  rpcTimeoutMs: 180, rpcMaxCalls: 18,
} as const;

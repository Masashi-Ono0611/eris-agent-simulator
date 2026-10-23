// Three bounded fixes: launch allowance (1), independent bundle funding (2), attributable WETH recovery (4).
// ascon-zeta-r3k: r3 plus the K1-K3 delta changes (delta.ts, brake.ts); dispatch order unchanged.
import type { AgentAction, AgentContext, AgentObservation } from "@eris/sdk";
import { TOKENS } from "@eris/sdk/constants.js";
import { M_OU_ENABLED, submitOu, ouClosingReserve, baseFitsOuReserve, ouBudget, intentLogOffset, intentOutcome, type IntentEvidence } from "./ou.js";
import { k2Observe } from "./brake.js";
import { decide as deltaDecide, K2_BUNDLE_BRAKE, recoveryBidFee } from "./delta.js";
import { quoteLaunch } from "./launchSwap.js";
import { decide as launchDecide, resetLaunchState } from "./launch.js";

type Params = { launch: boolean; redemption: boolean; stabilityPool: boolean };
const DEFAULTS: Params = { launch: true, redemption: true, stabilityPool: true };
export function parseZetaParams(raw: string | undefined): Params {
  const out = { ...DEFAULTS };
  try {
    const v: unknown = raw ? JSON.parse(raw) : undefined;
    if (!v || typeof v !== "object" || Array.isArray(v)) return out;
    for (const k of Object.keys(out) as (keyof Params)[])
      if (typeof (v as Record<string, unknown>)[k] === "boolean") out[k] = (v as Record<string, boolean>)[k];
  } catch { /* retain safe defaults */ }
  return out;
}
const PARAMS: Params = { ...DEFAULTS };
const MIN_USDC = 200n * 10n ** 6n, MIN_EUSD = 200n * 10n ** 18n;
const EXIT_COST_BPS = 35, ENDGAME_BLOCKS = 20;
let initialEth: bigint | undefined, initialWeth: bigint | undefined;
let lastBlock: number | undefined;
let wrapPending: { weth: bigint; eth: bigint; amount: bigint; evidence: IntentEvidence } | undefined;
let recoveryWeth = 0n;
let recoverySellPending: { weth: bigint; amount: bigint; evidence: IntentEvidence } | undefined;
const noop = (reason: string) => ({ type: "noop", reason });

export async function decideWithParams(obs: AgentObservation, params: Params, ctx: AgentContext, closingReserveWei = 0n): Promise<AgentAction | Record<string, unknown> | null> {
  try {
    const liq = obs.protocols.liquity, remaining = obs.blocksRemaining ?? Number.POSITIVE_INFINITY;
    const block = Number(obs.blockNumber);
    if (Number.isSafeInteger(block) && lastBlock !== undefined && (block < lastBlock || block > lastBlock + 1)) {
      initialEth = undefined; initialWeth = undefined; wrapPending = undefined; recoveryWeth = 0n; recoverySellPending = undefined; resetLaunchState();
    }
    if (Number.isSafeInteger(block)) lastBlock = block;
    const fee = obs.limits.defaultPriorityFeePerGasWei;
    const usdc = BigInt(obs.balances.usdcUnits || "0"), eusd = BigInt(liq?.eusdBalanceWei || "0");
    const weth = BigInt(obs.balances.wethWei || "0"), eth = BigInt(obs.balances.ethWei || "0");
    initialEth ??= eth; initialWeth ??= weth;
    const canSwap = obs.enabledProtocols.includes("uniswap");
    recovery: if (liq && params.redemption && canSwap) {
      // Recovery owns only WETH observed after our exact wrap. Ordinary delta buys
      // never become recovery inventory merely by exceeding the initial anchor.
      if (wrapPending || recoverySellPending || recoveryWeth > 0n || eth > initialEth! + 10n ** 16n) {
        const address = obs.agentAddress as `0x${string}`;
        const nonces = await Promise.all([
          ctx.publicClient.getTransactionCount({ address, blockTag: "latest" }),
          ctx.publicClient.getTransactionCount({ address, blockTag: "pending" }),
        ]).catch(() => undefined);
        if (!nonces || nonces[0] !== nonces[1]) break recovery;
        if (wrapPending) {
          const outcome = await intentOutcome(ctx, obs, wrapPending.evidence);
          if (outcome === "rejected" || outcome === "reverted") {
            wrapPending = undefined;
            break recovery; // Give liquidation/SP/delta this turn before any retry.
          }
          if (weth === wrapPending.weth + wrapPending.amount && eth <= wrapPending.eth - wrapPending.amount)
            recoveryWeth += wrapPending.amount;
          else if (weth === wrapPending.weth && eth >= wrapPending.eth - wrapPending.amount)
            break recovery;
          // Ambiguous balance changes are not attributed to recovery.
          wrapPending = undefined;
        }
        if (recoverySellPending) {
          const outcome = await intentOutcome(ctx, obs, recoverySellPending.evidence);
          if (outcome === "rejected" || outcome === "reverted") {
            recoverySellPending = undefined;
            break recovery; // Keep attributed inventory for a later retry.
          }
          if (weth === recoverySellPending.weth) break recovery;
          recoveryWeth = 0n; recoverySellPending = undefined;
        }
        const excessWeth = recoveryWeth < weth ? recoveryWeth : weth;
        if (excessWeth >= 10n ** 16n) {
          const pool = obs.protocols.uniswap?.pool;
          if (!pool) return noop("recovery quote unavailable");
          const quoted = await quoteLaunch(ctx.publicClient, { tokenIn: TOKENS.WETH.address,
            tokenOut: TOKENS.USDC.address, fee: pool.fee, amountIn: excessWeth });
          const fairValue = Number(excessWeth) / 1e18 * obs.fairPriceUsdcPerWeth;
          // Keep recovery execution within the existing 35bps exit-cost reserve.
          const remainingEdge = Number(quoted) / 1e6 / fairValue - 1 + EXIT_COST_BPS / 10000;
          const priority = recoveryBidFee(obs, remainingEdge, fairValue, false);
          if (quoted <= 0n || priority === null) return noop("recovery quote/cost not competitive");
          const action = { type: "swap", tokenIn: "WETH", amountIn: excessWeth.toString(), slippageBps: 100, maxPriorityFeePerGasWei: priority };
          recoverySellPending = { weth, amount: excessWeth,
            evidence: { sentBlock: block, logOffset: intentLogOffset(ctx), action } };
          return action;
        }
      }
      let reserve = initialEth! > BigInt(liq.suggestedGasReserveWei) ? initialEth! : BigInt(liq.suggestedGasReserveWei);
      if (closingReserveWei > reserve) reserve = closingReserveWei;
      if (eth > reserve + 10n ** 16n) {
        const action = { type: "rawTx", tx: { to: TOKENS.WETH.address, data: "0xd0e30db0", value: (eth - reserve).toString() }, maxPriorityFeePerGasWei: fee };
        wrapPending = { weth, eth, amount: eth - reserve,
          evidence: { sentBlock: block, logOffset: intentLogOffset(ctx), action } };
        return action;
      }
    }
    // This uses the observed Liquity riskiest trove and an existing SP deposit; it does not
    // attempt the unavailable Aave victim discovery.
    if (liq && BigInt(liq.spDepositEusdWei) > MIN_EUSD) {
      const trove = liq.riskiestTrove;
      if (trove && trove.icr < liq.mcr - 0.005)
        return { type: "liquityLiquidate", borrowers: [trove.owner], maxPriorityFeePerGasWei: fee };
    }
    if (liq && params.stabilityPool) {
      if (BigInt(liq.spEthGainWei || "0") >= 10n ** 16n) return { type: "liquityWithdrawFromSP", amountEusdWei: "0", maxPriorityFeePerGasWei: fee };
      const worth = liq.discountBps > liq.redemptionRateBps + EXIT_COST_BPS + 20;
      if (remaining > ENDGAME_BLOCKS && !worth && eusd >= MIN_EUSD && BigInt(liq.spDepositEusdWei) === 0n) return { type: "liquityProvideToSP", amountEusdWei: eusd.toString(), maxPriorityFeePerGasWei: fee };
      if (remaining > ENDGAME_BLOCKS && usdc >= MIN_USDC && liq.marketQuoted && liq.discountBps < 25 && liq.discountBps > -10 && BigInt(liq.spDepositEusdWei || "0") === 0n) {
        const amountIn = usdc / 10n;
        if (amountIn >= MIN_USDC) return { type: "liquitySwapEusd", tokenIn: "USDC", amountIn: amountIn.toString(), slippageBps: 100, maxPriorityFeePerGasWei: fee };
      }
    }
    if (liq && params.redemption && liq.marketQuoted) {
      if (eusd >= MIN_EUSD) {
        if (liq.discountBps <= 0) return { type: "liquitySwapEusd", tokenIn: "EUSD", amountIn: eusd.toString(), slippageBps: 100, maxPriorityFeePerGasWei: fee };
        if (liq.redemptionEdgeBps - EXIT_COST_BPS > 0) return { type: "liquityRedeem", amountEusdWei: eusd.toString(), maxPriorityFeePerGasWei: fee };
      } else if (remaining > ENDGAME_BLOCKS && usdc >= MIN_USDC && liq.discountBps > liq.redemptionRateBps + EXIT_COST_BPS + 20) {
        let amount = usdc / 10n;
        if (liq.poolReserves) { const cap = BigInt(liq.poolReserves.eusd) / 10n ** 12n / 10n; if (cap > 0n && cap < amount) amount = cap; }
        if (amount >= MIN_USDC) return { type: "liquitySwapEusd", tokenIn: "USDC", amountIn: amount.toString(), slippageBps: 100, maxPriorityFeePerGasWei: fee };
      }
    }
    return deltaDecide(obs);
  } catch { return noop("invalid observation"); }
}

async function r3kDecide(obs: AgentObservation, ctx: AgentContext, closingReserveWei = 0n): Promise<AgentAction | Record<string, unknown> | null> {
  try {
    const block = Number(obs.blockNumber);
    if (Number.isSafeInteger(block) && lastBlock !== undefined && (block < lastBlock || block > lastBlock + 1)) {
      initialEth = undefined; initialWeth = undefined; wrapPending = undefined; recoveryWeth = 0n; recoverySellPending = undefined; resetLaunchState();
    }
    if (Number.isSafeInteger(block)) lastBlock = block;
    // K2: every block, before any branch returns; starts a background settlement read, never awaits it.
    if (K2_BUNDLE_BRAKE) k2Observe(obs, ctx);
    if (PARAMS.launch && obs.registry?.entries?.some(e => e.kind === "uniswapV3Pool")) {
      const action = await launchDecide(obs, ctx);
      if (action && action.type !== "noop") return action;
    }
    return await decideWithParams(obs, { ...PARAMS, launch: false }, ctx, closingReserveWei);
  } catch { return noop("invalid observation"); }
}

/** Flat OU preserves r3k exactly; open positions reserve their closing resources first. */
export async function decide(obs: AgentObservation, ctx: AgentContext): Promise<AgentAction | Record<string, unknown> | null> {
  const reserve = M_OU_ENABLED ? ouClosingReserve(obs, ctx) : { positions: 0, eth: 0n };
  // Wrap sizing retains both closing ETH and its own gas. Other candidates are
  // checked as a whole below, including every independently funded bundle leg.
  const closingReserveWei = reserve.positions ? reserve.eth + ouBudget(obs, ctx, null).orderGasWei : 0n;
  let action = await r3kDecide(obs, ctx, closingReserveWei);
  if (reserve.positions && !baseFitsOuReserve(obs, ctx, action)) {
    // A discarded recovery candidate was never emitted: do not leave a phantom intent.
    if (wrapPending?.evidence.action === action) wrapPending = undefined;
    if (recoverySellPending?.evidence.action === action) recoverySellPending = undefined;
    action = noop("OU closing reserve takes priority");
  }
  if (M_OU_ENABLED) {
    try { await submitOu(obs, ctx, action); } catch { /* OU cannot suppress the r3k result */ }
  }
  return action;
}

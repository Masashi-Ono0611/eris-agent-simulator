import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseAction, parseGammaParams } from "../example/agents/ascon-gamma/agent.js";
import type { AgentObservation } from "@eris/sdk";

function obs(prices: { cheap: number; rich?: number }, extra: Record<string, unknown> = {}): AgentObservation {
  return {
    balances: { usdcUnits: "100000000", wethWei: "8000000000000000000", stables: {} },
    baseBalances: { WBTC: "40000000" }, baseDecimals: { WBTC: 8 },
    fairPriceUsdcPerWeth: 3000, fairPricesUsd: { WETH: 3000 }, blocksRemaining: 100,
    limits: { defaultPriorityFeePerGasWei: "0" },
    protocols: { uniswap: { pool: { priceUsdcPerWeth: prices.cheap, fee: 3000 } },
      balancer: { priceUsdcPerWeth: prices.rich ?? prices.cheap, sellPriceUsdcPerWeth: (prices.rich ?? prices.cheap) * .997,
        buyPriceUsdcPerWeth: (prices.rich ?? prices.cheap) * 1.003, effectiveHalfSpreadBps: 30 } },
    ...extra,
  } as unknown as AgentObservation;
}
const NO_ARB = { marginBps: 45, adverseBps: 35, sizeGain: 200000, maxSizeBps: 1500, inventoryToleranceBps: 2000, endgameBlocks: 12, slippageBps: 80, sellReserveBps: 10000 };

test("乖離が片道手数料内なら noop", () => {
  assert.equal(chooseAction(obs({ cheap: 3000, rich: 3002 }), NO_ARB), null);
});
test("十分な venue spread で正しい2 leg方向", () => {
  const action = chooseAction(obs({ cheap: 2900, rich: 3100 }), NO_ARB) as any;
  assert.equal(action.type, "bundle");
  assert.equal(action.actions[0].tokenIn, "USDC");
  assert.equal(action.actions[1].tokenIn, "WETH");
});
test("取引後の上限まで買いサイズを抑える", () => {
  const o = obs({ cheap: 2500, rich: 3500 }, { balances: { usdcUnits: "100000000000", wethWei: "8000000000000000000", stables: {} } });
  const action = chooseAction(o, NO_ARB) as any;
  assert.ok(action);
  const boughtEth = Number(action.actions[0].amountIn) / 1e6 / 2507.5;
  assert.ok(boughtEth <= 1.600001);
});
test("終盤に初期在庫の売却をしない", () => {
  const o = obs({ cheap: 3000, rich: 3400 }, { blocksRemaining: 2 });
  const action = chooseAction(o, NO_ARB);
  assert.equal(action, null);
});
test("不正なparams JSONは既定値", () => {
  assert.equal(parseGammaParams("{bad").marginBps, NO_ARB.marginBps);
});
test("約定価格込みの費用を一度だけ控除し、損益ゼロ境界の直上だけ通す", () => {
  const low = chooseAction(obs({ cheap: 2999, rich: 3001 }), { ...NO_ARB, marginBps: 0, adverseBps: 0 });
  assert.equal(low, null);
  const high = chooseAction(obs({ cheap: 2900, rich: 3100 }), { ...NO_ARB, marginBps: 0, adverseBps: 0 });
  assert.ok(high);
});

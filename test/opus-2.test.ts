// Unit tests for opus-2's bid controller (bidShareFor). The rest of the strategy is opus-1's and is
// covered by test/opus-1.test.ts.
//
// The controller moves PARAMS.bidProfitShare within [bidProfitShare, bidShareMax] from the agent's
// own recent revert rate. Each case would fail if a guard were dropped: the minimum sample, the
// cooldown, the hysteresis band, the clamp, or the reset at a new epoch.
process.env.ERIS_LOCAL_DEPLOY = "1";

import test from "node:test";
import assert from "node:assert/strict";
import type { AgentObservation } from "@eris/sdk/types.js";

const { PARAMS, bidShareFor, initialBidState, priorityFeeBid } = await import(
  "../example/agents/opus-2/agent.js"
);

type Competition = NonNullable<AgentObservation["competition"]>;

function comp(rate: number, sample: number, lastTxIndex: number | null = 20): Competition {
  return {
    maxCompetitorPriorityFeeWei: "0",
    maxBlockPriorityFeeWei: "0",
    lastTxIndex,
    recentRevertRate: rate,
    recentSampleSize: sample,
  };
}

const BASE = PARAMS.bidProfitShare;
const STEP = PARAMS.bidShareStep;
const COOL = PARAMS.bidCooldownBlocks;

test("starts at opus-1's share", () => {
  assert.equal(initialBidState().share, BASE);
});

test("a small sample is not evidence: no step however high the rate", () => {
  const s = bidShareFor(initialBidState(), comp(1, PARAMS.bidMinSample - 1), 100, 300);
  assert.equal(s.share, BASE);
});

test("no competition signal leaves the share alone", () => {
  const s = bidShareFor(initialBidState(), undefined, 100, 300);
  assert.equal(s.share, BASE);
});

test("a high revert rate raises the share by one step", () => {
  const s = bidShareFor(initialBidState(), comp(0.5, 10), 100, 300);
  assert.equal(s.share, Math.round((BASE + STEP) * 1e4) / 1e4);
  assert.equal(s.lastStepRound, 100);
});

test("the cooldown holds the next step until it has passed", () => {
  let s = bidShareFor(initialBidState(), comp(0.5, 10), 100, 300);
  const once = s.share;
  s = bidShareFor(s, comp(0.9, 10), 100 + COOL - 1, 299);
  assert.equal(s.share, once, "stepped inside the cooldown");
  s = bidShareFor(s, comp(0.9, 10), 100 + COOL, 298);
  assert.ok(s.share > once, "did not step after the cooldown");
});

test("never goes past bidShareMax", () => {
  let s = initialBidState();
  for (let i = 0; i < 20; i++) s = bidShareFor(s, comp(1, 20), 100 + i * COOL, 300 - i);
  assert.equal(s.share, PARAMS.bidShareMax);
});

test("a rate inside the hysteresis band neither raises nor lowers", () => {
  const mid = (PARAMS.bidRaiseRevertRate + PARAMS.bidLowerRevertRate) / 2;
  let s = bidShareFor(initialBidState(), comp(0.5, 10), 100, 300);
  const raised = s.share;
  s = bidShareFor(s, comp(mid, 10), 100 + COOL, 290);
  assert.equal(s.share, raised);
});

test("alternating rates move at most one step per cooldown, so it cannot flip every block", () => {
  let s = initialBidState();
  let changes = 0;
  let prev = s.share;
  for (let round = 100; round < 100 + 4 * COOL; round++) {
    s = bidShareFor(s, comp(round % 2 === 0 ? 0.9 : 0.0, 10), round, 400 - round);
    if (s.share !== prev) changes++;
    prev = s.share;
  }
  assert.ok(changes <= 4, `changed ${changes} times in ${4 * COOL} blocks`);
});

test("once the reverts stop it comes back down, and not below the base", () => {
  let s = initialBidState();
  for (let i = 0; i < 5; i++) s = bidShareFor(s, comp(1, 20), 100 + i * COOL, 300 - i);
  for (let i = 5; i < 20; i++) s = bidShareFor(s, comp(0, 20), 100 + i * COOL, 300 - i);
  assert.equal(s.share, BASE);
});

test("a new epoch (blocksRemaining rises) resets to the base share", () => {
  let s = bidShareFor(initialBidState(), comp(0.9, 10), 100, 30);
  assert.ok(s.share > BASE);
  s = bidShareFor(s, comp(0.9, 10), 101, 359);
  assert.equal(s.share, BASE);
  assert.equal(s.lastBlocksRemaining, 359);
});

test("non-finite inputs are ignored", () => {
  const s = bidShareFor(initialBidState(), comp(Number.NaN, 10), 100, 300);
  assert.equal(s.share, BASE);
});

test("reverts while landing early in the block are not an auction problem: no raise", () => {
  const early = bidShareFor(initialBidState(), comp(0.9, 10, PARAMS.bidLateTxIndex - 1), 100, 300);
  assert.equal(early.share, BASE);
  const none = bidShareFor(initialBidState(), comp(0.9, 10, null), 100, 300);
  assert.equal(none.share, BASE);
  const late = bidShareFor(initialBidState(), comp(0.9, 10, PARAMS.bidLateTxIndex), 100, 300);
  assert.ok(late.share > BASE);
});

test("a non-finite round cannot bypass or poison the cooldown", () => {
  let s = bidShareFor(initialBidState(), comp(0.9, 10), 100, 300);
  const once = s.share;
  s = bidShareFor(s, comp(0.9, 10), Number.NaN, 299);
  assert.equal(s.share, once);
  assert.equal(s.lastStepRound, 100);
  s = bidShareFor(s, comp(0.9, 10), 100 + COOL, 298);
  assert.ok(s.share > once, "a poisoned cooldown blocked the next legitimate step");
});

test("a missing countdown neither fakes a new epoch nor hides the next one", () => {
  let s = bidShareFor(initialBidState(), comp(0.9, 10), 100, 30);
  const raised = s.share;
  s = bidShareFor(s, comp(0.5, 3), 101, Number.POSITIVE_INFINITY);
  assert.equal(s.share, raised, "a gap in the countdown reset the controller");
  assert.equal(s.lastBlocksRemaining, 30);
  s = bidShareFor(s, comp(0.5, 3), 102, 359);
  assert.equal(s.share, BASE, "the real epoch boundary after the gap was missed");
});

test("priorityFeeBid spends the share it is given; the default is opus-1's", () => {
  // A rival bid that 12% of the profit cannot reach but 30% can.
  const ethUsd = 4000;
  const profitUsd = 10;
  const gas = PARAMS.bidGasUnits;
  const at = (share: number) => (profitUsd * share / ethUsd) * 1e18 / gas;
  const rivalWei = BigInt(Math.floor(((at(0.12) + at(0.3)) / 2) / 1.2));
  const obs = {
    fairPricesUsd: { WETH: ethUsd },
    fairPriceUsdcPerWeth: ethUsd,
    limits: { defaultPriorityFeePerGasWei: "1", maxPriorityFeePerGasWei: (10n ** 15n).toString() },
    competition: { ...comp(0.9, 10), maxCompetitorPriorityFeeWei: rivalWei.toString() },
  } as unknown as AgentObservation;
  assert.equal(priorityFeeBid(obs, profitUsd), "1", "the base share should not reach the rival");
  assert.equal(priorityFeeBid(obs, profitUsd, gas, PARAMS.bidProfitShare), "1");
  assert.ok(BigInt(priorityFeeBid(obs, profitUsd, gas, 0.3)) > rivalWei, "0.3 should outbid the rival");
});

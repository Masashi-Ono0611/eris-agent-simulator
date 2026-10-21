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

const { PARAMS, bidShareFor, initialBidState } = await import(
  "../example/agents/opus-2/agent.js"
);

type Competition = NonNullable<AgentObservation["competition"]>;

function comp(rate: number, sample: number): Competition {
  return {
    maxCompetitorPriorityFeeWei: "0",
    maxBlockPriorityFeeWei: "0",
    lastTxIndex: 20,
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

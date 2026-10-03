import { bundle, liquity, observation, safeAction, single, U, W } from "./xb-fixtures.js";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AgentObservation } from "@eris/sdk";
import { loadImproveAgent } from "../example/agents/runtime/improve.js";
import { BASE_PARAMS, createAgent, type Params, type Action } from "../example/agents/xb-core/agent.js";
import * as v0 from "../example/agents/xb-v0/agent.js";
import * as v1 from "../example/agents/xb-v1/agent.js";
import * as v2 from "../example/agents/xb-v2/agent.js";
import * as v3 from "../example/agents/xb-v3/agent.js";
import * as v4 from "../example/agents/xb-v4/agent.js";
import * as v5 from "../example/agents/xb-v5/agent.js";
import * as v6 from "../example/agents/xb-v6/agent.js";
import * as v7 from "../example/agents/xb-v7/agent.js";

const variants = [v0, v1, v2, v3, v4, v5, v6, v7];
const changes = [[], ["A_EDGE_BPS"], ["BID_MODE"], ["A_EDGE_BPS", "BID_MODE"], ["SIZ_MODE"], ["INV_BAND"], ["MOD"], ["GATE"]];
const action = (params: Params, o: AgentObservation) => createAgent(params)(structuredClone(o));
const withoutBid = (a: Action) => { const { maxPriorityFeePerGasWei: _, ...rest } = a; return rest; };
function red(t: TestContext, label: string, check: (p: Params) => void, on: Params, off: Params): void {
  check(on);
  assert.throws(() => check(off), { name: "AssertionError" });
  t.diagnostic(`RED-CONTROL ${label}: identical assertion rejected factor-off Params`);
}

for (const [i, variant] of variants.entries()) {
  test(`V${i}: baked factor map and thin decide export match the specification`, () => {
    const differences = (Object.keys(BASE_PARAMS) as Array<keyof Params>).filter(k => variant.PARAMS[k] !== BASE_PARAMS[k]);
    assert.deepEqual(differences.sort(), changes[i].slice().sort());
    assert.equal(Object.isFrozen(variant.PARAMS), true);
    const o = single(0.02); o.runId = `wrapper-${i}`;
    assert.deepEqual(variant.decide(o), action(variant.PARAMS, o));
    const dir = new URL(`../example/agents/xb-v${i}/`, import.meta.url);
    const prompt = loadImproveAgent(dir.pathname);
    assert.equal(prompt.name, `xb-v${i}`);
    assert.match(readFileSync(new URL("prompt.md", dir), "utf8"), /description:.*ablation variant/);
    const source = readFileSync(new URL("agent.ts", dir), "utf8");
    assert.match(source, /export const decide = createAgent\(PARAMS\)/);
    assert.equal(source.split("\n").length <= 15, true);
  });
  test(`V${i}: irrelevant factors preserve quiet, recovery, endgame and gas guard actions`, () => {
    const quiet = observation();
    const end = observation(); end.blocksRemaining = 3; end.balances.wethWei = String(9n * W);
    const recovery = observation(); recovery.protocols.liquity = liquity({ eusdBalanceWei: String(200n * W) });
    const capped = single(0.3); capped.limits.maxPriorityFeePerGasWei = "0";
    capped.balances.usdcUnits = String(1000n * U);
    capped.balances.ethWei = "0";
    for (const o of [quiet, end, recovery, capped])
      assert.deepEqual(action(variant.PARAMS, o), action(BASE_PARAMS, o));
  });
  test(`V${i}: positive funded amounts, aggregate existing-inventory sells and gas guards`, () => {
    const cases = [observation(), single(0.004), single(0.02), single(0.02, false), bundle()];
    const empty = bundle(); empty.balances.wethWei = "0"; cases.push(empty);
    const noCash = single(); noCash.balances.usdcUnits = "0"; cases.push(noCash);
    const exhausted = single(); exhausted.balances.ethWei = "0"; cases.push(exhausted);
    const module = observation(); module.protocols.liquity = liquity(); cases.push(module);
    const eusd = observation(); eusd.protocols.liquity = liquity({ eusdBalanceWei: String(100n * W) }); cases.push(eusd);
    const end = observation(); end.blocksRemaining = 3; end.balances.wethWei = String(9n * W); cases.push(end);
    const low = bundle(); low.balances.wethWei = "1"; cases.push(low);
    for (const o of cases) safeAction(o, action(variant.PARAMS, o));
    assert.equal(action(variant.PARAMS, exhausted).type, "noop");
    assert.notEqual(action(variant.PARAMS, empty).type, "bundle");
    assert.notEqual(action(variant.PARAMS, low).type, "bundle");
  });
}

test("A changes only entry: admitted high-edge actions, size and profit-funded bid are identical", () => {
  for (const o of [single(0.02), single(0.02, false), bundle()]) {
    assert.deepEqual(action(v0.PARAMS, o), action(v1.PARAMS, o));
    assert.deepEqual(action(v2.PARAMS, o), action(v3.PARAMS, o));
  }
});
test("BID changes only the bid on the same selected candidate and size", () => {
  for (const o of [single(0.02), single(0.02, false), bundle()]) {
    assert.deepEqual(withoutBid(action(v0.PARAMS, o)), withoutBid(action(v2.PARAMS, o)));
    o.limits.maxPriorityFeePerGasWei = "1";
    assert.deepEqual(action(v0.PARAMS, o), action(v2.PARAMS, o));
  }
  const nearlyEmpty = single(0.02);
  nearlyEmpty.balances.ethWei = String(W / 20n + 200000n * 200000000n);
  assert.equal(action(v0.PARAMS, nearlyEmpty).reason, "gas reserve");
  assert.deepEqual(action(v0.PARAMS, nearlyEmpty), action(v2.PARAMS, nearlyEmpty));
});
test("INV, MOD and GATE preserve admitted spot actions when their factors are irrelevant", () => {
  const o = single(0.01);
  for (const p of [v5.PARAMS, v6.PARAMS, v7.PARAMS]) assert.deepEqual(action(v0.PARAMS, o), action(p, o));
});
test("SIZ common inventory cap gives identical actions when desired size exceeds room", () => {
  const o = single(0.03); o.balances.wethWei = String(95n * W / 10n);
  assert.deepEqual(action(v0.PARAMS, o), action(v4.PARAMS, o));
  assert.notEqual(action(v4.PARAMS, o).type, "noop");
});
test("red A: V1 admits 40bps and factor-off fails the same action assertion", t => {
  assert.equal(action(v0.PARAMS, single(0.004)).type, "noop");
  red(t, "A", p => assert.equal(action(p, single(0.004)).type, "swap"), v1.PARAMS, { ...v1.PARAMS, A_EDGE_BPS: 60 });
});
test("red BID: competitor plus exactly 0.1gwei when affordable", t => {
  red(t, "BID", p => assert.equal(action(p, single(0.02)).maxPriorityFeePerGasWei, "200000000"),
    v2.PARAMS, { ...v2.PARAMS, BID_MODE: "budget10" });
  const o = single(0.02); o.competition!.maxCompetitorPriorityFeeWei = "999999999999";
  const capped = action(v2.PARAMS, o); assert.equal(capped.type, "swap");
  assert.equal(capped.maxPriorityFeePerGasWei, action(v0.PARAMS, o).maxPriorityFeePerGasWei);
});
test("red A+BID: V3 requires both factors for the low-edge competitor-target action", t => {
  const check = (p: Params) => {
    const o = single(0.004); o.competition!.maxCompetitorPriorityFeeWei = "0";
    const a = action(p, o); assert.equal(a.type, "swap"); assert.equal(a.maxPriorityFeePerGasWei, "100000000");
  };
  red(t, "V3-A", check, v3.PARAMS, { ...v3.PARAMS, A_EDGE_BPS: 60 });
  red(t, "V3-BID", check, v3.PARAMS, { ...v3.PARAMS, BID_MODE: "budget10" });
});
test("red SIZ: balance fraction selects a different amount", t => {
  red(t, "SIZ", p => {
    const a = action(p, single(0.01)); assert.equal(a.type, "swap");
    assert.ok(Math.abs(Number(a.amountIn) / 1e6 - 2500) < 0.00001);
  }, v4.PARAMS, { ...v4.PARAMS, SIZ_MODE: "depth" });
});
test("red INV: 40 percent band admits buys and sells outside the 20 percent band", t => {
  for (const buy of [true, false]) {
    const o = single(0.01, buy); o.balances.wethWei = String((buy ? 96n : 64n) * W / 10n);
    red(t, buy ? "INV-buy" : "INV-sell", p => assert.equal(action(p, o).type, "swap"),
      v5.PARAMS, { ...v5.PARAMS, INV_BAND: 0.2 });
  }
});
test("red MOD: both entry mechanisms disappear when only MOD is off", t => {
  for (const liquidate of [false, true]) {
    const o = observation(); o.protocols.liquity = liquity();
    if (liquidate) o.protocols.liquity.riskiestTrove!.icr = 1.05;
    red(t, liquidate ? "MOD-liquidate" : "MOD-redeem-entry", p => assert.equal(action(p, o).type, liquidate ? "liquityLiquidate" : "liquitySwapEusd"),
      v6.PARAMS, { ...v6.PARAMS, MOD: "none" });
  }
});
test("red GATE: 75bps fair step pauses an otherwise admitted trade", t => {
  red(t, "GATE", p => {
    const decide = createAgent(p); decide(observation());
    const o = single(0.02, true, 101); o.fairPricesUsd!.WETH = 3022.5;
    assert.equal(decide(o).reason, "fair shock: new risk paused");
  }, v7.PARAMS, { ...v7.PARAMS, GATE: "off" });
});
test("source closure has no environment, network, random, future or regime switches", () => {
  const files = ["xb-core/agent.ts", "lib/affordable.ts", ...variants.map((_, i) => `xb-v${i}/agent.ts`)];
  for (const f of files) {
    const source = readFileSync(new URL(`../example/agents/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /process\s*(?:\.|\[)|\benv\b|import\.meta\.env|Math\.random|\bfetch\s*\(|publicClient\s*\.|legacyDefaults|\bseed\b|\bregime\b|futureEvents/);
  }
  const deployment = readFileSync(new URL("../sdk/src/constants.local.ts", import.meta.url), "utf8");
  assert.doesNotMatch(deployment, /process\s*(?:\.|\[)|import\.meta\.env|\bfetch\s*\(/);
  for (const p of variants.map(v => v.PARAMS)) {
    const o = single(); o.runId = "opaque-regime-seed-name";
    assert.deepEqual(action(p, o), action(p, single()));
  }
});

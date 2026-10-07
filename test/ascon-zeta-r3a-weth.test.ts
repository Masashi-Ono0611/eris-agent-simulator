// Decision/state diagnostics, not execution or profitability acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { WAD, harness, market, cleanState, brief, record } from "./helpers/r3Weth.js";

const ids = ["ascon-zeta-r3", "ascon-zeta-r3a"];
const deferred = "noop:recovery quote/cost not competitive";

// KNOWN-RISK: delta consumes confirmed recovery inventory, but attribution survives and
// later covers ordinary delta purchases. Start with zero WETH to remove lot-allocation ambiguity.
test("KNOWN-RISK: r3a SELL then BUY sells ordinary delta WETH as recovery; r3 same-input control", async t => {
  for (const id of ids) {
    const h = await harness(id);
    market(h.obs, 4000);
    assert.equal(brief(await h.step(3)), id.endsWith("r3a") ? `swap:WETH:${WAD / 4n}` : deferred);
    assert.deepEqual(h.agent.recoveryState(), cleanState(WAD));
    // r3a sale succeeds. For r3 this is a same-observation replay, NOT its own fill.
    h.obs.balances.wethWei = String(3n * WAD / 4n);
    h.obs.balances.usdcUnits = "21000000000";
    market(h.obs, 2000);
    assert.equal(brief(await h.step(4)), id.endsWith("r3a") ? "swap:USDC:5250000000" : deferred);
    assert.deepEqual(h.agent.recoveryState(), cleanState(WAD));
    // Explicit mocked buy fill: 5,250 USDC -> 2.6 WETH, in the same account.
    h.obs.balances.wethWei = String(335n * WAD / 100n);
    h.obs.balances.usdcUnits = "15750000000";
    market(h.obs, 3000); h.rpc.quote = 3000000000n;
    assert.equal(brief(await h.step(5)), `swap:WETH:${WAD}`);
    assert.deepEqual(h.agent.recoveryState(), { ...cleanState(WAD),
      recoverySellPending: { weth: 335n * WAD / 100n, amount: WAD } });
    // At most .75 own-wrap WETH remains: at least .25 of the recovery sale is bought WETH.
    assert.ok(WAD > 3n * WAD / 4n);
    record(t, id, h.trace);
  }
});

test("causal control: each version's returned actions determine its next balance", async t => {
  for (const id of ids) {
    const h = await harness(id); let own = WAD, bought = 0n;
    market(h.obs, 4000);
    const sell = await h.step(3);
    if (sell.type === "swap") {
      own -= BigInt(sell.amountIn); h.obs.balances.usdcUnits = "21000000000";
    }
    h.obs.balances.wethWei = String(own);
    market(h.obs, 2000);
    const buy = await h.step(4);
    if (buy.type === "swap") bought = 260n * WAD / 100n;
    h.obs.balances.wethWei = String(own + bought);
    market(h.obs, 3000); h.rpc.quote = 3000000000n;
    const recovery = await h.step(5);
    assert.equal(BigInt(recovery.amountIn), WAD);
    assert.equal(BigInt(recovery.amountIn) > own, id.endsWith("r3a"));
    assert.deepEqual(h.trace.slice(2).map(x => brief(x.action)), id.endsWith("r3a") ?
      [`swap:WETH:${WAD / 4n}`, "swap:USDC:5250000000", `swap:WETH:${WAD}`] :
      [deferred, deferred, `swap:WETH:${WAD}`]);
    record(t, id, h.trace);
  }
});

for (const direction of ["SELL", "BUY"] as const) test(`deferred delta ${direction}, then competitive recovery`, async t => {
  for (const id of ids) {
    const h = await harness(id); market(h.obs, direction === "SELL" ? 4000 : 2000);
    const a = await h.step(3);
    assert.equal(brief(a), id.endsWith("r3a") ?
      direction === "SELL" ? `swap:WETH:${WAD / 4n}` : "swap:USDC:5000000000" : deferred);
    assert.deepEqual(h.agent.recoveryState(), cleanState(WAD));
    h.obs.balances.wethWei = String(direction === "SELL" ? 3n * WAD / 4n : 347n * WAD / 100n);
    market(h.obs, 3000); const amount = direction === "SELL" ? 3n * WAD / 4n : WAD;
    h.rpc.quote = amount * 3000n / 10n ** 12n;
    assert.equal(brief(await h.step(4)), `swap:WETH:${amount}`);
    assert.deepEqual(h.agent.recoveryState(), { ...cleanState(WAD),
      recoverySellPending: { weth: BigInt(h.obs.balances.wethWei), amount } });
    record(t, id, h.trace);
  }
});

test("deferred bundle, pending leg, settled bundle, competitive recovery: no simultaneous reservation", async t => {
  for (const id of ids) {
    const h = await harness(id, 8n * WAD); market(h.obs, 2800, 3100);
    const bundle = await h.step(3);
    if (id.endsWith("r3a")) {
      assert.equal(bundle.type, "bundle");
      assert.deepEqual(bundle.actions.map((a: any) => [a.type, a.tokenIn, a.amountIn]),
        [["swap", "USDC", "5000000000"], ["curveSwap", "WETH", "1750000000000000000"]]);
      assert.ok(BigInt(bundle.actions[1].amountIn) <= 9n * WAD);
    } else assert.equal(brief(bundle), deferred);
    assert.deepEqual(h.agent.recoveryState(), cleanState(WAD));
    // First leg's mocked buy mined (+1.78), second leg still pending.
    h.obs.balances.wethWei = String(1078n * WAD / 100n); h.rpc.pending = true;
    h.rpc.quote = 3000000000n;
    assert.equal(brief(await h.step(4)), "noop:recovery transaction pending");
    assert.deepEqual(h.agent.recoveryState(), cleanState(WAD));
    // Both legs settled: no outstanding WETH obligation in this model.
    h.obs.balances.wethWei = String(903n * WAD / 100n); h.rpc.pending = false;
    assert.equal(brief(await h.step(5)), `swap:WETH:${WAD}`);
    record(t, id, h.trace);
  }
});

test("repeated deferrals with new ETH: no overlapping wrap, then recovery settles and next wrap confirms", async t => {
  for (const id of ids) {
    const h = await harness(id);
    for (let block = 3; block <= 5; block++) {
      if (block >= 4) h.obs.balances.ethWei = String(2n * WAD);
      assert.equal(brief(await h.step(block)), id.endsWith("r3a") ? "noop:no funded venue gap" : deferred);
      assert.deepEqual(h.agent.recoveryState(), cleanState(WAD));
    }
    h.rpc.quote = 3000000000n;
    assert.equal(brief(await h.step(6)), `swap:WETH:${WAD}`);
    h.obs.balances.wethWei = "0";
    assert.equal(brief(await h.step(7)), `wrap:${WAD}`);
    assert.deepEqual(h.agent.recoveryState(), { ...cleanState(),
      wrapPending: { weth: 0n, eth: 2n * WAD, amount: WAD } });
    h.obs.balances.wethWei = String(WAD); h.obs.balances.ethWei = String(WAD); h.rpc.quote = 0n;
    assert.equal(brief(await h.step(8)), id.endsWith("r3a") ? "noop:no funded venue gap" : deferred);
    assert.deepEqual(h.agent.recoveryState(), cleanState(WAD));
    record(t, id, h.trace);
  }
});

test("pending wrap and recovery sell: nonce and unchanged-balance guards prevent duplicate actions", async t => {
  for (const id of ids) {
    const h = await harness(id);
    h.obs.balances.wethWei = "0"; h.obs.balances.ethWei = String(2n * WAD);
    const wrapping = h.agent.recoveryState();
    assert.equal(brief(await h.step(3)), "noop:awaiting confirmed wrap balance");
    assert.deepEqual(h.agent.recoveryState(), wrapping);
    h.obs.balances.wethWei = String(WAD); h.obs.balances.ethWei = String(WAD);
    h.rpc.quote = 3000000000n;
    assert.equal(brief(await h.step(4)), `swap:WETH:${WAD}`);
    const selling = { ...cleanState(WAD), recoverySellPending: { weth: WAD, amount: WAD } };
    assert.deepEqual(h.agent.recoveryState(), selling);
    h.rpc.pending = true;
    assert.equal(brief(await h.step(5)), "noop:recovery transaction pending");
    assert.deepEqual(h.agent.recoveryState(), selling);
    h.rpc.pending = false;
    for (const block of [6, 7]) {
      assert.equal(brief(await h.step(block)), "noop:awaiting recovery sell balance");
      assert.deepEqual(h.agent.recoveryState(), selling);
    }
    h.obs.balances.wethWei = "0";
    assert.equal(brief(await h.step(8)), "noop:no funded venue gap");
    assert.deepEqual(h.agent.recoveryState(), cleanState());
    assert.deepEqual(h.rpc.amounts, [WAD]);
    record(t, id, h.trace);
  }
});

// KNOWN-RISK: a returned bundle is not a reservation. If it has not been submitted yet,
// latest==pending cannot distinguish it from no outstanding work. This models a sender delay;
// it does NOT establish that the real runtime permits this interleaving.
test("KNOWN-RISK: unsubmitted delta bundle is invisible to nonce guard and recovery consumes its sell funding", async t => {
  for (const id of ids) {
    const h = await harness(id); h.obs.balances.usdcUnits = "10000000000";
    market(h.obs, 2800, 3100);
    const queued = await h.step(3);
    if (id.endsWith("r3a")) {
      assert.equal(queued.type, "bundle");
      assert.equal(queued.actions[1].amountIn, "875000000000000000");
    } else assert.equal(brief(queued), deferred);
    assert.deepEqual(h.agent.recoveryState(), cleanState(WAD));
    // No bundle leg submitted: same balances, equal nonces, now recovery quote competitive.
    market(h.obs, 3000); h.rpc.quote = 3000000000n;
    const recovery = await h.step(4);
    assert.equal(brief(recovery), `swap:WETH:${WAD}`);
    assert.deepEqual(h.agent.recoveryState(), { ...cleanState(WAD),
      recoverySellPending: { weth: WAD, amount: WAD } });
    const afterRecovery = WAD - BigInt(recovery.amountIn);
    if (queued.type === "bundle") assert.ok(afterRecovery < BigInt(queued.actions[1].amountIn));
    record(t, `${id} unsent bundle model`, h.trace);
  }
});

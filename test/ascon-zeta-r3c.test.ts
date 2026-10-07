import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { WAD, harness, market, cleanState, brief, record, loadAgent, probe, params, mockContext } from "./helpers/r3Weth.js";
import { launchPools } from "../example/agents/lib/launchSwap.js";
import { TOKENS } from "@eris/sdk/constants.js";

for (const shape of ["SELL", "BUY", "bundle"] as const) test(`r3c clears attribution on WETH ${shape} and preserves the delta action`, async t => {
  const initial = shape === "bundle" ? 8n * WAD : 0n;
  const a = await harness("ascon-zeta-r3a", initial), c = await harness("ascon-zeta-r3c", initial);
  for (const h of [a, c]) market(h.obs, shape === "SELL" ? 4000 : shape === "BUY" ? 2000 : 2800, shape === "bundle" ? 3100 : undefined);
  const expected = await a.step(3), actual = await c.step(3);
  assert.deepEqual(actual, expected);
  assert.equal(actual.type, shape === "bundle" ? "bundle" : "swap");
  assert.deepEqual(a.agent.recoveryState(), cleanState(WAD));
  assert.deepEqual(c.agent.recoveryState(), cleanState());
  // SELL fill, followed by a genuine delta buy: reproduce the original offending path.
  if (shape === "SELL") {
    for (const h of [a, c]) {
      h.obs.balances.wethWei = String(3n * WAD / 4n); h.obs.balances.usdcUnits = "21000000000";
      market(h.obs, 2000);
    }
    assert.deepEqual(await c.step(4), await a.step(4));
    for (const h of [a, c]) {
      h.obs.balances.wethWei = String(335n * WAD / 100n); h.obs.balances.usdcUnits = "15750000000";
      market(h.obs, 3000); h.rpc.quote = 3000000000n;
    }
    assert.equal(brief(await a.step(5)), `swap:WETH:${WAD}`);
    assert.equal(brief(await c.step(5)), "noop:no funded venue gap");
  } else {
    // Explicit mock settlement: buy-only +2.47 WETH; bundle net +.03 WETH.
    for (const h of [a, c]) {
      h.obs.balances.wethWei = String(shape === "BUY" ? 347n * WAD / 100n : 903n * WAD / 100n);
      market(h.obs, 3000); h.rpc.quote = 3000000000n;
    }
    assert.equal(brief(await a.step(4)), `swap:WETH:${WAD}`);
    assert.equal(brief(await c.step(4)), "noop:no funded venue gap");
  }
  assert.deepEqual(c.agent.recoveryState(), cleanState());
  assert.deepEqual(c.rpc.amounts, [WAD], "no stale recovery quote after relinquishing attribution");
  record(t, "r3a", a.trace); record(t, "r3c", c.trace);
});

test("r3c deliberately relinquishes attribution even if the delta action fails", async t => {
  const h = await harness("ascon-zeta-r3c"); market(h.obs, 4000);
  assert.equal(brief(await h.step(3)), `swap:WETH:${WAD / 4n}`);
  market(h.obs, 3000); h.rpc.quote = 3000000000n; // balances unchanged: rejected/reverted delta
  assert.equal(brief(await h.step(4)), "noop:no funded venue gap");
  assert.deepEqual(h.agent.recoveryState(), cleanState());
  record(t, "r3c failed delta", h.trace);
});

test("r3c attributes a subsequent exact wrap only, despite old delta inventory", async t => {
  const h = await harness("ascon-zeta-r3c"); market(h.obs, 4000);
  await h.step(3);
  h.obs.balances.wethWei = String(3n * WAD / 4n); h.obs.balances.ethWei = String(2n * WAD);
  market(h.obs, 3000);
  assert.equal(brief(await h.step(4)), `wrap:${WAD}`);
  assert.deepEqual(h.agent.recoveryState(), { ...cleanState(),
    wrapPending: { weth: 3n * WAD / 4n, eth: 2n * WAD, amount: WAD } });
  h.obs.balances.wethWei = String(7n * WAD / 4n); h.obs.balances.ethWei = String(WAD);
  assert.equal(brief(await h.step(5)), "noop:no funded venue gap");
  assert.deepEqual(h.agent.recoveryState(), cleanState(WAD));
  h.rpc.quote = 3000000000n;
  assert.equal(brief(await h.step(6)), `swap:WETH:${WAD}`);
  assert.deepEqual(h.agent.recoveryState(), { ...cleanState(WAD),
    recoverySellPending: { weth: 7n * WAD / 4n, amount: WAD } });
  record(t, "r3c new wrap", h.trace);
});

for (const path of ["noop", "competitive", "quote unavailable", "wrap pending", "nonce pending", "liquidation", "stability pool", "WBTC buy", "WBTC bundle"] as const) {
  test(`r3c equals r3a actions AND state elsewhere: ${path}`, async () => {
    const results = [];
    for (const id of ["ascon-zeta-r3a", "ascon-zeta-r3c"]) {
      const h = await harness(id);
      if (path === "competitive") h.rpc.quote = 3000000000n;
      if (path === "quote unavailable") delete h.obs.protocols.uniswap;
      if (path === "wrap pending") { h.obs.balances.wethWei = "0"; h.obs.balances.ethWei = String(2n * WAD); }
      if (path === "nonce pending") h.rpc.pending = true;
      if (path === "liquidation") Object.assign(h.obs.protocols.liquity, { spDepositEusdWei: String(201n * WAD), mcr: 1.1,
        riskiestTrove: { owner: h.obs.agentAddress, icr: 1.0 } });
      if (path === "stability pool") h.obs.protocols.liquity.spEthGainWei = String(WAD / 100n);
      if (path.startsWith("WBTC")) {
        h.obs.fairPricesUsd.WBTC = 60000; h.obs.baseDecimals = { WBTC: 8 };
        h.obs.baseBalances = { WBTC: "100000000" };
        h.obs.protocols.uniswap.markets = { "WBTC/USDC": { priceUsdcPerWeth: 40000, fee: 3000 } };
        if (path === "WBTC bundle") h.obs.protocols.curve = { markets: { "WBTC/USDC": {
          priceUsdcPerWeth: 70000, buyPriceUsdcPerWeth: 70000, sellPriceUsdcPerWeth: 70000, effectiveHalfSpreadBps: 30 } } };
      }
      let action;
      if (path === "stability pool") {
        h.obs.blockNumber = "3";
        action = await h.agent.decideWithParams(h.obs, { ...params, stabilityPool: true }, h.ctx);
      } else action = await h.step(3);
      if (path === "WBTC buy") { assert.equal(action.type, "swap"); assert.equal(action.base, "WBTC"); }
      if (path === "WBTC bundle") { assert.equal(action.type, "bundle"); assert.equal(action.actions[1].base, "WBTC"); }
      results.push({ action, state: h.agent.recoveryState() });
    }
    assert.deepEqual(results[1], results[0]);
  });
}

test("r3c equals r3a through deferred, competitive, pending sell and confirmed sell", async () => {
  const a = await harness("ascon-zeta-r3a"), c = await harness("ascon-zeta-r3c");
  for (let b = 3; b <= 8; b++) {
    for (const h of [a, c]) {
      if (b === 4) h.rpc.quote = 3000000000n;
      if (b === 5) h.rpc.pending = true;
      if (b === 6) h.rpc.pending = false;
      if (b === 8) h.obs.balances.wethWei = "0";
    }
    assert.deepEqual(await c.step(b), await a.step(b));
    assert.deepEqual(c.agent.recoveryState(), a.agent.recoveryState());
  }
});

test("r3c and r3a agree with no recovery across single and bundle delta and public decide", async () => {
  for (const price of [2000, 3000, 4000]) for (const curve of [undefined, 4500]) {
    const o = probe(); market(o, price, curve);
    const a = await loadAgent("ascon-zeta-r3a"), c = await loadAgent("ascon-zeta-r3c");
    assert.deepEqual(await c.decide(structuredClone(o), mockContext().ctx), await a.decide(structuredClone(o), mockContext().ctx));
    assert.deepEqual(c.recoveryState(), a.recoveryState());
  }
});

test("launch registry rejects WETH as a launch token (no launch attribution hook needed)", () => {
  const o = probe(), creator = o.agentAddress, hash = `0x${"11".repeat(32)}`;
  o.registry.entries = [
    { kind: "erc20", market: TOKENS.WETH.address, creator, codehashAtRegistration: hash },
    { kind: "uniswapV3Pool", market: creator, creator, token0: TOKENS.USDC.address, token1: TOKENS.WETH.address },
  ];
  assert.deepEqual(launchPools(o), []);
  [o.registry.entries[1].token0, o.registry.entries[1].token1] = [o.registry.entries[1].token1, o.registry.entries[1].token0];
  assert.deepEqual(launchPools(o), []);
});

const dir = (id: string) => new URL(`../example/agents/${id}/`, import.meta.url);
const source = (id: string, file: string) => readFileSync(new URL(file, dir(id)), "utf8");
test("r3c identity: exact delta-dispatch replacement only; other sources and file set equal r3a", () => {
  const a = "ascon-zeta-r3a", c = "ascon-zeta-r3c";
  assert.deepEqual(readdirSync(dir(c)).sort(), readdirSync(dir(a)).sort());
  for (const file of ["delta.ts", "launch.ts", "launchSwap.ts"]) assert.equal(source(c, file), source(a, file));
  const replacement = `    const action = deltaDecide(obs);
    const legs = action?.type === "bundle" && Array.isArray(action.actions) ? action.actions : [action];
    // A WETH delta decision makes own-wrap attribution ambiguous, even if it never lands.
    // Drop the claim before dispatch; do not later recover ordinary delta purchases.
    if (legs.some(leg => leg && ["swap", "curveSwap", "balancerSwap"].includes(String(leg.type))
      && (("base" in leg ? leg.base : undefined) ?? "WETH") === "WETH")) recoveryWeth = 0n;
    return action;`;
  assert.equal(source(c, "agent.ts"), source(a, "agent.ts").replace("    return deltaDecide(obs);", replacement));
});
test("r3c prompt identity: name/description/research sentence only; r3 evidence body retained", () => {
  const expected = source("ascon-zeta-r3a", "prompt.md")
    .replace("name: ascon-zeta-r3a", "name: ascon-zeta-r3c")
    .replace('description: "ascon-zeta-r3a: research variant of r3 with recovery quote/cost fall-through only; not a submission candidate."',
      'description: "ascon-zeta-r3c: research variant of r3a dropping recovery attribution on WETH delta decisions; not a submission candidate."')
    .replace("This is a research variant of r3 whose only change is to fall through to the remaining decision logic when the recovery quote/cost check fails.",
      "This is a research variant of r3a that drops own-wrap recovery attribution when returning a WETH delta action; failed or unsubmitted actions also relinquish attribution. No live qualification has been run.");
  assert.equal(source("ascon-zeta-r3c", "prompt.md"), expected);
});

test("r3c does not recover WETH reserved by a returned but unsubmitted delta bundle", async t => {
  const h = await harness("ascon-zeta-r3c"); h.obs.balances.usdcUnits = "10000000000";
  market(h.obs, 2800, 3100);
  const queued = await h.step(3);
  assert.equal(queued.type, "bundle"); assert.equal(queued.actions[1].amountIn, "875000000000000000");
  market(h.obs, 3000); h.rpc.quote = 3000000000n;
  assert.equal(brief(await h.step(4)), "noop:no funded venue gap");
  assert.deepEqual(h.agent.recoveryState(), cleanState());
  record(t, "r3c unsent bundle model", h.trace);
});

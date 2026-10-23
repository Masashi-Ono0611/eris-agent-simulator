// ascon-zeta-r3k = ascon-zeta-r3 + K1 (single-leg gap floor), K2 (own-outcome bundle brake) and
// K3 (large-edge bids). Offline: synthetic observations, the real-log fixture and a mocked chain
// (no sender, network, RPC or Anvil). Each agent load is a separate module graph, so module state
// (persistence, recovery, launch, the K2 window) never leaks between cases.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";
import type { AgentContext, AgentObservation } from "@eris/sdk";
import { BALANCER, UNISWAP } from "@eris/sdk/constants.js";
import { marketFor, tokenInfo } from "@eris/sdk/markets.js";
import { balancerVaultAbi, curveTricryptoAbi, swapRouterAbi } from "@eris/sdk/abis.js";
import { encodeFunctionData } from "viem";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("./fixtures/ascon-zeta-r-logs.json", import.meta.url), "utf8"));
let serial = 0;
const SWITCHES = ["K1_SINGLE_LEG_FLOOR", "K2_BUNDLE_BRAKE", "K3_LARGE_EDGE_BID"] as const;
type Switch = typeof SWITCHES[number];

// Loads an agent directory as its own module graph. `off` turns r3k switches off in the loaded copy
// only (the file on disk is not touched); whatever value the file has, the copy gets `false`.
async function load(id: string, off: Switch[] = []): Promise<{ agent: any; delta: any; brake: any }> {
  const files = id === "ascon-zeta-r3k" ? ["launchSwap", "brake", "delta", "launch", "agent"] : ["launchSwap", "delta", "launch", "agent"];
  const own: Record<string, string> = {};
  for (const file of files) {
    let source = readFileSync(resolve(root, `example/agents/${id}/${file}.ts`), "utf8");
    if (file === "delta") for (const name of off) {
      const re = new RegExp(`export const ${name} = (true|false);`);
      assert.equal(source.split(re).length, 3, `${name} must be declared exactly once`);
      source = source.replace(re, `export const ${name} = false;`);
    }
    source = source.replace(/from "([^"]+)"/g, (match, spec: string) => {
      if (spec.startsWith("@eris/sdk")) {
        const suffix = spec === "@eris/sdk" ? "index.ts" : spec.slice("@eris/sdk/".length).replace(/\.js$/, ".ts");
        return `from ${JSON.stringify(pathToFileURL(resolve(root, "sdk/src", suffix)).href)}`;
      }
      if (spec.startsWith("./")) return `from ${JSON.stringify(own[spec.slice(2, -3)])}`;
      if (spec.startsWith("../lib/")) return `from ${JSON.stringify(pathToFileURL(resolve(root, "example/agents/lib", spec.slice(7).replace(/\.js$/, ".ts"))).href)}`;
      if (spec === "viem") return `from ${JSON.stringify(import.meta.resolve("viem"))}`;
      return match;
    });
    own[file] = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source + `\n// isolated ${serial++}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText).toString("base64");
  }
  return { agent: await import(own.agent), delta: await import(own.delta), brake: own.brake ? await import(own.brake) : undefined };
}
const ALL_OFF = [...SWITCHES];

// A context whose chain must not be touched.
const noRpc = { publicClient: new Proxy({}, { get() { throw new Error("offline replay must not use RPC"); } }), log() {} } as unknown as AgentContext;

const GWEI = 1_000_000_000n;
const ME = "0x1111111111111111111111111111111111111111";
// WETH only, Uniswap (30 bps pool) and Curve (two-sided, 30 bps half-spread), no Liquity and no launch,
// so agent.decide falls through to delta. Prices are set per case.
function obs(o: { block?: number; uni: number; curve?: number; curveFee?: number; usdc?: bigint; rival?: string | null; max?: string }): AgentObservation {
  const x = structuredClone(fixture.windows[0].frames[0].observation);
  const block = o.block ?? 100;
  x.blockNumber = String(block); x.round = block; x.blocksRemaining = 200;
  x.agentAddress = ME;
  x.enabledProtocols = ["uniswap", "curve"];
  x.registry = { entries: [] };
  x.fairPriceUsdcPerWeth = 3000; x.fairPricesUsd = { WETH: 3000 }; x.baseBalances = {}; x.baseDecimals = { WETH: 18 };
  x.balances = { usdcUnits: String(o.usdc ?? 20_000_000_000n), wethWei: String(8n * 10n ** 18n), ethWei: String(10n ** 18n) };
  x.protocols = { uniswap: { pool: { priceUsdcPerWeth: o.uni, fee: 3000 } } };
  if (o.curve !== undefined) x.protocols.curve = { priceUsdcPerWeth: o.curve, buyPriceUsdcPerWeth: o.curve,
    sellPriceUsdcPerWeth: o.curve, effectiveHalfSpreadBps: o.curveFee ?? 30 };
  if (o.rival === null) delete x.competition; else x.competition = { maxCompetitorPriorityFeeWei: o.rival ?? "6000000000" };
  x.limits = { defaultPriorityFeePerGasWei: "100000000", maxPriorityFeePerGasWei: o.max ?? "1000000000000000000", defaultSlippageBps: 50 };
  return x as AgentObservation;
}
// Gross gap |fair/mid - 1| of a single venue against fair 3000.
const below = (bps: number) => 3000 / (1 + bps / 10000);
// Bundle shapes: net edge = spread - (30 + 30 + 50) bps.
const SMALL_EDGE = { uni: 2976, curve: 3023.6 }; // spread 160 bps, net 50 bps; venue gaps 81 / 78 bps
const LARGE_EDGE = { uni: 2960, curve: 3040 }; // spread 270 bps, net 160 bps
const brief = (a: any) => a.type === "bundle" ? `bundle:${a.actions.map((l: any) => `${l.type}:${l.tokenIn}`).join("+")}`
  : a.type === "noop" ? `noop:${a.reason}` : `${a.type}:${a.tokenIn}`;

// ---------------- switched off = r3 ----------------

const synthetic = (): AgentObservation[] => [
  obs({ uni: below(100) }), obs({ uni: below(124) }), obs({ uni: below(130) }), obs({ uni: 3000 / 0.985 }),
  obs({ uni: below(400), usdc: 400_000_000_000n, rival: "50000000000" }),
  obs({ ...SMALL_EDGE }), obs({ ...LARGE_EDGE }), obs({ ...LARGE_EDGE, usdc: 100_000_000_000n, rival: "50000000000" }),
  obs({ ...LARGE_EDGE, usdc: 100_000_000_000n, rival: "0" }), obs({ ...LARGE_EDGE, usdc: 100_000_000_000n, rival: null }),
  obs({ uni: 2990, curve: 3000 / 1.013, curveFee: 50 }),
];

test("K1-K3 switched off: r3k decides exactly as r3 on the 32 real-log frames and 11 synthetic frames", async () => {
  let compared = 0;
  for (const window of fixture.windows) {
    const r3 = await load("ascon-zeta-r3"), r3k = await load("ascon-zeta-r3k", ALL_OFF);
    for (const { observation } of window.frames) {
      assert.deepEqual(await r3k.agent.decide(structuredClone(observation), noRpc),
        await r3.agent.decide(structuredClone(observation), noRpc), `${window.run}:${observation.blockNumber}`);
      compared++;
    }
  }
  const frames = synthetic();
  for (const [i, o] of frames.entries()) {
    const r3 = await load("ascon-zeta-r3"), r3k = await load("ascon-zeta-r3k", ALL_OFF);
    assert.deepEqual(await r3k.agent.decide(structuredClone(o), noRpc), await r3.agent.decide(structuredClone(o), noRpc), `synthetic ${i}`);
    compared++;
  }
  assert.equal(compared, 32 + frames.length);
});

test("non-vacuous: with the switches on, r3k departs from r3 on the synthetic frames K1 and K3 target", async () => {
  const differs: number[] = [];
  for (const [i, o] of synthetic().entries()) {
    const r3 = await load("ascon-zeta-r3"), r3k = await load("ascon-zeta-r3k");
    const a = await r3.agent.decide(structuredClone(o), noRpc), b = await r3k.agent.decide(structuredClone(o), noRpc);
    if (JSON.stringify(a) !== JSON.stringify(b)) differs.push(i);
  }
  // 0,1: single legs under 125 bps (K1); 4: single leg, 7: bundle, with profit >= $168 and a rival (K3).
  assert.deepEqual(differs, [0, 1, 4, 7]);
});

// ---------------- K1 ----------------

test("K1: single legs need a gross venue-to-fair gap of 125 bps; above it the r3 trade is unchanged", async () => {
  for (const [bps, expectTrade] of [[100, false], [124, false], [126, true], [200, true]] as const) {
    const r3 = await load("ascon-zeta-r3"), r3k = await load("ascon-zeta-r3k");
    const o = obs({ uni: below(bps) });
    const base = await r3.agent.decide(structuredClone(o), noRpc), ours = await r3k.agent.decide(structuredClone(o), noRpc);
    assert.equal(brief(base), "swap:USDC", `r3 trades a ${bps} bps gap (it clears 30 bps fee + 50 bps safety)`);
    if (expectTrade) assert.deepEqual(ours, base, `${bps} bps: unchanged r3 trade`);
    else assert.equal(brief(ours), "noop:single-leg gap below K1 floor", `${bps} bps`);
  }
});

test("K1: the floor is on the gross gap (the memo's |fair/mid - 1|), not on the gap net of fee+safety", async () => {
  // Curve with a 50 bps half-spread, 130 bps below fair: net of fee+safety only 30 bps, gross 130 bps.
  // (Uniswap 33 bps below fair: no bundle, and no Uniswap single leg.)
  const { delta } = await load("ascon-zeta-r3k");
  const o = obs({ uni: 2990, curve: 3000 / 1.013, curveFee: 50 });
  const on = delta.chooseAction(structuredClone(o), delta.PARAMS, { k1: true, k2Braked: false, k3: false });
  assert.equal(brief(on), "curveSwap:USDC");
  assert.deepEqual(on, delta.chooseAction(structuredClone(o), delta.PARAMS, delta.K_OFF));
});

test("K1 does not touch two-leg bundles", async () => {
  const { delta } = await load("ascon-zeta-r3k");
  const o = obs({ ...SMALL_EDGE }); // both venues within 81 bps of fair
  const on = delta.chooseAction(structuredClone(o), delta.PARAMS, { k1: true, k2Braked: false, k3: false });
  assert.equal(brief(on), "bundle:swap:USDC+curveSwap:WETH");
  assert.deepEqual(on, delta.chooseAction(structuredClone(o), delta.PARAMS, delta.K_OFF));
});

// ---------------- K2 ----------------

type TxOptions = { type?: "swap" | "curveSwap" | "balancerSwap"; tokenIn?: string; base?: string;
  from?: string; to?: string; selector?: string; wrongPosition?: boolean };
// Use the SDK ABIs to make real adapter-shaped calldata (including Balancer's dynamic tuple).
function swapTx(amount: string | bigint, o: TxOptions = {}) {
  const type = o.type ?? "swap", base = o.base ?? "WETH", buying = (o.tokenIn ?? "USDC") === "USDC";
  const baseToken = tokenInfo(base).address;
  const amountIn = BigInt(amount), limit = o.wrongPosition ? amountIn : 0n;
  const actualAmount = o.wrongPosition ? amountIn + 1n : amountIn;
  let to: string, input: string;
  if (type === "swap") {
    to = UNISWAP.swapRouter;
    input = encodeFunctionData({ abi: swapRouterAbi, functionName: "exactInputSingle", args: [{
      tokenIn: buying ? tokenInfo("USDC").address : baseToken,
      tokenOut: buying ? baseToken : tokenInfo("USDC").address,
      fee: marketFor("uniswap", base)!.uniswap!.fee, recipient: ME, deadline: 9999999999n,
      amountIn: actualAmount, amountOutMinimum: limit, sqrtPriceLimitX96: 0n,
    }] });
  } else if (type === "balancerSwap") {
    const market = marketFor("balancer", base)!.balancer!;
    to = BALANCER.vault;
    input = encodeFunctionData({ abi: balancerVaultAbi, functionName: "swap", args: [{
      poolId: market.poolId, kind: 0, assetIn: buying ? market.stable : baseToken,
      assetOut: buying ? baseToken : market.stable, amount: actualAmount, userData: "0x",
    }, { sender: ME, fromInternalBalance: false, recipient: ME, toInternalBalance: false }, limit, 9999999999n] });
  } else {
    const market = marketFor("curve", base)!.curve!;
    to = market.pool;
    input = encodeFunctionData({ abi: curveTricryptoAbi, functionName: "exchange", args: [
      BigInt(buying ? market.quoteIndex : market.baseIndex), BigInt(buying ? market.baseIndex : market.quoteIndex), actualAmount, limit,
    ] });
  }
  if (o.selector) input = o.selector + input.slice(10);
  return { from: o.from ?? ME.toUpperCase().replace("0X", "0x"), to: o.to ?? to, input };
}
// A mock chain: blocks of transactions and receipts. getBlock can be held back with `hold()`.
function chain() {
  const blocks = new Map<number, any[]>(), receipts = new Map<string, "success" | "reverted">();
  let gate: Promise<void> | undefined, open: (() => void) | undefined, reads = 0, n = 0;
  const publicClient = {
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      reads++;
      if (gate) await gate;
      return { transactions: blocks.get(Number(blockNumber)) ?? [] };
    },
    async getTransactionReceipt({ hash }: { hash: string }) { return { status: receipts.get(hash) }; },
  };
  return {
    ctx: { publicClient, log() {} } as unknown as AgentContext,
    get reads() { return reads; },
    // Default pair is Uniswap USDC in + Curve WETH in; overrides can represent other venues/late legs.
    mine(block: number, legs: [string | bigint, boolean, TxOptions?][]) {
      const txs = blocks.get(block) ?? [];
      for (const [i, [amount, filled, options]] of legs.entries()) {
        const hash = `0x${(++n).toString(16).padStart(64, "0")}`;
        const tx = swapTx(amount, options ?? (i % 2 === 0 ? {} : { type: "curveSwap", tokenIn: "WETH" }));
        txs.push({ hash, ...tx });
        receipts.set(hash, filled ? "success" : "reverted");
        txs.push({ hash: `${hash}ff`, ...tx, from: "0x2222222222222222222222222222222222222222" });
      }
      blocks.set(block, txs);
    },
    hold() { gate = new Promise(r => { open = r; }); },
    release() { open?.(); gate = undefined; },
  };
}
const bundleAction = (a: bigint, b: bigint) => ({ type: "bundle", actions: [
  { type: "swap", tokenIn: "USDC", amountIn: String(a) }, { type: "curveSwap", tokenIn: "WETH", amountIn: String(b) }] });
const at = (block: number) => ({ blockNumber: String(block), agentAddress: ME }) as unknown as AgentObservation;

// Drives brake.ts directly: a bundle at each block, settled in the next block as given.
async function settleSeries(brake: any, c: ReturnType<typeof chain>, start: number, outcomes: [boolean, boolean][]) {
  let block = start;
  for (const [buy, sell] of outcomes) {
    brake.k2Observe(at(block), c.ctx); await brake.k2Idle();
    brake.k2RecordBundle(block, bundleAction(BigInt(1000 + block), BigInt(5000 + block)));
    c.mine(block + 1, [[BigInt(1000 + block), buy], [BigInt(5000 + block), sell]]);
    block++;
  }
  brake.k2Observe(at(block), c.ctx); await brake.k2Idle();
  return block;
}
const ONE: [boolean, boolean] = [true, false], OTHER: [boolean, boolean] = [false, true], BOTH: [boolean, boolean] = [true, true], NONE: [boolean, boolean] = [false, false];

test("K2 trigger: >= 8 settled and >= 40% one-sided; 7 settled or 3/8 one-sided do not trigger", async () => {
  {
    const { brake } = await load("ascon-zeta-r3k"), c = chain();
    const end = await settleSeries(brake, c, 100, [ONE, OTHER, ONE, OTHER, ONE, OTHER, ONE]);
    assert.deepEqual(brake.k2Snapshot().window, [true, true, true, true, true, true, true]);
    assert.equal(brake.k2Braked(end + 1), false, "7 settled, all one-sided: below the 8-bundle minimum");
  }
  {
    const { brake } = await load("ascon-zeta-r3k"), c = chain();
    const end = await settleSeries(brake, c, 100, [ONE, BOTH, NONE, OTHER, BOTH, BOTH, ONE, BOTH]);
    assert.deepEqual(brake.k2Snapshot().window, [true, false, false, true, false, false, true, false], "both / none are not one-sided");
    assert.equal(brake.k2Braked(end + 1), false, "3 of 8 = 37.5% < 40%");
  }
  {
    const { brake } = await load("ascon-zeta-r3k"), c = chain();
    const end = await settleSeries(brake, c, 100, [ONE, BOTH, BOTH, OTHER, BOTH, BOTH, ONE, BOTH, BOTH, BOTH]);
    assert.equal(brake.k2Snapshot().brakeAt, undefined, "3/8, 3/9, 3/10 stay below 40%");
    await settleSeries(brake, c, end, [ONE]); // 4 of 11 = 36% -> still no
    assert.equal(brake.k2Snapshot().brakeAt, undefined);
  }
  {
    const { brake } = await load("ascon-zeta-r3k"), c = chain();
    const end = await settleSeries(brake, c, 100, [ONE, BOTH, BOTH, OTHER, BOTH, BOTH, ONE, OTHER]);
    assert.equal(brake.k2Snapshot().brakeAt, end, "4 of 8 = 50%: triggers at the block whose observation settled it");
    assert.deepEqual(brake.k2Snapshot().window, [], "a fresh window after the trigger");
  }
});

test("K2 window keeps the last 20 settlements; an unseen leg counts as not filled after 10 scanned blocks", async () => {
  const { brake } = await load("ascon-zeta-r3k"), c = chain();
  await settleSeries(brake, c, 100, Array.from({ length: 25 }, () => BOTH));
  assert.equal(brake.k2Snapshot().window.length, 20);
  const { brake: b2 } = await load("ascon-zeta-r3k"), c2 = chain();
  b2.k2Observe(at(200), c2.ctx);
  b2.k2RecordBundle(200, bundleAction(0n, 9n));
  b2.k2RecordBundle(200, { type: "swap", tokenIn: "USDC", amountIn: "7" });
  assert.equal(b2.k2Snapshot().pending, 0, "only two-leg bundles with nonzero amounts are tracked");
  b2.k2RecordBundle(200, bundleAction(7n, 9n));
  c2.mine(201, [[7n, true]]); // the sell leg is never mined
  for (let block = 201; block <= 209; block++) { b2.k2Observe(at(block), c2.ctx); await b2.k2Idle(); }
  assert.equal(b2.k2Snapshot().pending, 1, "9 blocks after the decision the missing leg may still land");
  b2.k2Observe(at(210), c2.ctx); await b2.k2Idle();
  assert.deepEqual(b2.k2Snapshot(), { pending: 0, window: [true], brakeAt: undefined, scannedThrough: 210, scanning: false });
});

for (const type of ["swap", "balancerSwap", "curveSwap"] as const) {
  for (const [name, invalid] of Object.entries({
    destination: { to: "0x3333333333333333333333333333333333333333" },
    selector: { selector: "0xdeadbeef" },
    position: { wrongPosition: true },
    token: { tokenIn: "WETH" },
    sender: { from: "0x2222222222222222222222222222222222222222" },
  })) {
    test(`K2 attribution: ${type} wrong ${name} must not match`, async () => {
      const { brake } = await load("ascon-zeta-r3k"), c = chain();
      brake.k2Observe(at(100), c.ctx);
      const action = bundleAction(77n, 99n);
      action.actions[0].type = type;
      brake.k2RecordBundle(100, action);
      c.mine(101, [[77n, true, { type, ...invalid }], [99n, false]]);
      brake.k2Observe(at(101), c.ctx); await brake.k2Idle();
      assert.equal(brake.k2Snapshot().pending, 1, "unrelated tx must leave the buy leg unmatched");
      assert.deepEqual(brake.k2Snapshot().window, []);
      // The correctly encoded buy can still claim the leg on the next block.
      c.mine(102, [[77n, true, { type }]]);
      brake.k2Observe(at(102), c.ctx); await brake.k2Idle();
      assert.equal(brake.k2Snapshot().pending, 0);
      assert.deepEqual(brake.k2Snapshot().window, [true]);
    });
  }
}

test("K2 attribution: same-amount legs claim each tx once, oldest first, including within one block", async () => {
  const { brake } = await load("ascon-zeta-r3k"), c = chain();
  brake.k2Observe(at(100), c.ctx);
  brake.k2RecordBundle(100, bundleAction(77n, 91n));
  brake.k2Observe(at(101), c.ctx); await brake.k2Idle();
  brake.k2RecordBundle(101, bundleAction(77n, 92n));
  c.mine(102, [[77n, true], [91n, false], [92n, true, { type: "curveSwap", tokenIn: "WETH" }]]);
  brake.k2Observe(at(102), c.ctx); await brake.k2Idle();
  assert.deepEqual(brake.k2Snapshot().window, [true], "the one buy belongs only to the older bundle");
  assert.equal(brake.k2Snapshot().pending, 1);
  c.mine(103, [[77n, true]]);
  brake.k2Observe(at(103), c.ctx); await brake.k2Idle();
  assert.deepEqual(brake.k2Snapshot().window, [true, false]);
  assert.equal(brake.k2Snapshot().pending, 0);

  brake.k2RecordBundle(103, bundleAction(88n, 93n));
  brake.k2RecordBundle(103, bundleAction(88n, 94n));
  c.mine(104, [[88n, true], [93n, false], [88n, false], [94n, true]]);
  brake.k2Observe(at(104), c.ctx); await brake.k2Idle();
  assert.deepEqual(brake.k2Snapshot().window, [true, false, true, true]);
  assert.equal(brake.k2Snapshot().pending, 0, "two same-amount txs each claim a distinct leg");
});

test("K2 late legs: second success through block 10 makes the bundle two-sided", async () => {
  for (const delay of [6, 10]) {
    const { brake } = await load("ascon-zeta-r3k"), c = chain();
    brake.k2Observe(at(100), c.ctx); brake.k2RecordBundle(100, bundleAction(77n, 99n));
    c.mine(101, [[77n, true]]);
    for (let block = 101; block < 100 + delay; block++) {
      brake.k2Observe(at(block), c.ctx); await brake.k2Idle();
      assert.equal(brake.k2Snapshot().pending, 1);
      assert.deepEqual(brake.k2Snapshot().window, []);
    }
    c.mine(100 + delay, [[99n, true, { type: "curveSwap", tokenIn: "WETH" }]]);
    brake.k2Observe(at(100 + delay), c.ctx); await brake.k2Idle();
    assert.equal(brake.k2Snapshot().pending, 0);
    assert.deepEqual(brake.k2Snapshot().window, [false]);
  }
});

test("K2 expiry: no observed legs is no evidence; failure plus missing is not one-sided", async () => {
  const { brake } = await load("ascon-zeta-r3k"), c = chain();
  brake.k2Observe(at(100), c.ctx);
  brake.k2RecordBundle(100, bundleAction(77n, 99n));
  brake.k2RecordBundle(100, bundleAction(78n, 98n));
  c.mine(101, [[78n, false]]);
  for (let b = 101; b <= 110; b++) { brake.k2Observe(at(b), c.ctx); await brake.k2Idle(); }
  assert.equal(brake.k2Snapshot().pending, 0);
  assert.deepEqual(brake.k2Snapshot().window, [false]);
});

test("K2 timeout: a hung getBlock releases scan at 2 s without advancing cursor or recording evidence", async () => {
  const { brake } = await load("ascon-zeta-r3k"), c = chain();
  brake.k2Observe(at(100), c.ctx); brake.k2RecordBundle(100, bundleAction(77n, 99n));
  c.mine(101, [[77n, true], [99n, false]]);
  c.hold();
  const start = performance.now();
  brake.k2Observe(at(101), c.ctx);
  try {
    assert.equal(brake.k2Snapshot().scanning, true);
    await new Promise(r => setTimeout(r, 2100));
    assert.equal(brake.k2Snapshot().scanning, false, "local 2 s deadline must release the scan");
    assert.ok(performance.now() - start < 2800);
    assert.equal(brake.k2Snapshot().scannedThrough, 100);
    assert.deepEqual(brake.k2Snapshot().window, []);
  } finally { c.release(); await brake.k2Idle(); }
  await new Promise(r => setImmediate(r));
  assert.deepEqual(brake.k2Snapshot().window, [], "late RPC completion cannot commit evidence");
  brake.k2Observe(at(102), c.ctx); await brake.k2Idle();
  assert.deepEqual(brake.k2Snapshot().window, [true], "next observation retries the same block");
});

test("K2 RPC errors: failed blocks/receipts keep the cursor and discard all partial claims before retry", async () => {
  for (const method of ["getBlock", "getTransactionReceipt"] as const) {
    const { brake } = await load("ascon-zeta-r3k"), c = chain();
    brake.k2Observe(at(100), c.ctx);
    brake.k2RecordBundle(100, bundleAction(77n, 99n));
    brake.k2RecordBundle(100, bundleAction(77n, 98n));
    c.mine(101, [[77n, true], [99n, false], [77n, false], [98n, true]]);
    const client = c.ctx.publicClient as any, original = client[method];
    let calls = 0;
    client[method] = async (args: any) => {
      if (++calls === (method === "getBlock" ? 1 : 2)) throw new Error("RPC unavailable");
      return original(args);
    };
    brake.k2Observe(at(101), c.ctx); await brake.k2Idle();
    assert.equal(brake.k2Snapshot().scanning, false);
    assert.equal(brake.k2Snapshot().scannedThrough, 100);
    assert.deepEqual(brake.k2Snapshot().window, []);
    assert.equal(brake.k2Snapshot().pending, 2);
    client[method] = original;
    brake.k2Observe(at(102), c.ctx); await brake.k2Idle();
    assert.deepEqual(brake.k2Snapshot().window, [true, true], "retry preserves original tx-to-leg attribution");
    assert.equal(brake.k2Snapshot().pending, 0);
  }
});

test("K2 receipts: at most 4 concurrent requests; hung receipts release scan with no outcome", async () => {
  const { brake } = await load("ascon-zeta-r3k"), c = chain();
  brake.k2Observe(at(100), c.ctx);
  for (let i = 0; i < 4; i++) {
    brake.k2RecordBundle(100, bundleAction(BigInt(77 + i), BigInt(99 + i)));
    c.mine(101, [[BigInt(77 + i), true], [BigInt(99 + i), true]]);
  }
  const client = c.ctx.publicClient as any, original = client.getTransactionReceipt;
  let active = 0, max = 0, calls = 0, release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  client.getTransactionReceipt = async (args: any) => {
    calls++; active++; max = Math.max(max, active);
    try { await gate; return await original(args); } finally { active--; }
  };
  brake.k2Observe(at(101), c.ctx);
  try {
    await new Promise(r => setTimeout(r, 2100));
    assert.equal(calls, 4);
    assert.equal(max, 4);
    assert.equal(brake.k2Snapshot().scanning, false);
    assert.equal(brake.k2Snapshot().scannedThrough, 100);
    assert.deepEqual(brake.k2Snapshot().window, []);
    brake.k2Observe(at(102), c.ctx);
    // Avoid hanging the red check if the timeout implementation is intentionally disabled.
    await new Promise(r => setTimeout(r, 20));
    assert.equal(brake.k2Snapshot().scanning, false);
    assert.equal(calls, 4, "unresolved transport requests retain their slots across retries");
  } finally { release(); await brake.k2Idle(); }
  await new Promise(r => setImmediate(r));
  assert.deepEqual(brake.k2Snapshot().window, [], "late receipts cannot settle timed-out work");
  brake.k2Observe(at(103), c.ctx); await brake.k2Idle();
  assert.equal(max, 4);
  assert.equal(brake.k2Snapshot().pending, 0);
  assert.deepEqual(brake.k2Snapshot().window, [false, false, false, false]);
});

test("K2 pause: exactly the 36 blocks after the trigger, then resume; reset at an epoch start", async () => {
  const { brake } = await load("ascon-zeta-r3k"), c = chain();
  const end = await settleSeries(brake, c, 100, Array.from({ length: 8 }, () => ONE));
  assert.equal(brake.k2Snapshot().brakeAt, end);
  assert.equal(brake.k2Braked(end), false, "the trigger block's own decision is already made");
  for (let block = end + 1; block <= end + 36; block++) assert.equal(brake.k2Braked(block), true, `block ${block}`);
  assert.equal(brake.k2Braked(end + 37), false, "resumes after 36 blocks");
  // Epoch start: a block discontinuity clears the window, pending bundles and the pause.
  brake.k2RecordBundle(end, bundleAction(1n, 2n));
  brake.k2Observe(at(end + 1), c.ctx); await brake.k2Idle();
  assert.equal(brake.k2Braked(end + 2), true);
  brake.k2Observe(at(5), c.ctx); // block went backwards: a new epoch
  assert.deepEqual(brake.k2Snapshot(), { pending: 0, window: [], brakeAt: undefined, scannedThrough: undefined, scanning: false });
  assert.equal(brake.k2Braked(6), false);
  // Jumping forward by more than one block is also an epoch start.
  const { brake: b2 } = await load("ascon-zeta-r3k"), c2 = chain();
  const e2 = await settleSeries(b2, c2, 100, Array.from({ length: 8 }, () => OTHER));
  assert.equal(b2.k2Braked(e2 + 1), true);
  b2.k2Observe(at(e2 + 3), c2.ctx);
  assert.equal(b2.k2Braked(e2 + 4), false);
});

test("K2: a read still in flight from the previous epoch cannot write into the new one", async () => {
  const { brake } = await load("ascon-zeta-r3k"), c = chain();
  brake.k2Observe(at(100), c.ctx); brake.k2RecordBundle(100, bundleAction(3n, 4n));
  c.mine(101, [[3n, true], [4n, false]]);
  c.hold();
  brake.k2Observe(at(101), c.ctx);
  assert.equal(brake.k2Snapshot().scanning, true);
  brake.k2Observe(at(7), c.ctx); // new epoch while the read of block 101 is held
  c.release(); await new Promise(r => setTimeout(r, 20)); await brake.k2Idle();
  assert.deepEqual(brake.k2Snapshot(), { pending: 0, window: [], brakeAt: undefined, scannedThrough: undefined, scanning: false });
});

// Full agent: decide() each block, the chain settles each bundle one-sided in the next block.
async function brakeTheAgent(r3k: any, c: ReturnType<typeof chain>, first: number) {
  let block = first;
  for (let i = 0; i < 9; i++, block++) {
    const action = await r3k.agent.decide(obs({ ...SMALL_EDGE, block, usdc: 20_000_000_000n + BigInt(block) * 1_000_000n }), c.ctx);
    assert.equal(brief(action), "bundle:swap:USDC+curveSwap:WETH", `block ${block}`);
    await r3k.brake.k2Idle();
    c.mine(block + 1, [[action.actions[0].amountIn, true], [action.actions[1].amountIn, false]]);
  }
  return block - 1; // the 8th settlement is read during the 9th decision
}

test("K2 through decide(): small-edge bundles stop for 36 blocks, large-edge bundles never stop, then resume", async () => {
  const r3k = await load("ascon-zeta-r3k"), c = chain();
  const trigger = await brakeTheAgent(r3k, c, 100);
  assert.equal(r3k.brake.k2Snapshot().brakeAt, trigger);
  const seen: string[] = [];
  for (let block = trigger + 1; block <= trigger + 37; block++) {
    const shape = block === trigger + 10 || block === trigger + 36 ? LARGE_EDGE : SMALL_EDGE;
    const action = await r3k.agent.decide(obs({ ...shape, block }), c.ctx);
    await r3k.brake.k2Idle();
    seen.push(brief(action));
    if (shape === LARGE_EDGE) assert.equal(brief(action), "bundle:swap:USDC+curveSwap:WETH", `large edge at ${block} is never braked`);
    else if (block <= trigger + 36) assert.equal(brief(action), "noop:single-leg gap below K1 floor", `small edge at ${block} is paused`);
    else assert.equal(brief(action), "bundle:swap:USDC+curveSwap:WETH", `resumed at ${block}`);
  }
  assert.equal(seen.filter(s => s.startsWith("bundle")).length, 3);
  // Same flow with K2 switched off: every small-edge bundle goes out.
  const off = await load("ascon-zeta-r3k", ["K2_BUNDLE_BRAKE"]), c2 = chain();
  for (let block = 100; block <= 120; block++) {
    const action = await off.agent.decide(obs({ ...SMALL_EDGE, block }), c2.ctx);
    assert.equal(brief(action), "bundle:swap:USDC+curveSwap:WETH");
  }
  assert.equal(c2.reads, 0, "K2 off reads nothing from the chain");
});

test("K2 through decide(): a pending settlement read does not block the decision", async () => {
  const r3k = await load("ascon-zeta-r3k"), c = chain();
  const first = await r3k.agent.decide(obs({ ...SMALL_EDGE, block: 100 }), c.ctx);
  c.mine(101, [[first.actions[0].amountIn, true], [first.actions[1].amountIn, false]]);
  c.hold(); // every getBlock now waits until release()
  const started = performance.now();
  const decided = await Promise.race([
    r3k.agent.decide(obs({ ...SMALL_EDGE, block: 101 }), c.ctx),
    new Promise(r => setTimeout(() => r("blocked"), 1000)),
  ]);
  assert.notEqual(decided, "blocked");
  assert.equal(brief(decided), "bundle:swap:USDC+curveSwap:WETH");
  assert.ok(performance.now() - started < 500, "decided without waiting for the read");
  assert.deepEqual({ ...r3k.brake.k2Snapshot(), scannedThrough: undefined }, { pending: 2, window: [], brakeAt: undefined, scannedThrough: undefined, scanning: true });
  // The next block's decision is not held either; the earlier read is still running, so none starts.
  assert.equal(brief(await r3k.agent.decide(obs({ ...SMALL_EDGE, block: 102 }), c.ctx)), "bundle:swap:USDC+curveSwap:WETH");
  c.release(); await r3k.brake.k2Idle();
  assert.deepEqual(r3k.brake.k2Snapshot().window, [true], "the held read settles the first bundle once released");
});

// ---------------- K3 ----------------
// K3 returning r3's own bid is intentional: r3k never bids below r3, even above either cap.

test("K3 bid formula: max(own, rival x 1.2), capped at 0.30 x profit / (fair x 140k x legs) and the max fee", async () => {
  const { delta } = await load("ascon-zeta-r3k");
  const o = (rival: string | null, max = "1000000000000000000") => obs({ uni: 3000, rival, max });
  const own = String(50n * GWEI + GWEI / 10n);
  const e = 1 / 64; // 156.25 bps, exact in binary so the $168 boundary is exact
  // Below $168 expected profit: r3's bid, whatever the rival.
  assert.equal(delta.largeEdgeBid(o("50000000000"), own, e, 10_751, 2), own, "$167.98");
  // $400 on two legs: cap = 0.3 x 400 / 3000 ETH / 280k gas = 142.857 gwei; rival 50 -> 60 gwei.
  assert.equal(delta.largeEdgeBid(o("50000000000"), own, e, 25_600, 2), String(60n * GWEI));
  // Exactly $168 on two legs: cap 60 gwei (the memo's table); rival 100 gwei wants 120 -> 60.
  assert.equal(delta.largeEdgeBid(o("100000000000"), String(GWEI), e, 10_752, 2), String(60n * GWEI));
  // One leg doubles the cap: 120 gwei.
  assert.equal(delta.largeEdgeBid(o("100000000000"), String(GWEI), e, 10_752, 1), String(120n * GWEI));
  // maxPriorityFeePerGasWei caps it, but never below r3's own bid.
  assert.equal(delta.largeEdgeBid(o("50000000000", String(55n * GWEI)), own, e, 25_600, 2), String(55n * GWEI));
  assert.equal(delta.largeEdgeBid(o("50000000000", String(10n * GWEI)), own, e, 25_600, 2), own);
  // Rival unknown (0 or no competition signal): r3's own bid.
  assert.equal(delta.largeEdgeBid(o("0"), own, e, 25_600, 2), own);
  assert.equal(delta.largeEdgeBid(o(null), own, e, 25_600, 2), own);
  // Own bid already above rival x 1.2: unchanged.
  assert.equal(delta.largeEdgeBid(o("10000000000"), own, e, 25_600, 2), own);
});

test("K3 through decide(): the large-edge bundle bids 60 gwei against a 50 gwei rival where r3 bids 50.1", async () => {
  const r3 = await load("ascon-zeta-r3"), r3k = await load("ascon-zeta-r3k");
  const o = obs({ ...LARGE_EDGE, usdc: 100_000_000_000n, rival: "50000000000" }); // 25,000 USDC x 160 bps = $400
  const base = await r3.agent.decide(structuredClone(o), noRpc), ours = await r3k.agent.decide(structuredClone(o), noRpc);
  assert.equal(base.maxPriorityFeePerGasWei, String(50n * GWEI + GWEI / 10n));
  assert.equal(ours.maxPriorityFeePerGasWei, String(60n * GWEI));
  assert.deepEqual({ ...ours, maxPriorityFeePerGasWei: "x" }, { ...base, maxPriorityFeePerGasWei: "x" }, "only the bid changes");
  // Single leg: 400 bps below fair, 100,000 USDC x 25% x 320 bps net = $800, one leg: cap 571 gwei -> 60.
  const s = obs({ uni: below(400), usdc: 100_000_000_000n, rival: "50000000000" });
  const sBase = await (await load("ascon-zeta-r3")).agent.decide(structuredClone(s), noRpc);
  const sOurs = await (await load("ascon-zeta-r3k")).agent.decide(structuredClone(s), noRpc);
  assert.equal(sBase.maxPriorityFeePerGasWei, String(50n * GWEI + GWEI / 10n));
  assert.equal(sOurs.maxPriorityFeePerGasWei, String(60n * GWEI));
  // Small expected profit (20,000 USDC x 25% x 160 bps = $80) keeps r3's bid.
  const small = obs({ ...LARGE_EDGE, rival: "50000000000" });
  assert.deepEqual(await (await load("ascon-zeta-r3k")).agent.decide(structuredClone(small), noRpc),
    await (await load("ascon-zeta-r3")).agent.decide(structuredClone(small), noRpc));
});

// Sequential local mutation checks. Only xa-1/agent.ts is ever mutated.
// Run before freezing xa-1 for a matrix; xb-r / upstream-eval are never touched.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourcePath = join(root, "example/agents/xa-1/agent.ts");
const original = readFileSync(sourcePath, "utf8");
const digest = text => createHash("sha256").update(text).digest("hex");
const sha256 = digest(original), evidence = mkdtempSync(join(tmpdir(), "xa-1-red-controls-"));
const controls = [
  ["AI-bounds", "XA parameters", "p.ENTRY_BPS < 20 || p.ENTRY_BPS > 60", "false"],
  ["AI-entry", "XA ENTRY threshold", "if (!(edge * 10000 > p.ENTRY_BPS)) continue;", "if (false) continue;"],
  ["round-trip-profit", "XA single edge alone", "if (plannedNet < POLICY.minProfit) continue;", "if (false) continue;"],
  ["independent-exit-funds", "XA cash and independent", "!funded(obs, m.base, reservedBase)", "false"],
  ["canFund", "XA cash and independent", "amount <= held && canFund(normalized, token)", "amount <= held"],
  ["both-gas", "XA two ceiling gas", "w.ETH - 2n * ceiling < GAS_RESERVE", "w.ETH - ceiling < GAS_RESERVE"],
  ["native-reserve", "XA two ceiling gas", "const W = 10n ** 18n, GAS_RESERVE = W / 20n;", "const W = 10n ** 18n, GAS_RESERVE = 0n;"],
  ["bid-clipping", "XA bid target", "return wanted <= budget ? wanted : 0n;", "return min(wanted, budget);"],
  ["bid-increment", "XA bid target", "const target = rival + 100_000_000n;", "const target = rival;"],
  ["slippage", "XA complete plan", "slippageBps: 20", "slippageBps: 80"],
  ["holding-cost", "XA complete plan", "sold(q, exit, m.fair) - usd - holdCost", "sold(q, exit, m.fair) - usd"],
  ["exit-cost-plan", "XA complete plan", "BigInt(POLICY.gasUnits) * fee + ceiling", "BigInt(POLICY.gasUnits) * fee"],
  ["initial-exposure-cap", "XA small initial holdings", "room * entry.mid / 1.008, entry.depth", "entry.depth"],
  ["entry-loss-envelope", "XA observed exit depth", "if (liquidation < -lossLimit) continue;", "if (false) continue;"],
  ["pending-lock", "XA pending entry", "if (s.pending) return noop(\"pending confirmation; both legs reserved\");", "if (false) return noop(\"pending confirmation; both legs reserved\");"],
  ["debit-confirmation", "XA settlement requires", "cash === -BigInt(action.amountIn) && qty > 0n", "cash < 0n && qty > 0n"],
  ["proceeds-confirmation", "XA settlement requires", "cash === -BigInt(action.amountIn) && qty > 0n", "cash === -BigInt(action.amountIn) && qty >= 0n"],
  ["gas-confirmation", "XA settlement requires", "const confirmed = gas > 0n", "const confirmed = gas >= 0n"],
  ["other-base-confirmation", "XA settlement requires", "const confirmed = gas > 0n && w[other] === before[other]", "const confirmed = gas > 0n"],
  ["actual-lot", "XA delayed balance confirmation", "quantity: qty, entryGasWei", "quantity: plan.expectedQuantity, entryGasWei"],
  ["initial-inventory", "XA profitable exit", "trade(lot.base, v, lot.base, lot.quantity, fee)", "trade(lot.base, v, lot.base, w[lot.base], fee)"],
  ["no-single-exit-edge", "XA profitable exit", "if (q * v.mid > v.depth * 0.005) continue;", "if (q * v.mid > v.depth * 0.005 || v.mid / m.fair - 1 - v.cost <= 0) continue;"],
  ["exit-liquidity", "XA exit depth must", "if (q * v.mid > v.depth * 0.005) continue;", "if (false) continue;"],
  ["time-limited-recovery", "XA time limit", "const due = block >= lot.deadlineBlock", "const due = false && block >= lot.deadlineBlock"],
  ["loss-floor", "XA loss floor", "(due && net >= -lot.lossLimit)", "due"],
  ["initial-floor", "XA exit cannot spend initial", "w[lot.base] - lot.quantity < initial[lot.base]", "false"],
  ["actual-entry-gas", "XA exact closure", "- lot.entryGasUsd - gasUsd(obs, gas)", "- gasUsd(obs, gas)"],
  ["loss-accounting", "XA realized loss", "s.lossSpent += Math.max(0, -netUsd);", "s.lossSpent += 0;"],
  ["entry-time-buffer", "XA entry horizon", "left <= POLICY.entryLag + POLICY.maxHold + POLICY.exitBuffer", "left <= POLICY.exitBuffer"],
  ["terminal-recovery", "XA terminal buffer", "|| left <= POLICY.exitBuffer", ""],
  ["valuation-boundary", "XA final block", "if (horizon(obs) <= 0) return noop", "if (false) return noop"],
  ["exit-debit", "XA exit settlement", "qty === -BigInt(action.amountIn) && cash > 0n", "qty < 0n && cash > 0n"],
  ["exit-cash", "XA exit settlement", "qty === -BigInt(action.amountIn) && cash > 0n", "qty === -BigInt(action.amountIn) && cash >= 0n"],
  ["exit-gas-reserve", "XA exit gas and competitive", "w.ETH - costWei < GAS_RESERVE", "false"],
  ["WBTC-decimals", "XA WBTC accounting", "const decimals = base === \"WETH\" ? 18 : 8;", "const decimals = 18;"],
  ["route-bids", "XA LIVE scopes route", "core.decide(obs, bids)", "core.decide(obs, undefined)"],
  ["own-bid-exclusion", "XA LIVE scopes route", "tx.from.toLowerCase() === obs.agentAddress.toLowerCase()", "false"],
  ["pinned-block", "XA LIVE failed incomplete", "if (block.number !== BigInt(obs.blockNumber)) return undefined;", "if (false) return undefined;"],
  ["real-fixture-route", "XA real dev4", "core.decide(obs, bids)", "core.decide(obs, undefined)"],
];
const records = [];
function run(label, pattern) {
  const args = ["--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap"];
  if (pattern) args.push(`--test-name-pattern=^${pattern}`);
  args.push("test/xa-1.test.ts");
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 20000,
    env: { ...process.env, TSX_DISABLE_CACHE: "1" } });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(join(evidence, `${label}.log`), log);
  assert.equal(result.error, undefined, `${label}: infrastructure failure`);
  return { result, log };
}
writeFileSync(join(evidence, "agent-original.ts"), original);
try {
  assert.equal(run("baseline").result.status, 0, "baseline must be green");
  for (const [id, pattern, from, to] of controls) {
    assert.equal(original.split(from).length, 2, `${id}: unique mutation anchor required`);
    let r;
    try {
      writeFileSync(sourcePath, original.replace(from, to));
      r = run(id, pattern);
    } finally { writeFileSync(sourcePath, original); }
    assert.equal(digest(readFileSync(sourcePath, "utf8")), sha256, `${id}: exact restoration`);
    assert.equal(r.result.status, 1, `${id}: must exit 1; see ${evidence}`);
    assert.match(r.log, /ERR_ASSERTION/, `${id}: assertion failure, not load/syntax error`);
    assert.match(r.log, new RegExp(`not ok \\d+ - ${pattern}`));
    records.push({ id, pattern, exitCode: 1, restoredSha256: sha256, logSha256: digest(r.log) });
    console.log(`RED ${id}; restored ${sha256.slice(0, 12)}`);
  }
} finally {
  writeFileSync(sourcePath, original);
  assert.equal(digest(readFileSync(sourcePath, "utf8")), sha256);
  writeFileSync(join(evidence, "controls.json"), JSON.stringify({ sha256, controls: records }, null, 2) + "\n");
}
const green = run("restored");
assert.equal(green.result.status, 0);
console.log(JSON.stringify({ controls: records.length, tests: Number(green.log.match(/^# pass (\d+)/m)?.[1]),
  restoredSha256: sha256, evidence }));

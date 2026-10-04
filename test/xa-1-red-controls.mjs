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
  ["debit-confirmation", "XA tolerant bounds", "debitMatches(debit, amount) &&", "debit > 0n &&"],
  ["proceeds-confirmation", "XA settlement requires", "pending.phase === \"entry\" ? qty > 0n : cash > 0n", "pending.phase === \"entry\" ? qty >= 0n : cash > 0n"],
  ["gas-confirmation", "XA settlement requires", "const confirmed = gas > 0n", "const confirmed = gas >= 0n"],
  ["other-base-confirmation", "XA tolerant bounds", "abs(w[other] - before[other]) <= otherDust", "true"],
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
  ["exit-debit", "XA exit settlement", "debitMatches(debit, amount) &&", "(pending.phase === \"exit\" || debitMatches(debit, amount)) &&"],
  ["exit-cash", "XA exit settlement", "pending.phase === \"entry\" ? qty > 0n : cash > 0n", "pending.phase === \"entry\" ? qty > 0n : cash >= 0n"],
  ["exit-gas-reserve", "XA exit gas and competitive", "w.ETH - costWei < GAS_RESERVE", "false"],
  ["WBTC-decimals", "XA WBTC accounting", "const decimals = base === \"WETH\" ? 18 : 8;", "const decimals = 18;"],
  ["route-bids", "XA LIVE scopes route", "core.decide(obs, bids, evidence)", "core.decide(obs, undefined, evidence)"],
  ["own-bid-exclusion", "XA LIVE scopes route", "tx.from.toLowerCase() === obs.agentAddress.toLowerCase()", "false"],
  ["pinned-block", "XA LIVE failed incomplete", "if (block.number !== BigInt(obs.blockNumber)) return undefined;", "if (false) return undefined;"],
  ["real-fixture-route", "XA real dev4", "core.decide(obs, bids, evidence)", "core.decide(obs, undefined, evidence)"],
  ["telemetry-round", "XA telemetry production gate accepts", "ctx?.log({ round, action, state:", "ctx?.log({ action, state:"],
  ["telemetry-full-ledger", "XA telemetry compact ledger", "mode: s.unresolved ?", "...JSON.parse(JSON.stringify(s, (_, v) => typeof v === 'bigint' ? String(v) : v)), mode: s.unresolved ?"],
  ["confirmation-deadline", "XA dev6s rejected entry", "block - s.pending.sentBlock >= POLICY.confirmationBlocks", "false"],
  ["late-confirmation", "XA dev6s rejected entry", "const pending = s.pending ?? s.unresolved;", "const pending = s.pending;"],
  ["timeout-retains-reservation", "XA recovery timeout never unlocks", "s.unresolved = s.pending; s.pending = undefined;", "s.pending = undefined;"],
  ["unresolved-exit-lock", "XA recovery timeout never resells", "if (s.unresolved) return noop", "if (false) return noop"],
  ["recovery-stops-new-entry", "XA dev6s rejected entry", "s.halt === \"ambiguous settlement or failed transaction\") s.halt = undefined;", "s.halt === \"ambiguous settlement or failed transaction\") s.halt = \"confirmation deadline; recovery only\";"],
  ["tolerance-regression", "XA dev7 tolerant debit", "abs(debit - amount) <= amount / 1_000_000n + 1n", "debit === amount"],
  ["tolerance-stability", "XA dev7 tolerant debit", "if (!exact && !stable) return;", "if (false) return;"],
  ["split-read-halt", "XA dev7 split balance", "if (!confirmed) { pending.match = undefined; return; }", "if (!confirmed) { s.halt = \"permanent ambiguity\"; pending.match = undefined; return; }"],
  ["timeout-no-evidence", "XA dev7 failed submit", "const recovered = recover(s, obs, w, evidence);", "const recovered = recover(s, obs, w, undefined);"],
  ["recovery-nonce-pending", "XA recovery requires matching", "evidence.pending === evidence.confirmed &&", "true &&"],
  ["recovery-nonce-block", "XA recovery requires matching", "evidence.block === block &&", "true &&"],
  ["recovery-nonce-send", "XA recovery requires matching", "evidence.sentBlock === p.sentBlock &&", "true &&"],
  ["recovery-balance-change", "XA recovery requires matching", "w.USDC === p.before.USDC && BASES.every(b => w[b] === p.before[b])", "true"],
  ["recovery-grace", "XA dev7 failed submit", "p.quiet.count < POLICY.recoveryObservations", "p.quiet.count < 1"],
  ["recovery-consecutive", "XA recovery consecutive", "prior?.block === block - 1 && prior.nonce", "prior !== undefined && prior.nonce"],
  ["recovery-clear-on-read-error", "XA recovery consecutive", "if (!valid) { p.quiet = undefined; return false; }", "if (!valid) { return false; }"],
  ["recovery-actual-wallet", "XA recovery gas-only failed entry", "s.wallet = { ...w }; s.pending = undefined; s.unresolved = undefined;", "s.pending = undefined; s.unresolved = undefined;"],
  ["recovery-gas-cost", "XA recovery gas-only failed entry", "else { s.realizedNet -= cost; s.lossSpent += cost; }", "else { s.realizedNet -= 0; s.lossSpent += 0; }"],
  ["recovery-exit-lot", "XA recovery failed exit", "s.recovered = { sentBlock: p.sentBlock, block, phase: p.phase };", "s.lot = undefined; s.recovered = { sentBlock: p.sentBlock, block, phase: p.phase };"],
  ["recovery-exit-gas", "XA recovery failed exit", "s.lot.entryGasWei += gas; s.lot.entryGasUsd += cost;", "s.lot.entryGasWei += 0n; s.lot.entryGasUsd += 0;"],
  ["recovery-hard-halt", "XA recovery gas-only failed entry", "s.halt ??= \"confirmation deadline; recovery only\";", "s.halt = \"confirmation deadline; recovery only\";"],
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
  // The exact user-named pre-repair source must fail the real-log regression,
  // not just a hand-picked line mutation. All tests/fixtures remain current.
  for (const [commit, pattern] of [["7179efe", "XA dev6s rejected entry"],
      ["6cd9e70", "XA dev7 failed submit"], ["6cd9e70", "XA dev7 tolerant debit"]]) {
    const id = `${commit}-${pattern.split(" ").slice(1, 4).join("-")}`;
    const legacy = spawnSync("git", ["show", `${commit}:example/agents/xa-1/agent.ts`], { cwd: root, encoding: "utf8" });
    assert.equal(legacy.status, 0, "read historical source");
    let red;
    try {
      writeFileSync(sourcePath, legacy.stdout);
      red = run(id, pattern);
    } finally { writeFileSync(sourcePath, original); }
    assert.equal(digest(readFileSync(sourcePath, "utf8")), sha256);
    assert.equal(red.result.status, 1);
    assert.match(red.log, /ERR_ASSERTION/);
    assert.match(red.log, new RegExp(`not ok \\d+ - ${pattern}`));
    records.push({ id, pattern, exitCode: 1, restoredSha256: sha256,
      legacySha256: digest(legacy.stdout), logSha256: digest(red.log) });
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

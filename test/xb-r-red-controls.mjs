// Run manually, with no concurrent evaluation consuming THIS source tree:
// node test/xb-r-red-controls.mjs (sequential; never changes another worktree).
// Temporarily mutates ONLY xb-r/agent.ts, restores after each run and in finally,
// then reruns the complete xb test subset. Evidence stays in a unique temp directory.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourcePath = resolve(root, "example/agents/xb-r/agent.ts");
const original = readFileSync(sourcePath, "utf8");
const evidence = mkdtempSync(join(tmpdir(), "xb-r-red-controls-"));
const digest = s => createHash("sha256").update(s).digest("hex");
writeFileSync(join(evidence, "agent-original.ts"), original);
const controls = [
  ["LIVE-unscoped-oracle", "LIVE replay block", "p, execution?.bids);", "p, undefined);"],
  ["LIVE-own-bid", "LIVE R4 scopes bids", "tx.from.toLowerCase() === obs.agentAddress.toLowerCase()", "false"],
  ["LIVE-total-deadline", "LIVE deadline includes", "execution?.started ?? now()", "now()"],
  ["R1-priority", "R1 selects a funded bundle", "const priority = p.R1_BUNDLE_PRIORITY", "const priority = false"],
  ["R1-cooldown", "R1 bundle ignores cooldown", "(!p.R1_BUNDLE_PRIORITY && cooling.has(m.base))", "cooling.has(m.base)"],
  ["R2-size", "R2 balance floor raises size", "floor ? Math.max(depthTarget, balanceTarget) : depthTarget", "depthTarget"],
  ["R3-double-margin", "R3 an extra 60bps deduction", "p.R3_ENTRY_ONLY ? 0 : 0.006", "p.R3_ENTRY_ONLY ? 0.006 : 0.006"],
  ["R4-budget-bid", "R4 pays competitor plus", "p.R4_COMPETITOR_BID);", "false);"],
  ["R4-zero-send", "R4 unaffordable competitor", "fee <= 0n || !Number.isFinite(net)", "!Number.isFinite(net)"],
  ["R5-restore-off", "R5 endgame restores only", "R5_PROFITABLE_RESTORE: true", "R5_PROFITABLE_RESTORE: false"],
  ["R5-net-guard", "R5 restoration cannot pass", "net < MIN_PROFIT_USDC", "false"],
  ["R5-loose-slippage", "R5 single and bundle slippage", "const SLIPPAGE_BPS = 80;", "const SLIPPAGE_BPS = 150;"],
  ["W2-restore-cooldown", "W2 only endgame restoration", "cooling.has(m.base) && !(endgame && restoring)", "cooling.has(m.base)"],
  ["W2-ordinary-cooldown", "W2 only endgame restoration", "cooling.has(m.base) && !(endgame && restoring)", "false"],
  ["S1-selected-base", "S1 selected base", "...action, base: c.base, maxPriorityFeePerGasWei", "...action, maxPriorityFeePerGasWei"],
  ["S5-validation-off", "S5 createAgent rejects invalid Params", "validateParams(p);", "// validateParams(p);"],
  ["S5-negative-edge", "S5 createAgent rejects invalid Params", "p.SINGLE_EDGE_BPS < 0", "false"],
  ["S5-nonfinite-edge", "S5 createAgent rejects invalid Params", "!Number.isFinite(p.SINGLE_EDGE_BPS)", "false"],
  ["DEV2-anchor-off", "DEV2 R6 anchor", "const crossAnchor = p.R6_ANCHOR_CROSS", "const crossAnchor = false"],
  ["DEV2-duplicate-single-gate", "DEV2 R7 single", "&& !p.R7_SINGLE_ENTRY && !restoring", "&& !restoring"],
  ["DEV2-endgame-cross", "DEV2 endgame cannot", "p.R6_ANCHOR_CROSS && !endgame &&", "p.R6_ANCHOR_CROSS &&"],
  ["DEV2-cross-without-entry", "DEV2 crossing with R7 off", "(p.R7_SINGLE_ENTRY || rawEdge * 10000 > p.SINGLE_EDGE_BPS)", "true"],
  ["DEV2-entry-step", "DEV2 entry admits only", " || p.ENTRY_BPS % 5 !== 0", ""],
  ["DEV3-default-entry", "DEV3 defaults", "ENTRY_BPS: 50, SINGLE_EDGE_BPS", "ENTRY_BPS: 60, SINGLE_EDGE_BPS"],
  ["DEV3-settlement-off", "DEV3 R8 state machine", "p.R8_SETTLED_COOLDOWN && previous", "false && previous"],
  ["DEV3-no-input-confirmation", "DEV3 R8 rejects", "cashDelta === -amount && baseDelta > 0n", "baseDelta > 0n"],
  ["DEV3-no-proceeds-confirmation", "DEV3 R8 rejects", "baseDelta === -amount && cashDelta > 0n", "baseDelta === -amount"],
  ["DEV3-no-gas-confirmation", "DEV3 R8 rejects", "BigInt(after.balances.ethWei) >= BigInt(before.balances.ethWei)", "false"],
  ["DEV3-other-base-ambiguity", "DEV3 R8 rejects", "balanceOf(before, other) !== balanceOf(after, other)", "false"],
  ["DEV3-no-next-block", "DEV3 R8 guard block", "Number(after.blockNumber) !== Number(before.blockNumber) + 1", "false"],
  ["DEV3-no-run-id", "DEV3 R8 guard runId", "before.runId !== after.runId", "false"],
  ["DEV3-no-previous-reset", "DEV3 R8 run reset discards", "previous = undefined;", ""],
  ["DEV3-no-bundle-exclusion", "DEV3 R8 guard bundle", "!Object.values(SWAPS).includes(action.type)", "false"],
  ["DEV3-headroom-off", "DEV3 R9 reserves", "p.R9_BUNDLE_HEADROOM ? initial * (1 + INV_BAND / 2)", "false ? initial * (1 + INV_BAND / 2)"],
  ["V4-default-on", "V4 defaults", "R10_FULL_DEPTH_SIZE: false", "R10_FULL_DEPTH_SIZE: true"],
  ["V4-depth-off", "V4 R10 full depth", "fullDepth ? edge / (2 * slope) : desired", "desired"],
  ["V4-depth-cap-bypass", "V4 R10 full depth", "edge / (2 * slope), cap, balance * 0.9", "edge / (2 * slope), balance * 0.9"],
  ["V4-single-cap-off", "V4 R11 logged", "p.R11_SMALL_SINGLE_CAP ? cap / 2 : cap", "cap"],
  ["V4-bundle-cap-shrunk", "V4 R11 never shrinks", "sizeUsd(edge, slope, cash, cap, p.R2_BALANCE_FLOOR", "sizeUsd(edge, slope, cash, singleCap, p.R2_BALANCE_FLOOR"],
  ["V4-backoff-off", "V4 R12 ambiguous", "p.R12_UNCONFIRMED_BACKOFF && unconfirmedSingles.has(base) ? 4 : 2", "2"],
  ["V4-confirmation-off", "V4 R12 with R8 OFF", "if (settledSingle(sent.observation, sent.action, obs))", "if (false)"],
  ["V4-blind-release", "V4 R12 incomplete", "if (settledSingle(sent.observation, sent.action, obs))", "if (true)"],
  ["V4-funding-bypass", "V4 final selection", "if (!reserveCandidate(obs, c)) continue;", "if (false) continue;"],
  ["V4-gas-bypass", "V4 final selection", "if (BigInt(obs.balances.ethWei) - BigInt(c.gas) * fee < GAS_RESERVE) continue;", "if (false) continue;"],
  ["R13-default-on", "R13 defaults OFF", "R13_EDGE_SLIPPAGE: false", "R13_EDGE_SLIPPAGE: true"],
  ["R13-factor-bypass", "R13 singles cap", "if (p.R13_EDGE_SLIPPAGE)", "if (false)"],
  ["R13-entry-bypass", "R13 ENTRY bounds", "Math.min(SLIPPAGE_BPS, p.ENTRY_BPS,", "Math.min(SLIPPAGE_BPS,"],
  ["R13-gas-bypass", "R13 gas at", "slippageBudgetBps(c, net, p)", "slippageBudgetBps(c, c.profit, p)"],
  ["R13-double-budget", "R13 bundle legs", "legs * c.usd + Math.max(0, c.profit)", "c.usd + Math.max(0, c.profit)"],
  ["R13-zero-room-bypass", "R13 sub-bps room", "if (slippageBps < 1) continue;", "if (false) continue;"],
  ["R13-profit-reserve-bypass", "R13 retains the minimum", "(net - MIN_PROFIT_USDC) / exposure", "net / exposure"],
  ["V5-default-off", "V5 defaults enable only", "...V3_PARAMS, R9_BUNDLE_HEADROOM: true", "...V3_PARAMS, R9_BUNDLE_HEADROOM: false"],
  ["V5-v3-profile-leak", "V5 logged headroom-buy", "R8_SETTLED_COOLDOWN: true, R9_BUNDLE_HEADROOM: false", "R8_SETTLED_COOLDOWN: true, R9_BUNDLE_HEADROOM: true"],
  ["V5-headroom-sell-off", "V5 logged headroom-sell", "p.R9_BUNDLE_HEADROOM ? initial * (1 - INV_BAND / 2)", "false ? initial * (1 - INV_BAND / 2)"],
  ["V5-bundle-band-halved", "V5 R9 keeps bundle room", "const upper = initial * (1 + INV_BAND),", "const upper = initial * (1 + INV_BAND / 2),"],
  ["V5-buy-cushion-off", "V5 logged headroom-buy", "room * v.mid / (buy ? 1.008 : 1)", "room * v.mid"],

];
const records = [];
function run(label, pattern) {
  const args = ["--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap"];
  if (pattern) args.push(`--test-name-pattern=${pattern}`);
  args.push(...(pattern ? [pattern.startsWith("V5") ? "test/xb-r-v5.test.ts" : pattern.startsWith("R13") ? "test/xb-r-slippage.test.ts" : pattern.startsWith("V4") ? "test/xb-r-v4.test.ts" : pattern.startsWith("DEV3") ? "test/xb-r-dev3a.test.ts" : pattern.startsWith("DEV2") ? "test/xb-r-dev2.test.ts" : "test/xb-r.test.ts"]
    : ["test/xb-core.test.ts", "test/xb-variants.test.ts", "test/xb-r.test.ts", "test/xb-r-dev2.test.ts", "test/xb-r-dev3a.test.ts", "test/xb-r-v4.test.ts", "test/xb-r-slippage.test.ts", "test/xb-r-v5.test.ts"]));
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 60000 });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(join(evidence, `${label}.log`), log);
  return { result, log };
}
function expectRed(label, pattern, mutated) {
  writeFileSync(sourcePath, mutated);
  let result, log;
  try { ({ result, log } = run(label, pattern)); }
  finally { writeFileSync(sourcePath, original); }
  assert.equal(result.error, undefined, `${label}: infrastructure error`);
  assert.equal(result.status, 1, `${label}: mutant must exit 1`);
  assert.match(log, /ERR_ASSERTION/, `${label}: must fail an assertion, not loading or syntax`);
  assert.match(log, new RegExp(`not ok \\d+ - ${pattern}`), `${label}: expected named test failed`);
  const fail = Number(log.match(/^# fail (\d+)/m)?.[1]);
  const pass = Number(log.match(/^# pass (\d+)/m)?.[1]);
  assert.equal(digest(readFileSync(sourcePath, "utf8")), digest(original));
  records.push({ label, exit: result.status, pass, fail, restored: true, restoredSha256: digest(original) });
  console.log(`RED ${label}: exit=${result.status}, pass=${pass}, fail=${fail}; source restored`);
}
try {
  const previous = spawnSync("git", ["show", "a042a70:example/agents/xb-r/agent.ts"], { cwd: root, encoding: "utf8" });
  assert.equal(previous.status, 0, "load the exact diagnosed source without changing git state");
  expectRed("LIVE-original-a042a70", "LIVE replay block", previous.stdout);
  const dev2 = spawnSync("git", ["show", "2ae0d59:example/agents/xb-r/agent.ts"], { cwd: root, encoding: "utf8" });
  assert.equal(dev2.status, 0, "load the dev2 source without changing git state");
  expectRed("DEV2-original-2ae0d59", "DEV2 R[67]", dev2.stdout);
  const dev3 = spawnSync("git", ["show", "a646e9b:example/agents/xb-r/agent.ts"], { cwd: root, encoding: "utf8" });
  assert.equal(dev3.status, 0, "load exact dev3a source without changing git state");
  expectRed("DEV3-original-a646e9b", "DEV3 (defaults|R8 confirms)", dev3.stdout);
  for (const [label, pattern, from, to] of controls) {
    assert.equal(original.split(from).length, 2, `${label}: unique mutation anchor`);
    expectRed(label, pattern, original.replace(from, to));
  }
} finally {
  writeFileSync(sourcePath, original);
  writeFileSync(join(evidence, "mutations.json"), JSON.stringify(records, null, 2) + "\n");
}
const { result, log } = run("restored-xb-tests");
assert.equal(result.status, 0, "restored complete xb suite must pass");
assert.equal(digest(readFileSync(sourcePath, "utf8")), digest(original));
console.log(log.match(/^# (?:tests|pass|fail|skipped) .*$/gm)?.join("\n"));
console.log(`RESTORED sha256=${digest(original)}`);
console.log(`Evidence: ${evidence}`);

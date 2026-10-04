// Run manually, with no concurrent evaluation: node test/xb-r-red-controls.mjs
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
  ["S1-selected-base", "S1 selected base", "...c.action, base: c.base, maxPriorityFeePerGasWei", "...c.action, maxPriorityFeePerGasWei"],
  ["S5-validation-off", "S5 createAgent rejects invalid Params", "validateParams(p);", "// validateParams(p);"],
  ["S5-negative-edge", "S5 createAgent rejects invalid Params", "p.SINGLE_EDGE_BPS < 0", "false"],
  ["S5-nonfinite-edge", "S5 createAgent rejects invalid Params", "!Number.isFinite(p.SINGLE_EDGE_BPS)", "false"],
  ["DEV2-anchor-off", "DEV2 R6 anchor", "const crossAnchor = p.R6_ANCHOR_CROSS", "const crossAnchor = false"],
  ["DEV2-duplicate-single-gate", "DEV2 R7 single", "&& !p.R7_SINGLE_ENTRY && !restoring", "&& !restoring"],
  ["DEV2-endgame-cross", "DEV2 endgame cannot", "p.R6_ANCHOR_CROSS && !endgame &&", "p.R6_ANCHOR_CROSS &&"],
  ["DEV2-cross-without-entry", "DEV2 crossing with R7 off", "(p.R7_SINGLE_ENTRY || rawEdge * 10000 > p.SINGLE_EDGE_BPS)", "true"],
  ["DEV2-entry-step", "DEV2 entry admits only", " || p.ENTRY_BPS % 5 !== 0", ""],
];
const records = [];
function run(label, pattern) {
  const args = ["--import", "tsx", "--test", "--test-reporter=tap"];
  if (pattern) args.push(`--test-name-pattern=${pattern}`);
  args.push(...(pattern ? [pattern.startsWith("DEV2") ? "test/xb-r-dev2.test.ts" : "test/xb-r.test.ts"]
    : ["test/xb-core.test.ts", "test/xb-variants.test.ts", "test/xb-r.test.ts", "test/xb-r-dev2.test.ts"]));
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
  records.push({ label, exit: result.status, pass, fail, restored: true });
  console.log(`RED ${label}: exit=${result.status}, pass=${pass}, fail=${fail}; source restored`);
}
try {
  const previous = spawnSync("git", ["show", "a042a70:example/agents/xb-r/agent.ts"], { cwd: root, encoding: "utf8" });
  assert.equal(previous.status, 0, "load the exact diagnosed source without changing git state");
  expectRed("LIVE-original-a042a70", "LIVE replay block", previous.stdout);
  const dev2 = spawnSync("git", ["show", "2ae0d59:example/agents/xb-r/agent.ts"], { cwd: root, encoding: "utf8" });
  assert.equal(dev2.status, 0, "load the dev2 source without changing git state");
  expectRed("DEV2-original-2ae0d59", "DEV2 R[67]", dev2.stdout);
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

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repo = process.cwd();
const script = resolve(repo, "ascon-notes/eval/aggregate.py");
function runIndex(rows: Array<{ regime: string; seed: number; dir: string; code?: number }>, summaries: Record<string, unknown>) {
  const temp = mkdtempSync(join(tmpdir(), "ascon-eval-fixture-"));
  for (const [name, summary] of Object.entries(summaries)) {
    mkdirSync(join(temp, name), { recursive: true });
    writeFileSync(join(temp, name, "summary.json"), JSON.stringify(summary));
  }
  const index = join(temp, "index.tsv");
  writeFileSync(index, `regime\tseed\trun_dir\texit_code\n${rows.map(r => `${r.regime}\t${r.seed}\t${join(temp, r.dir)}\t${r.code ?? 0}`).join("\n")}\n`);
  try { return execFileSync("python3", [script, index], { encoding: "utf8" }); }
  finally { rmSync(temp, { recursive: true, force: true }); }
}
function summary(p: number, q = p, failedReads = 0, violations: unknown[] = []) {
  return { agents: [{ id: "noop", pnlUsdc: 0, includedTxCount: 0 }, { id: "a", pnlUsdc: p, includedTxCount: 2 }, { id: "b", pnlUsdc: q, includedTxCount: 1 }], valueSeries: { failedReads, alphaByAgent: {} }, violations };
}

test("synthetic: all ties get T=50; missing agent and uneven seeds use regime weighting", () => {
  const output = runIndex([
    { regime: "calm", seed: 1, dir: "c1" }, { regime: "calm", seed: 2, dir: "c2" },
    { regime: "storm", seed: 1, dir: "s1" },
  ], { c1: summary(0), c2: summary(0), s1: { agents: [{ id: "noop", pnlUsdc: 0 }, { id: "a", pnlUsdc: 10 }], valueSeries: { failedReads: 0 }, violations: [] } });
  assert.match(output, /\| calm \| 1 \| a \| 0\.00 \| 50\.0/);
  assert.match(output, /\| a \| 55\.0 \| 50\.0 \|/);
  assert.match(output, /\| b \| 50\.0 \| 50\.0 \|/);
  assert.match(output, /1\/2/);
});

test("synthetic: failed run and duplicate run_dir are invalid and excluded", () => {
  const temp = mkdtempSync(join(tmpdir(), "ascon-eval-dup-"));
  const runDir = join(temp, "shared"); mkdirSync(runDir);
  writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary(100)));
  const index = join(temp, "index.tsv");
  writeFileSync(index, `regime\tseed\trun_dir\texit_code\ncalm\t1\t${runDir}\t0\ncalm\t2\t${runDir}\t0\ncrash\t1\t${runDir}\t9\n`);
  try {
    const out = execFileSync("python3", [script, index], { encoding: "utf8" });
    assert.match(out, /無効: run_dir重複/);
    assert.match(out, /有効\/対象レジーム/);
    assert.match(out, /\| a \| 欠測 \| 欠測 \| 0 \| 0\/2 \| 0\/2 \| 3 \|/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("synthetic: nonzero failedReads and violations are invalid", () => {
  const output = runIndex([{ regime: "r", seed: 1, dir: "bad1" }, { regime: "r", seed: 2, dir: "bad2" }], {
    bad1: summary(50, 0, 1), bad2: summary(50, 0, 0, ["policy"]),
  });
  assert.match(output, /無効: failedReads不正/);
  assert.match(output, /無効: violationsあり/);
  assert.match(output, /\| a \| 欠測 \| 欠測 \| 0 \| 0\/1 \| 0\/1 \| 2 \|/);
});

test("synthetic: nonzero index exit_code is invalid", () => {
  const output = runIndex([{ regime: "r", seed: 1, dir: "failed", code: 23 }], { failed: summary(50) });
  assert.match(output, /無効: exit_code不正/);
  assert.match(output, /\| a \| 欠測 \| 欠測 \| 0 \| 0\/1 \| 0\/1 \| 1 \|/);
});

const run = resolve(repo, "runs/2026-10-02T13-27-19-033Z");
const expected = [["noop", -144.27160763042048, null], ["ascon-alpha", -119.56162716673862, 38.0], ["venue-arb", -16.90845518030983, 45.3], ["multi-arb", 267.32881334352714, 65.2], ["clean-arb", 71.40049599346821, 51.5]] as const;
test("aggregate reproduces reference P and T", { skip: !existsSync(join(run, "summary.json")) }, () => {
  const temp = mkdtempSync(join(tmpdir(), "ascon-eval-"));
  try {
    const index = join(temp, "index.tsv"); writeFileSync(index, `regime\tseed\trun_dir\texit_code\ncalm\t101\t${run}\t0\n`);
    const output = execFileSync("python3", [script, index], { encoding: "utf8" });
    for (const [id, pnl, t] of expected) {
      const row = output.split("\n").find((line) => line.startsWith(`| calm | 101 | ${id} |`));
      assert.ok(row, `missing output for ${id}`);
      const cells = row.split("|").map((cell) => cell.trim());
      assert.equal(Number(cells[4]), Number(pnl.toFixed(2)), `${id} P`);
      if (t !== null) assert.equal(Number(cells[5]), t, `${id} T`);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

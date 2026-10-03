import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repo = process.cwd();
const script = resolve(repo, "ascon-notes/eval/compare.py");
function fixture(label: string, rows: Array<{ regime: string; seed: number; p: number; ref?: number; noop?: number; crowd?: number; code?: number; bad?: string; loops?: number }>) {
  const root = mkdtempSync(join(tmpdir(), "ascon-compare-"));
  const indexDir = join(root, "out", label); mkdirSync(indexDir, { recursive: true });
  const lines = ["regime\tseed\trun_dir\texit_code"];
  rows.forEach((r, i) => {
    const dir = join(root, `run${i}`); mkdirSync(dir);
    writeFileSync(join(dir, "summary.json"), JSON.stringify({ ...(r.loops === undefined ? {} : { loopIterations: r.loops }), valueSeries: { failedReads: r.bad === "failed" ? 1 : 0 }, violations: r.bad === "violation" ? ["x"] : [], agents: [
      { id: "noop", pnlUsdc: r.noop ?? 0 }, { id: "multi-arb", pnlUsdc: r.ref ?? 0 }, { id: "crowd", pnlUsdc: r.crowd ?? 0 }, { id: "clean-arb", pnlUsdc: 0 }, { id: "cand", pnlUsdc: r.p },
    ] }));
    lines.push(`${r.regime}\t${r.seed}\t${dir}\t${r.code ?? 0}`);
  });
  const index = join(indexDir, "index.tsv"); writeFileSync(index, lines.join("\n") + "\n");
  return { root, index };
}
function run(...args: string[]) { return execFileSync("python3", [script, ...args], { encoding: "utf8" }); }

test("paired bootstrap is deterministic and reports stable positive CI and exclusions", () => {
  const f = fixture("iso-alpha", [
    { regime: "calm", seed: 1, p: 10, ref: 2 }, { regime: "calm", seed: 2, p: 10, ref: 2 },
    { regime: "storm", seed: 1, p: 10, ref: 2 }, { regime: "storm", seed: 2, p: 10, ref: 2 },
    { regime: "bad", seed: 1, p: 99, bad: "failed" }, { regime: "bad", seed: 2, p: 99, code: 7 }, { regime: "bad", seed: 3, p: 99, bad: "violation" },
  ]);
  try {
    const a = run(f.index, "--boot", "300", "--seed", "7");
    assert.equal(a, run(f.index, "--boot", "300", "--seed", "7"));
    assert.match(a, /平均差 \| 95% CI/);
    assert.match(a, /\| d_ref \| 8\.0 \| 8\.0 – 8\.0 \| 4\/4 \| 有意に正 \|/);
    assert.match(a, /failedReads不正\/欠測: 1/);
    assert.match(a, /exit_code不正: 1/);
    assert.match(a, /violationsあり: 1/);
    assert.match(a, /使用した \(regime, seed\): 4/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("CI crossing zero and same candidate labels combine", () => {
  const a = fixture("iso-mix", [{ regime: "calm", seed: 1, p: 1 }, { regime: "calm", seed: 2, p: -1 }]);
  const b = fixture("iso-mix-s102_103", [{ regime: "storm", seed: 102, p: 2 }, { regime: "storm", seed: 103, p: -2 }]);
  try {
    const output = run(a.index, b.index, "--boot", "500", "--seed", "4");
    assert.equal((output.match(/^## mix$/gm) ?? []).length, 1);
    assert.match(output, /使用した \(regime, seed\): 4/);
    assert.match(output, /有意差なし/);
  } finally { rmSync(a.root, { recursive: true, force: true }); rmSync(b.root, { recursive: true, force: true }); }
});

test("candidate comparisons with fewer than 12 pairs are explicitly undecidable", () => {
  const a = fixture("iso-a", Array.from({ length: 4 }, (_, i) => ({ regime: "r", seed: i, p: 10 })));
  const b = fixture("iso-b", Array.from({ length: 4 }, (_, i) => ({ regime: "r", seed: i, p: 5 })));
  try { assert.match(run(a.index, b.index), /対が少なく判定不能/); }
  finally { rmSync(a.root, { recursive: true, force: true }); rmSync(b.root, { recursive: true, force: true }); }
});

test("low loop scenario is excluded across candidates while normal scenarios remain paired", () => {
  const a = fixture("iso-a", [{ regime: "r", seed: 1, p: 10, loops: 359 }, { regime: "r", seed: 2, p: 10, loops: 362 }]);
  const b = fixture("iso-b", [{ regime: "r", seed: 1, p: 8, loops: 362 }, { regime: "r", seed: 2, p: 8, loops: 362 }]);
  try {
    const output = run(a.index, b.index, "--boot", "100");
    assert.match(output, /excluded 1/);
    assert.match(output, /a \/ r \/ 1: loopIterations=359/);
    assert.match(output, /使用した \(regime, seed\): 2（候補別の合計）/);
    assert.match(output, /## a[\s\S]*?使用した \(regime, seed\): 1/);
    assert.match(output, /## b[\s\S]*?使用した \(regime, seed\): 1/);
  } finally { rmSync(a.root, { recursive: true, force: true }); rmSync(b.root, { recursive: true, force: true }); }
});

test("loop guard can be disabled and missing loopIterations warns without exclusion", () => {
  const f = fixture("iso-a", [{ regime: "r", seed: 1, p: 10, loops: 1 }, { regime: "r", seed: 2, p: 10 }]);
  try {
    const output = run(f.index, "--min-loop-iterations", "0", "--boot", "100");
    assert.match(output, /excluded 0/);
    assert.match(output, /警告: loopIterations 欠落シナリオ 1 件（除外せず）/);
    assert.match(output, /使用した \(regime, seed\): 2/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

const labels = ["iso-delta-bid", "iso-eps-bid5000", "iso-zeta-a30", "iso-eps-bid10000"];
const paths = labels.map(label => join(repo, "ascon-notes/eval/out", label, "index.tsv"));
test("seed 101 real four-world indices run and retain expected candidate names", { skip: !paths.every(existsSync) }, () => {
  const output = run(...labels, "--boot", "100");
  for (const name of ["delta-bid", "eps-bid5000", "zeta-a30", "eps-bid10000"]) assert.match(output, new RegExp(`^## ${name}$`, "m"));
});

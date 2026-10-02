import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repo = process.cwd();
const run = resolve(repo, "runs/2026-10-02T13-27-19-033Z");
const expected = [
  ["noop", -144.27160763042048, null],
  ["ascon-alpha", -119.56162716673862, 38.0],
  ["venue-arb", -16.90845518030983, 45.3],
  ["multi-arb", 267.32881334352714, 65.2],
  ["clean-arb", 71.40049599346821, 51.5],
] as const;

test("aggregate reproduces reference P and T", { skip: !existsSync(join(run, "summary.json")) }, () => {
  const temp = mkdtempSync(join(tmpdir(), "ascon-eval-"));
  try {
    const index = join(temp, "index.tsv");
    writeFileSync(index, `regime\tseed\trun_dir\texit_code\ncalm\t101\t${run}\t0\n`);
    const output = execFileSync("python3", [join(repo, "ascon-notes/eval/aggregate.py"), index], { encoding: "utf8" });
    for (const [id, pnl, t] of expected) {
      const row = output.split("\n").find((line) => line.startsWith(`| calm | 101 | ${id} |`));
      assert.ok(row, `missing output for ${id}`);
      const cells = row.split("|").map((cell) => cell.trim());
      assert.equal(Number(cells[4]), Number(pnl.toFixed(2)), `${id} P`);
      if (t !== null) assert.equal(Number(cells[5]), t, `${id} T`);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

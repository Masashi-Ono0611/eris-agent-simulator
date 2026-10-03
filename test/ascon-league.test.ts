import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const maker = resolve(root, "ascon-notes/league/make-roster.py");
const report = resolve(root, "ascon-notes/league/league-report.py");
function summary(loopIterations: number, pnl: number[]) {
  return { loopIterations, valueSeries: { failedReads: 0 }, violations: [], agents: [
    { id: "astra-1", pnlUsdc: pnl[0], includedTxCount: 3 },
    { id: "astra-2", pnlUsdc: pnl[1], includedTxCount: 5 },
    { id: "opus-1", pnlUsdc: pnl[2], includedTxCount: 2 },
    { id: "noop", pnlUsdc: 0, baseline: true, includedTxCount: 0 },
  ] };
}
function reportFixture(loops: number[]) {
  const dir = mkdtempSync(join(root, "ascon-league-fixture-"));
  const rows = ["regime\tseed\trun_dir\texit_code"];
  loops.forEach((n, i) => {
    const run = join(dir, `run-${i}`); mkdirSync(run);
    writeFileSync(join(run, "summary.json"), JSON.stringify(summary(n, [10 + i, 0, -10])));
    rows.push(`calm\t${i + 1}\t${relative(root, run)}\t0`);
  });
  const index = join(dir, "index.tsv"); writeFileSync(index, rows.join("\n") + "\n");
  return { dir, index };
}

test("make-roster validates actual directories, duplicate ids and marks noop baseline", () => {
  const roster = execFileSync("python3", [maker, "--players", "basis-arb"], { encoding: "utf8" });
  assert.match(roster, /id: "basis-arb"/); assert.match(roster, /wallet: AUTO/); assert.match(roster, /id: "noop"[\s\S]*baseline: true/);
  assert.throws(() => execFileSync("python3", [maker, "--players", "multi-arb"], { encoding: "utf8" }));
  assert.throws(() => execFileSync("python3", [maker, "--players", "not-a-real-agent-932"], { encoding: "utf8" }));
});

test("league-report excludes low-loop scenarios globally and aggregates family and regime", () => {
  const f = reportFixture([359, 362]);
  try {
    const excluded = execFileSync("python3", [report, f.index], { encoding: "utf8" });
    assert.match(excluded, /除外シナリオ: 1/); assert.match(excluded, /calm \/ 1: loopIterations=359/);
    assert.match(excluded, /astra \|/); assert.match(excluded, /系統別平均/);
    const normal = execFileSync("python3", [report, f.index, "--min-loop-iterations", "0"], { encoding: "utf8" });
    assert.match(normal, /除外シナリオ: 0/);
    assert.match(normal, /astra-1/); assert.match(normal, /astra-2/); assert.doesNotMatch(normal, /\| noop \|/);
    assert.match(normal, /レジーム別平均 T/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("run-league dry-run validates roster and makes no files or child backtest process", () => {
  const dir = mkdtempSync(join(tmpdir(), "ascon-league-dry-"));
  const roster = join(dir, "roster.yaml");
  writeFileSync(roster, "agents:\n  - id: noop\n    wallet: AUTO\n    dir: noop\n");
  const before = readFileSync(roster, "utf8");
  // Copy the entry point and replace its actual matrix child: never run a real backtest.
  const script=join(dir,"ascon-notes/league/run-league.sh");
  mkdirSync(join(dir,"ascon-notes/league"),{recursive:true});
  mkdirSync(join(dir,"ascon-notes/eval"),{recursive:true});
  mkdirSync(join(dir,"example/agents/noop"),{recursive:true});
  writeFileSync(join(dir,"example/agents/noop/agent.ts"),"export function decide() { return []; }");
  symlinkSync(join(root,"node_modules"),join(dir,"node_modules"),"dir");
  copyFileSync(resolve(root,"ascon-notes/league/run-league.sh"),script);
  const marker=join(dir,"backtest-called");
  writeFileSync(join(dir,"ascon-notes/eval/run-matrix.sh"),`#!/bin/bash\ntouch '${marker}'\nexit 91\n`);
  const bin=join(dir,"bin"); mkdirSync(bin);
  writeFileSync(join(bin,"git"),"#!/bin/bash\nexit 0\n"); chmodSync(join(bin,"git"),0o755);
  const result = spawnSync("/bin/bash", [script, "--dry-run", "--label", "dry-check", "--roster", roster, "--regimes", "calm", "--seeds", "1", "--parallel", "1"], { encoding: "utf8",env:{...process.env,PATH:`${bin}:${process.env.PATH}`} });
  try {
    assert.equal(existsSync(marker),false,"dry-run invoked matrix/backtest");
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /DRY RUN/);
    assert.equal(readFileSync(roster, "utf8"), before);
    assert.equal(existsSync(join(dir, "ascon-notes/eval/out/dry-check")), false);
    // Positive control: dropping --dry-run must reach the stub and propagate its status.
    const liveStub=spawnSync("/bin/bash",[script,"--label","dry-check","--roster",roster],{encoding:"utf8",env:{...process.env,PATH:`${bin}:${process.env.PATH}`}});
    assert.equal(liveStub.status,91,liveStub.stderr);
    assert.equal(existsSync(marker),true,"backtest stub was not connected");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

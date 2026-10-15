import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, cpSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(".");
const script = join(root, "ascon-notes/release/prepare-release.py");
const py = (code: string) => spawnSync("python3", ["-c", code, script], { encoding: "utf8" });
const call = (args: string[]) => spawnSync("python3", [script, ...args], { encoding: "utf8" });

test("scan_passed accepts a clean scan whose summary contains the word BLOCK, and fails closed otherwise", () => {
  const cases: Array<[number, string, boolean]> = [
    [0, "=== submission scan: x.zip ===\n  [WARN] package.json: non-registry dependency\n--- 0 BLOCK, 1 WARN -> ACCEPT\n", true], // real output of a clean bundle
    [0, "--- 0 BLOCK, 0 WARN -> ACCEPT\n", true],
    [0, "  [BLOCK] agent.ts: eval\n--- 1 BLOCK, 0 WARN -> REJECT\n", false],
    [0, "--- 2 BLOCK, 3 WARN -> ACCEPT\n", false], // blocks present even if the verdict word were wrong
    [0, "--- 0 BLOCK, 0 WARN -> REJECT\n", false],
    [0, "no summary line at all\n", false], // unparsable output is BLOCKED, never PASS
    [1, "--- 0 BLOCK, 0 WARN -> ACCEPT\n", false], // non-zero exit
  ];
  for (const [code, out, expected] of cases) {
    const r = py(`import importlib.util,sys; s=importlib.util.spec_from_file_location('prep',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.scan_passed(${code}, ${JSON.stringify(out)}))`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), expected ? "True" : "False", `${code} ${JSON.stringify(out)}`);
  }
});

test("pure source rewrites safely quote hostile JSON and substitute env/numberEnv", () => {
  const bad = JSON.stringify({ text: "quote' slash\\ line\n ${process.env.PWN}" });
  const r = py(`import importlib.util,sys; s=importlib.util.spec_from_file_location('prep',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.rewrite_source('const d = parseDeltaParams(process.env.ASCON_DELTA_PARAMS); const e = parseEpsilonParams(process.env.ASCON_EPSILON_PARAMS); const n = numberEnv("ERIS_LAUNCH_TEST", 12);', ${JSON.stringify(bad)}, None))`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /parseDeltaParams\("/);
  assert.match(r.stdout, /parseEpsilonParams\(undefined\)/);
  assert.match(r.stdout, /const n = 12;/);
  assert.match(r.stdout, /\\\\/);
  assert.match(r.stdout, /\\n/);
  assert.throws(() => JSON.parse("not json"));
});

test("rejects existing output and unexpected numberEnv; dry-run writes nothing", () => {
  const temp = mkdtempSync(join(tmpdir(), "ascon-release-"));
  const agents = join(temp, "example/agents"); mkdirSync(agents, { recursive: true });
  mkdirSync(join(agents, "src"));
  writeFileSync(join(agents, "src/prompt.md"), "---\nname: src\n---\n");
  mkdirSync(join(agents, "taken"));
  let r = call(["--root", temp, "--source", "src", "--name", "taken", "--skip-checks"]);
  assert.notEqual(r.status, 0); assert.match(r.stdout, /既に存在/);
  writeFileSync(join(agents, "src/launch.ts"), 'numberEnv("ERIS_LAUNCH_X", process.env.X)');
  r = call(["--root", temp, "--source", "src", "--name", "unexpected", "--skip-checks"]);
  assert.notEqual(r.status, 0); assert.match(r.stdout, /手動確認/);
  writeFileSync(join(agents, "src/launch.ts"), "const ok = 1;");
  r = call(["--root", temp, "--source", "src", "--name", "dry", "--dry-run"]);
  assert.notEqual(r.status, 0); assert.equal(existsSync(join(agents, "dry")), false);
});

test("fails on remaining process.env", () => {
  const temp = mkdtempSync(join(tmpdir(), "ascon-release-env-"));
  const dir = join(temp, "example/agents/src"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "prompt.md"), "---\nname: src\n---\n");
  writeFileSync(join(dir, "agent.ts"), "const x = process.env.OTHER;");
  const r = call(["--root", temp, "--source", "src", "--name", "out", "--skip-checks"]);
  assert.notEqual(r.status, 0); assert.match(r.stdout, /process.env 残存/);
});

test("rewrites copied ascon-epsilon and embeds delta params without process.env", () => {
  const temp = mkdtempSync(join(tmpdir(), "ascon-release-epsilon-"));
  // Match the repository ESM package scope; the fixture lives outside the checkout.
  writeFileSync(join(temp, "package.json"), JSON.stringify({ type: "module" }) + "\n");
  const agents = join(temp, "example/agents"); mkdirSync(agents, { recursive: true });
  cpSync(join(root, "example/agents/ascon-epsilon"), join(agents, "source"), { recursive: true });
  cpSync(join(root, "example/agents/lib"), join(agents, "lib"), { recursive: true });
  // Keep imports resolvable for a real module evaluation while all writes stay temporary.
  symlinkSync(join(root, "node_modules"), join(temp, "node_modules"), "dir");
  const params = JSON.stringify({ SAFETY_MARGIN_BPS: 91, useExecutableQuotes: true });
  const r = call(["--root", temp, "--source", "source", "--name", "ascon-final-test", "--delta-params", params, "--skip-checks"]);
  assert.notEqual(r.status, 0); // Skip checks is intentionally never a ready result.
  const out = join(agents, "ascon-final-test");
  const code = readFileSync(join(out, "delta.ts"), "utf8");
  assert.doesNotMatch(code, /process\.env/);
  assert.match(code, /parseDeltaParams\("/);
  const scan = py(`import importlib.util,sys; s=importlib.util.spec_from_file_location('prep',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print('\\n'.join(m.inspect_tree(m.Path(${JSON.stringify(out)}))))`);
  assert.equal(scan.status, 0, scan.stderr);
  assert.equal(scan.stdout.trim(), "");
  const evalResult = spawnSync("node", ["--import", "tsx", "-e", `import { PARAMS } from ${JSON.stringify(join(out, "delta.ts"))}; console.log(JSON.stringify(PARAMS));`], { cwd: root, encoding: "utf8" });
  assert.equal(evalResult.status, 0, evalResult.stderr);
  assert.deepEqual(JSON.parse(evalResult.stdout.trim()), { SAFETY_MARGIN_BPS: 91, MIN_SIZE_BPS: 250, MAX_SIZE_BPS: 2500, SPREAD_GAIN: 200000, GAP_GAIN: 200000, LEG_SLIPPAGE_BPS: 120, SINGLE_SLIPPAGE_BPS: 75, useExecutableQuotes: true, persistBlocks: 0, inventoryBandBps: 0, endgameNoNewBlocks: 0, bidExtraBps: 0 });
});

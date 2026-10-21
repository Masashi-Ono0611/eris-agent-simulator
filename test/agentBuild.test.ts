import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { deploymentsFingerprint } from "../core/src/backtest/shared.js";

test("team builds refresh an existing base before copying team code; a failed base stops the build", t => {
  const dir = mkdtempSync(join(tmpdir(), "eris-build-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, "calls.jsonl");
  const docker = join(dir, "docker");
  writeFileSync(docker, `#!${process.execPath}\nconst args=process.argv.slice(2); require('node:fs').appendFileSync(process.env.CAPTURE, JSON.stringify(args)+'\\n'); if (process.env.FAIL_BASE === '1' && args.includes('infra/docker-agent/Dockerfile.base')) process.exit(7);\n`);
  chmodSync(docker, 0o700);
  const run = (fail: boolean) => spawnSync("bash", ["infra/docker-agent/build.sh", "team", "my-arb"], {
    env: { ...process.env, PATH: dir + delimiter + process.env.PATH, CAPTURE: log, ERIS_AGENT_BUILD_STATE_DIR: dir, FAIL_BASE: fail ? "1" : "0" },
    encoding: "utf8", timeout: 10_000,
  });
  for (let i = 0; i < 2; i++) {
    writeFileSync(log, "");
    const result = run(false);
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]);
    assert.ok(calls[0].includes("infra/docker-agent/Dockerfile.base"));
    assert.ok(calls[2].includes("infra/docker-agent/Dockerfile.team"));
  }
  writeFileSync(log, "");
  assert.equal(run(true).status, 7);
  assert.doesNotMatch(readFileSync(log, "utf8"), /Dockerfile.team/);
});

test("a base build stops before docker when the overlay does not match the state dump (issue #310)", t => {
  const dir = mkdtempSync(join(tmpdir(), "eris-build-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, "calls.jsonl");
  const docker = join(dir, "docker");
  writeFileSync(docker, `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2))+'\\n');\n`);
  chmodSync(docker, 0o700);
  const state = join(dir, "state");
  mkdirSync(state);
  // Deployments no real overlay was generated from, under their own (valid) fingerprint.
  const deployments = { chainId: 31337, tokens: { WETH: "0x0000000000000000000000000000000000000310" } };
  writeFileSync(join(state, "manifest.json"), JSON.stringify({
    schema: 1, createdAt: "x", sourceCommit: "x", anvilVersion: "x", chainId: 31337, genesisHash: "0x00",
    stateFile: "state.json", deployments, deploymentsFingerprint: deploymentsFingerprint(deployments),
  }));
  const run = (allow: string) => spawnSync("bash", ["infra/docker-agent/build.sh", "base"], {
    env: { ...process.env, PATH: dir + delimiter + process.env.PATH, CAPTURE: log, ERIS_AGENT_BUILD_STATE_DIR: state, ERIS_AGENT_BUILD_ALLOW_OVERLAY_MISMATCH: allow },
    encoding: "utf8", timeout: 10_000,
  });
  writeFileSync(log, "");
  const refused = run("");
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /refusing to build/);
  assert.equal(readFileSync(log, "utf8"), "");
  const allowed = run("1");
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(readFileSync(log, "utf8"), /Dockerfile\.base/);
});

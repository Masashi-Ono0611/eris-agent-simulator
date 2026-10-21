import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  finalSubmissions,
  jstDay,
  main,
  makeEntry,
  parseLedger,
  renderAgentsBlock,
  type LedgerEntry,
} from "../scripts/submissionLedger.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "submission-ledger-"));
}

async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, {}, (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join("\n"), err: err.join("\n") };
}

function accept(entries: LedgerEntry[], unit: string, at: string, digest: string): LedgerEntry {
  const e = makeEntry(entries, { unit, result: "ACCEPT", at: new Date(at), imageDigest: digest });
  entries.push(e);
  return e;
}

test("the day is the JST calendar day", () => {
  assert.equal(jstDay(new Date("2026-10-31T14:59:59Z")), "2026-10-31");
  assert.equal(jstDay(new Date("2026-10-31T15:00:00Z")), "2026-11-01");
});

test("accepts are counted per unit per JST day; the sixth is over the limit", () => {
  const entries: LedgerEntry[] = [];
  // 2026-10-20 15:00Z is already 10/21 in JST: it counts towards 10/21, not 10/20.
  for (let i = 0; i < 5; i++) accept(entries, "team-a", `2026-10-20T${15 + i}:00:00Z`, `sha256:a${i}`);
  accept(entries, "team-b", "2026-10-20T16:00:00Z", "sha256:b0");
  assert.deepEqual(
    entries.map((e) => [e.unit, e.jstDay, e.acceptedToday, e.overLimit]),
    [
      ["team-a", "2026-10-21", 1, undefined],
      ["team-a", "2026-10-21", 2, undefined],
      ["team-a", "2026-10-21", 3, undefined],
      ["team-a", "2026-10-21", 4, undefined],
      ["team-a", "2026-10-21", 5, undefined],
      ["team-b", "2026-10-21", 1, undefined],
    ],
  );
  const reject = makeEntry(entries, { unit: "team-a", result: "REJECT", at: new Date("2026-10-21T01:00:00Z"), reason: "scan" });
  assert.equal(reject.acceptedToday, 5, "a REJECT does not count");
  assert.equal(reject.overLimit, undefined);
  const sixth = accept(entries, "team-a", "2026-10-21T02:00:00Z", "sha256:a5");
  assert.equal(sixth.acceptedToday, 6);
  assert.equal(sixth.overLimit, true);
  // The next JST day starts again at 1.
  assert.equal(accept(entries, "team-a", "2026-10-21T15:00:00Z", "sha256:a6").acceptedToday, 1);
  assert.throws(() => makeEntry([], { unit: "team-a", result: "ACCEPT", at: new Date() }), /image digest/);
  assert.throws(() => makeEntry([], { unit: "../x", result: "REJECT", at: new Date() }), /invalid unit id/);
});

test("final: the last ACCEPT per unit, later REJECTs do not displace it, the deadline cuts", () => {
  const entries: LedgerEntry[] = [];
  accept(entries, "team-a", "2026-10-30T01:00:00Z", "sha256:a-first");
  accept(entries, "team-b", "2026-10-30T02:00:00Z", "sha256:b-only");
  accept(entries, "team-a", "2026-10-31T01:00:00Z", "sha256:a-last");
  entries.push(makeEntry(entries, { unit: "team-a", result: "REJECT", at: new Date("2026-10-31T02:00:00Z"), reason: "build failed" }));
  entries.push(makeEntry(entries, { unit: "team-c", result: "REJECT", at: new Date("2026-10-31T03:00:00Z"), reason: "scan" }));
  accept(entries, "team-b", "2026-10-31T15:00:01Z", "sha256:b-late"); // after 10/31 24:00 JST

  const before = finalSubmissions(entries, new Date("2026-10-31T15:00:00Z"));
  assert.deepEqual(
    before.map((r) => [r.unit, r.entry.imageDigest, r.accepts, r.rejectedAfter]),
    [
      ["team-a", "sha256:a-last", 2, 1],
      ["team-b", "sha256:b-only", 1, 0],
    ],
  );
  assert.equal(finalSubmissions(entries).find((r) => r.unit === "team-b")!.entry.imageDigest, "sha256:b-late");
  assert.equal(renderAgentsBlock(before), "agents:\n  - id: team-a\n    wallet: AUTO\n  - id: team-b\n    wallet: AUTO");
});

test("CLI: record computes the ZIP sha256, check exits 3 at the limit, final prints table and agents block", async () => {
  const dir = tmp();
  const ledger = join(dir, "ledger.jsonl");
  const zip = join(dir, "team-a.zip");
  writeFileSync(zip, "not really a zip");
  const sha = createHash("sha256").update("not really a zip").digest("hex");

  for (let i = 0; i < 5; i++) {
    const r = await run(["record", "--ledger", ledger, "--unit", "team-a", "--result", "ACCEPT", "--zip", zip,
      "--digest", `sha256:d${i}`, "--at", `2026-10-21T0${i}:00:00Z`]);
    assert.equal(r.code, 0, r.err);
  }
  const lines = parseLedger(readFileSync(ledger, "utf8"));
  assert.equal(lines.length, 5);
  assert.equal(lines[0].zipSha256, sha);
  assert.equal(lines[0].zip, "team-a.zip");

  const full = await run(["check", "--ledger", ledger, "--unit", "team-a", "--at", "2026-10-21T06:00:00Z"]);
  assert.equal(full.code, 3);
  assert.match(full.out, /5 accepted on 2026-10-21 \(JST\), 0 of 5 left/);
  const other = await run(["check", "--ledger", ledger, "--unit", "team-b", "--at", "2026-10-21T06:00:00Z"]);
  assert.equal(other.code, 0);

  const over = await run(["record", "--ledger", ledger, "--unit", "team-a", "--result", "ACCEPT", "--digest", "sha256:d5",
    "--at", "2026-10-21T07:00:00Z"]);
  assert.equal(over.code, 3);
  assert.equal(parseLedger(readFileSync(ledger, "utf8")).length, 6, "an over-limit ACCEPT is still recorded");

  const fin = await run(["final", "--ledger", ledger]);
  assert.equal(fin.code, 0);
  assert.match(fin.out, /team-a\s+2026-10-21T07:00:00.000Z\s+2026-10-21\s+sha256:d5/);
  assert.match(fin.out, /agents:\n  - id: team-a\n    wallet: AUTO/);
  assert.match(fin.err, /more than 5 accepts on 2026-10-21 \(6\)/);
  const yamlOnly = await run(["final", "--ledger", ledger, "--format", "yaml"]);
  assert.equal(yamlOnly.out, "agents:\n  - id: team-a\n    wallet: AUTO");
});

// accept-submission.sh with ERIS_SUBMISSION_LEDGER: the rejection paths need neither docker nor a
// real bundle, and they are where a silent ledger would matter most.
function makeZip(path: string, files: Record<string, string>): void {
  const script = "import sys, zipfile, json\nz = zipfile.ZipFile(sys.argv[1], 'w')\n" +
    "for k, v in json.loads(sys.argv[2]).items(): z.writestr(k, v)\nz.close()\n";
  const r = spawnSync("python3", ["-c", script, path, JSON.stringify(files)]);
  assert.equal(r.status, 0, String(r.stderr));
}

function accept_submission(zip: string, unit: string, env: Record<string, string>) {
  return spawnSync("bash", ["infra/submission/accept-submission.sh", zip, unit], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("accept-submission.sh records a REJECT with its reason, and nothing without the env", () => {
  const dir = tmp();
  const zip = join(dir, "bundle.zip");
  makeZip(zip, { "README.md": "no agent here\n" });
  const ledger = join(dir, "ledger.jsonl");

  const plain = accept_submission(zip, "ledger-test-unit", { ERIS_SUBMISSION_LEDGER: "" });
  assert.equal(plain.status, 1);
  assert.ok(!existsSync(ledger));

  const r = accept_submission(zip, "ledger-test-unit", { ERIS_SUBMISSION_LEDGER: ledger });
  assert.equal(r.status, 1, r.stderr);
  const [entry] = parseLedger(readFileSync(ledger, "utf8"));
  assert.equal(entry.unit, "ledger-test-unit");
  assert.equal(entry.result, "REJECT");
  assert.equal(entry.reason, "no agent directory found under agents/ in the bundle");
  assert.equal(entry.zipSha256, createHash("sha256").update(readFileSync(zip)).digest("hex"));
  assert.ok(!existsSync("example/agents/ledger-test-unit"));
});

test("accept-submission.sh refuses a sixth submission on the same JST day before scanning", () => {
  const dir = tmp();
  const zip = join(dir, "bundle.zip");
  makeZip(zip, { "README.md": "x\n" });
  const ledger = join(dir, "ledger.jsonl");
  const entries: LedgerEntry[] = [];
  const now = Date.now();
  for (let i = 0; i < 5; i++)
    accept(entries, "ledger-test-unit", new Date(now - i * 1000).toISOString(), `sha256:x${i}`);
  // Today's JST day, whatever the clock says: rewrite the day to the current one.
  const today = jstDay(new Date());
  writeFileSync(ledger, entries.map((e) => JSON.stringify({ ...e, jstDay: today })).join("\n") + "\n");

  const r = accept_submission(zip, "ledger-test-unit", { ERIS_SUBMISSION_LEDGER: ledger });
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stdout, /1\/4 scan/);
  const last = parseLedger(readFileSync(ledger, "utf8")).at(-1)!;
  assert.equal(last.result, "REJECT");
  assert.match(last.reason!, /daily limit reached/);

  // With the override the scan runs (and this bundle then fails for its own reason).
  const o = accept_submission(zip, "ledger-test-unit", { ERIS_SUBMISSION_LEDGER: ledger, ERIS_SUBMISSION_OVER_LIMIT: "1" });
  assert.equal(o.status, 1);
  assert.match(o.stdout, /1\/4 scan/);
  assert.equal(parseLedger(readFileSync(ledger, "utf8")).at(-1)!.reason, "no agent directory found under agents/ in the bundle");
});

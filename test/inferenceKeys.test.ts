import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadParticipantKeys } from "../core/src/inference/proxy.js";
import {
  buildKeys,
  compareRoster,
  detectColumns,
  keyWarnings,
  loadColumnMap,
  main,
  maskKey,
  normalizeProvider,
  parseCsv,
  parseFormTimestamp,
  rosterIds,
} from "../scripts/inferenceKeys.js";

// Fake keys only. Long enough to be masked as "first 4 + last 2".
const OPENAI_A = "sk-proj-FAKEaaaaaaaaaaaaaaaaaaaa01";
const OPENAI_A2 = "sk-proj-FAKEbbbbbbbbbbbbbbbbbbbb02";
const ANTHROPIC_B = "sk-ant-api03-FAKEcccccccccccccccc03";
const OLLAMA_C = "0123456789abcdefFAKE.ollamacloudkey04";

const JA_CSV = [
  "タイムスタンプ,メールアドレス,参加単位の識別子,推論サービス,API キー",
  `2026/10/20 9:00:00,a@example.com,team-alpha,OpenAI,${OPENAI_A}`,
  `2026/10/20 10:00:00,b@example.com,team-beta,Anthropic (Claude),${ANTHROPIC_B}`,
  `2026/10/21 8:00:00,c@example.com,team-gamma,Ollama Cloud,${OLLAMA_C}`,
  // A later answer for (team-alpha, openai) replaces the first one, even though it is not last.
  `2026/10/21 12:00:00,a@example.com,team-alpha,openai,${OPENAI_A2}`,
  `2026/10/21 11:00:00,a@example.com,team-alpha,Anthropic,${ANTHROPIC_B}`,
].join("\r\n");

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "inference-keys-"));
}

function run(argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("parseCsv: quotes, doubled quotes, embedded newlines, CRLF, BOM", () => {
  assert.deepEqual(parseCsv('\ufeffa,b\r\n"x, ""y""","line1\nline2"\n'), [
    ["a", "b"],
    ['x, "y"', "line1\nline2"],
  ]);
  assert.throws(() => parseCsv('a,"b'), /quoted field/);
});

test("providers: common spellings, and an ambiguous answer is not guessed", () => {
  assert.equal(normalizeProvider("OpenAI"), "openai");
  assert.equal(normalizeProvider("OpenAI (GPT-5)"), "openai");
  assert.equal(normalizeProvider("Anthropic (Claude)"), "anthropic");
  assert.equal(normalizeProvider("Ollama Cloud"), "ollama");
  assert.equal(normalizeProvider("ＯｐｅｎＡＩ"), "openai");
  assert.equal(normalizeProvider("OpenAI or Anthropic"), undefined);
  assert.equal(normalizeProvider("Gemini"), undefined);
});

test("timestamps: ja, en-US and ISO order the same way", () => {
  assert.equal(parseFormTimestamp("2026/10/21 9:05:03"), Date.UTC(2026, 9, 21, 9, 5, 3));
  assert.equal(parseFormTimestamp("10/21/2026 9:05:03"), Date.UTC(2026, 9, 21, 9, 5, 3));
  assert.equal(parseFormTimestamp("2026-10-21T09:05:03Z"), Date.UTC(2026, 9, 21, 9, 5, 3));
  assert.equal(parseFormTimestamp("yesterday"), undefined);
});

test("columns are detected from Japanese and English headers", () => {
  assert.deepEqual(detectColumns(["タイムスタンプ", "メールアドレス", "参加単位の識別子", "推論サービス", "API キー"]), {
    timestamp: "タイムスタンプ",
    unit: "参加単位の識別子",
    provider: "推論サービス",
    key: "API キー",
  });
  // "Handle" beats "Team name"; the provider column is the one that is not the key.
  assert.deepEqual(detectColumns(["Timestamp", "Team name", "Handle", "Inference provider", "API key"]), {
    timestamp: "Timestamp",
    unit: "Handle",
    provider: "Inference provider",
    key: "API key",
  });
  // One key column per provider and no provider question.
  assert.deepEqual(detectColumns(["Timestamp", "Handle", "OpenAI API key", "Anthropic API key"]), {
    timestamp: "Timestamp",
    unit: "Handle",
    providerKeys: { openai: "OpenAI API key", anthropic: "Anthropic API key" },
  });
  assert.throws(() => detectColumns(["Timestamp", "Email"]), /--map/);
  assert.throws(() => detectColumns(["Handle", "API key", "Backup API key"]), /more than one column looks like the API key/);
});

test("buildKeys: one entry per (unit, provider), the latest answer wins by timestamp", () => {
  const r = buildKeys(JA_CSV);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.keys, {
    "team-alpha": { anthropic: ANTHROPIC_B, openai: OPENAI_A2 },
    "team-beta": { anthropic: ANTHROPIC_B },
    "team-gamma": { ollama: OLLAMA_C },
  });
  assert.deepEqual(r.replaced, [{ unit: "team-alpha", provider: "openai", row: 2, by: 5 }]);
  // The result is exactly what the proxy loads.
  assert.deepEqual(loadParticipantKeys({ participants: r.keys }), r.keys);
});

test("buildKeys: invalid rows are errors, odd keys are warnings", () => {
  const csv = [
    "Timestamp,Handle,Provider,API key",
    `2026/10/20 9:00:00,team alpha,OpenAI,${OPENAI_A}`, // space in the id
    `2026/10/20 9:00:00,runtime,OpenAI,${OPENAI_A}`, // reserved
    `2026/10/20 9:00:00,team-x,Gemini,${OPENAI_A}`, // unknown provider
    "2026/10/20 9:00:00,team-y,OpenAI,", // empty key
    `2026/10/20 9:00:00,team-z,OpenAI,${ANTHROPIC_B}`, // wrong field: warn only
    `not a time,team-w,OpenAI,${OPENAI_A}`,
    ",,,", // blank line
  ].join("\n");
  const r = buildKeys(csv);
  assert.deepEqual(
    r.errors.map((e) => e.row),
    [2, 3, 4, 5, 7],
  );
  assert.deepEqual(Object.keys(r.keys), ["team-z"]);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0].message, /looks like an Anthropic key/);
  assert.ok(!r.warnings[0].message.includes(ANTHROPIC_B), "a warning must not carry the key");
});

test("buildKeys: no provider column -> the key prefix decides, or it is an error", () => {
  const r = buildKeys(["Handle,API key", `team-a,${OPENAI_A}`, `team-b,${ANTHROPIC_B}`, `team-c,${OLLAMA_C}`].join("\n"));
  assert.deepEqual(r.keys, { "team-a": { openai: OPENAI_A }, "team-b": { anthropic: ANTHROPIC_B } });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /no provider column/);
});

test("buildKeys: wide form with an explicit column map", () => {
  const map = loadColumnMap({
    timestamp: "When",
    unit: "Who",
    providerKeys: { openai: "K1", ollama: "K2" },
  });
  const r = buildKeys(["When,Who,K1,K2", `2026-10-20T00:00:00Z,team-a,${OPENAI_A},${OLLAMA_C}`, `2026-10-20T00:00:00Z,team-b,,${OLLAMA_C}`].join("\n"), map);
  assert.deepEqual(r.keys, { "team-a": { ollama: OLLAMA_C, openai: OPENAI_A }, "team-b": { ollama: OLLAMA_C } });
  assert.throws(() => loadColumnMap({ unit: "Who" }), /name the key column/);
  assert.throws(() => loadColumnMap({ unit: "Who", key: "K", colour: "x" }), /unknown entry colour/);
  assert.throws(() => buildKeys("A,B\n1,2", loadColumnMap({ unit: "Who", key: "K" })), /no column "Who"/);
});

test("masking shows at most the first 4 and last 2 characters", () => {
  assert.equal(maskKey(OPENAI_A), `sk-p…01 (${OPENAI_A.length} chars)`);
  assert.equal(maskKey("short-key"), "**** (9 chars)");
  assert.deepEqual(keyWarnings("openai", OPENAI_A), []);
  assert.deepEqual(keyWarnings("anthropic", ANTHROPIC_B), []);
  assert.deepEqual(keyWarnings("ollama", OLLAMA_C), []);
  assert.match(keyWarnings("anthropic", OPENAI_A).join(), /sk-ant-/);
});

test("roster: units without a key and keys without a roster entry", () => {
  const ids = rosterIds(parseYaml("agents:\n  - id: team-alpha\n    wallet: AUTO\n  - id: team-delta\n    wallet: AUTO\n"));
  assert.deepEqual(compareRoster(buildKeys(JA_CSV).keys, ids), {
    noKey: ["team-delta"],
    notInRoster: ["team-beta", "team-gamma"],
  });
});

test("CLI: writes mode 600, never prints a key, refuses to overwrite without --force", () => {
  const dir = tmp();
  const csv = join(dir, "responses.csv");
  const out = join(dir, "inference-keys.yaml");
  const roster = join(dir, "field.yaml");
  writeFileSync(csv, JA_CSV);
  writeFileSync(roster, "agents:\n  - id: team-alpha\n    wallet: AUTO\n  - id: team-delta\n    wallet: AUTO\n");

  const first = run([csv, "--out", out, "--roster", roster]);
  assert.equal(first.code, 0, first.err);
  assert.equal(statSync(out).mode & 0o777, 0o600);
  assert.deepEqual(loadParticipantKeys(parseYaml(readFileSync(out, "utf8"))), buildKeys(JA_CSV).keys);
  for (const k of [OPENAI_A, OPENAI_A2, ANTHROPIC_B, OLLAMA_C])
    assert.ok(!first.out.includes(k) && !first.err.includes(k), "the report must not contain a key");
  assert.match(first.out, /3 unit\(s\), 5 answer\(s\) read, 1 replaced/);
  assert.match(first.out, /1 without a key \(team-delta\)/);
  assert.match(first.out, /2 unit\(s\) with a key and no roster entry \(team-beta, team-gamma\)/);

  const again = run([csv, "--out", out]);
  assert.equal(again.code, 1);
  assert.match(again.err, /exists; pass --force/);
  const forced = run([csv, "--out", out, "--force"]);
  assert.equal(forced.code, 0, forced.err);
  assert.equal(statSync(out).mode & 0o777, 0o600);
});

test("CLI: an unreadable row stops the write unless --skip-invalid", () => {
  const dir = tmp();
  const csv = join(dir, "responses.csv");
  const out = join(dir, "keys.yaml");
  writeFileSync(csv, `Handle,Provider,API key\nteam-a,OpenAI,${OPENAI_A}\nteam b,OpenAI,${OPENAI_A2}\n`);
  const strict = run([csv, "--out", out]);
  assert.equal(strict.code, 1);
  assert.ok(!existsSync(out));
  assert.match(strict.err, /row 3 team b: unit id "team b" is not a roster id/);
  const lenient = run([csv, "--out", out, "--skip-invalid"]);
  assert.equal(lenient.code, 0, lenient.err);
  assert.deepEqual(Object.keys(loadParticipantKeys(parseYaml(readFileSync(out, "utf8")))), ["team-a"]);
  for (const k of [OPENAI_A, OPENAI_A2]) assert.ok(!strict.err.includes(k) && !lenient.out.includes(k));
});

// The sponsor's view (dashboard/server/sponsor.ts): the runs API behind a bearer token, with the
// audience's redactions still in force and two more things served -- the participants' decision
// logs and the inference proxy's records. These tests stand the mount up over a fabricated run
// directory and read it back as the sponsor (and as somebody without the token) would, because what
// they guard -- who can read what, and that every read is recorded -- is a property of the serving.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunsApi, sponsorAllows } from "../dashboard/server/runsApi.js";
import {
  createSponsorApi,
  parseTokenFile,
  sponsorFromEnv,
} from "../dashboard/server/sponsor.js";

const TOKEN = "a".repeat(64);
const OTHER = "b".repeat(64);
const digest = (t: string) => createHash("sha256").update(t).digest("hex");
const RUN = "2026-11-02T10-00-00-000Z";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "eris-sponsor-"));
  const runs = join(root, "runs");
  // One epoch of a scenario matrix, still running: the seed and the regime are the secrets.
  const run = join(runs, RUN);
  mkdirSync(join(run, "agents"), { recursive: true });
  mkdirSync(join(run, "disclosures"), { recursive: true });
  mkdirSync(join(run, "resume"), { recursive: true });
  writeFileSync(
    join(run, "events.jsonl"),
    [
      { type: "run_started_realtime", runId: "e", seed: 4242, flowSeed: 7, scenarioRegime: "crash", resetUnit: "scenario" },
      {
        type: "stress_schedule",
        runStartBlock: 100,
        events: [{ type: "crash", magnitude: 0.14, startBlock: 30, endBlock: 47 }],
      },
      { type: "stress_calibration_warning", note: "crash 0.14 breaches HF0 1.10" },
      { type: "pool_created", pool: "0xabc", rigged: true },
      { type: "agent_process_exited", agentId: "alice", code: 1, stderrTail: "secret stderr" },
      { type: "round_timing", blockNumber: 300 },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n",
  );
  writeFileSync(
    join(run, "blocks.csv"),
    "round,blockNumber,txIndex,hash,from,priorityFeeWei,status,ownerId,role,actionType,bundleId,bundleIndex,method,gasUsed\n" +
      "300,300,0,0x9,0xa,0,success,alice,agent,swap,,,exactInputSingle,120000\n",
  );
  writeFileSync(join(run, "agents", "alice.jsonl"), '{"round":1,"reason":"buy the dip"}\n');
  writeFileSync(join(run, "agents", "alice.llm.jsonl"), '{"system":"revise"}\n');
  mkdirSync(join(run, "agents", "alice"), { recursive: true });
  writeFileSync(join(run, "agents", "alice", "state.json"), '{"x":1}\n');
  writeFileSync(join(run, "disclosures", "0xabc.json"), '{"rigged":true}\n');
  writeFileSync(join(run, "resume", "state.json"), '{"seed":4242}\n');

  // A run outside the competition the server is restricted to.
  const smoke = join(runs, "smoke-run");
  mkdirSync(join(smoke, "agents"), { recursive: true });
  writeFileSync(join(smoke, "summary.json"), '{"runId":"smoke"}\n');
  writeFileSync(join(smoke, "agents", "bob.jsonl"), '{"reason":"smoke"}\n');

  const matrix = join(runs, "matrix-live");
  mkdirSync(matrix);
  writeFileSync(
    join(matrix, "matrix.json"),
    JSON.stringify({
      schema: 2,
      resetUnit: "scenario",
      scenarios: [{ s: 1, regime: "crash", seed: 4242, runDir: `runs/${RUN}`, agents: [] }],
    }),
  );
  // The inference proxy's records, under the conventional --record directory.
  const inference = join(matrix, "inference");
  mkdirSync(inference);
  writeFileSync(
    join(inference, "alice.jsonl"),
    `${JSON.stringify({ agentId: "alice", seq: 1, request: { messages: [] }, response: { ok: true } })}\n` +
      '{"agentId":"alice","seq":2,"partial',
  );

  const sponsorDir = join(root, "sponsor");
  mkdirSync(sponsorDir);
  const tokensFile = join(sponsorDir, "tokens");
  writeFileSync(
    tokensFile,
    `# issued by infra/dashboard/issue-sponsor-token.sh\n${digest(TOKEN)} allied issued=2026-10-21T00:00:00Z\n`,
  );
  return {
    root,
    runs,
    tokensFile,
    accessLog: join(sponsorDir, "access.jsonl"),
    inference,
  };
}

async function serve(handle: ReturnType<typeof createSponsorApi>) {
  const server = createServer((req, res) => {
    const [p, q] = (req.url ?? "/").split("?");
    if (!handle(p, q, req, res)) {
      res.statusCode = 418; // not under the mount: the caller's business
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const get = async (path: string, token: string | null = TOKEN) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    });
    return { status: res.status, text: await res.text(), headers: res.headers };
  };
  return { get, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function sponsorApi(f: ReturnType<typeof fixture>, extra: { accessLog?: string | null; inference?: boolean } = {}) {
  return createSponsorApi({
    runsDir: f.runs,
    tokensFile: f.tokensFile,
    ...(extra.accessLog === null ? {} : { accessLog: extra.accessLog ?? f.accessLog }),
    ...(extra.inference === false ? {} : { inferenceDir: f.inference }),
    competitions: ["matrix-live"],
    now: () => new Date("2026-11-02T10:05:00.000Z"),
  });
}

test("no token, a wrong token and a malformed header are all 401, whatever the path", async () => {
  const f = fixture();
  const { get, close } = await serve(sponsorApi(f));
  try {
    for (const path of [
      `/sponsor/runs/${RUN}/agents/alice.jsonl`, // exists, served with a token
      `/sponsor/runs/${RUN}/disclosures/0xabc.json`, // exists, withheld even with a token
      "/sponsor/runs/no-such-run/summary.json", // does not exist
      "/sponsor/inference/alice.jsonl",
      "/sponsor/runs/%", // not even a valid path
      "/sponsor",
    ]) {
      for (const token of [null, OTHER, "short", `${TOKEN} extra`]) {
        const r = await get(path, token);
        assert.equal(r.status, 401, `${path} with ${String(token)}`);
        assert.equal(r.text, "");
        assert.equal(r.headers.get("www-authenticate"), 'Bearer realm="sponsor"');
      }
    }
    // Nothing unauthenticated is recorded as an access.
    assert.equal(existsSync(f.accessLog), false);
    // The prefix is the mount's and nothing else's.
    assert.equal((await get("/runs/index.json")).status, 418);
  } finally {
    await close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("the sponsor reads the audience's files and the decision logs, never privately cached", async () => {
  const f = fixture();
  const { get, close } = await serve(sponsorApi(f));
  try {
    const log = await get(`/sponsor/runs/${RUN}/agents/alice.jsonl`);
    assert.equal(log.status, 200);
    assert.match(log.text, /buy the dip/);
    assert.equal(log.headers.get("cache-control"), "private, no-store");
    assert.equal((await get(`/sponsor/runs/${RUN}/agents/alice.llm.jsonl`)).status, 200);
    const tail = JSON.parse((await get(`/sponsor/runs/${RUN}/tail/agents/alice.jsonl?offset=0`)).text);
    assert.match(tail.text, /buy the dip/);
    assert.equal((await get(`/sponsor/runs/${RUN}/blocks.csv`)).status, 200);
    const index = JSON.parse((await get("/sponsor/runs/index.json")).text) as Array<{ id: string }>;
    assert.deepEqual(index.map((e) => e.id).sort(), [RUN, "matrix-live"].sort());
    const mode = JSON.parse((await get("/sponsor/runs/mode.json")).text);
    assert.deepEqual(mode, { audience: true, standings: true, sponsor: true });
    // Still withheld: the answer key, a period's checkpoint, what is below agents/.
    assert.equal((await get(`/sponsor/runs/${RUN}/disclosures/0xabc.json`)).status, 404);
    assert.equal((await get(`/sponsor/runs/${RUN}/resume/state.json`)).status, 404);
    assert.equal((await get(`/sponsor/runs/${RUN}/agents/alice/state.json`)).status, 404);
    // ERIS_DASHBOARD_COMPETITIONS applies here too.
    assert.equal((await get("/sponsor/runs/smoke-run/agents/bob.jsonl")).status, 404);
    assert.equal((await get("/sponsor/runs/smoke-run/summary.json")).status, 404);
    // Not a path under the mount.
    assert.equal((await get("/sponsor/elsewhere")).status, 404);
  } finally {
    await close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("the scenario secrets stay redacted for the sponsor", async () => {
  const f = fixture();
  const { get, close } = await serve(sponsorApi(f));
  try {
    for (const text of [
      (await get(`/sponsor/runs/${RUN}/events.jsonl`)).text,
      JSON.parse((await get(`/sponsor/runs/${RUN}/tail/events.jsonl?offset=0`)).text).text as string,
    ]) {
      assert.doesNotMatch(text, /4242/); // the seed
      assert.doesNotMatch(text, /flowSeed/);
      assert.doesNotMatch(text, /scenarioRegime/);
      assert.doesNotMatch(text, /stress_schedule/); // a scenario epoch serves none of the plan
      assert.doesNotMatch(text, /stress_calibration_warning/);
      assert.doesNotMatch(text, /rigged/);
      assert.doesNotMatch(text, /secret stderr/);
      assert.match(text, /run_started_realtime/);
    }
    const matrix = JSON.parse((await get("/sponsor/runs/matrix-live/matrix.json")).text);
    assert.equal(matrix.scenarios[0].regime, "hidden");
    assert.equal(matrix.scenarios[0].seed, null);
  } finally {
    await close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("inference records are served on the sponsor mount and nowhere public", async () => {
  const f = fixture();
  const { get, close } = await serve(sponsorApi(f));
  const publicApi = createRunsApi(f.runs, { audience: true });
  const pub = createServer((req, res) => {
    const [p, q] = (req.url ?? "/").split("?");
    if (!publicApi(p, q, req, res)) {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => pub.listen(0, "127.0.0.1", r));
  const addr = pub.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const index = JSON.parse((await get("/sponsor/inference/index.json")).text) as Array<{ path: string }>;
    assert.deepEqual(index.map((e) => e.path), ["alice.jsonl"]);
    const whole = await get("/sponsor/inference/alice.jsonl");
    assert.equal(whole.status, 200);
    assert.match(whole.text, /"seq":1/);
    assert.equal(whole.headers.get("cache-control"), "private, no-store");
    // The tail serves whole records only: the one still being written waits.
    const tail = JSON.parse((await get("/sponsor/inference/tail/alice.jsonl?offset=0")).text);
    assert.match(tail.text, /"seq":1/);
    assert.doesNotMatch(tail.text, /partial/);
    // (fetch resolves a literal "/../" itself, so the escapes are what a server actually sees)
    assert.equal((await get("/sponsor/inference/..%2F..%2Fmatrix-live%2Fmatrix.json")).status, 404);
    assert.equal((await get("/sponsor/inference/tail/..%2Fmatrix.json?offset=0")).status, 404);
    assert.equal((await get(`/sponsor/inference/..%2F..%2F${RUN}%2Fagents%2Falice.jsonl`)).status, 404);
    assert.equal((await get("/sponsor/inference/%2e%2e/matrix.json")).status, 404);
    // Not through the sponsor's runs view (one door per kind of file)...
    assert.equal((await get("/sponsor/runs/matrix-live/inference/alice.jsonl")).status, 404);
    // ...and never through the public one: not even under an artifact's name.
    writeFileSync(join(f.inference, "market.jsonl"), '{"agentId":"market","request":"x"}\n');
    for (const p of ["/matrix-live/inference/alice.jsonl", "/matrix-live/inference/market.jsonl", "/matrix-live/tail/inference/market.jsonl?offset=0"]) {
      const r = await fetch(`http://127.0.0.1:${port}${p}`);
      assert.equal(r.status, 404, p);
    }
    // Configured off: the mount answers 404 even with a token.
    const off = await serve(sponsorApi(f, { inference: false }));
    try {
      assert.equal((await off.get("/sponsor/inference/index.json")).status, 404);
    } finally {
      await off.close();
    }
  } finally {
    await close();
    await new Promise<void>((r) => pub.close(() => r()));
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a revoked token is refused on the next request, without a restart", async () => {
  const f = fixture();
  const { get, close } = await serve(sponsorApi(f));
  try {
    assert.equal((await get(`/sponsor/runs/${RUN}/blocks.csv`)).status, 200);
    assert.equal((await get(`/sponsor/runs/${RUN}/blocks.csv`, OTHER)).status, 401);
    // Issue a second token, then revoke the first the way the script does: comment the line out,
    // written beside the file and renamed over it.
    const text = readFileSync(f.tokensFile, "utf8");
    const next = `${text.replace(/^([0-9a-f]{64} allied)/m, "# revoked=2026-11-02T10:06:00Z $1")}${digest(OTHER)} second issued=2026-11-02T10:06:00Z\n`;
    writeFileSync(`${f.tokensFile}.tmp`, next);
    renameSync(`${f.tokensFile}.tmp`, f.tokensFile);
    assert.equal((await get(`/sponsor/runs/${RUN}/blocks.csv`)).status, 401);
    assert.equal((await get(`/sponsor/runs/${RUN}/blocks.csv`, OTHER)).status, 200);
    // A token file that is gone admits nobody.
    rmSync(f.tokensFile);
    assert.equal((await get(`/sponsor/runs/${RUN}/blocks.csv`, OTHER)).status, 401);
  } finally {
    await close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("every admitted request is recorded first, and nothing is served if it cannot be", async () => {
  const f = fixture();
  const { get, close } = await serve(sponsorApi(f));
  try {
    await get(`/sponsor/runs/${RUN}/agents/alice.jsonl`);
    await get("/sponsor/inference/tail/alice.jsonl?offset=0");
    await get("/sponsor/runs/no-such-run/summary.json"); // a 404 is still an access
    await get(`/sponsor/runs/${RUN}/blocks.csv`, null); // unauthenticated: not an access
    const lines = readFileSync(f.accessLog, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines, [
      { ts: "2026-11-02T10:05:00.000Z", label: "allied", method: "GET", path: `/sponsor/runs/${RUN}/agents/alice.jsonl` },
      { ts: "2026-11-02T10:05:00.000Z", label: "allied", method: "GET", path: "/sponsor/inference/tail/alice.jsonl?offset=0" },
      { ts: "2026-11-02T10:05:00.000Z", label: "allied", method: "GET", path: "/sponsor/runs/no-such-run/summary.json" },
    ]);
    // The token itself is never written down.
    assert.doesNotMatch(readFileSync(f.accessLog, "utf8"), new RegExp(TOKEN));
  } finally {
    await close();
  }
  // No access log configured, or one that cannot be written: 503, and no data.
  for (const accessLog of [null, join(f.root, "no-such-dir", "access.jsonl")]) {
    const s = await serve(sponsorApi(f, { accessLog }));
    try {
      const r = await s.get(`/sponsor/runs/${RUN}/agents/alice.jsonl`);
      assert.equal(r.status, 503);
      assert.equal(r.text, "");
    } finally {
      await s.close();
    }
  }
  rmSync(f.root, { recursive: true, force: true });
});

test("parseTokenFile skips comments, revoked lines and anything malformed", () => {
  const tokens = parseTokenFile(
    [
      "# a comment",
      `# revoked=2026-11-01T00:00:00Z ${digest("x".repeat(64))} gone issued=2026-10-01T00:00:00Z`,
      `${digest(TOKEN)} allied issued=2026-10-21T00:00:00Z`,
      `${digest(OTHER).toUpperCase()} upper`,
      "not-a-digest label",
      `${digest(TOKEN)}`, // no label
      "",
    ].join("\n"),
  );
  assert.deepEqual(tokens.map((t) => t.label), ["allied", "upper"]);
});

test("sponsorAllows: the audience's files plus a run's agents/<id>.jsonl, and nothing else", () => {
  assert.equal(sponsorAllows("r/events.jsonl"), true);
  assert.equal(sponsorAllows("r/agents/alice.jsonl"), true);
  assert.equal(sponsorAllows("p/day0/agents/alice.llm.jsonl"), true);
  assert.equal(sponsorAllows("r/agents/alice/state.json"), false);
  assert.equal(sponsorAllows("r/agents/.hidden.jsonl"), false);
  assert.equal(sponsorAllows("r/agents/alice.json"), false);
  assert.equal(sponsorAllows("r/disclosures/agents/x.jsonl"), false);
  assert.equal(sponsorAllows("p/resume/cut-1/agents/a.jsonl"), false);
  assert.equal(sponsorAllows("c/inference/alice.jsonl"), false);
  assert.equal(sponsorAllows("c/inference/agents/alice.jsonl"), false);
});

test("sponsorFromEnv: off without a token file", () => {
  assert.equal(sponsorFromEnv({}), null);
  assert.equal(sponsorFromEnv({ ERIS_DASHBOARD_SPONSOR_TOKENS_FILE: " " }), null);
  assert.deepEqual(
    sponsorFromEnv({
      ERIS_DASHBOARD_SPONSOR_TOKENS_FILE: "/s/tokens",
      ERIS_DASHBOARD_SPONSOR_ACCESS_LOG: "/s/access.jsonl",
      ERIS_DASHBOARD_INFERENCE_DIR: "/eris/runs/c/inference",
    }),
    {
      tokensFile: "/s/tokens",
      accessLog: "/s/access.jsonl",
      inferenceDir: "/eris/runs/c/inference",
    },
  );
});

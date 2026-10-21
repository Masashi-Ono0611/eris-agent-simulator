import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploymentsFingerprint } from "../core/src/backtest/shared.js";
import {
  ALLOW_MISMATCH_ENV,
  describeDecision,
  overlayDecision,
} from "../scripts/checkAgentOverlay.js";

// A repo root with an overlay stamped `overlayFp` and, when `deployments` is given, a state manifest
// bundling those deployments under the fingerprint the backtest computes for them.
function fixture(t: { after: (fn: () => void) => void }, overlayFp: string, deployments?: object): string {
  const root = mkdtempSync(join(tmpdir(), "eris-overlay-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "sdk", "src"), { recursive: true });
  writeFileSync(
    join(root, "sdk", "src", "constants.local.ts"),
    `// generated\nexport const DEPLOYMENTS_FINGERPRINT = "${overlayFp}";\n`,
  );
  if (deployments) {
    mkdirSync(join(root, "backtest", "state"), { recursive: true });
    writeFileSync(
      join(root, "backtest", "state", "manifest.json"),
      JSON.stringify({
        schema: 1,
        createdAt: "2026-10-15T00:00:00Z",
        sourceCommit: "abc",
        anvilVersion: "1.8.1",
        chainId: 31337,
        genesisHash: "0x00",
        stateFile: "state.json",
        deploymentsFingerprint: deploymentsFingerprint(deployments),
        deployments,
      }),
    );
  }
  return root;
}

const dump = { chainId: 31337, tokens: { WETH: "0x01" } };

test("no state manifest: the overlay is not checked", t => {
  assert.equal(overlayDecision(fixture(t, "sha256:any"), {}).kind, "no-manifest");
});

test("an overlay generated from the dump's deployments matches", t => {
  assert.equal(overlayDecision(fixture(t, deploymentsFingerprint(dump), dump), {}).kind, "match");
});

test("an overlay naming another deployment is refused, and the refusal names the fix and the override", t => {
  const d = overlayDecision(fixture(t, deploymentsFingerprint({ chainId: 31337, tokens: { WETH: "0x02" } }), dump), {});
  assert.equal(d.kind, "mismatch");
  const msg = describeDecision(d);
  assert.match(msg, /npm run gen:local-constants:from-dump/);
  assert.match(msg, /DEPLOYMENTS_JSON=backtest\/state\/deployments\.extracted\.json npm run gen:local-constants/);
  assert.match(msg, new RegExp(`${ALLOW_MISMATCH_ENV}=1`));
});

test("an overlay without a stamped fingerprint is a mismatch, not a pass", t => {
  const root = fixture(t, "x", dump);
  writeFileSync(join(root, "sdk", "src", "constants.local.ts"), "export const X = 1;\n");
  assert.equal(overlayDecision(root, {}).kind, "mismatch");
});

test(`${ALLOW_MISMATCH_ENV}=1 turns a mismatch into a warned build; other values do not`, t => {
  const root = fixture(t, "sha256:other", dump);
  assert.equal(overlayDecision(root, { [ALLOW_MISMATCH_ENV]: "1" }).kind, "override");
  assert.equal(overlayDecision(root, { [ALLOW_MISMATCH_ENV]: "true" }).kind, "mismatch");
});

test("ERIS_AGENT_BUILD_STATE_DIR points the check at another dump", t => {
  const root = fixture(t, "sha256:other");
  const other = fixture(t, "sha256:unused", dump);
  const d = overlayDecision(root, { ERIS_AGENT_BUILD_STATE_DIR: join(other, "backtest", "state") });
  assert.equal(d.kind, "mismatch");
});

/**
 * Gate for `npm run agent:build` (issue #310): refuse to bake an address overlay into the agent
 * base image when it names a different deployment than the state dump the backtest will load.
 *
 * The image carries `sdk/src/constants.local.ts` as it was at build time. `backtest` regenerates
 * that file from the dump's manifest at startup, but by then the images already exist, so every
 * agent points at addresses the chain does not have and exits at preflight ("N of N contracts
 * hold no code"). The 2026-10-20 rehearsal lost its first attempt this way.
 *
 * The fingerprints are the backtest's own: the one stamped in constants.local.ts
 * (readConstantsFingerprint) against the manifest's deploymentsFingerprint.
 *
 * Usage (build.sh calls it): tsx scripts/checkAgentOverlay.ts
 *   ERIS_AGENT_BUILD_STATE_DIR   state dump directory (default backtest/state)
 *   ERIS_AGENT_BUILD_ALLOW_OVERLAY_MISMATCH=1   build anyway (the images target another chain)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANIFEST_FILE_NAME,
  STATE_DIR_DEFAULT,
  readConstantsFingerprint,
  validateStateManifest,
} from "../core/src/backtest/shared.js";

export const ALLOW_MISMATCH_ENV = "ERIS_AGENT_BUILD_ALLOW_OVERLAY_MISMATCH";

export type OverlayDecision =
  | { kind: "no-manifest"; manifestPath: string }
  | { kind: "match"; fingerprint: string }
  | { kind: "mismatch"; overlay: string | undefined; manifest: string; manifestPath: string; stateDir: string }
  | { kind: "override"; overlay: string | undefined; manifest: string; manifestPath: string; stateDir: string };

export function overlayDecision(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): OverlayDecision {
  // Relative to the repo when inside it, so the fix the refusal prints can be pasted as is.
  const stateAbs = resolve(root, env.ERIS_AGENT_BUILD_STATE_DIR || STATE_DIR_DEFAULT);
  const rel = relative(root, stateAbs);
  const stateDir = rel && !rel.startsWith("..") ? rel : stateAbs;
  const manifestPath = join(stateAbs, MANIFEST_FILE_NAME);
  if (!existsSync(manifestPath)) return { kind: "no-manifest", manifestPath };
  const manifest = validateStateManifest(
    JSON.parse(readFileSync(manifestPath, "utf8")),
    manifestPath,
  ).deploymentsFingerprint;
  const overlay = readConstantsFingerprint(
    join(root, "sdk", "src", "constants.local.ts"),
  );
  if (overlay === manifest) return { kind: "match", fingerprint: overlay };
  const detail = { overlay, manifest, manifestPath, stateDir };
  return env[ALLOW_MISMATCH_ENV] === "1"
    ? { kind: "override", ...detail }
    : { kind: "mismatch", ...detail };
}

export function describeDecision(d: OverlayDecision): string {
  switch (d.kind) {
    case "no-manifest":
      return `[agent:build] no state manifest at ${d.manifestPath}; the overlay is not checked`;
    case "match":
      return `[agent:build] constants.local.ts matches the state dump (${d.fingerprint.slice(0, 20)}…)`;
    case "override":
      return (
        `[agent:build] WARNING: constants.local.ts (${d.overlay ?? "(none)"}) does not match ` +
        `${d.manifestPath} (${d.manifest}); building anyway because ${ALLOW_MISMATCH_ENV}=1`
      );
    case "mismatch": {
      const dir = d.stateDir;
      return [
        `[agent:build] refusing to build: sdk/src/constants.local.ts names a different deployment than the state dump`,
        `  overlay  ${d.overlay ?? "(no DEPLOYMENTS_FINGERPRINT)"}`,
        `  manifest ${d.manifest}  (${d.manifestPath})`,
        `The image would carry these addresses, and every agent would exit at preflight with`,
        `"N of N contracts hold no code" (issue #310). Regenerate the overlay from the dump, then build:`,
        `  npm run gen:local-constants:from-dump${dir === STATE_DIR_DEFAULT ? "" : ` -- ${dir}`}`,
        `which is the same as`,
        `  python3 -c "import json; m=json.load(open('${dir}/manifest.json')); json.dump(m['deployments'], open('${dir}/deployments.extracted.json','w'))"`,
        `  DEPLOYMENTS_JSON=${dir}/deployments.extracted.json npm run gen:local-constants`,
        `If these images are meant for another chain (not this dump), set ${ALLOW_MISMATCH_ENV}=1.`,
      ].join("\n");
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const d = overlayDecision(root);
  if (d.kind === "mismatch") {
    console.error(describeDecision(d));
    process.exit(1);
  }
  console.error(describeDecision(d));
}

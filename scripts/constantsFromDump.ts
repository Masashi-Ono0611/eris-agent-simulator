/**
 * Regenerate sdk/src/constants.local.ts from the deployments bundled in a state dump's manifest
 * (issue #310). This is what `backtest` does at startup when the fingerprints differ; run it before
 * `npm run agent:build` so the images carry the dump's addresses.
 *
 * Usage: npm run gen:local-constants:from-dump [-- <state dir>]   (default backtest/state)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  MANIFEST_FILE_NAME,
  STATE_DIR_DEFAULT,
  validateStateManifest,
} from "../core/src/backtest/shared.js";
import { generateLocalConstants } from "./genLocalConstants.js";

const stateDir = resolve(process.argv[2] ?? STATE_DIR_DEFAULT);
const manifestPath = join(stateDir, MANIFEST_FILE_NAME);
const manifest = validateStateManifest(
  JSON.parse(readFileSync(manifestPath, "utf8")),
  manifestPath,
);
const extracted = join(stateDir, "deployments.extracted.json");
writeFileSync(extracted, `${JSON.stringify(manifest.deployments, null, 2)}\n`);
const { target, fingerprint } = generateLocalConstants(extracted);
if (fingerprint !== manifest.deploymentsFingerprint) {
  console.error(
    `regenerated ${target} but its fingerprint (${fingerprint}) still differs from the manifest ` +
      `(${manifest.deploymentsFingerprint}). Check the combination of the state dump and repo versions`,
  );
  process.exit(1);
}
console.log(`${target} now matches ${manifestPath} (${fingerprint.slice(0, 20)}…)`);

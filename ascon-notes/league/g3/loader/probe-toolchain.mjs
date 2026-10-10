import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const PINNED_TOOLCHAIN = Object.freeze({ node: 'v24.13.0', tsx: '4.23.13' });
export const TOOLCHAIN_OVERRIDE_NOTE = 'toolchain differs from the pinned reference; results are for this toolchain only';

// Only measurement entrypoints forward these explicit settings. Empty is an
// expected value too, so it fails the exact comparison instead of falling back.
export function toolchainEnvironment(env = process.env) {
  return Object.fromEntries(['G3_PROBE_EXPECT_NODE', 'G3_PROBE_EXPECT_TSX']
    .filter(key => env[key] !== undefined).map(key => [key, env[key]]));
}

export function probeToolchain(env = process.env) {
  const toolchainOverride = Object.keys(toolchainEnvironment(env)).length > 0;
  return { node: process.version, tsx: require('tsx/package.json').version, toolchainOverride,
    expectedNode: env.G3_PROBE_EXPECT_NODE ?? PINNED_TOOLCHAIN.node,
    expectedTsx: env.G3_PROBE_EXPECT_TSX ?? PINNED_TOOLCHAIN.tsx,
    toolchainNote: toolchainOverride ? TOOLCHAIN_OVERRIDE_NOTE : 'pinned reference toolchain' };
}

import { after } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, parseAbi, type Hex } from "viem";
import type { RegistryEntryObservation } from "@eris/sdk";
import { TOKENS } from "@eris/sdk/constants.js";

// Synthetic creation/runtime bytes. No EVM runs: the client.call stub returns
// this runtime, exercising the real launchTokenCodehash -> launchPools path.
export const LAUNCH_RUNTIME: Hex = "0x60006000f3";
export const LAUNCH_CODEHASH = keccak256(LAUNCH_RUNTIME);

export function installLaunchArtifactFixture(): void {
  const previous = process.env.ERIS_FORGE_OUT;
  const out = mkdtempSync(join(tmpdir(), "ascon-launch-artifact-"));
  mkdirSync(join(out, "AgentERC20.sol"));
  writeFileSync(join(out, "AgentERC20.sol/AgentERC20.json"), JSON.stringify({
    abi: parseAbi(["constructor(string name, string symbol, uint8 decimals, uint256 supply)"]),
    bytecode: { object: "0x6000" },
  }));
  process.env.ERIS_FORGE_OUT = out;
  after(() => {
    if (previous === undefined) delete process.env.ERIS_FORGE_OUT;
    else process.env.ERIS_FORGE_OUT = previous;
    rmSync(out, { recursive: true, force: true });
  });
}

export function launchEntries(pool: string, token: string, creator: string): RegistryEntryObservation[] {
  const common = { creator, mine: false, registeredAtBlock: "1", codehashAtRegistration: LAUNCH_CODEHASH };
  return [
    { ...common, kind: "uniswapV3Pool", market: pool, token0: token, token1: TOKENS.USDC.address, verified: true },
    { ...common, kind: "erc20", market: token, codehashNow: LAUNCH_CODEHASH, verified: false },
  ];
}

// Polls the practice-devnet balances of the agent wallet and exits 0 once ETH, WETH and USDC are all > 0
// (the faucet sends the manifest's `funding` amounts). Prints amounts only, never keys or headers.
// Usage: npx tsx ascon-notes/practice/wait-funds.ts [--interval-sec 90] [--max-min 240]
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, formatEther, formatUnits, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadPracticeEnv } from "./env.js";

function numArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? Number(process.argv[i + 1]) : fallback;
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${name} must be a positive number`);
  return v;
}

const intervalMs = numArg("--interval-sec", 90) * 1000;
const deadline = Date.now() + numArg("--max-min", 240) * 60_000;
const env = await loadPracticeEnv();
// --address watches any address read-only (used to prove the FUNDED path with an already funded
// participant listed in the public manifest); by default it watches this agent's own wallet.
const addrIdx = process.argv.indexOf("--address");
const watched = addrIdx >= 0 ? process.argv[addrIdx + 1] : undefined;
if (watched !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(watched)) throw new Error("--address must be a 0x address");
const account = { address: (watched ?? privateKeyToAccount(env.privateKey).address) as `0x${string}` };
const client = createPublicClient({ transport: http(env.rpcUrl, { fetchOptions: { headers: env.headers } }) });
const manifest = JSON.parse(await readFile(resolve(process.cwd(), "manifest.json"), "utf8"));
const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const tokenAddress = (symbol: string): `0x${string}` => {
  const a = manifest?.tokens?.[symbol]?.address;
  if (typeof a !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`manifest.tokens.${symbol}.address missing`);
  return a as `0x${string}`;
};
const weth = tokenAddress("WETH");
const usdc = tokenAddress("USDC");

let last = "";
while (true) {
  try {
    const [eth, w, u] = await Promise.all([
      client.getBalance({ address: account.address }),
      client.readContract({ address: weth, abi, functionName: "balanceOf", args: [account.address] }),
      client.readContract({ address: usdc, abi, functionName: "balanceOf", args: [account.address] }),
    ]);
    last = `ETH ${formatEther(eth)} / WETH ${formatUnits(w, 18)} / USDC ${formatUnits(u, 6)}`;
    console.log(`${new Date().toISOString()} ${last}`);
    if (eth > 0n && w > 0n && u > 0n) {
      console.log(`FUNDED: ${last}`);
      process.exit(0);
    }
  } catch (e) {
    // A transient RPC error must not look like "not funded yet" forever: report it and keep polling.
    console.log(`${new Date().toISOString()} poll error: ${(e as Error).message.slice(0, 120)}`);
  }
  if (Date.now() > deadline) {
    console.log(`TIMEOUT waiting for funds; last seen: ${last || "no successful poll"}`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, intervalMs));
}

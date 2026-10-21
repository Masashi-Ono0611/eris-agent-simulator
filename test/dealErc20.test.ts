import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { clearErc20BalanceSlotCache, dealErc20 } from "@eris/sdk/chain.js";

// Issue #312: dealErc20 finds a token's balance mapping by writing a sentinel and reading balanceOf
// back. A read that came back stale on the right slot made every candidate miss and voided an epoch
// in the rehearsal. These run against a fake node whose balanceOf reads a mapping at `mappingSlot`.

const TOKEN = "0x4181c1802daf4b26def8cbcb863cb1ad77fa80be" as Address;
const ALICE = "0x00000000000000000000000000000000000a11ce" as Address;
const BOB = "0x0000000000000000000000000000000000000b0b" as Address;
const ZERO = `0x${"0".repeat(64)}` as Hex;

function slotKey(holder: Address, slot: number): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [holder, BigInt(slot)],
    ),
  );
}

// `staleRead` decides, per balanceOf read, whether it returns the word from before the last write
// (what anvil's `latest` does when a block is mined across the call) instead of the current one.
function fakeNode(
  mappingSlot: number | null,
  staleRead: (read: { n: number; blockTag: string }) => boolean = () => false,
) {
  const storage = new Map<string, Hex>();
  const previous = new Map<string, Hex>();
  const calls = { writes: 0, reads: 0 };
  const client = {
    request: async ({
      method,
      params,
    }: {
      method: string;
      params: [Address, Hex, Hex];
    }) => {
      if (method !== "anvil_setStorageAt")
        throw new Error(`unexpected ${method}`);
      calls.writes++;
      const k = `${params[0].toLowerCase()}:${params[1]}`;
      previous.set(k, storage.get(k) ?? ZERO);
      storage.set(k, params[2]);
      return true;
    },
    getStorageAt: async ({ address, slot }: { address: Address; slot: Hex }) =>
      storage.get(`${address.toLowerCase()}:${slot}`) ?? ZERO,
    readContract: async ({
      address,
      args,
      blockTag,
    }: {
      address: Address;
      args: [Address];
      blockTag: string;
    }) => {
      calls.reads++;
      if (mappingSlot === null) return 0n;
      const k = `${address.toLowerCase()}:${slotKey(args[0], mappingSlot)}`;
      const stale = staleRead({ n: calls.reads, blockTag });
      return BigInt((stale ? previous.get(k) : storage.get(k)) ?? ZERO);
    },
    getBlockNumber: async () => 4242n,
  } as unknown as PublicClient;
  const balance = (holder: Address) =>
    mappingSlot === null
      ? 0n
      : BigInt(storage.get(`${TOKEN}:${slotKey(holder, mappingSlot)}`) ?? ZERO);
  return { client, calls, balance };
}

test("dealErc20: finds a MockERC20's slot (4) on the first probe", async () => {
  clearErc20BalanceSlotCache();
  const node = fakeNode(4);
  await dealErc20(node.client, TOKEN, ALICE, 25_000_000_000n);
  assert.equal(node.balance(ALICE), 25_000_000_000n);
});

test("dealErc20: a cached slot is written directly and checked with one read", async () => {
  clearErc20BalanceSlotCache();
  const node = fakeNode(4);
  await dealErc20(node.client, TOKEN, ALICE, 1n);
  const before = { ...node.calls };
  await dealErc20(node.client, TOKEN, BOB, 7n);
  assert.equal(node.balance(BOB), 7n);
  assert.equal(node.calls.writes - before.writes, 1);
  assert.equal(node.calls.reads - before.reads, 1);
});

test("dealErc20: a stale `latest` read on the right slot is confirmed at `pending`", async () => {
  clearErc20BalanceSlotCache();
  // Every `latest` read is stale: the race on every probe. `pending` reads the current state.
  const node = fakeNode(4, ({ blockTag }) => blockTag === "latest");
  await dealErc20(node.client, TOKEN, ALICE, 5n);
  assert.equal(node.balance(ALICE), 5n);
});

test("dealErc20: a miss on every candidate is retried once, and the retry succeeds", async () => {
  clearErc20BalanceSlotCache();
  // The right slot (4) is the 9th candidate (reads 17 and 18, after two per miss); both are stale, so
  // the first pass misses everywhere -- what the rehearsal's epoch hit.
  const node = fakeNode(4, ({ n }) => n === 17 || n === 18);
  await dealErc20(node.client, TOKEN, ALICE, 3n);
  assert.equal(node.balance(ALICE), 3n);
  // It took the second pass: the first read all 201 candidates twice (latest + pending).
  assert.ok(node.calls.reads > 2 * 201);
  // And the slot it found is cached: the next grant does not probe.
  const before = node.calls.writes;
  await dealErc20(node.client, TOKEN, BOB, 4n);
  assert.equal(node.calls.writes - before, 1);
});

test("dealErc20: a persistent miss throws with what the candidates read back", async () => {
  clearErc20BalanceSlotCache();
  const node = fakeNode(null);
  await assert.rejects(
    dealErc20(node.client, TOKEN, ALICE, 1n),
    (err: Error) => {
      assert.match(
        err.message,
        /could not locate ERC20 balance slot for token 0x4181/,
      );
      assert.match(err.message, new RegExp(`holder ${ALICE}`));
      assert.match(
        err.message,
        /pass 1 \(head 4242\): slot 9 read latest=0 pending=0/,
      );
      assert.match(err.message, /pass 2 \(head 4242\)/);
      assert.match(err.message, /slot 4 read latest=0 pending=0/);
      return true;
    },
  );
});

test("dealErc20: a cached slot that no longer reads back falls back to the probe", async () => {
  clearErc20BalanceSlotCache();
  await dealErc20(fakeNode(4).client, TOKEN, ALICE, 1n);
  // Same address, different layout (another deployment): the cached slot 4 misses, slot 0 is found.
  const node = fakeNode(0);
  await dealErc20(node.client, TOKEN, BOB, 9n);
  assert.equal(node.balance(BOB), 9n);
});

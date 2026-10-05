import { safeAction, single } from './xb-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AgentContext, AgentObservation } from '@eris/sdk';
import { BALANCER, MARKET_LEGS, UNISWAP } from '@eris/sdk/constants.js';
import { findCheatcodeUsage } from '@eris/sdk/strategyStaticCheck.js';
import { loadAgents } from '../core/src/config.js';
import * as live from '../example/agents/xb-r-live/agent.js';
import * as historical from '../example/agents/xb-r/agent.js';
import { buildRevisionSystem, compileExecutor, DEFAULT_REVISE_EVERY_BLOCKS,
  loadImproveAgent, parseRevision } from '../example/agents/runtime/improve.js';
import { buildClaudeCliArgs, resolveLlmProvider } from '../example/agents/runtime/llm.js';

const dir = 'example/agents/xb-r-live';
const commit = 'd30cbbb46ca472b5a7a72fc1b99deab96dc97bf3';
const fixture = JSON.parse(readFileSync('test/fixtures/xb-r-dev3-v4.json', 'utf8'));

test('live shipped source is byte-identical to d30cbbb v3, not current v5 defaults', () => {
  const source = readFileSync(`${dir}/agent.ts`);
  // The pinned sha256 below is the byte-identity guard. The git object is an extra cross-check that
  // exists only where history is available (a shallow CI checkout does not contain it).
  let historical: Buffer | undefined;
  try { historical = execFileSync('git', ['show', `${commit}:example/agents/xb-r/agent.ts`], { stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { historical = undefined; }
  if (historical) assert.deepEqual(source, historical);
  assert.equal(createHash('sha256').update(source).digest('hex'),
    '78d8fa43156cee872e1bcbcaf86c1da00f1aa1646c6b210e7af4b499edea4d04');
  assert.equal(live.PARAMS.ENTRY_BPS, 50);
  assert.equal(live.PARAMS.R9_BUNDLE_HEADROOM, false);
  assert.deepEqual(findCheatcodeUsage(source.toString()), []);
});

test('live frontmatter enters the stock improve/Haiku contract at the default cadence', () => {
  const policy = loadImproveAgent(dir);
  assert.equal(policy.name, 'xb-r-live');
  assert.ok(policy.description.length > 0);
  assert.equal(policy.reviseEveryBlocks, DEFAULT_REVISE_EVERY_BLOCKS);
  assert.equal(policy.reviseEveryBlocks, 60);
  assert.equal(policy.model, 'claude-cli:haiku');
  assert.deepEqual(resolveLlmProvider(policy.model!), { kind: 'claude-cli', model: 'haiku' });
  const args = buildClaudeCliArgs('haiku', buildRevisionSystem(policy,
    readFileSync(`${dir}/agent.ts`, 'utf8'), ['uniswap', 'balancer', 'curve']), 'synthetic records');
  assert.equal(args[args.indexOf('--model') + 1], 'haiku');
  assert.ok(args.includes('--disallowed-tools'));
});

test('live OFF and ON validate as stock rosters and differ only at the candidate frozen flag', () => {
  const off = loadAgents('ascon-notes/league/roster-xb-r-live-off.yaml');
  const on = loadAgents('ascon-notes/league/roster-xb-r-live-on.yaml');
  assert.deepEqual(on.map(a => a.id), ['noop', 'multi-arb', 'clean-arb', 'cand']);
  for (const a of on) {
    assert.equal(a.wallet, 'AUTO');
    assert.equal(a.command, undefined);
    assert.equal(a.env?.ERIS_AGENT_FROZEN, a.id === 'cand' ? '0' : '1');
  }
  assert.equal(on[3].dir, 'xb-r-live');
  assert.equal(off[3].env?.ERIS_AGENT_FROZEN, '1');
  on[3].env!.ERIS_AGENT_FROZEN = '1';
  assert.deepEqual(on, off);
});

function reconstructedBids(frame: any) {
  const bids = new Map<string, bigint>();
  const transactions = frame.transactions.map((tx: any) => {
    const target = tx.method === 'exactInputSingle' ? UNISWAP.swapRouter
      : tx.method === 'swap' ? BALANCER.vault
      : tx.method === 'exchange' && tx.receiptBase ? MARKET_LEGS.curve[tx.receiptBase]?.pool : undefined;
    if (target && BigInt(tx.priorityFeeWei) > (bids.get(target.toLowerCase()) ?? 0n))
      bids.set(target.toLowerCase(), BigInt(tx.priorityFeeWei));
    return { from: tx.from, to: target ?? null, maxPriorityFeePerGas: BigInt(tx.priorityFeeWei) };
  });
  return { bids, transactions };
}

for (const f of fixture.frames) test(`live v3 reconstructed golden: ${f.name}`, () => {
  assert.equal(fixture.goldenCommit, commit);
  const { bids } = reconstructedBids(f);
  const cooling = new Set<string>(f.cooling);
  if (f.settledFrame && live.settledSingle(f.settledFrame.observation, f.settledFrame.action, f.observation))
    cooling.delete(f.settledFrame.action.base);
  const action = live.selectCandidate(f.observation,
    live.enumerateCandidates(f.observation, live.PARAMS, cooling), live.PARAMS, bids);
  assert.deepEqual(action, f.expectedV3);
  safeAction(f.observation, action);
});

test('live block-pinned reads, repeats, cooldown and epoch resets match the historical v3 profile', async () => {
  const candidate = live.createLiveAgent(live.PARAMS, () => 0);
  const control = historical.createLiveAgent(historical.V3_PARAMS, () => 0);
  const sequence = fixture.frames.map((f: any, i: number) => ({ f, observation: {
    ...structuredClone(f.observation), runId: 'continuous-v3', round: 100 + i,
    blockNumber: String(100 + i), blocksRemaining: 260 - i,
  } as AgentObservation }));
  const first = sequence[0];
  for (const { f, observation } of [...sequence, sequence.at(-1)!, first,
    { f: first.f, observation: { ...first.observation, runId: 'next-epoch' } },
    { f: first.f, observation: { ...first.observation, runId: 'end', blocksRemaining: 0 } }]) {
    const { transactions } = reconstructedBids(f);
    const ctx = { publicClient: { getBlock: async (opts: any) => {
      assert.equal(opts.blockNumber, BigInt(observation.blockNumber));
      assert.equal(opts.includeTransactions, true);
      return { number: BigInt(observation.blockNumber), transactions };
    } } } as unknown as AgentContext;
    assert.deepEqual(await candidate(observation, ctx), await control(observation, ctx));
  }
});

test('live v3 fails closed for gas exhaustion, zero priority and stale unfunded candidates', () => {
  const good = single(.02), candidates = live.enumerateCandidates(good);
  assert.notEqual(live.createAgent(live.PARAMS, () => 0)(good).type, 'noop');
  for (const kind of ['gas', 'priority', 'funding']) {
    const o = structuredClone(good);
    if (kind === 'gas') o.balances.ethWei = '0';
    if (kind === 'priority') o.limits.maxPriorityFeePerGasWei = '0';
    if (kind === 'funding') {
      o.balances.usdcUnits = '0'; o.balances.wethWei = '0'; o.baseBalances = { WBTC: '0' };
    }
    assert.equal(live.selectCandidate(o, candidates).type, 'noop', kind);
  }
});

test('stock revision replies accept body/decline/revert, but reject a full TS module and ambiguity', async () => {
  for (const response of [
    { notes: 'hold', executorTs: null }, { notes: 'restore v3', revertTo: 0 },
    { notes: 'synthetic transport only', executorTs: 'return {type:"noop",reason:"fixture"};' },
  ]) assert.equal(parseRevision(response).ok, true);
  assert.equal(parseRevision({ notes: 'ambiguous', executorTs: 'return null;', revertTo: 0 }).ok, false);
  assert.equal(compileExecutor(readFileSync(`${dir}/agent.ts`, 'utf8')).ok, false);
  const compiled = compileExecutor('return {type:"noop",reason:"fixture"};');
  assert.ok(compiled.ok);
  assert.deepEqual(await compiled.executor(single(), {} as AgentContext), { type: 'noop', reason: 'fixture' });
});

function promptFormatBody(): string {
  const policy = readFileSync(`${dir}/prompt.md`, 'utf8');
  const match = policy.match(/<!-- executorTs-format-example:start -->\s*```js\n([\s\S]*?)\n```\s*<!-- executorTs-format-example:end -->/);
  assert.ok(match, 'prompt v2 carries a complete, locally executable format example');
  return match[1];
}

test('prompt v2 body executes in the stock VM with only obs/ctx and retains state across calls', async () => {
  const source = promptFormatBody();
  const parsed = parseRevision(JSON.parse(JSON.stringify({ notes: 'offline format test only', executorTs: source })));
  assert.ok(parsed.ok);
  const compiled = compileExecutor(source);
  assert.ok(compiled.ok);
  const logs: unknown[] = [];
  const ctx = { log: (record: unknown) => logs.push(record) } as unknown as AgentContext;
  const obs = single();
  const first = await compiled.executor(obs, ctx);
  assert.deepEqual(first, { type: 'noop', reason: 'format example only; not an installable strategy' });
  safeAction(obs, first as any);
  assert.deepEqual(await compiled.executor(obs, ctx), { type: 'noop', reason: 'duplicate observation' });
  assert.equal(logs.length, 1);
  await compiled.executor({ ...obs, runId: 'new-run' }, ctx);
  assert.equal(logs.length, 2);
  await compiled.executor({ ...obs, runId: 'new-run', blockNumber: '99' }, ctx);
  assert.equal(logs.length, 3);
});

test('prompt funding helpers preserve v3 WBTC normalization, real balances and dust boundaries', async () => {
  // Probe the exact helper text taught to the model, without any network, LLM or installation.
  const source = promptFormatBody().split('const revisionLabel =')[0];
  const compiled = compileExecutor(`${source}\nreturn {
    weth: funded(obs, "WETH", 1n),
    wbtc: funded(obs, "WBTC", 1n),
    overdraw: funded(obs, "WBTC", balanceOf(obs, "WBTC") + 1n),
    zero: funded(obs, "WBTC", 0n),
    cash: funded(obs, "USDC", 1000000n)
  };`);
  assert.ok(compiled.ok);
  for (const raw of ['0', '99999', '100000', '40000000']) {
    const obs = single();
    obs.baseBalances = { WBTC: raw };
    assert.deepEqual(await compiled.executor(obs, {} as AgentContext), {
      weth: true, wbtc: BigInt(raw) >= 100000n, overdraw: false, zero: false, cash: true,
    });
  }
});

test('block-1465 failure is syntax rejection; missing globals instead fail only on execution', async () => {
  const parsed = parseRevision({ notes: 'offline rejection reproduction',
    executorTs: 'import type { AgentContext, AgentObservation } from "@eris/sdk";' });
  assert.ok(parsed.ok);
  assert.deepEqual(compileExecutor(parsed.revision.executorTs!), {
    ok: false, reason: 'compile failed: Cannot use import statement outside a module',
  });
  const compiled = compileExecutor('return performance.now();');
  assert.ok(compiled.ok);
  await assert.rejects(async () => compiled.executor(single(), {} as AgentContext), /performance is not defined/);
});

test('timing helper logs only start metadata and execs the mock CLI in the same PID', () => {
  const temp = mkdtempSync(join(tmpdir(), 'xb-r-live-timing-'));
  try {
    const bin = join(temp, 'bin'), run = join(temp, 'run'); mkdirSync(bin);
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\nprintf \'{"notes":"mock","executorTs":null,"pid":%s}\\n\' "$$"\n', { mode: 0o755 });
    const env = { PATH: `${bin}:${process.env.PATH}`, ERIS_RUN_DIR: run, ERIS_AGENT_ID: 'cand' };
    const wrapper = resolve('ascon-notes/league/xb-r-live-claude-timed.sh');
    const result = spawnSync(wrapper, ['-p', 'DO_NOT_RECORD_THIS_PROMPT', '--model', 'haiku'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const raw = readFileSync(join(run, 'agents/cand.cli-timing.jsonl'), 'utf8');
    assert.equal(raw.includes('DO_NOT_RECORD'), false);
    const start = JSON.parse(raw), reply = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(start).sort(), ['agentId', 'kind', 'pid', 'ts']);
    assert.equal(start.pid, reply.pid);
    assert.equal(start.kind, 'cli_call_started');
    assert.ok(Number.isFinite(Date.parse(start.ts)));
    const invalid = spawnSync(wrapper, [], { env: { PATH: env.PATH }, encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
    assert.equal(invalid.stdout, '');
    assert.match(invalid.stderr, /refusing unmeasured call/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

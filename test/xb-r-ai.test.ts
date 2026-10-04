import { observation, single, bundle, safeAction, W } from './xb-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { AgentObservation, AgentContext } from '@eris/sdk';
import { BALANCER, MARKET_LEGS, UNISWAP } from '@eris/sdk/constants.js';
import * as v5 from '../example/agents/xb-r/agent.js';
import * as pinned from '../example/agents/xb-r-ai/v5.js';
import { createPilot } from '../example/agents/xb-r-ai/engine.js';
import { createPolicyGate, literalTemplate, parsePolicyReply, policyParams, POLICY_IDS,
  validSelection, type PolicyId } from '../example/agents/xb-r-ai/policy.js';
import { compileExecutor, loadImproveAgent, parseRevision } from '../example/agents/runtime/improve.js';
import { resolveLlmProvider, buildClaudeCliArgs, buildCodexCliArgs } from '../example/agents/runtime/llm.js';

const baseline = { policyId: 'v5', ENTRY_BPS: 50, appliedAtBlock: null };
const obs = (block: number, runId = 'h1') => ({ ...observation(block), runId, blocksRemaining: 2000 - block });
const reply = (policyId: PolicyId = 'v5-r11', ENTRY_BPS = 45) =>
  JSON.stringify({ notes: 'completed evidence', executorTs: literalTemplate({ policyId, ENTRY_BPS }) });
const ready = () => { const g = createPolicyGate(); g.observe(obs(0)); g.observe(obs(60)); return g; };
function install(g: ReturnType<typeof createPolicyGate>, raw = reply()) {
  const ticket = g.request(); assert.ok(ticket); return g.accept(ticket, raw);
}

test('H1 pinned v5 changes only the parameter seam, no safety or execution logic', () => {
  const original = readFileSync('example/agents/xb-r/agent.ts', 'utf8');
  assert.equal(createHash('sha256').update(original).digest('hex'),
    'a4ab7664cf87155ad193cc79ae038ecf4d2e6289d71179b3bc356b52c4a36b54');
  const expected = original
    .replace('export function createAgent(params: Params = PARAMS, now: () => number = () => performance.now()) {',
      'export function createAgent(params: Params = PARAMS, now: () => number = () => performance.now(),\n  resolvePolicy?: () => Params) {')
    .replace('  const p = Object.freeze({ ...params });\n  validateParams(p);',
      '  const initialParams = Object.freeze({ ...params });\n  validateParams(initialParams);')
    .replace('      const started = execution?.started ?? now(), block = Number(obs.blockNumber), left = remaining(obs);',
      '      const p = resolvePolicy ? Object.freeze({ ...resolvePolicy() }) : initialParams;\n      validateParams(p);\n      const started = execution?.started ?? now(), block = Number(obs.blockNumber), left = remaining(obs);')
    .replace('export function createLiveAgent(params: Params = PARAMS, now: () => number = () => performance.now()) {\n  const p = Object.freeze({ ...params }), core = createAgent(p, now);',
      'export function createLiveAgent(params: Params = PARAMS, now: () => number = () => performance.now(),\n  resolvePolicy?: () => Params) {\n  const p = Object.freeze({ ...params }), core = createAgent(p, now, resolvePolicy);');
  assert.equal(readFileSync('example/agents/xb-r-ai/v5.ts', 'utf8'), expected);
});

for (const id of POLICY_IDS) test(`H1 policy ${id} preserves every forbidden parameter`, () => {
  const expected = { ...v5.PARAMS, ENTRY_BPS: 45 };
  if (id === 'v5-r11') expected.R11_SMALL_SINGLE_CAP = true;
  if (id === 'v5-r7-strict') { expected.R7_SINGLE_ENTRY = false; expected.SINGLE_EDGE_BPS = 75; }
  assert.deepEqual(policyParams({ policyId: id, ENTRY_BPS: 45 }), expected);
  const g = ready(); assert.equal(install(g, reply(id)).kind, 'installed');
  assert.deepEqual(g.params(), expected);
  assert.equal(Object.isFrozen(g.params()), true);
});

test('H1 ENTRY range and step reject every invalid representation', () => {
  for (const n of [-1, 0, 15, 19, 21, 44, 46, 59, 61, 65, 45.5, NaN, Infinity, '45', null]) {
    assert.equal(validSelection({ policyId: 'v5', ENTRY_BPS: n }), false, String(n));
    assert.throws(() => policyParams({ policyId: 'v5', ENTRY_BPS: n } as any));
    const body = `return {"policyId":"v5","ENTRY_BPS":${JSON.stringify(n)}};`;
    assert.equal(parsePolicyReply(JSON.stringify({ notes: 'n', executorTs: body })).kind, 'rejected');
  }
  for (let n = 20; n <= 60; n += 5) {
    assert.equal(validSelection({ policyId: 'v5', ENTRY_BPS: n }), true);
    assert.equal(parsePolicyReply(reply('v5', n)).kind, 'selection');
  }
});

test('H1 ENTRY delta is at most five in either direction and resets invalid current replies', () => {
  for (const n of [20, 40, 60]) {
    const g = ready(); assert.equal(install(g, reply('v5', n)).kind, 'rejected');
    assert.deepEqual(g.snapshot(), baseline);
  }
  for (const direction of [-5, 5]) {
    const g = ready(); let block = 60;
    for (let n = 50 + direction; n >= 20 && n <= 60; n += direction) {
      g.observe(obs(block)); assert.equal(install(g, reply('v5-r11', n)).kind, 'installed');
      assert.equal(g.snapshot().ENTRY_BPS, n); block += 60;
    }
  }
});

test('H1 baseline initial, sixty block cadence, single flight, and one-use ticket', () => {
  const g = createPolicyGate(); assert.deepEqual(g.snapshot(), baseline);
  assert.equal(g.request(), null); g.observe(obs(0)); assert.equal(g.request(), null);
  g.observe(obs(59)); assert.equal(g.request(), null); g.observe(obs(60));
  const ticket = g.request(); assert.ok(ticket); assert.equal(g.request(), null);
  assert.equal(g.accept({ ...ticket }, reply()).kind, 'ignored');
  assert.equal(g.accept(ticket, reply()).kind, 'installed');
  assert.equal(g.accept(ticket, reply('v5', 40)).kind, 'ignored');
  g.observe(obs(119)); assert.equal(g.request(), null);
  g.observe(obs(120)); assert.ok(g.request());
});

test('H1 TTL uses actual apply block, expiry at 120, decline does not renew', () => {
  const g = ready(), ticket = g.request()!;
  g.observe(obs(75)); assert.equal(g.accept(ticket, reply()).kind, 'installed');
  assert.equal(g.snapshot().appliedAtBlock, 75);
  g.observe(obs(135)); assert.equal(install(g, '{"notes":"hold","executorTs":null}').kind, 'declined');
  g.observe(obs(194)); assert.equal(g.snapshot().policyId, 'v5-r11');
  g.observe(obs(195)); assert.deepEqual(g.snapshot(), baseline);
});

test('H1 valid same selection renews lease; frozen never requests or accepts', () => {
  const g = ready(); install(g); g.observe(obs(120)); install(g);
  g.observe(obs(239)); assert.equal(g.snapshot().policyId, 'v5-r11');
  g.observe(obs(240)); assert.deepEqual(g.snapshot(), baseline);
  const f = createPolicyGate(true); f.observe(obs(0)); f.observe(obs(60));
  assert.equal(f.request(), null);
  assert.equal(f.accept({ runId: 'h1', observedAtBlock: 60, generation: 1 }, reply()).kind, 'ignored');
  assert.deepEqual(f.snapshot(), baseline);
});

test('H1 proposal expiry accepts age 60 and rejects age 61; old response cannot overwrite', () => {
  for (const age of [60, 61]) {
    const g = ready(), ticket = g.request()!; g.observe(obs(60 + age));
    assert.equal(g.accept(ticket, reply()).kind, age === 60 ? 'installed' : 'ignored');
  }
  const g = ready(), old = g.request()!;
  g.observe(obs(121)); const next = g.request()!; assert.ok(next);
  assert.equal(g.accept(next, reply()).kind, 'installed');
  assert.equal(g.accept(old, reply('v5', 50)).kind, 'ignored');
  assert.equal(g.snapshot().policyId, 'v5-r11');
});

for (const reset of ['run', 'rewind', 'horizon']) test(`H1 epoch reset ${reset} invalidates old tickets`, () => {
  const g = ready(); install(g); g.observe(obs(120)); const ticket = g.request()!;
  const next = reset === 'run' ? obs(121, 'new') : reset === 'rewind' ? { ...obs(1), blocksRemaining: 1880 } : { ...obs(121), blocksRemaining: 3000 };
  g.observe(next); assert.deepEqual(g.snapshot(), baseline);
  assert.equal(g.accept(ticket, reply()).kind, 'ignored');
  assert.equal(g.request(), null);
});

test('H1 day epoch reset uses the same minimum horizon as v5', () => {
  const g = createPolicyGate(); g.observe({ ...obs(0), dayBlocksRemaining: 121 });
  g.observe({ ...obs(60), dayBlocksRemaining: 61 }); install(g);
  g.observe({ ...obs(120), dayBlocksRemaining: 1 }); const ticket = g.request()!; assert.ok(ticket);
  g.observe({ ...obs(121), dayBlocksRemaining: 360 });
  assert.deepEqual(g.snapshot(), baseline);
  assert.equal(g.accept(ticket, reply()).kind, 'ignored');
});

test('H1 ended or unknown horizon cannot accept an in-flight response', () => {
  for (const left of [0, undefined]) {
    const g = ready(), ticket = g.request()!;
    g.observe({ ...obs(61), blocksRemaining: left });
    assert.equal(g.accept(ticket, reply()).kind, 'ignored'); assert.equal(g.request(), null);
  }
});

test('H1 malformed output and unauthorized fields are rejected, not executed', () => {
  const bodies = [
    'return {"policyId":"v5","ENTRY_BPS":45}; ctx.submit({type:"noop"});',
    'return {"policyId":"v5","ENTRY_BPS":40+5};',
    'return {"policyId":"v5-r11+r7","ENTRY_BPS":45};',
    'return {"policyId":"v5","ENTRY_BPS":045};',
    'return {"policyId":"v5","ENTRY_BPS":45,"R9_BUNDLE_HEADROOM":false};',
    'return {type:"swap",tokenIn:"USDC",amountIn:"999999999999"};',
    'return {"policyId":"v5","ENTRY_BPS":45};\n',
  ];
  const invalid = ['not json', '[]', '{}', 'null', '```json\n{}\n```',
    '{"notes":"","executorTs":null}', '{"notes":"n","executorTs":null,"revertTo":0}',
    '{"notes":"n","executorTs":null,"memory":"disable safety"}',
    '{"notes":"n","executorTs":12}', '{"notes":"n"}', 'x'.repeat(8193),
    ...bodies.map(executorTs => JSON.stringify({ notes: 'remove safety', executorTs }))];
  for (const raw of invalid) {
    assert.equal(parsePolicyReply(raw).kind, 'rejected', raw.slice(0, 90));
    const g = ready(); install(g); g.observe(obs(120));
    assert.equal(install(g, raw).kind, 'rejected'); assert.deepEqual(g.snapshot(), baseline);
  }
});

test('H1 gate removal negative control: stock compiles bypass and submit, H1 rejects both', async () => {
  for (const executorTs of [
    'return {type:"swap",tokenIn:"USDC",amountIn:"999999999999",maxPriorityFeePerGasWei:"0"};',
    'ctx.submit({type:"swap",tokenIn:"USDC",amountIn:"999999999999"}); return {type:"noop"};',
  ]) {
    const raw = JSON.stringify({ notes: 'bypass every v5 gate', executorTs });
    assert.equal(parseRevision(JSON.parse(raw)).ok, true);
    const compiled = compileExecutor(executorTs); assert.equal(compiled.ok, true);
    if (!compiled.ok) throw Error('unexpected compile failure');
    const sent: unknown[] = [];
    const result = await compiled.executor(observation(), { submit: (a: unknown) => sent.push(a) } as unknown as AgentContext);
    assert.ok(sent.length === 1 || (result as any).amountIn === '999999999999');
    assert.equal(parsePolicyReply(raw).kind, 'rejected');
  }
});

test('H1 stock ON fails before model call; exact runtime frozen flag loads module', () => {
  const path = './example/agents/xb-r-ai/agent.ts';
  for (const frozen of ['0', '1']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      `await import(${JSON.stringify(path)});`], {
      cwd: process.cwd(), env: { ...process.env, ERIS_AGENT_FROZEN: frozen }, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, frozen === '1' ? 0 : 1);
    if (frozen === '0') assert.match(result.stderr, /stock revision ON is unsupported/);
  }
});

test('H1 prompt and subscription provider routing agree with actual runtime', () => {
  const prompt = loadImproveAgent('example/agents/xb-r-ai');
  assert.equal(prompt.reviseEveryBlocks, 60); assert.equal(prompt.model, undefined);
  assert.match(prompt.body, /NEVER executes/);
  assert.deepEqual(resolveLlmProvider('claude-cli:haiku'), { kind: 'claude-cli', model: 'haiku' });
  assert.deepEqual(resolveLlmProvider('codex:chosen-small-model'), { kind: 'codex', model: 'chosen-small-model' });
  const args = buildClaudeCliArgs('haiku', 's', 'p');
  assert.equal(args[args.indexOf('--model') + 1], 'haiku');
  assert.equal(buildCodexCliArgs('chosen-small-model', 'p').at(-1), 'chosen-small-model');
});

test('H1 R11 tightens single size and preserves bundle; R7 strict removes low edge entry', () => {
  const o = single(.05); o.balances.wethWei = String(72n * W / 10n);
  const normal = pinned.createAgent(policyParams({ policyId: 'v5', ENTRY_BPS: 50 }), () => 0)(o);
  const reduced = pinned.createAgent(policyParams({ policyId: 'v5-r11', ENTRY_BPS: 50 }), () => 0)(o);
  assert.equal(normal.type, 'swap'); assert.equal(reduced.type, 'swap');
  assert.ok(BigInt(reduced.amountIn) < BigInt(normal.amountIn)); safeAction(o, reduced);
  const b = bundle();
  assert.deepEqual(pinned.createAgent(policyParams({ policyId: 'v5-r11', ENTRY_BPS: 50 }), () => 0)(b),
    v5.createAgent(v5.PARAMS, () => 0)(b));
  const low = single(.006);
  assert.equal(v5.createAgent(v5.PARAMS, () => 0)(low).type, 'swap');
  assert.equal(pinned.createAgent(policyParams({ policyId: 'v5-r7-strict', ENTRY_BPS: 50 }), () => 0)(low).type, 'noop');
});

test('H1 update, rejection and expiry preserve cooldown and duplicate state', () => {
  for (const mode of ['update', 'reject', 'expire']) {
    const p = createPilot({ now: () => 0 }); p.gate.observe(obs(0)); p.gate.observe(obs(60)); install(p.gate);
    const block = mode === 'expire' ? 179 : 119;
    const before = { ...single(.05, true, block), blocksRemaining: 2000 - block, runId: 'h1' };
    assert.equal(p.decide(before).type, 'swap');
    p.gate.observe(obs(block + 1));
    if (mode !== 'expire') install(p.gate, mode === 'reject' ? '{}' : reply('v5-r7-strict', 50));
    const next = { ...before, blockNumber: String(block + 1), blocksRemaining: 1999 - block };
    assert.equal(p.decide(next).type, 'noop', `${mode}: cannot erase cooldown by changing policy`);
    assert.equal(p.decide(next).reason, 'duplicate observation');
  }
});

test('H1 update preserves pending R8 settlement confirmation', () => {
  const p = createPilot({ now: () => 0 }); p.gate.observe(obs(0)); p.gate.observe(obs(60)); install(p.gate);
  const before = { ...single(.05, true, 119), runId: 'h1', blocksRemaining: 1881 };
  const action = p.decide(before); assert.equal(action.type, 'swap');
  const after = structuredClone(before); after.blockNumber = '120'; after.blocksRemaining--;
  after.balances.ethWei = String(BigInt(before.balances.ethWei) - 100000000000000n);
  after.balances.usdcUnits = String(BigInt(before.balances.usdcUnits) - BigInt(action.amountIn));
  after.balances.wethWei = String(BigInt(before.balances.wethWei) + 1n);
  assert.equal(v5.settledSingle(before, action, after), true);
  p.gate.observe(after); install(p.gate, reply('v5-r7-strict', 50));
  assert.equal(p.decide(after).type, 'swap', 'confirmed receipt releases cooldown across policy change');
});

test('H1 all policies and entries preserve funding, inventory, gas and nonzero priority guards', () => {
  for (const id of POLICY_IDS) for (let n = 20; n <= 60; n += 5) {
    const params = policyParams({ policyId: id, ENTRY_BPS: n });
    for (const o of [single(.05), single(.05, false), bundle()]) {
      safeAction(o, pinned.createAgent(params, () => 0)(o));
      const candidates = pinned.enumerateCandidates(o, params);
      for (const guard of ['gas', 'priority', 'funding']) {
        const bad = structuredClone(o);
        if (guard === 'gas') bad.balances.ethWei = String(W / 20n);
        if (guard === 'priority') bad.limits.maxPriorityFeePerGasWei = '0';
        if (guard === 'funding') { bad.balances.usdcUnits = '0'; bad.balances.wethWei = '0'; bad.baseBalances = { WBTC: '0' }; }
        assert.equal(pinned.createAgent(params, () => 0)(bad).type, 'noop', `${id}/${n}/${guard}`);
        assert.equal(pinned.selectCandidate(bad, candidates, params).type, 'noop', `${id}/${n}/stale-${guard}`);
      }
    }
  }
});

const fixture = JSON.parse(readFileSync('test/fixtures/xb-r-dev4-v5.json', 'utf8'));
for (const f of fixture.frames) test(`H1 frozen reconstructed ${f.name} matches v5 golden and live frame`, async () => {
  const bids = new Map<string, bigint>();
  const transactions = f.transactions.map((tx: any) => {
    const target = tx.method === 'exactInputSingle' ? UNISWAP.swapRouter : tx.method === 'swap' ? BALANCER.vault
      : tx.method === 'exchange' && tx.receiptBase ? MARKET_LEGS.curve[tx.receiptBase]?.pool : undefined;
    if (target) bids.set(target.toLowerCase(), BigInt(tx.priorityFeeWei) > (bids.get(target.toLowerCase()) ?? 0n)
      ? BigInt(tx.priorityFeeWei) : bids.get(target.toLowerCase())!);
    return { from: tx.from, to: target, maxPriorityFeePerGas: BigInt(tx.priorityFeeWei) };
  });
  const p = policyParams({ policyId: 'v5', ENTRY_BPS: 50 });
  const reconstructed = pinned.selectCandidate(f.observation, pinned.enumerateCandidates(f.observation, p, new Set(f.cooling)), p, bids);
  assert.deepEqual(reconstructed, f.expectedProbes.R9); safeAction(f.observation, reconstructed);
  const ctx = { publicClient: { getBlock: async () => ({ number: BigInt(f.observation.blockNumber), transactions }) } } as unknown as AgentContext;
  const pilot = createPilot({ frozen: true, now: () => 0 }), base = v5.createLiveAgent(v5.PARAMS, () => 0);
  for (const o of [f.observation, f.observation, { ...f.observation, blockNumber: String(Number(f.observation.blockNumber) + 1) }]) {
    assert.deepEqual(await pilot.decideLive(o, ctx), await base(o, ctx));
  }
});

test('H1 frozen continuous reconstructed frames and epoch resets match v5', () => {
  const p = createPilot({ frozen: true, now: () => 0 }), base = v5.createAgent(v5.PARAMS, () => 0);
  const frames: AgentObservation[] = fixture.frames.map((f: any, i: number) => ({
    ...structuredClone(f.observation), runId: 'sequence', blockNumber: String(100 + i), blocksRemaining: 260 - i,
  }));
  for (const o of [...frames, frames[0], { ...frames[1], runId: 'new' }]) assert.deepEqual(p.decide(o), base(o));
});

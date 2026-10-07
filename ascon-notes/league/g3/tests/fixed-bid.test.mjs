import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import YAML from 'yaml';
import {decide} from '../../../../example/agents/fixed-bid-5gwei/agent.ts';
import {decide as reference} from '../../../../example/agents/venue-arb/agent.ts';

function observation(prices = [1900, 2000, 2100]) {
  return {fairPriceUsdcPerWeth: 2000,
    balances: {usdcUnits: '100000000', wethWei: '1000000000000000000', ethWei: '100000000000000000'},
    limits: {defaultPriorityFeePerGasWei: '100000000', maxPriorityFeePerGasWei: '5000000000'},
    protocols: {uniswap: {pool: {priceUsdcPerWeth: prices[0]}}, balancer: {priceUsdcPerWeth: prices[1]}, curve: {priceUsdcPerWeth: prices[2]}}};
}
test('normal trades on each venue equal venue-arb except the fixed 5 gwei fee', () => {
  for (const prices of [[1900,2000,2000], [2000,1900,2000], [2000,2000,1900], [2100,2000,2000]]) {
    const obs = observation(prices), before = structuredClone(obs);
    assert.deepEqual(decide(obs), {...reference(obs), maxPriorityFeePerGasWei: '5000000000'});
    assert.deepEqual(decide(obs), decide(obs)); assert.deepEqual(obs, before);
    obs.limits.defaultPriorityFeePerGasWei = '9000000000';
    assert.equal(decide(obs).maxPriorityFeePerGasWei, '5000000000');
  }
});
test('cap positive control: refuse below 5 gwei, pass exactly at cap', () => {
  const obs = observation(); obs.limits.maxPriorityFeePerGasWei = '4999999999';
  assert.equal(decide(obs).type, 'noop');
  assert.match(decide(obs).reason, /cap below fixed/);
  obs.limits.maxPriorityFeePerGasWei = '5000000000'; assert.notEqual(decide(obs).type, 'noop');
});
test('funding and dust guards, no gap, and inventory-acquisition path', () => {
  const obs = observation([2100,2200,2300]); obs.balances.wethWei = '0';
  assert.equal(decide(obs).tokenIn, 'USDC');
  assert.deepEqual(decide(obs), {...reference(obs), maxPriorityFeePerGasWei: '5000000000'});
  obs.balances.usdcUnits = '0'; assert.equal(decide(obs).type, 'noop');
  obs.balances.usdcUnits = '1000000'; assert.equal(decide(obs).type, 'noop');
  assert.equal(decide(observation([2000,2000,2000])).type, 'noop');
});
test('both paired mix rosters use this exact directory with revisions frozen', () => {
  for (const mode of ['on','off']) {
    const roster = YAML.parse(readFileSync(new URL(`../mix-${mode}.yaml`, import.meta.url), 'utf8'));
    const opponent = roster.agents.find(a => a.id === 'fixed-bid-5gwei');
    assert.equal(opponent.dir ?? opponent.id, 'fixed-bid-5gwei');
    assert.equal(opponent.env.ERIS_AGENT_FROZEN, '1');
  }
});

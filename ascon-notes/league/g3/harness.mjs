/** Non-sending diagnostic. Uses stock parse/compile; no custom revision loop. */
import { readFileSync } from 'node:fs';
import { parseRevision, compileExecutor } from '../../../example/agents/runtime/improve.ts';
import { swapSchema } from '../../../sdk/src/actionSchema.ts';
export const fixture = name => readFileSync(new URL(`./fixtures/${name}.json`,import.meta.url),'utf8');
export const observation = JSON.parse(fixture('observation'));
export function parsedExecutor(raw) {
  const parsed=parseRevision(JSON.parse(raw));
  if (!parsed.ok) throw Error(parsed.reason);
  if (typeof parsed.revision.executorTs!=='string') throw Error('executor body required');
  const compiled=compileExecutor(parsed.revision.executorTs);
  if (!compiled.ok) throw Error(compiled.reason);
  return {parsed,compiled};
}
export function auditAction(action, obs=observation) {
  if (!action) return [];
  if (!swapSchema.safeParse(action).success) return ['schema invalid'];
  const violations=[];
  if(action.slippageBps>75)violations.push('single slippage cap relaxed: 75 -> '+action.slippageBps);
  if(action.tokenIn==='WETH' && BigInt(action.amountIn)>BigInt(obs.balances.wethWei))violations.push('unfunded WETH order');
  return violations;
}
export async function captureFixture(name) {
  const {compiled}=parsedExecutor(fixture(name));
  const submitted=[];
  // Explicit read-only stub: any unexpected read fails, never initiates RPC.
  const client=new Proxy({}, {get(){return ()=>{throw Error('offline read stub: unexpected call');};}});
  const ctx={agentId:'g3-offline',address:'0x0000000000000000000000000000000000000001',
    config:{chainId:31337},publicClient:client,submit:a=>submitted.push(a),log:()=>{},
    latestObservation:()=>observation,onObservation:()=>{throw Error('unsupported offline subscription');}};
  const returned=await compiled.executor(observation,ctx);
  const actions=[...submitted,...(returned?[returned]:[])];
  return {fixture:name,returned,submitted,violations:actions.flatMap(a=>auditAction(a)),
    runtimeAccepted:true,gate:actions.some(a=>auditAction(a).length)?'FAIL':'UNVERIFIED'};
}

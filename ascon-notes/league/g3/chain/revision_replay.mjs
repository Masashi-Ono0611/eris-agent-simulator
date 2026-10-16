// Non-sending replay. The worker uses stock compileExecutor; the parent owns the 5s deadline.
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
const root = isMainThread ? process.argv[2] : workerData.root;
const url = p => pathToFileURL(`${root}/${p}`).href;
globalThis.fetch = async () => { throw Error('offline network prohibited'); };
if(!isMainThread){
  const requireFromRoot=createRequire(`${root}/package.json`);
  const tsxApi=pathToFileURL(requireFromRoot.resolve('tsx/esm/api')).href;
  const {register}=await import(tsxApi);
  register();
}
const {parseRevision, compileExecutor} = await import(url('example/agents/runtime/improve.ts'));
const {auditAction} = await import(url('ascon-notes/league/g3/harness.mjs'));
const {agentActionSchemaFor} = await import(url('sdk/src/actionSchema.ts'));
const schema = agentActionSchemaFor(['uniswap','balancer','curve','aave','gmx','lst','liquity','lending']);
const forbidden = /^(?:anvil_|evm_|txpool_)|^(?:eth_sendTransaction|eth_sendRawTransaction|eth_subscribe|sendTransaction|sendRawTransaction|writeContract|deployContract)$/;
const swaps = new Set(['swap','balancerSwap','curveSwap','stableSwap','lstSwap','liquitySwapEusd']);
function audit(actions, obs, safety) {
  const failures=[], blocked=[], spent=new Map();
  const balance = token => {
    const raw = token==='WETH'?obs.balances?.wethWei:token==='USDC'?obs.balances?.usdcUnits:
      token==='EUSD'?obs.protocols?.liquity?.eusdBalanceWei:
      obs.baseBalances?.[token] ?? obs.balances?.bases?.[token] ?? obs.balances?.stables?.[token]?.balance;
    if(typeof raw!=='string'||!/^\d+$/.test(raw)){blocked.push(`balance missing: ${token}`);return null;}
    const reserved=safety?.pendingReservations?.[token];
    if(typeof reserved!=='string'||!/^\d+$/.test(reserved)){blocked.push(`pending reservation missing: ${token}`);return null;}
    return BigInt(raw)-BigInt(reserved);
  };
  function leaf(a, bundled=false) {
    if(a===null || a===undefined)return;
    if(!schema.safeParse(a).success){failures.push('invalid action schema');return;}
    if(a.type==='noop')return;
    if(a.maxPriorityFeePerGasWei!==undefined){
      const max=obs.limits?.maxPriorityFeePerGasWei;
      if(max===undefined)blocked.push('fee limit missing');
      else if(BigInt(a.maxPriorityFeePerGasWei)>BigInt(max))failures.push('priority fee cap exceeded');
    }
    if(a.type==='bundle'){for(const x of a.actions)leaf(x,true);return;}
    if(!swaps.has(a.type)){
      // Launch/rawTx/Liquity position operations need calldata/allowance/receipt semantics.
      blocked.push(`unsupported economic envelope: ${a.type}`);return;
    }
    const protocol={swap:'uniswap',balancerSwap:'balancer',curveSwap:'curve',stableSwap:'curve',lstSwap:'lst',liquitySwapEusd:'liquity'}[a.type];
    if(!Array.isArray(obs.enabledProtocols))blocked.push('enabled protocols missing');
    else if(!obs.enabledProtocols.includes(protocol))failures.push('disabled venue action');
    const cap=bundled?120:a.type==='liquitySwapEusd'?100:75;
    if(!Number.isInteger(a.slippageBps))blocked.push('explicit slippage missing');
    else if(a.slippageBps>cap)failures.push(`slippage cap relaxed: ${cap} -> ${a.slippageBps}`);
    // Run the repository auditAction on every supported swap leaf. It only knows swap/75/WETH;
    // structural validation above uses the real action, and the additional cap above handles 120.
    const normalized={...a,type:'swap',slippageBps:Math.min(a.slippageBps??0,75)};
    if(obs.balances?.wethWei===undefined && a.tokenIn==='WETH')blocked.push('WETH balance missing');
    else failures.push(...auditAction(normalized,obs));
    const held=balance(a.tokenIn), amount=BigInt(a.amountIn);
    spent.set(a.tokenIn,(spent.get(a.tokenIn)??0n)+amount);
    if(held!==null && spent.get(a.tokenIn)>held)failures.push(`funds beyond balance (all return/submit legs): ${a.tokenIn}`);
    const allowance=safety?.allowances?.[a.tokenIn]?.[a.type];
    if(typeof allowance!=='string'||!/^\d+$/.test(allowance))blocked.push('allowance snapshot missing');
    else if(spent.get(a.tokenIn)>BigInt(allowance))failures.push('funds beyond allowance');
  }
  for(const a of actions)leaf(a);
  if(spent.size){
    const vals=[obs.balances?.ethWei,safety?.gasReserveWei,safety?.maxGasCostWei,safety?.pendingGasWei];
    if(vals.some(v=>typeof v!=='string'||!/^\d+$/.test(v)))blocked.push('gas reserve/cost evidence missing');
    else if(BigInt(vals[1])<=0n||BigInt(vals[2])<=0n||BigInt(vals[0])-BigInt(vals[2])-BigInt(vals[3])<BigInt(vals[1]))failures.push('gas reserve exhausted/invalid');
    if(!Array.isArray(safety?.receipts)||safety.receipts.length===0)blocked.push('action receipts missing');
  }
  return {failures:[...new Set(failures)],blocked:[...new Set(blocked)]};
}
if(!isMainThread){
  const compiled=compileExecutor(workerData.source);
  if(!compiled.ok)throw Error('compile rejected');
  parentPort.postMessage({ready:true});
  parentPort.on('message',async ({frame})=>{
    const submitted=[], forbiddenCalls=[], missingReads=[];
    const reads=[...(frame.reads??[])];
    const client=new Proxy({}, {get(_,key){
      if(key==='then')return undefined;
      return (...args)=>{
        const method=key==='request'?args[0]?.method:String(key);
        if(forbidden.test(method)){forbiddenCalls.push(method);throw Error('forbidden method');}
        const record=reads.shift();
        if(!record||record.method!==key||JSON.stringify(record.args)!==JSON.stringify(args)){
          missingReads.push(String(key));throw Error('missing offline read transcript');
        }
        return record.result;
      };
    }});
    const ctx={agentId:'cand',address:frame.observation.agentAddress??'0x0000000000000000000000000000000000000001',
      config:frame.config??{chainId:31337},publicClient:client,submit:a=>submitted.push(a),log:()=>{},
      latestObservation:()=>frame.observation,onObservation:()=>{throw Error('unsupported subscription');}};
    const start=performance.now();let returned=null, error=null;
    try{returned=await compiled.executor(frame.observation,ctx);}catch(e){error=e.name==='DecideTimeoutError'?'decide timeout':'executor exception';}
    parentPort.postMessage({returned,submitted,elapsedMs:performance.now()-start,error,forbiddenCalls,missingReads,unusedReads:reads.length});
  });
}else{
  const input=JSON.parse(readFileSync(0,'utf8')), results=[], parsed=[];
  for(const call of input.calls){
    let p;
    try{p=parseRevision(JSON.parse(call.raw.replace(/^```[^\n]*\n|\n```$/g,'')));}catch{p={ok:false};}
    let compiled=null, source=null;
    if(p.ok && p.revision.executorTs!==null){source=p.revision.executorTs;compiled=compileExecutor(source).ok;}
    const unsafe=[];
    if(source){
      if(/\b(?:anvil_[A-Za-z]+|evm_[A-Za-z]+|txpool_[A-Za-z]+|eth_sendTransaction|eth_sendRawTransaction|eth_subscribe|sendTransaction|sendRawTransaction|writeContract|deployContract)\b/.test(source))unsafe.push('forbidden method in executor source');
      // Stock compile detects cheatcodes; also catch inactive, explicit safety-cap loosening.
      for(const [name,cap] of [['SINGLE_SLIPPAGE_BPS',75],['LEG_SLIPPAGE_BPS',120]]){
        for(const m of source.matchAll(new RegExp(name+'["\\\']?\\s*[:=]\\s*(\\d+)','g')))if(+m[1]>cap)unsafe.push(`${name} relaxed`);
      }
    }
    parsed.push({ok:p.ok,compiled,kind:!p.ok?'invalid':p.revision.revertTo!==null?'revert':source!==null?'executor':'declined',
      revertTo:p.ok?p.revision.revertTo:null,empty:call.raw.trim()===''||(p.ok===false && /"executorTs"\s*:\s*"\s*"/.test(call.raw)),unsafe});
  }
  let worker, key;
  async function dispose(){if(worker)await worker.terminate();worker=null;}
  try{
    for(const frame of input.frames){
      const record={id:frame.id,failures:[],blocked:[]};
      const actions=[...(frame.submitted??[]),frame.returned??null];
      const observed=audit(actions,frame.observation,frame.safety);record.failures.push(...observed.failures);record.blocked.push(...observed.blocked);
      if(frame.source!==undefined){
        if(!compileExecutor(frame.source).ok){record.failures.push('adopted executor rejected by stock compile');results.push(record);continue;}
        const nextKey=String(frame.version)+':'+String(frame.workerGeneration);
        if(!worker||key!==nextKey){
          await dispose(); key=nextKey;
          worker=new Worker(new URL(import.meta.url),{workerData:{root,source:frame.source}});
          await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('worker startup')),60000);worker.once('message',()=>{clearTimeout(timer);resolve();});worker.once('error',()=>{clearTimeout(timer);reject(Error('worker startup'));});});
        }
        const replay=await new Promise(resolve=>{
          const timer=setTimeout(()=>{worker.removeAllListeners('message');resolve({timeout:true});},5000);
          worker.once('message',r=>{clearTimeout(timer);resolve(r);});worker.postMessage({frame});
        });
        record.replay=replay;
        if(replay.timeout){record.failures.push('decide exceeded 5000ms');await dispose();}
        else{
          if(replay.elapsedMs>=5000)record.failures.push('decide exceeded 5000ms');
          if(replay.forbiddenCalls.length)record.failures.push('forbidden method attempted');
          if(replay.missingReads.length||replay.unusedReads)record.blocked.push('offline read transcript incomplete/mismatched');
          if(replay.error&&!replay.missingReads.length&&!replay.forbiddenCalls.length)record.failures.push(replay.error);
          const check=audit([...replay.submitted,replay.returned],frame.observation,frame.safety);
          record.failures.push(...check.failures);record.blocked.push(...check.blocked);
          if(!replay.error && JSON.stringify([replay.submitted,replay.returned])!==JSON.stringify([frame.submitted,frame.returned]))record.failures.push('replay differs from logged actions');
        }
      }
      results.push(record);
    }
  }finally{await dispose();}
  // Never print generated source, prompts, observation contents, addresses or read responses.
  for(const r of results)if(r.replay)r.replay={elapsedMs:r.replay.elapsedMs,timeout:!!r.replay.timeout};
  console.log(JSON.stringify({parsed,results}));
}

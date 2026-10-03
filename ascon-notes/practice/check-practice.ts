import { practiceTransport, rpc } from './transport.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, formatEther, formatUnits, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadPracticeEnv } from './env.js';

type Result = { name: string; status: 'PASS'|'FAIL'|'BLOCKED'; detail: string };
export function resultsExitCode(results: readonly Result[]): number {
  if (results.some(r => r.status === 'FAIL')) return 1;
  if (results.some(r => r.status === 'BLOCKED')) return 2;
  return 0;
}
export function headerStatus(headers: Record<string,string>): Result {
  return Object.keys(headers).length === 3 ? { name:'認証ヘッダ設定',status:'PASS',detail:'3項目あり' } : { name:'ヘッダ付き検査',status:'BLOCKED',detail:'必要な認証ヘッダを設定してください' };
}
const results: Result[] = [];
function add(name:string,status:Result['status'],detail:string){results.push({name,status,detail});}
export async function runChecks() {
  results.length = 0;
  let env;
  try { env=await loadPracticeEnv(); }
  catch(e) { add('設定', 'BLOCKED', e instanceof Error ? e.message : '設定エラー'); print(); return results; }
  const noAuth = await rpc(env.rpcUrl,'eth_chainId').catch(()=>null);
  add('ヘッダ無しで403',noAuth?.status===403?'PASS':noAuth?'FAIL':'BLOCKED',noAuth?`HTTP ${noAuth.status}`:'ネットワーク接続不可');
  const client=createPublicClient({transport:practiceTransport(env.rpcUrl,env.headers)});
  const before=results.length;
  try {
    const chain=await client.getChainId(); add('chainId = 31337',chain===31337?'PASS':'FAIL',`chainId ${chain}`);
    // 2s blocks: a 2.2s window can legitimately read the same block twice (false FAIL seen on 2026-10-03),
    // so wait 8s and require at least 2 new blocks (measured rate on the practice devnet: 0.51 blocks/s).
    const b1=await client.getBlockNumber(); await new Promise(r=>setTimeout(r,8000)); const b2=await client.getBlockNumber();
    add('ブロック進行',b2-b1>=2n?'PASS':'FAIL',`block ${b1} → ${b2} (8s)`);
    const account=privateKeyToAccount(env.privateKey);
    const eth=await client.getBalance({address:account.address}); add('ETH残高',eth>0n?'PASS':'FAIL',`${formatEther(eth)} ETH${eth===0n?' — #faucet に投稿':''}`);
    let manifest:any=null;
    try { manifest=JSON.parse(await readFile(resolve(process.cwd(),'manifest.json'),'utf8')); } catch {}
    const findAddress=(obj:any, key:string): `0x${string}`|undefined => {
      if (!obj || typeof obj!=='object') return;
      for(const [k,v] of Object.entries(obj)) { if(k.toLowerCase()===key && typeof v==='string' && /^0x[0-9a-fA-F]{40}$/.test(v)) return v as `0x${string}`; const found=findAddress(v,key); if(found)return found; }
    };
    for(const token of ['weth','usdc']) {
      // The manifest publishes token addresses under tokens.<SYMBOL>.address (verified against the live manifest);
      // the contracts-table search stays as a fallback for older manifest shapes.
      const listed=manifest?.tokens?.[token.toUpperCase()]?.address;
      const address=(typeof listed==='string' && /^0x[0-9a-fA-F]{40}$/.test(listed) ? listed : findAddress(manifest?.contracts,token)) as `0x${string}`|undefined;
      if(!address){add(`${token.toUpperCase()}残高`,'BLOCKED','manifest.json に token address がありません');continue;}
      try { const bal=await client.readContract({address,abi:parseAbi(['function balanceOf(address) view returns (uint256)']),functionName:'balanceOf',args:[account.address]});
        const decimals=token==='usdc'?6:18; add(`${token.toUpperCase()}残高`,bal>0n?'PASS':'FAIL',`${formatUnits(bal,decimals)} ${token.toUpperCase()}${bal===0n?' — #faucet に投稿':''}`);
      } catch { add(`${token.toUpperCase()}残高`,'FAIL','残高照会失敗'); }
    }
    try { await client.call({to:account.address,data:'0x'}); add('eth_call','PASS','応答あり'); } catch { add('eth_call','FAIL','eth_call 失敗'); }
    // 禁止メソッド（anvil_* 等）は規約 §8 により、検査目的でも送らない。403 の確認は行わない。
    add('禁止メソッド403','BLOCKED','規約 §8: 環境操作 API は検査でも呼ばないため未検査');
    try {
      const calls=await Promise.all(Array.from({length:20},()=>rpc(env.rpcUrl,'eth_blockNumber',[],env.headers)));
      const bad=calls.find(x=>x.status===429); add('20回バーストで429なし',bad?'FAIL':calls.every(x=>x.status===200)?'PASS':'FAIL',bad?'HTTP 429':`HTTP ${[...new Set(calls.map(x=>x.status))].join(',')}`);
    } catch { add('20回バーストで429なし','BLOCKED','ネットワーク接続不可'); }
  } catch(e) { add('ヘッダ付き疎通','BLOCKED','接続できませんでした'); }
  if(results.length===before) add('ヘッダ付き検査','BLOCKED','必要な認証ヘッダを設定してください');
  print(); return results;
}
function print(){ console.log('| 検査 | 結果 | 詳細 |\n|---|---|---|'); for(const r of results) console.log(`| ${r.name} | ${r.status} | ${r.detail} |`); }
if(process.argv[1] && new URL(import.meta.url).pathname===process.argv[1]) process.exitCode = resultsExitCode(await runChecks());

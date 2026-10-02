import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, http, formatEther, formatUnits, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadPracticeEnv } from './env.js';

type Result = { name: string; status: 'PASS'|'FAIL'|'BLOCKED'; detail: string };
export function headerStatus(headers: Record<string,string>): Result {
  return Object.keys(headers).length === 3 ? { name:'認証ヘッダ設定',status:'PASS',detail:'3項目あり' } : { name:'ヘッダ付き検査',status:'BLOCKED',detail:'必要な認証ヘッダを設定してください' };
}
async function rpc(url: string, method: string, params: unknown[] = [], headers: Record<string,string> = {}) {
  const r = await fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  return { status:r.status, body: await r.json().catch(()=>null) as any };
}
const results: Result[] = [];
function add(name:string,status:Result['status'],detail:string){results.push({name,status,detail});}
export async function runChecks() {
  let env;
  try { env=await loadPracticeEnv(); }
  catch(e) { add('設定', 'BLOCKED', e instanceof Error ? e.message : '設定エラー'); print(); return results; }
  const noAuth = await rpc(env.rpcUrl,'eth_chainId').catch(()=>null);
  add('ヘッダ無しで403',noAuth?.status===403?'PASS':noAuth?'FAIL':'BLOCKED',noAuth?`HTTP ${noAuth.status}`:'ネットワーク接続不可');
  const client=createPublicClient({transport:http(env.rpcUrl,{fetchOptions:{headers:env.headers}})});
  const before=results.length;
  try {
    const chain=await client.getChainId(); add('chainId = 31337',chain===31337?'PASS':'FAIL',`chainId ${chain}`);
    const b1=await client.getBlockNumber(); await new Promise(r=>setTimeout(r,2200)); const b2=await client.getBlockNumber();
    add('ブロック進行',b2>b1?'PASS':'FAIL',`block ${b1} → ${b2}`);
    const account=privateKeyToAccount(env.privateKey);
    const eth=await client.getBalance({address:account.address}); add('ETH残高',eth>0n?'PASS':'FAIL',`${formatEther(eth)} ETH${eth===0n?' — #faucet に投稿':''}`);
    let manifest:any=null;
    try { manifest=JSON.parse(await readFile(resolve(process.cwd(),'manifest.json'),'utf8')); } catch {}
    const findAddress=(obj:any, key:string): `0x${string}`|undefined => {
      if (!obj || typeof obj!=='object') return;
      for(const [k,v] of Object.entries(obj)) { if(k.toLowerCase()===key && typeof v==='string' && /^0x[0-9a-fA-F]{40}$/.test(v)) return v as `0x${string}`; const found=findAddress(v,key); if(found)return found; }
    };
    for(const token of ['weth','usdc']) {
      const address=findAddress(manifest?.contracts,token);
      if(!address){add(`${token.toUpperCase()}残高`,'BLOCKED','manifest.json に token address がありません');continue;}
      try { const bal=await client.readContract({address,abi:parseAbi(['function balanceOf(address) view returns (uint256)']),functionName:'balanceOf',args:[account.address]});
        const decimals=token==='usdc'?6:18; add(`${token.toUpperCase()}残高`,bal>0n?'PASS':'FAIL',`${formatUnits(bal,decimals)} ${token.toUpperCase()}${bal===0n?' — #faucet に投稿':''}`);
      } catch { add(`${token.toUpperCase()}残高`,'FAIL','残高照会失敗'); }
    }
    try { await client.call({to:account.address,data:'0x'}); add('eth_call','PASS','応答あり'); } catch { add('eth_call','FAIL','eth_call 失敗'); }
    const denied=await rpc(env.rpcUrl,'anvil_setBalance',[account.address,'0x0'],env.headers).catch(()=>null);
    add('禁止メソッド403',denied?.status===403?'PASS':denied?'FAIL':'BLOCKED',denied?`HTTP ${denied.status}`:'ネットワーク接続不可');
    try {
      const calls=await Promise.all(Array.from({length:20},()=>rpc(env.rpcUrl,'eth_blockNumber',[],env.headers)));
      const bad=calls.find(x=>x.status===429); add('20回バーストで429なし',bad?'FAIL':calls.every(x=>x.status===200)?'PASS':'FAIL',bad?'HTTP 429':`HTTP ${[...new Set(calls.map(x=>x.status))].join(',')}`);
    } catch { add('20回バーストで429なし','BLOCKED','ネットワーク接続不可'); }
  } catch(e) { add('ヘッダ付き疎通','BLOCKED','接続できませんでした'); }
  if(results.length===before) add('ヘッダ付き検査','BLOCKED','必要な認証ヘッダを設定してください');
  print(); return results;
}
function print(){ console.log('| 検査 | 結果 | 詳細 |\n|---|---|---|'); for(const r of results) console.log(`| ${r.name} | ${r.status} | ${r.detail} |`); }
if(process.argv[1] && new URL(import.meta.url).pathname===process.argv[1]) await runChecks();

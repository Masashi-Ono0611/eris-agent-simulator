import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';

export type PracticeEnv = { rpcUrl: string; chainId: number; headers: Record<string, string>; privateKey: `0x${string}` };
const REQUIRED = ['ASCON_RPC_URL','ASCON_CHAIN_ID','ASCON_HEADER_1_NAME','ASCON_HEADER_1_VALUE','ASCON_HEADER_2_NAME','ASCON_HEADER_2_VALUE','ASCON_HEADER_3_NAME','ASCON_HEADER_3_VALUE','AGENT_PRIVATE_KEY'];

export async function loadPracticeEnv(file = resolve(process.cwd(), '.env.practice')): Promise<PracticeEnv> {
  let content: string;
  try { content = await readFile(file, 'utf8'); }
  catch { throw new Error('`.env.practice` がありません。ascon-notes/practice.env.template を参考に作成してください。'); }
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !m[1]!.startsWith('#')) values[m[1]!] = m[2]!.replace(/^(?:"(.*)"|'(.*)')$/, '$1$2');
  }
  const missing = REQUIRED.filter(k => !values[k]);
  if (missing.length) throw new Error(`未設定または空の項目: ${missing.join(', ')}`);
  let url: URL;
  try { url = new URL(values.ASCON_RPC_URL!); } catch { throw new Error('不正な項目: ASCON_RPC_URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('不正な項目: ASCON_RPC_URL');
  if (!/^\d+$/.test(values.ASCON_CHAIN_ID!) || Number(values.ASCON_CHAIN_ID) !== 31337) throw new Error('不正な項目: ASCON_CHAIN_ID');
  const headers: Record<string,string> = {};
  for (let i=1;i<=3;i++) {
    const name = values[`ASCON_HEADER_${i}_NAME`]!, value = values[`ASCON_HEADER_${i}_VALUE`]!;
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) throw new Error(`不正な項目: ASCON_HEADER_${i}_${/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ? 'VALUE' : 'NAME'}`);
    headers[name] = value;
  }
  const key = values.AGENT_PRIVATE_KEY!;
  try { if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(); privateKeyToAccount(key as `0x${string}`); }
  catch { throw new Error('不正な項目: AGENT_PRIVATE_KEY'); }
  return { rpcUrl: url.toString(), chainId: 31337, headers, privateKey: key as `0x${string}` };
}

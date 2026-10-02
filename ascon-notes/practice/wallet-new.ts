import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export async function createWallet(path = resolve(process.cwd(), '.env.wallet.local')) {
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address;
  await writeFile(path, `AGENT_PRIVATE_KEY=${key}\n`, { flag: 'wx', mode: 0o600 });
  return address;
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const address = await createWallet();
    const id = process.argv[2];
    console.log(`address: ${address}`);
    if (id && /^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) console.log(`id: ${id}\naddress: ${address}`);
    else console.log('id: <英字と -_ の ID>\naddress: ' + address);
  } catch (e) { console.error(e instanceof Error && 'code' in e && e.code === 'EEXIST' ? '.env.wallet.local は既に存在します。上書きしません。' : 'ウォレット作成に失敗しました。'); process.exitCode = 1; }
}

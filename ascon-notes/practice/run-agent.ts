import { practiceTransport } from './transport.js';
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createPublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadPracticeEnv, type PracticeEnv } from './env.js';

type BuildOptions = { agentDir: string; agentId: string; runDir: string };

export function buildAgentEnv(practiceEnv: PracticeEnv, { agentDir, agentId, runDir }: BuildOptions): NodeJS.ProcessEnv {
  const headers = Object.fromEntries(Object.entries(practiceEnv.headers).filter(([name]) =>
    !['cf-access-client-id', 'cf-access-client-secret'].includes(name.toLowerCase()),
  ));
  const cfHeader = (name: string) => Object.entries(practiceEnv.headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    ERIS_MANIFEST: './manifest.json',
    ERIS_CONFIG: 'config/practice.yaml',
    ERIS_AGENT_ID: agentId,
    ERIS_AGENT_DIR: `example/agents/${agentDir}`,
    ERIS_AGENT_PRIVATE_KEY: practiceEnv.privateKey,
    ERIS_RUN_DIR: runDir,
    ERIS_RPC_HEADERS: JSON.stringify(headers),
  };
  const cfId = cfHeader('CF-Access-Client-Id');
  const cfSecret = cfHeader('CF-Access-Client-Secret');
  if (cfId !== undefined) env.CF_ACCESS_CLIENT_ID = cfId;
  if (cfSecret !== undefined) env.CF_ACCESS_CLIENT_SECRET = cfSecret;
  return env;
}

export function formatDryRun(env: NodeJS.ProcessEnv): string {
  return Object.entries(env).map(([name, value]) => `${name}: ${value === undefined ? 'absent' : `present (${value.length} chars)`}`).join('\n');
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const agentDir = args[0];
  if (!agentDir || agentDir.startsWith('-')) {
    console.error('Usage: npx tsx ascon-notes/practice/run-agent.ts <agent-dir名> [--id masa-ascon] [--dry-run] [--force]');
    return 1;
  }
  let agentId = 'masa-ascon';
  let dryRun = false;
  let force = false;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--id' && args[i + 1]) agentId = args[++i]!;
    else if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--force') force = true;
    else { console.error(`Unknown option: ${args[i]}`); return 1; }
  }
  const base = process.cwd();
  const agentPath = resolve(base, 'example/agents', agentDir);
  if (!agentPath.startsWith(resolve(base, 'example/agents') + '/') ||
      !(await exists(resolve(agentPath, 'agent.ts'))) || !(await exists(resolve(agentPath, 'prompt.md')))) {
    console.error('エージェントのディレクトリに agent.ts と prompt.md が必要です。'); return 1;
  }
  if (!(await exists(resolve(base, 'manifest.json')))) { console.error('manifest.json がありません。'); return 1; }

  let practiceEnv: PracticeEnv;
  try { practiceEnv = await loadPracticeEnv(); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Practice 環境を読み込めません。'); return 1; }

  const client = createPublicClient({ transport: practiceTransport(practiceEnv.rpcUrl, practiceEnv.headers) });
  try {
    const account = privateKeyToAccount(practiceEnv.privateKey);
    const balance = await client.getBalance({ address: account.address });
    if (balance === 0n && !force) {
      console.error('ウォレットの ETH 残高が 0 です。#faucet に投稿済みか確認してください（無視する場合は --force）。');
      return 3;
    }
  } catch {
    console.error('ウォレットの ETH 残高を確認できませんでした。'); return 1;
  }

  const runDir = `practice-logs/${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const env = buildAgentEnv(practiceEnv, { agentDir, agentId, runDir });
  if (dryRun) { console.log(formatDryRun(env)); return 0; }

  const child = spawn(process.execPath, ['--import', 'tsx', '--import', './ascon-notes/practice/rpc-guard.ts', 'example/agents/runtime/bot.ts'], { cwd: base, env, stdio: 'inherit' });
  let signalSent = false;
  const forward = (signal: NodeJS.Signals) => { if (!signalSent) { signalSent = true; child.kill(signal); } };
  const onInt = () => forward('SIGINT');
  const onTerm = () => forward('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  return await new Promise<number>((resolveExit) => {
    child.once('error', () => resolveExit(1));
    child.once('close', (code, signal) => resolveExit(code ?? (signal ? 128 : 1)));
  }).finally(() => { process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); });
}

if (process.argv[1] && new URL(import.meta.url).pathname === resolve(process.argv[1])) {
  process.exitCode = await main();
}

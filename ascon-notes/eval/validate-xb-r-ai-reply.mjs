// Offline only: strict data parse and initial-50 delta check; no inference, eval or keys.
import { readFileSync } from 'node:fs';
import { parsePolicyReply } from '../../example/agents/xb-r-ai/policy.ts';
if (process.argv.length !== 3) throw new Error('usage: node --import tsx ascon-notes/eval/validate-xb-r-ai-reply.mjs <reply.json>');
const parsed = parsePolicyReply(readFileSync(process.argv[2], 'utf8'));
const ok = parsed.kind === 'declined' || (parsed.kind === 'selection' && Math.abs(parsed.selection.ENTRY_BPS - 50) <= 5);
console.log(JSON.stringify({ ok, result: parsed, scope: 'format + initial ENTRY=50 delta only; no performance/runtime claim' }, null, 2));
if (!ok) process.exitCode = 1;

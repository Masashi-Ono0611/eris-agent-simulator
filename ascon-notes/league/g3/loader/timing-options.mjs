import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { budgetMinutes } from './timing-budget.mjs';

export const DEFAULT_MAX_LOAD1 = 2.5;

export function parseLoadOptions(maxLoad1 = DEFAULT_MAX_LOAD1, loadNote = '') {
  const threshold = typeof maxLoad1 === 'number' ? maxLoad1 : Number(maxLoad1);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw Error('max-load1 must be a finite positive number');
  }
  if (typeof loadNote !== 'string') throw Error('load-note must be text');
  const note = loadNote.trim();
  if (threshold !== DEFAULT_MAX_LOAD1 && !note) {
    throw Error('load-note is required when max-load1 differs from default 2.5');
  }
  return { maxLoad1: threshold, loadNote: note };
}

export function parseTimingArgs(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (!['--output', '--max-load1', '--load-note', '--sweep-from', '--explore', '--protocol', '--budget-min'].includes(option)) throw Error(`unknown option: ${option}`);
    if (Object.hasOwn(values, option)) throw Error(`duplicate option: ${option}`);
    if (option === '--explore') { values[option] = true; continue; }
    if (!args[i + 1]?.trim() || args[i + 1].startsWith('--')) throw Error(`missing value: ${option}`);
    values[option] = args[++i];
  }
  if (!values['--output']) throw Error('--output is required (use a new output prefix)');
  if (values['--explore'] && values['--sweep-from']) throw Error('--explore and --sweep-from are exclusive');
  return { ...parseProtocolOptions(values['--protocol'], values['--budget-min']), ...(values['--explore'] ? { explore: true } : {}),
    ...(values['--sweep-from'] ? { sweepFrom: values['--sweep-from'] } : {}), output: values['--output'], ...parseLoadOptions(values['--max-load1'], values['--load-note']) };
}

export function parseTimingEnvironment(env) {
  try { return { ...parseProtocolOptions(env.G3_TIMING_PROTOCOL, env.G3_TIMING_BUDGET_MIN), ...parseLoadOptions(env.G3_TIMING_MAX_LOAD1, env.G3_TIMING_LOAD_NOTE),
    ...(env.G3_TIMING_SWEEP_FROM ? { sweepFrom: env.G3_TIMING_SWEEP_FROM } : {}) }; }
  catch (error) {
    throw Error(error.message.replaceAll('load-note', 'G3_TIMING_LOAD_NOTE')
      .replaceAll('max-load1', 'G3_TIMING_MAX_LOAD1').replaceAll('budget-min', 'G3_TIMING_BUDGET_MIN').replaceAll('protocol', 'G3_TIMING_PROTOCOL'), { cause: error });
  }
}

// Preflight before any measurement; writers also use exclusive creation (wx).
export function assertFreshOutput(output, directory) {
  if (typeof output !== 'string' || !output.trim()) throw Error('a new output prefix is required');
  const prefix = resolve(output);
  if (dirname(prefix) !== resolve(directory)) throw Error('output must stay in its artifact directory');
  if (existsSync(`${prefix}.json`) || existsSync(`${prefix}.md`) || existsSync(`${prefix}.partial.jsonl`) || existsSync(`${prefix}.positive.partial.jsonl`) || existsSync(`${prefix}.negative.partial.jsonl`)) throw Error('refuse to overwrite output');
  return prefix;
}

export function parseProtocolOptions(protocol, budgetMin) {
  if (protocol !== undefined && !['legacy', 'reduced'].includes(protocol)) throw Error('protocol must be legacy or reduced');
  return { ...(protocol === undefined ? {} : { protocol }), ...(budgetMin === undefined ? {} : { budgetMin: budgetMinutes(budgetMin) }) };
}

"""Offline league analysis shared by reports, ledger and generation briefs (stdlib only)."""
import argparse
import csv
import hashlib
import json
import math
import random
import re
import statistics
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REFERENCES = {'noop', 'multi-arb', 'clean-arb', 'venue-arb', 'basis-arb', 'random', 'crowd', 'inc-zeta'}


def number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def family(aid):
    m = re.match(r'^(.+)-\d+$', aid)
    return m.group(1) if m else aid


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', value):
        raise ValueError(f'invalid id: {value}')
    return value


def index_path(value):
    p = Path(value)
    if p.is_dir():
        return p / 'index.tsv'
    if p.name == 'index.tsv':
        return p
    return ROOT / 'ascon-notes/eval/out' / identifier(str(value)) / 'index.tsv'


def contained_path(root, value):
    rel = Path(value)
    if not str(value) or rel.is_absolute() or '..' in rel.parts:
        raise ValueError('path must be relative without ..')
    path = Path(root) / rel
    if not path.resolve().is_relative_to(Path(root).resolve()):
        raise ValueError('path escapes root')
    return path


def agent_path(root, value):
    path = contained_path(root, value)
    if path.is_symlink(): raise ValueError('symlink agent directory')
    if not path.is_dir(): raise ValueError(f'agent directory missing: {path}')
    return path


def read(index):
    with Path(index).open(newline='', encoding='utf-8') as f:
        return read_rows(list(csv.DictReader(f, delimiter='\t')))


def read_rows(rows):
    locations = []
    for row in rows:
        try: locations.append(contained_path(ROOT, row.get('run_dir', '')).resolve())
        except (ValueError, TypeError, OSError, RuntimeError): locations.append(None)
    counts = Counter(loc for loc in locations if loc is not None)
    keys = Counter((r.get('regime'), r.get('seed')) for r in rows)
    records = []
    for row, loc in zip(rows, locations):
        reason = None
        if loc is None: reason = 'run_dir欠測/不正（repo内の相対パスが必要）'
        elif counts[loc] > 1: reason = 'run_dir重複'
        elif keys[(row.get('regime'), row.get('seed'))] > 1: reason = 'シナリオ重複'
        if None in row or not row.get('regime') or not row.get('seed'):
            reason = reason or 'index行不正'
        if row.get('exit_code') != '0': reason = reason or 'exit_code不正'
        s = {}
        if loc is not None:
            try:
                summary = loc / 'summary.json'
                if not summary.resolve().is_relative_to(ROOT.resolve()): raise ValueError('summary escapes repo')
                s = json.loads(summary.read_text(encoding='utf-8'))
                if not isinstance(s, dict): raise ValueError('summary object required')
            except (OSError, ValueError):
                s = {}; reason = reason or 'summary欠測/不正'
        series = s.get('valueSeries')
        if not isinstance(series, dict) or not number(series.get('failedReads')) or series['failedReads'] != 0:
            reason = reason or 'failedReads不正/欠測'
        if s.get('violations'): reason = reason or 'violationsあり'
        agents = {}
        try:
            if not isinstance(s.get('agents'), list): raise ValueError('agents list required')
            for a in s['agents']:
                if not isinstance(a, dict): raise ValueError('agent object required')
                aid = identifier(a['id'])
                if aid in agents: raise ValueError('duplicate agent')
                agents[aid] = a
            if not agents: raise ValueError('empty agents')
        except (KeyError, TypeError, ValueError):
            reason = reason or 'agents不正'
        records.append(dict(regime=row.get('regime', ''), seed=row.get('seed', ''),
                            agents=agents, loops=s.get('loopIterations'), reason=reason,
                            run_dir=loc, mode=s.get('mode')))
    return records


def behavior(record, aid):
    """Never treat missing telemetry as zero; fees are available only for local backtest mode."""
    a = record['agents'][aid]
    result = {k: a.get(field) if number(a.get(field)) else None for k, field in
              [('included', 'includedTxCount'), ('reverted', 'revertCount')]}
    result.update(submit_failed=None, priority_fee_wei=None)
    loc = record.get('run_dir')
    if loc is None: return result
    try:
        failures = 0; events = 0
        with (loc / 'agents' / f'{aid}.jsonl').open(encoding='utf-8') as f:
            for line in f:
                event = json.loads(line)
                events += 1
                if not isinstance(event, dict): raise ValueError('invalid event')
                failures += event.get('kind') == 'mempool' and event.get('event') == 'submit_failed'
        if events: result['submit_failed'] = failures
    except (OSError, ValueError): pass
    # blocks.csv contains actual included txs. Backtest CLI pins base fee to zero;
    # actual tip per gas then equals min(maxPriorityFeePerGas, maxFeePerGas).
    if record.get('mode') == 'backtest' and result['included'] is not None:
        try:
            with (loc / 'blocks.csv').open(newline='', encoding='utf-8') as f:
                rows = [r for r in csv.DictReader(f) if r.get('ownerId') == aid]
            if len(rows) != result['included']: raise ValueError('incomplete block log')
            total = 0
            for r in rows:
                gas, tip, cap = (int(r[k]) for k in ('gasUsed', 'priorityFeeWei', 'maxFeePerGasWei'))
                if min(gas, tip, cap) < 0: raise ValueError('negative fee')
                total += gas * min(tip, cap)
            result['priority_fee_wei'] = total
        except (OSError, ValueError, KeyError): pass
    return result


def average(values):
    return statistics.mean(values) if values else None


def equal_mean(pairs):
    groups = defaultdict(list)
    for (regime, _seed), value in pairs.items(): groups[regime].append(value)
    return average([average(v) for v in groups.values()])


def resample(keys, rng):
    groups = defaultdict(list)
    for key in sorted(keys): groups[key[0]].append(key)
    return {reg: rng.choices(ks, k=len(ks)) for reg, ks in groups.items()}


def sampled_mean(values, sample):
    return average([average([values[k] for k in keys]) for keys in sample.values()])


def interval(values):
    """Symmetric linear quantiles at (n-1)*p; small samples are labelled descriptive."""
    values = sorted(values)
    if not values: return None
    def quantile(p):
        position = (len(values)-1)*p
        lo = math.floor(position); hi = math.ceil(position)
        return values[lo] + (values[hi]-values[lo])*(position-lo)
    return [quantile(.025), quantile(.975)]


def ci_text(player):
    ci = player['delta_ci']
    if ci is None: return '取得不能'
    label = ('縮退（再標本分散なし）' if player['ci_degenerate'] else
             '参考区間（bootstrap 少数）' if player['ci_small_boot'] else '95% CI')
    return label + ': ' + ' – '.join(fmt(v) for v in ci)


def stability_text(data):
    if data['top_stability_uninformative']: return '判定不能（競争者が少なすぎる）'
    return '取得不能' if data['top_stability'] is None else f"{data['top_stability']:.1%}"


def require_scored(data):
    if not data['rank_scenarios']:
        raise ValueError('有効に採点できた共通シナリオが 0（空 index・全除外・共通シナリオなし）')
    for warning in data['warnings']: print('警告: ' + warning, file=sys.stderr)
    return data


def credit(scores, aid, k):
    """Fractional credit for boundary ties; no alphabetical winner bias."""
    above = sum(v > scores[aid] + 1e-10 for v in scores.values())
    tied = sum(abs(v - scores[aid]) <= 1e-10 for v in scores.values())
    return max(0, min(1, (k - above) / tied))


def analyze(records, minimum=360, ref='inc-zeta', boot=2000, seed=1, top_k=3, top_n=3, players=None, collect_behavior=True):
    if boot < 1 or top_k < 1 or top_n < 1: raise ValueError('boot, top-k, top-n must be positive')
    low = {(r['regime'], r['seed']) for r in records if minimum > 0 and number(r['loops']) and r['loops'] < minimum}
    excluded = []
    scores = defaultdict(dict)
    metrics = defaultdict(list)
    for r in records:
        key = (r['regime'], r['seed'])
        reason = r['reason'] or (f"loopIterations={r['loops']}" if key in low else None)
        if reason:
            excluded.append(dict(regime=key[0], seed=key[1], reason=reason)); continue
        valid = {aid: a['pnlUsdc'] for aid, a in r['agents'].items()
                 if not a.get('baseline') and number(a.get('pnlUsdc'))}
        if not valid:
            excluded.append(dict(regime=key[0], seed=key[1], reason='P欠測')); continue
        mu = average(list(valid.values()))
        sd = math.sqrt(average([(v-mu)**2 for v in valid.values()]))
        for aid, value in valid.items():
            scores[aid][key] = 50 if sd == 0 else 50 + 10 * (value-mu) / sd
            if collect_behavior: metrics[aid].append(behavior(r, aid))
    pool = sorted(set(players) if players is not None else set(scores) - REFERENCES - {ref})
    if any(a not in scores for a in pool): raise ValueError('players contains unknown/unscored id')
    common = set.intersection(*(set(scores[a]) for a in pool)) if pool else set()
    rng = random.Random(seed)
    draws = {aid: {'top_k': [], 'first': [], 'top_n': []} for aid in pool}
    for _ in range(boot if common else 0):
        sample = resample(common, rng)
        means = {aid: sampled_mean(scores[aid], sample) for aid in pool}
        for aid in pool:
            for name, k in [('top_k', top_k), ('first', 1), ('top_n', top_n)]:
                draws[aid][name].append(credit(means, aid, k))
    result = {}
    for aid, values in sorted(scores.items()):
        regimes = {reg: average([v for (r, _s), v in values.items() if r == reg]) for reg in sorted({k[0] for k in values})}
        paired = {k: v - scores[ref][k] for k, v in values.items() if k in scores.get(ref, {})}
        prng = random.Random(seed)
        ci = interval([sampled_mean(paired, resample(paired, prng)) for _ in range(boot)]) if paired else None
        paired_counts = Counter(k[0] for k in paired)
        degenerate = bool(paired) and (any(n == 1 for n in paired_counts.values()) or ci[0] == ci[1])
        result[aid] = dict(mean_t=average(list(regimes.values())), worst_t=min(regimes.values()), regimes=regimes,
                           regime_counts={r: sum(k[0] == r for k in values) for r in regimes},
                           scenarios=len(values), paired_n=len(paired), delta_t=equal_mean(paired), delta_ci=ci, ci_degenerate=degenerate, ci_small_boot=boot < 1000,
                           paired=[dict(regime=k[0], seed=k[1], delta_t=v) for k,v in sorted(paired.items())],
                           rank_mean_t=equal_mean({k: values[k] for k in common}) if aid in pool else None,
                           stability={name: average(v) for name,v in draws.get(aid, {}).items()},
                           behavior={name: dict(total=sum(m[name] for m in metrics[aid] if m[name] is not None),
                                                observed=sum(m[name] is not None for m in metrics[aid]), total_runs=len(metrics[aid]))
                                     for name in ('included', 'reverted', 'submit_failed', 'priority_fee_wei')})
    ranking = sorted(pool, key=lambda a: (-result[a]['rank_mean_t'], a)) if common else []
    # Preserve each family's best even when this increases the retained count above half.
    survivors = set(ranking[:math.ceil(len(ranking)/2)])
    for fam in {family(a) for a in ranking}:
        survivors.add(next(a for a in ranking if family(a) == fam))
    top = ranking[:top_n]
    common_counts = Counter(k[0] for k in common)
    return dict(ref=ref, boot=boot, seed=seed, top_k=top_k, top_n=top_n, minimum=minimum,
                players=result, ranking=ranking, rank_scenarios=len(common),
                rank_regimes=sorted({k[0] for k in common}),
                survivors=[a for a in ranking if a in survivors], eliminate=[a for a in ranking if a not in survivors],
                top_mean_t=average([result[a]['rank_mean_t'] for a in top]),
                top_stability=(average([result[a]['stability']['top_n'] for a in top]) if len(pool) > top_n else None),
                top_stability_uninformative=len(pool) <= top_n,
                warnings=([f'共通シナリオの被覆不足: {len(common)} シナリオ / {len(common_counts)}/12 レジーム（12 レジーム・各 2 seed 以上を未充足）']
                          if len(common_counts) < 12 or any(n < 2 for n in common_counts.values()) else []) +
                         (['bootstrap 少数（1000 回未満）: 分位点は参考区間。対称線形補間 (n-1)*p を使用'] if boot < 1000 else []),
                excluded=excluded, excluded_scenarios=len({(r['regime'],r['seed']) for r in excluded}),
                low=[dict(regime=r['regime'],seed=r['seed'],loops=r['loops']) for r in records if (r['regime'],r['seed']) in low],
                missing_loops=sum(not number(r['loops']) for r in records),
                scenarios=[dict(regime=r['regime'],seed=r['seed']) for r in records])


def fmt(value):
    return '取得不能' if value is None else f'{value:.2f}'


def metric_text(metric):
    n, total = metric['observed'], metric['total_runs']
    if not n: return '取得不能'
    return str(metric['total']) if n == total else f"取得不能（観測分 {metric['total']}; {n}/{total} run）"


def analysis_args(p):
    p.add_argument('--ref', default='inc-zeta')
    p.add_argument('--boot', type=int, default=2000)
    p.add_argument('--seed', type=int, default=1, help='bootstrap RNG seed')
    p.add_argument('--top-k', type=int, default=3)
    p.add_argument('--top-n', type=int, default=3)
    p.add_argument('--players', help='comma separated competitors; defaults exclude known references')
    p.add_argument('--min-loop-iterations', type=int, default=360)


def from_args(a):
    return require_scored(analyze(read(index_path(a.round)), a.min_loop_iterations, a.ref, a.boot, a.seed,
                   a.top_k, a.top_n, a.players.split(',') if a.players else None))


def roster_agents(path):
    # Reuse the repository's existing YAML dependency, no Python dependency added.
    raw = subprocess.check_output(['node', '-e',
        'const fs=require("fs"),y=require("yaml"); const r=y.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(JSON.stringify(r.agents.map(a=>({id:a.id,dir:a.dir||a.id,command:!!a.command}))));', str(Path(path).resolve())], cwd=ROOT, text=True)
    agents = json.loads(raw)
    if not agents or len({a['id'] for a in agents}) != len(agents): raise ValueError('invalid roster ids')
    for a in agents: identifier(a['id'])
    return agents


def tree_hash(path):
    path = Path(path)
    if path.is_symlink(): raise ValueError(f'symlink agent directory: {path}')
    if not path.is_dir(): raise ValueError(f'agent directory missing: {path}')
    files = {}
    for p in sorted(path.rglob('*')):
        if p.is_symlink(): raise ValueError(f'symlink in agent directory: {p}')
        if p.is_file(): files[p.relative_to(path).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    if not files: raise ValueError(f'empty agent directory: {path}')
    return dict(sha256=hashlib.sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), files=files)

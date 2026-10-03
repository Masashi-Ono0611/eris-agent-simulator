"""Shared fail-closed scoring contract. No I/O and no partial cross-section scoring."""
import math
import re

THRESHOLDS = dict(blocks=360, expected_loops=362, block_time_sec=2, max_p99_fraction=.5,
                  max_catchup_increase=0, max_timeout_increase=0, max_coverage_drop_pp=1,
                  max_submit_failure_increase=None, max_decision_drop=None)


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def scoring_errors(agents, expected_ids=None):
    if not isinstance(agents, list) or not agents: return ['agents empty/malformed']
    ids = [a.get('id') if isinstance(a, dict) else None for a in agents]
    if any(not isinstance(i, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', i) for i in ids):
        return ['agent IDs malformed']
    errors = []
    if len(set(ids)) != len(ids): errors.append('duplicate agent ID')
    if expected_ids is not None and set(ids) != set(expected_ids): errors.append('roster mismatch')
    if any(not finite(a.get('pnlUsdc')) for a in agents): errors.append('P missing/nonfinite: entire scenario invalid')
    if not any(not a.get('baseline') for a in agents): errors.append('no scoring agents')
    return errors


def summary_errors(summary, expected_ids=None):
    if not isinstance(summary, dict): return ['summary malformed']
    errors = scoring_errors(summary.get('agents'), expected_ids)
    series = summary.get('valueSeries')
    if not isinstance(series, dict) or not finite(series.get('failedReads')) or series['failedReads'] != 0:
        errors.append('failedReads不正/欠測')
    if summary.get('violations') != []: errors.append('violationsあり/欠測')
    return errors


def score_record_errors(agents, loops, expected_ids=None):
    errors = scoring_errors([dict(a, id=i) for i, a in agents.items()], expected_ids)
    if not finite(loops) or loops != THRESHOLDS['expected_loops']: errors.append('loopIterations missing/not 362')
    return errors

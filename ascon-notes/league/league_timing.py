"""Read local telemetry only; shared by status and the offline degradation gate."""
import json
from pathlib import Path
from league_harness import number


def events(path):
    with Path(path).open(encoding='utf-8') as stream:
        for line in stream:
            if not line.endswith('\n'): raise ValueError('incomplete JSONL line')
            event = json.loads(line)
            if not isinstance(event, dict):
                raise ValueError('JSONL object required')
            yield event


def timing_maxima(run_dirs):
    caught, elapsed = [], []
    missing = 0
    for path in run_dirs:
        found = False
        try:
            for event in events(Path(path) / 'events.jsonl'):
                if event.get('type') != 'round_timing': continue
                found = True
                a, b = event.get('blocksCaughtUp'), event.get('totalMs')
                if number(a) and a >= 0: caught.append(a)
                else: missing += 1
                if number(b) and b >= 0: elapsed.append(b)
                else: missing += 1
        except (OSError, ValueError): missing += 1
        if not found: missing += 1
    return dict(max_blocks_caught_up=max(caught) if caught else None,
                max_environment_total_ms=max(elapsed) if elapsed else None,
                timing_missing=missing)

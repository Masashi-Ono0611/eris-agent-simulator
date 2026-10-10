#!/usr/bin/env python3
"""Print evidence tables; stdlib only, no writes or experiment execution.

Argument: evidence root containing raw/ and SHA256SUMS.txt (or raw/ itself).
Measurements come from JSON. Historical default load comes from the adjacent
archived Air JSON; the old test timeout comes only from its explicitly cited log.
Stored intervals/verdicts are extracted, not re-fit or re-bootstrap-sampled.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import re


HERE = Path(__file__).resolve().parent
PREFIX = Path('ascon-notes/league/g3')
EXPLORE = PREFIX / 'loader/TIMING-EXPLORE-MINI-2026-10-09.json'
MAIN = PREFIX / 'loader/TIMING-MEASUREMENT-MINI-2026-10-09.json'
CONTROLS = PREFIX / 'tests/TIMING-CONTROLS-MINI-2026-10-09.json'


def read(path):
    return json.loads(path.read_text())


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def fmt(value):
    if isinstance(value, (dict, list, bool)) or value is None:
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def table(headers, rows):
    print('| ' + ' | '.join(headers) + ' |')
    print('| ' + ' | '.join('---' for _ in headers) + ' |')
    for row in rows:
        print('| ' + ' | '.join(fmt(v).replace('|', r'\|').replace('\n', ' ') for v in row) + ' |')
    print()


def interval(v):
    return f'[{v["lower"]}, {v["upper"]}]' + (' DEGENERATE' if v.get('degenerate') else '')


def quantile(values, p):
    values = sorted(values)
    position = (len(values) - 1) * p
    low = math.floor(position)
    return values[low] + (values[math.ceil(position)] - values[low]) * (position - low)


def verify(run):
    """Cheap raw/summary checks, without running the measurement code."""
    rows = run['summary']['boundary']
    for row in rows:
        pairs = [p for p in run['raw'] if p['phase'] == 'boundary' and p['durationMs'] == row['dMs']]
        arms = {a: [d['timedOut'] for p in pairs for d in p[a]['decides']] for a in 'AB'}
        assert len(pairs) == row['blocks'] == run['config']['boundaryRepetitions']
        for a in 'AB':
            assert len(arms[a]) == row['n']
            assert sum(arms[a]) == row[a]['timeouts']
            assert sum(arms[a]) / row['n'] == row[a]['fraction']
        assert row['discordant'] == {
            'onlyA': sum(a and not b for a, b in zip(arms['A'], arms['B'])),
            'onlyB': sum(b and not a for a, b in zip(arms['A'], arms['B']))}
        assert row['difference'] == row['B']['fraction'] - row['A']['fraction']
    area = sum((b['dMs'] - a['dMs']) * (a['difference'] + b['difference']) / 2
               for a, b in zip(rows, rows[1:]))
    assert math.isclose(area, run['summary']['boundaryShiftMs'], abs_tol=1e-12)
    for arm in 'AB':
        assert sum(p[arm]['rewarmCount'] for p in run['raw']) == run['summary']['rewarm'][arm]['rewarmCount']
    observed = [v['load'][0] for v in run['loadChecks']]
    observed += [run[k]['loadAverage'][0] for k in ('hostBefore', 'hostAfter')]
    assert max(observed) == run['maxObservedLoad1']
    ci, inf = run['summary']['boundaryShiftIntervalMs'], run['inference']
    assert inf['intervalInsideMargin'] == (run['status'] == 'complete' and not ci['degenerate']
        and ci['lower'] >= inf['marginMs'][0] and ci['upper'] <= inf['marginMs'][1])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('evidence_directory', type=Path)
    args = parser.parse_args()
    root = args.evidence_directory.resolve()
    raw = root / 'raw' if (root / 'raw').is_dir() else root
    manifest = raw.parent / 'SHA256SUMS.txt'
    checked = 0
    for line in manifest.read_text().splitlines():
        expected, relative = line.split(maxsplit=1)
        path = (raw / relative).resolve()
        assert path.is_relative_to(raw), 'manifest path escapes evidence'
        assert digest(path) == expected, f'manifest mismatch: {relative}'
        checked += 1
    exploration = read(raw / EXPLORE)
    measured = read(raw / MAIN)
    controls = read(raw / CONTROLS)
    runs = {**controls, 'main': measured}
    sha = digest(raw / EXPLORE)
    for run in runs.values():
        assert run['config']['sweepSelection']['explorationSha256'] == sha
        verify(run)
    overhead = measured['summary']['overhead']['decide']
    pairs = [p for p in measured['raw'] if p['phase'] == 'overhead']
    values = {a: [d['wallMs'] for p in pairs for d in p[a]['decides']] for a in 'AB'}
    values['pairedDelta'] = [b - a for a, b in zip(values['A'], values['B'])]
    for name, xs in values.items():
        assert len(xs) == overhead[name]['n']
        for stat, probability in [('median', .5), ('p95', .95)]:
            assert math.isclose(quantile(xs, probability), overhead[name][stat], abs_tol=1e-12)
    sources = []
    for name, run in runs.items():
        hashes = run['sourceHashes']
        matches = sum(digest(HERE / path) == h for path, h in hashes.items())
        assert matches == len(hashes), f'{name}: current source differs from recorded source'
        sources.append([name, matches, len(hashes)])
    constants = measured['config']['protocolConstants']
    print('### 抽出元と照合\n')
    table(['入力', '相対パス / 照合結果'], [
        ['探索', EXPLORE], ['対照', CONTROLS], ['主測定', MAIN],
        ['探索 SHA-256（Secure Hash Algorithm、内容照合用）', sha],
        ['SHA256SUMS.txt の一致ファイル数', checked]])
    table(['記録', '現行ソースと一致', '記録されたソース数'], sources)
    print('統計値は JSON から抽出。timeout 件数・不一致・面積・再準備回数・最大負荷・'
          'overhead 中央値と百分位を raw と照合。区間と判定は保存値であり、再計測・再標本化はしていない。\n')
    print('### 実行条件と日時\n')
    host = measured['hostBefore']
    table(['項目', '値'], [[k, host[k]] for k in
          ('arch', 'cpuModel', 'logicalCpus', 'platform', 'release', 'node', 'tsx', 'toolchainOverride', 'toolchainNote')]
          + [['loadNote（実行者の説明、因果の実証ではない）', measured['config']['loadNote']],
             ['timeout（ミリ秒）', measured['config']['timeoutMs']],
             ['c（探索で選んだ中心、ミリ秒）', measured['config']['sweepSelection']['cMs']],
             ['中心からの測定点（ミリ秒）', constants['offsetsMs']],
             ['初期・再準備の判断回数 / 各プロセスの測定判断回数',
              f'{constants["warmupDecides"]} / {constants["measuredDecides"]}'],
             ['対照 / 主測定の各点プロセス対数', f'{constants["controlPairs"]} / {constants["mainPairs"]}'],
             ['対ごとの休止（ミリ秒）', constants['cooldownMs']]])
    table(['実行', '状態', '開始 UTC（協定世界時）', '終了 UTC', '終了 JST（日本標準時）',
           '記録された対数', '負荷上限', '最大観測負荷'], [
        [name, run['status'], run['startedAt'], run['finishedAt'],
         datetime.fromisoformat(run['finishedAt']).astimezone(timezone(timedelta(hours=9))).isoformat(),
         len(run['raw']), run['config']['maxLoad1'], run['maxObservedLoad1']]
        for name, run in {'exploration': exploration, **runs}.items()])
    table(['実行', '予算に計上した経過（分）', '予算（分）', '残り（分）', '完了対 / 予定対'], [
        [name, f'{run["budget"]["elapsedMs"] / 60000:.6f}', run['config']['budgetMin'],
         f'{(run["budget"]["limitMs"] - run["budget"]["elapsedMs"]) / 60000:.6f}',
         f'{run["budget"]["completedPairs"]} / {run["budget"]["totalPairs"]}'] for name, run in runs.items()])
    print('### 失敗履歴の数値（本測定へ混ぜない）\n')
    air = read(HERE / 'TIMING-MEASUREMENT-2026-10-09.json')
    note = measured['config']['loadNote']
    history = re.search(r'\((\d+\.\d+), then (\d+\.\d+), now (\d+)\)', note)
    assert history, 'load history missing'
    print(f'負荷閾値の履歴: {air["config"]["maxLoad1"]} → ' + ' → '.join(history.groups()) + '。'
          '既定値は保存 Air JSON、以後は main.config.loadNote の記載。失敗を見た後の変更である。\n')
    table(['保存元', '状態', '記録された対数', '負荷上限', 'failure'],
          [['リポジトリ内 Air measurement JSON', air['status'], len(air['raw']), air['config']['maxLoad1'], air['failure']]] + [
        [str(p.relative_to(raw)), run['status'], len(run['raw']), run['config']['maxLoad1'], run.get('failure')]
        for p in sorted(raw.glob('superseded-*/TIMING-EXPLORE-*.json')) for run in [read(p)]])
    old = raw / 'superseded-reduced-1791640493'
    timeout = re.search(r'test timed out after (\d+)ms', (old / 'controls.log').read_text())
    assert timeout, 'old timeout evidence missing'
    print(f'旧全設計のテスト上限: {int(timeout[1]) / 60000:g} 分。'
          'この履歴値だけは JSON ではなく superseded-reduced-1791640493/controls.log から抽出。\n')
    print('### 対照の保存判定\n')
    table(['対照', 'B 注入（ミリ秒）', '符号付き面積（ミリ秒）', '区間（ミリ秒）',
           'controlVerdict', 'controlCriteriaPassed', 'controlAssessment', 'controlFailures'], [
        [name, run['config']['arms'][1]['delayMs'], run['summary']['boundaryShiftMs'],
         interval(run['summary']['boundaryShiftIntervalMs']), run['controlVerdict'],
         run['controlCriteriaPassed'], run['controlAssessment'], run['controlFailures']]
        for name, run in controls.items()])
    table(['対照', '感度点（ミリ秒）', 'B−A timeout 割合差', '点別区間', '保存 assertion 全件成立'], [
        [name, row['dMs'], row['difference'], interval(row['differenceInterval']),
         all(a['passed'] for a in run['controlAssertions'])]
        for name, run in controls.items() for row in run['summary']['boundary']
        if row['dMs'] == run['config']['sweepSelection']['sensitiveDwellMs']])
    print(f'正対照の回収値は約 {controls["positive"]["summary"]["boundaryShiftMs"]:.2f} ミリ秒。\n')
    print('### 主測定の面積と判断コスト\n')
    summary = measured['summary']
    ci = summary['boundaryShiftIntervalMs']
    table(['項目', '値'], [['符号付き面積（ミリ秒）', summary['boundaryShiftMs']],
        ['表示用丸め（ミリ秒）', f'{summary["boundaryShiftMs"]:.4f}'],
        ['bootstrap 区間（ミリ秒）', interval(ci)], ['信頼水準', constants['confidence']],
        ['再標本化回数 / seed（乱数の初期値）', f'{ci["replicates"]} / {ci["seed"]}'],
        ['再標本化方法（保存原文）', ci['method']]])
    print(f'd = {pairs[0]["durationMs"]} ミリ秒の decide（判断）の測定プロセス対数: {len(pairs)}。\n')
    table(['待機を加えない decide', '中央値（ミリ秒）', '第九十五百分位（ミリ秒）', '判断標本数'],
          [[name, values['median'], values['p95'], values['n']] for name, values in overhead.items()])
    print('A は stock（標準実装）、B は probe（観測器）あり。pairedDelta は対にした B−A。'
          '判断標本は同一プロセス内でも測られており、すべてが独立な標本ではない。\n')
    table(['d（待機ミリ秒）', 'プロセス対数', '各 arm 判断数', 'A timeout 件数 / 割合',
           'B timeout 件数 / 割合', 'A のみ / B のみ timeout', '割合差 B−A', '点別区間'], [
        [r['dMs'], r['blocks'], r['n'], f'{r["A"]["timeouts"]} / {r["A"]["fraction"]}',
         f'{r["B"]["timeouts"]} / {r["B"]["fraction"]}',
         f'{r["discordant"]["onlyA"]} / {r["discordant"]["onlyB"]}', r['difference'], interval(r['differenceInterval'])]
        for r in summary['boundary']])
    table(['d', '共分散 / 相関', 'AB 対数 / 割合差', 'BA 対数 / 割合差', '前半 / 後半の割合差'], [
        [r['dMs'], f'{d["covariance"]} / {fmt(d["correlation"])}',
         f'{d["byOrder"]["AB"]["blocks"]} / {d["byOrder"]["AB"]["difference"]}',
         f'{d["byOrder"]["BA"]["blocks"]} / {d["byOrder"]["BA"]["difference"]}',
         f'{d["firstHalfDifference"]} / {d["secondHalfDifference"]}']
        for r in summary['boundary'] for d in [r['blockDiagnostics']]])
    table(['実行', 'A 再準備回数', 'B 再準備回数', '保存警告'], [
        [name, run['summary']['rewarm']['A']['rewarmCount'], run['summary']['rewarm']['B']['rewarmCount'],
         run['summary']['rewarm']['warning']] for name, run in runs.items()])
    print('再準備（rewarm）は timeout 後に次の測定判断が残る場合の warm-up。表は捨てた準備対も含む全 raw の集計。'
          'AB は A を先に実行、BA は B を先に実行。相関 null は定数列で計算不能であり、独立性の証拠ではない。\n')
    print('### inference（保存された推論ブロック、そのまま）\n\n```json')
    print(json.dumps(measured['inference'], ensure_ascii=False, indent=2))
    print('```\n')
    inf = measured['inference']
    print(f'MDE（Minimum Detectable Effect、最小検出効果）の計画値は、条件付き水平移動で約 '
          f'{inf["mde"]["conditionalShiftMs"]:.1f} ミリ秒、標本点の面積で約 '
          f'{inf["mde"]["sampledAreaMs"]:.1f} ミリ秒。いずれも宣言済み許容範囲の半幅 '
          f'{(inf["marginMs"][1] - inf["marginMs"][0]) / 2:g} ミリ秒より大きい（これは保守的な仮定、'
          f'同一プロセス内の相関 {inf["mde"]["rho"]:g} の値）。'
          f'楽観的な仮定（相関 {inf["optimisticMde"]["rho"]:g}）の値は、条件付き水平移動で約 '
          f'{inf["optimisticMde"]["conditionalShiftMs"]:.1f} ミリ秒、標本点の面積で約 '
          f'{inf["optimisticMde"]["sampledAreaMs"]:.1f} ミリ秒で、'
          f'宣言済み許容範囲の半幅より小さい。したがって「この設計は MDE 未満の移動を認証できない」'
          'という結論は、保守的な相関の仮定に依存しており、仮定が楽観側なら結論は変わり得る。'
          f'これは検出力 {inf["mde"]["power"] * 100:g}% の条件付き計画近似であり、数学的に検出不能という意味ではない。\n')
    print(f'計画上の解像度は {inf["mde"]["planningResolutionMs"]} ミリ秒。粗い格子の面積統計では、'
          f'別途測った判断ごとの約 {overhead["pairedDelta"]["median"]:.1f} ミリ秒の追加コストを分解できない。\n')


if __name__ == '__main__':
    main()

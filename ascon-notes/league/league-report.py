#!/usr/bin/env python3
"""Summarize league results with paired inference and diversity recommendations."""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling module also when this file is loaded by path (tests, importlib)
import g0
from league_harness import (read, family, analyze, analysis_args, from_args, average, fmt, metric_text, ci_text, stability_text)


def render_analysis(data):
    out = ["採点契約: 全員有限P・同一ロスター・loopIterations=362。シナリオ全体を採用/除外。",
           f"追加の負荷ガード: loopIterations < {data['minimum']} を除外",
           f"除外シナリオ: {len({(r['regime'],r['seed']) for r in data['low']})}"]
    out += ['警告: ' + w for w in data['warnings']]
    out += [f"- {r['regime']} / {r['seed']}: loopIterations={r['loops']}" for r in data['low']] or ['- なし']
    out += [f"警告: loopIterations 欠落 {data['missing_loops']} 件（シナリオ全体を除外）",
            f"全理由の除外シナリオ: {data['excluded_scenarios']}"]
    out += [f"- {r['regime']} / {r['seed']}: {r['reason']}" for r in data['excluded']]
    out += ['', '全体・系統の平均 T はレジーム別平均の等重み平均（観測できたレジームのみ）',
            f"基準: {data['ref']}。区間推定: レジーム内シナリオ bootstrap {data['boot']} 回 / RNG seed {data['seed']}。",
            '同一シナリオの全員を一緒に再標本化。順位は全競争者共通シナリオのみ。境界同点は確率を均等配分。',
            'CI は観測済みレジーム・seed に条件付き。少数 seed / 未観測レジームへの一般化はできない。', '',
            '| プレイヤー | 平均 T | 最悪レジーム T | レジーム別平均 T | 対数 | 基準との差 T [区間] |',
            '|---|---:|---:|---|---:|---|']
    for aid, x in data['players'].items():
        ci = ci_text(x)
        regimes = ', '.join(f'{r} {v:.2f}' for r,v in x['regimes'].items())
        out.append(f"| {aid} | {fmt(x['mean_t'])} | {fmt(x['worst_t'])} | {regimes} | {x['paired_n']} | {fmt(x['delta_t'])} [{ci}] |")
    out += ['', '### シナリオ対応差', '', '| プレイヤー | レジーム | seed | ΔT |', '|---|---|---|---:|']
    for aid,x in data['players'].items():
        out += [f"| {aid} | {v['regime']} | {v['seed']} | {fmt(v['delta_t'])} |" for v in x['paired']]
    out += ['', f"### 順位安定性（共通 {data['rank_scenarios']} シナリオ / {len(data['rank_regimes'])} レジーム）", '',
            f"| プレイヤー | 共通平均 T | 上位 {data['top_k']} 確率 | 1 位確率 |", '|---|---:|---:|---:|']
    for aid in data['ranking']:
        x = data['players'][aid]
        out.append(f"| {aid} | {fmt(x['rank_mean_t'])} | {x['stability']['top_k']:.1%} | {x['stability']['first']:.1%} |")
    out += ['', f"順位の安定性: 上位 {data['top_n']} 枠維持確率={stability_text(data)}。",
            f"勝者の呪い（選抜バイアス）: 上位 {data['top_n']} 体の平均 T={fmt(data['top_mean_t'])}。順位の安定性は選抜バイアスの補正ではない。未使用 seed で要確認。",
            '', '### 存続・脱落（機械的な推奨であり決定ではない）',
            '既知の参照は選抜対象外（--players で明示可能）。下位半分を候補とし、各系統の最高位を最低 1 体残す。',
            '存続推奨: ' + (', '.join(data['survivors']) or '取得不能'),
            '脱落候補: ' + (', '.join(data['eliminate']) or '空（該当候補なし）'),
            '', '### 行動指標（採用シナリオの合計）', '',
            '| プレイヤー | 約定/包含数 | リバート数 | 送信失敗数 | 優先手数料 wei |', '|---|---:|---:|---:|---:|']
    for aid,x in data['players'].items():
        out.append('| ' + aid + ' | ' + ' | '.join(metric_text(x['behavior'][k]) for k in ('included','reverted','submit_failed','priority_fee_wei')) + ' |')
    out += ['包含数は summary.includedTxCount（成功した売買だけの件数ではない）。リバートは summary.revertCount、送信失敗は runtime submit_failed。',
            '優先手数料は local backtest の base fee=0 を前提に blocks.csv の gasUsed × min(tip, cap) を合計（リバート含む）。欠測時は取得不能。']
    groups = defaultdict(lambda: defaultdict(list))
    for aid,x in data['players'].items():
        for regime,t in x['regimes'].items(): groups[family(aid)][regime].extend([t] * x['regime_counts'][regime])
    out += ['', '### 系統別平均', '', '| 系統 | 平均 T |', '|---|---:|']
    out += [f"| {f} | {fmt(average([average(v) for v in rs.values()]))} |" for f,rs in sorted(groups.items())]
    return '\n'.join(out) + '\n'


def render(records, minimum=360, **kwargs):
    return render_analysis(analyze(records, minimum, **kwargs))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('round', help='index.tsv, out directory or round label')
    analysis_args(p)
    g0.add_args(p)
    p.add_argument('--allow-unverified', action='store_true')
    p.add_argument('--json', action='store_true')
    p.add_argument('-o', '--output', type=Path)
    a = p.parse_args()
    gate = None
    try:
        gate = g0.from_args(a)
        warning = '未検証（G0 '+gate['status']+'）' if gate['status'] != 'PASS' else 'G0 PASS'
        if gate['status'] != 'PASS' and not a.allow_unverified:
            result = json.dumps(dict(warning=warning,g0=gate),ensure_ascii=False,indent=2) if a.json else warning+'\n'+g0.render(gate)
            if a.output: a.output.write_text(result,encoding='utf-8')
            else: print(result)
            return {'FAIL':1,'BLOCKED':2}[gate['status']]
        data = from_args(a, expected_ids=gate.get('expected',{}).get('agents'))
        data.update(g0=gate, verification=warning, allow_unverified=a.allow_unverified)
        result = json.dumps(data, ensure_ascii=False, indent=2) + '\n' if a.json else warning + '\n\n' + render_analysis(data)
    except (OSError, ValueError) as e:
        if gate and gate['status'] != 'PASS': print('未検証（G0 '+gate['status']+'）')
        p.error(str(e))
    if a.output: a.output.write_text(result, encoding='utf-8')
    else: print(result, end='')


if __name__ == '__main__': raise SystemExit(main())

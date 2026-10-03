#!/usr/bin/env python3
"""Generate survivor and fresh-player briefs from an offline league round."""
import argparse
import re
from pathlib import Path
from league_harness import ROOT, analysis_args, from_args, identifier, roster_agents, fmt, metric_text, agent_path, ci_text


def safe_label(value):
    # No Markdown/control syntax; preserve ordinary Japanese archetype names.
    return re.sub(r'[^A-Za-z0-9 _/\-\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff]', '_', str(value))[:160]


def generate(data, round_name, aid, template, paths, fresh=None):
    if fresh is None:
        x = data['players'][aid]
        weak = min(x['regimes'], key=x['regimes'].get)
        strong = max(x['regimes'], key=x['regimes'].get)
        title = '前世代の改良'
        detail = (f'前世代の自分のコードから開始する。最弱 {safe_label(weak)} を改善し、強み {safe_label(strong)} を壊さない。'
                  '既存の安全ガードを保ち、弱点の原因を仮説と単体テストに落とす。')
        previous = ['## 前世代の結果', f'ラウンド: {round_name}',
                    'レジーム別 T: ' + ', '.join(f'{safe_label(r)}={fmt(t)}' for r,t in x['regimes'].items()),
                    f"最悪レジーム: {safe_label(weak)} / T={fmt(x['worst_t'])}",
                    f"基準 {data['ref']} との差: {fmt(x['delta_t'])}; 区間={ci_text(x)}; 対数={x['paired_n']}",
                    '行動指標: ' + '; '.join(f'{k}={metric_text(v)}' for k,v in x['behavior'].items())]
    else:
        title = '白紙＋新しい型'
        detail = f'白紙から独自設計。新しい型: {safe_label(fresh)}。前世代コードをコピーせず、収益源・失敗条件・コストを明文化する。'
        previous = ['## 前世代の結果', f'ラウンド: {round_name}', '新規枠のため本人の結果はない。']
    top = ['## リーグ全体の上位の傾向']
    for leader in data['ranking'][:3]:
        x = data['players'][leader]
        strong = sorted(x['regimes'], key=lambda r: -x['regimes'][r])[:3]
        top.append(f"- {leader}: 平均 T={fmt(x['rank_mean_t'])}; 強いレジーム=" +
                   ', '.join(f'{safe_label(r)} {fmt(x["regimes"][r])}' for r in strong) +
                   f"; 読んでよい参考: `{paths[leader]}`（参照のみ、編集禁止）")
    guidance = ['## 改良時の注意',
                '上位の特徴は観測上の傾向であり、因果関係や将来の勝利を保証しない。',
                '同じ seed / 単一レジームへの過剰最適化を避け、全レジーム等重み・最悪値・基準との差で判断する。',
                '本人の強みを保つ回帰テストと、弱点への対策が発火する/しないテストを作る。',
                '勝者の呪いがある。選抜に使わない新 seed での確認は運営が行う。バックテストは実行しない。']
    return (template.replace('{{PLAYER_ID}}', aid).replace('{{ARCHETYPE}}', title)
            .replace('{{ARCHETYPE_DETAIL}}', detail).replace('{{GENERATION_CONTEXT}}', '\n\n'.join(['\n'.join(previous), '\n'.join(top), '\n'.join(guidance)])))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('round'); p.add_argument('--generation', type=int, required=True)
    p.add_argument('--survivors', default='', help='comma separated IDs; human selection')
    p.add_argument('--fresh', action='append', default=[], metavar='ID:NEW-TYPE')
    p.add_argument('--roster', type=Path, help='resolve reference code paths through roster dir aliases')
    p.add_argument('--agent-root', type=Path, default=ROOT / 'example/agents')
    p.add_argument('--output-dir', type=Path)
    analysis_args(p); a = p.parse_args()
    try:
        if a.generation < 2: raise ValueError('generation must be >= 2')
        data = from_args(a)
        ids = [identifier(x) for x in a.survivors.split(',') if x]
        if any(x not in data['ranking'] for x in ids): raise ValueError('survivor not in scored ranking')
        fresh = {}
        for item in a.fresh:
            aid, sep, kind = item.partition(':'); identifier(aid)
            if not sep or not kind.strip(): raise ValueError('--fresh requires ID:NEW-TYPE')
            if aid in fresh or aid in data['players']: raise ValueError('fresh ID must be new')
            fresh[aid] = kind
        if not ids and not fresh: raise ValueError('provide --survivors and/or --fresh')
        if len(set(ids + list(fresh))) != len(ids) + len(fresh): raise ValueError('duplicate player')
        aliases = {r['id']: r['dir'] for r in roster_agents(a.roster)} if a.roster else {}
        for directory in aliases.values(): agent_path(a.agent_root, directory)
        paths = {aid: agent_path(a.agent_root, aliases.get(aid, aid)) for aid in data['ranking'][:3]}
        for path in paths.values():
            if not path.is_dir(): raise ValueError(f'reference code path missing: {path}; use --roster / --agent-root')
        out = a.output_dir or ROOT / '.codex-task' / f'briefs-gen{a.generation}'
        template = Path(__file__).with_name('brief-template.md').read_text(encoding='utf-8')
        documents = {aid: generate(data, a.round, aid, template, paths, fresh.get(aid)) for aid in ids + list(fresh)}
        if any((out / f'{aid}.md').exists() for aid in documents): raise ValueError('brief exists; refusing overwrite')
        out.mkdir(parents=True, exist_ok=True)
        for aid, text in documents.items():
            with (out / f'{aid}.md').open('x', encoding='utf-8') as f: f.write(text)
            print(out / f'{aid}.md')
    except (OSError, ValueError) as e: p.error(str(e))


if __name__ == '__main__': main()

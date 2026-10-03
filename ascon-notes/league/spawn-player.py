#!/usr/bin/env python3
"""Create an isolated worktree for one league player and start its model in the background.

usage: spawn-player.py <family>-<n> <archetype> [--dry-run]
  family: astra (codex gpt-6-astra) | sonnet (claude-sonnet-5-5) | opus (claude opus alias) | grok
The player writes only inside .claude/worktrees/league-<id>. Deliverables are collected with
collect-player.sh. Logs: .codex-task/players/<id>.log
"""
import argparse, os, re, shutil, subprocess, sys, shlex
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCAFFOLD = HERE.parent.parent                      # the worktree this file lives in
MAIN = Path(subprocess.check_output(["git", "-C", str(SCAFFOLD), "rev-parse", "--git-common-dir"], text=True).strip())
MAIN = (SCAFFOLD / MAIN).resolve().parent if not MAIN.is_absolute() else MAIN.parent
BASE_BRANCH = "feat/ascon-beta"

ARCHETYPES = {
    "reversion": ("参照価格回帰型（multi-arb 改良）",
        "`example/agents/multi-arb/` を自分のディレクトリへコピーして出発し、**執行の質とコスト管理**で上回る。参照価格（`view.fair`）への引き戻し取引の閾値・サイズ・在庫帯・終盤停止を、レジーム（特に crash / spike / lending-incident）で壊れないよう磨く。手数料の積み増しは「追加の約定利益 − 追加ガス費」が正のときだけ。"),
    "specialist": ("新レジーム専門型（launch / cdp-incident / depeg-persist / spike）",
        "`example/agents/multi-arb/` を雛形に、通常時は multi-arb 相当で稼ぎつつ、**新しく加わったレジームの専門戦略**を足す。`ascon-notes/analysis-specialists.md` と `example/agents/{launch-sniper,launch-confirm,trove-manager,redemption-arb,sp-underwriter,peg-arb}` を読んで設計。launch は終了時の保有が 0 評価になるので、必ず売り切る。罠プール（資産を差し引くもの）を検査する。"),
    "defensive": ("守り型（最悪エポックを作らない）",
        "`example/agents/multi-arb/` を雛形に、**在庫を初期構成から傾けず、どのレジームでも平均を下回らない**ことを最優先にする。損失が出やすい局面（流動性の引き抜き・回復しない depeg・清算の連鎖）では取引を止める/縮小するガードを設計し、同点時の決め手（T の標準偏差・最悪 T）で勝つ。上振れを追いすぎない。"),
    "feebid": ("手数料入札型（順序を取る）",
        "ブロック内の順序は優先手数料のオークション。`ascon-notes/field-observation-2026-10-03.md` の通り、参照エージェントは **0.10 gwei 固定**で、外部の一部は 5 gwei を積んで先頭を取っている。`example/agents/multi-arb/` を雛形に、**入札額を機会ごとの期待利益から決める**（高く積むのは、追加ガス費を上回る約定利益が見込めるときだけ）設計にする。`ascon-notes/analysis-multi-arb.md` も参照。"),
    "blank": ("白紙型（独自設計）",
        "**`multi-arb` を雛形にしない。** `example/agents/lib/` と `runtime/` と SDK（`sdk/src/`）だけを使い、独自の発想で収益源を設計する（複数 venue の価格差・LST の償還差・CDP・Aave 清算・フラッシュローンなど、公開ドキュメント `docs/guide/protocols-and-actions.md` から選ぶ）。参照エージェントを読んで学ぶのは可だが、構造は真似しない。"),
    "alt-income": ("別の収益源型（LP / basis / LST carry / peg）",
        "裁定以外の収益源を主役にする。`example/agents/{lp-provider,lp-mint,basis-arb,lst-carry,peg-arb,levered-long}` を読んで設計。ただし**在庫の傾きによる損失を T で罰される**ので、相場全体の方向に賭けない。最低でも multi-arb 相当の裁定を併用してよい（自分のディレクトリへコピー）。"),
}

def brief(player_id, arch):
    tpl = (HERE / "brief-template.md").read_text(encoding="utf-8")
    title, detail = ARCHETYPES[arch]
    return (tpl.replace("{{PLAYER_ID}}", player_id).replace("{{ARCHETYPE}}", title).replace("{{ARCHETYPE_DETAIL}}", detail).replace("{{GENERATION_CONTEXT}}", ""))

def copy_previous(source, destination):
    if destination.exists():
        raise ValueError(f"agent destination exists; refusing overwrite: {destination}")
    if not (source / "agent.ts").is_file() or not (source / "prompt.md").is_file():
        raise ValueError(f"previous agent.ts/prompt.md missing: {source}")
    if source.is_symlink() or any(p.is_symlink() for p in source.rglob("*")):
        raise ValueError("previous agent directory contains symlinks")
    def ignore(_directory, names):
        return [name for name in names if name.startswith('.') or name == 'node_modules' or name.endswith('.log')]
    shutil.copytree(source, destination, ignore=ignore)


def validate_worktree(path):
    try:
        subprocess.check_output(['git', '-C', str(path), 'rev-parse', '--git-dir'], stderr=subprocess.DEVNULL)
        listed = subprocess.check_output(['git', '-C', str(MAIN), 'worktree', 'list', '--porcelain', '-z'])
        paths = [Path(field[9:].decode()).resolve() for field in listed.split(b'\0') if field.startswith(b'worktree ')]
        if path.resolve() not in paths: raise ValueError('not a registered worktree')
    except (OSError, subprocess.CalledProcessError, ValueError) as e:
        raise ValueError(f'--reuse requires a registered git worktree: {path}') from e


def check_started(child, logpath):
    try:
        rc = child.wait(timeout=0.3)
    except subprocess.TimeoutExpired:
        return
    raise ValueError(f'model exited immediately (exit {rc}); inspect log: {logpath}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("player_id"); ap.add_argument("archetype", nargs="?", default="blank", choices=sorted(ARCHETYPES))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--reuse", action="store_true", help="re-run into an existing worktree (after a failed first attempt)")
    ap.add_argument("--brief-file", type=Path)
    ap.add_argument("--from-worktree", type=Path, help="copy example/agents/<player_id> from previous worktree")
    ap.add_argument("--worktree", type=Path, help="new generation destination (default league-<id>)")
    a = ap.parse_args()
    m = re.fullmatch(r"(astra|sonnet|opus|grok)-(\d+)", a.player_id)
    if not m: sys.exit("player id must be <astra|sonnet|opus|grok>-<n>")
    family = m.group(1)
    wt = a.worktree.resolve() if a.worktree else MAIN / ".claude" / "worktrees" / f"league-{a.player_id}"
    if wt.exists() and not a.reuse: sys.exit(f"worktree already exists: {wt} (use --reuse to re-run into it)")
    if wt.exists():
        try: validate_worktree(wt)
        except ValueError as e: sys.exit(str(e))
    text = a.brief_file.read_text(encoding="utf-8") if a.brief_file else brief(a.player_id, a.archetype)
    source = a.from_worktree.resolve() / "example/agents" / a.player_id if a.from_worktree else None
    destination = wt / "example/agents" / a.player_id
    if source:
        if not (source / "agent.ts").is_file() or not (source / "prompt.md").is_file():
            sys.exit(f"previous agent.ts/prompt.md missing: {source}")
        if destination.exists(): sys.exit(f"agent destination exists; refusing overwrite: {destination}")
        text += "\n\n前世代のエージェントは自分のディレクトリにコピー済み。雛形で上書きせず、このコードから改良する。\n"
    if family in ("sonnet", "opus"):
        text += "\n\n## 読み方の注意\n大きなファイルは丸ごと読まず、`offset`/`limit` で必要な範囲だけ読む（文脈が溢れると作業が止まる）。参照エージェントは agent.ts の決定関数と定数部だけ読めば足りる。\n"
    logdir = SCAFFOLD / ".codex-task" / "players"
    cmds = {
        "astra": ["codex", "exec", "-C", str(wt), "-s", "workspace-write", "-c", "model=gpt-6-astra", "-c", "model_reasoning_effort=high", text],
        "sonnet": ["claude", "-p", text, "--model", "claude-sonnet-5-5[1m]", "--permission-mode", "acceptEdits",
                   "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Bash(npm run typecheck)", "Bash(npm run check:strategy)", "Bash(node --import tsx *)", "Bash(npx tsx *)", "Bash(ls *)"],
        "opus": ["claude", "-p", text, "--model", "opus", "--permission-mode", "acceptEdits",
                 "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Bash(npm run typecheck)", "Bash(npm run check:strategy)", "Bash(node --import tsx *)", "Bash(npx tsx *)", "Bash(ls *)"],
        "grok": ["grok", "-p", text, "--permission-mode", "acceptEdits", "--cwd", str(wt)],
    }
    cmd = cmds[family]
    if a.dry_run:
        print(f"worktree: {wt}\nbase: {BASE_BRANCH}\nfamily: {family}\nbrief chars: {len(text)}\ncmd: {cmd[0]} ... ({len(cmd)} args)")
        if source: print(f"copy: {source} -> {destination}")
        if a.brief_file: print(f"brief file: {a.brief_file}")
        return
    created = not wt.exists()
    if created:
        subprocess.check_call(["git", "-C", str(MAIN), "worktree", "add", str(wt), "-b", f"league/{wt.name if a.worktree else a.player_id}", BASE_BRANCH])
    if source:
        try: copy_previous(source, destination)
        except (OSError, ValueError) as e:
            if created:
                print(f'copy failed; newly created worktree remains at {wt}. No automatic deletion.', file=sys.stderr)
                print('After inspecting its contents, clean up with: ' + shlex.join(['git', '-C', str(MAIN), 'worktree', 'remove', str(wt)]), file=sys.stderr)
            sys.exit(str(e))
    # shared deps for typecheck (read-only use); players must not install
    for rel in ("node_modules", "dashboard/node_modules", "deployer/node_modules"):
        src = SCAFFOLD / rel
        if src.exists() and not (wt / rel).exists():
            (wt / rel).symlink_to(src)
    logdir.mkdir(parents=True, exist_ok=True)
    (wt / "BRIEF.md").write_text(text, encoding="utf-8")
    logpath = logdir / f"{wt.name if a.worktree else a.player_id}.log"
    with open(logpath, "w") as log:
        child = subprocess.Popen(cmd, cwd=str(wt), stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try: check_started(child, logpath)
    except ValueError as e: sys.exit(str(e))
    print(f"started {a.player_id} ({family}) in {wt}; log: {logpath}")

if __name__ == "__main__":
    main()

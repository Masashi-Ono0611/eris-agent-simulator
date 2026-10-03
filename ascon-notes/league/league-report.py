#!/usr/bin/env python3
"""Summarize league results and consistently exclude overloaded scenarios."""
import argparse, csv, json, math, re
from collections import Counter, defaultdict
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
def read(index):
    rows = list(csv.DictReader(index.open(newline="", encoding="utf-8"), delimiter="\t"))
    counts = Counter(r.get("run_dir", "") for r in rows if r.get("run_dir")); result=[]
    for row in rows:
        loc=Path(row.get("run_dir", "")); loc=loc if loc.is_absolute() else ROOT/loc
        reason="run_dir重複" if counts[row.get("run_dir", "")] > 1 else None
        if row.get("exit_code") != "0": reason=reason or "exit_code不正"
        try: s=json.loads((loc/"summary.json").read_text(encoding="utf-8"))
        except (OSError,ValueError,TypeError): s=None; reason=reason or "summary欠測/不正"
        if s is not None and not reason:
            if (s.get("valueSeries") or {}).get("failedReads") != 0: reason="failedReads不正/欠測"
            elif s.get("violations"): reason="violationsあり"
        agents={}
        if s is not None:
            try: agents={a["id"]:a for a in s["agents"]}
            except (KeyError,TypeError): reason=reason or "agents不正"
        result.append({"regime":row.get("regime",""),"seed":row.get("seed",""),"agents":agents,"loops":s.get("loopIterations") if s else None,"reason":reason})
    return result
def family(aid):
    m=re.match(r"^(.+)-\d+$",aid); return m.group(1) if m else aid
def render(records, minimum=360):
    low={(r["regime"],r["seed"]):r["loops"] for r in records if minimum>0 and isinstance(r["loops"],(int,float)) and r["loops"]<minimum}
    out=[f"負荷ガード: loopIterations < {minimum} を除外",f"除外シナリオ: {len(low)}"]
    out += [f"- {reg} / {seed}: loopIterations={loops}" for (reg,seed),loops in sorted(low.items())] or ["- なし"]
    out += [f"警告: loopIterations 欠落 {sum(r['loops'] is None for r in records)} 件（除外せず）",""]
    player=defaultdict(lambda:{"t":[],"regime":defaultdict(list),"tx":[]})
    for r in records:
        if (r["regime"],r["seed"]) in low or r["reason"]: continue
        agents=r["agents"]; values=[a.get("pnlUsdc") for a in agents.values() if not a.get("baseline") and isinstance(a.get("pnlUsdc"),(int,float))]
        if not values: continue
        mean=sum(values)/len(values); sd=math.sqrt(sum((x-mean)**2 for x in values)/len(values))
        for aid,a in agents.items():
            if a.get("baseline") or not isinstance(a.get("pnlUsdc"),(int,float)): continue
            t=50 if sd==0 else 50+10*(a["pnlUsdc"]-mean)/sd; x=player[aid]
            x["t"].append(t); x["regime"][r["regime"]].append(t)
            if isinstance(a.get("includedTxCount"),(int,float)): x["tx"].append(a["includedTxCount"])
    def fmt(xs): return f"{sum(xs)/len(xs):.1f}" if xs else "欠測"
    out += ["| プレイヤー | 平均 T | 最悪レジーム T | 取引数合計 | レジーム別平均 T |","|---|---:|---:|---:|---|"]
    for aid,x in sorted(player.items()):
        rt={k:sum(v)/len(v) for k,v in x["regime"].items()}
        out.append(f"| {aid} | {fmt(x['t'])} | {fmt([min(rt.values())] if rt else [])} | {sum(x['tx']) if x['tx'] else '欠測'} | "+", ".join(f"{k} {v:.1f}" for k,v in sorted(rt.items()))+" |")
    groups=defaultdict(list)
    for aid,x in player.items(): groups[family(aid)].extend(x["t"])
    out += ["","### 系統別平均","","| 系統 | 平均 T |","|---|---:|"]
    out += [f"| {fam} | {fmt(vals)} |" for fam,vals in sorted(groups.items())]
    return "\n".join(out)+"\n"
def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument("index_tsv",type=Path); p.add_argument("--min-loop-iterations",type=int,default=360); p.add_argument("-o","--output",type=Path); a=p.parse_args()
    result=render(read(a.index_tsv),a.min_loop_iterations)
    if a.output: a.output.write_text(result,encoding="utf-8")
    else: print(result,end="")
if __name__=="__main__": main()

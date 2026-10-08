import json,statistics as st,math
from pathlib import Path
def load(idx):
    out={}
    for l in Path(idx).read_text().splitlines():
        c,reg,seed,rd,ec=l.split("\t");s=json.loads((Path("/tmp/e12")/rd/"summary.json").read_text())
        P={a["id"]:a["pnlUsdc"] for a in s["agents"]};m=st.fmean(P.values());sd=st.pstdev(P.values())
        out[(reg,seed)]=({k:50+10*(v-m)/sd for k,v in P.items()},s["loopIterations"],P)
    return out
E5=load("e5-index.tsv");E6=load("e6-index.tsv");E7=load("e7-index.tsv")
cand={"E5":"ascon-zeta-r3a","E6":"ascon-zeta-r3","E7":"ascon-zeta-r3c"};D={"E5":E5,"E6":E6,"E7":E7}
assert set(E5)==set(E6)==set(E7)
def stat(x):
    n=len(x);m=st.fmean(x);se=st.stdev(x)/math.sqrt(n);return f"n={n} mean={m:+.2f} SE={se:.2f} (~95% {m-2*se:+.2f}..{m+2*se:+.2f}) wins={sum(v>0 for v in x)}/{n}"
keys=sorted(E5)
print("loops!=362:",{k:sum(1 for w in keys if D[k][w][1]!=362) for k in D})
for e in ("E5","E6","E7"):
    print(e,cand[e],"meanT=%.2f"%st.fmean(D[e][w][0][cand[e]] for w in keys),"inc-zeta meanT=%.2f"%st.fmean(D[e][w][0]["inc-zeta"] for w in keys),"noop=%.2f"%st.fmean(D[e][w][0]["noop"] for w in keys))
    print("  cand-incT:",stat([D[e][w][0][cand[e]]-D[e][w][0]["inc-zeta"] for w in keys]),"| cand-noopT:",stat([D[e][w][0][cand[e]]-D[e][w][0]["noop"] for w in keys]))
def pair(a,b,subset=None):
    ks=[w for w in keys if subset is None or all(D[x][w][1]==362 for x in subset)]
    return stat([D[a][w][0][cand[a]]-D[b][w][0][cand[b]] for w in ks]), stat([D[a][w][0]["inc-zeta"]-D[b][w][0]["inc-zeta"] for w in ks])
for a,b in (("E5","E6"),("E7","E6"),("E7","E5")):
    for sub in (None,[a,b]):
        r,c=pair(a,b,sub); print(f"{cand[a]} - {cand[b]} {'(loops==362 both)' if sub else '(all)'}: {r} | control inc-zeta seat across the two runs: {c}")

import json,statistics as st,math
from pathlib import Path
def load(idx):
    out={}
    for l in Path(idx).read_text().splitlines():
        c,reg,seed,rd,ec=l.split("\t");s=json.loads((Path("/tmp/e12")/rd/"summary.json").read_text())
        P={a["id"]:a["pnlUsdc"] for a in s["agents"]};m=st.fmean(P.values());sd=st.pstdev(P.values())
        out[(reg,seed)]=({k:50+10*(v-m)/sd for k,v in P.items()},s["loopIterations"],P)
    return out
E8=load("e8-index.tsv");E9=load("e9-index.tsv");assert set(E8)==set(E9)
keys=sorted(E8)
def stat(x):
    n=len(x);m=st.fmean(x);se=st.stdev(x)/math.sqrt(n);return f"n={n} mean={m:+.2f} SE={se:.2f} (~95% {m-2*se:+.2f}..{m+2*se:+.2f}) wins={sum(v>0 for v in x)}/{n}"
print("loops!=362: E8",sum(1 for w in keys if E8[w][1]!=362),"E9",sum(1 for w in keys if E9[w][1]!=362))
for n,D,c in (("E8 r3c",E8,"ascon-zeta-r3c"),("E9 r3",E9,"ascon-zeta-r3")):
    print(n,"meanT=%.2f"%st.fmean(D[w][0][c] for w in keys),"inc-zeta=%.2f"%st.fmean(D[w][0]["inc-zeta"] for w in keys),"noop=%.2f"%st.fmean(D[w][0]["noop"] for w in keys))
    print("  cand-inc:",stat([D[w][0][c]-D[w][0]["inc-zeta"] for w in keys]),"| cand-noop:",stat([D[w][0][c]-D[w][0]["noop"] for w in keys]))
for sub,name in ((keys,"all"),([w for w in keys if E8[w][1]==362 and E9[w][1]==362],"loops==362 both")):
    print(f"r3c-r3 ({name}):",stat([E8[w][0]["ascon-zeta-r3c"]-E9[w][0]["ascon-zeta-r3"] for w in sub]),"| control inc-zeta seat:",stat([E8[w][0]["inc-zeta"]-E9[w][0]["inc-zeta"] for w in sub]))
d=sorted(((E8[w][0]["ascon-zeta-r3c"]-E9[w][0]["ascon-zeta-r3"],w) for w in keys),reverse=True)
print("mean excluding top3:%.2f bottom3:%.2f"%(sum(x for x,_ in d[3:])/(len(d)-3),sum(x for x,_ in d[:-3])/(len(d)-3)),"top5",[(round(x,1),w[0]+"/"+w[1]) for x,w in d[:5]])

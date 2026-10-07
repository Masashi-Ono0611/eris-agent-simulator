import json,statistics as st,math
from pathlib import Path
def load(root,idx):
    out={}
    for l in Path(idx).read_text().splitlines():
        c,reg,seed,rd,ec=l.split("\t");s=json.loads((Path(root)/rd/"summary.json").read_text())
        P={a["id"]:a["pnlUsdc"] for a in s["agents"]};m=st.fmean(P.values());sd=st.pstdev(P.values())
        out[(reg,seed)]=({k:50+10*(v-m)/sd for k,v in P.items()},s["loopIterations"],P)
    return out
e1=load("/tmp/e12","e1-index.tsv");e2=load("/tmp/g3-chain/eval2","e2-index.tsv")
def cmp(label,keys):
    d=[e1[k][0]["ascon-zeta-r3"]-e2[k][0]["ascon-zeta-r"] for k in keys]
    n=len(d);m=st.fmean(d);se=st.stdev(d)/math.sqrt(n)
    # control: field-mate agent unchanged across hosts (venue-arb)
    c=[e1[k][0]["venue-arb"]-e2[k][0]["venue-arb"] for k in keys]
    print(f"{label}: n={n} r3(E1,mini)-r(E2,Air) T={m:.2f} SE={se:.2f} wins={sum(x>0 for x in d)}/{n} | control venue-arb mini-Air T={st.fmean(c):.2f}")
cmp("all",list(e1))
cmp("both G0-PASS",[k for k in e1 if e1[k][1]==362 and e2[k][1]==362])

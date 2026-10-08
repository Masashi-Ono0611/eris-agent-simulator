import json,statistics as st,math
from pathlib import Path
def load(idx):
    out={}
    for l in Path(idx).read_text().splitlines():
        c,reg,seed,rd,ec=l.split("\t");s=json.loads((Path("/tmp/e12")/rd/"summary.json").read_text())
        P={a["id"]:a["pnlUsdc"] for a in s["agents"]};ids=sorted(P);m=st.fmean(P.values());sd=st.pstdev(P.values())
        out[(reg,seed)]=({k:(50+10*(v-m)/sd if sd else 50.0) for k,v in P.items()},s["loopIterations"],P,s["agents"])
    return out
A=load("pb-index.tsv");B=load("e10-index.tsv");assert set(A)==set(B),(len(A),len(B))
keys=sorted(A)
def stat(x):
    n=len(x);m=st.fmean(x);se=st.stdev(x)/math.sqrt(n);return f"n={n} mean={m:+.2f} SE={se:.2f} (~95% {m-2*se:+.2f}..{m+2*se:+.2f}) wins={sum(v>0 for v in x)}/{n}"
ids=sorted(A[keys[0]][0]); print("agents:",ids)
for name,D,c in (("r3 (P60 rehearsal)",A,"ascon-zeta-r3"),("r3c (E10)",B,"ascon-zeta-r3c")):
    print(name,"meanT=%.2f"%st.fmean(D[w][0][c] for w in keys),"multi-arb=%.2f"%st.fmean(D[w][0]["multi-arb"] for w in keys),"clean-arb=%.2f"%st.fmean(D[w][0]["clean-arb"] for w in keys),"noop=%.2f"%st.fmean(D[w][0]["noop"] for w in keys))
    print("  P-noop mean=%.1f below-noop worlds=%d/60 loops!=362: %d"%(st.fmean(D[w][2][c]-D[w][2]["noop"] for w in keys),sum(1 for w in keys if D[w][2][c]<D[w][2]["noop"]),sum(1 for w in keys if D[w][1]!=362)))
print("r3c - r3 same worlds:",stat([B[w][0]["ascon-zeta-r3c"]-A[w][0]["ascon-zeta-r3"] for w in keys]))
print("control multi-arb seat across runs:",stat([B[w][0]["multi-arb"]-A[w][0]["multi-arb"] for w in keys]),"| clean-arb:",stat([B[w][0]["clean-arb"]-A[w][0]["clean-arb"] for w in keys]))
print("P diff r3c-r3 (USDC):",stat([B[w][2]["ascon-zeta-r3c"]-A[w][2]["ascon-zeta-r3"] for w in keys]))
d=sorted(((B[w][0]["ascon-zeta-r3c"]-A[w][0]["ascon-zeta-r3"],w) for w in keys),reverse=True)
print("excl top3 mean=%.2f excl bottom3 mean=%.2f"%(sum(x for x,_ in d[3:])/57,sum(x for x,_ in d[:-3])/57))
rv=lambda D,c: st.fmean(next(a for a in D[w][3] if a["id"]==c).get("revertCount",0) for w in keys)
print("revert/world r3=%.2f r3c=%.2f"%(rv(A,"ascon-zeta-r3"),rv(B,"ascon-zeta-r3c")))

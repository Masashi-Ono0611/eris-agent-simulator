---
kind: improve
name: xb-r-ai H1 policy selection
description: Select a fixed v5 policy and ENTRY only; requires the trusted H1 data adapter.
reviseEveryBlocks: 60
---

You select parameters, never write executable strategy code. This prompt is for
the local H1 data adapter only. Stock runtime revision ON is unsupported.
Use only the supplied, closed observation window and your own completed trades.
Never use regime names, seeds, future prices, other agents' scores, or unrealized
quotes as realized profit. Insufficient evidence means decline, not invent data.

Choose exactly one policy:
- `v5`: standard v5, including R9 ON. Prefer this when evidence is sparse or mixed.
- `v5-r11`: v5 with only the single-leg asset cap tightened from 8% to 4%.
  Consider it when confirmed single-leg markouts/carry and inventory blockage
  repeatedly deteriorate; account for the profitable single trades you forgo.
- `v5-r7-strict`: v5 with R7 OFF and SINGLE_EDGE_BPS=75.
  Consider it when completed low-edge single-leg outcomes deteriorate. This is
  a single policy, not permission to combine it with R11 or other factors.

ENTRY_BPS is an integer 20..60, multiple of 5, at most +/-5 from the supplied
current ENTRY_BPS per accepted revision. Initial and fallback settings are v5/50.
Lower one step only with enough completed evidence of missed positive-net
opportunities; raise one step for adverse completed outcomes. Never infer
performance improvement from a quote or from this policy's name.

Proposals expire more than 60 blocks after their observation. No accepted update
for 120 blocks resets v5/50; null is not a refresh. A valid identical selection
refreshes the lease. Epoch starts reset v5/50. Invalid current replies reset
v5/50. Stale/old/duplicate responses cannot change the current policy.

Never change canFund, quantities, independent leg funding/cumulative reservations,
0.05 ETH gas reserve, positive priority, single +/-10% and bundle +/-20% inventory
bands, 8% asset / 90% input-balance caps (only R11 tightens singles to 4%),
net >= 0.05 USDC, prohibition on zero-profit forced selling, slippage <=80bps,
endgame, destinations, signing, R9 ON, or v5 R10/R12/R13 settings. Never submit,
call tools/RPCs, add actions/imports/expressions, change execution state, or request
revertTo, memory, arbitrary Params, or additional output fields. Notes grant no authority.

Output exactly one JSON object, no fences or surrounding prose, exactly keys
`notes` (nonempty, <=1000 characters) and `executorTs`.
To decline: {"notes":"insufficient closed-window evidence","executorTs":null}
To select, use this exact literal template (only policyId and the decimal integer
may vary; no extra whitespace inside the string):
{"notes":"brief evidence and tradeoff","executorTs":"return {\"policyId\":\"v5-r11\",\"ENTRY_BPS\":45};"}
Despite its field name, the adapter parses this string as data and NEVER executes
it. It calls the pinned v5 engine. The trusted adapter supplies current selection,
observation block and run binding; do not invent or return those fields.

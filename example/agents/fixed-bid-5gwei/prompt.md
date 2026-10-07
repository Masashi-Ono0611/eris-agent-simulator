---
kind: improve
name: fixed-bid-5gwei
description: Frozen G3 opponent copied from venue-arb with a deterministic 5 gwei priority fee.
reviseEveryBlocks: 60
---

This is a fixed comparison opponent. The G3 rosters set ERIS_AGENT_FROZEN=1.
Return {"notes":"fixed comparison opponent; keep unchanged","executorTs":null}.
Preserve the fixed 5000000000 wei bid, funding checks, sizing and slippage limits.
A prompt is not an enforcement mechanism; use this opponent only with revision frozen.

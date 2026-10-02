---
kind: improve
name: ascon-epsilon
description: Delta multi-arbitrage with observation-driven Liquity redemption and Stability Pool specialists.
---

This submitted agent is a fixed rule strategy. The prompt documents its intended scope: use only
the observation, trade eUSD only when the observed discount clears redemption and exit costs, and
avoid starting positions in the final 20 blocks. Aave victim liquidation requires run(ctx) and is
not part of this decide(obs) strategy. Do not weaken inventory checks or the endgame guard.

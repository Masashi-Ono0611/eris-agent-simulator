# xa-1 dev7 second repair — 2026-10-04

Status: DONE_WITH_CONCERNS — local repair and bounded regressions verified; live re-smoke not run. This is repair 2. If the next smoke is unhealthy, retire xa-1 rather than attempt repair 3.

## Scope and evidence

- Requested baseline: `6cd9e70`. This task made no commits. Other work advanced league/v2 HEAD during the task; only the five files listed below belong to this repair.
- Read-only input: `upstream-eval/runs/2026-10-04T15-26-26-620Z/agents/cand.jsonl`, same-directory competitor logs, and `blocks.csv`. No upstream-eval writes, key/.env access, measurement launch, or full npm test.
- Fixture: `test/fixtures/xa-1-dev7.json`. `state.observed` in 6cd9e70 is the actual observation wallet, emitted only when changed. Carrying it forward is justified by `createLiveAgent`, not by a frozen internal ledger. Source line numbers and SHA256 are retained in the fixture.
- 725 log rows / 362 state decisions. 18 submitted, 1 submit_failed; 9 closed round trips. The submitted actions all mined successfully in the next block. Multi-arb has 265 submitted events but 263 included transactions; clean-arb has 30 of each. Submission counts are not inclusion counts.

## Facts: reconstruction of every submitted leg

Wallet columns are absolute post-inclusion values in token units (USDC 6 decimals, WETH/ETH 18, WBTC 8). The raw integer before/after/delta and inclusion evidence for every leg are in the fixture. Input/output need not equal an output quote: no minOut equality exists in the old settlement predicate. Actual executable minOut for successful submissions was not logged.

| Leg | Submit → observed/mined | Input → output | USDC after | WETH after | WBTC after | ETH after | ETH gas paid |
|---|---|---|---:|---:|---:|---:|---:|
| 1 | 1298 → 1299 | 1000 USDC → 0.332129559965785961 WETH | 24000 | 8.332129559965785961 | 0.4 | 0.99860501953 | 0.00004168547 |
| 2 | 1303 → 1304 | 0.332129559965785961 WETH → 1002.391628 USDC | 25002.391628 | 8 | 0.4 | 0.998576984782 | 0.000028034748 |
| 3 | 1327 → 1328 | 1000 USDC → 0.01656956 WBTC | 24002.391628 | 8 | 0.41656956 | 0.998535335272 | 0.00004164951 |
| 4 | 1328 → 1329 | 0.01656956 WBTC → 1003.592824 USDC | 25005.984452 | 8 | 0.4 | 0.998503701802 | 0.00003163347 |
| 5 | 1331 → 1332 | 1000 USDC → 0.0165484 WBTC | 24005.984452 | 8 | 0.4165484 | 0.998461908673 | 0.000041793129 |
| 6 | 1332 → 1333 | 0.0165484 WBTC → 1004.047149 USDC | 25010.031601 | 8 | 0.4 | 0.998430594733 | 0.00003131394 |
| 7 | 1333 → 1334 | 1000 USDC → 0.01652993 WBTC | 24010.031601 | 8 | 0.41652993 | 0.998394118047 | 0.000036476686 |
| 8 | 1334 → 1335 | 0.01652993 WBTC → 1003.236358 USDC | 25013.267959 | 8 | 0.4 | 0.998361961195 | 0.000032156852 |
| 9 | 1336 → 1337 | 1000 USDC → 0.01649976 WBTC | 24013.267959 | 8 | 0.41649976 | 0.998325915336 | 0.000036045859 |
| 10 | 1337 → 1338 | 0.01649976 WBTC → 1003.050043 USDC | 25016.318002 | 8 | 0.4 | 0.998296136728 | 0.000029778608 |
| 11 | 1338 → 1339 | 1000 USDC → 0.01652795 WBTC | 24016.318002 | 8 | 0.41652795 | 0.998259370264 | 0.000036766464 |
| 12 | 1339 → 1340 | 0.01652795 WBTC → 1006.443316 USDC | 25022.761318 | 8 | 0.4 | 0.998227547896 | 0.000031822368 |
| 13 | 1340 → 1341 | 1000 USDC → 0.01649964 WBTC | 24022.761318 | 8 | 0.41649964 | 0.998187047338 | 0.000040500558 |
| 14 | 1341 → 1342 | 0.01649964 WBTC → 1004.943302 USDC | 25027.70462 | 8 | 0.4 | 0.998159095258 | 0.00002795208 |
| 15 | 1343 → 1344 | 1000 USDC → 0.01646294 WBTC | 24027.70462 | 8 | 0.41646294 | 0.998117163766 | 0.000041931492 |
| 16 | 1344 → 1345 | 0.01646294 WBTC → 1003.920996 USDC | 25031.625616 | 8 | 0.4 | 0.998085775518 | 0.000031388248 |
| 17 | 1345 → 1346 | 1000 USDC → 0.01651176 WBTC | 24031.625616 | 8 | 0.41651176 | 0.998049011614 | 0.000036763904 |
| 18 | 1346 → 1347 | 0.01651176 WBTC → 1006.41893 USDC | 25038.044546 | 8 | 0.4 | 0.998018364994 | 0.00003064662 |

Initial observation at block 1285: USDC 25000; WETH 8; WBTC 0.4; ETH 0.998646705. First buy at 1298 therefore debited exactly 1000 USDC, credited 0.332129559965785961 WETH, and burned 0.000041685470 ETH at 1299. First exit at 1303 debited exactly that WETH quantity, credited 1002.391628 USDC, and burned 0.000028034748 ETH at 1304. WBTC never moved on the WETH cycle. WETH never moved on the eight WBTC cycles.

For all 18 legs, exact input debit, positive output, positive ETH debit, and unchanged other base satisfy the old predicate. ETH debit equals blocks.csv gasUsed × priorityFeeWei in every case. Observed latency is one block per leg, while the first round trip spans 1298–1304. No observed rounding mismatch, partial fill, or unrelated token movement caused dev7 to lock. Other agents move pool prices and thus execution/proceeds; that is not evidence that their trades directly changed this wallet.

## Facts: where it locks, and why it never leaves

- Block 1347: round trip 9 closes. USDC=25038044546, WETH=8000000000000000000, WBTC=40000000, ETH=998018364994000000 (raw units).
- Block 1374: proposes USDC 1000000000 → WETH. Runtime logs `submit_failed: Execution reverted with reason: Too little received`, attempted nonce 48. No hash/submitted event or corresponding cand inclusion follows.
- Blocks 1375–1381: seven `pending confirmation` decisions. All four balances remain exactly at the 1347 values. Delta=(0,0,0,0); neither entry debit/output nor paid gas exists, so this is correctly NOT a settled buy.
- Block 1382: the 8-block deadline moves pending to unresolved and writes a sticky `confirmation deadline; recovery only` halt. Blocks 1382–1645: 264 unresolved decisions; 1646 reaches valuation boundary. No later observed wallet change occurs.
- Direct root cause: `decide()` records a reservation before the runtime sends. Runtime errors do not feed back to this state machine. Repair 1 only renamed the wait at eight blocks and preserved its reservation forever. `reconcile()` could clear it only with an actual fill, which never occurred. It also previously left an ambiguity/timeout halt after a later valid fill.

Inference, separated from facts: the revert likely occurred during simulation/estimation without broadcasting. Runtime send.ts resets its nonce cache on send failure and comments that this failure path consumes no nonce. The log alone is not a proof of a drained mempool, so the repair does not treat the error string or an unchanged balance as permission to reuse funds.

Why both legs: this is a sequential exact-input buy and later sell, not a bundle. planEntry conservatively requires existing USDC, independent base collateral (at most 10% of initial allocation), and ceiling gas for both legs before admission. A one-lot lock implements the reservation globally. Actual sale is only the confirmed increment above the initial allocation; the collateral is not an order to sell initial inventory. This design is preserved.

## Repair

- Entry/exit debit tolerance: ±(floor(amountIn / 1,000,000) + 1) native token units. At 1000 USDC this is ±1001 units = ±0.001001 USDC. Positive proceeds and a positive native-ETH gas debit are still required. Other-base dust is limited to 1 WBTC unit or 1000 WETH wei. Non-exact cases require identical wallets in two consecutive distinct blocks. Larger/partial/unexplained changes remain reserved.
- Exact complete fills retain the immediate path. Split observations may converge over multiple blocks without making a permanent halt. Use actual input cost, output quantity and ETH gas; output is never forced to expectedQuantity/minOut. Confirmed late fills clear only confirmation-related halts, and close once. Initial-inventory deficits and other hard safety halts remain.
- At eight blocks, quarantine first. To release a no-token-fill attempt, read public transaction counts at sentBlock, the observation block, and pending, through ctx.publicClient. Require pending=confirmed, with either unchanged nonce and zero gas (not observed sent), or exactly one consumed nonce and positive gas (gas-only failure). Require exact unchanged token balances and three consecutive stable wallet/nonce observations. Missing, stale, malformed, advancing, or pending nonce evidence resets/retains quarantine. Rebuild from the observed wallet, emit a recovery event, return noop on that block, and only replan on the next block. A failed exit keeps its lot and accounts retry gas once in the eventual round-trip close.
- Trust boundary: this recovery check assumes the standard single serialized sender, one coherent RPC node, and an accurate pending nonce with no nonce gaps or second sender. Public balances/nonces are not a receipt or visibility into a still-running off-node send queue. An RPC node that hides pending transactions, delayed pre-broadcast work beyond the quarantine, reorgs, or a second sender require execution feedback/cancellation for a stronger guarantee. No live claim is made for those cases; they must not be treated as proven safe by the local fixture.
- Unchanged: canFund, native reserve, positive priority, competitor +0.1 gwei or skip, no profit=0 liquidation bypass, liquidity/slippage and loss envelope, initial allocation/lot separation, end-of-period priority, and sole AI authority ENTRY_BPS 20–60.

## Validation and exact restoration

- Before edits: 47/47 xa-1 tests passed. After repair: 59/59 (47 retained +12 added). Legacy late-recovery expectations now allow a fresh entry after an actually closed cycle; the old one-unit partial counterexample is moved outside the newly specified tolerance, with new tests for inside/outside boundaries and consecutive observations.
- `npm run typecheck`: PASS, rerun after all mutation controls restored the source.
- `node --import tsx --test --test-concurrency=1 test/xa-1.test.ts`: PASS. `node test/xa-1-red-controls.mjs`: 65/65 negative controls produce assertion failures, then the restored 59 tests pass.
- Includes exact historical `6cd9e70` red controls for dev7 failed-submit recovery and tolerant confirmation, plus the first-repair `7179efe` control. Tests use real dev7 wallets/actions/inclusion facts; market quotes and public nonce replies are explicitly synthetic. This is state-machine recovery coverage, not a historical strategy or performance replay.
- Restored agent SHA256: `b23ca5b61640198ca660e40a4f453e79b8ba7be86f09fd9510a2e80a6e3e085d`.
- Detailed red-control hashes and TAP logs: `/var/folders/yk/mx8jn78j6xq0w5l4z9d8hbvw0000gn/T/xa-1-red-controls-138ZCK`.
- Source hashes: cand.jsonl `c059dc20496307b7f193856047f59bec5401765cc58bde58edcdc2723d30f1e3`; blocks.csv `a45e284fc0b6fba5cf590c88a93a924c5d074e5b4b40c270119f95f49a8336a1`.

## Next smoke and remaining uncertainty

- Propose F_ref / calm / seed **38005**, 360 blocks / expected 362 loops, inference OFF. Not launched. All 30 discovered index.tsv seed columns under runs/ and ascon-notes/eval/out/ across main checkout, upstream-eval and league-v2 were audited. 38003/38004 are present, 38005 absent; 38001/38002 stay reserved for the main measurement. Paths, index hashes and seeds are in fixture.seedAudit. Absence is as of this audit, not a future reservation.
- Require G0 and submitted≥1, plus actual recovery health: no unexplained permanent quarantine when valid nonce evidence is available; delayed fills close once; recovered events are followed by admissible normal decisions without in-flight resells; all existing safety conditions still hold. Merely passing the submission gate is insufficient.
- Unverified: live devnet/RPC nonce reads and mempool behavior, Docker/selftest/bundle, full npm test, public 60-scenario backtest, performance, profitability, and qualification. No production/main measurement was run.
- **Second and final repair attempt: if this re-smoke does not pass, retire xa-1.**

Files: example/agents/xa-1/agent.ts; test/xa-1.test.ts; test/xa-1-red-controls.mjs; test/fixtures/xa-1-dev7.json; this note.

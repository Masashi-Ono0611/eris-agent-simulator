# ASCON round ledger

ハッシュは記録時点のファイル内容。実走開始時点の同一性は別途確認。

| ラウンド | UTC | commit | roster sha256 | レジーム / seed | 並列 | 除外 | 上位N平均 T | 順位の安定性 | 備考 |
|---|---|---|---|---|---:|---:|---:|---:|---|
| league-r1 | 2026-10-03T08:19:52.818611+00:00 | 9b7da50d6cc0dc68d258b64e69b1c1af1a0af727 | 7f822e2ea06f8f21cfdcd95cffb3fbdf64de835356ce47abc193dcb0054ec723 | calm,cdp-incident,cex-drift,crash,depeg,depeg-persist,informed-flow,launch,lending-incident,spike,vuln,whale / 201,202,203 | 3 | 0 | 53.10 | 100.0% | pilot round 1: 6 players + references + incumbent inc-zeta(zeta-a30); 12 regimes x seeds 201-203; frozen (no LLM revision) |

## Agent versions

league-r1: noop `4e2a2a1f089eb19bfe95325d9afe4ddc42e5eee9b06cf995f1ba48857aab26c5`; multi-arb `a705820dbe73accf51de795d125bc3ba7951cd31c996c6dcef2a0ba693894741`; clean-arb `5db25e9636e567c7ef6dd6bba34e4dc22652b10967a354a16cc90a6b995ebef9`; venue-arb `deb150caebfc27b3e15b8f6b579f5f6799185fe13117f20fc84f1fd00fad0e76`; inc-zeta `210b490fcb99b576ea0f72124351f478a4c16d06fe8bc7b733dba00daf297f8a`; astra-1 `32da8183ca0d24ee6bdd8b1c3b62f6eebdd56f6759baac53cb2157c938669f3b`; astra-2 `9eb7510d9b986c54ba096510a9f47b4bafc2ebd40610a449052c30f6dd8d3b6e`; sonnet-1 `bdacd6d40bd2a31d31186c17a663ec0d7b9de4fbb912121a40611512b07f738d`; sonnet-2 `cc7aaa36e0674085893bee850923bbc6bffda3aac8c8591d31a12d17ca1815ea`; opus-1 `78b8dc95436ca85300e693fcc539f214340c51fc8d68294720e637d9b399cd88`; grok-1 `0202a5b2645d5220d835a29005e48c3d290a2d376999d7a379e49ecf732244b3`

選抜バイアス: 順位の安定性は勝者の呪いの補正ではない。未使用 seed で要確認。

league-r1: top_n=3, top_k=3, bootstrap seed=1, 共通シナリオ=36
astra-1: 95% CI: -13.21 – -6.80
astra-2: 95% CI: -12.67 – -6.75
clean-arb: 95% CI: -10.67 – -4.03
grok-1: 95% CI: -9.46 – -2.55
inc-zeta: 縮退（再標本分散なし）: 0.00 – 0.00
multi-arb: 95% CI: -23.06 – -18.73
opus-1: 95% CI: -9.71 – -3.48
sonnet-1: 95% CI: -9.65 – -4.05
sonnet-2: 95% CI: -21.19 – -15.63
venue-arb: 95% CI: -13.89 – -6.50

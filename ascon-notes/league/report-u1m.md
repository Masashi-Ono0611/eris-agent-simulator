未検証（G0 BLOCKED）

採点契約: 全員有限P・同一ロスター・loopIterations=362。シナリオ全体を採用/除外。
追加の負荷ガード: loopIterations < 360 を除外
除外シナリオ: 0
- なし
警告: loopIterations 欠落 0 件（シナリオ全体を除外）
全理由の除外シナリオ: 0

全体・系統の平均 T はレジーム別平均の等重み平均（観測できたレジームのみ）
基準: inc-zeta。区間推定: レジーム内シナリオ bootstrap 10000 回 / RNG seed 1。
同一シナリオの全員を一緒に再標本化。順位は全競争者共通シナリオのみ。境界同点は確率を均等配分。
CI は観測済みレジーム・seed に条件付き。少数 seed / 未観測レジームへの一般化はできない。

| プレイヤー | 平均 T | 最悪レジーム T | レジーム別平均 T | 対数 | 基準との差 T [区間] |
|---|---:|---:|---|---:|---|
| astra-1 | 51.23 | 43.67 | calm 55.87, cdp-incident 47.06, cex-drift 48.98, crash 43.67, depeg 56.33, depeg-persist 55.27, informed-flow 53.39, launch 51.67, lending-incident 52.10, spike 50.73, vuln 55.23, whale 44.43 | 36 | -2.47 [95% CI: -6.34 – 1.47] |
| astra-2 | 51.14 | 43.04 | calm 55.40, cdp-incident 48.63, cex-drift 49.20, crash 43.04, depeg 56.19, depeg-persist 54.80, informed-flow 51.47, launch 51.68, lending-incident 51.86, spike 51.22, vuln 54.12, whale 46.04 | 36 | -2.57 [95% CI: -6.51 – 1.49] |
| clean-arb | 51.51 | 42.37 | calm 55.05, cdp-incident 46.79, cex-drift 47.63, crash 42.37, depeg 55.09, depeg-persist 53.82, informed-flow 50.96, launch 51.77, lending-incident 49.73, spike 48.61, vuln 54.38, whale 61.89 | 36 | -2.20 [95% CI: -5.94 – 1.51] |
| grok-1 | 53.52 | 47.25 | calm 55.49, cdp-incident 48.12, cex-drift 50.51, crash 47.25, depeg 58.22, depeg-persist 56.08, informed-flow 55.31, launch 51.98, lending-incident 55.46, spike 57.09, vuln 57.38, whale 49.36 | 36 | -0.18 [95% CI: -4.27 – 3.92] |
| inc-zeta | 53.70 | 45.03 | calm 45.03, cdp-incident 55.64, cex-drift 52.25, crash 58.82, depeg 50.86, depeg-persist 59.86, informed-flow 64.26, launch 46.12, lending-incident 51.10, spike 50.30, vuln 60.73, whale 49.45 | 36 | 0.00 [縮退（再標本分散なし）: 0.00 – 0.00] |
| multi-arb | 39.45 | 29.82 | calm 43.48, cdp-incident 51.30, cex-drift 39.14, crash 48.40, depeg 32.07, depeg-persist 29.82, informed-flow 38.02, launch 33.49, lending-incident 32.44, spike 36.40, vuln 31.06, whale 57.75 | 36 | -14.25 [95% CI: -18.97 – -9.40] |
| opus-1 | 54.33 | 45.15 | calm 53.95, cdp-incident 62.34, cex-drift 50.55, crash 47.75, depeg 59.60, depeg-persist 56.07, informed-flow 53.04, launch 62.23, lending-incident 51.47, spike 54.01, vuln 55.76, whale 45.15 | 36 | 0.63 [95% CI: -2.95 – 4.20] |
| sonnet-1 | 53.92 | 48.96 | calm 56.08, cdp-incident 53.66, cex-drift 50.78, crash 51.89, depeg 54.29, depeg-persist 53.94, informed-flow 55.13, launch 49.43, lending-incident 59.51, spike 58.49, vuln 54.94, whale 48.96 | 36 | 0.22 [95% CI: -3.72 – 4.26] |
| sonnet-2 | 46.30 | 39.67 | calm 44.90, cdp-incident 55.74, cex-drift 46.49, crash 49.54, depeg 39.67, depeg-persist 43.51, informed-flow 43.17, launch 41.50, lending-incident 50.61, spike 43.67, vuln 45.30, whale 51.51 | 36 | -7.40 [95% CI: -11.81 – -3.14] |
| venue-arb | 54.48 | 47.15 | calm 55.56, cdp-incident 51.56, cex-drift 73.70, crash 57.24, depeg 52.48, depeg-persist 51.21, informed-flow 51.38, launch 53.12, lending-incident 47.15, spike 61.14, vuln 49.46, whale 49.79 | 36 | 0.78 [95% CI: -2.49 – 4.12] |
| zeta-2 | 40.42 | 29.17 | calm 29.20, cdp-incident 29.17, cex-drift 40.76, crash 60.03, depeg 35.19, depeg-persist 35.61, informed-flow 33.87, launch 57.01, lending-incident 48.57, spike 38.33, vuln 31.64, whale 45.66 | 36 | -13.28 [95% CI: -17.81 – -8.80] |

### シナリオ対応差

| プレイヤー | レジーム | seed | ΔT |
|---|---|---|---:|
| astra-1 | calm | 201 | 3.32 |
| astra-1 | calm | 202 | 24.42 |
| astra-1 | calm | 203 | 4.76 |
| astra-1 | cdp-incident | 201 | 2.66 |
| astra-1 | cdp-incident | 202 | -21.67 |
| astra-1 | cdp-incident | 203 | -6.72 |
| astra-1 | cex-drift | 201 | -21.28 |
| astra-1 | cex-drift | 202 | 13.77 |
| astra-1 | cex-drift | 203 | -2.29 |
| astra-1 | crash | 201 | -21.61 |
| astra-1 | crash | 202 | 5.06 |
| astra-1 | crash | 203 | -28.89 |
| astra-1 | depeg | 201 | 1.99 |
| astra-1 | depeg | 202 | 14.67 |
| astra-1 | depeg | 203 | -0.26 |
| astra-1 | depeg-persist | 201 | -7.85 |
| astra-1 | depeg-persist | 202 | 1.40 |
| astra-1 | depeg-persist | 203 | -7.31 |
| astra-1 | informed-flow | 201 | -26.65 |
| astra-1 | informed-flow | 202 | -0.57 |
| astra-1 | informed-flow | 203 | -5.40 |
| astra-1 | launch | 201 | -3.79 |
| astra-1 | launch | 202 | 9.87 |
| astra-1 | launch | 203 | 10.57 |
| astra-1 | lending-incident | 201 | -4.56 |
| astra-1 | lending-incident | 202 | 23.29 |
| astra-1 | lending-incident | 203 | -15.75 |
| astra-1 | spike | 201 | -15.25 |
| astra-1 | spike | 202 | 2.79 |
| astra-1 | spike | 203 | 13.76 |
| astra-1 | vuln | 201 | -4.30 |
| astra-1 | vuln | 202 | -4.89 |
| astra-1 | vuln | 203 | -7.32 |
| astra-1 | whale | 201 | 20.52 |
| astra-1 | whale | 202 | -31.99 |
| astra-1 | whale | 203 | -3.56 |
| astra-2 | calm | 201 | 3.28 |
| astra-2 | calm | 202 | 23.46 |
| astra-2 | calm | 203 | 4.37 |
| astra-2 | cdp-incident | 201 | 4.59 |
| astra-2 | cdp-incident | 202 | -18.24 |
| astra-2 | cdp-incident | 203 | -7.37 |
| astra-2 | cex-drift | 201 | -14.98 |
| astra-2 | cex-drift | 202 | 12.71 |
| astra-2 | cex-drift | 203 | -6.87 |
| astra-2 | crash | 201 | -23.26 |
| astra-2 | crash | 202 | 4.37 |
| astra-2 | crash | 203 | -28.44 |
| astra-2 | depeg | 201 | 1.54 |
| astra-2 | depeg | 202 | 14.69 |
| astra-2 | depeg | 203 | -0.24 |
| astra-2 | depeg-persist | 201 | -8.69 |
| astra-2 | depeg-persist | 202 | 0.76 |
| astra-2 | depeg-persist | 203 | -7.25 |
| astra-2 | informed-flow | 201 | -27.30 |
| astra-2 | informed-flow | 202 | 1.00 |
| astra-2 | informed-flow | 203 | -12.09 |
| astra-2 | launch | 201 | -4.29 |
| astra-2 | launch | 202 | 9.94 |
| astra-2 | launch | 203 | 11.01 |
| astra-2 | lending-incident | 201 | -5.35 |
| astra-2 | lending-incident | 202 | 24.22 |
| astra-2 | lending-incident | 203 | -16.60 |
| astra-2 | spike | 201 | -19.72 |
| astra-2 | spike | 202 | 4.55 |
| astra-2 | spike | 203 | 17.94 |
| astra-2 | vuln | 201 | -7.83 |
| astra-2 | vuln | 202 | -4.36 |
| astra-2 | vuln | 203 | -7.66 |
| astra-2 | whale | 201 | 23.53 |
| astra-2 | whale | 202 | -31.93 |
| astra-2 | whale | 203 | -1.83 |
| clean-arb | calm | 201 | 3.36 |
| clean-arb | calm | 202 | 25.83 |
| clean-arb | calm | 203 | 0.86 |
| clean-arb | cdp-incident | 201 | 1.72 |
| clean-arb | cdp-incident | 202 | -21.43 |
| clean-arb | cdp-incident | 203 | -6.83 |
| clean-arb | cex-drift | 201 | -24.48 |
| clean-arb | cex-drift | 202 | 12.24 |
| clean-arb | cex-drift | 203 | -1.64 |
| clean-arb | crash | 201 | -22.47 |
| clean-arb | crash | 202 | 2.66 |
| clean-arb | crash | 203 | -29.52 |
| clean-arb | depeg | 201 | 2.42 |
| clean-arb | depeg | 202 | 10.05 |
| clean-arb | depeg | 203 | 0.22 |
| clean-arb | depeg-persist | 201 | -12.25 |
| clean-arb | depeg-persist | 202 | 1.57 |
| clean-arb | depeg-persist | 203 | -7.45 |
| clean-arb | informed-flow | 201 | -28.53 |
| clean-arb | informed-flow | 202 | 0.56 |
| clean-arb | informed-flow | 203 | -11.96 |
| clean-arb | launch | 201 | -3.82 |
| clean-arb | launch | 202 | 10.21 |
| clean-arb | launch | 203 | 10.56 |
| clean-arb | lending-incident | 201 | -5.11 |
| clean-arb | lending-incident | 202 | 19.80 |
| clean-arb | lending-incident | 203 | -18.82 |
| clean-arb | spike | 201 | -14.00 |
| clean-arb | spike | 202 | 1.57 |
| clean-arb | spike | 203 | 7.36 |
| clean-arb | vuln | 201 | -5.29 |
| clean-arb | vuln | 202 | -6.45 |
| clean-arb | vuln | 203 | -7.31 |
| clean-arb | whale | 201 | 20.79 |
| clean-arb | whale | 202 | -13.66 |
| clean-arb | whale | 203 | 30.21 |
| grok-1 | calm | 201 | 3.26 |
| grok-1 | calm | 202 | 24.53 |
| grok-1 | calm | 203 | 3.59 |
| grok-1 | cdp-incident | 201 | 2.22 |
| grok-1 | cdp-incident | 202 | -20.22 |
| grok-1 | cdp-incident | 203 | -4.55 |
| grok-1 | cex-drift | 201 | -20.03 |
| grok-1 | cex-drift | 202 | 14.46 |
| grok-1 | cex-drift | 203 | 0.36 |
| grok-1 | crash | 201 | -21.53 |
| grok-1 | crash | 202 | 13.42 |
| grok-1 | crash | 203 | -26.58 |
| grok-1 | depeg | 201 | 3.87 |
| grok-1 | depeg | 202 | 15.32 |
| grok-1 | depeg | 203 | 2.88 |
| grok-1 | depeg-persist | 201 | -8.87 |
| grok-1 | depeg-persist | 202 | 4.18 |
| grok-1 | depeg-persist | 203 | -6.65 |
| grok-1 | informed-flow | 201 | -24.87 |
| grok-1 | informed-flow | 202 | 0.41 |
| grok-1 | informed-flow | 203 | -2.38 |
| grok-1 | launch | 201 | -3.09 |
| grok-1 | launch | 202 | 10.13 |
| grok-1 | launch | 203 | 10.55 |
| grok-1 | lending-incident | 201 | 0.31 |
| grok-1 | lending-incident | 202 | 28.35 |
| grok-1 | lending-incident | 203 | -15.57 |
| grok-1 | spike | 201 | -11.10 |
| grok-1 | spike | 202 | 9.01 |
| grok-1 | spike | 203 | 22.47 |
| grok-1 | vuln | 201 | 1.23 |
| grok-1 | vuln | 202 | -3.30 |
| grok-1 | vuln | 203 | -7.98 |
| grok-1 | whale | 201 | 20.24 |
| grok-1 | whale | 202 | -28.24 |
| grok-1 | whale | 203 | 7.75 |
| inc-zeta | calm | 201 | 0.00 |
| inc-zeta | calm | 202 | 0.00 |
| inc-zeta | calm | 203 | 0.00 |
| inc-zeta | cdp-incident | 201 | 0.00 |
| inc-zeta | cdp-incident | 202 | 0.00 |
| inc-zeta | cdp-incident | 203 | 0.00 |
| inc-zeta | cex-drift | 201 | 0.00 |
| inc-zeta | cex-drift | 202 | 0.00 |
| inc-zeta | cex-drift | 203 | 0.00 |
| inc-zeta | crash | 201 | 0.00 |
| inc-zeta | crash | 202 | 0.00 |
| inc-zeta | crash | 203 | 0.00 |
| inc-zeta | depeg | 201 | 0.00 |
| inc-zeta | depeg | 202 | 0.00 |
| inc-zeta | depeg | 203 | 0.00 |
| inc-zeta | depeg-persist | 201 | 0.00 |
| inc-zeta | depeg-persist | 202 | 0.00 |
| inc-zeta | depeg-persist | 203 | 0.00 |
| inc-zeta | informed-flow | 201 | 0.00 |
| inc-zeta | informed-flow | 202 | 0.00 |
| inc-zeta | informed-flow | 203 | 0.00 |
| inc-zeta | launch | 201 | 0.00 |
| inc-zeta | launch | 202 | 0.00 |
| inc-zeta | launch | 203 | 0.00 |
| inc-zeta | lending-incident | 201 | 0.00 |
| inc-zeta | lending-incident | 202 | 0.00 |
| inc-zeta | lending-incident | 203 | 0.00 |
| inc-zeta | spike | 201 | 0.00 |
| inc-zeta | spike | 202 | 0.00 |
| inc-zeta | spike | 203 | 0.00 |
| inc-zeta | vuln | 201 | 0.00 |
| inc-zeta | vuln | 202 | 0.00 |
| inc-zeta | vuln | 203 | 0.00 |
| inc-zeta | whale | 201 | 0.00 |
| inc-zeta | whale | 202 | 0.00 |
| inc-zeta | whale | 203 | 0.00 |
| multi-arb | calm | 201 | -19.48 |
| multi-arb | calm | 202 | 33.33 |
| multi-arb | calm | 203 | -18.50 |
| multi-arb | cdp-incident | 201 | 7.64 |
| multi-arb | cdp-incident | 202 | -20.75 |
| multi-arb | cdp-incident | 203 | 0.11 |
| multi-arb | cex-drift | 201 | -26.33 |
| multi-arb | cex-drift | 202 | 13.43 |
| multi-arb | cex-drift | 203 | -26.44 |
| multi-arb | crash | 201 | 0.87 |
| multi-arb | crash | 202 | -19.34 |
| multi-arb | crash | 203 | -12.79 |
| multi-arb | depeg | 201 | -25.17 |
| multi-arb | depeg | 202 | -14.18 |
| multi-arb | depeg | 203 | -17.03 |
| multi-arb | depeg-persist | 201 | -39.66 |
| multi-arb | depeg-persist | 202 | -20.32 |
| multi-arb | depeg-persist | 203 | -30.17 |
| multi-arb | informed-flow | 201 | -17.53 |
| multi-arb | informed-flow | 202 | -24.39 |
| multi-arb | informed-flow | 203 | -36.80 |
| multi-arb | launch | 201 | -26.01 |
| multi-arb | launch | 202 | -15.87 |
| multi-arb | launch | 203 | 3.99 |
| multi-arb | lending-incident | 201 | -26.59 |
| multi-arb | lending-incident | 202 | 3.26 |
| multi-arb | lending-incident | 203 | -32.67 |
| multi-arb | spike | 201 | -33.39 |
| multi-arb | spike | 202 | 2.59 |
| multi-arb | spike | 203 | -10.90 |
| multi-arb | vuln | 201 | -29.67 |
| multi-arb | vuln | 202 | -30.20 |
| multi-arb | vuln | 203 | -29.15 |
| multi-arb | whale | 201 | 39.27 |
| multi-arb | whale | 202 | -24.14 |
| multi-arb | whale | 203 | 9.80 |
| opus-1 | calm | 201 | 1.70 |
| opus-1 | calm | 202 | 20.79 |
| opus-1 | calm | 203 | 4.25 |
| opus-1 | cdp-incident | 201 | 6.88 |
| opus-1 | cdp-incident | 202 | 4.39 |
| opus-1 | cdp-incident | 203 | 8.86 |
| opus-1 | cex-drift | 201 | -21.05 |
| opus-1 | cex-drift | 202 | 14.69 |
| opus-1 | cex-drift | 203 | 1.27 |
| opus-1 | crash | 201 | -16.04 |
| opus-1 | crash | 202 | 7.19 |
| opus-1 | crash | 203 | -24.35 |
| opus-1 | depeg | 201 | 3.87 |
| opus-1 | depeg | 202 | 17.91 |
| opus-1 | depeg | 203 | 4.42 |
| opus-1 | depeg-persist | 201 | -7.17 |
| opus-1 | depeg-persist | 202 | 1.84 |
| opus-1 | depeg-persist | 203 | -6.04 |
| opus-1 | informed-flow | 201 | -24.37 |
| opus-1 | informed-flow | 202 | -0.12 |
| opus-1 | informed-flow | 203 | -9.19 |
| opus-1 | launch | 201 | 5.30 |
| opus-1 | launch | 202 | 11.11 |
| opus-1 | launch | 203 | 31.90 |
| opus-1 | lending-incident | 201 | -0.52 |
| opus-1 | lending-incident | 202 | 17.31 |
| opus-1 | lending-incident | 203 | -15.69 |
| opus-1 | spike | 201 | -10.55 |
| opus-1 | spike | 202 | 7.83 |
| opus-1 | spike | 203 | 13.86 |
| opus-1 | vuln | 201 | -3.22 |
| opus-1 | vuln | 202 | -3.47 |
| opus-1 | vuln | 203 | -8.21 |
| opus-1 | whale | 201 | 19.18 |
| opus-1 | whale | 202 | -29.46 |
| opus-1 | whale | 203 | -2.60 |
| sonnet-1 | calm | 201 | 0.60 |
| sonnet-1 | calm | 202 | 29.22 |
| sonnet-1 | calm | 203 | 3.32 |
| sonnet-1 | cdp-incident | 201 | 4.73 |
| sonnet-1 | cdp-incident | 202 | -13.22 |
| sonnet-1 | cdp-incident | 203 | 2.56 |
| sonnet-1 | cex-drift | 201 | -18.67 |
| sonnet-1 | cex-drift | 202 | 16.69 |
| sonnet-1 | cex-drift | 203 | -2.41 |
| sonnet-1 | crash | 201 | -13.09 |
| sonnet-1 | crash | 202 | 16.12 |
| sonnet-1 | crash | 203 | -23.83 |
| sonnet-1 | depeg | 201 | 1.26 |
| sonnet-1 | depeg | 202 | 9.92 |
| sonnet-1 | depeg | 203 | -0.92 |
| sonnet-1 | depeg-persist | 201 | -8.30 |
| sonnet-1 | depeg-persist | 202 | -1.57 |
| sonnet-1 | depeg-persist | 203 | -7.89 |
| sonnet-1 | informed-flow | 201 | -21.89 |
| sonnet-1 | informed-flow | 202 | 3.11 |
| sonnet-1 | informed-flow | 203 | -8.61 |
| sonnet-1 | launch | 201 | -6.94 |
| sonnet-1 | launch | 202 | 6.79 |
| sonnet-1 | launch | 203 | 10.07 |
| sonnet-1 | lending-incident | 201 | 8.51 |
| sonnet-1 | lending-incident | 202 | 33.40 |
| sonnet-1 | lending-incident | 203 | -16.70 |
| sonnet-1 | spike | 201 | -8.92 |
| sonnet-1 | spike | 202 | 14.26 |
| sonnet-1 | spike | 203 | 19.22 |
| sonnet-1 | vuln | 201 | -5.22 |
| sonnet-1 | vuln | 202 | -2.26 |
| sonnet-1 | vuln | 203 | -9.90 |
| sonnet-1 | whale | 201 | 21.84 |
| sonnet-1 | whale | 202 | -21.51 |
| sonnet-1 | whale | 203 | -1.79 |
| sonnet-2 | calm | 201 | -9.79 |
| sonnet-2 | calm | 202 | 22.05 |
| sonnet-2 | calm | 203 | -12.65 |
| sonnet-2 | cdp-incident | 201 | 2.10 |
| sonnet-2 | cdp-incident | 202 | 4.68 |
| sonnet-2 | cdp-incident | 203 | -6.49 |
| sonnet-2 | cex-drift | 201 | -20.89 |
| sonnet-2 | cex-drift | 202 | 9.75 |
| sonnet-2 | cex-drift | 203 | -6.14 |
| sonnet-2 | crash | 201 | 2.18 |
| sonnet-2 | crash | 202 | -9.00 |
| sonnet-2 | crash | 203 | -21.01 |
| sonnet-2 | depeg | 201 | -12.39 |
| sonnet-2 | depeg | 202 | -0.74 |
| sonnet-2 | depeg | 203 | -20.46 |
| sonnet-2 | depeg-persist | 201 | -12.24 |
| sonnet-2 | depeg-persist | 202 | -6.76 |
| sonnet-2 | depeg-persist | 203 | -30.06 |
| sonnet-2 | informed-flow | 201 | -31.14 |
| sonnet-2 | informed-flow | 202 | -19.19 |
| sonnet-2 | informed-flow | 203 | -12.94 |
| sonnet-2 | launch | 201 | -14.39 |
| sonnet-2 | launch | 202 | -1.59 |
| sonnet-2 | launch | 203 | 2.13 |
| sonnet-2 | lending-incident | 201 | 8.51 |
| sonnet-2 | lending-incident | 202 | 24.16 |
| sonnet-2 | lending-incident | 203 | -34.15 |
| sonnet-2 | spike | 201 | -7.72 |
| sonnet-2 | spike | 202 | -20.83 |
| sonnet-2 | spike | 203 | 8.65 |
| sonnet-2 | vuln | 201 | -4.41 |
| sonnet-2 | vuln | 202 | -18.54 |
| sonnet-2 | vuln | 203 | -23.35 |
| sonnet-2 | whale | 201 | 32.40 |
| sonnet-2 | whale | 202 | -26.82 |
| sonnet-2 | whale | 203 | 0.62 |
| venue-arb | calm | 201 | 7.87 |
| venue-arb | calm | 202 | 20.60 |
| venue-arb | calm | 203 | 3.09 |
| venue-arb | cdp-incident | 201 | 5.42 |
| venue-arb | cdp-incident | 202 | -17.20 |
| venue-arb | cdp-incident | 203 | -0.46 |
| venue-arb | cex-drift | 201 | 6.80 |
| venue-arb | cex-drift | 202 | 40.96 |
| venue-arb | cex-drift | 203 | 16.60 |
| venue-arb | crash | 201 | -10.70 |
| venue-arb | crash | 202 | 10.93 |
| venue-arb | crash | 203 | -4.98 |
| venue-arb | depeg | 201 | 11.83 |
| venue-arb | depeg | 202 | 5.56 |
| venue-arb | depeg | 203 | -12.54 |
| venue-arb | depeg-persist | 201 | -10.83 |
| venue-arb | depeg-persist | 202 | 4.56 |
| venue-arb | depeg-persist | 203 | -19.70 |
| venue-arb | informed-flow | 201 | -21.50 |
| venue-arb | informed-flow | 202 | -8.15 |
| venue-arb | informed-flow | 203 | -9.00 |
| venue-arb | launch | 201 | -3.12 |
| venue-arb | launch | 202 | 14.11 |
| venue-arb | launch | 203 | 10.03 |
| venue-arb | lending-incident | 201 | -18.78 |
| venue-arb | lending-incident | 202 | 9.38 |
| venue-arb | lending-incident | 203 | -2.47 |
| venue-arb | spike | 201 | 5.09 |
| venue-arb | spike | 202 | 17.32 |
| venue-arb | spike | 203 | 10.10 |
| venue-arb | vuln | 201 | -2.15 |
| venue-arb | vuln | 202 | -15.54 |
| venue-arb | vuln | 203 | -16.12 |
| venue-arb | whale | 201 | 21.83 |
| venue-arb | whale | 202 | -20.60 |
| venue-arb | whale | 203 | -0.19 |
| zeta-2 | calm | 201 | -24.49 |
| zeta-2 | calm | 202 | 1.32 |
| zeta-2 | calm | 203 | -24.34 |
| zeta-2 | cdp-incident | 201 | -30.13 |
| zeta-2 | cdp-incident | 202 | -16.62 |
| zeta-2 | cdp-incident | 203 | -32.66 |
| zeta-2 | cex-drift | 201 | -23.05 |
| zeta-2 | cex-drift | 202 | 1.88 |
| zeta-2 | cex-drift | 203 | -13.30 |
| zeta-2 | crash | 201 | 0.43 |
| zeta-2 | crash | 202 | 12.57 |
| zeta-2 | crash | 203 | -9.36 |
| zeta-2 | depeg | 201 | -13.54 |
| zeta-2 | depeg | 202 | -8.14 |
| zeta-2 | depeg | 203 | -25.32 |
| zeta-2 | depeg-persist | 201 | -22.90 |
| zeta-2 | depeg-persist | 202 | -27.40 |
| zeta-2 | depeg-persist | 203 | -22.46 |
| zeta-2 | informed-flow | 201 | -43.55 |
| zeta-2 | informed-flow | 202 | -22.38 |
| zeta-2 | informed-flow | 203 | -25.26 |
| zeta-2 | launch | 201 | 15.86 |
| zeta-2 | launch | 202 | -14.79 |
| zeta-2 | launch | 203 | 31.59 |
| zeta-2 | lending-incident | 201 | -7.57 |
| zeta-2 | lending-incident | 202 | 24.35 |
| zeta-2 | lending-incident | 203 | -24.37 |
| zeta-2 | spike | 201 | -22.21 |
| zeta-2 | spike | 202 | -8.29 |
| zeta-2 | spike | 203 | -5.40 |
| zeta-2 | vuln | 201 | -27.55 |
| zeta-2 | vuln | 202 | -26.53 |
| zeta-2 | vuln | 203 | -33.18 |
| zeta-2 | whale | 201 | 36.51 |
| zeta-2 | whale | 202 | -38.76 |
| zeta-2 | whale | 203 | -9.11 |

### 順位安定性（共通 36 シナリオ / 12 レジーム）

| プレイヤー | 共通平均 T | 上位 3 確率 | 1 位確率 |
|---|---:|---:|---:|
| opus-1 | 54.33 | 100.0% | 68.7% |
| sonnet-1 | 53.92 | 100.0% | 23.5% |
| grok-1 | 53.52 | 100.0% | 7.8% |
| astra-1 | 51.23 | 0.0% | 0.0% |
| astra-2 | 51.14 | 0.0% | 0.0% |
| sonnet-2 | 46.30 | 0.0% | 0.0% |
| zeta-2 | 40.42 | 0.0% | 0.0% |

順位の安定性: 上位 3 枠維持確率=100.0%。
勝者の呪い（選抜バイアス）: 上位 3 体の平均 T=53.92。順位の安定性は選抜バイアスの補正ではない。未使用 seed で要確認。

### 存続・脱落（機械的な推奨であり決定ではない）
既知の参照は選抜対象外（--players で明示可能）。下位半分を候補とし、各系統の最高位を最低 1 体残す。
存続推奨: opus-1, sonnet-1, grok-1, astra-1, zeta-2
脱落候補: astra-2, sonnet-2

### 行動指標（採用シナリオの合計）

| プレイヤー | 約定/包含数 | リバート数 | 送信失敗数 | 優先手数料 wei |
|---|---:|---:|---:|---:|
| astra-1 | 277 | 165 | 199 | 2865104100000000 |
| astra-2 | 684 | 202 | 412 | 7503876800000000 |
| clean-arb | 724 | 73 | 48 | 7823442400000000 |
| grok-1 | 2359 | 2 | 76 | 496970459000000000 |
| inc-zeta | 5254 | 7 | 497 | 1370417220071301872 |
| multi-arb | 5155 | 401 | 356 | 58549116500000000 |
| opus-1 | 4064 | 699 | 960 | 101777853100000000 |
| sonnet-1 | 697 | 26 | 142 | 84384197840871723 |
| sonnet-2 | 3669 | 269 | 601 | 335733908353444490 |
| venue-arb | 11579 | 280 | 402 | 133667009400000000 |
| zeta-2 | 4975 | 239 | 756 | 593290729958490248 |
包含数は summary.includedTxCount（成功した売買だけの件数ではない）。リバートは summary.revertCount、送信失敗は runtime submit_failed。
優先手数料は local backtest の base fee=0 を前提に blocks.csv の gasUsed × min(tip, cap) を合計（リバート含む）。欠測時は取得不能。

### 系統別平均

| 系統 | 平均 T |
|---|---:|
| astra | 51.18 |
| clean-arb | 51.51 |
| grok | 53.52 |
| inc-zeta | 53.70 |
| multi-arb | 39.45 |
| opus | 54.33 |
| sonnet | 50.11 |
| venue-arb | 54.48 |
| zeta | 40.42 |

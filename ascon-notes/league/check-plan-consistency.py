#!/usr/bin/env python3
"""Static revision-12 plan/dashboard checks. Never reads run data or network."""

from datetime import date, timedelta
from fractions import Fraction
from pathlib import Path
import json
import hashlib
import copy
import re
import sys


QUEUE = ["dev1-evidence", "q0b-evidence", "q0-requal", "mix-design", "first-mix", "q0m",
         "first-p60", "first-g3", "ai-implementation", "ai-d-control", "factor-ab", "m2"]
DECISION_IDS = ["dec-ai-scope", "dec-ai-contract", "dec-ai-budget", "dec-q0-failure-branch", "dec-q0b-g0", "dec-revert-limit"]
ORIGIN = "本人が 2026-10-04 に Astra へ判断を委任。Astra が決定"
SIGNER = "本人委任のAstra決定"
FINDINGS = ([f"C{i}" for i in range(1, 6)] + [f"W{i}" for i in range(6, 14)] +
            [f"S{i}" for i in range(14, 19)])

PRIOR_LOG_DIGEST = "2d41bce950f66f7b06c2e2a567a84d019d05f0201cb529b31f1691b9eb4c19e2"
REDESIGN_LOG_DIGEST = "1129b604c2877fc19e889c77a3c5746d0800d343a3ba2f8a2bacfefe24b24958"


REV7_LOG_DIGEST = "87777dab1ccb0bdff9aaffebe6fdea449d29b9e5080a86d44f3cdac7ea1997dc"

REV8_LOG_DIGEST = 'd1b2b543ef983117af72a55c52e571fa2e4ef23b5f7e4fb728263d44b795779b'
REV8_DECISIONS_DIGEST = 'c5cb01cf1f9978e1478cd8e16c9a50dfa16b8173741c6c3c17d1128890c563c8'
REV8_DECISION_IDS = ['dec-original', 'dec-deep', 'dec-no-contact', 'dec-008', 'dec-007', 'dec-q0-keep', 'dec-astra-update', 'dec-forward', 'dec-amend', 'dec-overnight', 'dec-q0-failure-branch', 'dec-q0b-g0', 'dec-step1-policy', 'dec-ai-scope', 'dec-ai-contract', 'dec-ai-budget', 'dec-revert-limit']
REV9_EXPECTED = {'h1': {'authority': '本人決定 2026-10-04',
        'selected': '検査済み方針の選択+ENTRY',
        'full_executor_allowed': False,
        'policies': ['v5', 'v5+R11', 'v5+R7厳格化'],
        'entry_min': 20,
        'entry_max': 60,
        'entry_step': 5,
        'entry_max_delta': 5,
        'initial_entry': 50,
        'fallback_entry': 50,
        'expiry_blocks': 120,
        'commit': 'a95054a',
        'tests': 213,
        'red_controls': 25,
        'tests_rerun': False,
        'standard_on': 'refused',
        'fixed_template_safe': False,
        'agent_validator_safe': False,
        'adapter': 'unimplemented',
        'vendored': 'BLOCK',
        'production_boundary': 'prompt-guidance-only',
        'sources': ['src-rev9', 'src-h1-pilot']},
 'pilot': {'regimes': ['calm', 'whale', 'crash', 'depeg-persist'],
           'seeds': [39001, 39002],
           'off_repeats': 1,
           'on_repeats': 3,
           'worlds': 32,
           'primary': 'claude-cli:haiku',
           'secondary': 'codex subscription small model',
           'paid_usage': False,
           'local_ollama': False,
           'personal_ollama_key': False,
           'personal_ollama_quota': False,
           'on_ready': False,
           'pre_q0_run_approved': False,
           'sources': ['src-h1-pilot', 'src-rev9']},
 'next_branch': {'if_dev5_insufficient': '第3回にxa-1を診断',
                 'parallel': 'AI専用adapter/受付の前提整理',
                 'iteration': 3,
                 'automatic_launch': False,
                 'full_executor_decision': '本人判断・未許可',
                 'sources': ['src-rev9']},
 'xa1': {'commit': '7179efe',
         'candidate': 'A: 時間制限付き単脚往復+lot台帳',
         'state': 'implemented-unmeasured',
         'tests': 39,
         'red_controls': 39,
         'tests_rerun': False,
         'smoke_seed': 38003,
         'seeds': [38001, 38002],
         'regimes': 12,
         'worlds': 24,
         'estimated_minutes': 104,
         'end_check_extra': True,
         'result': None,
         'sources': ['src-rev9']},
 'agy_format': {'model': 'GPT-OSS 120B',
                'reasoning': 'Medium',
                'quota': '無料枠',
                'same_model_family_as_production': True,
                'cases': [{'name': 'sparse', 'calls': 1, 'ok': True, 'output': 'null'},
                          {'name': 'selection', 'calls': 1, 'ok': True, 'answer_prescribed': True},
                          {'name': 'injection', 'calls': 1, 'ok': True, 'output': 'null'}],
                'capability_evaluated': False,
                'runtime_verified': False,
                'haiku_verified': False,
                'performance_verified': False,
                'sources': ['src-rev9']},
 'table': {'id': 'result-h1',
           'title': 'H1本人決定・実装の成立範囲・形式確認',
           'header': ['AIパイロット項目', 'rev 9の事実・境界'],
           'rows': [['本人決定・仮説',
                     '[本人決定 2026-10-04] '
                     'AI-PILOT-DESIGNのH1・推奨案「検査済み方針の選択+ENTRY」を選択。全面コード改訂（executorTs自由）は見送り。決定論の改良で大きな改善が見込めないなら、推論ありモードなど大きく改善される仮説へ切替える（本人提案）。'],
                    ['実装・安全境界',
                     '[measured・コード確認の引継ぎ] xb-r-ai '
                     'a95054aはH1を実装、テスト213・赤対照25。標準runtimeはdecide全体（executorTs）を差し替えるため、(a)固定テンプレ限定・(b)エージェント側検証のどちらも安全境界として成立せず、現状はON起動を拒否する。強制には運営側の受付機構/専用adapterが必要。提出物はruntimeを改変できず、scan-submissionのVENDOREDがBLOCKする。本番の改訂は事実上プロンプト誘導に頼り、機械的な安全保証はない。今回コード・テストの再確認はしていない。'],
                    ['H1の設定',
                     '3方針（v5標準 / v5+R11 / v5+R7厳格化）とENTRY '
                     '20–60bps・5bps刻み・最大±5bps。初期・復帰v5/50、更新なし120blockで復帰。旧rev 6のENTRY単独・初期60の署名契約は履歴として不変。'],
                    ['形式確認',
                     '[measured引継ぎ] agy GPT-OSS '
                     '120B（Medium・無料枠・本番と同系統のモデル）の形式確認はsparse/selection/injection各1回、validator '
                     'ok=true。sparseとinjectionはnullで期待どおり。selectionは答えを指定した形式試験で能力評価ではない。runtime/haiku/性能へ外挿しない。本人Ollama鍵の疎通確認や本番無料枠の検証ではない。'],
                    ['推論の費用方針',
                     '[方針] 課金なし。シミュレーション内の改訂はclaude-cli:haikuを第一、既存サブスクのcodex小型モデルを第二候補とする（利用可能なmodel '
                     'IDは未確認）。ローカルOllamaと本人のOllama鍵・無料枠（本番と共有）は使わない。追加課金・APIへの暗黙fallbackは認めない。'],
                    ['パイロット仕様・停止条件',
                     'XB-R-AI-PILOT-2026-10-04.md: '
                     'calm/whale/crash/depeg-persistの4レジーム×seed39001/39002、OFF1+ON3=32世界・Haiku第一。ON実行には専用adapter接続・検査が必要（未実装）。開始前のseed非交差監査・校正・全残費確認が必要で、32世界をQ0/G3/全12レジーム資格へ外挿しない。Q0前への実走前倒しは未承認。'],
                    ['本人に残る判断', 'AI全面改訂を許すか（安全保証なしで本番と同条件で測るか）は本人判断・未許可。H1選択は確定済みで、全面改訂の承認へ拡張しない。']],
           'sources': ['src-rev9', 'src-h1-pilot', 'src-h1-design'],
           'source_table': {'source': 'src-rev9', 'header_key': 'AIパイロット項目'}},
 'human_action': 'AI全面改訂の許可は本人判断・未許可（安全保証なしで本番と同条件で測るか）',
 'human_only': {'status': 'AI全面改訂の許可は本人判断・未許可',
                'items': ['AI全面改訂を許すか（安全保証なしで本番と同条件で測るか）', '10/28 dec-007再確認', '無料枠不足時の前払い判断（G3見積もり後）'],
                'decision_refs': ['dec-008', 'dec-007', 'dec-h1-authority', 'dec-full-executor'],
                'sources': ['src-ollama-report', 'src-rev9'],
                'note': 'AI全面改訂を許すか（安全保証なしで本番と同条件で測るか）は本人判断・未許可。H1選択は確定済みで、全面改訂の承認へ拡張しない。 '
                        '鍵/登録の再操作は不要。10/28確認と前払い判断の既存境界は維持。'},
 'decisions': [{'id': 'dec-h1-authority',
                'date': '2026-10-04',
                'due_date': None,
                'title': '本人決定: H1（検査済み方針の選択+ENTRY）',
                'status': 'decided',
                'note': '[本人決定 2026-10-04] '
                        'AI-PILOT-DESIGNのH1・推奨案「検査済み方針の選択+ENTRY」を選択。全面コード改訂（executorTs自由）は見送り。決定論の改良で大きな改善が見込めないなら、推論ありモードなど大きく改善される仮説へ切替える（本人提案）。 '
                        'AI全面改訂を許すか（安全保証なしで本番と同条件で測るか）は本人判断・未許可。H1選択は確定済みで、全面改訂の承認へ拡張しない。',
                'owner': 'human',
                'group': 'human',
                'sources': ['src-rev9', 'src-h1-pilot']},
               {'id': 'dec-full-executor',
                'date': '2026-10-04',
                'due_date': None,
                'title': 'AI全面改訂を許すか',
                'status': 'open',
                'note': 'AI全面改訂を許すか（安全保証なしで本番と同条件で測るか）は本人判断・未許可。H1選択は確定済みで、全面改訂の承認へ拡張しない。',
                'owner': 'human',
                'group': 'human',
                'sources': ['src-rev9']}]}


REV9_LOG_DIGEST = '2c7aba9ea689291815aae9de680ab8b902ef1457e5f0b0f5e5e5ec9f28e2bf1b'
REV9_DECISIONS_DIGEST = '057079cff473c442634a09baf5ce9c4ba61777a94959c0a1ed9bd51a8bb0ce33'
REV9_DECISION_IDS = ['dec-original', 'dec-deep', 'dec-no-contact', 'dec-008', 'dec-007', 'dec-q0-keep', 'dec-astra-update', 'dec-forward', 'dec-amend', 'dec-overnight', 'dec-q0-failure-branch', 'dec-q0b-g0', 'dec-step1-policy', 'dec-ai-scope', 'dec-ai-contract', 'dec-ai-budget', 'dec-revert-limit', 'dec-h1-authority', 'dec-full-executor']
REV10_EXPECTED = {'dev5': {'name': 'dev5-xb-r',
          'state': 'measured-diagnostic-complete',
          'verified': False,
          'evidence_basis': '本人提示measured集計。原ログ/live再監査なし',
          'field': 'F_ref',
          'seeds': '36001/36002',
          'regimes': 12,
          'worlds': 24,
          'fix_commit': '7b1448b',
          'started_at': '2026-10-04T22:07:00+09:00',
          'started_at_precision': 'minute',
          'started_at_basis': '本人提示22:07 JST。秒00は保存表現で実測秒ではない',
          'expected_end': None,
          'expected_end_basis': '旧見込み2026-10-05 00:00 JST頃は実績ではない。実完了時刻は未提示',
          'completed_at': None,
          'completed_worlds': None,
          'g0': None,
          'result': {'t_candidate': '50.15', 't_multi': '55.73'},
          'q0_eligible': False,
          'independent_screen': False,
          'iteration': 2,
          'note': 'v5 7b1448b・F_ref・36001/36002・12レジーム24世界の同seed対応診断（2/3回目）。平均T '
                  '50.15対55.73、昇格せず。基準はv3。完了時刻/完了数/G0/安全内訳は今回未提示。既見seedの開発診断で独立screen/Q0には使えない。',
          'sources': ['src-rev10']},
 'repair_v5': {'commit': '7b1448b',
               'tests': 183,
               'red_controls': 59,
               'state': 'implemented-reported',
               'verified': False,
               'evidence_kind': 'measured引継ぎ',
               'title': 'v5 = v3 + R9（bundle用在庫余地）ON',
               'note': 'DEV4-XB-R-V5.mdを根拠にR9のみON。テスト183・赤対照59は既存検査記録の引継ぎで今回再実行なし。dev5平均T 50.15対55.73、v5は昇格せず、基準はv3。',
               'sources': ['src-v5']},
 'team': {'primary': 'Codex(Astra)',
          'secondary': 'Claude',
          'unavailable': 'Grok: 利用残高切れ(402)で体制から除外',
          'support': 'agy: Gemini 3.8 Flash High・ハーネス反映済 masa-harness#409',
          'independent_review': 'Claudeの別エージェント+agy',
          'tool_policy': 'ツール使用禁止・差分埋め込み・echo "" | …',
          'note': '本人の運用引継ぎ。agyへの差分はプロンプトに埋め込み、echo "" | …で標準入力を閉じ、ツール使用を禁止する。本更新で外部照会なし。',
          'sources': ['src-operations']},
 'xa1': {'commit': '3ad4f60',
         'candidate': 'A: 時間制限付き単脚往復+lot台帳',
         'state': 'stopped-unhealthy',
         'tests': 39,
         'red_controls': 39,
         'tests_rerun': False,
         'smoke_seed': 38005,
         'seeds': [38001, 38002],
         'regimes': 12,
         'worlds': 24,
         'estimated_minutes': 104,
         'end_check_extra': True,
         'result': {'g0': 'PASS',
                    'submitted': 10,
                    'submitted_min': 30,
                    'recovery_only': 4,
                    'decisions': 710,
                    'lock_resolved': True,
                    'violations': 0,
                    'reverts': 0,
                    'healthy': False},
         'sources': ['src-rev10'],
         'commits': ['7179efe', '6cd9e70', '3ad4f60'],
         'repairs': 2,
         'iteration': 3,
         'iteration_outcome': 'unmet-report-to-human',
         'full_measurement': 'not-completed',
         'note': '[measured引継ぎ] xa-1 7179efe→6cd9e70→3ad4f60。dev6は判断ログにround無し+取引停止でG0 '
                 'BLOCKED、修理1後dev7は提出18・回収専用264/362、修理2後xas2はcalm/38005・G0 '
                 'PASS・提出10件<30・回収専用4/710（ロック解消）・violations0/revert0。HEALTHY=no。2回修理後も不健全のため打ち切り、第3回未達扱いは本人報告事項。',
         'smokes': [{'name': 'dev6', 'commit': '7179efe', 'g0': 'BLOCKED', 'reason': '判断ログにround無し+取引停止'},
                    {'name': 'dev7', 'commit': '6cd9e70', 'submitted': 18, 'recovery_only': 264, 'decisions': 362},
                    {'name': 'xas2',
                     'commit': '3ad4f60',
                     'regime': 'calm',
                     'seed': 38005,
                     'g0': 'PASS',
                     'submitted': 10,
                     'submitted_min': 30,
                     'recovery_only': 4,
                     'decisions': 710,
                     'lock_resolved': True,
                     'violations': 0,
                     'reverts': 0,
                     'healthy': False}],
         'initial_tests_note': 'テスト39・赤対照39は7179efe時点の引継ぎ。修理版の検査として再利用しない。',
         'plan_note': '旧smoke 38003・38001/38002×12=24世界・約104分+終了確認の案は履歴。第3回はsmoke打ち切りで本計測未達。',
         'measured_scope': {'name': 'xas2', 'field': 'F_ref', 'seeds': '38005', 'regimes': 1, 'worlds': 1}},
 'live': {'name': 'xb-r-live',
          'state': 'measured-pilot-stop',
          'verified': False,
          'evidence_basis': '本人提示measured集計。原ログ再監査なし',
          'initial_code': 'xb-r v3',
          'prompt': 'v2',
          'model': 'claude-cli:haiku',
          'paid_usage': False,
          'field': 'F_ref',
          'regimes': 4,
          'seeds': '39001/39002',
          'worlds': 32,
          'g0': 'PASS',
          'safety': 'OK-reported',
          'decision': 'PILOT-STOP',
          'q0_eligible': False,
          'note': '[measured引継ぎ] xb-r-liveはv3初期コード・prompt '
                  'v2・claude-cli:haiku・課金なし。F_ref、calm/whale/crash/depeg-persist×39001/39002、OFF1+ON3=32世界、全群G0 '
                  'PASS・安全OK。全反復dT>0を満たさずPILOT-STOP。H1とは別のsim内自由改訂診断で、資格/提出許可ではない。',
          'sources': ['src-rev10'],
          'groups': [{'group': 'OFF',
                      't': '54.74',
                      'd_t': None,
                      'd_alpha': None,
                      'worst': None,
                      'installed': None,
                      'declined': None,
                      'rejected': None},
                     {'group': 'ON1',
                      't': '48.91',
                      'd_t': '-5.83',
                      'd_alpha': '-229.4',
                      'worst': '-19.75',
                      'installed': 9,
                      'declined': 26,
                      'rejected': 5},
                     {'group': 'ON2',
                      't': '52.80',
                      'd_t': '-1.93',
                      'd_alpha': '-26.9',
                      'worst': '-5.68',
                      'installed': 1,
                      'declined': 25,
                      'rejected': 14},
                     {'group': 'ON3',
                      't': '53.62',
                      'd_t': '-1.11',
                      'd_alpha': '+178.7',
                      'worst': '-4.50',
                      'installed': 1,
                      'declined': 26,
                      'rejected': 13}],
          'calibration': [{'seed': 39101, 'prompt': 'v1', 'installed': 0, 'outcome': 'TSモジュール全体を返してcompile failed'},
                          {'seed': 39102,
                           'prompt': 'v2',
                           'installed': 1,
                           'outcome': 'WBTC slippage許容80→100bps、安全節違反（sim内のみ）'}],
          'wbtc': {'trades': 16, 'fixed_price_pnl_usdc': '+63.34', 'exclusion_supported': False},
          'interpretation': 'AI改訂は平均Tでプラスにならず、適用の多いON1ほど悪化した観測。因果効果とは断定しない。形式不備によるrejectedが多い。HaikuのWBTC除外根拠は実ログで支持できない。'},
 'mix1': {'name': 'mix1',
          'state': 'reported-running-unverified',
          'verified': False,
          'field': 'F_mix（u1構成の診断）',
          'seeds': '40001/40002',
          'regimes': 12,
          'worlds': 24,
          'agents': 11,
          'roster': 'u1のzeta-2をcand=xb-r v3凍結に置換',
          'fix_commit': 'd30cbbb',
          'chunks': ['mix1a', 'mix1b'],
          'started_at': '2026-10-05T03:52:00+09:00',
          'started_at_precision': 'minute',
          'expected_end': '2026-10-05T06:30:00+09:00',
          'expected_end_basis': '本人提示の06:30 JST頃の見込み。完了実績ではない',
          'completed_at': None,
          'completed_worlds': None,
          'g0': None,
          'result': None,
          'result_label': '結果待ち',
          'q0_eligible': False,
          'contract_effect': 'none-diagnostic-only',
          'note': '[進行中・診断] mix1: u1の11体、zeta-2をcand=xb-r v3凍結に置換。12レジーム×40001/40002=24世界、mix1a/mix1bの2チャンク。10/5 03:52 '
                  'JST開始、06:30 JST頃完了見込み。結果待ち（結果未確認）。契約・資格とは無関係で、好成績でもQ0へ昇格させない。',
          'sources': ['src-rev10']},
 'night_operation': {'evidence': '本人引継ぎ',
                     'verified': False,
                     'heartbeat_minutes': 8,
                     'monitor_expiry_minutes': 30,
                     'state_file': '/tmp/night-state.md',
                     'note': '[本人引継ぎ] '
                             '8分ごとのハートビートと/tmp/night-state.mdで夜間の自動進行を管理。監視は30分で失効するため、各ハートビートで監視の有効期限・再登録/更新・次回起床・状態表を確認し、失効前に更新する。失効/未受領なら新規起動を止める。8分は進行管理用で、既決の60秒以下監視・2分検知/5分受領/10分次着手を置換しない。稼働実績・更新成功は本更新で未検証。',
                     'sources': ['src-rev10']},
 'next_branch': {'iteration': 3,
                 'automatic_launch': False,
                 'outcome': 'xa-1打ち切り・決定論ライン未達',
                 'full_executor_decision': '本番自由改訂の安全保証なし・継続方針は本人判断',
                 'recommendation': 'A',
                 'options': ['A: Q0維持・追加計測停止', 'B: 現契約を満たす別系統を新たに設計', 'C: mix1診断を踏まえ契約の場の見直しを本人が決める'],
                 'falsification': '独立した全12レジームの証拠・最悪値・安全・全残費・受理までの日程により、現契約を満たす別系統か、場の見直しを結果への合わせ込みでなく正当化できる場合。mix1単独の好成績は反証にならない。',
                 'sources': ['src-rev10']},
 'live_contract': {'regimes': ['calm', 'whale', 'crash', 'depeg-persist'],
                   'seeds': [39001, 39002],
                   'off_repeats': 1,
                   'on_repeats': 3,
                   'worlds': 32,
                   'all_repeats_required': True,
                   'd_t_strict_min': '0',
                   'd_alpha_strict_min': '0',
                   'worst_min': '-2',
                   'decision': 'PILOT-STOP',
                   'on4_allowed': False,
                   'production_equivalent': False,
                   'sources': ['src-overnight', 'src-rev10']},
 'production_assessment': {'model': 'gpt-oss:120b',
                           'claim': 'Haikuより弱い可能性が高い',
                           'evidence': '推測',
                           'measured_comparison': False,
                           'runtime_safety_boundary': False,
                           'submission_runtime_edit_allowed': False,
                           'h1_standard_on': 'refused',
                           'sources': ['src-rev10']},
 'human_only': {'status': 'Q0契約と提出方針は本人判断待ち',
                'items': ['A: Q0維持・追加計測停止',
                          'B: 現契約を満たす別系統を新たに設計',
                          'C: mix1診断を踏まえ契約の場の見直しを本人が決める',
                          '10/28 dec-007再確認',
                          '無料枠不足時の前払い判断（G3見積もり後）'],
                'decision_refs': ['dec-008', 'dec-007', 'dec-h1-authority', 'dec-full-executor', 'dec-rev10-direction'],
                'sources': ['src-rev10'],
                'note': 'Q0契約の扱いと提出へ向けた次方針は本人判断。推奨はA: 契約を維持し追加計測を停止、時間を精算して受理済み版の確保に必要な工程を再計画する。契約変更は提案のみ。 10/4 '
                        'H1選択と既決署名は不変。自由改訂simの測定記録は本番の承認や安全保証ではない。鍵/登録の再操作は不要、10/28 dec-007と金銭境界を維持。'},
 'human_action': 'Q0契約の扱い・提出へ向けた次方針を決める',
 'table': {'id': 'result-h1',
           'title': 'H1本人決定・実装の成立範囲・形式確認',
           'header': ['AIパイロット項目', 'rev 10の事実・境界'],
           'rows': [['本人決定・仮説',
                     '[本人決定 2026-10-04] '
                     'AI-PILOT-DESIGNのH1・推奨案「検査済み方針の選択+ENTRY」を選択。全面コード改訂（executorTs自由）は見送り。決定論の改良で大きな改善が見込めないなら、推論ありモードなど大きく改善される仮説へ切替える（本人提案）。'],
                    ['実装・安全境界',
                     '[measured・コード確認の引継ぎ] xb-r-ai '
                     'a95054aはH1を実装、テスト213・赤対照25。標準runtimeはdecide全体（executorTs）を差し替えるため、(a)固定テンプレ限定・(b)エージェント側検証のどちらも安全境界として成立せず、現状はON起動を拒否する。強制には運営側の受付機構/専用adapterが必要。提出物はruntimeを改変できず、scan-submissionのVENDOREDがBLOCKする。本番の改訂は事実上プロンプト誘導に頼り、機械的な安全保証はない。今回コード・テストの再確認はしていない。'],
                    ['H1の設定',
                     '3方針（v5標準 / v5+R11 / v5+R7厳格化）とENTRY 20–60bps・5bps刻み・最大±5bps。初期・復帰v5/50、更新なし120blockで復帰。旧rev '
                     '6のENTRY単独・初期60の署名契約は履歴として不変。'],
                    ['形式確認',
                     '[measured引継ぎ] agy GPT-OSS '
                     '120B（Medium・無料枠・本番と同系統のモデル）の形式確認はsparse/selection/injection各1回、validator '
                     'ok=true。sparseとinjectionはnullで期待どおり。selectionは答えを指定した形式試験で能力評価ではない。runtime/haiku/性能へ外挿しない。本人Ollama鍵の疎通確認や本番無料枠の検証ではない。'],
                    ['推論の費用方針',
                     '[方針] 課金なし。シミュレーション内の改訂はclaude-cli:haikuを第一、既存サブスクのcodex小型モデルを第二候補とする（利用可能なmodel '
                     'IDは未確認）。ローカルOllamaと本人のOllama鍵・無料枠（本番と共有）は使わない。追加課金・APIへの暗黙fallbackは認めない。'],
                    ['パイロット仕様・停止条件',
                     'H1専用adapterは未実装・標準ON拒否のまま。旧H1の32世界案は未解放。別系統xb-r-live（v3初期コード、標準runtime自由改訂）は同4レジーム×39001/39002・OFF1+ON3=32世界を測定しPILOT-STOP。使用済みseedをH1のfresh '
                     'seedとして再利用しない。'],
                    ['本人に残る判断',
                     'Q0契約の扱いと提出へ向けた次方針は本人判断。推奨はA: 契約を維持し追加計測を停止、時間を精算して受理済み版の確保に必要な工程を再計画する。契約変更は提案のみ。 '
                     '10/4の全面改訂見送りは原記録に保持。sim内の自由改訂結果は、本番で安全保証なしで本番と同条件で測るかという判断や提出承認を代替しない。']],
           'sources': ['src-rev10', 'src-h1-pilot', 'src-h1-design'],
           'source_table': {'source': 'src-rev10', 'header_key': 'AIパイロット項目'}},
 'overnight': {'sources': ['src-overnight', 'src-rev10'],
               'window_start': '2026-10-05T00:26:00+09:00',
               'xa_smoke_minutes_each': 13,
               'xa_smoke_count': 2,
               'live_smoke_minutes_each': 13,
               'live_smoke_count': 2,
               'live_main_worlds': 32,
               'live_main_minutes': 150,
               'completed_estimate_minutes': 202,
               'mix1_estimate_minutes': 150,
               'total_projected_minutes': 352,
               'exact_union_minutes': None,
               'repair_check_nonrun_minutes': None,
               'day_consumed_minutes': None,
               'forward_consumed_hours': None,
               'remaining_reserved_hours': None,
               'next_full_cost_hours': None,
               'formula': 'C_forward + R_remaining + N_next ≤ 100h',
               'note': 'OVERNIGHT §2.3: 00:26以降の開始/終了区間の和集合で計測・失敗・検査・非runを一度だけ計上し、p3を3倍しない。xa-1 smoke約13分×2 + live '
                       'smoke約13分×2 + live本体32世界約150分 = '
                       '完了分の単純概算202分（3h22）。mix1約150分見込みを含む352分（5h52）は非重複仮定の参考見積で、確定占有ではない。開始/終了全区間・重複・修理/確認/非run・00:26前の当日分は不明。通常6h/日の残り8分とは認定しない。C_forward '
                       '+ R_remaining + N_next ≤ 100h、同一区間のC/R二重計上禁止。不明なら追加起動BLOCKED。'},
 'comparison': [{'candidate': 'xb-r v5',
                 'scope_ref': 'status.dev5',
                 'run_ref': 'status.dev5.name',
                 'metrics': [{'label': '平均T',
                              'candidate_ref': 'status.dev5.result.t_candidate',
                              'baseline_ref': 'status.dev5.result.t_multi'}],
                 'detail': '同seed開発診断・2/3回目。v5昇格せず、基準はv3。',
                 'state': 'warning',
                 'verdict': '平均T未達。G0/安全内訳は未提示、独立screen/Q0には使えない。',
                 'sources': ['src-rev10']},
                {'candidate': 'xb-r v3',
                 'scope_ref': 'status.dev4',
                 'run_ref': 'status.dev4.name',
                 'metrics': [{'label': '平均P',
                              'candidate_ref': 'status.dev4.result.p_candidate',
                              'baseline_ref': 'status.dev4.result.p_multi'},
                             {'label': '平均取引数',
                              'candidate_ref': 'status.dev4.result.trades_candidate',
                              'baseline_ref': 'status.dev4.result.trades_multi'},
                             {'label': '平均T',
                              'candidate_ref': 'status.dev4.result.t_candidate',
                              'baseline_ref': 'status.dev4.result.t_multi'}],
                 'metric_note': 'cand / multi-arb、同じ24世界。平均Tは12レジーム等重み、cleanのP/取引数は原表。',
                 'state': 'warning',
                 'state_label': '比較対象に未達',
                 'safety_ref': 'status.dev4',
                 'verdict': '平均Tは5.3T不足。全12レジーム平均(T−Tnoop)>0、最小+7.85。資格試験ではない。',
                 'sources': ['src-dev4']},
                {'candidate': 'xb-r v2',
                 'scope_ref': 'status.dev3',
                 'run_ref': 'status.dev3.name',
                 'metrics': [{'label': '平均P',
                              'candidate_ref': 'status.dev3.result.p_candidate',
                              'baseline_ref': 'status.dev3.result.p_multi'},
                             {'label': '平均取引数',
                              'candidate_ref': 'status.dev3.result.trades_candidate',
                              'baseline_ref': 'status.dev3.result.trades_multi'},
                             {'label': '平均T',
                              'candidate_ref': 'status.dev3.result.t_candidate',
                              'baseline_ref': 'status.dev3.result.t_multi'}],
                 'metric_note': '候補 / multi-arb（同じ18世界）。clean-arbのP/取引数は原表。',
                 'state': 'warning',
                 'state_label': '比較対象に未達',
                 'safety_ref': 'status.dev3',
                 'verdict': 'dev3aは9レジームの過去診断。dev3bを含む全12平均は未受領。最新v3診断は別seedのdev4。',
                 'sources': ['src-dev3']},
                {'candidate': 'xb-r',
                 'scope_ref': 'status.dev2',
                 'run_ref': 'status.dev2.name',
                 'metrics': [{'label': '平均P',
                              'candidate_ref': 'status.dev2.result.p_candidate',
                              'baseline_ref': 'status.dev2.result.p_multi'},
                             {'label': '平均取引数',
                              'candidate_ref': 'status.dev2.result.trades_candidate',
                              'baseline_ref': 'status.dev2.result.trades_multi'},
                             {'label': '平均T',
                              'candidate_ref': 'status.dev2.result.t_candidate',
                              'baseline_ref': 'status.dev2.result.t_multi'}],
                 'metric_note': '候補 / multi-arb（同じ母集団）',
                 'state': 'warning',
                 'state_label': '比較対象に未達',
                 'safety_ref': 'status.dev2',
                 'verdict': '診断平均TはQ0基準未達。正式な資格試験ではない。',
                 'sources': ['src-dev2', 'src-dev2-repair']},
                {'candidate': 'xb-r 初版',
                 'scope_ref': 'status.dev1',
                 'run_ref': 'status.dev1.name',
                 'metrics': [{'label': '取引', 'candidate_ref': 'status.dev1.trades'},
                             {'label': '全世界P−noop', 'candidate_ref': 'status.dev1.p_minus_noop_all_worlds'}],
                 'state': 'warning',
                 'state_label': '無取引を検出',
                 'verdict': 'G0 PASS。原因修正後はdev2で再診断。',
                 'sources': ['src-dev1']},
                {'candidate': 'xa-1',
                 'scope_ref': 'status.xa1.measured_scope',
                 'run_ref': 'status.xa1.state',
                 'value_note': 'HEALTHY=no',
                 'detail_ref': 'status.xa1.note',
                 'state': 'failed',
                 'verdict': '第3回未達・2回修理後打ち切り',
                 'sources': ['src-rev10']},
                {'candidate': 'xb-r-live',
                 'scope_ref': 'status.live',
                 'run_ref': 'status.live.name',
                 'value_note': 'PILOT-STOP',
                 'detail_ref': 'status.live.note',
                 'state': 'failed',
                 'verdict': '全ON反復でdT<0。Q0/G3の代替不可',
                 'sources': ['src-rev10']},
                {'candidate': 'xb-r v3（mix1）',
                 'scope_ref': 'status.mix1',
                 'run_ref': 'status.mix1.name',
                 'detail_ref': 'status.mix1.note',
                 'value_note': '結果待ち',
                 'state': 'running',
                 'verdict': '結果未確認・契約/資格と無関係の診断',
                 'sources': ['src-rev10']}],
 'new_decision': {'id': 'dec-rev10-direction',
                  'date': '2026-10-05',
                  'due_date': None,
                  'title': '第3回未達後のQ0契約・提出方針',
                  'status': 'open',
                  'note': 'Q0契約の扱いと提出へ向けた次方針は本人判断。推奨はA: 契約を維持し追加計測を停止、時間を精算して受理済み版の確保に必要な工程を再計画する。契約変更は提案のみ。 選択肢: A: '
                          'Q0維持・追加計測停止 / B: 現契約を満たす別系統を新たに設計 / C: mix1診断を踏まえ契約の場の見直しを本人が決める 反証条件: '
                          '独立した全12レジームの証拠・最悪値・安全・全残費・受理までの日程により、現契約を満たす別系統か、場の見直しを結果への合わせ込みでなく正当化できる場合。mix1単独の好成績は反証にならない。',
                  'owner': 'human',
                  'group': 'human',
                  'sources': ['src-rev10']}}

REV10_TABLES = {'dev5': {'header': ['dev5項目', '提示値・境界'],
          'rows': [['平均T', 'cand 50.15 / multi 55.73'],
                   ['母集団', 'F_ref・36001/36002・12レジーム24世界・2/3回目'],
                   ['判定', 'v5昇格せず、基準はxb-r v3。独立screen/Q0ではない'],
                   ['未提示', '完了時刻・完了数・G0・安全内訳は未確認']]},
 'xa1': {'header': ['xa-1段階', '版・結果'],
         'rows': [['dev6', '7179efe: 判断ログにround無し+取引停止、G0 BLOCKED'],
                  ['修理1 → dev7', '6cd9e70: 提出18・回収専用264/362'],
                  ['修理2 → xas2', '3ad4f60: calm/38005、G0 PASS、提出10件<30、回収専用4/710（ロック解消）、violations0/revert0'],
                  ['判定', 'HEALTHY=no。2回修理後も不健全で打ち切り。第3回未達扱いは本人報告事項']]},
 'live': {'header': ['live群', '平均T', 'dT', 'dAlpha', 'worst', 'installed / declined / rejected'],
          'rows': [['OFF', '54.74', '—', '—', '—', '—'],
                   ['ON1', '48.91', '-5.83', '-229.4', '-19.75', '9 / 26 / 5'],
                   ['ON2', '52.80', '-1.93', '-26.9', '-5.68', '1 / 25 / 14'],
                   ['ON3', '53.62', '-1.11', '+178.7', '-4.50', '1 / 26 / 13']]},
 'live_safety': {'header': ['live校正・安全・解釈', '提示事実 / 境界'],
                 'rows': [['初回校正 39101 / prompt v1', 'TSモジュール全体を返しcompile failed、installed 0'],
                          ['再校正 39102 / prompt v2', 'installed 1。WBTC slippage許容80→100bps、安全節に反する変更（sim内のみ）'],
                          ['WBTC除外の根拠', '実ログで支持できない。WBTC 16取引の固定価格損益+63.34 USDC'],
                          ['全群の安全と性能', '全群G0 PASS・安全OKは観測。平均Tの増分は全ONで負、適用の多い群ほど悪化、形式不備rejectedが多い。因果効果/安全保証ではない'],
                          ['本番の見立て',
                           'gpt-oss:120bはHaikuより弱い可能性が高い（推測、実測比較なし）。標準runtimeは安全な枠を強制できず、提出物はruntime改変不可。H1 ON拒否を維持']]},
 'mix1': {'header': ['mix1項目', '引継ぎ・結果'],
          'rows': [['構成', 'u1の11体、zeta-2をcand=xb-r v3凍結に置換'],
                   ['範囲', '12レジーム×seed40001/40002=24世界、mix1a/mix1b'],
                   ['時刻', '2026-10-05 03:52 JST開始、06:30 JST頃完了見込み'],
                   ['結果', '結果待ち'],
                   ['境界', '結果未確認。契約・資格とは無関係の診断']]}}

REV10_LOG_DIGEST = '5ce33aa6b349214e24736b4f170a3528c1d40ea2e9e7182ff4b5875ef678c95f'
REV10_ALL_DECISIONS_DIGEST = '9a1ec6ef93c1040c99042372335143a1a4185e2b07ab3ab1923a289815b7fe07'

REV12_EXPECTED = {'mix1': {'name': 'mix1',
          'state': 'measured-diagnostic-complete',
          'verified': False,
          'field': 'F_mix（u1構成の診断）',
          'seeds': '40001/40002',
          'regimes': 12,
          'worlds': 24,
          'agents': 11,
          'roster': 'u1のzeta-2をcand=xb-r v3凍結に置換',
          'fix_commit': 'd30cbbb',
          'chunks': ['mix1a', 'mix1b'],
          'started_at': '2026-10-05T03:52:00+09:00',
          'started_at_precision': 'minute',
          'expected_end': None,
          'expected_end_basis': '旧06:30 JST頃見込みは履歴。完了実時刻は未提示',
          'completed_at': None,
          'completed_worlds': 24,
          'g0': '23 PASS / 1 BLOCKED',
          'result': {'t_candidate': '52.18',
                     'rank_candidate': 5,
                     'worst_regime_t': '47.6',
                     'best_worst': True,
                     't_multi': '36.73',
                     'rank_multi': 11,
                     'g0_pass_worlds': 23,
                     'g0_blocked_worlds': 1,
                     'blocked_world': 'crash/40001',
                     'blocked_agent': 'grok-1',
                     'blocked_cause': 'telemetry',
                     'blocked_retained': True,
                     'violations': 0,
                     'ranking': [{'rank': 1, 'agent': 'inc-zeta', 't': '54.98', 'worst_regime_t': '39.4'},
                                 {'rank': 2, 'agent': 'venue-arb', 't': '54.35', 'worst_regime_t': '36.7'},
                                 {'rank': 3, 'agent': 'grok-1', 't': '53.52', 'worst_regime_t': '43.9'},
                                 {'rank': 4, 'agent': 'sonnet-1', 't': '53.34', 'worst_regime_t': '47.1'},
                                 {'rank': 5, 'agent': 'cand(xb-r v3)', 't': '52.18', 'worst_regime_t': '47.6'},
                                 {'rank': 6, 'agent': 'opus-1', 't': '51.66', 'worst_regime_t': '44.4'},
                                 {'rank': 7, 'agent': 'clean-arb', 't': '50.20', 'worst_regime_t': '40.3'},
                                 {'rank': 8, 'agent': 'astra-1', 't': '49.08', 'worst_regime_t': '41.4'},
                                 {'rank': 9, 'agent': 'astra-2', 't': '48.97', 'worst_regime_t': '39.6'},
                                 {'rank': 10, 'agent': 'sonnet-2', 't': '45.00', 'worst_regime_t': '35.2'},
                                 {'rank': 11, 'agent': 'multi-arb', 't': '36.73', 'worst_regime_t': '23.0'}],
                     'regime_t': [{'regime': 'calm', 't': '53.0', 'mean_rank': '7.0'},
                                  {'regime': 'cex-drift', 't': '53.5', 'mean_rank': '3.5'},
                                  {'regime': 'informed-flow', 't': '52.0', 'mean_rank': '6.0'},
                                  {'regime': 'whale', 't': '49.0', 'mean_rank': '6.0'},
                                  {'regime': 'lending-incident', 't': '57.0', 'mean_rank': '2.5'},
                                  {'regime': 'crash', 't': '50.0', 'mean_rank': '5.5'},
                                  {'regime': 'depeg', 't': '54.1', 'mean_rank': '6.0'},
                                  {'regime': 'vuln', 't': '52.8', 'mean_rank': '6.5'},
                                  {'regime': 'spike', 't': '55.4', 'mean_rank': '2.5'},
                                  {'regime': 'depeg-persist', 't': '52.7', 'mean_rank': '6.5'},
                                  {'regime': 'cdp-incident', 't': '49.1', 'mean_rank': '5.5'},
                                  {'regime': 'launch', 't': '47.6', 'mean_rank': '6.0'}]},
          'result_label': '診断結果受領・資格判定なし',
          'q0_eligible': False,
          'contract_effect': 'none-diagnostic-only',
          'note': '[measured] mix1は12レジーム等重み平均Tでcand(xb-r v3)52.18・11体中5位、平均(50)より上。worst regime '
                  'T47.6は全員で最良の最悪値。multi-arbは36.73・最下位。F_refの対multi-arb基準での負けと混成場での順位は逆の見え方。 '
                  'G0は24世界中23世界PASS、crash/40001のみBLOCKED（grok-1のtelemetryが原因、candではない）。診断として全24世界を保持し、BLOCKEDをPASSとは扱わない。violations '
                  '0。 契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。',
          'sources': ['src-rev11'],
          'evidence_basis': '本人提示measured引継ぎ。原ログ・バイト同一性の再監査なし',
          'parallelism': 3,
          'code_identity': 'xb-r-liveのagent.tsはd30cbbbとバイト同一（本人提示measured・再照合なし）',
          'interpretation': '[inferred] 2 '
                            'seed×12レジームなのでinc-zetaとの差約2.8Tはノイズの範囲とみる。sonnet-1(53.34)・opus-1(51.66)など既存候補とも有意に区別できないという見立てで、統計検定の結果ではない。'},
 'mix2': {'name': 'mix2',
          'state': 'measured-diagnostic-complete',
          'verified': False,
          'field': 'F_mix（u1構成の診断）',
          'seeds': '40003/40004',
          'regimes': 12,
          'worlds': 24,
          'agents': 11,
          'roster': 'u1のzeta-2をcand=xb-r v3凍結に置換',
          'fix_commit': 'd30cbbb',
          'started_at': '2026-10-05T05:34:00+09:00',
          'started_at_precision': 'minute',
          'expected_end': None,
          'expected_end_basis': '旧07:20 JST頃は見込み。実完了時刻は未提示',
          'completed_at': None,
          'completed_worlds': 24,
          'g0': 'PASS',
          'result': {'t_candidate': '51.63',
                     'rank_candidate': 6,
                     'worst_regime_t': '46.2',
                     't_multi': '34.54',
                     'rank_multi': 11,
                     'violations': 0,
                     'g0_pass_worlds': 24,
                     'g0_blocked_worlds': 0,
                     'ranking': [{'rank': 1, 'agent': 'inc-zeta', 't': '61.54', 'worst_regime_t': '53.2'},
                                 {'rank': 2, 'agent': 'venue-arb', 't': '53.07', 'worst_regime_t': '39.5'},
                                 {'rank': 3, 'agent': 'sonnet-1', 't': '52.49', 'worst_regime_t': '46.1'},
                                 {'rank': 4, 'agent': 'opus-1', 't': '52.11', 'worst_regime_t': '43.6'},
                                 {'rank': 5, 'agent': 'grok-1', 't': '52.07', 'worst_regime_t': '45.1'},
                                 {'rank': 6, 'agent': 'cand(xb-r v3)', 't': '51.63', 'worst_regime_t': '46.2'},
                                 {'rank': 7, 'agent': 'clean-arb', 't': '49.88', 'worst_regime_t': '42.9'},
                                 {'rank': 8, 'agent': 'astra-1', 't': '49.20', 'worst_regime_t': '42.1'},
                                 {'rank': 9, 'agent': 'astra-2', 't': '49.07', 'worst_regime_t': '40.8'},
                                 {'rank': 10, 'agent': 'sonnet-2', 't': '44.40', 'worst_regime_t': '30.0'},
                                 {'rank': 11, 'agent': 'multi-arb', 't': '34.54', 'worst_regime_t': '23.5'}]},
          'result_label': '診断結果受領・資格判定なし',
          'continue_on_g0_blocked': True,
          'q0_eligible': False,
          'contract_effect': 'none-diagnostic-only',
          'combined_worlds_planned': 48,
          'note': '[measured] mix2はmix1と同じroster（u1の11体、zeta-2をcand=xb-r v3凍結に置換）。fresh '
                  'seed40003/40004・12レジーム24世界、mix2a/mix2bともG0 PASS、violations '
                  '0。candは平均T51.63・6位・最悪46.2、inc-zetaは61.54・1位・最悪53.2。05:34 '
                  'JST開始の引継ぎを保持し、実完了時刻は未提示。契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。',
          'sources': ['src-rev12'],
          'chunks': ['mix2a', 'mix2b']},
 'mix48': {'name': 'mix1+mix2',
           'state': 'measured-diagnostic-complete',
           'verified': False,
           'field': 'F_mix（u1構成の診断）',
           'seeds': '40001/40002/40003/40004',
           'regimes': 12,
           'worlds': 48,
           'completed_worlds': 48,
           'agents': 11,
           'roster': 'u1のzeta-2をcand=xb-r v3凍結に置換',
           'started_at': None,
           'expected_end': None,
           'completed_at': None,
           'g0': 'mix1: 23 PASS / 1 BLOCKED; mix2a/mix2b: PASS',
           'result': {'t_candidate': '51.91',
                      'rank_candidate': 5,
                      'worst_regime_t': '47.6',
                      't_multi': '35.63',
                      'rank_multi': 11,
                      't_leader': '58.26',
                      't_second': '53.71',
                      'leader_worst_regime_t': '46.8',
                      'ranking': [{'rank': 1, 'agent': 'inc-zeta', 't': '58.26', 'worst_regime_t': '46.8'},
                                  {'rank': 2, 'agent': 'venue-arb', 't': '53.71', 'worst_regime_t': '42.5'},
                                  {'rank': 3, 'agent': 'sonnet-1', 't': '52.92', 'worst_regime_t': '47.2'},
                                  {'rank': 4, 'agent': 'grok-1', 't': '52.80', 'worst_regime_t': '45.1'},
                                  {'rank': 5, 'agent': 'cand(xb-r v3)', 't': '51.91', 'worst_regime_t': '47.6'},
                                  {'rank': 6, 'agent': 'opus-1', 't': '51.88', 'worst_regime_t': '44.5'},
                                  {'rank': 7, 'agent': 'clean-arb', 't': '50.04', 'worst_regime_t': '42.8'},
                                  {'rank': 8, 'agent': 'astra-1', 't': '49.14', 'worst_regime_t': '41.7'},
                                  {'rank': 9, 'agent': 'astra-2', 't': '49.02', 'worst_regime_t': '42.5'},
                                  {'rank': 10, 'agent': 'sonnet-2', 't': '44.70', 'worst_regime_t': '36.3'},
                                  {'rank': 11, 'agent': 'multi-arb', 't': '35.63', 'worst_regime_t': '24.9'}]},
           'q0_eligible': False,
           'contract_effect': 'none-diagnostic-only',
           'result_label': '診断集計・資格判定なし',
           'note': '[measured] mix1/mix2でseedを替えても順位は概ね安定（inc-zeta 1位・venue-arb 2位・multi-arb '
                   '11位）。mix1+mix2は12レジーム等重み・seed40001–40004の48世界。inc-zetaは平均T58.26、2位53.71との差は約4.5T（表示値の差4.55T）、最悪レジームT46.8。観測した混成場では明確な最強。cand(xb-r '
                   'v3)は平均T51.91・5位・最悪47.6で、sonnet-1/grok-1/opus-1と約1T以内（表示値ではsonnet-1との差1.01T、grok-1との差0.89T、opus-1との差0.03T）。 mix1のcrash/40001（grok-1 '
                   'telemetry）BLOCKEDを保持し、PASSへ変更しない。契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。',
           'interpretation': '[inferred] xb-r '
                             'v3とsonnet-1/grok-1/opus-1はこの集計では区別できないとの見立てで、統計検定の結果ではない。決定論ラインxb-rの追加改良より、混成場で強い既存の独自戦略inc-zeta=zeta-a30（Claude+Codex作成の本命）を提出基盤にする案が示唆される。ただしinc-zetaはF_ref契約(Q0)未通過。D0のF_ref診断はcommit不一致でG0 '
                             'FAIL、性能は診断のみ。',
           'sources': ['src-rev12']},
 'incz': {'name': 'incz',
          'candidate': 'inc-zeta=zeta-a30',
          'state': 'reported-running-unverified',
          'verified': False,
          'field': 'F_ref',
          'seeds': '40005',
          'regimes': 12,
          'worlds': 12,
          'started_at': '2026-10-05T07:20:00+09:00',
          'started_at_precision': 'approximate-minute',
          'expected_end': '2026-10-05T08:15:00+09:00',
          'expected_end_basis': '本人提示の約55分・08:15 JST頃の見込み。実完了時刻ではない',
          'completed_at': None,
          'completed_worlds': None,
          'g0': None,
          'result': None,
          'result_label': '結果待ち（結果未確認・追記欄）',
          'q0_eligible': False,
          'contract_effect': 'none-diagnostic-only',
          'note': '[進行中・診断] inczはinc-zetaをF_refで12レジーム×seed40005=12世界。10/5 07:20 '
                  'JST頃開始との本人引継ぎ（旧05:40頃開始見込みを訂正）、約55分・08:15 JST頃完了見込み。走行中・結果未確認・結果待ち。G0・完了数・完了時刻・性能・安全内訳は未確認。結果追記欄: '
                  '未受領。経過時間で完了としない。契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。',
          'sources': ['src-rev12']},
 'next_branch': {'iteration': 3,
                 'automatic_launch': False,
                 'outcome': 'xa-1打ち切り・決定論ライン未達',
                 'full_executor_decision': '本番自由改訂の安全保証なし・継続方針は本人判断',
                 'recommendation': 'A',
                 'options': ['A: '
                             'inc-zetaを提出基盤の第一候補にする（推奨・未決）。incz結果を診断として受領し、現Q0を維持して条件成立を目指すか、場の妥当性を検証して契約変更を提案するかを本人が決める。決定・全費用・安全・受理日程が揃うまで追加起動しない',
                             'B: 現Q0を維持し、提出基盤の選定を保留する。inc-zetaのF_ref適性・資格証跡が不足したままなら新規実走を止め、残工程と期限から継続可否を本人が決める',
                             'C: '
                             'xb-rの追加改良または別系統設計を再検討する。混成場での優位を示す反証可能な仮説と新たな回数・全費用・受理日程を本人が決めるまで起動しない。第3回打ち切りを自動解除しない'],
                 'falsification': 'inczでF_refの対multi-arb・対noop・最悪値・G0/安全に重大な弱点が示され、現Q0達成の経路も場の見直しの独立した根拠も成立しない場合、または提出適合・全残費・受理までの日程が成立しない場合はAを撤回/保留する。別候補の優位には独立した比較証拠を要する。inczは1seedの12世界診断で、好成績でも全12×2のscreenや60世界Q0の代用にならない。',
                 'sources': ['src-rev12']},
 'human_only': {'status': 'Q0契約と提出方針は本人判断待ち',
                'items': ['A: '
                          'inc-zetaを提出基盤の第一候補にする（推奨・未決）。incz結果を診断として受領し、現Q0を維持して条件成立を目指すか、場の妥当性を検証して契約変更を提案するかを本人が決める。決定・全費用・安全・受理日程が揃うまで追加起動しない',
                          'B: 現Q0を維持し、提出基盤の選定を保留する。inc-zetaのF_ref適性・資格証跡が不足したままなら新規実走を止め、残工程と期限から継続可否を本人が決める',
                          'C: xb-rの追加改良または別系統設計を再検討する。混成場での優位を示す反証可能な仮説と新たな回数・全費用・受理日程を本人が決めるまで起動しない。第3回打ち切りを自動解除しない',
                          '10/28 dec-007再確認',
                          '無料枠不足時の前払い判断（G3見積もり後）'],
                'decision_refs': ['dec-008', 'dec-007', 'dec-h1-authority', 'dec-full-executor', 'dec-rev10-direction'],
                'sources': ['src-rev12'],
                'note': '推奨はA: '
                        '混成場で強いinc-zetaを提出基盤の第一候補とし、Q0（F_ref・対multi-arb）をどう扱うかは本人判断。契約変更は提案のみ。Q0維持・追加起動停止のまま、走行中inczの結果受領と時間精算・受理工程の再計画を行う。 '
                        '[inferred] xb-r '
                        'v3とsonnet-1/grok-1/opus-1はこの集計では区別できないとの見立てで、統計検定の結果ではない。決定論ラインxb-rの追加改良より、混成場で強い既存の独自戦略inc-zeta=zeta-a30（Claude+Codex作成の本命）を提出基盤にする案が示唆される。ただしinc-zetaはF_ref契約(Q0)未通過。D0のF_ref診断はcommit不一致でG0 '
                        'FAIL、性能は診断のみ。 反証条件: '
                        'inczでF_refの対multi-arb・対noop・最悪値・G0/安全に重大な弱点が示され、現Q0達成の経路も場の見直しの独立した根拠も成立しない場合、または提出適合・全残費・受理までの日程が成立しない場合はAを撤回/保留する。別候補の優位には独立した比較証拠を要する。inczは1seedの12世界診断で、好成績でも全12×2のscreenや60世界Q0の代用にならない。 '
                        '既決署名・H1選択・金銭境界は不変。'},
 'comparison': [{'candidate': 'xb-r v5',
                 'scope_ref': 'status.dev5',
                 'run_ref': 'status.dev5.name',
                 'metrics': [{'label': '平均T',
                              'candidate_ref': 'status.dev5.result.t_candidate',
                              'baseline_ref': 'status.dev5.result.t_multi'}],
                 'detail': '同seed開発診断・2/3回目。v5昇格せず、基準はv3。',
                 'state': 'warning',
                 'verdict': '平均T未達。G0/安全内訳は未提示、独立screen/Q0には使えない。',
                 'sources': ['src-rev10']},
                {'candidate': 'xb-r v3',
                 'scope_ref': 'status.dev4',
                 'run_ref': 'status.dev4.name',
                 'metrics': [{'label': '平均P',
                              'candidate_ref': 'status.dev4.result.p_candidate',
                              'baseline_ref': 'status.dev4.result.p_multi'},
                             {'label': '平均取引数',
                              'candidate_ref': 'status.dev4.result.trades_candidate',
                              'baseline_ref': 'status.dev4.result.trades_multi'},
                             {'label': '平均T',
                              'candidate_ref': 'status.dev4.result.t_candidate',
                              'baseline_ref': 'status.dev4.result.t_multi'}],
                 'metric_note': 'cand / multi-arb、同じ24世界。平均Tは12レジーム等重み、cleanのP/取引数は原表。',
                 'state': 'warning',
                 'state_label': '比較対象に未達',
                 'safety_ref': 'status.dev4',
                 'verdict': '平均Tは5.3T不足。全12レジーム平均(T−Tnoop)>0、最小+7.85。資格試験ではない。',
                 'sources': ['src-dev4']},
                {'candidate': 'xb-r v2',
                 'scope_ref': 'status.dev3',
                 'run_ref': 'status.dev3.name',
                 'metrics': [{'label': '平均P',
                              'candidate_ref': 'status.dev3.result.p_candidate',
                              'baseline_ref': 'status.dev3.result.p_multi'},
                             {'label': '平均取引数',
                              'candidate_ref': 'status.dev3.result.trades_candidate',
                              'baseline_ref': 'status.dev3.result.trades_multi'},
                             {'label': '平均T',
                              'candidate_ref': 'status.dev3.result.t_candidate',
                              'baseline_ref': 'status.dev3.result.t_multi'}],
                 'metric_note': '候補 / multi-arb（同じ18世界）。clean-arbのP/取引数は原表。',
                 'state': 'warning',
                 'state_label': '比較対象に未達',
                 'safety_ref': 'status.dev3',
                 'verdict': 'dev3aは9レジームの過去診断。dev3bを含む全12平均は未受領。最新v3診断は別seedのdev4。',
                 'sources': ['src-dev3']},
                {'candidate': 'xb-r',
                 'scope_ref': 'status.dev2',
                 'run_ref': 'status.dev2.name',
                 'metrics': [{'label': '平均P',
                              'candidate_ref': 'status.dev2.result.p_candidate',
                              'baseline_ref': 'status.dev2.result.p_multi'},
                             {'label': '平均取引数',
                              'candidate_ref': 'status.dev2.result.trades_candidate',
                              'baseline_ref': 'status.dev2.result.trades_multi'},
                             {'label': '平均T',
                              'candidate_ref': 'status.dev2.result.t_candidate',
                              'baseline_ref': 'status.dev2.result.t_multi'}],
                 'metric_note': '候補 / multi-arb（同じ母集団）',
                 'state': 'warning',
                 'state_label': '比較対象に未達',
                 'safety_ref': 'status.dev2',
                 'verdict': '診断平均TはQ0基準未達。正式な資格試験ではない。',
                 'sources': ['src-dev2', 'src-dev2-repair']},
                {'candidate': 'xb-r 初版',
                 'scope_ref': 'status.dev1',
                 'run_ref': 'status.dev1.name',
                 'metrics': [{'label': '取引', 'candidate_ref': 'status.dev1.trades'},
                             {'label': '全世界P−noop', 'candidate_ref': 'status.dev1.p_minus_noop_all_worlds'}],
                 'state': 'warning',
                 'state_label': '無取引を検出',
                 'verdict': 'G0 PASS。原因修正後はdev2で再診断。',
                 'sources': ['src-dev1']},
                {'candidate': 'xa-1',
                 'scope_ref': 'status.xa1.measured_scope',
                 'run_ref': 'status.xa1.state',
                 'value_note': 'HEALTHY=no',
                 'detail_ref': 'status.xa1.note',
                 'state': 'failed',
                 'verdict': '第3回未達・2回修理後打ち切り',
                 'sources': ['src-rev10']},
                {'candidate': 'xb-r-live',
                 'scope_ref': 'status.live',
                 'run_ref': 'status.live.name',
                 'value_note': 'PILOT-STOP',
                 'detail_ref': 'status.live.note',
                 'state': 'failed',
                 'verdict': '全ON反復でdT<0。Q0/G3の代替不可',
                 'sources': ['src-rev10']},
                {'candidate': 'xb-r v3（mix1）',
                 'scope_ref': 'status.mix1',
                 'run_ref': 'status.mix1.name',
                 'detail_ref': 'status.mix1.note',
                 'value_note': '5/11位・最悪値47.6は全員で最良',
                 'state': 'warning',
                 'verdict': 'G0 23 PASS/1 BLOCKEDを含む24世界の診断。資格・旧Q0m・提出可否へ転用しない',
                 'sources': ['src-rev11'],
                 'metrics': [{'label': '平均T',
                              'candidate_ref': 'status.mix1.result.t_candidate',
                              'baseline_ref': 'status.mix1.result.t_multi'}]},
                {'candidate': 'xb-r v3（mix2）',
                 'scope_ref': 'status.mix2',
                 'run_ref': 'status.mix2.name',
                 'detail_ref': 'status.mix2.note',
                 'value_note': 'cand 6/11位・最悪46.2',
                 'state': 'warning',
                 'verdict': '診断結果受領・資格判定なし',
                 'sources': ['src-rev12'],
                 'metrics': [{'label': '平均T',
                              'candidate_ref': 'status.mix2.result.t_candidate',
                              'baseline_ref': 'status.mix2.result.t_multi'}],
                 'detail': '24世界の診断結果。資格判定なし'},
                {'candidate': 'inc-zeta（mix1+mix2）',
                 'scope_ref': 'status.mix48',
                 'run_ref': 'status.mix48.name',
                 'detail_ref': 'status.mix48.note',
                 'state': 'warning',
                 'metrics': [{'label': '平均T（対2位venue-arb）',
                              'candidate_ref': 'status.mix48.result.t_leader',
                              'baseline_ref': 'status.mix48.result.t_second'}],
                 'detail': '48世界集計・診断のみ',
                 'sources': ['src-rev12'],
                 'verdict': '診断結果受領・資格判定なし',
                 'value_note': 'inc-zeta 1/11位・最悪46.8、cand 5位'},
                {'candidate': 'inc-zeta（incz）',
                 'scope_ref': 'status.incz',
                 'run_ref': 'status.incz.name',
                 'detail_ref': 'status.incz.note',
                 'state': 'pending',
                 'metrics': [],
                 'detail': '結果待ち・診断のみ',
                 'sources': ['src-rev12'],
                 'verdict': '結果未確認・診断のみ',
                 'value_note': '結果待ち'}],
 'mix1_table': {'header': ['混成場診断・incz項目', '引継ぎ・結果'],
                'rows': [['構成', 'u1の11体、zeta-2をcand=xb-r v3凍結に置換。xb-r-liveのagent.ts=d30cbbbとバイト同一（本人提示）'],
                         ['範囲', '12レジーム×seed40001/40002=24世界、mix1a/mix1b、p=3'],
                         ['時刻', '2026-10-05 03:52 JST開始。旧06:30 JST頃見込みは実績に使わず、完了時刻は未提示'],
                         ['結果', 'cand平均T52.18・5/11位・worst regime T47.6（全員で最良の最悪値）'],
                         ['G0',
                          'G0は24世界中23世界PASS、crash/40001のみBLOCKED（grok-1のtelemetryが原因、candではない）。診断として全24世界を保持し、BLOCKEDをPASSとは扱わない。violations '
                          '0。'],
                         ['境界', '契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。'],
                         ['総合1位 inc-zeta', '12レジーム等重み平均T 54.98 / worst regime T 39.4'],
                         ['総合2位 venue-arb', '12レジーム等重み平均T 54.35 / worst regime T 36.7'],
                         ['総合3位 grok-1', '12レジーム等重み平均T 53.52 / worst regime T 43.9'],
                         ['総合4位 sonnet-1', '12レジーム等重み平均T 53.34 / worst regime T 47.1'],
                         ['総合5位 cand(xb-r v3)', '12レジーム等重み平均T 52.18 / worst regime T 47.6'],
                         ['総合6位 opus-1', '12レジーム等重み平均T 51.66 / worst regime T 44.4'],
                         ['総合7位 clean-arb', '12レジーム等重み平均T 50.20 / worst regime T 40.3'],
                         ['総合8位 astra-1', '12レジーム等重み平均T 49.08 / worst regime T 41.4'],
                         ['総合9位 astra-2', '12レジーム等重み平均T 48.97 / worst regime T 39.6'],
                         ['総合10位 sonnet-2', '12レジーム等重み平均T 45.00 / worst regime T 35.2'],
                         ['総合11位 multi-arb', '12レジーム等重み平均T 36.73 / worst regime T 23.0'],
                         ['cand calm', '平均T 53.0 / 平均順位 7.0'],
                         ['cand cex-drift', '平均T 53.5 / 平均順位 3.5'],
                         ['cand informed-flow', '平均T 52.0 / 平均順位 6.0'],
                         ['cand whale', '平均T 49.0 / 平均順位 6.0'],
                         ['cand lending-incident', '平均T 57.0 / 平均順位 2.5'],
                         ['cand crash', '平均T 50.0 / 平均順位 5.5'],
                         ['cand depeg', '平均T 54.1 / 平均順位 6.0'],
                         ['cand vuln', '平均T 52.8 / 平均順位 6.5'],
                         ['cand spike', '平均T 55.4 / 平均順位 2.5'],
                         ['cand depeg-persist', '平均T 52.7 / 平均順位 6.5'],
                         ['cand cdp-incident', '平均T 49.1 / 平均順位 5.5'],
                         ['cand launch', '平均T 47.6 / 平均順位 6.0'],
                         ['観測の解釈',
                          '[measured] mix1は12レジーム等重み平均Tでcand(xb-r v3)52.18・11体中5位、平均(50)より上。worst regime '
                          'T47.6は全員で最良の最悪値。multi-arbは36.73・最下位。F_refの対multi-arb基準での負けと混成場での順位は逆の見え方。'],
                         ['mix1単独時点の推測（rev 11履歴）',
                          '[inferred] 2 '
                          'seed×12レジームなのでinc-zetaとの差約2.8Tはノイズの範囲とみる。sonnet-1(53.34)・opus-1(51.66)など既存候補とも有意に区別できないという見立てで、統計検定の結果ではない。'],
                         ['mix2結果',
                          '[measured] mix2はmix1と同じroster（u1の11体、zeta-2をcand=xb-r v3凍結に置換）。fresh '
                          'seed40003/40004・12レジーム24世界、mix2a/mix2bともG0 PASS、violations '
                          '0。candは平均T51.63・6位・最悪46.2、inc-zetaは61.54・1位・最悪53.2。05:34 '
                          'JST開始の引継ぎを保持し、実完了時刻は未提示。契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。'],
                         ['mix2順位1 / inc-zeta', '平均T 61.54 / worst regime T 53.2'],
                         ['mix2順位2 / venue-arb', '平均T 53.07 / worst regime T 39.5'],
                         ['mix2順位3 / sonnet-1', '平均T 52.49 / worst regime T 46.1'],
                         ['mix2順位4 / opus-1', '平均T 52.11 / worst regime T 43.6'],
                         ['mix2順位5 / grok-1', '平均T 52.07 / worst regime T 45.1'],
                         ['mix2順位6 / cand(xb-r v3)', '平均T 51.63 / worst regime T 46.2'],
                         ['mix2順位7 / clean-arb', '平均T 49.88 / worst regime T 42.9'],
                         ['mix2順位8 / astra-1', '平均T 49.20 / worst regime T 42.1'],
                         ['mix2順位9 / astra-2', '平均T 49.07 / worst regime T 40.8'],
                         ['mix2順位10 / sonnet-2', '平均T 44.40 / worst regime T 30.0'],
                         ['mix2順位11 / multi-arb', '平均T 34.54 / worst regime T 23.5'],
                         ['48世界の範囲', 'mix1+mix2・seed40001–40004・12レジーム等重み。mix1の1世界BLOCKEDを含め全48世界を診断として保持'],
                         ['48世界順位1 / inc-zeta', '平均T 58.26 / worst regime T 46.8'],
                         ['48世界順位2 / venue-arb', '平均T 53.71 / worst regime T 42.5'],
                         ['48世界順位3 / sonnet-1', '平均T 52.92 / worst regime T 47.2'],
                         ['48世界順位4 / grok-1', '平均T 52.80 / worst regime T 45.1'],
                         ['48世界順位5 / cand(xb-r v3)', '平均T 51.91 / worst regime T 47.6'],
                         ['48世界順位6 / opus-1', '平均T 51.88 / worst regime T 44.5'],
                         ['48世界順位7 / clean-arb', '平均T 50.04 / worst regime T 42.8'],
                         ['48世界順位8 / astra-1', '平均T 49.14 / worst regime T 41.7'],
                         ['48世界順位9 / astra-2', '平均T 49.02 / worst regime T 42.5'],
                         ['48世界順位10 / sonnet-2', '平均T 44.70 / worst regime T 36.3'],
                         ['48世界順位11 / multi-arb', '平均T 35.63 / worst regime T 24.9'],
                         ['48世界の観測',
                          '[measured] mix1/mix2でseedを替えても順位は概ね安定（inc-zeta 1位・venue-arb 2位・multi-arb '
                          '11位）。mix1+mix2は12レジーム等重み・seed40001–40004の48世界。inc-zetaは平均T58.26、2位53.71との差は約4.5T（表示値の差4.55T）、最悪レジームT46.8。観測した混成場では明確な最強。cand(xb-r '
                          'v3)は平均T51.91・5位・最悪47.6で、sonnet-1/grok-1/opus-1と約1T以内（表示値ではsonnet-1との差1.01T、grok-1との差0.89T、opus-1との差0.03T）。'],
                         ['現時点の推測',
                          '[inferred] xb-r '
                          'v3とsonnet-1/grok-1/opus-1はこの集計では区別できないとの見立てで、統計検定の結果ではない。決定論ラインxb-rの追加改良より、混成場で強い既存の独自戦略inc-zeta=zeta-a30（Claude+Codex作成の本命）を提出基盤にする案が示唆される。ただしinc-zetaはF_ref契約(Q0)未通過。D0のF_ref診断はcommit不一致でG0 '
                          'FAIL、性能は診断のみ。'],
                         ['incz進行中・結果追記欄',
                          '[進行中・診断] inczはinc-zetaをF_refで12レジーム×seed40005=12世界。10/5 07:20 '
                          'JST頃開始との本人引継ぎ（旧05:40頃開始見込みを訂正）、約55分・08:15 '
                          'JST頃完了見込み。走行中・結果未確認・結果待ち。G0・完了数・完了時刻・性能・安全内訳は未確認。結果追記欄: '
                          '未受領。経過時間で完了としない。契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。']]},
 'h1_table': {'id': 'result-h1',
              'title': 'H1本人決定・実装の成立範囲・形式確認',
              'header': ['AIパイロット項目', 'rev 10の事実・境界'],
              'rows': [['本人決定・仮説',
                        '[本人決定 2026-10-04] '
                        'AI-PILOT-DESIGNのH1・推奨案「検査済み方針の選択+ENTRY」を選択。全面コード改訂（executorTs自由）は見送り。決定論の改良で大きな改善が見込めないなら、推論ありモードなど大きく改善される仮説へ切替える（本人提案）。'],
                       ['実装・安全境界',
                        '[measured・コード確認の引継ぎ] xb-r-ai '
                        'a95054aはH1を実装、テスト213・赤対照25。標準runtimeはdecide全体（executorTs）を差し替えるため、(a)固定テンプレ限定・(b)エージェント側検証のどちらも安全境界として成立せず、現状はON起動を拒否する。強制には運営側の受付機構/専用adapterが必要。提出物はruntimeを改変できず、scan-submissionのVENDOREDがBLOCKする。本番の改訂は事実上プロンプト誘導に頼り、機械的な安全保証はない。今回コード・テストの再確認はしていない。'],
                       ['H1の設定',
                        '3方針（v5標準 / v5+R11 / v5+R7厳格化）とENTRY 20–60bps・5bps刻み・最大±5bps。初期・復帰v5/50、更新なし120blockで復帰。旧rev '
                        '6のENTRY単独・初期60の署名契約は履歴として不変。'],
                       ['形式確認',
                        '[measured引継ぎ] agy GPT-OSS '
                        '120B（Medium・無料枠・本番と同系統のモデル）の形式確認はsparse/selection/injection各1回、validator '
                        'ok=true。sparseとinjectionはnullで期待どおり。selectionは答えを指定した形式試験で能力評価ではない。runtime/haiku/性能へ外挿しない。本人Ollama鍵の疎通確認や本番無料枠の検証ではない。'],
                       ['推論の費用方針',
                        '[方針] 課金なし。シミュレーション内の改訂はclaude-cli:haikuを第一、既存サブスクのcodex小型モデルを第二候補とする（利用可能なmodel '
                        'IDは未確認）。ローカルOllamaと本人のOllama鍵・無料枠（本番と共有）は使わない。追加課金・APIへの暗黙fallbackは認めない。'],
                       ['パイロット仕様・停止条件',
                        'H1専用adapterは未実装・標準ON拒否のまま。旧H1の32世界案は未解放。別系統xb-r-live（v3初期コード、標準runtime自由改訂）は同4レジーム×39001/39002・OFF1+ON3=32世界を測定しPILOT-STOP。使用済みseedをH1のfresh '
                        'seedとして再利用しない。'],
                       ['本人に残る判断',
                        '推奨はA: '
                        '混成場で強いinc-zetaを提出基盤の第一候補とし、Q0（F_ref・対multi-arb）をどう扱うかは本人判断。契約変更は提案のみ。Q0維持・追加起動停止のまま、走行中inczの結果受領と時間精算・受理工程の再計画を行う。 '
                        '10/4の全面改訂見送りは原記録に保持。sim内の自由改訂結果は、本番で安全保証なしで本番と同条件で測るかという判断や提出承認を代替しない。']],
              'sources': ['src-rev10', 'src-h1-pilot', 'src-h1-design'],
              'source_table': {'source': 'src-rev10', 'header_key': 'AIパイロット項目'}},
 'morning_ranking': {'header': ['順位', 'mix2 候補', 'mix2 平均T', 'mix2 最悪T', '48世界 候補', '48世界 平均T', '48世界 最悪T'],
                     'rows': [['1', 'inc-zeta', '61.54', '53.2', 'inc-zeta', '58.26', '46.8'],
                              ['2', 'venue-arb', '53.07', '39.5', 'venue-arb', '53.71', '42.5'],
                              ['3', 'sonnet-1', '52.49', '46.1', 'sonnet-1', '52.92', '47.2'],
                              ['4', 'opus-1', '52.11', '43.6', 'grok-1', '52.80', '45.1'],
                              ['5', 'grok-1', '52.07', '45.1', 'cand(xb-r v3)', '51.91', '47.6'],
                              ['6', 'cand(xb-r v3)', '51.63', '46.2', 'opus-1', '51.88', '44.5'],
                              ['7', 'clean-arb', '49.88', '42.9', 'clean-arb', '50.04', '42.8'],
                              ['8', 'astra-1', '49.20', '42.1', 'astra-1', '49.14', '41.7'],
                              ['9', 'astra-2', '49.07', '40.8', 'astra-2', '49.02', '42.5'],
                              ['10', 'sonnet-2', '44.40', '30.0', 'sonnet-2', '44.70', '36.3'],
                              ['11', 'multi-arb', '34.54', '23.5', 'multi-arb', '35.63', '24.9']]}}

REV12_OVERNIGHT_NOTE = 'rev 10時点の参考見積。mix2/incz分は含まず、mix1/mix2/inczとも実時間は未精算。OVERNIGHT §2.3: 00:26以降の開始/終了区間の和集合で計測・失敗・検査・非runを一度だけ計上し、p3を3倍しない。xa-1 smoke約13分×2 + live smoke約13分×2 + live本体32世界約150分 = 完了分の単純概算202分（3h22）。mix1約150分見込みを含む352分（5h52）は非重複仮定の参考見積で、確定占有ではない。開始/終了全区間・重複・修理/確認/非run・00:26前の当日分は不明。通常6h/日の残り8分とは認定しない。C_forward + R_remaining + N_next ≤ 100h、同一区間のC/R二重計上禁止。不明なら追加起動BLOCKED。'

REV11_LOG_DIGEST = '65a4cad0133101af4903ffb5905dcb9da40cab08f55776496f6261ff650ea6e6'

def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def block(document, name):
    start, end = f"<!-- {name}:start -->", f"<!-- {name}:end -->"
    require(document.count(start) == document.count(end) == 1,
            f"{name}: expected one marker pair")
    return document.split(start, 1)[1].split(end, 1)[0].strip()


def parsed_table(content):
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    require(len(lines) >= 3 and all(line.startswith("|") and line.endswith("|")
                                   for line in lines), "malformed table")
    cells = [[cell.strip() for cell in line[1:-1].split("|")] for line in lines]
    require(all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells[1]), "table separator")
    header = cells[0]
    require(len(set(header)) == len(header), "duplicate table column")
    require(all(len(row) == len(header) for row in cells[2:]), "table column count")
    return {"header": header, "rows": cells[2:]}


def table(document, name):
    obj = parsed_table(block(document, name))
    return [dict(zip(obj["header"], row)) for row in obj["rows"]]


def source_table(document, heading):
    require(document.count(heading) == 1, f"source heading: {heading}")
    match = re.search(r"(?m)^\|[^\n]+\n(?:\|[^\n]+\n)+", document.split(heading, 1)[1])
    require(match is not None, f"missing source table: {heading}")
    return match[0].rstrip()


_RESULT_LINES = [
    "PASS sources: D0/Q0/M1/Q0b tables retained; dev1/dev2 handoffs match plan/dashboard",
    "PASS Q0b: old 60-world result, G0 2-world FAIL and mean-T FAIL retained; no rescue rerun",
    "PASS budget: KEEP 100 h (G3 17.2, deep 9.7); archived unsigned AMEND 100 h; Q0 priority 5 h",
    "PASS queue: repair/rediagnosis -> Q0 -> acceptance; AI execution blocked by full-cost/evidence gates",
    "PASS decisions: 6 delegated Astra decisions with origin/signer/JST; Ollama registration/settings are user-reported; prepayment deferred",
    "PASS Q0: A unchanged; 1 new 60-world attempt; extra P/u1m conditions rejected; revert cap prospective only",
    "PASS AI: ENTRY_BPS 20-60, max step 5; R* ON3/OFF1 + S full = 216 worlds / 17.2 h; no epoch learning carryover",
    "PASS cutover: Oct 17 evidence gates select H480 / S240 / no campaign; no fresh deep exploration",
    "PASS schedule/review: 28 JST dates, 18 findings, five roadmap steps match dashboard",
    "PASS preservation: all 87 pre-rev12 logs unchanged; dec-008 resolved / dec-007 open with original dates; old safety nulls retained",
    "PASS current: dev4 measured 24-world handoff; dev5 measured, v5 not promoted; xa-1 stopped (3/3); mix1 measured diagnostic, 23 PASS / 1 BLOCKED; mix2 / 48 worlds measured; incz pending",
    "PASS operations: independent completion monitoring, 150/180 minute iterations, max 3, fresh 12x2 screen; not execution approval",
    "LIMIT: static consistency only; raw runs, actual hours, strategy safety, browser layout and acceptance unverified",
    "PASS rev9: H1 selected / standard ON refused / adapter unimplemented; agy format only; xa-1 stopped; H1 pilot gated; separate live pilot STOP",
    "PASS rev12: xa-1 unhealthy / live all ON dT negative / mix1 / mix2 / 48 worlds measured; incz pending / accounting unreconciled / human direction pending",
    "PASS check-plan-consistency",
]


def check_documents(document, html, morning, m1, ai, morning_new):
    require("revision 12" in document.splitlines()[0], "plan revision 12 title")
    sources = {"d0": source_table(morning, "## 2."),
               "q0": source_table(morning, "## 5."),
               "m1": source_table(m1, "## 結果")}
    for name, raw in sources.items():
        require(block(document, f"source-{name}") == raw,
                f"{name}: plan table must be verbatim from its source")

    budget = table(document, "budget-forward")
    totals = [row for row in budget if row["ID"] == "TOTAL"]
    require(len(totals) == 1, "budget TOTAL count")
    b = [row for row in budget if row["ID"] != "TOTAL"]
    require(len({row["ID"] for row in b}) == len(b) == 11, "budget IDs")
    amounts = {}
    for reading, column in (("keep", "維持h"), ("amend", "改訂h")):
        amounts[reading] = {r["ID"]: Fraction(r[column]) for r in b}
        require(all(v >= 0 for v in amounts[reading].values()), "negative budget")
        require(sum(amounts[reading].values()) == Fraction(totals[0][column]) == 100,
                f"budget {reading}: expected exactly 100 h")
    experiment_ids = [i.strip() for row in b for i in row["実験ID"].split(";")]
    require(len(experiment_ids) == len(set(experiment_ids)), "budget duplicate experiment")
    require(set(QUEUE[2:]) <= set(experiment_ids), "reserved experiments missing from budget")
    for reading in amounts:
        a = amounts[reading]
        require(a["historical"] == 0 and a["overnight"] == Fraction(26, 3), "history/overnight accounting")
        require(a["q0b"] == Fraction(143, 30), "Q0b full reservation")
        require(a["first-next"] == Fraction(13, 15) + Fraction(13, 3) + Fraction(13, 5) + Fraction(58, 15), "first path budget")
        require(a["reserve"] == 3 and a["deep"] <= 20, "approved reserve/exploration cap")
    require(amounts["keep"]["q0m"] == 0 and amounts["amend"]["q0m"] == Fraction(143, 30), "unsigned amendment reservation")
    require(amounts["keep"]["deep"] == Fraction(97, 10) and
            amounts["keep"]["final-g3"] == Fraction(86, 5), "decided AI allocation")
    require(amounts["amend"]["deep"] == Fraction(152, 15) and amounts["amend"]["final-g3"] == 12,
            "archived AMEND must remain unchanged")
    require(Fraction(149, 10) - amounts["keep"]["deep"] == amounts["keep"]["final-g3"] - 12 == Fraction(26, 5),
            "exact 5.2 h deep to G3 transfer")
    require(Fraction(149, 10) - amounts["amend"]["deep"] == amounts["amend"]["q0m"], "archived amendment transfer")
    require(amounts["keep"]["final-g2"] == 35 and amounts["keep"]["final-g4"] == 9, "final verification reservations")

    # Six separate 8-world chunks must not be costed as one 48-world chunk.
    batch = Fraction(13, 60)
    d0_cost = 6 * ((8 + 2) // 3) * batch
    q_lower, q_upper = 20 * batch, 22 * batch
    estimates = table(document, "chunk-estimates")
    require([r["推定h"] for r in estimates] == ["39/10", "13/3–143/30", "247/30–26/3", "13/3–143/30"], "chunk estimate table")
    require(d0_cost == Fraction(39, 10) and d0_cost + q_lower == Fraction(247, 30) and
            d0_cost + q_upper == Fraction(26, 3), "overnight ceil arithmetic")
    require(Fraction(1) + Fraction(13, 15) + 18 * batch == Fraction(173, 30) < 6,
            "amendment next-day window")

    stages = table(document, "deep-stages")
    require([r["ID"] for r in stages] == ["factor-ab", "m2", "e3-full", "q1"], "deep stage order")
    require([int(r["世界数"]) for r in stages] == [48, 60, 72, 60], "deep world counts")
    costs = {}
    for row in stages:
        cost = ((int(row["世界数"]) + 2) // 3) * batch
        require(cost == Fraction(row["13分/p3の正確h"]), "deep stage cost")
        costs[row["ID"]] = cost
    require(sum(costs.values()) == Fraction(52, 3), "full research shelf")
    require(sum(costs.values()) - costs["m2"] + Fraction(19, 10) == Fraction(149, 10) > amounts["keep"]["deep"],
            "old M2-skipped shelf no longer fits current deep allocation")
    require(amounts["amend"]["deep"] < 13, "amendment exploration must remain gated")

    queue = table(document, "next-24h")
    require([int(r["順序"]) for r in queue] == list(range(1, len(QUEUE)+1)), "queue numbers")
    require([r["実験ID"] for r in queue] == QUEUE, "queue priority")
    require(all(r["状態"] and r["窓"] and r["依存・停止"] for r in queue), "queue gates missing")
    expected_queue = [("12", "未見積"), ("0", "未見積"), ("60", "5"), ("0", "1/2"), ("12", "13/15"),
                      ("60", "143/30"), ("60", "13/3"), ("36", "13/5"),
                      ("0", "未見積"), ("48", "52/15"), ("48", "52/15"), ("60", "13/3")]
    require([(r["世界数"], r["全量見積h"]) for r in queue] == expected_queue, "queue worlds/hours")
    require(queue[0]["状態"] == "incz走行中・結果待ち" and queue[1]["状態"] == "証跡精算のみ・再走なし" and
            queue[2]["状態"] == "条件付き決定・実行停止" and queue[5]["状態"] == "不採用・旧未署名記録", "repair/requalification/archive state")
    require(all(queue[i]["状態"] == "停止" for i in (4, 6, 7)), "qualification queue needs Q0 evidence")
    require(queue[11]["状態"] == "不採用・0h配分", "M2 must remain zero allocation")
    require(3 * ((8 + 2) // 3) * batch == Fraction(39, 20), "D/E/parent independent-chunk cost")

    schedule = table(document, "schedule")
    dates = [date.fromisoformat(r["日付"]) for r in schedule]
    require(dates == [date(2026, 10, 4) + timedelta(days=i) for i in range(28)], "28 consecutive schedule dates")
    require(all(r["依存"] and r["停止・反転条件"] for r in schedule), "schedule gates")
    findings = table(document, "findings")
    require([r["ID"] for r in findings] == FINDINGS, "all 18 review findings")
    for row in findings:
        require(row["判定"] in {"accept", "partly", "reject"}, "finding disposition")
        require(all(re.search(r"\[(measured|inferred|unverified)(?::[^\]]+)?\]", row[k])
                    for k in ("根拠・理由（tag）", "正確な変更箇所・内容（tag）")), "finding evidence tags")
    for required in ("Q0-AMEND-01（未署名・失効記録・今回不採用）", "41201–41205", "原案の署名状態",
                     "Q0bの強弱でopusへ切替えない", "旧Q0 FAILは永久保持", "Q1へ自動拡張しない"):
        require(required in document, f"amendment safeguard missing: {required}")

    require(html is not None, "canonical dashboard is required")
    data = {name: json.loads(raw) for name, raw in re.findall(
        r'<script type="application/json" id="data-([\w-]+)">\s*(.*?)\s*</script>', html, re.S)}
    q0b = parsed_table(block(document, "source-q0b"))
    require(data["results"]["q0b"]["header"] == q0b["header"] and
            data["results"]["q0b"]["rows"] == q0b["rows"], "Q0b handoff table differs")
    for phrase in ("候補48.07 / multi-arb56.43", "6/60世界", "A=PASS / B=FAIL / C=PASS",
                   "loopIterations=361、必要362", "648/531ms", "最小+2.05", "最大+25.74"):
        require(phrase in block(document, "source-q0b"), "Q0b fact missing: "+phrase)
    qs = data["results"]["q0b_summary"]
    require(qs["candidate_t"] == "48.07" and qs["multi_t"] == "56.43" and
            qs["noop_below"] == "6/60" and qs["g0_failed_worlds"] == 2, "Q0b summary mismatch")
    require(all(qs[key] is None for key in ("violations", "failed_reads", "invalid_orders", "reverts")),
            "Q0b uncollected safety must remain null, not zero")
    status = data["status"]["q0b"]
    require(status["state"] == "failed" and status["completed_worlds"] == status["worlds"] == 60,
            "Q0b completed FAIL status")
    require(status["expected_end"] is None and status["completed_at"] is None and
            data["status"]["measurement_as_of"] is None, "unreported times must stay unknown")
    require("終了見込み ${" not in html, "renderer must not show a stale forecast")
    for phrase in ("Q0bへ自動適用しない", "今回の平均T条件の不合格は動かない",
                   "第2候補1回まで", "損失許容を事前明文化", "延期・設計修理は本人決定済み",
                   "Q0b結果が既知", "別版", "10/8は旧受理目標、延期済み"):
        require(phrase in document, "post-Q0b safeguard missing: "+phrase)
    require("**22.9333–23.3667h相当＋未計上分**" in document, "baseline plus Q0b estimate")
    require("17.4333hの基本見積" in document, "conditional Q0m path estimate")
    path_cost = Fraction(1) + Fraction(13,15) + Fraction(143,30) + Fraction(13,3) + Fraction(13,5) + Fraction(58,15)
    require(path_cost == Fraction(523,30), "conditional path arithmetic")
    budget_data = data["budget"]
    require(budget_data["consumed_lower_bound_hours"] == "18.6" and budget_data["consumed_exact_hours"] is None,
            "actual consumption must not be inferred from estimates")
    estimate = budget_data["consumption_estimate"]
    require(Fraction(estimate["baseline_plus_q0b_min"]) == Fraction("18.6") + q_lower and
            Fraction(estimate["baseline_plus_q0b_max"]) == Fraction("18.6") + q_upper,
            "baseline plus Q0b estimate arithmetic")
    for column, reading in (("keep_hours", "keep"), ("amend_hours", "amend")):
        require({r["id"].removeprefix("budget-"): Fraction(r[column]) for r in budget_data["rows"]} == amounts[reading],
                "dashboard budget differs: "+reading)
    dq = data["queue"]["items"]
    require([q["experiment"] for q in dq] == QUEUE, "dashboard queue order")
    for r, q in zip(queue, dq):
        require((q["priority"], q["state"], q["worlds"], q["hours"], q["window"], q["dependency"]) ==
                (int(r["順序"]), r["状態"], int(r["世界数"]), None if r["全量見積h"] == "未見積" else r["全量見積h"], r["窓"], r["依存・停止"]),
                "dashboard queue row differs: "+r["実験ID"])
    require(dq[0]["active"] is True and all(not q["active"] for q in dq[1:]),
            "only reported incz may be active; Q0 and downstream remain blocked")
    require(dq[0]['worlds'] == 12 and dq[0]['hours'] is None and '契約・資格とは無関係' in dq[0]['dependency'], 'incz known scope, unknown actual cost and qualification boundary')
    require('35001/35002はdev3診断で既見のため再利用不可' in dq[9]['dependency'],
            'D-control cannot silently reuse dev3 development seeds')
    milestones = data["milestones"]["items"]
    require([(m["date"], m["title"], m["dependency"], m["stop"]) for m in milestones] ==
            [(r["日付"], r["主な出口"], r["依存"], r["停止・反転条件"]) for r in schedule], "dashboard schedule differs")
    decisions = {d["id"]: d for d in data["decisions"]["items"]}
    for identity, due, state in (("dec-008", "2026-10-07", "resolved"), ("dec-007", "2026-10-28", "open")):
        require(decisions[identity]["status"] == state and decisions[identity]["due_date"] == due and
                decisions[identity]["date"] == "2026-10-03",
                "existing human operation changed: "+identity)
    require(decisions["dec-amend"]["status"] == "unsigned", "no automatic amendment signature")
    # Revision 6 records explicit delegated decisions, never a forged Masashi signature.
    require(ai is not None and "AI-G3-01" in ai and "MASTER revision 6" in ai, "AI design revision")
    require("DESIGN-AI-LAYER-01-astra.md" in document, "AI design link")
    for n, identity in enumerate(DECISION_IDS, 1):
        d = decisions[identity]
        require(d["status"] == "decided" and d["issue"] == n and d["origin"] == ORIGIN and d["signer"] == SIGNER,
                "delegated decision provenance: " + identity)
        require(re.fullmatch(r"2026-10-04T\d{2}:\d{2}:\d{2}\+09:00", d["signed_at"]) is not None,
                "decision signature timestamp: " + identity)
        require(d["signed_at"] <= data["status"]["as_of"] and d["signed_at"] in document and d["signed_at"] in ai,
                "decision signature document correspondence")
        require(ORIGIN in d["note"] and SIGNER in d["note"], "visible decision provenance")
    for doc in (document, ai):
        require(ORIGIN in doc and "署名者=" + SIGNER in doc and "署名日時=" in doc, "document decision signature")
        require("______" not in doc, "no empty signature placeholders")
        require("本人の承認" in doc and "自動チャージ" in doc and "残高" in doc and "鍵登録" in doc,
                "human-only scope disclosure")
        require("凍結性能は改訂ON性能の代用にならない" in doc, "ON evidence boundary")
        require("17.2h" in doc and "9.7h" in doc and "10/17" in doc, "allocation and cutover prose")
    require(data["decisions"]["human_only"] == REV12_EXPECTED["human_only"],
            "full executor authority remains a pending human decision; registration and cost boundaries retained")
    require(all(decisions[i]["status"] == "decided" for i in ("dec-step1-policy", "dec-q0-keep", "dec-original", "dec-forward")),
            "prior settled decisions must stay decided")
    ac = data["plan"]["ai_contract"]
    require(ac["status"] == "decided" and ac["name"] == "AI-G3-01" and ac["origin"] == ORIGIN and
            ac["signer"] == SIGNER and ac["signed_at"] == decisions["dec-ai-contract"]["signed_at"], "AI delegated signature")
    require(ac["execution_status"] == "blocked-evidence-and-costs" and ac["api_budget_status"] == "無料枠不足時の前払い判断はG3見積もり後",
            "decision is not execution/money approval")
    require((ac["on_repeats"], ac["off_repeats"], ac["market_cells"]) == (3, 1, 36), "AI repetition contract")
    worlds = ac["market_cells"] * (ac["on_repeats"] + ac["off_repeats"])
    require(ac["candidate_worlds"] == worlds == 144 and ac["s_worlds"] == 72 and
            ac["selected_total_worlds"] == worlds + ac["s_worlds"] == 216, "asymmetric G3 worlds")
    one = Fraction(worlds, 3) * batch + Fraction(8, 5)
    fallback = Fraction(ac["s_worlds"], 3) * batch
    total = one + fallback
    require(Fraction(ac["one_candidate_hours"]) == one == 12 and Fraction(ac["s_full_hours"]) == fallback == Fraction(26, 5),
            "R* 12 plus S 5.2")
    require(Fraction(ac["selected_total_hours"]) == total == amounts["keep"]["final-g3"] == Fraction(86, 5), "total 17.2 h")
    require(Fraction(ac["two_candidate_hours"]) == Fraction(112, 5) and ac["two_candidate_status"] == "rejected-both-repeat",
            "both-candidate repetition is rejected")
    require(Fraction(ac["extra_hours"]) == total - 12 == Fraction(26, 5), "G3 transfer")
    require(ac["s_full_evidence"] == "unverified", "cannot assume reusable S evidence")
    require(Fraction(ac["keep_deep_after_transfer"]) == amounts["keep"]["deep"] == Fraction(97, 10), "deep residual")
    require(ac["e3_q1_mode"] == "ON-decided" and ac["epoch_learning_carryover"] is False, "AI mode/reset")
    require(Fraction(ac["e3_q1_base_hours"]) == costs["e3-full"] + costs["q1"] == Fraction(143, 15), "AI downstream cost")
    require(ac["d_control_worlds"] == 48 and Fraction(ac["d_control_base_hours"]) == Fraction(48, 3) * batch == Fraction(52, 15)
            and ac["d_control_cost_status"] == "unreserved", "D control cost cannot disappear")
    require(Fraction(ac["e3_q1_base_hours"]) + Fraction(ac["d_control_base_hours"]) > amounts["keep"]["deep"],
            "AI full path not released")
    params = parsed_table(block(document, "ai-parameters"))
    require(params == parsed_table(block(ai, "ai-parameters")), "parameter contract source mismatch")
    require(data["plan"]["ai_parameters"]["header"] == params["header"] and data["plan"]["ai_parameters"]["rows"] == params["rows"],
            "parameter contract dashboard mismatch")
    require(params["rows"] == [["ENTRY_BPS（新規entryの入口だけ）", "60 bps", "20–60 bps", "5 bps", "±5 bps", "60 block以上"]],
            "allowlist and bounded updates")
    for phrase in ("return/submit", "canFund", "120block", "未解消在庫", "20bps", "政策値"):
        require(phrase in document and phrase in ai, "parameter boundary/rationale: " + phrase)
    q = data["plan"]["q0_requalification"]
    require((q["option"], q["status"], q["candidate_limit"], q["attempt_limit"], q["worlds"], q["mode"], q["field"]) ==
            ("A", "decided", 1, 1, 60, "FROZEN", "F_ref"), "Q0 A fixed one-attempt contract")
    require(q["seeds"] == "41301–41305" and Fraction(q["hours_cap"]) == 5 and q["within_deep"] is True and
            q["execution_status"] == "blocked-repair-rediagnosis-hash-cost", "Q0 fresh inputs/cost/repair gate")
    require(all(q[k] is False for k in ("extra_p_vs_multi", "extra_all_world_p_minus_noop", "extra_absolute_p",
                                       "extra_u1m_noninferiority", "extra_submit_failure_noninferiority")), "extra conditions explicitly rejected")
    require("追加条件" in document and "不採用" in document and "5h上限枠" in document, "Q0 contract prose")
    revert = data["plan"]["revert_contract"]
    require(revert["status"] == "decided" and revert["worlds_per_set"] == 60 and revert["max_count"] == 1 and
            Fraction(revert["max_ratio"]) == Fraction(1, 1000) and revert["retroactive"] is False and
            revert["reject_unknown_cause_or_recovery"] is True, "prospective count AND ratio revert cap")
    for phrase in ("旧結果へ遡及", "≤0.1%", "≤1件", "全包含取引", "片脚回収不明"):
        require(phrase in document and phrase in ai, "revert contract prose: " + phrase)
    cut = data["plan"]["cutover"]
    require(cut["at"] == "2026-10-17T18:00:00+09:00" and cut["h480_requires"] ==
            ["受理S", "Dへの正の増分", "固定R* E3/Q1/G3", "校正後の全残費100h内", "期限内の全日程確保"], "Oct 17 H480 evidence gates")
    require(cut["fallback"] == "AI終了、適合受理Sと全費用ならS240、それ以外H未実施" and
            "10/17から新規探索なし" in cut["deep_switch"], "S240/no-H and no fresh research")
    dev1 = data["status"]["dev1"]
    require(dev1["state"] == "measured-diagnostic-complete" and dev1["verified"] is False and dev1["completed_at"] is None,
            "dev1 measured handoff is not raw/live audit or invented time")
    require((dev1["g0"], dev1["loops"], dev1["worlds"], dev1["regimes"], dev1["seeds"], dev1["p_minus_noop_all_worlds"],
             dev1["trades"], dev1["reported_skip_count"], dev1["q0_eligible"]) ==
            ("PASS", 362, 12, 6, "31001/31002", "0.0", 0, 361, False), "dev1 diagnosis/qualification boundary")
    devtable = parsed_table(block(document, "source-dev1"))
    require(data["results"]["dev1"]["header"] == devtable["header"] and data["results"]["dev1"]["rows"] == devtable["rows"],
            "dev1 source table")
    require("現状Q0資格不可" in document and "現状Q0資格不可" in ai and "延期済み" in data["status"]["notice"],
            "current state not success")
    # Immutable historical entries: corrections are new logs, never edits of prior events.
    prior = [log for log in data["log"]["items"] if log["id"] in {f"log-{i:03}" for i in range(1, 61)}]
    require(len(prior) == 60 and digest(prior) == PRIOR_LOG_DIGEST, "prior 60 log entries changed")
    before_redesign = [log for log in data['log']['items'] if log['id'] in {f'log-{i:03}' for i in range(1,66)}]
    require(len(before_redesign) == 65 and digest(before_redesign) == REDESIGN_LOG_DIGEST,
            'all 65 pre-redesign log entries must be preserved byte-for-value')
    dev2 = data["status"]["dev2"]
    require((dev2["state"], dev2["verified"], dev2["field"], dev2["worlds"], dev2["regimes"], dev2["seeds"], dev2["fix_commit"]) ==
            ("measured-diagnostic-complete", False, "F_ref", 12, 6, "31001/31002", "2ae0d59"), "dev2 measured diagnostic handoff")
    expected_dev2 = dict(p_candidate='149.0', p_multi='1352.2', trades_candidate='44.8', trades_multi='300.9',
                        t_candidate='44.36', t_multi='56.84', min_p_minus_noop='+147.7', positive_worlds=12,
                        noop_below=0, violations=0, reverts=0)
    require(dev2['result'] == expected_dev2 and dev2['g0'] == 'PASS' and dev2['q0_eligible'] is False,
            'dev2 measured numbers and diagnosis/qualification boundary')
    require(dev2['completed_at'] is None and dev2['expected_end'] is None and 'measured' in dev2['evidence_basis'],
            'dev2 completion clock is unknown and obsolete forecast retired')
    dev2_table = parsed_table(block(document, 'source-dev2'))
    require(data['results']['dev2']['header'] == dev2_table['header'] and data['results']['dev2']['rows'] == dev2_table['rows'],
            'dev2 table must match MASTER handoff')
    for value in ('149.0', '1352.2', '44.8', '300.9', '44.36', '56.84', '+147.7'):
        require(value in block(document, 'source-dev2'), 'dev2 handoff value missing: '+value)
    dev3 = data['status']['dev3']
    require((dev3['name'], dev3['state'], dev3['verified'], dev3['field'], dev3['seeds'], dev3['regimes'], dev3['worlds'],
             dev3['started_at'], dev3['expected_end'], dev3['fix_commit'], dev3['next_chunk_regimes']) ==
            ('dev3a-xb-r', 'measured-diagnostic-complete', False, 'F_ref', '35001/35002', 9, 18,
             '2026-10-04T16:24:00+09:00', None, 'a646e9b', 3), 'dev3a measured scope; obsolete forecast retired')
    require((dev3['completed_at'],dev3['completed_at_precision'],dev3['completed_worlds'],dev3['g0'],dev3['q0_eligible']) ==
            ('2026-10-04T17:39:00+09:00','minute',18,'PASS',False), 'dev3a minute-precision completion, G0 and qualification boundary')
    require('本人提示' in dev3['completed_at_basis'] and '実測秒ではない' in dev3['completed_at_basis'] and
            dev3['started_at'] < dev3['completed_at'] <= data['status']['as_of'] and 'measured' in dev3['evidence_basis'],
            'dev3a handoff/time provenance, not a raw-log audit')
    expected_dev3 = dict(p_candidate='842.3',p_multi='2032.9',p_clean='1050.3',
                        trades_candidate='54.4',trades_multi='288.7',trades_clean='61.3',
                        t_candidate='46.83',t_multi='55.93',positive_worlds=18,min_p_minus_noop=None,
                        noop_below=0,violations=0,reverts=0,submit_failed=27,submitted=980,
                        regime_t=[dict(regime='informed-flow',candidate='55.23',multi='36.01'),
                                  dict(regime='lending-incident',candidate='52.52',multi='49.15'),
                                  dict(regime='vuln',candidate='49.35',multi='50.10')])
    require(dev3['result'] == expected_dev3, 'dev3a exact supplied numbers; no invented minimum or other regimes')
    dev3_table = parsed_table(block(document, 'source-dev3a'))
    require(data['results']['dev3a']['header'] == dev3_table['header'] and
            data['results']['dev3a']['rows'] == dev3_table['rows'], 'dev3a MASTER/dashboard table correspondence')
    for phrase in ('9レジーム18世界', '842.3', '2032.9', '1050.3', '54.4', '288.7', '61.3',
                   '46.83', '55.93', '55.23', '36.01', '52.52', '49.15', '49.35', '50.10',
                   'submit_failed 27 / submitted 980', '最小値は未提示', '全18世界で正 / 0', '勝利/統計的同等ではない'):
        require(phrase in block(document,'source-dev3a'), 'dev3a source fact missing: '+phrase)
    dev3b, v3 = data['status']['dev3b'], data['status']['repair_v3']
    require((dev3b['state'],dev3b['verified'],dev3b['regimes']) == ('historical-unverified',False,3),
            'dev3b is historical unverified handoff, not the current run')
    require(all(dev3b[k] is None for k in ('seeds','worlds','started_at','expected_end','completed_at',
                                         'completed_worlds','g0','result','fix_commit')), 'dev3b unknowns must remain null')
    require(v3['state'] == 'implemented-reported' and v3['verified'] is False and
            v3['commit'] == 'd30cbbb' and v3['result_ref'] == 'status.dev4' and
            all(v3[k] is None for k in ('tests','result')), 'v3 reported hash; tests unknown, performance references dev4')
    op = data['plan']['continuous_operation']
    expected_op = dict(status='defined-not-verified',monitor_status='unverified',iteration_start='v3-first-smoke',
                       iteration_target_minutes=150,iteration_limit_minutes=180,iteration_limit=3,
                       monitor_interval_seconds=60,detect_minutes=2,ack_minutes=5,next_minutes=10,
                       smoke_minutes_cap=10,chunk_minutes_cap=110,validation_worlds=24,validation_regimes=12,
                       validation_seeds=2,mean_t_delta_min='0',regime_t_noop_min='0',diagnostic_revert_max=0,
                       qualification_seeds_excluded='41301–41305',budget_status='unreconciled-not-released')
    require(all(op[k] == v for k,v in expected_op.items()), 'operating limits and diagnostic screen are fixed, execution unverified')
    require(op['stages'] == parsed_table(block(document,'continuous-stages')) and
            op['screen'] == parsed_table(block(document,'diagnostic-screen')), 'operation tables match MASTER')
    for phrase in ('起動シェル終了≠計測完了', '全ジョブに', '全予定世界の終端記録', '通知設定/テスト受信',
                   '60秒以下', '2分以内', '5分以内', '10分以内', '調整/短縮smoke/診断検証/Q0のseed交差0',
                   '12レジーム等重み平均(Tcand−Tmulti)≥0', '各12レジームの平均(Tcand−Tnoop)≥0',
                   'cand submitted>0・包含成功>0', '実ログ由来入力を必須', '上限180分', '目標150分',
                   '最大3回', '本人へ結果・最悪値・失敗理由・残費を報告', 'G0 FAIL/安全違反/入力hash不一致',
                   '開始時空き39.5GiB', '緊急下限25GB', '既決20h/2新世代', '3回分の枠は未解放'):
        require(phrase in document, 'continuous-operation safeguard missing: '+phrase)
    repair = data['status']['repair_v2']
    require((repair['commit'],repair['tests'],repair['red_controls'],repair['verified'],repair['evidence_kind']) ==
            ('a646e9b',123,25,False,'measured引継ぎ'), 'v2 implementation/test evidence cannot become fresh verification')
    require('123' in document and '赤対照25' in document and '16:24 JST開始' in document and '17:39 JST完了' in document,
            'v2/dev3 MASTER handoff missing')
    require(data['status']['human_action'] == REV10_EXPECTED['human_action'] and data['budget']['consumed_forward_hours'] is None and
            data['budget']['consumption_status'] == '未精算', 'human action and unknown forward consumption')
    require(data['plan']['revision'] == 12 and data['plan']['deadline_at'] == '2026-10-31T23:59:00+09:00',
            'revision and submission deadline')
    report = data["decisions"]["ollama_report"]
    require(report["evidence_kind"] == "本人報告" and report["registration"] == "accepted-display-reported" and
            report["cloud_key_and_email_match"] == "confirmed-by-user", "Ollama report provenance")
    require((report["plan"], report["free_usage"], report["balance_usd"], report["auto_reload"]) ==
            ("Free", "0%", "0", "Off"), "reported Ollama account settings")
    require(report["free_models"] == ["gemma4:31b", "gpt-oss:120b", "gpt-oss:20b", "nemotron-3-nano:30b", "nemotron-3-super", "nemotron-3-ultra"] and
            report["assumed_model"] == "gpt-oss:120b" and report["assumption_approved_by_user"] is True,
            "reported models and approved assumption")
    require(all(report[k] is False for k in ("official_model_list_verified", "free_quota_sufficiency_verified", "key_connectivity_verified")),
            "unverified provider checks cannot become confirmed")
    require(report["clipboard_cleared"] == "reported-by-user" and report["attentionctl_status"] == "resolved-reported",
            "clipboard/attentionctl are user reports")
    require(data["blockers"]["items"][0]["title"] == "資格試験に必要な収益性が不足" and
            data['status']['priority']['blocker_ref'] == data['blockers']['items'][0]['id'],
            "Q0 contract is first blocker")
    progress = {i["id"]: i for i in data["progress"]["items"]}
    require(progress["progress-dev2"]["state"] == "done" and progress['progress-dev3']['state'] == 'done' and
            progress['progress-dev3b']['state'] == 'pending' and progress['progress-xbr-v3']['state'] == 'done' and
            progress['progress-dev4']['state'] == progress['progress-xbr-v5']['state'] == 'done' and
            progress['progress-dev5']['state'] == 'done' and progress['progress-plateau']['state'] == 'running' and
            progress['progress-xa1']['state'] == 'failed' and progress['progress-live']['state'] == 'done' and
            progress['progress-mix1']['state'] == 'done' and progress['progress-mix2']['state'] == 'done' and progress['progress-mix48']['state'] == 'done' and progress['progress-incz']['state'] == 'running' and
            progress['progress-xbr-v2']['state'] == 'done' and progress["progress-xbr-requal"]["state"] == "blocked" and
            progress["progress-ollama"]["state"] == "done", "diagnosis/qualification/registration states are separate")
    require([i["id"] for i in data["log"]["items"][:-60]] == [f"log-{i:03}" for i in range(len(data["log"]["items"]), 60, -1)],
            "logs must be consecutive and prepended")
    roadmap = table(document, "ai-roadmap")
    protocols = {p["id"]: p for p in data["plan"]["protocol"]}
    step_ids = ["protocol-first", "protocol-ai-min", "protocol-ai-eval", "protocol-sealed", "protocol-ai-release"]
    require(len(roadmap) == len(step_ids) == 5, "five AI roadmap steps")
    for step, identity in zip(roadmap, step_ids):
        protocol = protocols[identity]
        require(protocol["title"] == step["Step"] and
                protocol["body"] == step["期間JST"] + "。入口: " + step["入口"] and
                protocol["exit"] == step["出口"] + "。" + step["費用・停止・本人判断"], "AI roadmap/dashboard mismatch: " + identity)
    require(any(s["path"] == "ascon-notes/league/DESIGN-AI-LAYER-01-astra.md" for s in data["sources"]["sources"]), "dashboard AI source missing")
    # Visible comparisons use references to exactly these populations, never cross-field T differences.
    comparisons = data['results']['comparison']
    require([r['scope_ref'] for r in comparisons['diagnostic']] == ['status.dev5','status.dev4','status.dev3','status.dev2','status.dev1','status.xa1.measured_scope','status.live','status.mix1','status.mix2','status.mix48','status.incz'],
            'diagnostic comparison populations')
    require([r['scope_ref'] for r in comparisons['qualification']] ==
            ['plan.q0_requalification','results.q0.scope','status.q0b'], 'qualification comparison populations')
    require([r['state'] for r in comparisons['qualification']] == ['blocked','failed','failed'],
            'visible qualification statuses must preserve failures')
    require(comparisons['diagnostic'][3]['metrics'] == [
        dict(label='平均P',candidate_ref='status.dev2.result.p_candidate',baseline_ref='status.dev2.result.p_multi'),
        dict(label='平均取引数',candidate_ref='status.dev2.result.trades_candidate',baseline_ref='status.dev2.result.trades_multi'),
        dict(label='平均T',candidate_ref='status.dev2.result.t_candidate',baseline_ref='status.dev2.result.t_multi')],
        'visible dev2 metrics cannot substitute another run or unit')
    require(comparisons['diagnostic'][2]['metrics'] == [
        dict(label='平均P',candidate_ref='status.dev3.result.p_candidate',baseline_ref='status.dev3.result.p_multi'),
        dict(label='平均取引数',candidate_ref='status.dev3.result.trades_candidate',baseline_ref='status.dev3.result.trades_multi'),
        dict(label='平均T',candidate_ref='status.dev3.result.t_candidate',baseline_ref='status.dev3.result.t_multi')]
        and comparisons['diagnostic'][2]['state'] == 'warning' and comparisons['diagnostic'][2]['safety_ref'] == 'status.dev3',
        'visible dev3a numbers/population/status must match handoff')
    # Rev 8 adds exact current facts without relaxing any historical or safety contract.
    rev7_logs = [x for x in data['log']['items'] if x['id'] in {f'log-{i:03}' for i in range(1,69)}]
    require(len(rev7_logs) == 68 and digest(rev7_logs) == REV7_LOG_DIGEST, 'all 68 prior logs are immutable')
    dev4, dev5 = data['status']['dev4'], data['status']['dev5']
    expected_dev4 = {'name': 'dev4-xb-r', 'state': 'measured-diagnostic-complete', 'verified': False, 'evidence_basis': '本人提示measured集計。原ログ/live再監査なし', 'field': 'F_ref', 'seeds': '36001/36002', 'regimes': 12, 'worlds': 24, 'completed_worlds': 24, 'fix_commit': 'd30cbbb', 'g0': 'PASS', 'loops': 362, 'started_at': None, 'completed_at': None, 'expected_end': None, 'q0_eligible': False, 'result': {'t_candidate': '49.72', 't_multi': '55.02', 't_gap': '5.3', 'min_regime_t_minus_noop': '+7.85', 'positive_regimes': 12, 'noop_below': 0, 'violations': 0, 'reverts': 0, 'submitted': 1652, 'submit_failed': 23, 'submit_failed_percent': '1.4', 'p_candidate': '488.2', 'p_multi': '1460.8', 'p_clean': '440.0', 'trades_candidate': '68.8', 'trades_multi': '273.4', 'trades_clean': '46.3', 'regime_t': [{'regime': 'calm', 'candidate': '56.12', 'multi': '35.90'}, {'regime': 'crash', 'candidate': '52.45', 'multi': '50.31'}, {'regime': 'vuln', 'candidate': '54.14', 'multi': '48.69'}, {'regime': 'spike', 'candidate': '50.20', 'multi': '49.99'}, {'regime': 'depeg-persist', 'candidate': '57.02', 'multi': '50.54'}, {'regime': 'launch', 'candidate': '53.46', 'multi': '49.92'}, {'regime': 'whale', 'candidate': '38.86', 'multi': '62.79'}, {'regime': 'cex-drift', 'candidate': '45.67', 'multi': '63.80'}, {'regime': 'depeg', 'candidate': '42.73', 'multi': '63.85'}, {'regime': 'lending-incident', 'candidate': '46.48', 'multi': '63.61'}, {'regime': 'cdp-incident', 'candidate': '47.24', 'multi': '62.98'}, {'regime': 'informed-flow', 'candidate': '52.33', 'multi': '57.81'}]}, 'note': 'v3の全12レジーム等重み平均Tはmulti-arb未達。全レジーム平均(T−Tnoop)>0、最小+7.85。診断完了であり資格合格ではない。', 'sources': ['src-dev4']}
    require(dev4 == expected_dev4, 'dev4 exact handoff: scope/hash/G0/loops/values/all 12 regimes and unknown times')
    require(dev5 == REV10_EXPECTED['dev5'], 'dev5 measured T only; no invented G0/safety/completion clock or qualification')
    require(data['status']['repair_v5'] == REV10_EXPECTED['repair_v5'], 'v5 not promoted; initial tests inherited')
    require(data['status']['team'] == REV10_EXPECTED['team'], 'team and agy invocation restrictions')
    require(data['status']['plateau'] == {'name': 'PLATEAU-ANALYSIS', 'state': 'reported-creating-unverified', 'owner': 'Codex', 'result': None, 'verified': False, 'note': '構造の異なる独自設計候補の検討をAstraが別ジョブで作成中。結果未確認。新規計測・採用・予算追加を意味しない。', 'sources': ['src-operations']}, 'PLATEAU remains a separate unverified job')
    require(op['iteration_current'] == 3 and op['current_run_ref'] == 'status.incz', 'iteration 3/3 stopped; current incz is only diagnostic')
    for key, marker, expected in [('dev4', 'source-dev4', {'header': ['dev4-xb-r項目', '提示された結果', '判定・範囲'], 'rows': [['母集団・G0', 'v3 d30cbbb・F_ref・seed36001/36002・12レジーム24世界 / G0 PASS / 362ループ', '本人提示measured。原ログ再監査なし'], ['12レジーム等重み平均T', 'cand 49.72 / multi-arb 55.02（差5.3T）', '平均T条件未達・資格合格ではない'], ['レジーム平均(T−Tnoop)', '全12レジームで正 / 最小+7.85', 'レジーム平均の最小値。世界別Pの最小値ではない'], ['noop割れ / violations / cand revert', '0 / 0 / 0', '未提示の安全項目は補完しない'], ['送信 / 送信失敗', 'submitted 1652 / failed 23（1.4%）', '失敗率は23/(1652+23)の丸め。mined revertと別'], ['1世界平均P', 'cand 488.2 / multi-arb 1460.8 / clean-arb 440.0', '同じ24世界'], ['1世界平均取引数', 'cand 68.8 / multi-arb 273.4 / clean-arb 46.3', '同じ24世界']]}), ('dev4_regimes', 'source-dev4-regimes', {'header': ['dev4レジーム', 'cand 平均T', 'multi-arb 平均T', '比較'], 'rows': [['calm', '56.12', '35.90', 'candが上回る'], ['crash', '52.45', '50.31', 'candが上回る'], ['vuln', '54.14', '48.69', 'candが上回る'], ['spike', '50.20', '49.99', 'candが上回る'], ['depeg-persist', '57.02', '50.54', 'candが上回る'], ['launch', '53.46', '49.92', 'candが上回る'], ['whale', '38.86', '62.79', 'candが下回る'], ['cex-drift', '45.67', '63.80', 'candが下回る'], ['depeg', '42.73', '63.85', 'candが下回る'], ['lending-incident', '46.48', '63.61', 'candが下回る'], ['cdp-incident', '47.24', '62.98', 'candが下回る'], ['informed-flow', '52.33', '57.81', 'candが下回る']]})]:
        require(parsed_table(block(document, marker)) == expected, 'exact dev4 MASTER source table: '+key)
        require({k:data['results'][key][k] for k in ('header','rows')} == expected, 'exact dev4 dashboard source table: '+key)
    require(comparisons['diagnostic'] == REV12_EXPECTED['comparison'], 'all diagnostic scopes, metrics and pending results exact')
    require([k['ref'] for k in data['ui']['kpis'][:2]] == ['status.mix48.name','status.mix48.result.t_leader'], 'KPI uses latest completed mixed diagnostic, not qualification')
    require(data['status']['priority']['progress_refs'] == ['progress-dev4','progress-dev5','progress-xa1','progress-live','progress-xbr-requal'], 'current priority progression')
    for phrase in ('v5 = v3 + R9(bundle用在庫余地)ON','7b1448b','2026-10-04 22:07 JST開始','2026-10-05 00:00 JST頃','2/3回目',
                   'Codex(Astra)主・Claude副','利用残高切れ(402)','Gemini 3.8 Flash High','masa-harness#409','Claudeの別エージェント+agy',
                   'ツール使用禁止・差分埋め込み・`echo "" | …`','PLATEAU-ANALYSIS','Astraが作成中、結果未確認',
                   '平均対応ΔT≥+1.0','各レジームΔT≥−2.0','failed率≤23/1675','片脚bundle率≤2/114','成功bundle数≥143 ID'):
        require(phrase in document, 'rev8 current prose missing: '+phrase)
    glossary = parsed_table(block(document, 'glossary'))
    require(glossary['header'] == ['用語','説明'] and glossary['rows'] ==
            [[t['term'],t['definition']] for t in data['glossary']['items']], 'glossary definition source mismatch')
    rev8_logs = [x for x in data['log']['items'] if x['id'] in {f'log-{i:03}' for i in range(1,74)}]
    require(len(rev8_logs) == 73 and digest(rev8_logs) == REV8_LOG_DIGEST, 'all 73 prior logs and every field are immutable')
    prior_decisions = [x for x in data['decisions']['items'] if x['id'] in REV8_DECISION_IDS]
    require(digest(prior_decisions) == REV8_DECISIONS_DIGEST, 'all prior decision records/signatures/dates unchanged')
    for name in ('h1', 'pilot'):
        require(data['plan'][name] == REV9_EXPECTED[name], 'rev9 exact plan contract: '+name)
    for name in ('agy_format',):
        require(data['status'][name] == REV9_EXPECTED[name], 'rev9 inherited evidence, never fresh verification: '+name)
    require(data['results']['h1'] == REV12_EXPECTED['h1_table'], 'H1 visible facts and evidence boundaries exact')
    require(parsed_table(block(document, 'h1-current')) == {k:REV12_EXPECTED['h1_table'][k] for k in ('header','rows')}, 'MASTER H1 current contract matches dashboard')
    require([decisions[x['id']] for x in REV9_EXPECTED['decisions']] == REV9_EXPECTED['decisions'], 'rev9 H1/production authority records preserved; live simulation does not change them')
    require(data['plan']['pilot']['worlds'] == len(data['plan']['pilot']['regimes']) * len(data['plan']['pilot']['seeds']) * (data['plan']['pilot']['off_repeats'] + data['plan']['pilot']['on_repeats']), 'pilot world arithmetic')
    for phrase in ('7179efe','時間制限付き単脚往復+lot台帳','テスト39・赤対照39','smoke 38003','38001/38002×12=24世界','約104分+終了確認','第3回はsmokeで打ち切り','H1（xb-r-ai）はON拒否を維持','契約変更は未決定'):
        require(phrase in document, 'rev9 current prose missing: '+phrase)
    require('第3回xa-1' in dq[0]['dependency'] and '専用adapter/受付' in dq[0]['dependency'], 'next branch visible in queue')
    require('H1' in dq[3]['dependency'] and '標準ON拒否' in dq[3]['dependency'] and '本人判断' in dq[3]['dependency'], 'acceptance boundary in queue')
    require('専用adapter接続・検査は未実装' in dq[8]['dependency'] and not dq[8]['active'], 'adapter work not pilot execution')
    rev9_logs = [x for x in data['log']['items'] if x['id'] in {f'log-{i:03}' for i in range(1,79)}]
    require(len(rev9_logs) == 78 and digest(rev9_logs) == REV9_LOG_DIGEST, 'all 78 existing logs and all fields immutable')
    require(digest([x for x in data['decisions']['items'] if x['id'] in REV9_DECISION_IDS]) == REV9_DECISIONS_DIGEST,
            'all 19 existing decisions/signatures/dates immutable')
    require(decisions['dec-rev10-direction'] == REV10_EXPECTED['new_decision'], 'contract change is proposal only; human decision pending')
    for name in ('xa1','live','night_operation'):
        require(data['status'][name] == REV10_EXPECTED[name], 'rev10 supplied status and uncertainty: '+name)
    for name in ('live_contract','production_assessment'):
        require(data['plan'][name] == REV10_EXPECTED[name], 'rev10 stop/safety/authority boundary: '+name)
    night = data['budget']['overnight']
    require(night == {**REV10_EXPECTED['overnight'], 'note': REV12_OVERNIGHT_NOTE}, 'overnight estimates, union unknown and unchanged accounting formula')
    require(night['xa_smoke_minutes_each'] * night['xa_smoke_count'] +
            night['live_smoke_minutes_each'] * night['live_smoke_count'] + night['live_main_minutes'] ==
            night['completed_estimate_minutes'] == 202, 'completed estimates arithmetic')
    require(night['completed_estimate_minutes'] + night['mix1_estimate_minutes'] ==
            night['total_projected_minutes'] == 352, 'mix1 projection not confirmed consumed time')
    live = data['status']['live']
    require(len(data['plan']['live_contract']['regimes']) * 2 * 4 == live['worlds'] == 32, 'live all groups/worlds retained')
    for group in live['groups'][1:]:
        # T means are independently rounded to 0.01; retain reported dT (-1.93, not a recomputed -1.94).
        require(abs(Fraction(group['t']) - Fraction(live['groups'][0]['t']) - Fraction(group['d_t'])) <= Fraction(1,100),
                'reported dT consistent within displayed rounding')
        require(Fraction(group['d_t']) < 0, 'each ON failed pre-registered strict dT>0')
    for key, marker in [('dev5','source-dev5'),('xa1','source-xa1'),('live','source-live'),('live_safety','source-live-safety'),('mix1','source-mix1')]:
        require(parsed_table(block(document,marker)) == {k:data['results'][key][k] for k in ('header','rows')},
                'rev10 MASTER/dashboard table correspondence: '+key)
        require({k:data['results'][key][k] for k in ('header','rows')} == (REV12_EXPECTED['mix1_table'] if key == 'mix1' else REV10_TABLES[key]), 'exact displayed table: '+key)
    expected_live_rows = [[g['group'],g['t'],g['d_t'] or '—',g['d_alpha'] or '—',g['worst'] or '—',
                          ' / '.join(str(g[k]) for k in ('installed','declined','rejected')) if g['group'] != 'OFF' else '—']
                         for g in live['groups']]
    require(data['results']['live']['rows'] == expected_live_rows, 'every ON value and rejected/declined/installed count visible')
    for name in ('mix1', 'mix2', 'mix48', 'incz'):
        require(data['status'][name] == REV12_EXPECTED[name], 'rev11 exact scope, measured values, G0 and uncertainty: '+name)
    require(data['plan']['next_branch'] == REV12_EXPECTED['next_branch'], 'single A recommendation with mixed-field evidence; contract changes only proposed')
    rev10_logs = [x for x in data['log']['items'] if x['id'] in {f'log-{i:03}' for i in range(1,85)}]
    require(len(rev10_logs) == 84 and digest(rev10_logs) == REV10_LOG_DIGEST, 'all 84 prior logs and every field immutable')
    require(digest(data['decisions']['items']) == REV10_ALL_DECISIONS_DIGEST, 'all 20 prior decision records unchanged, including open rev10 proposal')
    mix = data['status']['mix1']['result']
    require(mix['g0_pass_worlds'] + mix['g0_blocked_worlds'] == data['status']['mix1']['completed_worlds'] == 24,
            'all 24 diagnostic worlds retained, including one BLOCKED')
    require([r['rank'] for r in mix['ranking']] == list(range(1,12)) and
            all(Fraction(a['t']) > Fraction(b['t']) for a,b in zip(mix['ranking'],mix['ranking'][1:])), 'mix1 ranking exact order')
    require(max(Fraction(r['worst_regime_t']) for r in mix['ranking']) == Fraction(mix['worst_regime_t']) and
            mix['ranking'][4]['agent'] == 'cand(xb-r v3)', 'cand best worst regime, not first overall')
    require(data['status']['mix2']['combined_worlds_planned'] == 2 * 24, 'original 48-world scope retained; completion checked separately')
    for phrase in ('23世界PASS', 'crash/40001', 'grok-1', 'telemetry', 'BLOCKEDをPASSとは扱わない',
                   '52.18', '47.6', '36.73', '約2.8T', '[inferred]', '統計検定の結果ではない',
                   '40003/40004', '05:34 JST', '07:20 JST', '48世界', '資格合格・旧Q0mの代用・提出可否',
                   'xb-r-liveのagent.ts=d30cbbbとバイト同一'):
        require(phrase in document and phrase in morning_new, 'rev11 MASTER and morning evidence/boundary: '+phrase)
    require('結果未確認・結果待ち' in data['results']['mix1']['rows'][-1][1], 'incz visible placeholder remains unknown')
    for phrase in ('202分（3h22）','352分（5h52）','C_forward + R_remaining + N_next ≤ 100h','区間和集合',
                   '13×2 = 26','30分で失効','8分ごと','/tmp/night-state.md','全反復でdT>0、dAlpha>0、worst≥−2',
                   '39101/prompt v1','v2/39102','WBTCのslippage許容80→100bps','16取引の固定価格損益+63.34 USDC',
                   'モデル間の実測比較ではない','HEALTHY=no','契約・資格とは無関係','反証条件'):
        require(phrase in document, 'rev10 essential fact/accounting/decision prose: '+phrase)
    require(morning_new is not None, '10/5 morning draft required')
    morning_rows = parsed_table(block(morning_new,'morning-runs'))
    require(len(morning_rows['rows']) == 7, 'morning retains prior runs plus completed mix2 / 48 worlds and incz placeholder')
    for phrase in ('49.72対multi 55.02','50.15対55.73','7179efe→6cd9e70→3ad4f60','264/362','10<30','4/710',
                   '54.74','48.91 / 52.80 / 53.62','−5.83 / −1.93 / −1.11','PILOT-STOP','HEALTHY=no',
                   '40001/40002=24世界','mix1a/b','03:52 JST','05:34 JST','07:20 JST','結果追記欄','結果未確認',
                   '202分（3h22）','352分（5h52）','不明','C_forward + R_remaining + N_next ≤ 100h',
                   'A（推奨）','B:','C:','推奨の反証条件','10/31 23:59 JST','dec-007は10/28','H1 ON拒否',
                   '80→100bps','+63.34','推測','8分heartbeat','30分で失効','echo "" | …'):
        require(phrase in morning_new, 'morning/current data consistency: '+phrase)
    rev11_logs = [x for x in data['log']['items'] if x['id'] in {f'log-{i:03}' for i in range(1,88)}]
    require(len(rev11_logs) == 87 and digest(rev11_logs) == REV11_LOG_DIGEST, 'all 87 prior logs and every field immutable')
    require(len(data['log']['items']) == 91, 'four rev12 result / inference / correction logs appended')
    require(parsed_table(block(morning_new,'morning-mixed-ranking')) == REV12_EXPECTED['morning_ranking'], 'all 22 morning ranking rows and values exact')
    for name in ('mix2','mix48'):
        scope = data['status'][name]
        ranking = scope['result']['ranking']
        require([r['rank'] for r in ranking] == list(range(1,12)) and
                all(Fraction(a['t']) > Fraction(b['t']) for a,b in zip(ranking,ranking[1:])), name+' exact ranking order')
    require(data['status']['mix48']['completed_worlds'] == data['status']['mix1']['completed_worlds'] + data['status']['mix2']['completed_worlds'] == 48, '48 worlds measured, not a qualification')
    for phrase in ('58.26','53.71','51.91','46.8','約4.5T','1T以内','inc-zeta=zeta-a30','Claude+Codex',
                   'F_ref契約(Q0)未通過','commit不一致でG0 FAIL','07:20 JST頃開始','旧05:40頃開始見込みを訂正',
                   '約55分','08:15 JST頃','12レジーム×seed40005=12世界','結果追記欄: 未受領','Q0契約は変更しない'):
        require(phrase in document and phrase in morning_new, 'rev12 result / inference / uncertainty boundary: '+phrase)
    return list(_RESULT_LINES)


def check():
    directory = Path(__file__).resolve().parent
    names = ("MASTER-PLAN-2026-10-04.md", "ASCON-DASHBOARD.html",
             "MORNING-2026-10-04.md", "m1/M1-RESULT.md", "DESIGN-AI-LAYER-01-astra.md", "MORNING-2026-10-05.md")
    documents = [(directory / name).read_text(encoding="utf-8") if (directory / name).exists() else None for name in names]
    if documents[0] is None or documents[2] is None or documents[3] is None:
        raise OSError("a required source document is missing")
    lines = check_documents(*documents)
    if "--self-check" in sys.argv:
        lines.append(f"PASS plan controls: {self_check(documents)} unsafe/stale mutations rejected in memory")
    return lines


def self_check(documents):
    """Exercise changed contracts without touching files, secrets or measurement paths."""
    def mutate(block_name, apply):
        def change(ds):
            pattern = r'(<script type="application/json" id="data-' + block_name + r'">)\s*(.*?)\s*(</script>)'
            def update(match):
                data = json.loads(match[2])
                apply(data)
                return match[1] + json.dumps(data, ensure_ascii=False) + match[3]
            ds[1] = re.sub(pattern, update, ds[1], count=1, flags=re.S)
        return change
    controls = [
        lambda ds: ds.__setitem__(0, ds[0].replace("revision 12", "revision 6", 1)),
        mutate("plan", lambda d: d["ai_contract"].update(status="unsigned")),
        mutate("plan", lambda d: d["ai_contract"].update(on_repeats=1)),
        mutate("plan", lambda d: d["ai_contract"].update(selected_total_hours="12")),
        mutate("plan", lambda d: d["protocol"][1].update(exit="already implemented")),
        mutate("status", lambda d: d["dev1"].update(verified=True)),
        mutate("status", lambda d: d["dev1"].update(q0_eligible=True)),
        mutate("status", lambda d: d["dev1"].update(state="reported-running")),
        mutate("plan", lambda d: d["ai_contract"].update(e3_q1_mode="FROZEN")),
        mutate("plan", lambda d: d["ai_contract"].update(epoch_learning_carryover=True)),
        mutate("decisions", lambda d: next(x for x in d["items"] if x["id"] == "dec-step1-policy").update(status="open")),
        mutate("decisions", lambda d: next(x for x in d["items"] if x["id"] == "dec-ai-contract").update(signer="Masashi")),
        mutate("decisions", lambda d: next(x for x in d["items"] if x["id"] == "dec-ai-scope").update(origin="")),
        mutate("decisions", lambda d: next(x for x in d["items"] if x["id"] == "dec-ai-scope").update(signed_at="")),
        mutate("decisions", lambda d: next(x for x in d["items"] if x["id"] == "dec-008").update(status="closed")),
        mutate("decisions", lambda d: d["human_only"].update(status="approved")),
        mutate("decisions", lambda d: next(x for x in d["items"] if x["id"] == "dec-008").update(status="open")),
        mutate("decisions", lambda d: d["ollama_report"].update(evidence_kind="measured")),
        mutate("decisions", lambda d: d["ollama_report"].update(official_model_list_verified=True)),
        mutate("decisions", lambda d: d["ollama_report"].update(free_quota_sufficiency_verified=True)),
        mutate("decisions", lambda d: d["ollama_report"].update(key_connectivity_verified=True)),
        mutate("decisions", lambda d: d["ollama_report"].update(auto_reload="On")),
        mutate("status", lambda d: d["dev2"].update(result="PASS")),
        mutate("status", lambda d: d["dev2"].update(completed_at="2026-10-04T15:50:00+09:00")),
        mutate("status", lambda d: d["dev2"].update(verified=True)),
        mutate('status', lambda d: d['dev2']['result'].update(t_candidate='60')),
        mutate('status', lambda d: d['dev2'].update(q0_eligible=True)),
        mutate('status', lambda d: d['dev2'].update(state='running-results-pending')),
        mutate('status', lambda d: d['dev3'].update(result='PASS')),
        mutate('status', lambda d: d['dev3'].update(completed_at='2026-10-04T17:40:00+09:00')),
        mutate('status', lambda d: d['dev3'].update(completed_worlds=24)),
        mutate('status', lambda d: d['dev3'].update(g0=None)),
        mutate('status', lambda d: d['dev3'].update(verified=True)),
        mutate('status', lambda d: d['dev3'].update(worlds=24)),
        mutate('status', lambda d: d['repair_v2'].update(tests=124)),
        mutate('status', lambda d: d['repair_v2'].update(verified=True)),
        mutate('status', lambda d: d.update(human_action='今すぐ鍵を登録')),
        mutate('budget', lambda d: d.update(consumed_forward_hours='18.6')),
        mutate('plan', lambda d: d.update(deadline_at='2026-10-31T23:59:00+08:00')),
        mutate('log', lambda d: next(x for x in d['items'] if x['id']=='log-065').update(summary='rewritten latest history')),
        mutate('results', lambda d: d['comparison']['qualification'][0].update(state='done')),
        mutate('results', lambda d: d['comparison']['diagnostic'][3]['metrics'][0].update(baseline_ref='results.q0_summary.multi_t')),
        mutate('glossary', lambda d: d['items'][0].update(definition='invented definition')),
        mutate("log", lambda d: d["items"][0].update(id="log-999")),
        mutate("budget", lambda d: d["rows"][6].update(keep_hours="14.9")),
        mutate("results", lambda d: d["q0b_summary"].update(reverts=0)),
        mutate("queue", lambda d: d["items"][2].update(active=True)),
        mutate("plan", lambda d: d["ai_contract"].update(d_control_base_hours="0")),
        mutate("plan", lambda d: d["ai_parameters"]["rows"][0].__setitem__(4, "±40 bps")),
        mutate("plan", lambda d: d["q0_requalification"].update(option="B")),
        mutate("plan", lambda d: d["q0_requalification"].update(extra_all_world_p_minus_noop=True)),
        mutate("plan", lambda d: d["revert_contract"].update(retroactive=True)),
        mutate("plan", lambda d: d["revert_contract"].update(max_ratio="1/100")),
        mutate("plan", lambda d: d["revert_contract"].update(max_count=2)),
        mutate("plan", lambda d: d["cutover"].update(h480_requires=["受理S"])),
        mutate("log", lambda d: d["items"][-1].update(summary="rewritten history")),
        lambda ds: ds.__setitem__(4, ds[4].replace("凍結性能は改訂ON性能の代用にならない", "凍結で十分")),
        mutate('status', lambda d: d['dev3']['result'].update(t_candidate='56')),
        mutate('status', lambda d: d['dev3']['result'].update(min_p_minus_noop='+147.7')),
        mutate('status', lambda d: d['dev3']['result'].update(submitted=981)),
        mutate('status', lambda d: d['dev3']['result']['regime_t'][2].update(candidate='50.10')),
        mutate('status', lambda d: d['dev3'].update(q0_eligible=True)),
        mutate('status', lambda d: d['dev3'].update(completed_at_precision='second')),
        mutate('status', lambda d: d['dev3b'].update(result='PASS')),
        mutate('status', lambda d: d['dev3b'].update(completed_at='2026-10-04T19:00:00+09:00')),
        mutate('status', lambda d: d['dev3b'].update(worlds=6)),
        mutate('status', lambda d: d['repair_v3'].update(tests=123)),
        mutate('status', lambda d: d['repair_v3'].update(verified=True)),
        mutate('plan', lambda d: d['continuous_operation'].update(monitor_status='running')),
        mutate('plan', lambda d: d['continuous_operation'].update(iteration_limit=4)),
        mutate('plan', lambda d: d['continuous_operation'].update(mean_t_delta_min='-1')),
        mutate('plan', lambda d: d['continuous_operation'].update(validation_regimes=9)),
        mutate('plan', lambda d: d['continuous_operation'].update(budget_status='released')),
        mutate('results', lambda d: d['comparison']['diagnostic'][2]['metrics'][0].update(baseline_ref='status.dev2.result.p_multi')),
        lambda ds: ds.__setitem__(0, ds[0].replace('調整/短縮smoke/診断検証/Q0のseed交差0','seed共有可')),
        lambda ds: ds.__setitem__(0, ds[0].replace('全予定世界の終端記録','launcher終了')),
    ]
    controls += [
        mutate('status', lambda d: d['dev4']['result'].update(t_candidate='999')),
        mutate('status', lambda d: d['dev4']['result'].update(t_multi='999')),
        mutate('status', lambda d: d['dev4']['result'].update(t_gap='999')),
        mutate('status', lambda d: d['dev4']['result'].update(min_regime_t_minus_noop='999')),
        mutate('status', lambda d: d['dev4']['result'].update(positive_regimes=999)),
        mutate('status', lambda d: d['dev4']['result'].update(noop_below=999)),
        mutate('status', lambda d: d['dev4']['result'].update(violations=999)),
        mutate('status', lambda d: d['dev4']['result'].update(reverts=999)),
        mutate('status', lambda d: d['dev4']['result'].update(submitted=999)),
        mutate('status', lambda d: d['dev4']['result'].update(submit_failed=999)),
        mutate('status', lambda d: d['dev4']['result'].update(submit_failed_percent='999')),
        mutate('status', lambda d: d['dev4']['result'].update(p_candidate='999')),
        mutate('status', lambda d: d['dev4']['result'].update(p_multi='999')),
        mutate('status', lambda d: d['dev4']['result'].update(p_clean='999')),
        mutate('status', lambda d: d['dev4']['result'].update(trades_candidate='999')),
        mutate('status', lambda d: d['dev4']['result'].update(trades_multi='999')),
        mutate('status', lambda d: d['dev4']['result'].update(trades_clean='999')),
        mutate('status', lambda d: d['dev4']['result']['regime_t'][0].update(candidate='999')),
        mutate('status', lambda d: d['dev4']['result']['regime_t'][1].update(candidate='999')),
        mutate('status', lambda d: d['dev4']['result']['regime_t'][2].update(candidate='999')),
        mutate('status', lambda d: d['dev4']['result']['regime_t'][3].update(candidate='999')),
        mutate('status', lambda d: d['dev4']['result']['regime_t'][4].update(candidate='999')),
        mutate('status', lambda d: d['dev4']['result']['regime_t'][5].update(candidate='999')),
        mutate('status', lambda d: d['dev4']['result']['regime_t'][6].update(candidate='999')),
        mutate('status', lambda d: d['dev4']['result']['regime_t'][7].update(candidate='999')),
        mutate('status', lambda d: d['dev4']['result']['regime_t'][8].update(candidate='999')),
        mutate('status', lambda d: d['dev4']['result']['regime_t'][9].update(candidate='999')),
        mutate('status', lambda d: d['dev4']['result']['regime_t'][10].update(candidate='999')),
        mutate('status', lambda d: d['dev4']['result']['regime_t'][11].update(candidate='999')),
        mutate('status', lambda d: d['dev4'].update(worlds=18)),
        mutate('status', lambda d: d['dev4'].update(fix_commit='7b1448b')),
        mutate('status', lambda d: d['dev4'].update(loops=361)),
        mutate('status', lambda d: d['dev4'].update(g0='FAIL')),
        mutate('status', lambda d: d['dev4'].update(q0_eligible=True)),
        mutate('status', lambda d: d['dev5'].update(result='PASS')),
        mutate('status', lambda d: d['dev5'].update(completed_at='2026-10-05T00:00:00+09:00')),
        mutate('status', lambda d: d['dev5'].update(completed_worlds=24)),
        mutate('status', lambda d: d['dev5'].update(g0='PASS')),
        mutate('status', lambda d: d['dev5'].update(started_at='2026-10-04T21:07:00+09:00')),
        mutate('status', lambda d: d['dev5'].update(expected_end='2026-10-04T00:00:00+09:00')),
        mutate('status', lambda d: d['dev5'].update(independent_screen=True)),
        mutate('status', lambda d: d['dev5'].update(seeds='37001/37002')),
        mutate('status', lambda d: d['repair_v5'].update(tests=184)),
        mutate('status', lambda d: d['repair_v5'].update(red_controls=60)),
        mutate('status', lambda d: d['repair_v5'].update(verified=True)),
        mutate('status', lambda d: d['team'].update(primary='Grok')),
        mutate('status', lambda d: d['team'].update(tool_policy='tools allowed')),
        mutate('status', lambda d: d['plateau'].update(result='complete')),
        mutate('plan', lambda d: d['continuous_operation'].update(iteration_current=1)),
        mutate('log', lambda d: next(x for x in d['items'] if x['id']=='log-073').update(summary='rewritten rev7 history')),
        lambda ds: ds.__setitem__(0, ds[0].replace('平均対応ΔT≥+1.0', '平均対応ΔT≥0')),
        mutate('results', lambda d: d['comparison']['diagnostic'][1]['metrics'][0].update(baseline_ref='status.dev3.result.p_multi')),
    ]
    controls += [
        mutate('plan', lambda d: d['h1'].update(full_executor_allowed=True)),
        mutate('plan', lambda d: d['h1'].update(initial_entry=60)),
        mutate('plan', lambda d: d['h1'].update(fallback_entry=60)),
        mutate('plan', lambda d: d['h1'].update(entry_min=0)),
        mutate('plan', lambda d: d['h1'].update(entry_max=65)),
        mutate('plan', lambda d: d['h1'].update(entry_step=10)),
        mutate('plan', lambda d: d['h1'].update(entry_max_delta=40)),
        mutate('plan', lambda d: d['h1'].update(expiry_blocks=121)),
        mutate('plan', lambda d: d['h1'].update(tests=214)),
        mutate('plan', lambda d: d['h1'].update(red_controls=24)),
        mutate('plan', lambda d: d['h1'].update(tests_rerun=True)),
        mutate('plan', lambda d: d['h1'].update(standard_on='ready')),
        mutate('plan', lambda d: d['h1'].update(fixed_template_safe=True)),
        mutate('plan', lambda d: d['h1'].update(agent_validator_safe=True)),
        mutate('plan', lambda d: d['h1'].update(adapter='implemented')),
        mutate('plan', lambda d: d['h1'].update(vendored='PASS')),
        mutate('plan', lambda d: d['h1'].update(production_boundary='safe')),
        mutate('plan', lambda d: d['h1'].update(policies=['v5'])),
        mutate('plan', lambda d: d['pilot'].update(regimes=['calm'])),
        mutate('plan', lambda d: d['pilot'].update(seeds=[36001, 36002])),
        mutate('plan', lambda d: d['pilot'].update(off_repeats=0)),
        mutate('plan', lambda d: d['pilot'].update(on_repeats=1)),
        mutate('plan', lambda d: d['pilot'].update(worlds=8)),
        mutate('plan', lambda d: d['pilot'].update(primary='ollama')),
        mutate('plan', lambda d: d['pilot'].update(paid_usage=True)),
        mutate('plan', lambda d: d['pilot'].update(local_ollama=True)),
        mutate('plan', lambda d: d['pilot'].update(personal_ollama_key=True)),
        mutate('plan', lambda d: d['pilot'].update(personal_ollama_quota=True)),
        mutate('plan', lambda d: d['pilot'].update(on_ready=True)),
        mutate('plan', lambda d: d['pilot'].update(pre_q0_run_approved=True)),
        mutate('status', lambda d: d['xa1'].update(tests=40)),
        mutate('status', lambda d: d['xa1'].update(red_controls=38)),
        mutate('status', lambda d: d['xa1'].update(result='PASS')),
        mutate('status', lambda d: d['xa1'].update(tests_rerun=True)),
        mutate('status', lambda d: d['xa1'].update(smoke_seed=38001)),
        mutate('status', lambda d: d['xa1'].update(seeds=[39001, 39002])),
        mutate('status', lambda d: d['xa1'].update(estimated_minutes=50)),
        mutate('status', lambda d: d['xa1'].update(state='measured')),
        mutate('status', lambda d: d['agy_format'].update(capability_evaluated=True)),
        mutate('status', lambda d: d['agy_format'].update(runtime_verified=True)),
        mutate('status', lambda d: d['agy_format'].update(haiku_verified=True)),
        mutate('status', lambda d: d['agy_format'].update(performance_verified=True)),
        mutate('status', lambda d: d['agy_format']['cases'][1].update(answer_prescribed=False)),
        mutate('status', lambda d: d['agy_format']['cases'][0].update(calls=3)),
        mutate('status', lambda d: d['agy_format']['cases'][2].update(output='selection')),
        mutate('plan', lambda d: d['next_branch'].update(automatic_launch=True)),
        mutate('plan', lambda d: d['next_branch'].update(iteration=4)),
        mutate('decisions', lambda d: next(x for x in d['items'] if x['id']=='dec-full-executor').update(status='decided')),
        mutate('decisions', lambda d: next(x for x in d['items'] if x['id']=='dec-ai-scope').update(title='changed prior decision')),
        mutate('log', lambda d: next(x for x in d['items'] if x['id']=='log-073').update(summary='rewritten rev8 log')),
        mutate('results', lambda d: d['h1']['rows'][1].__setitem__(1, 'safe on')),
        lambda ds: ds.__setitem__(0, ds[0].replace('smoke 38003', 'smoke 39001'))
    ]
    controls += [
        mutate('log', lambda d: next(x for x in d['items'] if x['id']=='log-078').update(time_basis='changed')),
        mutate('log', lambda d: d['items'].pop(next(i for i,x in enumerate(d['items']) if x['id']=='log-077'))),
        mutate('status', lambda d: d['dev5']['result'].update(t_candidate='55.74')),
        mutate('status', lambda d: d['dev5'].update(state='reported-running-unverified')),
        mutate('status', lambda d: d['xa1']['result'].update(healthy=True)),
        mutate('status', lambda d: d['xa1']['result'].update(submitted=30)),
        mutate('status', lambda d: d['xa1']['result'].update(recovery_only=264)),
        mutate('status', lambda d: d['xa1'].update(repairs=3)),
        mutate('status', lambda d: d['xa1'].update(iteration_outcome='qualified')),
        mutate('status', lambda d: d['xa1']['smokes'][0].update(g0='PASS')),
        mutate('status', lambda d: d['live'].update(decision='PILOT-CONTINUE-ELIGIBLE')),
        mutate('status', lambda d: d['live'].update(initial_code='v5')),
        mutate('status', lambda d: d['live'].update(paid_usage=True)),
        mutate('status', lambda d: d['live']['calibration'][0].update(installed=1)),
        mutate('status', lambda d: d['live']['calibration'][1].update(outcome='safe')),
        mutate('status', lambda d: d['live']['wbtc'].update(exclusion_supported=True)),
        mutate('status', lambda d: d['live']['wbtc'].update(fixed_price_pnl_usdc='-63.34')),
        mutate('plan', lambda d: d['live_contract'].update(all_repeats_required=False)),
        mutate('plan', lambda d: d['live_contract'].update(d_t_strict_min='-6')),
        mutate('plan', lambda d: d['live_contract'].update(worst_min='-20')),
        mutate('plan', lambda d: d['live_contract'].update(on4_allowed=True)),
        mutate('plan', lambda d: d['production_assessment'].update(evidence='measured')),
        mutate('plan', lambda d: d['production_assessment'].update(runtime_safety_boundary=True)),
        mutate('status', lambda d: d['mix1'].update(result='PASS')),
        mutate('status', lambda d: d['mix1'].update(result_label='PASS')),
        mutate('status', lambda d: d['mix1'].update(completed_at='2026-10-05T06:30:00+09:00')),
        mutate('status', lambda d: d['mix1'].update(completed_worlds=23)),
        mutate('status', lambda d: d['mix1'].update(g0='PASS')),
        mutate('status', lambda d: d['mix1'].update(q0_eligible=True)),
        mutate('status', lambda d: d['mix1'].update(seeds='41301/41302')),
        mutate('status', lambda d: d['mix1'].update(agents=12)),
        mutate('status', lambda d: d['mix1'].update(chunks=['mix1a'])),
        mutate('status', lambda d: d['night_operation'].update(verified=True)),
        mutate('status', lambda d: d['night_operation'].update(monitor_expiry_minutes=60)),
        mutate('budget', lambda d: d['overnight'].update(exact_union_minutes=352)),
        mutate('budget', lambda d: d['overnight'].update(completed_estimate_minutes=606)),
        mutate('budget', lambda d: d['overnight'].update(total_projected_minutes=364)),
        mutate('budget', lambda d: d['overnight'].update(repair_check_nonrun_minutes=0)),
        mutate('plan', lambda d: d['next_branch'].update(recommendation='C')),
        mutate('decisions', lambda d: next(x for x in d['items'] if x['id']=='dec-rev10-direction').update(status='decided')),
        lambda ds: ds.__setitem__(5, ds[5].replace('結果追記欄','**PASS**')),
        lambda ds: ds.__setitem__(5, ds[5].replace('352分（5h52）','352分消費済み')),
        lambda ds: ds.__setitem__(5, ds[5].replace('推奨の反証条件','追加提案')),
    ]
    controls += [
        mutate('results', lambda d: d['live_safety']['rows'][1].__setitem__(1, 'safe slippage change')),
        mutate('results', lambda d: d['mix1']['rows'][3].__setitem__(1, 'PASS')),
    ]
    for index in range(1,4):
        for key in ('t','d_t','d_alpha','worst','installed','declined','rejected'):
            controls.append(mutate('status', lambda d,i=index,k=key: d['live']['groups'][i].update({k:'999'})))
    controls += [
        mutate('log', lambda d: next(x for x in d['items'] if x['id']=='log-082').update(summary='rewritten')),
        mutate('status', lambda d: d['mix1']['result'].update(g0_pass_worlds=24, g0_blocked_worlds=0)),
        mutate('status', lambda d: d['mix1']['result'].update(blocked_agent='cand')),
        mutate('status', lambda d: d['mix1']['result'].update(blocked_retained=False)),
        mutate('status', lambda d: d['mix1']['result'].update(violations=1)),
        mutate('status', lambda d: d['mix1'].update(parallelism=4)),
        mutate('status', lambda d: d['mix1'].update(code_identity='unverified other code')),
        mutate('status', lambda d: d['mix2'].update(result='PASS')),
        mutate('status', lambda d: d['mix2'].update(g0=None)),
        mutate('status', lambda d: d['mix2'].update(completed_worlds=None)),
        mutate('status', lambda d: d['mix2'].update(completed_at='2026-10-05T07:20:00+09:00')),
        mutate('status', lambda d: d['mix2'].update(seeds='40001/40002')),
        mutate('status', lambda d: d['mix2'].update(continue_on_g0_blocked=False)),
        mutate('status', lambda d: d['mix2'].update(q0_eligible=True)),
        mutate('status', lambda d: d['mix2'].update(combined_worlds_planned=24)),
        mutate('plan', lambda d: d['continuous_operation'].update(current_run_ref='status.mix1')),
        lambda ds: ds.__setitem__(5, ds[5].replace('統計検定の結果ではない', '有意差を証明済み')),
    ]
    controls.append(mutate('budget', lambda d: d['overnight'].update(note=REV10_EXPECTED['overnight']['note'])))
    for i in range(11):
        for key in ('agent','rank','t','worst_regime_t'):
            controls.append(mutate('status', lambda d,i=i,k=key: d['mix1']['result']['ranking'][i].update({k:'999'})))
    for i in range(12):
        for key in ('regime','t','mean_rank'):
            controls.append(mutate('status', lambda d,i=i,k=key: d['mix1']['result']['regime_t'][i].update({k:'999'})))
    controls += [
        mutate('log', lambda d: next(x for x in d['items'] if x['id']=='log-087').update(summary='rewritten')),
        mutate('status', lambda d: d['mix2']['result'].update(violations=1)),
        mutate('status', lambda d: d['mix2'].update(chunks=['mix2a'])),
        mutate('status', lambda d: d['mix48'].update(q0_eligible=True)),
        mutate('status', lambda d: d['mix48'].update(completed_worlds=47)),
        mutate('status', lambda d: d['mix48'].update(g0='PASS')),
        mutate('status', lambda d: d['incz'].update(result='PASS')),
        mutate('status', lambda d: d['incz'].update(completed_worlds=12)),
        mutate('status', lambda d: d['incz'].update(g0='PASS')),
        mutate('status', lambda d: d['incz'].update(started_at='2026-10-05T05:40:00+09:00')),
        mutate('status', lambda d: d['incz'].update(expected_end='2026-10-05T07:20:00+09:00')),
        mutate('status', lambda d: d['incz'].update(q0_eligible=True)),
        lambda ds: ds.__setitem__(5, ds[5].replace('61.54','61.55')),
        lambda ds: ds.__setitem__(5, ds[5].replace('約4.5T','約2.8T')),
    ]
    for name in ('mix2','mix48'):
        for i in range(11):
            for key in ('agent','rank','t','worst_regime_t'):
                controls.append(mutate('status', lambda d,n=name,i=i,k=key: d[n]['result']['ranking'][i].update({k:'999'})))
    for number, control in enumerate(controls, 1):
        changed = copy.deepcopy(documents)
        control(changed)
        try:
            check_documents(*changed)
        except (ValueError, KeyError, IndexError, TypeError):
            continue
        raise ValueError(f"negative plan control incorrectly passed: {number}")
    return len(controls)


def main():
    try:
        for line in check():
            print(line)
    except (OSError, ValueError, KeyError, IndexError, TypeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

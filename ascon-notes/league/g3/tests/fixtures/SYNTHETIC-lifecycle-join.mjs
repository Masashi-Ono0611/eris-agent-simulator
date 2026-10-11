// 人工契約のみ。実時計・実子プロセス・実状態ファイル・実モデルの値ではない。
// 時刻は人工時計のナノ秒（十進文字列）。300秒を実際に待った記録ではない。
const T0 = 1000000000000n;
const ms = n => BigInt(n) * 1000000n;
const at = offsetMs => String(T0 + ms(offsetMs));
const hash = digit => `sha256:${digit.repeat(64)}`;
export const hashes = { original: hash('a'), revised: hash('b'), state1: hash('1'), state2: hash('2') };
export const nsAt = at;

export function syntheticLifecycleJoin() {
  return {
    schema: 1, provenance: 'SYNTHETIC', worldId: 'synthetic-world-1',
    // 推論呼出しの制限と判断の時間予算は別の契約。
    limits: { inferenceTimeoutMs: 300000, decisionBudgetMs: 5000 },
    // 人工時計。scale は人工の時間倍率で、実時間の測定ではない。
    clock: { kind: 'synthetic', scale: 1, realTimeMeasured: false },
    worldEndNs: at(1000000),
    calls: [
      {
        // 境界ちょうど（300000ミリ秒）で時間切れ。
        callId: 1, decisionId: 3, childId: 11, outcome: 'timed_out',
        startedNs: at(0), childStartedNs: at(1), deadlineNs: at(300000), timedOutNs: at(300000),
        killRequestedNs: at(300001), lateDueNs: at(320000),
      },
      {
        // 期限内に完了した呼出し。
        callId: 2, decisionId: 4, childId: 12, outcome: 'completed',
        startedNs: at(400000), childStartedNs: at(400001), deadlineNs: at(700000), completedNs: at(440000),
      },
      {
        // 上側の境界ちょうど（301000ミリ秒）で時間切れ。
        callId: 3, decisionId: 6, childId: 13, outcome: 'timed_out',
        startedNs: at(500000), childStartedNs: at(500001), deadlineNs: at(800000), timedOutNs: at(801000),
        killRequestedNs: at(801000), lateDueNs: at(850000),
      },
    ],
    // 子の終了通知は kill 要求とは独立した記録。
    exits: [
      { callId: 1, childId: 11, kind: 'exit', atNs: at(300003) },
      { callId: 3, childId: 13, kind: 'close', atNs: at(801002) },
    ],
    // 遅着予定以後から世界終了までの観測区間。
    lateWindows: [
      { callId: 1, fromNs: at(320000), toNs: at(1000000) },
      { callId: 3, fromNs: at(850000), toNs: at(1000000) },
    ],
    sourceEvents: [
      { callId: 1, atNs: at(320000), action: 'reject' },
      { callId: 2, atNs: at(440001), action: 'apply' },
      { callId: 2, atNs: at(440002), action: 'submit' },
      { callId: 3, atNs: at(850000), action: 'reject' },
    ],
    saves: [
      { epoch: 1, requestedNs: at(450000), completedNs: at(450010), stateHash: hashes.state1, writtenHash: hashes.state1 },
      { epoch: 2, requestedNs: at(900000), completedNs: at(900010), stateHash: hashes.state2, writtenHash: hashes.state2 },
    ],
    reloads: [
      { epoch: 2, fromEpoch: 1, atNs: at(450020), loadedHash: hashes.state1 },
      { epoch: 3, fromEpoch: 2, atNs: at(900020), loadedHash: hashes.state2 },
    ],
    restore: {
      atNs: at(950000), originalSourceHash: hashes.original, restoredSourceHash: hashes.original,
      managedVersion: 4, generation: 2,
      firstDecision: { decisionId: 9, atNs: at(950100), generation: 2, sourceHash: hashes.original },
    },
  };
}

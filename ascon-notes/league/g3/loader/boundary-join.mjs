// 要件4の人工契約。実チェーン・通信・ファイル・実行器を操作せず、入力を書き換えない。
// J06〜J08 は既存の事後結合器の判定を投影値として引き継ぐだけで、再計算しない。
// 出力試行は要件3の人工結合器の出力を模した投影であり、実観測の全件性を認定しない。
export function joinBoundaries(input) {
  const issues = [], boundaries = [], auxiliaryTransactions = [];
  const add = (verdict, suffix) => {
    const code = `REQ4_${suffix}`;
    if (!issues.some(i => i.verdict === verdict && i.code === code)) issues.push({ verdict, code });
  };
  const fail = code => add('FAIL', code), blocked = code => add('BLOCKED', code);
  const finish = () => ({
    verdict: issues.some(i => i.verdict === 'FAIL') ? 'FAIL'
      : issues.length ? 'BLOCKED' : 'CONTRACT_OK_ON_SYNTHETIC',
    g3Status: 'BLOCKED', liveRecorderVerified: false,
    boundaries: issues.length ? [] : boundaries,
    auxiliaryTransactions: issues.length ? [] : auxiliaryTransactions,
    issues,
  });
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const integer = v => Number.isSafeInteger(v) && v >= 0;
  const id = v => integer(v) && v > 0;
  const decimal = v => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v);
  const address = v => typeof v === 'string' && /^0x[0-9a-f]{40}$/.test(v);
  const txHash = v => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v);
  const label = v => typeof v === 'string' && v.length > 0;
  const oneOf = values => v => values.includes(v);
  const field = (r, key, valid) => {
    if (r[key] === undefined || r[key] === null) blocked('FIELD_MISSING');
    else if (!valid(r[key])) fail('FIELD_INVALID');
  };
  const array = (r, key, validate) => {
    field(r, key, Array.isArray);
    if (!Array.isArray(r[key])) return;
    for (const item of r[key]) {
      if (!object(item)) fail('INPUT_INVALID');
      else validate(item);
    }
  };
  // 必須ではなく欠測を J12 で扱う取引のガス欄は、値がある場合だけ形式を検査する。
  const optional = (r, key, valid) => {
    if (r[key] !== undefined && r[key] !== null && !valid(r[key])) fail('FIELD_INVALID');
  };
  const attemptKey = a => `${a.decisionId}:${a.path}:${a.ordinal}`;
  const attemptFields = a => {
    field(a, 'decisionId', id); field(a, 'path', oneOf(['return', 'submit'])); field(a, 'ordinal', id);
  };
  const kinds = ['balance', 'allowance', 'reservation', 'ethBalance', 'pendingGas', 'gasReserve'];
  const tokenKinds = ['balance', 'allowance', 'reservation'];
  const availabilities = ['observed', 'derived', 'missing', 'error', 'ambiguous'];
  const valued = ['observed', 'derived'];
  const verdicts = ['PASS', 'BLOCKED', 'FAIL'];
  const origins = ['decision', 'startup_approval', 'gas_refill', 'derived_sender', 'unknown'];

  if (input == null) { blocked('INPUT_MISSING'); return finish(); }
  if (!object(input)) { fail('INPUT_INVALID'); return finish(); }
  if (input.provenance !== 'SYNTHETIC') { blocked('PROVENANCE'); return finish(); }
  field(input, 'schema', v => v === 1); field(input, 'worldId', label); field(input, 'owner', address);
  array(input, 'attempts', a => {
    attemptFields(a); field(a, 'disposition', oneOf(['sent', 'not_sent', 'discarded']));
  });
  array(input, 'transactions', t => {
    field(t, 'hash', txHash); field(t, 'worldId', label); field(t, 'origin', oneOf(origins));
    field(t, 'blockNumber', integer); field(t, 'posthoc', object);
    if (object(t.posthoc)) for (const check of ['J06', 'J07', 'J08']) optional(t.posthoc, check, oneOf(verdicts));
  });
  array(input, 'boundaries', b => {
    field(b, 'boundaryId', id); field(b, 'attempt', object);
    if (object(b.attempt)) attemptFields(b.attempt);
    field(b, 'outcome', oneOf(['sent', 'not_sent'])); field(b, 'observedAtBlock', integer);
    array(b, 'legs', l => { field(l, 'token', address); field(l, 'spender', address); field(l, 'amount', decimal); });
    array(b, 'txs', t => {
      field(t, 'hash', txHash); field(t, 'from', address); field(t, 'nonce', integer);
      optional(t, 'gasLimit', decimal); optional(t, 'maxFeePerGasWei', decimal);
    });
    array(b, 'evidence', e => {
      field(e, 'kind', oneOf(kinds)); field(e, 'availability', oneOf(availabilities));
      field(e, 'owner', address); field(e, 'boundaryId', id);
      if (tokenKinds.includes(e.kind)) field(e, 'token', address);
      if (e.kind === 'allowance') field(e, 'spender', address);
      if (e.value === undefined) blocked('FIELD_MISSING');
      // 値の有無と可否の組合せを確定させる。欠測を0や安全値へ変換しない。
      else if (availabilities.includes(e.availability)
        && (valued.includes(e.availability) ? !decimal(e.value) : e.value !== null)) fail('FIELD_INVALID');
      if (valued.includes(e.availability)) field(e, 'resolvedBlockNumber', integer);
      else optional(e, 'resolvedBlockNumber', integer);
    });
  });
  if (issues.length) return finish();
  if (!input.boundaries.length || !input.attempts.length) { blocked('EMPTY'); return finish(); }

  // J05: 出力試行・境界・取引 hash の対応
  const attempts = new Map();
  for (const a of input.attempts) {
    if (attempts.has(attemptKey(a))) fail('J05_ATTEMPT_DUPLICATE');
    attempts.set(attemptKey(a), a);
  }
  const transactions = new Map();
  for (const t of input.transactions) {
    if (transactions.has(t.hash)) fail('J05_TX_DUPLICATE');
    transactions.set(t.hash, t);
    if (t.worldId !== input.worldId) fail('J05_WORLD_CONFLICT');
    for (const check of ['J06', 'J07', 'J08']) {
      const value = t.posthoc[check];
      if (value === 'FAIL') fail(`${check}_POSTHOC_NOT_PASS`);
      else if (value !== 'PASS') blocked(`${check}_POSTHOC_NOT_PASS`);
    }
    if (t.origin === 'unknown') blocked('J14_ORIGIN_UNKNOWN');
  }
  const boundaryIds = new Set(), byAttempt = new Map(), attribution = new Map();
  for (const b of input.boundaries) {
    if (boundaryIds.has(b.boundaryId)) fail('J05_BOUNDARY_DUPLICATE');
    boundaryIds.add(b.boundaryId);
    const key = attemptKey(b.attempt), attempt = attempts.get(key);
    if (byAttempt.has(key)) fail('J05_BOUNDARY_DUPLICATE');
    byAttempt.set(key, b);
    if (!attempt) fail('J05_ATTEMPT_UNKNOWN');
    else if (attempt.disposition !== b.outcome) fail('J05_DISPOSITION_CONFLICT');
    if (b.outcome === 'not_sent' && b.txs.length) fail('J05_UNSENT_WITH_TX');
    if (b.outcome === 'sent' && !b.txs.length) blocked('J05_TX_EDGE_MISSING');
    for (const t of b.txs) {
      attribution.set(t.hash, [...(attribution.get(t.hash) ?? []), b.boundaryId]);
      if (t.from !== input.owner) blocked('J05_SENDER_UNBOUND');
      const joined = transactions.get(t.hash);
      if (!joined) { blocked('J05_TX_UNJOINED'); continue; }
      if (joined.origin !== 'decision' && joined.origin !== 'unknown') fail('J14_AUX_ATTRIBUTED_TO_DECISION');
      // J09 の1点: 包含は境界観測ブロックより後でなければならない。
      if (joined.blockNumber <= b.observedAtBlock) fail('J09_INCLUSION_BEFORE_BOUNDARY');
    }
  }
  for (const a of input.attempts) {
    if (a.disposition !== 'discarded' && !byAttempt.has(attemptKey(a))) blocked('J05_BOUNDARY_MISSING');
  }
  for (const [, owners] of attribution) if (owners.length > 1) blocked('J05_TX_MULTI_ATTRIBUTED');
  for (const t of input.transactions) {
    if (t.origin === 'decision' && !attribution.has(t.hash)) blocked('J05_TX_ORPHAN');
  }

  // J11 / J12: 境界ごとの経済値
  const category = kind => ['balance', 'allowance', 'ethBalance'].includes(kind) ? 'J11' : 'J12';
  const valueKey = e => [e.kind, e.owner, tokenKinds.includes(e.kind) ? e.token : '', e.kind === 'allowance' ? e.spender : ''].join('|');
  const results = [];
  for (const b of input.boundaries) {
    const values = new Map();
    for (const e of b.evidence) {
      const group = category(e.kind);
      if (e.boundaryId !== b.boundaryId) { blocked(`${group}_BOUNDARY_MISMATCH`); continue; }
      if (valued.includes(e.availability) && e.resolvedBlockNumber !== b.observedAtBlock) {
        blocked(`${group}_SNAPSHOT_MIXED`); continue;
      }
      const key = valueKey(e), previous = values.get(key);
      if (previous) {
        if (previous.value !== e.value || previous.availability !== e.availability) fail(`${group}_VALUE_CONFLICT`);
        else blocked(`${group}_EVIDENCE_DUPLICATE`);
        continue;
      }
      values.set(key, e);
    }
    // 観測値だけを返す。欠測・失敗・曖昧・導出値は null として BLOCKED を残す。
    const need = (kind, token = '', spender = '') => {
      const e = values.get([kind, input.owner, token, spender].join('|')), group = category(kind);
      if (!e) { blocked(`${group}_VALUE_MISSING`); return null; }
      if (e.availability !== 'observed') { blocked(`${group}_VALUE_UNAVAILABLE`); return null; }
      return BigInt(e.value);
    };
    const spentByToken = new Map(), spentBySpender = new Map();
    for (const l of b.legs) {
      spentByToken.set(l.token, (spentByToken.get(l.token) ?? 0n) + BigInt(l.amount));
      const key = `${l.token}|${l.spender}`;
      spentBySpender.set(key, (spentBySpender.get(key) ?? 0n) + BigInt(l.amount));
    }
    const sent = b.outcome === 'sent';
    for (const [token, spent] of spentByToken) {
      const balance = need('balance', token), reserved = need('reservation', token);
      // 未送信境界の超過は送信前拒否の理由になり得るため、送信済みだけを矛盾とする。
      if (sent && balance !== null && reserved !== null && spent > balance - reserved) fail('J11_FUNDS_EXCEEDED');
    }
    for (const [key, spent] of spentBySpender) {
      const [token, spender] = key.split('|'), allowance = need('allowance', token, spender);
      if (sent && allowance !== null && spent > allowance) fail('J11_ALLOWANCE_EXCEEDED');
    }
    const eth = need('ethBalance'), pending = need('pendingGas'), reserve = need('gasReserve');
    let maxGasCost = null, headroom = null;
    if (sent && b.txs.length) {
      const nonces = new Set();
      let complete = true;
      maxGasCost = 0n;
      for (const t of b.txs) {
        const nonceKey = `${t.from}|${t.nonce}`;
        // 同じ送信元・nonceの別hashは置換候補であり、単純合算しない。
        if (nonces.has(nonceKey)) { blocked('J12_NONCE_GROUP_UNRESOLVED'); complete = false; }
        nonces.add(nonceKey);
        if (!decimal(t.gasLimit) || !decimal(t.maxFeePerGasWei)) { blocked('J12_TX_GAS_MISSING'); complete = false; continue; }
        maxGasCost += BigInt(t.gasLimit) * BigInt(t.maxFeePerGasWei);
      }
      if (!complete) maxGasCost = null;
      if (reserve !== null && reserve <= 0n) fail('J12_RESERVE_INVALID');
      if (maxGasCost !== null && eth !== null && pending !== null && reserve !== null) {
        headroom = eth - maxGasCost - pending;
        if (headroom < reserve) fail('J12_GAS_RESERVE_EXHAUSTED');
      }
    }
    results.push({
      boundaryId: b.boundaryId,
      attempt: { decisionId: b.attempt.decisionId, path: b.attempt.path, ordinal: b.attempt.ordinal },
      outcome: b.outcome, observedAtBlock: b.observedAtBlock,
      txHashes: b.txs.map(t => t.hash),
      spentByToken: [...spentByToken].map(([token, amount]) => ({ token, amount: String(amount) })),
      spentBySpender: [...spentBySpender].map(([key, amount]) => {
        const [token, spender] = key.split('|');
        return { token, spender, amount: String(amount) };
      }),
      maxGasCostWei: maxGasCost === null ? null : String(maxGasCost),
      maxGasCostBasis: maxGasCost === null ? null : 'derived:sum(gasLimit*maxFeePerGasWei)',
      gasHeadroomWei: headroom === null ? null : String(headroom),
    });
  }
  boundaries.push(...results.sort((a, c) => a.boundaryId - c.boundaryId));
  for (const t of input.transactions) {
    if (t.origin !== 'decision' && t.origin !== 'unknown') auxiliaryTransactions.push({ hash: t.hash, origin: t.origin });
  }
  auxiliaryTransactions.sort((a, c) => (a.hash < c.hash ? -1 : a.hash > c.hash ? 1 : 0));
  return finish();
}

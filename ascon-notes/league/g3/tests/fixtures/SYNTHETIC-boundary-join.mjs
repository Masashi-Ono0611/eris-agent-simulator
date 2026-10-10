// 人工契約のみ。実チェーン・実送信・実記録器の値ではない。
// 取引表の posthoc 判定と出力試行は、既存結合器の出力を模した人工の投影。
const address = digit => `0x${digit.repeat(40)}`;
const txHash = digit => `0x${digit.repeat(64)}`;
export const owner = address('a');
export const tokens = { weth: address('1'), usdc: address('2') };
export const spenders = { uniswap: address('3'), curve: address('4') };
export const hashes = { first: txHash('5'), second: txHash('6'), third: txHash('7'), refill: txHash('8') };

const observed = (boundaryId, block, kind, value, extra = {}) => ({
  kind, ...extra, value, availability: 'observed', boundaryId, resolvedBlockNumber: block,
});
const economic = (boundaryId, block, balances, allowances) => [
  ...Object.entries(balances).flatMap(([token, [balance, reservation]]) => [
    observed(boundaryId, block, 'balance', balance, { token, owner }),
    observed(boundaryId, block, 'reservation', reservation, { token, owner }),
  ]),
  ...allowances.map(([token, spender, value]) => observed(boundaryId, block, 'allowance', value, { token, owner, spender })),
  observed(boundaryId, block, 'ethBalance', '10000000000000000', { owner }),
  observed(boundaryId, block, 'pendingGas', '1000000000000000', { owner }),
  observed(boundaryId, block, 'gasReserve', '5000000000000000', { owner }),
];

export function syntheticBoundaryJoin() {
  const pass = () => ({ J06: 'PASS', J07: 'PASS', J08: 'PASS' });
  return {
    schema: 1, provenance: 'SYNTHETIC', worldId: 'synthetic-world-1', owner,
    attempts: [
      { decisionId: 2, path: 'submit', ordinal: 1, disposition: 'sent' },
      { decisionId: 2, path: 'submit', ordinal: 2, disposition: 'not_sent' },
      { decisionId: 2, path: 'return', ordinal: 1, disposition: 'sent' },
      { decisionId: 5, path: 'submit', ordinal: 1, disposition: 'discarded' },
    ],
    transactions: [
      { hash: hashes.first, worldId: 'synthetic-world-1', origin: 'decision', blockNumber: 101, posthoc: pass() },
      { hash: hashes.second, worldId: 'synthetic-world-1', origin: 'decision', blockNumber: 102, posthoc: pass() },
      { hash: hashes.third, worldId: 'synthetic-world-1', origin: 'decision', blockNumber: 103, posthoc: pass() },
      { hash: hashes.refill, worldId: 'synthetic-world-1', origin: 'gas_refill', blockNumber: 103, posthoc: pass() },
    ],
    boundaries: [
      {
        // 1つの試行から2本の取引。同じ token を2つの spender へ支出する。
        boundaryId: 1, attempt: { decisionId: 2, path: 'submit', ordinal: 1 }, outcome: 'sent', observedAtBlock: 100,
        legs: [
          { token: tokens.weth, spender: spenders.uniswap, amount: '1000000000000000000' },
          { token: tokens.weth, spender: spenders.curve, amount: '500000000000000000' },
        ],
        txs: [
          { hash: hashes.first, from: owner, nonce: 7, gasLimit: '200000', maxFeePerGasWei: '2000000000' },
          { hash: hashes.second, from: owner, nonce: 8, gasLimit: '300000', maxFeePerGasWei: '2000000000' },
        ],
        evidence: economic(1, 100, { [tokens.weth]: ['2000000000000000000', '300000000000000000'] }, [
          [tokens.weth, spenders.uniswap, '1000000000000000000'],
          [tokens.weth, spenders.curve, '900719925474099312345'],
        ]),
      },
      {
        // 送信前に拒否された試行。取引は無いが境界の経済値は残す。
        boundaryId: 2, attempt: { decisionId: 2, path: 'submit', ordinal: 2 }, outcome: 'not_sent', observedAtBlock: 100,
        legs: [{ token: tokens.usdc, spender: spenders.uniswap, amount: '5000000' }],
        txs: [],
        evidence: economic(2, 100, { [tokens.usdc]: ['9000000', '0'] }, [
          [tokens.usdc, spenders.uniswap, '0'],
        ]),
      },
      {
        // 2^53 を超える残高を BigInt で扱う。
        boundaryId: 3, attempt: { decisionId: 2, path: 'return', ordinal: 1 }, outcome: 'sent', observedAtBlock: 101,
        legs: [{ token: tokens.usdc, spender: spenders.curve, amount: '900719925474099312000' }],
        txs: [{ hash: hashes.third, from: owner, nonce: 9, gasLimit: '100000', maxFeePerGasWei: '3000000000' }],
        evidence: economic(3, 101, { [tokens.usdc]: ['900719925474099312345', '345'] }, [
          [tokens.usdc, spenders.curve, '900719925474099312000'],
        ]),
      },
    ],
  };
}

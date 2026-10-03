import { http, type Transport } from 'viem';

// Conservative subset of docs/guide/practice-devnet.md and the checked-in
// infra/rpc-gateway/gateway.mjs allowlist. Unknown methods fail closed.
const allowed = new Set([
  'web3_clientVersion', 'net_version', 'net_listening',
  'eth_chainId', 'eth_blockNumber', 'eth_syncing', 'eth_gasPrice', 'eth_maxPriorityFeePerGas',
  'eth_feeHistory', 'eth_blobBaseFee', 'eth_getBalance', 'eth_getCode', 'eth_getStorageAt',
  'eth_getTransactionCount', 'eth_getProof', 'eth_call', 'eth_estimateGas', 'eth_createAccessList',
  'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getBlockTransactionCountByNumber',
  'eth_getBlockTransactionCountByHash', 'eth_getTransactionByHash', 'eth_getRawTransactionByHash',
  'eth_getTransactionByBlockNumberAndIndex', 'eth_getTransactionByBlockHashAndIndex',
  'eth_getRawTransactionByBlockNumberAndIndex', 'eth_getRawTransactionByBlockHashAndIndex',
  'eth_getTransactionReceipt', 'eth_getBlockReceipts', 'eth_getLogs', 'eth_sendRawTransaction',
]);

export function assertAllowed(method: unknown): asserts method is string {
  if (typeof method !== 'string' || !allowed.has(method)) throw new Error('Practice RPC method not allowed');
}

export function assertPayload(payload: unknown): void {
  const calls = Array.isArray(payload) ? payload : [payload];
  if (!calls.length) throw new Error('Empty RPC batch');
  for (const call of calls) {
    if (!call || typeof call !== 'object') throw new Error('Malformed RPC request');
    assertAllowed((call as { method?: unknown }).method);
  }
}

// Used both by viem and the raw HTTP status probe. Validate the entire batch
// before handing any request bytes to fetch; do not print params or credentials.
export function guardedFetch(send: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if ((method !== 'GET' && method !== 'HEAD') || init?.body != null || (input instanceof Request && input.body !== null)) {
      let body: string;
      if (typeof init?.body === 'string') body = init.body;
      else if (init?.body === undefined && input instanceof Request) body = await input.clone().text();
      else throw new Error('Uninspectable RPC body');
      let payload: unknown;
      try { payload = JSON.parse(body); } catch { throw new Error('Malformed RPC JSON'); }
      assertPayload(payload);
    }
    return send(input, init);
  }) as typeof fetch;
}

export function practiceTransport(url: string, headers: Record<string,string> = {}, send: typeof fetch = globalThis.fetch): Transport {
  return http(url, { retryCount: 0, fetchFn: guardedFetch(send), fetchOptions: { headers } });
}

export async function rpc(url: string, method: string, params: unknown[] = [], headers: Record<string,string> = {}, send: typeof fetch = globalThis.fetch) {
  assertAllowed(method);
  const response = await guardedFetch(send)(url, { method:'POST', headers:{'content-type':'application/json',...headers},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}) });
  return { status:response.status, body:await response.json().catch(() => null) as unknown };
}

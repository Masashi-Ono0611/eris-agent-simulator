// Preloaded before the upstream agent runtime creates its viem transports.
// No upstream or agent source modifications are needed.
import { guardedFetch } from './transport.js';
globalThis.fetch = guardedFetch(globalThis.fetch);

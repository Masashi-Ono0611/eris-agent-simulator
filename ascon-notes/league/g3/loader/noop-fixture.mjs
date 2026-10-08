// No imports or reads: sourceSha256 covers the complete fixture module.
let calls = 0;
export function decide(obs, ctx) {
  calls++;
  if (obs.offlineGuardControl) {
    // Positive control: verifies the network guard inside a stock worker, no I/O.
    try { fetch('https://g3-must-never-resolve.invalid'); }
    catch (error) { return { type: 'noop', reason: error.code }; }
    throw Error('offline guard failed to fire');
  }
  if (obs.waitForSelection) return new Promise(resolve => setTimeout(() => {
    ctx.submit({ type: 'noop', reason: 'old-generation-submit' });
    resolve({ type: 'noop', reason: 'old-generation-result' });
  }, 60));
  return obs.round === 1 ? null : { type: 'noop', reason: `module-call-${calls}` };
}

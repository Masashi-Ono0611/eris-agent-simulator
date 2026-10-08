import { openSync, writeSync, closeSync } from 'node:fs';
import { threadId } from 'node:worker_threads';

export function probeError(code) {
  return Object.assign(new Error(code), { code });
}

// Only callers' fixed schema fields enter here; never pass source, messages or context.
// One O_APPEND write per record. This is not a durable/fsync or distributed log.
export function makeWriter(path, shared) {
  const counters = new Int32Array(shared);
  return (event, fields = {}) => {
    if (Atomics.load(counters, 1)) throw probeError('G3_WRITE_FAILED');
    let fd;
    try {
      const bytes = Buffer.from(JSON.stringify({
        schema: 1, seq: Atomics.add(counters, 0, 1) + 1,
        threadId, utc: new Date().toISOString(), monoNs: process.hrtime.bigint().toString(),
        event, ...fields,
      }) + '\n');
      fd = openSync(path, 'a', 0o600);
      if (writeSync(fd, bytes) !== bytes.length) throw probeError('G3_SHORT_WRITE');
      closeSync(fd);
      fd = undefined;
    } catch {
      if (fd !== undefined) { try { closeSync(fd); } catch {} }
      Atomics.store(counters, 1, 1);
      process.exitCode = 1;
      // Do not expose the path or the OS error (which may contain private data).
      throw probeError('G3_WRITE_FAILED');
    }
  };
}

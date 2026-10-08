// Test-only guard, inherited by EVERY worker in both arms of the comparison.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import child from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const deny = code => () => { throw Object.assign(new Error(code), { code }); };
globalThis.fetch = deny('G3_OFFLINE_NETWORK');
for (const target of [http, https]) for (const key of ['get', 'request']) target[key] = deny('G3_OFFLINE_NETWORK');
for (const key of ['connect', 'createConnection']) net[key] = deny('G3_OFFLINE_NETWORK');
net.Socket.prototype.connect = deny('G3_OFFLINE_NETWORK');
tls.connect = deny('G3_OFFLINE_NETWORK');
dgram.createSocket = deny('G3_OFFLINE_NETWORK');
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  child[key] = deny('G3_OFFLINE_CHILD');
}
syncBuiltinESMExports();

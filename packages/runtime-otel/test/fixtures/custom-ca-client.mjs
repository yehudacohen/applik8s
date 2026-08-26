import { readFileSync } from 'node:fs';
import { startApplicationOpenTelemetryRuntime } from '../../dist/index.js';

const [endpoint, trustMode, serverName, certificatePath] = process.argv.slice(2);
if (!endpoint || !trustMode) {
  throw new Error('Usage: custom-ca-client.mjs <endpoint> <system|custom-ca> [server-name] [certificate-path]');
}

const certificateAuthority = trustMode === 'custom-ca'
  ? readFileSync(certificatePath, 'utf8')
  : undefined;
const session = await startApplicationOpenTelemetryRuntime({
  application: 'custom-ca-receiver-proof',
  environment: 'test',
  target: 'local',
  endpoint,
  signals: ['traces'],
  headers: { 'x-collector-token': 'custom-ca-header-canary' },
  ...(certificateAuthority ? { certificateAuthority } : {}),
  ...(serverName ? { serverName } : {}),
  batchDelayMs: 10,
  exportTimeoutMs: 500,
  maximumTraceQueueSize: 8,
  log: () => undefined,
});

await session.runtime.run(
  { kind: 'operation', identity: `custom-ca.${trustMode}.${serverName ?? 'default'}` },
  async () => undefined,
);
await session.shutdown();

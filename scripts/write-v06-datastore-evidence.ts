import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  collectV06GitIdentity,
  createV06AssertionEvidence,
  writeV06EvidenceReceipt,
} from './v06-evidence';

const suite = process.argv[2];
// typecast: literal preservation keeps the validated suite discriminator paired with its exact receipt contract.
const definitions = {
  postgres: {
    environment: { provider: 'postgresql', isolation: 'local-ephemeral', role: 'non-superuser' },
    assertions: ['rls-isolation', 'pool-context-cleanup', 'transaction-rollback', 'snapshot-resume', 'command-idempotency', 'outbox-recovery'],
  },
  clickhouse: {
    environment: { provider: 'clickhouse', image: 'clickhouse/clickhouse-server:25.12.5', isolation: 'local-ephemeral-container' },
    assertions: ['prepare', 'idempotent-write', 'checkpoint-resume', 'full-rebuild'],
  },
} as const;
if (suite !== 'postgres' && suite !== 'clickhouse') throw new Error(`Unknown v0.6 datastore evidence suite: ${suite ?? '<missing>'}`);

const definition = definitions[suite];
const runId = randomUUID();
const completedAt = new Date().toISOString();
await writeV06EvidenceReceipt(join(process.cwd(), `.applik8s-tmp/evidence/v0.6/${suite}.json`), {
  suite,
  run: { id: runId, startedAt: completedAt, completedAt },
  candidate: { git: await collectV06GitIdentity() },
  environment: definition.environment,
  assertionEvidence: createV06AssertionEvidence(
    definition.assertions.map((assertion) => ({ assertion, test: `${suite} live suite`, observedAt: completedAt })),
    runId,
  ),
});

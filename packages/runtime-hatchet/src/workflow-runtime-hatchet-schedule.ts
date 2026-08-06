// typecast-file-boundary: Hatchet schedule responses are shape-checked before provider records are exposed through the portable schedule contract.
import { createHash } from 'node:crypto';
import type {
  ApplicationWorkflowInvocationMetadata,
  ApplicationWorkflowScheduleResult,
  ApplicationWorkflowScheduleSpec,
} from '@applik8s/applik8s/workflow-runtime';
import { Priority } from '@hatchet-dev/typescript-sdk/v1/index.js';
import { applicationMetadata } from './workflow-runtime-hatchet-metadata.js';
import {
  boundedHatchetOperation,
  defaultHatchetOperationTimeoutMs,
} from './workflow-runtime-hatchet-operation.js';
import {
  boundedCronExpression,
  boundedJsonObject,
  boundedScheduleString,
  canonicalJson,
} from './workflow-runtime-hatchet-values.js';

interface HatchetCronRecord {
  readonly metadata: { readonly id: string };
  readonly name?: string;
  readonly cron: string;
  readonly enabled: boolean;
  readonly additionalMetadata?: Readonly<Record<string, unknown>>;
}

interface HatchetCronBoundary {
  readonly cron: {
    list(query: {
      readonly workflow?: string;
      readonly cronName?: string;
      readonly limit?: number;
      readonly offset?: number;
    }): Promise<{ readonly rows?: readonly HatchetCronRecord[] }>;
    create(
      workflow: string,
      input: {
        readonly name: string;
        readonly expression: string;
        readonly input: object;
        readonly additionalMetadata?: Readonly<Record<string, string>>;
        readonly priority?: number;
      },
    ): Promise<HatchetCronRecord>;
    delete(cron: string | HatchetCronRecord): Promise<void>;
  };
}

const maximumSchedulesPerIdentity = 16;
const scheduleFingerprintKey = 'applik8s.schedule.fingerprint';
const scheduleRevisionKey = 'applik8s.schedule.revision';

/** Exported as a provider-contract test seam; applications use the WorkflowEngine abstraction. */
export async function reconcileHatchetWorkflowSchedule<TInput extends object>(
  client: HatchetCronBoundary,
  contract: string,
  schedule: ApplicationWorkflowScheduleSpec<TInput>,
  metadata?: ApplicationWorkflowInvocationMetadata,
): Promise<ApplicationWorkflowScheduleResult> {
  const id = boundedScheduleString(schedule.id, 'id', 200);
  const revision = boundedScheduleString(schedule.revision, 'revision', 500);
  if (typeof schedule.enabled !== 'boolean') {
    throw new Error('applik8s-workflow-schedule-enabled-invalid');
  }
  const expression = schedule.enabled
    ? boundedCronExpression(schedule.expression)
    : schedule.expression;
  const encodedInput = boundedJsonObject(schedule.input, 'input', 64 * 1_024);
  const fingerprint = createHash('sha256')
    .update(canonicalJson({ contract, expression, input: encodedInput, revision }))
    .digest('hex');
  const listed = await boundedHatchetOperation(
    () =>
      client.cron.list({
        workflow: contract,
        cronName: id,
        limit: maximumSchedulesPerIdentity + 1,
        offset: 0,
      }),
    id,
    'list recurring schedule',
    { timeoutMs: defaultHatchetOperationTimeoutMs },
  );
  const rows = (listed.rows ?? []).filter((row) => row.name === id);
  if (rows.length > maximumSchedulesPerIdentity) {
    throw new Error(`applik8s-workflow-schedule-duplicates-exceeded: ${id}`);
  }
  const matching =
    rows.length === 1
    && rows[0]?.enabled === true
    && rows[0]?.cron === expression
    && rows[0]?.additionalMetadata?.[scheduleFingerprintKey] === fingerprint;
  if (schedule.enabled && matching) {
    const row = rows[0]!;
    return { id, revision, state: 'unchanged', providerId: row.metadata.id };
  }
  await Promise.all(
    rows.map((row) =>
      boundedHatchetOperation(
        () => client.cron.delete(row),
        id,
        'remove recurring schedule',
        { timeoutMs: defaultHatchetOperationTimeoutMs },
      ),
    ),
  );
  if (!schedule.enabled) {
    return {
      id,
      revision,
      state: rows.length > 0 ? 'removed' : 'unchanged',
    };
  }
  const created = await boundedHatchetOperation(
    () =>
      client.cron.create(contract, {
        name: id,
        expression,
        input: encodedInput,
        additionalMetadata: {
          ...applicationMetadata(metadata),
          [scheduleRevisionKey]: revision,
          [scheduleFingerprintKey]: fingerprint,
        },
        ...(metadata?.priority
          ? {
              priority:
                metadata.priority === 'high'
                  ? Priority.HIGH
                  : metadata.priority === 'low'
                    ? Priority.LOW
                    : Priority.MEDIUM,
            }
          : {}),
      }),
    id,
    'create recurring schedule',
    { timeoutMs: defaultHatchetOperationTimeoutMs },
  );
  return {
    id,
    revision,
    state: 'created',
    providerId: created.metadata.id,
  };
}

// typecast-file-boundary: The in-memory client exercises AWS SDK command inputs without network access.
import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
  SchedulerClient,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { describe, expect, it } from 'vitest';
import { createAwsApplicationScheduleRuntime } from '../src/schedule.js';

const configuration = {
  applicationId: 'documents',
  environmentId: 'production',
  region: 'us-east-1',
  queueUrl: 'https://sqs.us-east-1.example.test/admission',
  queueArn: 'arn:aws:sqs:us-east-1:123456789012:admission',
  deadLetterQueueArn: 'arn:aws:sqs:us-east-1:123456789012:dead-letter',
  groupName: 'documents-production',
  executionRoleArn: 'arn:aws:iam::123456789012:role/scheduler',
  databaseUrl: 'postgres://runtime.example.test/documents',
} as const;

const definition = {
  id: 'source.poll.v1',
  configuration: 'dynamic' as const,
  timezone: 'UTC',
  overlap: 'skip' as const,
  overlapBy: (input: object) => String(Reflect.get(input, 'sourceId')),
  retry: { maxAttempts: 4, maximumAgeSeconds: 3_600 },
  requirements: { precision: 'minute' as const },
};

describe('AWS function-native Scheduler', () => {
  it('converges revisions, repairs drift, and retains a dead-letter target', async () => {
    const client = new MemorySchedulerClient();
    const runtime = createAwsApplicationScheduleRuntime(configuration, {
      scheduler: client as unknown as SchedulerClient,
    });
    const request = {
      definition,
      instance: {
        id: 'tenant-a', revision: '1', input: { sourceId: 'source-a' }, every: '5m', enabled: true,
      },
      handler: async () => undefined,
    };

    await expect(runtime.reconcile(request)).resolves.toMatchObject({ state: 'created', revision: '1' });
    expect(client.mutations).toEqual(['CreateScheduleCommand']);
    expect(client.current?.Target).toMatchObject({
      DeadLetterConfig: { Arn: configuration.deadLetterQueueArn },
      RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 3_600 },
    });
		expect(JSON.parse(String((client.current?.Target as { Input?: string } | undefined)?.Input))).toMatchObject({
			overlap: 'skip',
			overlapKey: 'source-a',
		});
    expect(client.current?.Description).toMatch(/^applik8s\.schedule\/v1:/u);

    await expect(runtime.reconcile(request)).resolves.toMatchObject({ state: 'unchanged' });
    expect(client.mutations).toEqual(['CreateScheduleCommand']);

    client.current = { ...client.current!, ScheduleExpression: 'rate(15 minutes)' };
    await expect(runtime.reconcile(request)).resolves.toMatchObject({ state: 'updated' });
    expect(client.mutations).toEqual(['CreateScheduleCommand', 'UpdateScheduleCommand']);

    await expect(runtime.reconcile({
      ...request,
      instance: { ...request.instance, input: { sourceId: 'different' } },
    })).rejects.toThrow(/conflicts with different desired state/u);

    await expect(runtime.reconcile({
      ...request,
      instance: { ...request.instance, revision: '0' },
    })).rejects.toThrow(/is stale/u);

    await expect(runtime.reconcile({
      ...request,
      instance: { ...request.instance, revision: '2', every: '10m' },
    })).resolves.toMatchObject({ state: 'updated', revision: '2' });
    expect(client.current?.ScheduleExpression).toBe('rate(10 minutes)');

    await expect(runtime.remove(definition.id, request.instance.id)).resolves.toMatchObject({ state: 'removed' });
    await expect(runtime.remove(definition.id, request.instance.id)).resolves.toMatchObject({ state: 'unchanged' });
  });

  it('refuses to adopt an unowned schedule with the same deterministic identity', async () => {
    const client = new MemorySchedulerClient();
    client.current = {
      Name: 'external', GroupName: configuration.groupName, Description: 'owned elsewhere',
    };
    const runtime = createAwsApplicationScheduleRuntime(configuration, {
      scheduler: client as unknown as SchedulerClient,
    });
    await expect(runtime.reconcile({
      definition,
      instance: { id: 'tenant-a', revision: '1', input: {}, every: '5m' },
      handler: async () => undefined,
    })).rejects.toThrow(/not owned by Applik8s/u);
    expect(client.mutations).toEqual([]);
  });
});

class MemorySchedulerClient {
  current: Record<string, unknown> | undefined;
  readonly mutations: string[] = [];

  async send(command: object): Promise<Record<string, unknown>> {
    if (command instanceof GetScheduleCommand) {
      if (!this.current) throw { name: 'ResourceNotFoundException', $metadata: { httpStatusCode: 404 } };
      return structuredClone(this.current);
    }
    if (command instanceof CreateScheduleCommand || command instanceof UpdateScheduleCommand) {
      this.mutations.push(command.constructor.name);
      this.current = structuredClone(command.input) as unknown as Record<string, unknown>;
      return {};
    }
    if (command instanceof DeleteScheduleCommand) {
      if (!this.current) throw { name: 'ResourceNotFoundException', $metadata: { httpStatusCode: 404 } };
      this.mutations.push(command.constructor.name);
      this.current = undefined;
      return {};
    }
    throw new Error(`Unexpected command ${command.constructor.name}.`);
  }
}

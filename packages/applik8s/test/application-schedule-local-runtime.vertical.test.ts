import { mkdtemp, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJsonV1String } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { schedule } from '../src/application-schedule.js';
import {
  installLocalApplicationScheduleRuntime,
  localApplicationScheduleCanonicalJsonPolicy,
} from '../src/application-schedule-local-runtime.js';

describe('maintained local schedule runtime', () => {
  it('preserves the v1alpha1 durable byte contract through the named Canonical JSON policy', () => {
    expect(canonicalJsonV1String({
      schemaVersion: 'applik8s.scheduleRuntime/v1alpha1',
      optional: undefined,
      values: ['one', undefined, 'two'],
      revision: 3,
    }, localApplicationScheduleCanonicalJsonPolicy)).toBe(
      '{"revision":3,"schemaVersion":"applik8s.scheduleRuntime/v1alpha1","values":["one",null,"two"]}',
    );
  });

  it('discovers fixed handles, persists privately, and recovers prior occurrence receipts', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-schedules-'));
    const statePath = join(root, 'state', 'schedules.json');
    const clock = { now: new Date('2026-01-01T00:00:00.000Z') };
    const occurrences: string[] = [];
    const Cleanup = schedule({ id: 'cleanup.v1', every: '1m' }, async (context) => {
      occurrences.push(context.occurrenceId);
      return { cleaned: true };
    });
    const first = await installLocalApplicationScheduleRuntime({
      applicationId: 'demo', environmentId: 'local', schedules: [Cleanup], statePath, now: () => clock.now, tickIntervalMs: 60_000,
    });
    clock.now = new Date('2026-01-01T00:01:00.000Z');
    await expect(first.runtime.tick(clock.now)).resolves.toEqual([expect.objectContaining({ state: 'succeeded' })]);
    await first.stop();
    expect((await stat(statePath)).mode & 0o777).toBe(0o600);

    const restarted = await installLocalApplicationScheduleRuntime({
      applicationId: 'demo', environmentId: 'local', schedules: [Cleanup], statePath, now: () => clock.now, tickIntervalMs: 60_000,
    });
    await expect(restarted.runtime.tick(clock.now)).resolves.toEqual([]);
    await restarted.stop();
    expect(occurrences).toHaveLength(1);
  });

  it('leases one local scheduling authority and releases it on orderly shutdown', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-schedule-lease-'));
    const statePath = join(root, 'schedules.json');
    const first = await installLocalApplicationScheduleRuntime({
      applicationId: 'lease-test',
      environmentId: 'local',
      schedules: [],
      statePath,
      tickIntervalMs: 60_000,
    });
    await expect(installLocalApplicationScheduleRuntime({
      applicationId: 'lease-test',
      environmentId: 'local',
      schedules: [],
      statePath,
      tickIntervalMs: 60_000,
    })).rejects.toThrow(/already held by process/u);
    await first.stop();
    const restarted = await installLocalApplicationScheduleRuntime({
      applicationId: 'lease-test',
      environmentId: 'local',
      schedules: [],
      statePath,
      tickIntervalMs: 60_000,
    });
    await restarted.stop();
  });
});

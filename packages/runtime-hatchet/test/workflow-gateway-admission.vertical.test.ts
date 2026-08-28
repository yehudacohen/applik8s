// typecast-file-boundary: Hatchet admission fixtures deliberately supply narrowed provider records and malformed compatibility inputs at the transport boundary.
import { describe, expect, it, vi } from 'vitest';
import { compactHatchetWorkflowAdmissionPage } from '../src/workflow-gateway-admission.js';

const nowMs = Date.parse('2026-08-26T12:00:00.000Z');

function lease(input: {
  readonly name: string;
  readonly uid: string;
  readonly admittedAt: string;
  readonly runId: string;
  readonly state?: string;
}) {
  return {
    metadata: {
      name: input.name,
      uid: input.uid,
      annotations: {
        'applik8s.dev/admission-state': input.state ?? 'admitted',
        'applik8s.dev/admitted-at': input.admittedAt,
        'applik8s.dev/provider-run-id': input.runId,
      },
    },
  };
}

describe('Hatchet workflow gateway admission retention', () => {
  it('deletes only expired terminal or provider-absent admissions with UID fencing', async () => {
    const records = [
      lease({ name: 'terminal', uid: 'uid-terminal', admittedAt: '2026-08-19T11:59:59.000Z', runId: 'run-terminal' }),
      lease({ name: 'missing', uid: 'uid-missing', admittedAt: '2026-08-19T11:59:59.000Z', runId: 'run-missing' }),
      lease({ name: 'active', uid: 'uid-active', admittedAt: '2026-08-19T11:59:59.000Z', runId: 'run-active' }),
      lease({ name: 'recent', uid: 'uid-recent', admittedAt: '2026-08-26T11:59:59.000Z', runId: 'run-recent' }),
      lease({ name: 'starting', uid: 'uid-starting', admittedAt: '2026-08-19T11:59:59.000Z', runId: 'run-starting', state: 'starting' }),
    ];
    const listPage = vi.fn(async () => ({ items: records, nextCursor: 'next-page' }));
    const runState = vi.fn(async (runId: string) => {
      if (runId === 'run-terminal') return 'terminal' as const;
      if (runId === 'run-missing') return 'missing' as const;
      return 'active' as const;
    });
    const deleteLease = vi.fn(async () => 'deleted' as const);

    await expect(compactHatchetWorkflowAdmissionPage({
      nowMs,
      replayWindowSeconds: 7 * 24 * 60 * 60,
      cleanupBatchSize: 50,
      cursor: 'current-page',
      listPage,
      runState,
      deleteLease,
    })).resolves.toEqual({ inspected: 5, deleted: 2, nextCursor: 'next-page' });
    expect(listPage).toHaveBeenCalledWith({ cursor: 'current-page', limit: 50 });
    expect(runState).toHaveBeenCalledTimes(3);
    expect(deleteLease.mock.calls).toEqual([
      [{ name: 'terminal', uid: 'uid-terminal' }],
      [{ name: 'missing', uid: 'uid-missing' }],
    ]);
  });

  it('fails closed for invalid policy and never deletes an ambiguous identity', async () => {
    const deleteLease = vi.fn(async () => 'deleted' as const);
    await expect(compactHatchetWorkflowAdmissionPage({
      nowMs,
      replayWindowSeconds: 59,
      cleanupBatchSize: 1,
      listPage: async () => ({ items: [] }),
      runState: async () => 'terminal',
      deleteLease,
    })).rejects.toThrow('at least 60 seconds');

    await expect(compactHatchetWorkflowAdmissionPage({
      nowMs,
      replayWindowSeconds: 60,
      cleanupBatchSize: 1,
      listPage: async () => ({
        items: [{ metadata: { name: 'missing-uid', annotations: {
          'applik8s.dev/admission-state': 'admitted',
          'applik8s.dev/admitted-at': '2026-08-19T11:59:59.000Z',
          'applik8s.dev/provider-run-id': 'run-terminal',
        } } }],
      }),
      runState: async () => 'terminal',
      deleteLease,
    })).resolves.toEqual({ inspected: 1, deleted: 0 });
    expect(deleteLease).not.toHaveBeenCalled();
  });

  it('does not count a UID conflict as deletion', async () => {
    await expect(compactHatchetWorkflowAdmissionPage({
      nowMs,
      replayWindowSeconds: 60,
      cleanupBatchSize: 1,
      listPage: async () => ({ items: [lease({
        name: 'replacement',
        uid: 'old-uid',
        admittedAt: '2026-08-19T11:59:59.000Z',
        runId: 'run-terminal',
      })] }),
      runState: async () => 'terminal',
      deleteLease: async () => 'conflict',
    })).resolves.toEqual({ inspected: 1, deleted: 0 });
  });
});
// typecast-file-boundary: Hatchet admission fixtures deliberately supply narrowed provider records and malformed compatibility inputs at the transport boundary.

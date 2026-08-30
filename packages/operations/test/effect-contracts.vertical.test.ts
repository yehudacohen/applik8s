import { describe, expect, it } from 'vitest';
import type { JsonValue, RuntimeSchema } from '@applik8s/core';
import {
  EffectContractSchemaVersion,
  EffectReceiptSchemaVersion,
  appendEffectReceipt,
  defineEffectContract,
  type EffectContract,
  type EffectInvocationIdentity,
  type EffectReceipt,
} from '../src/index.js';

const schema = {} as RuntimeSchema<Record<string, JsonValue>>;

const identity: EffectInvocationIdentity = {
  effect: {
    application: 'chirp',
    capability: 'Mail',
    method: 'send',
    revision: 'v1',
  },
  scope: 'organization:acme',
  logicalId: 'welcome:member-1',
  attemptId: 'attempt-1',
  causalExecutionId: 'job:onboard-member-1',
  causalPrincipalId: 'principal:owner-1',
};

function receipt<T extends EffectReceipt>(value: Omit<T, 'apiVersion' | 'identity'>): T {
  return {
    apiVersion: EffectReceiptSchemaVersion,
    identity,
    ...value,
  } as T;
}

describe('effect contracts', () => {
  it('accepts explicit provider guarantees and rejects unsafe combinations', () => {
    const contract: EffectContract<Record<string, JsonValue>, Record<string, JsonValue>> = {
      apiVersion: EffectContractSchemaVersion,
      identity: identity.effect,
      input: schema,
      result: schema,
      guarantees: ['idempotent', 'receipted'],
      authority: { operationId: 'mail.send', reauthorizeOnRetry: false },
      idempotency: { mode: 'logicalIdentity', providerKey: 'Idempotency-Key' },
      fencing: { mode: 'none' },
      receipt: { authority: 'provider', observation: 'byLogicalIdentity' },
      cancellation: { mode: 'bestEffort' },
      retry: { mode: 'idempotent', maximumAttempts: 3 },
    };
    expect(defineEffectContract(contract)).toMatchObject({ identity: identity.effect });
    expect(() => defineEffectContract({
      ...contract,
      guarantees: ['unfencedExternal', 'dependencyFenced'],
      fencing: { mode: 'dependency' },
    })).toThrow('cannot claim dependency fencing');
    expect(() => defineEffectContract({
      ...contract,
      guarantees: ['receipted'],
      idempotency: { mode: 'none' },
      receipt: { authority: 'provider', observation: 'unsupported' },
      retry: { mode: 'afterProvenAbsent', maximumAttempts: 2 },
    })).toThrow('requires a provider observation path');
  });

  it('preserves one logical identity across attempts and appends immutable receipts', () => {
    const admitted = receipt<EffectReceipt>({
      receiptId: 'receipt-1',
      recordedAt: '2026-08-30T12:00:00.000Z',
      status: 'admitted',
      admittedAt: '2026-08-30T12:00:00.000Z',
    });
    const accepted = receipt<EffectReceipt>({
      receiptId: 'receipt-2',
      predecessorReceiptId: 'receipt-1',
      recordedAt: '2026-08-30T12:00:01.000Z',
      status: 'accepted',
      providerReceipt: 'provider-reference-1',
    });
    const succeeded = receipt<EffectReceipt>({
      receiptId: 'receipt-3',
      predecessorReceiptId: 'receipt-2',
      recordedAt: '2026-08-30T12:00:02.000Z',
      status: 'succeeded',
      result: { messageId: 'message-1' },
    });
    const history = appendEffectReceipt(
      appendEffectReceipt(appendEffectReceipt([], admitted), accepted),
      succeeded,
    );
    expect(history.map(({ status }) => status)).toEqual(['admitted', 'accepted', 'succeeded']);
    expect(Object.isFrozen(history)).toBe(true);
    expect(() => appendEffectReceipt(history, receipt<EffectReceipt>({
      receiptId: 'receipt-4',
      predecessorReceiptId: 'receipt-3',
      recordedAt: '2026-08-30T12:00:03.000Z',
      status: 'failed',
      error: { name: 'LateFailure', message: 'cannot rewrite success', retryable: false },
    }))).toThrow('cannot transition from succeeded to failed');
  });

  it('resolves interrupted acceptance honestly through observation or operator disposition', () => {
    const admitted = receipt<EffectReceipt>({
      receiptId: 'receipt-1',
      recordedAt: '2026-08-30T12:00:00.000Z',
      status: 'admitted',
      admittedAt: '2026-08-30T12:00:00.000Z',
    });
    const unknown = receipt<EffectReceipt>({
      receiptId: 'receipt-2',
      predecessorReceiptId: 'receipt-1',
      recordedAt: '2026-08-30T12:00:01.000Z',
      status: 'unknown',
      lastEvidence: {
        source: 'mail-provider',
        observedAt: '2026-08-30T12:00:01.000Z',
        reference: 'dispatch-1',
      },
    });
    const absent = receipt<EffectReceipt>({
      receiptId: 'receipt-3',
      predecessorReceiptId: 'receipt-2',
      recordedAt: '2026-08-30T12:00:02.000Z',
      status: 'absent',
      observedAt: '2026-08-30T12:00:02.000Z',
      evidence: {
        source: 'mail-provider.lookup',
        observedAt: '2026-08-30T12:00:02.000Z',
      },
      safeToRetry: true,
    });
    expect(appendEffectReceipt(appendEffectReceipt(appendEffectReceipt([], admitted), unknown), absent).at(-1)).toMatchObject({
      status: 'absent',
      safeToRetry: true,
    });
    expect(() => appendEffectReceipt([admitted], {
      ...absent,
      predecessorReceiptId: 'receipt-1',
    })).toThrow('cannot transition from admitted to absent');
  });

  it('fails closed when a receipt changes its logical identity or predecessor', () => {
    const admitted = receipt<EffectReceipt>({
      receiptId: 'receipt-1',
      recordedAt: '2026-08-30T12:00:00.000Z',
      status: 'admitted',
      admittedAt: '2026-08-30T12:00:00.000Z',
    });
    expect(() => appendEffectReceipt([admitted], {
      ...receipt<EffectReceipt>({
        receiptId: 'receipt-2',
        predecessorReceiptId: 'wrong',
        recordedAt: '2026-08-30T12:00:01.000Z',
        status: 'accepted',
        providerReceipt: 'provider-reference-1',
      }),
    })).toThrow('must follow receipt-1');
    expect(() => appendEffectReceipt([admitted], {
      ...receipt<EffectReceipt>({
        receiptId: 'receipt-2',
        predecessorReceiptId: 'receipt-1',
        recordedAt: '2026-08-30T12:00:01.000Z',
        status: 'accepted',
        providerReceipt: 'provider-reference-1',
      }),
      identity: { ...identity, logicalId: 'different-effect' },
    })).toThrow('identity changed');
  });
});

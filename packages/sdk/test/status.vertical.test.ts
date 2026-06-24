import { describe, expect, it } from 'vitest';
import { condition, externalEffectRecord, readyCondition, setCondition, setExternalEffect } from '../src/status.js';

describe('status condition helpers', () => {
  it('creates standard Kubernetes-style conditions', () => {
    expect(condition({
      type: 'Ready',
      status: 'False',
      reason: 'DependencyMissing',
      message: 'Waiting for dependency.',
      observedGeneration: 3,
      lastTransitionTime: '2026-06-21T00:00:00Z',
    })).toEqual({
      type: 'Ready',
      status: 'False',
      reason: 'DependencyMissing',
      message: 'Waiting for dependency.',
      observedGeneration: 3,
      lastTransitionTime: '2026-06-21T00:00:00Z',
    });
  });

  it('upserts conditions and records observed generation', () => {
    const status = setCondition(
      { phase: 'Provisioning' },
      { type: 'Ready', status: 'False', reason: 'DependencyMissing', message: 'Waiting for dependency.', observedGeneration: 7 },
      { now: '2026-06-21T00:00:00Z' }
    );

    expect(status).toEqual({
      phase: 'Provisioning',
      observedGeneration: 7,
      conditions: [{
        type: 'Ready',
        status: 'False',
        reason: 'DependencyMissing',
        message: 'Waiting for dependency.',
        observedGeneration: 7,
        lastTransitionTime: '2026-06-21T00:00:00Z',
      }],
    });
  });

  it('preserves lastTransitionTime until condition status changes', () => {
    const first = setCondition(
      {},
      { type: 'Ready', status: 'False', reason: 'DependencyMissing', message: 'Waiting.' },
      { now: '2026-06-21T00:00:00Z' }
    );
    const sameStatus = setCondition(
      first,
      { type: 'Ready', status: 'False', reason: 'StillWaiting', message: 'Still waiting.' },
      { now: '2026-06-21T00:01:00Z' }
    );
    const changedStatus = setCondition(
      sameStatus,
      { type: 'Ready', status: 'True', reason: 'Available', message: 'Ready.' },
      { now: '2026-06-21T00:02:00Z' }
    );

    expect(sameStatus.conditions[0]?.lastTransitionTime).toBe('2026-06-21T00:00:00Z');
    expect(changedStatus.conditions[0]?.lastTransitionTime).toBe('2026-06-21T00:02:00Z');
  });

  it('provides a Ready condition shortcut', () => {
    expect(readyCondition('True', 'Available', 'Ready.', 5)).toEqual({
      type: 'Ready',
      status: 'True',
      reason: 'Available',
      message: 'Ready.',
      observedGeneration: 5,
    });
  });

  it('creates durable external-effect records for capability calls', () => {
    expect(externalEffectRecord({
      capabilityName: 'processor',
      phase: 'IntentRecorded',
      idempotencyKey: 'ImageJob-hero:submit',
      requestDigest: 'sha256:request',
      observedAt: '2026-06-21T00:00:00Z',
    })).toEqual({
      capabilityName: 'processor',
      phase: 'IntentRecorded',
      idempotencyKey: 'ImageJob-hero:submit',
      requestDigest: 'sha256:request',
      observedAt: '2026-06-21T00:00:00Z',
    });
  });

  it('upserts external-effect records by capability and idempotency key', () => {
    const first = setExternalEffect(
      { phase: 'Processing' },
      {
        capabilityName: 'processor',
        phase: 'IntentRecorded',
        idempotencyKey: 'ImageJob-hero:submit',
        requestDigest: 'sha256:request',
      },
      { now: '2026-06-21T00:00:00Z' }
    );
    const updated = setExternalEffect(
      first,
      {
        capabilityName: 'processor',
        phase: 'Succeeded',
        idempotencyKey: 'ImageJob-hero:submit',
        requestDigest: 'sha256:request',
        responseDigest: 'sha256:response',
        condition: readyCondition('True', 'ExternalEffectSucceeded', 'Processor accepted the image job.'),
      },
      { now: '2026-06-21T00:01:00Z' }
    );

    expect(updated).toEqual({
      phase: 'Processing',
      effects: [{
        capabilityName: 'processor',
        phase: 'Succeeded',
        idempotencyKey: 'ImageJob-hero:submit',
        requestDigest: 'sha256:request',
        responseDigest: 'sha256:response',
        condition: {
          type: 'Ready',
          status: 'True',
          reason: 'ExternalEffectSucceeded',
          message: 'Processor accepted the image job.',
        },
        observedAt: '2026-06-21T00:01:00Z',
      }],
    });
  });
});

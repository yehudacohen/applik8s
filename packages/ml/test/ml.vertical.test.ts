import { app, applicationGraphFor } from '@applik8s/applik8s';
import { validateApplicationGraphStructure } from '@applik8s/core';
import { type } from '@applik8s/applik8s/dsl';
import {
  ApplicationMLBatchPartialFailureError,
  ApplicationMLPredictionError,
  ML,
} from '@applik8s/ml';
import { installApplicationMLRuntimeResolver } from '@applik8s/ml/runtime';
import { predictApplicationML } from '@applik8s/ml/runtime';
import { runApplicationProviderTelemetryBoundary } from '@applik8s/applik8s/telemetry-runtime';
import { afterEach, describe, expect, it } from 'vitest';

const artifact = ML.artifact({
  digest: `sha256:${'a'.repeat(64)}`,
  format: 'fixture',
  mediaType: 'application/vnd.applik8s.ml.fixture+json',
  sizeBytes: 128,
  modelVersion: '2026-08-31',
});

const RiskScore = ML.model('risk-score.v1', {
  input: type({ accountAgeDays: 'number.integer >= 0', amount: 'number >= 0' }),
  output: type({ score: '0 <= number <= 1', version: 'string' }),
}, {
  capabilities: [ML.predict, ML.batchPrediction],
  requirements: { deterministic: true, locality: 'local', maximumBatchSize: 8 },
});

const FraudScore = ML.model('fraud-score.v1', {
  input: type({ accountAgeDays: 'number.integer >= 0', amount: 'number >= 0' }),
  output: type({ score: '0 <= number <= 1', version: 'string' }),
}, {
  capabilities: [ML.predict],
  requirements: { deterministic: true, locality: 'local' },
});

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

describe('v0.9 provider-neutral ML models', () => {
  it('uses the callable logical model as its qualified application.provide target', () => {
    const application = app('ml-contract');
    const provider = ML.deterministic({
      artifact,
      output: { score: 0.25, version: '2026-08-31' },
    });
    application.provide(RiskScore, provider);

    const graph = applicationGraphFor(application.composition);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'provider',
        interface: 'MLModel',
        implementation: 'ml-deterministic',
        contract: expect.objectContaining({ support: 'implemented' }),
        config: expect.objectContaining({
          mlModel: expect.objectContaining({
            artifact: expect.objectContaining({ digest: artifact.digest }),
          }),
        }),
      }),
      expect.objectContaining({
        kind: 'mlModel',
        name: 'risk-score',
        contract: expect.objectContaining({ version: 'v1' }),
        capabilities: ['predict', 'batchPrediction'],
        provenance: {
          artifactIdentity: 'contentAddressed',
          receipt: 'required',
          sensitiveValues: 'redacted',
        },
      }),
    ]));
    expect(graph?.providerRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ interface: 'MLModel', purpose: 'mlInference' }),
    ]));
    expect(graph && validateApplicationGraphStructure(graph).filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  });

  it('validates online input and output while retaining redacted artifact provenance', async () => {
    const provider = ML.deterministic({
      artifact,
      cases: [{
        input: { accountAgeDays: 45, amount: 120 },
        output: { score: 0.12, version: '2026-08-31' },
      }],
    });
    disposers.push(installApplicationMLRuntimeResolver(() => provider));

    const result = await RiskScore({ accountAgeDays: 45, amount: 120 });
    expect(result.output).toEqual({ score: 0.12, version: '2026-08-31' });
    expect(result.receipt).toMatchObject({
      logicalModel: 'risk-score.v1',
      artifactDigest: artifact.digest,
      provider: 'local-deterministic',
      redaction: 'features-and-output-omitted',
    });
    expect(JSON.stringify(result.receipt)).not.toContain('accountAgeDays');

    await expect(RiskScore({ accountAgeDays: -1, amount: 120 }))
      .rejects.toMatchObject({ failure: { code: 'ML_INPUT_INVALID' } });
  });

  it('hydrates a qualified model through its portable generated-worker runtime contract', async () => {
    const provider = ML.deterministic({
      artifact,
      cases: [{
        input: { accountAgeDays: 45, amount: 120 },
        output: { score: 0.12, version: '2026-08-31' },
      }],
    });
    const runtime = RiskScore.callableRuntime?.bind?.(provider);
    expect(runtime?.env).toBeDefined();
    const environment = runtime?.env ?? {};

    const result = await runApplicationProviderTelemetryBoundary({
      interface: 'MLModel',
      nodeId: 'provider.mlmodel.v1alpha1.risk-score.v1',
      member: 'predict',
    }, () => predictApplicationML(
      { accountAgeDays: 45, amount: 120 },
      {},
      environment,
    ));

    expect(result).toMatchObject({
      output: { score: 0.12, version: '2026-08-31' },
      receipt: {
        logicalModel: 'risk-score.v1',
        artifactDigest: artifact.digest,
        provider: 'local-deterministic',
      },
    });
    expect(JSON.stringify(environment)).not.toContain('function');
  });

  it('isolates concurrent qualified models by compiler-owned provider identity', async () => {
    const risk = ML.deterministic({
      artifact,
      output: { score: 0.12, version: 'risk' },
      latencyMs: 5,
    });
    const fraudArtifact = ML.artifact({
      ...artifact,
      digest: `sha256:${'b'.repeat(64)}`,
      modelVersion: 'fraud-2026-08-31',
    });
    const fraud = ML.deterministic({
      artifact: fraudArtifact,
      output: { score: 0.91, version: 'fraud' },
      latencyMs: 1,
    });
    const environment = {
      ...(RiskScore.callableRuntime?.bind?.(risk).env ?? {}),
      ...(FraudScore.callableRuntime?.bind?.(fraud).env ?? {}),
    };
    const input = { accountAgeDays: 45, amount: 120 };

    const [riskResult, fraudResult] = await Promise.all([
      runApplicationProviderTelemetryBoundary({
        interface: 'MLModel', nodeId: 'provider.mlmodel.v1alpha1.risk-score.v1', member: 'predict',
      }, () => predictApplicationML(input, {}, environment)),
      runApplicationProviderTelemetryBoundary({
        interface: 'MLModel', nodeId: 'provider.mlmodel.v1alpha1.fraud-score.v1', member: 'predict',
      }, () => predictApplicationML(input, {}, environment)),
    ]);

    expect(riskResult).toMatchObject({
      output: { score: 0.12, version: 'risk' },
      receipt: { artifactDigest: artifact.digest, logicalModel: 'risk-score.v1' },
    });
    expect(fraudResult).toMatchObject({
      output: { score: 0.91, version: 'fraud' },
      receipt: { artifactDigest: fraudArtifact.digest, logicalModel: 'fraud-score.v1' },
    });
  });

  it('preserves every batch position and exposes partial failures under both policies', async () => {
    const provider = ML.deterministic({
      artifact,
      cases: [{
        input: { accountAgeDays: 45, amount: 120 },
        output: { score: 0.12, version: '2026-08-31' },
      }],
    });
    disposers.push(installApplicationMLRuntimeResolver(() => provider));
    const inputs = [
      { accountAgeDays: 45, amount: 120 },
      { accountAgeDays: 2, amount: 999 },
    ];

    const collected = await RiskScore.batch(inputs, { partialFailure: 'collect' });
    expect(collected.items.map((item) => [item.index, item.status])).toEqual([
      [0, 'succeeded'],
      [1, 'failed'],
    ]);
    await expect(RiskScore.batch(inputs, { partialFailure: 'fail' }))
      .rejects.toBeInstanceOf(ApplicationMLBatchPartialFailureError);
  });

  it('fails closed on incompatible providers, missing hydration, and timeouts', async () => {
    expect(() => app('bad-provider').provide(RiskScore, {
      ...ML.deterministic({ artifact, output: { score: 0.5, version: 'v1' } }),
      deterministic: false,
    })).toThrow(/does not satisfy .*MLModel/);

    await expect(RiskScore({ accountAgeDays: 1, amount: 1 }))
      .rejects.toMatchObject({ failure: { code: 'ML_MODEL_VERSION_UNAVAILABLE' } });

    const slow = ML.deterministic({
      artifact,
      output: { score: 0.5, version: 'v1' },
      latencyMs: 50,
    });
    disposers.push(installApplicationMLRuntimeResolver(() => slow));
    await expect(RiskScore({ accountAgeDays: 1, amount: 1 }, { timeoutMs: 5 }))
      .rejects.toEqual(expect.any(ApplicationMLPredictionError));
  });
});

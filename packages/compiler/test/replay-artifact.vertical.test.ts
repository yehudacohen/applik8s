import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(new URL('../../..', import.meta.url).pathname);

describe('replay artifact inspector', () => {
  it('executes full-payload artifacts against a local generated JavaScript bundle without effects', () => {
    const directory = mkdtempSync(join(tmpdir(), 'applik8s-replay-'));
    const bundleDir = join(directory, 'bundle');
    const bundlePath = join(bundleDir, 'handler.mjs');
    const artifactPath = join(directory, 'replay.json');
    mkdirSync(bundleDir);

    const bundleSource = `export async function handle(inputJson) {
  const input = JSON.parse(inputJson);
  return JSON.stringify({ operations: [{ kind: 'status', status: { replayed: input.handlerId } }] });
}
`;
    const bundleDigest = `sha256:${createHash('sha256').update(bundleSource).digest('hex')}`;
    writeFileSync(bundlePath, bundleSource);
    writeFileSync(
      artifactPath,
      `${JSON.stringify({
        apiVersion: 'applik8s.dev/v1alpha1',
        kind: 'ReplayArtifact',
        metadata: {
          replayId: 'replay-test',
          createdAt: '2026-06-21T00:00:00Z',
          redaction: { policy: 'full-payload', defaultRedacted: false },
        },
        runtime: {
          operatorName: 'image-pipeline',
          reconcileId: 'ImageJob-hero-image',
          bundleDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          runtimeVersion: '0.1.0',
          handlerAbi: 'applik8s.handler/v1alpha1',
        },
        handler: { handlerId: 'ImageJob.reconcile.0', event: 'reconcile' },
        objectRef: { apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob', name: 'hero-image', namespace: 'media' },
        failure: { phase: 'operationApplication', reason: 'StatusPatchFailed', message: 'failed' },
        input: {
          abiVersion: 'applik8s.handler/v1alpha1',
          handlerId: 'ImageJob.reconcile.0',
          event: 'reconcile',
          object: { apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob', metadata: { name: 'hero-image', namespace: 'media' } },
          runtime: { operatorName: 'image-pipeline', reconcileId: 'ImageJob-hero-image', bundleDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', runtimeVersion: '0.1.0', startedAt: '2026-06-21T00:00:00Z' },
        },
        plan: { operations: [{ kind: 'status', status: { replayed: 'ImageJob.reconcile.0' } }] },
        debugArtifacts: {
          sourceMapping: {
            status: 'artifactIdentityOnly',
            artifacts: [{ kind: 'javascript-bundle', path: 'handler.mjs', digest: bundleDigest }],
          },
        },
      }, null, 2)}\n`,
    );

    const output = execFileSync('node', ['scripts/replay-artifact.mjs', artifactPath, '--bundle-dir', bundleDir, '--execute', '--json'], { cwd: repoRoot, encoding: 'utf8' });
    const summary = JSON.parse(output);

    expect(summary.execution.ok).toBe(true);
    expect(summary.execution.operationCount).toBe(1);
    expect(summary.execution.matchesCapturedPlan).toBe(true);
    expect(summary.execution.sourceMapRuntime.status).toMatch(/enabled|unavailable/);
  });

  it('reports source-mapped TypeScript stack frames for replay execution failures', () => {
    const directory = mkdtempSync(join(tmpdir(), 'applik8s-replay-sourcemap-'));
    const sourceDir = join(directory, 'src');
    const bundleDir = join(directory, 'bundle');
    const sourcePath = join(sourceDir, 'handler.ts');
    const bundlePath = join(bundleDir, 'handler.mjs');
    const sourceMapPath = `${bundlePath}.map`;
    const artifactPath = join(directory, 'replay.json');
    mkdirSync(sourceDir);
    mkdirSync(bundleDir);

    writeFileSync(sourcePath, `function failFromApplicationSource(): never {
  throw new Error('source mapped boom');
}

export async function handle(_inputJson: string): Promise<string> {
  failFromApplicationSource();
}
`);
    buildSync({
      entryPoints: [sourcePath],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      outfile: bundlePath,
      sourcemap: true,
      write: true,
    });
    const bundleSource = readFileSync(bundlePath);
    const sourceMapSource = readFileSync(sourceMapPath);
    const bundleDigest = `sha256:${createHash('sha256').update(bundleSource).digest('hex')}`;
    const sourceMapDigest = `sha256:${createHash('sha256').update(sourceMapSource).digest('hex')}`;
    writeFileSync(
      artifactPath,
      `${JSON.stringify({
        apiVersion: 'applik8s.dev/v1alpha1',
        kind: 'ReplayArtifact',
        metadata: {
          replayId: 'replay-source-map-test',
          createdAt: '2026-06-22T00:00:00Z',
          redaction: { policy: 'full-payload', defaultRedacted: false },
        },
        runtime: {
          operatorName: 'image-pipeline',
          reconcileId: 'ImageJob-hero-image',
          bundleDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          runtimeVersion: '0.1.0',
          handlerAbi: 'applik8s.handler/v1alpha1',
        },
        handler: { handlerId: 'ImageJob.reconcile.0', event: 'reconcile' },
        objectRef: { apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob', name: 'hero-image', namespace: 'media' },
        failure: { phase: 'handlerInvocation', reason: 'HandlerFailed', message: 'failed' },
        input: {
          abiVersion: 'applik8s.handler/v1alpha1',
          handlerId: 'ImageJob.reconcile.0',
          event: 'reconcile',
          object: { apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob', metadata: { name: 'hero-image', namespace: 'media' } },
          runtime: { operatorName: 'image-pipeline', reconcileId: 'ImageJob-hero-image', bundleDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', runtimeVersion: '0.1.0', startedAt: '2026-06-22T00:00:00Z' },
        },
        debugArtifacts: {
          sourceMapping: {
            status: 'artifactIdentityOnly',
            artifacts: [
              { kind: 'javascript-bundle', path: 'handler.mjs', digest: bundleDigest },
              { kind: 'javascript-source-map', path: 'handler.mjs.map', digest: sourceMapDigest },
            ],
          },
        },
      }, null, 2)}\n`,
    );

    const result = spawnSync('node', ['scripts/replay-artifact.mjs', artifactPath, '--bundle-dir', bundleDir, '--execute', '--json'], { cwd: repoRoot, encoding: 'utf8' });
    const summary = JSON.parse(result.stdout);

    expect(result.status).toBe(1);
    expect(summary.execution.ok).toBe(false);
    expect(summary.execution.error).toBe('source mapped boom');
    expect(summary.execution.sourceMapRuntime.status).toMatch(/enabled|unavailable/);
    if (summary.execution.sourceMapRuntime.status === 'enabled') {
      expect(summary.execution.stack.join('\n')).toContain('src/handler.ts');
      expect(summary.execution.stack.join('\n')).toContain('failFromApplicationSource');
    }
  });
});

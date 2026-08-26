import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ApplicationGraph } from '@applik8s/core';
import { compileLocalSupervisorPlan } from '@applik8s/deployment-compiler';
import { describe, expect, it } from 'vitest';
import { type LocalSupervisorSession, startLocalSupervisor } from '../../cli/src/local-supervisor.js';

const execFileAsync = promisify(execFile);
const live = process.env.APPLIK8S_E2E_DOCKER === '1' ? it : it.skip;

describe('v0.8 lightweight local OpenTelemetry collector', () => {
  live('owns a healthy restartable collector with exclusive lease and all OTLP HTTP signals', async () => {
    await execFileAsync('docker', ['info'], { timeout: 10_000 });
    const root = await mkdtemp(join(tmpdir(), 'applik8s-v08-otel-live-'));
    const stateRoot = join(root, 'state');
    const messages: string[] = [];
    const io = {
      cwd: process.cwd(),
      stdout(message: string) { messages.push(message); },
      stderr(message: string) { messages.push(message); },
    };
    const plan = compileLocalSupervisorPlan({
      graph: localCollectorGraph(),
      target: 'local',
      profile: 'test',
      projectDigest: 'sha256:v08-local-otel-live',
      applicationHostFrameworkCredentials: [],
    });
    let session: LocalSupervisorSession | undefined;
    try {
      session = await startLocalSupervisor(plan, io, { stateRoot });
      expect(session.state.planDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(session.state.leaseId).toMatch(/^[a-f0-9-]{36}$/u);
      expect(session.state.resources).toHaveLength(1);
      expect(messages).toContain('Local container ready: provider:provider.observability');
      const endpoint = String(session.state.bindings['endpoint:provider.observability:otlp']);
      const health = String(session.state.bindings['endpoint:provider.observability:health']);
      expect((await fetch(health)).status).toBe(200);
      for (const signal of ['traces', 'metrics', 'logs']) {
        const response = await fetch(`${endpoint}/v1/${signal}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-protobuf' },
          body: new Uint8Array(),
        });
        expect(response.status, `${signal} receiver status`).toBe(200);
      }

      await expect(startLocalSupervisor(plan, io, { stateRoot }))
        .rejects.toThrow(/already active/u);

      const firstRuntime = session.state.resources[0]?.runtimeId;
      await session.stop();
      session = await startLocalSupervisor(plan, io, { stateRoot });
      expect(session.state.resources[0]?.runtimeId).not.toBe(firstRuntime);
      expect((await fetch(String(session.state.bindings['endpoint:provider.observability:health']))).status).toBe(200);
      const restartedRuntime = session.state.resources[0]?.runtimeId;
      await session.reset();
      session = undefined;
      await expect(access(stateRoot)).rejects.toThrow();
      await expect(execFileAsync('docker', ['inspect', String(restartedRuntime)], { timeout: 10_000 })).rejects.toThrow();
    } finally {
      await session?.reset().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});

function localCollectorGraph(): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: 'otel-live' },
    nodes: [{
      id: 'provider.observability',
      kind: 'provider',
      name: 'observability',
      stability: 'stable',
      interface: 'Observability',
      implementation: 'local-otel',
    }],
    edges: [],
    providerRequirements: [],
    providerBindings: [],
    compatibility: {
      stablePublicApis: [],
      documentedInternalContracts: [],
      experimentalSurfaces: [],
      postV3Surfaces: [],
      labels: [],
    },
  };
}

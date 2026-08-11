import type {
  ApplicationExecutionPrincipal,
  ApplicationPrincipal,
  JsonValue,
} from '@applik8s/core';
import { applicationCausalPrincipalContext } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { applicationMetadata } from '../../runtime-hatchet/src/workflow-runtime-hatchet-metadata.js';
import {
  applicationCommandCausalPrincipalId,
  applicationCommandPrincipal,
  applicationRequestContextValues,
} from '../src/command-principal.js';
import { canonicalApplicationTaskServicePrincipal } from '../src/task-operation-runtime.js';
import {
  applicationWorkflowCausalPrincipalMetadata,
  withApplicationWorkflowCausalPrincipal,
} from '../src/workflow-runtime.js';

describe('managed execution causal attribution', () => {
  it('preserves the original human through agent, workflow, task, and command admission', () => {
    const human: ApplicationPrincipal = Object.freeze({
      id: 'principal:human:user-1',
      identity: Object.freeze({
        id: 'identity:human:user-1',
        kind: 'human',
        issuer: 'https://identity.example.test',
        subject: 'user-1',
      }),
      kind: 'human',
      authenticationMethod: 'oidc',
      audience: ['research'],
      trustedContextDigest: 'a'.repeat(64),
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      admittedAt: '2026-08-07T12:00:00.000Z',
    });
    const agent: ApplicationExecutionPrincipal = Object.freeze({
      ...human,
      id: 'execution:agent:run-1',
      identity: Object.freeze({
        id: 'identity:workload:researcher',
        kind: 'workload',
        issuer: 'applik8s://research',
        subject: 'researcher',
      }),
      kind: 'execution',
      executionKind: 'agent',
      executionId: 'agent-run-1',
      attempt: 1,
      workloadIdentity: Object.freeze({
        id: 'identity:workload:researcher',
        kind: 'workload',
        issuer: 'applik8s://research',
        subject: 'researcher',
      }),
      causalPrincipalId: human.id,
      causalPrincipal: human.identity,
      causalGrantIds: ['grant:human-to-agent'],
      deadline: '2026-08-07T12:05:00.000Z',
      cancellationRevision: 'active:1',
      bindings: [],
      effectiveAuthority: [],
    });

    const workflowMetadata = withApplicationWorkflowCausalPrincipal(
      { idempotencyKey: 'workflow-1' },
      agent,
    );
    expect(
      workflowMetadata[applicationWorkflowCausalPrincipalMetadata],
    ).toEqual({
      ...applicationCausalPrincipalContext(human),
      grantIds: ['grant:human-to-agent'],
    });
    const durableMetadata = applicationMetadata(workflowMetadata);
    const restored: ReturnType<typeof applicationCausalPrincipalContext> =
      JSON.parse(
        durableMetadata['applik8s.causal-principal'] ?? 'null',
      );
    const task = canonicalApplicationTaskServicePrincipal(
      {
        id: 'publish-post',
        authorizationVersion: 'task-v1',
      },
      {
        application: 'research',
        workerId: 'workflow-worker',
        catalogRevision: 'catalog-1',
        authorityRevision: 'authority-1',
        invocationId: 'workflow-run-1',
        contextSecret: 'causal-context-secret-at-least-32-bytes',
        causalPrincipal: restored,
        now: () => new Date('2026-08-07T12:01:00.000Z'),
      },
    );
    const context = {
      values: applicationRequestContextValues(
        task,
        task.authorityRevision,
        {},
      ),
    };
    const commandPrincipal = applicationCommandPrincipal(context);

    expect(task).toMatchObject({
      causalPrincipalId: human.id,
      causalPrincipal: human.identity,
      causalGrantIds: ['grant:human-to-agent'],
    });
    expect(applicationCommandCausalPrincipalId(commandPrincipal)).toBe(
      human.id,
    );
    // An unmanaged service principal carrying a forged causal field arrives
    // through the durable JSON boundary, never through the typed surface.
    // Framework admission must ignore the extra key and attribute to itself.
    const forgedEncoded: JsonValue = JSON.parse(
      JSON.stringify({
        ...task,
        id: 'unmanaged-service',
        authenticationMethod: 'service-token',
        causalPrincipalId: 'forged-principal',
      }),
    );
    expect(applicationCommandCausalPrincipalId(applicationCommandPrincipal({
      values: Object.freeze({
        'applik8s.dev/principal': forgedEncoded,
      }),
    }))).toBe('unmanaged-service');
  });
});

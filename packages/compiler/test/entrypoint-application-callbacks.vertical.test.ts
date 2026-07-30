import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { instrumentApplicationCallbackRegistrations } from '../src/pipeline/entrypoint-discovery.js';

describe('application callback discovery instrumentation', () => {
  it('preserves stream.process handler source without capturing the transpiler Symbol', () => {
    const source = `
const reconcileSchedule = async (_changed, context) => {
  await context.schedules.run.reconcile({ state: 'present' });
};

AutomationScheduleChanged.process('automation-schedule', {
  schedules: { run: ExecuteAutomationRun },
}, async (changed, context) => reconcileSchedule(changed, context));
`;

    const instrumented = instrumentApplicationCallbackRegistrations(source, '/workspace/src/streams/automation.ts');

    expect(instrumented).toContain('Symbol.for("applik8s.applicationCallbackSource")');
    expect(instrumented).toContain('registrar: "stream.process"');
    expect(instrumented).toContain('property: "handler"');
    expect(instrumented).toContain('source: "async (changed, context) => reconcileSchedule(changed, context)"');
  });

  it('preserves app.agent handler provenance so module imports can be bundled', () => {
    const source = `
import { chat } from '@tanstack/ai';

export const Researcher = application.agent(
  'researcher',
  {
    identity: ResearcherIdentity,
    model: FastModel,
    instructions: 'Research carefully.',
    tools: [ResearchNote.create],
  },
  async (request, context) => chat({
    adapter: context.tanstack.adapter,
    messages: request.messages,
    threadId: request.threadId,
    runId: context.runId,
    tools: context.tanstack.tools,
    context: context.tanstack.execution,
  }),
);
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/features/research/model.ts',
    );

    expect(instrumented).toContain('registrar: "agent"');
    expect(instrumented).toContain('property: "handler"');
    expect(instrumented).toContain('source: "async (request, context) => chat({');
  });

  it('records the defining module for an imported IdentityProvider callback', async () => {
    const application = new URL('./fixtures/callback-provenance/app.ts', import.meta.url).pathname;
    const identity = new URL('./fixtures/callback-provenance/identity.ts', import.meta.url).pathname;
    const instrumented = instrumentApplicationCallbackRegistrations(await readFile(application, 'utf8'), application);

    expect(instrumented).toContain(`file: ${JSON.stringify(identity)}`);
    expect(instrumented).toContain('registrar: "IdentityProvider"');
    expect(instrumented).toContain('property: "authenticate"');
  });

  it('preserves imported identity, OAuth, and authorization readiness callback provenance', () => {
    const source = `
import { authenticate, decide, identityReady, oauthReady, authorizationReady } from './identity';

IdentityProvider.from(authenticate, { ready: identityReady });
OAuthAuthorizationServer.from('primary', decide, { ready: oauthReady });
Authorization.from(decide, { ready: authorizationReady });
`;
    const sourceFile = '/workspace/src/app.ts';
    const instrumented = instrumentApplicationCallbackRegistrations(source, sourceFile);

    expect(instrumented).toContain('registrar: "IdentityProvider"');
    expect(instrumented).toContain('property: "ready"');
    expect(instrumented).toContain('registrar: "OAuthAuthorizationServer"');
    expect(instrumented).toContain('registrar: "Authorization"');
    expect(instrumented).toContain('property: "decide"');
    expect(instrumented.match(/property: "ready"/g)).toHaveLength(3);
  });
});

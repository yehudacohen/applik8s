// typecast-file-boundary: focused adapter fixtures exercise the exact public
// TanStack boundary without manufacturing an application lifecycle.
import { EventType, type AnyTextAdapter } from '@tanstack/ai';
import { describe, expect, it } from 'vitest';
import {
  applicationTanStackProviderRequestHashV1,
  createApplicationTanStackPhysicalCallMiddleware,
  type ApplicationTanStackPhysicalCallObservation,
} from '../src/physical-call.js';

function fixtureAdapter(): AnyTextAdapter {
  const adapter = {
    kind: 'text',
    name: 'fixture-provider',
    provider: 'fixture',
    model: 'fixture-model',
    '~types': undefined as never,
    async *chatStream() {
      yield {
        type: EventType.RUN_FINISHED,
        runId: 'run-1',
        threadId: 'thread-1',
        model: 'fixture-model',
        timestamp: 1,
        finishReason: 'stop',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cost: 0,
        },
      };
    },
    async structuredOutput() {
      return {
        data: { accepted: true },
        rawText: '{"accepted":true}',
        usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
      };
    },
  };
  return adapter as never;
}

describe('native TanStack physical provider-call observations', () => {
  it('records every actual adapter call with stable order, bounded output, and explicit-zero usage', async () => {
    const recorded: ApplicationTanStackPhysicalCallObservation[] = [];
    const physical = createApplicationTanStackPhysicalCallMiddleware(fixtureAdapter(), {
      operationId: 'specialist@v1',
      invocationId: 'invocation-1',
      runId: 'run-1',
      sink: { async record(observation) { recorded.push(observation); } },
    });
    const request = {
      messages: [{ role: 'user', content: 'hello' }],
      modelOptions: { apiKey: 'must-not-enter-the-hash', temperature: 0 },
      runId: 'run-1',
      threadId: 'thread-1',
    };
    for (let call = 0; call < 2; call += 1) {
      for await (const _chunk of physical.adapter.chatStream(request as never)) {
        // Consume the complete native stream so its terminal fact is observed.
      }
    }

    expect(recorded.map(({ state }) => state)).toEqual([
      'issued', 'completed', 'issued', 'completed',
    ]);
    const completed = recorded.filter((observation) => observation.state === 'completed');
    expect(completed.map(({ facts }) => facts.ordinal)).toEqual([0, 1]);
    expect(completed[0]?.facts.providerCallId).not.toBe(completed[1]?.facts.providerCallId);
    expect(completed[0]).toMatchObject({
      state: 'completed',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costMicrounits: 0,
        currency: 'USD',
      },
      output: { kind: 'stream' },
    });
    await expect(physical.middleware.onFinish?.({} as never, {} as never))
      .resolves.toBeUndefined();
  });

  it('retains structured finalization independently of the agent loop', async () => {
    const recorded: ApplicationTanStackPhysicalCallObservation[] = [];
    const physical = createApplicationTanStackPhysicalCallMiddleware(fixtureAdapter(), {
      operationId: 'specialist@v1',
      invocationId: 'invocation-1',
      runId: 'run-1',
      sink: { async record(observation) { recorded.push(observation); } },
    });
    await expect(physical.adapter.structuredOutput({ messages: [] } as never))
      .resolves.toMatchObject({ data: { accepted: true } });
    expect(recorded.at(-1)).toMatchObject({
      state: 'completed',
      facts: { phase: 'structured-output-finalization', ordinal: 0 },
      output: { kind: 'structured-output' },
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    });
  });

  it('removes credentials from the provider request digest', async () => {
    const base = {
      messages: [{ role: 'user', content: 'hello' }],
      modelOptions: { temperature: 0 },
    };
    await expect(applicationTanStackProviderRequestHashV1('agent-loop', {
      ...base,
      modelOptions: { ...base.modelOptions, apiKey: 'first' },
    })).resolves.toBe(await applicationTanStackProviderRequestHashV1('agent-loop', {
      ...base,
      modelOptions: { ...base.modelOptions, apiKey: 'second' },
    }));
  });
});

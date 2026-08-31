// typecast-file-boundary: agent client tests use focused fetch and global-runtime doubles to verify typed transport hydration and cleanup.
import { describe, expect, it } from 'vitest';
import {
  createApplicationAgentClient,
  installApplicationAgentInvocationRuntimeResolver,
  invokeApplicationAgent,
} from '../src/agents.js';

describe('function-native application agent client', () => {
  it('hydrates an authored callable through the active execution runtime', async () => {
    const dispose = installApplicationAgentInvocationRuntimeResolver(() => ({
      async invoke<TInput extends object, TResult>(request: {
        readonly agent: string;
        readonly input: TInput;
        readonly key: string;
      }): Promise<TResult> {
        return { request, status: 'completed' } as unknown as TResult;
      },
    }));
    try {
      await expect(invokeApplicationAgent({
        agent: 'market-research.v1',
        input: { threadId: 'thread-1' },
        key: 'thread-1',
      })).resolves.toMatchObject({
        request: { agent: 'market-research.v1', key: 'thread-1' },
        status: 'completed',
      });
    } finally {
      dispose();
    }
  });

  it('invokes the authenticated agent gateway with stable actor and retry identity', async () => {
    let observed: Request | undefined;
    const Researcher = createApplicationAgentClient<
      { readonly threadId: string; readonly question: string },
      { readonly status: 'completed'; readonly value: { readonly body: string } }
    >({ name: 'market-research.v1', key: 'threadId' }, {
      baseUrl: 'https://app.example.test',
      fetch: (async (input, init) => {
        observed = new Request(input, init);
        return Response.json({
          result: { status: 'completed', value: { body: 'Grounded' } },
        });
      }) as typeof fetch,
    });

    await expect(Researcher(
      { threadId: 'research/one', question: 'What is supported?' },
      { idempotencyKey: 'research-run-1' },
    )).resolves.toEqual({ status: 'completed', value: { body: 'Grounded' } });
    expect(observed).toBeDefined();
    expect(new URL(observed!.url).pathname).toBe('/__applik8s/v1/ai/chat');
    expect(await observed!.json()).toEqual({
      threadId: 'research/one',
      runId: 'research-run-1',
      input: { threadId: 'research/one', question: 'What is supported?' },
      messages: [],
      forwardedProps: { applik8s: { agent: 'market-research.v1' } },
    });
  });

  it('fails before transport when the declared actor key is absent', async () => {
    const Researcher = createApplicationAgentClient<{ readonly question: string }, object>(
      { name: 'market-research.v1', key: 'threadId' },
      { baseUrl: 'https://app.example.test' },
    );
    await expect(Researcher({ question: 'missing identity' })).rejects.toThrow(
      /threadId must be a non-empty string/u,
    );
  });
});

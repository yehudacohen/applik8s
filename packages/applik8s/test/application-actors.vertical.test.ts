// typecast-file-boundary: Test fixtures intentionally exercise generic actor protocol and persisted-state boundaries.
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  actor,
  actorState,
  app,
  applicationGraphFor,
  createDeterministicApplicationActorRuntime,
  event,
  executeApplicationActorRealtime,
  installApplicationActorRuntimeResolver,
  type,
} from '@applik8s/applik8s';
import { createPersistentLocalApplicationActorRuntime } from '@applik8s/applik8s/actor-runtime-local';
import { type ApplicationAuthorizationReceipt, validateApplicationGraphStructure } from '@applik8s/core';
import { afterEach, describe, expect, it } from 'vitest';
import { applicationOperationInputDigest } from '../src/application-operation-runtime.js';

const disposers: Array<() => void> = [];
afterEach(() => { while (disposers.length > 0) disposers.pop()?.(); });

describe('v0.8 durable identity-addressed actors', () => {
  it('projects actor members into the ordinary authorizable operation surface', () => {
    const application = app('actor-authority-fixture');
    const Workspace = application.actor('workspace-authority.v1', {
      key: type('string'),
      state: type({ title: 'string' }),
      protocol: {
        rename: actor.command({ input: type({ title: 'string' }), output: type({ title: 'string' }) }),
        observe: actor.message(type({ at: 'string' })),
        connect: actor.connection(type({ client: 'string' })),
        expire: actor.alarm(type({ expectedTitle: 'string' })),
      },
    });
    application.role('workspace-editor').can(
      Workspace.rename.all(),
      Workspace.observe.send.all(),
      Workspace.connect.all(),
      Workspace.alarms.expire.schedule.all(),
    );
    const node = applicationGraphFor(application)?.nodes.find((candidate) => candidate.kind === 'actor');
    expect(node).toMatchObject({
      definition: {
        protocol: [
          expect.objectContaining({ name: 'rename', authority: expect.objectContaining({ classification: 'assigned' }) }),
          expect.objectContaining({ name: 'observe', authority: expect.objectContaining({ classification: 'assigned' }) }),
          expect.objectContaining({ name: 'connect', authority: expect.objectContaining({ classification: 'assigned' }) }),
          expect.objectContaining({ name: 'expire', authority: expect.objectContaining({ classification: 'assigned' }) }),
        ],
      },
    });
  });

  it('executes typed realtime callbacks with framework identity and keeps connection messages ephemeral', async () => {
    const Workspace = app('actor-realtime-fixture').actor('realtime-workspace.v1', {
      key: type('string'),
      state: type({ connections: 'number.integer >= 0' }),
      protocol: {
        connect: actor.connection(type({ agent: 'string' })),
        cursor: actor.connectionMessage(type({ position: 'number.integer >= 0', mutate: 'boolean' })),
        disconnect: actor.disconnection(type({ reason: 'string' })),
        cursorPublished: actor.broadcast(type({ principalId: 'string', position: 'number.integer >= 0' })),
      },
    });
    const runtime = createDeterministicApplicationActorRuntime();
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));
    Workspace.on.initialize(() => ({ connections: 0 }));
    const observed: string[] = [];
    Workspace.on.connect(async (turn, connection, input) => {
      observed.push(`${turn.principal.id}:${turn.causalPrincipal.id}:${turn.authorizationReceipt.id}:${connection.principal.id}:${connection.causalPrincipal.id}:${input.agent}`);
      const state = await turn.state();
      await turn.setState({ connections: state.connections + 1 });
    });
    Workspace.on.cursor(async (turn, connection, input) => {
      if (input.mutate) await turn.setState({ connections: 99 });
      await turn.broadcast.cursorPublished({ principalId: connection.principal.id, position: input.position });
    });
    const connection = (member: string, input: object) => ({
      id: 'connection-1',
      principal: { id: 'user-1' },
      causalPrincipal: { id: 'user-1' },
      authorizationReceipt: actorReceipt('actor-realtime-fixture', 'realtime-workspace.v1', member, 'workspace-1', input),
      trustedContextDigest: 'trusted-context-1',
      connectedAt: '2026-08-20T00:00:00.000Z',
      leaseExpiresAt: '2026-08-20T00:01:00.000Z',
    } as const);
    await expect(executeApplicationActorRealtime(Workspace as never, {
      kind: 'connection', member: 'connect', key: 'workspace-1', input: { agent: 'browser' }, connection: connection('connect', { agent: 'browser' }), idempotencyKey: 'connect-1',
    })).resolves.toMatchObject({ member: 'connect', revision: 1 });
    expect(observed).toEqual([
      'principal:local-actor-runtime:execution:actor:connect-1:1:user-1:internal:actor:connect-1:user-1:user-1:browser',
    ]);
    await expect(executeApplicationActorRealtime(Workspace as never, {
      kind: 'connectionMessage', member: 'cursor', key: 'workspace-1', input: { position: 7, mutate: false }, connection: connection('connect', { agent: 'browser' }), idempotencyKey: 'cursor-wrong-authority',
    })).rejects.toThrow(/mismatched or expired realtime authority/u);
    await expect(executeApplicationActorRealtime(Workspace as never, {
      kind: 'connectionMessage', member: 'cursor', key: 'workspace-1', input: { position: 7, mutate: false }, connection: connection('cursor', { position: 7, mutate: false }), idempotencyKey: 'cursor-1',
    })).resolves.toMatchObject({ member: 'cursor', revision: 1, replayed: false });
    expect(runtime.inspect('realtime-workspace.v1', 'workspace-1')).toEqual({ revision: 1, state: { connections: 1 } });
    expect(runtime.broadcasts('realtime-workspace.v1', 'workspace-1')).toEqual([
      expect.objectContaining({ member: 'cursorPublished', value: { principalId: 'user-1', position: 7 }, receipt: expect.objectContaining({ revision: 1 }) }),
    ]);
    await expect(executeApplicationActorRealtime(Workspace as never, {
      kind: 'connectionMessage', member: 'cursor', key: 'workspace-1', input: { position: 8, mutate: true }, connection: connection('cursor', { position: 8, mutate: true }), idempotencyKey: 'cursor-2',
    })).rejects.toThrow(/cannot mutate durable state/u);
    await expect(executeApplicationActorRealtime(Workspace as never, {
      kind: 'disconnection', member: 'disconnect', key: 'workspace-1', input: { reason: 'closed' }, connection: connection('disconnect', { reason: 'closed' }), idempotencyKey: 'disconnect-1',
    })).resolves.toMatchObject({ member: 'disconnect', revision: 2 });
  });

  it('derives typed calls and callbacks from one protocol and serializes full turns across await', async () => {
    const application = app('actor-fixture');
    const Workspace = application.actor('workspace.v1', {
      key: type('string'),
      state: type({ revision: 'number.integer >= 0', title: 'string' }),
      protocol: {
        rename: actor.command({ input: type({ title: 'string' }), output: type({ revision: 'number.integer >= 0' }) }),
        activityObserved: actor.message(type({ occurredAt: 'string' })),
        renamed: actor.broadcast(type({ title: 'string', revision: 'number.integer >= 0' })),
        expire: actor.alarm(type({ expectedRevision: 'number.integer >= 0' })),
      },
    });
    const runtime = createDeterministicApplicationActorRuntime();
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));
    Workspace.on.initialize(async () => ({ revision: 0, title: 'Untitled' }));
    const observed: number[] = [];
    Workspace.on.rename(async (workspace, input) => {
      const state = await workspace.state();
      await Promise.resolve();
      observed.push(state.revision);
      const revision = state.revision + 1;
      await workspace.setState({ revision, title: input.title });
      await workspace.broadcast.renamed({ title: input.title, revision });
      return { revision };
    });
    Workspace.on.activityObserved(async () => {});
    Workspace.on.expire(async (workspace, input) => {
      const state = await workspace.state();
      if (state.revision === input.expectedRevision) await workspace.setState({ revision: state.revision + 1, title: 'Expired' });
    });

    const graph = applicationGraphFor(application.composition);
    if (!graph) throw new Error('Expected actor application graph.');
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'actor.workspace.v1',
        kind: 'actor',
        runtime: { interface: 'ActorRuntime', nodeId: 'provider.actor-runtime' },
        handlers: expect.arrayContaining([
          expect.objectContaining({ member: 'rename' }),
          expect.objectContaining({ member: 'activityObserved' }),
        ]),
        initialize: expect.objectContaining({ source: expect.any(String) }),
      }),
    ]));
    expect(validateApplicationGraphStructure(graph)).toEqual([]);

    const [first, second] = await Promise.all([
      Workspace.rename('workspace-1', { title: 'First' }, { idempotencyKey: 'rename-1' }),
      Workspace.rename('workspace-1', { title: 'Second' }, { idempotencyKey: 'rename-2' }),
    ]);
    expect([first.revision, second.revision]).toEqual([1, 2]);
    expect(observed).toEqual([0, 1]);
    expect(runtime.inspect('workspace.v1', 'workspace-1')).toEqual({ revision: 2, state: { revision: 2, title: 'Second' } });
    expect(runtime.broadcasts('workspace.v1', 'workspace-1')).toHaveLength(2);
    await expect(Workspace.rename('workspace-1', { title: 'Second' }, { idempotencyKey: 'rename-2' })).resolves.toEqual({ revision: 2 });
    await Workspace.alarms.expire.schedule('workspace-1', '2026-08-20T00:00:00.000Z', { expectedRevision: 2 });
    await expect(runtime.tick(new Date('2026-08-20T00:00:00.000Z'))).resolves.toEqual([
      expect.objectContaining({ actor: 'workspace.v1', member: 'expire', revision: 3 }),
    ]);
    expect(runtime.inspect('workspace.v1', 'workspace-1')?.state).toEqual({ revision: 3, title: 'Expired' });
  });

  it('keeps references inert and messages receipt-backed', async () => {
    const application = app('actor-reference-fixture');
    const Counter = application.actor('counter.v1', {
      key: type('string'),
      state: type({ count: 'number.integer >= 0' }),
      protocol: { increment: actor.message(type({ by: 'number.integer > 0' })) },
    });
    const runtime = createDeterministicApplicationActorRuntime();
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));
    Counter.on.initialize(() => ({ count: 0 }));
    Counter.on.increment(async (counter, input) => {
      const state = await counter.state();
      await counter.setState({ count: state.count + input.by });
    });
    const reference = Counter.reference('one');
    expect(reference).toEqual({ apiVersion: 'applik8s.actorReference/v1alpha1', actor: 'counter.v1', key: 'one' });
    const hydrated = Counter.hydrate(reference);
    const receipt = await hydrated.increment.send({ by: 2 }, { idempotencyKey: 'increment-1' });
    expect(receipt).toMatchObject({ state: 'committed', member: 'increment', revision: 1, replayed: false });
    await expect(hydrated.increment.send({ by: 2 }, { idempotencyKey: 'increment-1' })).resolves.toMatchObject({ replayed: true, revision: 1 });
    expect(runtime.inspect('counter.v1', 'one')?.state).toEqual({ count: 2 });
  });

  it('atomically recovers local state, receipts, broadcasts, and alarms after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'applik8s-actor-state-'));
    const path = join(directory, 'actors.json');
    const application = app('persistent-actor-fixture');
    const Counter = application.actor('persistent-counter.v1', {
      key: type('string'),
      state: type({ count: 'number.integer >= 0' }),
      protocol: {
        increment: actor.command({ input: type({ by: 'number.integer > 0' }), output: type({ count: 'number.integer >= 0' }) }),
        changed: actor.broadcast(type({ count: 'number.integer >= 0' })),
        wake: actor.alarm(type({ by: 'number.integer > 0' })),
      },
    });
    Counter.on.initialize(() => ({ count: 0 }));
    const add = async (counter: Parameters<Parameters<typeof Counter.on.increment>[0]>[0], by: number) => {
      const state = await counter.state();
      const count = state.count + by;
      await counter.setState({ count });
      await counter.broadcast.changed({ count });
      return { count };
    };
    Counter.on.increment((counter, input) => add(counter, input.by));
    Counter.on.wake(async (counter, input) => {
      await add(counter, input.by);
    });

    let runtime = await createPersistentLocalApplicationActorRuntime({ path });
    const dispose = installApplicationActorRuntimeResolver(() => runtime);
    disposers.push(dispose);
    await expect(Counter.increment('one', { by: 2 }, { idempotencyKey: 'increment-one' })).resolves.toEqual({ count: 2 });
    await Counter.alarms.wake.schedule('one', '2026-08-21T00:00:00.000Z', { by: 3 });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, 'utf8')).not.toContain('function');

    runtime = await createPersistentLocalApplicationActorRuntime({ path });
    await expect(Counter.increment('one', { by: 2 }, { idempotencyKey: 'increment-one' })).resolves.toEqual({ count: 2 });
    await expect(runtime.tick(new Date('2026-08-21T00:00:00.000Z'))).resolves.toEqual([expect.objectContaining({ member: 'wake', revision: 2 })]);
    expect(runtime.inspect('persistent-counter.v1', 'one')?.state).toEqual({ count: 5 });
    expect(runtime.broadcasts('persistent-counter.v1', 'one')).toHaveLength(2);
  });

  it('recovers and executes a retained Release-A alarm authority after runtime restart', async () => {
    const application = app('retained-alarm-authority-fixture');
    const Counter = application.actor('retained-alarm.v1', {
      key: type('string'),
      state: type({ count: 'number.integer >= 0' }),
      protocol: {
        read: actor.command({
          input: type({}),
          output: type({ count: 'number.integer >= 0' }),
        }),
        wake: actor.alarm(type({ by: 'number.integer > 0' })),
      },
    });
    Counter.on.initialize(() => ({ count: 0 }));
    Counter.on.read(async turn => turn.state());
    Counter.on.wake(async (turn, input) => {
      const state = await turn.state();
      await turn.setState({ count: state.count + input.by });
    });
    let runtime = createDeterministicApplicationActorRuntime();
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));
    await Counter.alarms.wake.schedule(
      'one',
      '2026-09-03T00:00:00.000Z',
      { by: 3 },
      { idempotencyKey: 'retained-wake' },
    );
    const retained = runtime.snapshot();
    const receipt = actorReceipt(
      'retained-alarm-authority-fixture',
      'retained-alarm.v1',
      'wake',
      'one',
      { by: 3 },
    );
    runtime = createDeterministicApplicationActorRuntime({
      snapshot: {
        ...retained,
        alarms: retained.alarms.map(alarm => ({
          ...alarm,
          authority: {
            principal: { id: receipt.principal.id },
            causalPrincipal: { id: receipt.principal.id },
            authorizationReceipt: receipt,
            trustedContextDigest: receipt.trustedContextDigest,
          },
        })),
      },
    });

    await Counter.read('one', {}, { idempotencyKey: 'register-definition' });
    await expect(runtime.tick(new Date('2026-09-03T00:00:00.000Z')))
      .resolves.toEqual([expect.objectContaining({ member: 'wake', revision: 2 })]);
    expect(runtime.inspect('retained-alarm.v1', 'one')?.state).toEqual({ count: 3 });
    expect(runtime.snapshot().alarms).toEqual([]);
  });

  it('commits ordinary events with actor state and replays the durable outbox after delivery interruption', async () => {
    const Changed = event('counter.changed.v1', {
      payload: type({ counterId: 'string', count: 'number.integer >= 0' }),
    });
    const Counter = app('actor-outbox-fixture').actor('outbox-counter.v1', {
      key: type('string'),
      state: type({ count: 'number.integer >= 0' }),
      protocol: {
        increment: actor.command({
          input: type({ by: 'number.integer > 0' }),
          output: type({ count: 'number.integer >= 0' }),
        }),
      },
    });
    Counter.on.initialize(() => ({ count: 0 }));
    Counter.on.increment(async (turn, input) => {
      const state = await turn.state();
      const count = state.count + input.by;
      await turn.setState({ count });
      Changed.emit({ counterId: turn.key, count });
      return { count };
    });

    const interrupted: string[] = [];
    let runtime = createDeterministicApplicationActorRuntime({
      deliverEvent(effect) {
        interrupted.push(effect.effectId);
        throw new Error('broker unavailable after commit');
      },
    });
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));
    await expect(Counter.increment('one', { by: 2 }, { idempotencyKey: 'increment-one' })).resolves.toEqual({ count: 2 });
    expect(runtime.inspect('outbox-counter.v1', 'one')).toMatchObject({ revision: 1, state: { count: 2 } });
    expect(runtime.snapshot().effects).toEqual([
      expect.objectContaining({
        effectId: interrupted[0],
        operationId: 'increment-one',
        contract: expect.objectContaining({ id: 'counter.changed.v1' }),
        payload: { counterId: 'one', count: 2 },
      }),
    ]);

    const delivered: string[] = [];
    runtime = createDeterministicApplicationActorRuntime({
      snapshot: runtime.snapshot(),
      deliverEvent(effect) { delivered.push(effect.effectId); },
    });
    await runtime.drainEffects();
    await runtime.drainEffects();
    expect(delivered).toEqual([interrupted[0]]);
    expect(runtime.snapshot().effects).toEqual([]);
    await expect(Counter.increment('one', { by: 2 }, { idempotencyKey: 'increment-one' })).resolves.toEqual({ count: 2 });
    expect(delivered).toEqual([interrupted[0]]);
  });

  it('scopes idempotency, rejects changed payloads and actor cycles, and commits bound alarms with the turn', async () => {
    const application = app('actor-adversarial-fixture');
    const Peer = application.actor('peer.v1', {
      key: type('string'),
      state: type({ value: 'number.integer >= 0' }),
      protocol: {
        enter: actor.command({ input: type({ cycle: 'boolean' }), output: type({ value: 'number.integer >= 0' }) }),
        wake: actor.alarm(type({ by: 'number.integer > 0' })),
      },
    });
    const Other = application.actor('other.v1', {
      key: type('string'),
      state: type({ value: 'number.integer >= 0' }),
      protocol: { enter: actor.command({ input: type({ cycle: 'boolean' }), output: type({ value: 'number.integer >= 0' }) }) },
    });
    const runtime = createDeterministicApplicationActorRuntime();
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));
    Peer.on.initialize(() => ({ value: 0 }));
    Other.on.initialize(() => ({ value: 0 }));
    const peerEnter = async (turn: Parameters<Parameters<typeof Peer.on.enter>[0]>[0], input: { readonly cycle: boolean }) => {
      if (input.cycle) return Other.enter('one', { cycle: true }, { idempotencyKey: `${turn.operationId}:other` });
      const state = await turn.state();
      await turn.alarms.wake.schedule('2026-08-22T00:00:00.000Z', { by: 1 });
      await turn.setState({ value: state.value + 1 });
      return { value: state.value + 1 };
    };
    Object.defineProperty(peerEnter, Symbol.for('applik8s.applicationCallbackDependencies'), {
      value: [{ identifier: 'OtherEnter', value: Other.enter, awaited: true, returned: true }],
    });
    Peer.on.enter(peerEnter);
    const otherEnter = async (_turn: Parameters<Parameters<typeof Other.on.enter>[0]>[0], input: { readonly cycle: boolean }) => input.cycle
      ? Peer.enter('one', { cycle: false }, { idempotencyKey: 'cycle-back' })
      : { value: 0 };
    Object.defineProperty(otherEnter, Symbol.for('applik8s.applicationCallbackDependencies'), {
      value: [{ identifier: 'PeerEnter', value: Peer.enter, awaited: true, returned: true }],
    });
    Other.on.enter(otherEnter);
    Peer.on.wake(async (turn, input) => {
      const state = await turn.state();
      await turn.setState({ value: state.value + input.by });
    });

    expect(applicationGraphFor(application)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'actor.peer.v1',
        actorBindings: expect.arrayContaining([
          expect.objectContaining({
            handler: 'enter',
            actor: { nodeId: 'actor.other.v1' },
            member: 'enter',
            memberKind: 'command',
          }),
        ]),
      }),
      expect.objectContaining({
        id: 'actor.other.v1',
        actorBindings: expect.arrayContaining([
          expect.objectContaining({
            handler: 'enter',
            actor: { nodeId: 'actor.peer.v1' },
            member: 'enter',
            memberKind: 'command',
          }),
        ]),
      }),
    ]));

    await expect(Peer.enter('one', { cycle: false }, { idempotencyKey: 'shared' })).resolves.toEqual({ value: 1 });
    await expect(Peer.enter('one', { cycle: true }, { idempotencyKey: 'shared' })).rejects.toMatchObject({ code: 'ACTOR_IDEMPOTENCY_CONFLICT' });
    await expect(Peer.enter('two', { cycle: false }, { idempotencyKey: 'shared' })).resolves.toEqual({ value: 1 });
    await expect(Other.enter('two', { cycle: false }, { idempotencyKey: 'shared' })).resolves.toEqual({ value: 0 });
    await expect(Peer.enter('one', { cycle: true }, { idempotencyKey: 'cycle-root' })).rejects.toMatchObject({ code: 'ACTOR_CALL_CYCLE' });

    expect(runtime.snapshot().alarms).toEqual([
      expect.objectContaining({ actor: 'peer.v1', key: 'one', member: 'wake' }),
      expect.objectContaining({ actor: 'peer.v1', key: 'two', member: 'wake' }),
    ]);
    await runtime.tick(new Date('2026-08-22T00:00:00.000Z'));
    expect(runtime.inspect('peer.v1', 'one')?.state).toEqual({ value: 2 });
    expect(runtime.inspect('peer.v1', 'two')?.state).toEqual({ value: 2 });
  });

  it('derives stable nested-call identities and preserves causal lineage across distinct actor principals', async () => {
    const application = app('actor-nested-authority-fixture');
    const Target = application.actor('nested-target.v1', {
      key: type('string'),
      state: type({ count: 'number.integer >= 0' }),
      protocol: {
        increment: actor.command({
          input: type({ by: 'number.integer > 0' }),
          output: type({ count: 'number.integer >= 0' }),
        }),
      },
    });
    const Source = application.actor('nested-source.v1', {
      key: type('string'),
      state: type({ calls: 'number.integer >= 0' }),
      protocol: {
        run: actor.command({
          input: type({}),
          output: type({ count: 'number.integer >= 0' }),
        }),
      },
    });
    const runtime = createDeterministicApplicationActorRuntime();
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));
    const lineage: Array<{ readonly actor: string; readonly principal: string; readonly causal: string }> = [];
    Target.on.initialize(() => ({ count: 0 }));
    Target.on.increment(async (turn, input) => {
      lineage.push({ actor: 'target', principal: turn.principal.id, causal: turn.causalPrincipal.id });
      const state = await turn.state();
      const next = { count: state.count + input.by };
      await turn.setState(next);
      return next;
    });
    Source.on.initialize(() => ({ calls: 0 }));
    Source.on.run(async (turn) => {
      lineage.push({ actor: 'source', principal: turn.principal.id, causal: turn.causalPrincipal.id });
      const state = await turn.state();
      await turn.setState({ calls: state.calls + 1 });
      return Target.increment('target', { by: 1 });
    });

    await expect(Source.run('source', {}, { idempotencyKey: 'source-run-1' }))
      .resolves.toEqual({ count: 1 });
    await expect(Source.run('source', {}, { idempotencyKey: 'source-run-1' }))
      .resolves.toEqual({ count: 1 });
    expect(lineage).toHaveLength(2);
    expect(lineage[0]?.principal).not.toBe(lineage[1]?.principal);
    expect(lineage[0]?.causal).toBe(lineage[1]?.causal);
    expect(runtime.snapshot().receipts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'nested-target.v1:target:increment',
        operationId: expect.stringMatching(/^actor_call_/u),
      }),
    ]));
  });

  it('migrates persisted state exactly forward, resumes after failure, and rejects rollback', async () => {
    const v1Application = app('actor-migration-v1');
    const CounterV1 = v1Application.actor('migrating-counter.v1', {
      key: type('string'),
      state: type({ count: 'number.integer >= 0' }),
      protocol: { read: actor.command({ input: type({}), output: type({ count: 'number.integer >= 0' }) }) },
    });
    CounterV1.on.initialize(() => ({ count: 4 }));
    CounterV1.on.read(async turn => turn.state());
    let runtime = createDeterministicApplicationActorRuntime();
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));
    await CounterV1.read('one', {}, { idempotencyKey: 'read-v1' });

    let attempts = 0;
    const v2Application = app('actor-migration-v2');
    const CounterV2 = v2Application.actor('migrating-counter.v1', {
      key: type('string'),
      state: actorState({
        version: 2,
        schema: type({ count: 'number.integer >= 0', label: 'string' }),
        migrate: { 1: async previous => {
          attempts += 1;
          if (attempts === 1) throw new Error('migration interrupted');
          return { ...(previous as { count: number }), label: 'migrated' };
        } },
      }),
      protocol: { read: actor.command({ input: type({}), output: type({ count: 'number.integer >= 0', label: 'string' }) }) },
    });
    CounterV2.on.initialize(() => ({ count: 0, label: 'new' }));
    CounterV2.on.read(async turn => turn.state());
    const prior = runtime.snapshot();
    runtime = createDeterministicApplicationActorRuntime({ snapshot: prior });
    await expect(CounterV2.read('one', {}, { idempotencyKey: 'read-v2' })).rejects.toThrow('migration interrupted');
    expect(runtime.snapshot().states[0]).toMatchObject({ stateVersion: 1, state: { count: 4 } });
    await expect(CounterV2.read('one', {}, { idempotencyKey: 'read-v2' })).resolves.toEqual({ count: 4, label: 'migrated' });
    expect(runtime.snapshot().states[0]).toMatchObject({ stateVersion: 2, state: { count: 4, label: 'migrated' } });
    expect(CounterV2.graphNode.definition).toMatchObject({ stateVersion: 2, migrationDigest: expect.any(String), migrations: [{ from: 1 }] });

    runtime = createDeterministicApplicationActorRuntime({
      snapshot: {
        ...runtime.snapshot(),
        states: runtime.snapshot().states.map(state => ({ ...state, stateVersion: 3 })),
      },
    });
    await expect(CounterV2.read('one', {}, { idempotencyKey: 'rollback' })).rejects.toThrow(/newer than runtime/u);
  });
});

function actorReceipt(application: string, actorId: string, member: string, key: string, input: object): ApplicationAuthorizationReceipt {
  const operationId = `applik8s://actors/${actorId}/operations/${member}` as const;
  return {
    apiVersion: 'applik8s.authorizationReceipt/v1alpha1',
    id: 'receipt-1',
    application,
    operationId,
    operationVersion: 'v1',
    catalogRevision: 'catalog-1',
    authorityRevision: 'authority-1',
    principal: {
      id: 'user-1',
      identity: { id: 'user-1', kind: 'human', issuer: 'test', subject: 'user-1' },
      kind: 'human',
      authenticationMethod: 'test',
      audience: [application],
      trustedContextDigest: 'trusted-context-1',
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      admittedAt: '2026-08-20T00:00:00.000Z',
    },
    trustedContextDigest: 'trusted-context-1',
    matchedPermissionIds: [],
    matchedGrantIds: [],
    inputDigest: applicationOperationInputDigest(input),
    target: { kind: 'target', model: actorId, identity: { key } },
    scopeEvidence: [],
    audience: application,
    transport: 'control-plane',
    admittedAt: '2026-08-20T00:00:00.000Z',
  };
}

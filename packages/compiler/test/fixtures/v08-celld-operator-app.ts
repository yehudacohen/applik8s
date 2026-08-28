import {
  ActorRuntime,
  actor,
  app,
  ObjectStorage,
  Scheduler,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';

const application = app('celld-operator-artifact-proof', {
  namespace: 'celld-operator-artifact-proof',
});

const state = ObjectStorage.s3({
  name: 'actor-state',
  bucket: 'celld-operator-artifact-proof',
  region: 'us-east-1',
  endpoint: 'https://objects.example.test',
  credentialsSecret: {
    apiVersion: 'v1',
    kind: 'Secret',
    name: 'actor-state',
    namespace: 'celld-operator-artifact-proof',
  },
  ownership: 'external',
});

application.provide(ObjectStorage, state);
application.provide(ActorRuntime, ActorRuntime.celld({
  replicas: 1,
  stateStore: state,
}));
application.provide(Scheduler, Scheduler.cronJob({ maximumDefinitions: 10 }));

export const Counter = application.actor('counter.v1', {
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
  const current = await turn.state();
  const count = current.count + input.by;
  await turn.setState({ count });
  return { count };
});

export const CounterAudit = Scheduler.schedule({
  id: 'counter.audit.v1',
  cron: '0 4 * * *',
  timezone: 'UTC',
}, async context => ({ occurrenceId: context.occurrenceId }));

export const celldOperatorArtifactProof = application.composition;

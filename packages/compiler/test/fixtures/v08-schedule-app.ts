import { actor, app, defineApplicationProvider, Scheduler, schedule, type } from '@applik8s/applik8s';

const platform = app('schedule-proof', {
  namespace: 'schedule-proof',
  spec: type({ profile: "'starter' | 'dedicated'" }),
  status: type({ ready: 'boolean' }),
});
const AcquisitionProvider = defineApplicationProvider<{
  readonly kind: 'acquisition';
  acquire(input: { readonly id: string }): Promise<{ readonly value: string }>;
}>({
  interface: 'AcquisitionProvider',
  version: 'v1alpha1',
  accepts: (candidate): candidate is {
    readonly kind: 'acquisition';
    acquire(input: { readonly id: string }): Promise<{ readonly value: string }>;
  } => candidate !== null
    && typeof candidate === 'object'
    && Reflect.get(candidate, 'kind') === 'acquisition'
    && typeof Reflect.get(candidate, 'acquire') === 'function',
}).named('primary');
platform
  .profile(platform.installation.spec, 'profile')
  .provide(AcquisitionProvider)
  .starter(() => ({
    kind: 'acquisition',
    async acquire({ id }) { return { value: `starter:${id}` }; },
  }))
  .dedicated(() => ({
    kind: 'acquisition',
    async acquire({ id }) { return { value: `dedicated:${id}` }; },
  }))
  .exhaustive();
const acquisition = platform.inject(AcquisitionProvider);
const acquire = acquisition.acquire;

export const Workspace = platform.actor('workspace.v1', {
  key: type('string'),
  state: type({ value: 'string' }),
  protocol: {
    acquire: actor.command({
      input: type({ id: 'string' }),
      output: type({ value: 'string' }),
    }),
  },
});
Workspace.on.initialize(() => ({ value: '' }));
Workspace.on.acquire(async (workspace, input) => {
  const result = await acquire(input);
  await workspace.setState(result);
  return result;
});

export const Cleanup = schedule(
  {
    id: 'evidence.cleanup.v1',
    cron: '0 3 * * *',
    timezone: 'UTC',
  },
  async (context) => ({
    occurrenceId: context.occurrenceId,
    acquisition: await acquire({ id: context.occurrenceId }),
  }),
);

const SourcePolling = Scheduler.named('source-polling');

platform.provide(SourcePolling, Scheduler.hatchet());

export const PollSource = SourcePolling.schedule(
  {
    id: 'source.poll.v1',
    input: type({ sourceBindingId: 'string' }),
    requirements: {
      configuration: 'dynamic',
      cardinality: 'high',
    },
  },
  async ({ sourceBindingId }, context) => ({
    sourceBindingId,
    occurrenceId: context.occurrenceId,
  }),
);

export const scheduleProof = platform.composition;

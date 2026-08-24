import { actor, app, defineApplicationProvider, Scheduler, schedule, type } from '@applik8s/applik8s';

const platform = app('schedule-proof', {
  namespace: 'schedule-proof',
  spec: type({ profile: "'starter' | 'dedicated'" }),
  status: type({ ready: 'boolean' }),
});
const AcquisitionProvider = defineApplicationProvider<{
  readonly kind: 'acquisition';
  readonly source: string;
  readonly credentialSecret: {
    readonly apiVersion: 'v1';
    readonly kind: 'Secret';
    readonly name: string;
    readonly namespace: string;
  };
  acquire(input: { readonly id: string }): Promise<{ readonly value: string }>;
}>({
  interface: 'AcquisitionProvider',
  version: 'v1alpha1',
  runtime: {
    bind(implementation) {
      return {
        env: { ACQUISITION_SOURCE: implementation.source },
        secretEnv: {
          ACQUISITION_TOKEN: {
            secret: implementation.credentialSecret,
            key: 'token',
          },
        },
      };
    },
    operations: {
      acquire: {
        module: '@fixture/acquisition/runtime',
        export: 'acquireItem',
        access: {
          kind: 'provider',
          operations: ['connection.use', 'network.connect'],
        },
      },
    },
  },
  accepts: (candidate): candidate is {
    readonly kind: 'acquisition';
    readonly source: string;
    readonly credentialSecret: {
      readonly apiVersion: 'v1';
      readonly kind: 'Secret';
      readonly name: string;
      readonly namespace: string;
    };
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
    source: 'starter',
    credentialSecret: {
      apiVersion: 'v1',
      kind: 'Secret',
      name: 'acquisition-starter',
      namespace: 'schedule-proof',
    },
    async acquire({ id }) { return { value: `starter:${id}` }; },
  }))
  .dedicated(() => ({
    kind: 'acquisition',
    source: 'dedicated',
    credentialSecret: {
      apiVersion: 'v1',
      kind: 'Secret',
      name: 'acquisition-dedicated',
      namespace: 'schedule-proof',
    },
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

export const DefaultPoll = schedule(
	{
		id: 'source.default-poll.v1',
		input: type({ sourceBindingId: 'string' }),
		overlapBy: ({ sourceBindingId }) => sourceBindingId,
	},
	async ({ sourceBindingId }, context) => ({
		sourceBindingId,
		occurrenceId: context.occurrenceId,
	}),
);

const SourcePolling = Scheduler.named('source-polling');

platform.provide(SourcePolling, Scheduler.hatchet());

export const PollSource = SourcePolling.schedule(
  {
    id: 'source.poll.v1',
    input: type({ sourceBindingId: 'string' }),
		overlapBy: ({ sourceBindingId }) => sourceBindingId,
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

import { app, schedule, Scheduler, type } from '@applik8s/applik8s';

const platform = app('schedule-proof', { namespace: 'schedule-proof' });

export const Cleanup = schedule(
  {
    id: 'evidence.cleanup.v1',
    cron: '0 3 * * *',
    timezone: 'UTC',
  },
  async (context) => ({ occurrenceId: context.occurrenceId }),
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

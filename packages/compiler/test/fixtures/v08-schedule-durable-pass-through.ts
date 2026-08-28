import { app, schedule, type } from '@applik8s/applik8s';

const application = app('schedule-durable-pass-through', {
  namespace: 'schedule-durable-pass-through',
});

export const RefreshWorkspace = application.workflow(
  'workspace.refresh.v1',
  {
    input: type({ workspaceId: 'string' }),
    output: type({ workspaceId: 'string' }),
  },
  async input => input,
);

export const RefreshWorkspaceSchedule = schedule(
  {
    id: 'workspace.refresh-schedule.v1',
    input: type({ workspaceId: 'string' }),
  },
  async input => RefreshWorkspace(input),
);

export const scheduleDurablePassThrough = application.composition;

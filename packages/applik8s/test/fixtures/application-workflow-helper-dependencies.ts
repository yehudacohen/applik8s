import { providers } from './application-provider-profile';
import { application } from './application-workflow-helper-runtime';

const workflow = application.workflow;
const Review = workflow.signal('review.v1', {});
const persist = workflow(
  'persist.v1',
  {},
  async function persistResult(input: { readonly id: string }) {
    return {
      id: input.id,
      observedAt: new Date().toISOString(),
      database: providers.database,
    };
  },
);

async function coordinate(input: { readonly id: string }) {
  const decision = await workflow.emitSignal(Review, { input });
  await decision();
  return persist(input);
}

export async function workflowCallback(input: { readonly id: string }) {
  return coordinate(input);
}

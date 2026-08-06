import { AI } from '@applik8s/ai';
import { chat } from '@tanstack/ai';
import { application } from '../../app';
import { inference } from '../../providers';
import { AccessRequest } from './model';

export const AccessAdvisorIdentity =
  application.serviceIdentity('access-advisor');

export const AccessAdvisorModel = AI.model('fast', {
  inference,
  capabilities: [AI.chat, AI.tools, AI.streaming],
});

export const AccessAdvisor = application.agent(
  'access-advisor',
  {
    identity: AccessAdvisorIdentity,
    model: AccessAdvisorModel,
    instructions:
      'Turn explicit evidence into one bounded production access request. Never broaden the requested target or operation.',
    tools: [AccessRequest.create],
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

AccessAdvisorIdentity.can(AccessRequest.create);

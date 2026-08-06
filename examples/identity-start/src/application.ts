import { application } from './app';
import { AccessAdvisor } from './features/access/agent';
import {
  AccessRequest,
  AccessRequestQueue,
  ReleaseAutomation,
} from './features/access/model';
import {
  AccessReview,
  AccessReviewCoordinator,
  reviewAccessRequest,
} from './features/access/workflow';
import { Conversation, Operations } from './modules';

export const OperationsSnapshot = Operations.Conversation.operationsSnapshot;

export const accessMcp = application.mcp('access', {
  tools: [AccessRequest.create],
  resource: 'https://identity-start.example.test/mcp',
  authorizationServers: ['https://identity-start.example.test/oauth'],
});

/**
 * Browser imports are the reachability declaration. The Vite/compiler
 * boundary infers the admitted Fetch transport and ApplicationHost from these
 * callable handles; the application does not duplicate a gateway registry,
 * authorization callback, or Kubernetes host deployment.
 */
export { Conversation };

export { application };
export {
  AccessAdvisor,
  AccessRequest,
  AccessRequestQueue,
  ReleaseAutomation,
  AccessReview,
  AccessReviewCoordinator,
  Operations,
  reviewAccessRequest,
};

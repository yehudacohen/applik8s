import { approvals } from '@applik8s/approvals';
import { artifacts } from '@applik8s/artifacts';
import { conversations } from '@applik8s/conversations';
import { evaluations } from '@applik8s/evals';
import { operationsControlCenter } from '@applik8s/operations-ui';
import { usage } from '@applik8s/usage';
import { application } from './app';
import { objects } from './providers';

export const Conversations = application.include(conversations);
export const Approvals = application.include(approvals);
export const Artifacts = application.include(artifacts);
export const Evaluations = application.include(evaluations);
export const Usage = application.include(usage);
export const ArtifactObjects = application.objectStore('agentic-artifacts', {
  provider: objects,
  maxObjectBytes: 25_000_000,
  contentTypes: [
    'application/json',
    'application/octet-stream',
    'text/plain',
  ],
  mode: 'immutable',
  browser: {
    upload: 'signed',
    download: { mode: 'signed', access: 'owner' },
    ttlSeconds: 300,
  },
  deletion: 'explicit',
});
export const Operations = application.include(operationsControlCenter);
export const Conversation = Operations.Conversation;

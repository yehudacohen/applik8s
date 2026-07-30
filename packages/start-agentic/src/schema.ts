import { applicationApprovalSchema } from '@applik8s/approvals';
import { applicationArtifactSchema } from '@applik8s/artifacts';
import { applicationConversationSchema } from '@applik8s/conversations';
import { applicationEvaluationSchema } from '@applik8s/evals';
import { applicationUsageSchema } from '@applik8s/usage';

export const applicationAgenticModuleSchema = Object.freeze({
  ...applicationConversationSchema,
  ...applicationApprovalSchema,
  ...applicationArtifactSchema,
  ...applicationEvaluationSchema,
  ...applicationUsageSchema,
});

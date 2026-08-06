import { applicationApprovalSchema } from '@applik8s/approvals';
import { applicationArtifactSchema } from '@applik8s/artifacts';
import { applicationBillingSchema } from '@applik8s/billing';
import { applicationConversationSchema } from '@applik8s/conversations';
import { applicationEvaluationSchema } from '@applik8s/evals';
import { applicationOperationsSchema } from '@applik8s/operations-ui';
import { applicationUsageSchema } from '@applik8s/usage';

export const applicationAgenticModuleSchema = Object.freeze({
  ...applicationConversationSchema,
  ...applicationApprovalSchema,
  ...applicationArtifactSchema,
  ...applicationBillingSchema,
  ...applicationEvaluationSchema,
  ...applicationOperationsSchema,
  ...applicationUsageSchema,
});

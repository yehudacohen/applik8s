import { module } from '@applik8s/applik8s';
import {
  applicationEvaluationCases,
  applicationEvaluationDatasets,
  applicationEvaluationResults,
  applicationEvaluationRuns,
  applicationEvaluationSchema,
  applicationEvaluationScorers,
} from './schema.js';

export * from './schema.js';

function installEvaluations() {
  return {
    Dataset: applicationEvaluationDatasets,
    Case: applicationEvaluationCases,
    Scorer: applicationEvaluationScorers,
    EvaluationRun: applicationEvaluationRuns,
    EvaluationResult: applicationEvaluationResults,
  };
}

export const evaluations = module(
  'evaluations',
  { schema: applicationEvaluationSchema },
  installEvaluations,
);

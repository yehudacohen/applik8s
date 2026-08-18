import { isApplicationRelationalModel } from '@applik8s/applik8s/drizzle';
import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  applicationEvaluationCases,
  applicationEvaluationDatasets,
  applicationEvaluationResults,
  applicationEvaluationRuns,
  applicationEvaluationScorers,
} from '../src/index.js';

describe('maintained evaluation models', () => {
  it('preserves application-model metadata across package boundaries', () => {
    const models = [
      applicationEvaluationDatasets,
      applicationEvaluationCases,
      applicationEvaluationScorers,
      applicationEvaluationRuns,
      applicationEvaluationResults,
    ];
    expect(models.every(isApplicationRelationalModel)).toBe(true);
    expect(getTableName(applicationEvaluationRuns)).toBe(
      'applik8s_evaluation_runs',
    );
    expect(applicationEvaluationRuns.principalScope.notNull).toBe(true);
  });
});

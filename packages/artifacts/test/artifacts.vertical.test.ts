import { isApplicationRelationalModel } from '@applik8s/applik8s/drizzle';
import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  applicationArtifacts,
  applicationArtifactSafeFileName,
} from '../src/index.js';

describe('maintained artifacts model', () => {
  it('preserves application-model metadata across package boundaries', () => {
    expect(getTableName(applicationArtifacts)).toBe('applik8s_artifacts');
    expect(isApplicationRelationalModel(applicationArtifacts)).toBe(true);
  });

  it('provides transfer-safe names without owning Library presentation', () => {
    expect(applicationArtifactSafeFileName('  Q3 Plan (final).PDF  ')).toBe(
      'q3-plan-final-pdf',
    );
    expect(applicationArtifactSafeFileName('🧪')).toBe('artifact');
  });
});

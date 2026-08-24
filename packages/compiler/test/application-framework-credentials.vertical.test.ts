import { describe, expect, it } from 'vitest';
import { applicationFrameworkCredentialDependencies } from '../src/application-framework-credentials.js';

describe('generated application framework credential dependencies', () => {
  it('captures only referenced closed framework credentials in stable order', () => {
    expect(applicationFrameworkCredentialDependencies(`
      const operation = process.env.APPLIK8S_INTERNAL_OPERATION_SECRET;
      const query = requiredEnv('APPLIK8S_AGENT_QUERY_CONTEXT_SECRET');
      const unrelated = process.env.AWS_SECRET_ACCESS_KEY;
    `)).toEqual([
      { kind: 'agent-query-context', environmentName: 'APPLIK8S_AGENT_QUERY_CONTEXT_SECRET' },
      { kind: 'internal-operation', environmentName: 'APPLIK8S_INTERNAL_OPERATION_SECRET' },
    ]);
  });

  it('retains a compiler-declared renamed cursor without opening arbitrary credential kinds', () => {
    expect(applicationFrameworkCredentialDependencies(
      `requiredEnv('APPLIK8S_LAKEHOUSE_CURSOR')`,
      { APPLIK8S_LAKEHOUSE_CURSOR: 'cursor' },
    )).toEqual([
      { kind: 'cursor', environmentName: 'APPLIK8S_LAKEHOUSE_CURSOR' },
    ]);
  });

  it('rejects renamed credentials that could shadow ambient or sibling authorities', () => {
    expect(() => applicationFrameworkCredentialDependencies(
      `requiredEnv('AWS_SECRET_ACCESS_KEY')`,
      { AWS_SECRET_ACCESS_KEY: 'cursor' },
    )).toThrow(/unsafe environment name/u);
    expect(() => applicationFrameworkCredentialDependencies(
      `requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET')`,
      { APPLIK8S_INTERNAL_OPERATION_SECRET: 'cursor' },
    )).toThrow(/unsafe environment name/u);
  });
});

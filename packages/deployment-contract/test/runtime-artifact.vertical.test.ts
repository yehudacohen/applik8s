// typecast-file-boundary: Runtime-artifact tests deliberately reconstruct partial persisted records to prove the public validator rejects invalid state.
import { describe, expect, it } from 'vitest';
import { validateApplicationRuntimeArtifact } from '../src/runtime-artifact.js';

describe('application runtime artifact credentials', () => {
  const base = {
    nodeId: 'agent.assistant',
    name: 'assistant',
    role: 'agent' as const,
    source: '/workspace/agent.mjs',
    digest: `sha256:${'a'.repeat(64)}` as const,
  };

  it('admits exact closed credential dependencies', () => {
    expect(validateApplicationRuntimeArtifact({
      ...base,
      frameworkCredentials: [
        { kind: 'agent-query-context', environmentName: 'APPLIK8S_AGENT_QUERY_CONTEXT_SECRET' },
        { kind: 'internal-operation', environmentName: 'APPLIK8S_INTERNAL_OPERATION_SECRET' },
      ],
    })).toEqual([]);
  });

  it('rejects unknown kinds, invalid names, and duplicate projections', () => {
    expect(validateApplicationRuntimeArtifact({
      ...base,
      frameworkCredentials: [
        { kind: 'ambient-root' as never, environmentName: 'AWS_SECRET_ACCESS_KEY' },
        { kind: 'context', environmentName: 'not-valid!' },
        { kind: 'cursor', environmentName: 'not-valid!' },
      ],
    })).toEqual(expect.arrayContaining([
      expect.stringContaining('unsupported'),
      expect.stringContaining('invalid environment name'),
      expect.stringContaining('repeated'),
    ]));
  });
});
// typecast-file-boundary: Runtime-artifact tests deliberately reconstruct partial persisted records to prove the public validator rejects invalid state.

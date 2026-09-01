# `@applik8s/code-agent`

Provider-neutral preview composition and capability contracts for durable code
agents on Applik8s.

```ts
import {
  AgentHarness,
  CodeWorkspace,
  ProcessRunner,
  SourceRepository,
  codeAgent,
} from '@applik8s/code-agent';

const ProductBuilder = application.include(codeAgent('product-builder.v1', {
  actor: { key: RepositoryId },
  identity: ProductBuilderIdentity,
  harness: AgentHarness.named('coding'),
  workspace: CodeWorkspace.named('primary'),
  source: SourceRepository.named('primary'),
  process: ProcessRunner.named('bounded'),
  validation: [{ executable: 'bun', arguments: ['test'] }],
}));

const result = await ProductBuilder({
  repositoryId: 'storefront',
  instruction: 'Add the approved checkout behavior.',
  idempotencyKey: request.id,
});
```

The actor identity is repository-scoped so turns are serialized. Each request
has a stable run and effect identity, while the workspace lease fences the
single active writer. Source mutations require base digests and validation
commands are receipt-backed and allowlisted.

- Package root: authoring contracts, `codeAgent()`, and deterministic/fenced
  local providers.
- `/runtime`: selected-provider hydration for generated runtimes.
- `/runtime-contract`: the serializable provider implementation boundary.
- `/http`: authenticated bounded transport for separately deployed providers.

OpenCode is not a semantic dependency of this package. The maintained adapter
lives at `@applik8s/dev/agent/opencode-code-harness`; applications can replace
it with any conforming `AgentHarness` provider.

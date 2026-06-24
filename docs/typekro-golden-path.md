# TypeKro Golden Path

The TypeKro adapter is the v0.1 proof for this vision phrase:

> Operators install like components. Their CRDs instantiate like resources. Their statuses compose like TypeKro resources.

The canonical source is still `examples/imagejob.ts`; the TypeKro adapter consumes the same operator definition and compiled manifest that plain YAML uses.

## Executable Proof

Run the adapter vertical tests:

```sh
bunx vitest run packages/typekro-adapter/test/typekro-adapter.vertical.test.ts
```

The suite proves:

- the canonical `ImageJob` operator can become a TypeKro install composition
- CRD factories are exposed with `ImageJob` and `imageJob` aliases
- generated install resources include the operator Deployment
- generated install resources carry bundle, ABI, runtime, RBAC, capability, rollback, uninstall, and supply-chain posture annotations
- `typeKro.operationTarget()` and `typeKro.targetFactory()` produce values that handlers can pass directly to `ctx.apply()`, `ctx.delete()`, proxy `resource.apply()`, and proxy `resource.delete()`
- TypeKro graph deletes preserve reverse dependency ordering
- status projections can be mapped into handler status

## Shape

The public spelling is `typeKro.composition(...)`: compile once, then install the operator like a component and instantiate its CRDs through generated factories.

```ts
import { typeKro } from '@applik8s/applik8s';
import { buildOperatorManifest } from '@applik8s/compiler';
import { imagePipeline } from './imagejob.ts';

const manifest = buildOperatorManifest({
  operator: imagePipeline.definition,
  handlerArtifactPath: 'wasm/handler.wasm',
  handlerArtifactDigest: 'sha256:...',
  runtimeContractPath: 'contract/runtime-contract.json',
  runtimeContractDigest: 'sha256:...',
});

if (!manifest.ok) {
  throw new Error(manifest.error.message);
}

const composition = typeKro.composition(imagePipeline.definition, manifest.value, {
  compositionName: 'image-pipeline',
  defaultNamespace: 'media-system',
});

if (!composition.ok) {
  throw new Error(composition.error.message);
}

const installed = composition.value({ namespace: 'media', replicas: 1 });

const image = installed.imageJob({
  name: 'hero-image',
  spec: {
    sourceUrl: 's3://bucket/hero.png',
    formats: ['webp'],
    priority: 'normal',
  },
});
```

From there, `image.status.phase`, runtime-authored `Ready` conditions, and domain status fields are normal TypeKro-visible status values. The adapter should stay out of the user's mental model: the operator installs, the CRD instantiates, and status composes.

## v0.1 Boundary

TypeKro install synthesis is manifest-aware. The plain SDK callable operator does not expose pre-compile `installResources`, because real install resources require compiled bundle metadata, handler artifact digests, runtime image metadata, RBAC posture, and compatibility annotations.

Use these paths instead:

- plain Kubernetes YAML from `applik8s build`
- TypeKro install composition from `typeKro.composition(operator.definition, manifest, options)`

Lower-level aliases such as `asComposition()`, `toOperationTarget()`, and `asOperationTargetFactory()` remain available for integration authors, but the golden path uses the ergonomic `typeKro.*` names.

Inside WASM handler entrypoints, import operation-target helpers from `@applik8s/typekro-adapter/targets` so the handler bundle stays focused on operation-plan rendering instead of TypeKro install/deployment tooling.

Do not treat the adapter as a separate deployment model. It consumes the same operator manifest and schema gates as plain YAML generation.

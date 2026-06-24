import type {
  CapabilityClient,
  CapabilityClientSet,
  GraphAdapter,
  HandlerContext,
  OperationTarget,
  OperatorManifest,
} from '@applik8s/core';
import type {
  Applik8sSdk,
  AnyCrdInstanceFactory,
  CrdInstanceInput,
  DeployedOperator,
  SchemaInput,
} from '@applik8s/sdk';
import type { Applik8sTestingApi } from '@applik8s/testing';
import type { Applik8sTypeKroAdapterApi, TypeKroGraph } from '@applik8s/typekro-adapter';
import type { Applik8sTypeKroAdapterApi as TopLevelTypeKroAdapterApi } from '@applik8s/applik8s';
import { operationTarget as handlerOperationTargetFactory, targetFactory as handlerTargetFactory } from '@applik8s/typekro-adapter/targets';

interface ImageSpec {
  sourceUrl: string;
  formats: string[];
  priority: 'low' | 'normal' | 'high';
}

interface ImageStatus {
  phase: 'Pending' | 'Processing' | 'Complete' | 'Failed';
  outputUrls: string[];
  message?: string;
}

interface AppGraphSpec {
  namespace: string;
  sourceUrl: string;
}

interface AppGraph {
  readonly graphName: 'media-app';
}

interface TenantGraphSpec {
  namespace: string;
  plan?: 'free' | 'pro';
}

interface TenantGraphStatus {
  ready: boolean;
  endpoint: string;
}

interface ChargeRequest {
  amountCents: number;
  currency: 'USD';
}

interface ChargeResponse {
  chargeId: string;
}

declare const sdk: Applik8sSdk;
declare const testing: Applik8sTestingApi;
declare const typeKro: Applik8sTypeKroAdapterApi;
declare const topLevelTypeKro: TopLevelTypeKroAdapterApi;
declare const imageSpecSchema: SchemaInput<ImageSpec>;
declare const imageStatusSchema: SchemaInput<ImageStatus>;
declare const appGraph: AppGraph;
declare const appGraphAdapter: GraphAdapter<AppGraph, ImageStatus, AppGraphSpec>;
declare const handlerOperationTarget: OperationTarget<ImageStatus>;
declare const imageManifest: OperatorManifest;
declare const tenantGraph: TypeKroGraph<TenantGraphSpec, TenantGraphStatus>;
declare const billing: CapabilityClient<ChargeResponse>;
declare const expectTypeUsage: (...values: readonly unknown[]) => void;

const ImageJob = sdk.crd({
  apiVersion: 'media.applik8s.dev/v1alpha1',
  kind: 'ImageJob',
  spec: imageSpecSchema,
  status: imageStatusSchema,
});

type ImageJobInput = Parameters<typeof ImageJob>[0];

const imageJobInput: ImageJobInput = {
  name: 'hero-image',
  spec: {
    sourceUrl: 's3://bucket/hero.png',
    formats: ['webp', 'avif'],
    priority: 'normal',
  },
};

const imagePipeline = sdk.operator({
  name: 'image-pipeline',
  resources: { ImageJob },
  effects: { mode: 'planned', replayable: true },
  handlers: [
    ImageJob.on.reconcile(async (job) => {
      const sourceUrl: string = job.spec.sourceUrl;
      const objectName: string = job.metadata.name;

      job.status.phase = 'Processing';
      job.status.outputUrls = [];
      const output = job.k8s.ConfigMap({
        name: job.names.dnsSafe(`${objectName}-output`),
        data: { sourceUrl, priority: job.spec.priority },
      });

      job.resources.apply(
        job.batch.Job({
          name: job.names.dnsSafe(`${objectName}-proxy`),
          image: 'ghcr.io/acme/image-resizer:v1',
          env: {
            SOURCE_URL: sourceUrl,
          },
        })
      );
      job.apply(output);
      job.delete(output);

      job.apply(handlerOperationTarget);
      job.events.normal('ImageJobAccepted', 'Image job accepted through proxy handler');
      job.requeue({ afterSeconds: 30, reason: 'WaitingForProxyHandlerOutput' });
    }),

    ImageJob.on.context.created(async (job, ctx) => {
      const sourceUrl: string = job.spec.sourceUrl;
      const formats: string[] = job.spec.formats;
      const priority: ImageSpec['priority'] = job.spec.priority;

      expectTypeUsage(sourceUrl, formats, priority);

      const graphResult = ctx.applyGraph({
        graph: appGraph,
        spec: { namespace: 'media', sourceUrl: job.spec.sourceUrl },
        adapter: appGraphAdapter,
      });

      if (!graphResult.ok) {
        return graphResult;
      }

      return ctx.apply({
        applyTargets: [
          {
            target: handlerOperationTarget,
            options: { fieldManager: 'applik8s-test', force: true },
          },
        ],
        resources: [
          ImageJob({
            name: ctx.names.dnsSafe(`${job.metadata.name}-copy`),
            spec: job.spec,
          }),
        ],
        events: [
          ctx.recordEvent({
            kind: 'event',
            type: 'Normal',
            reason: 'ImageJobAccepted',
            message: 'Image job accepted for processing',
          }),
        ],
        finalizers: [{ kind: 'finalizer', operation: 'add', finalizer: 'media.applik8s.dev/image-job' }],
        status: {
          phase: 'Processing',
          outputUrls: [],
        },
      });
    }),
  ],
});

const pipeline = imagePipeline({ namespace: 'media', replicas: 2 });
const lowerCamelImage = pipeline.imageJob(imageJobInput);
const pascalImage = pipeline.ImageJob(imageJobInput);
const resourceImage = pipeline.resource('imageJob', imageJobInput);

const lowerCamelSpec: ImageSpec = lowerCamelImage.spec;
const pascalSpec: ImageSpec = pascalImage.spec;
const resourceSpec: ImageSpec = resourceImage.spec;
const lowerCamelStatus: ImageStatus | undefined = lowerCamelImage.status;

expectTypeUsage(lowerCamelSpec, pascalSpec, resourceSpec, lowerCamelStatus);

interface NamedErasedSpec {
  value: string;
}

declare const erasedOperator: DeployedOperator<
  CapabilityClientSet,
  { readonly anyKind: AnyCrdInstanceFactory }
>;

const erasedInput: CrdInstanceInput<NamedErasedSpec> = {
  name: 'erased-resource',
  spec: { value: 'named-interface-without-index-signature' },
};

const erasedDirect = erasedOperator.anyKind(erasedInput);
const erasedViaHelper = erasedOperator.resource('anyKind', erasedInput);

const erasedDirectSpec: object | undefined = erasedDirect.spec;
const erasedHelperSpec: object | undefined = erasedViaHelper.spec;

expectTypeUsage(erasedDirectSpec, erasedHelperSpec);

testing
  .testOperator(imagePipeline)
  .given(ImageJob(imageJobInput))
  .expectApply(ImageJob(imageJobInput))
  .run({ reconcile: { apiVersion: ImageJob.apiVersion, kind: ImageJob.kind, name: imageJobInput.name } });

const typeKroResult = typeKro.asComposition(imagePipeline.definition, imageManifest, {
  compositionName: 'image-pipeline',
});

if (typeKroResult.ok) {
  const imageOperator = typeKroResult.value;
  const installedPipeline = imageOperator({ namespace: 'media', replicas: 2 });
  const enhancedLowerCamel = installedPipeline.imageJob(imageJobInput);
  const enhancedPascal = installedPipeline.ImageJob(imageJobInput);
  const imageReady: boolean = enhancedLowerCamel.status.phase === 'Complete';
  const imageFailed: boolean = enhancedPascal.status.phase === 'Failed';

  expectTypeUsage(imageReady, imageFailed);
}

const topLevelTypeKroResult = topLevelTypeKro.asComposition(imagePipeline.definition, imageManifest, {
  compositionName: 'image-pipeline-top-level',
});
const ergonomicTypeKroResult = typeKro.composition(imagePipeline.definition, imageManifest, {
  compositionName: 'image-pipeline-ergonomic',
});

if (topLevelTypeKroResult.ok) {
  const installedPipeline = topLevelTypeKroResult.value({ namespace: 'media' });
  const enhancedImage = installedPipeline.imageJob(imageJobInput);
  const enhancedImageSpec: ImageSpec = enhancedImage.spec;

  expectTypeUsage(enhancedImageSpec);
}

if (ergonomicTypeKroResult.ok) {
  const installedPipeline = ergonomicTypeKroResult.value({ namespace: 'media' });
  const enhancedImage = installedPipeline.imageJob(imageJobInput);
  const enhancedImageSpec: ImageSpec = enhancedImage.spec;

  expectTypeUsage(enhancedImageSpec);
}

const sameStatusTypeKroAdapter = typeKro.createGraphAdapter<TenantGraphSpec, TenantGraphStatus>();
const sameStatusTypeKroGraphAdapter = typeKro.graphAdapter<TenantGraphSpec, TenantGraphStatus>();
const mappedTypeKroAdapter = typeKro.createGraphAdapter<
  TenantGraphSpec,
  TenantGraphStatus,
  ImageStatus
>({
  statusMapper: (status) => ({
    phase: status.ready ? 'Complete' : 'Processing',
    outputUrls: status.endpoint ? [status.endpoint] : [],
  }),
});

declare const imageHandlerContext: HandlerContext<ImageSpec, ImageStatus>;

imageHandlerContext.applyGraph({
  graph: tenantGraph,
  spec: { namespace: 'media' },
  adapter: mappedTypeKroAdapter,
});

const contextConfigMap = imageHandlerContext.k8s.ConfigMap({
  name: 'context-output',
  namespace: 'media',
  data: { sourceUrl: 's3://bucket/hero.png' },
});
imageHandlerContext.apply(contextConfigMap);
imageHandlerContext.delete(contextConfigMap);

sameStatusTypeKroAdapter.renderStatus(tenantGraph, { namespace: 'media' });
sameStatusTypeKroGraphAdapter.renderStatus(tenantGraph, { namespace: 'media' });

const mappedTarget = typeKro.toOperationTarget<TenantGraphSpec, TenantGraphStatus, ImageStatus>(
  tenantGraph,
  { namespace: 'media' },
  {
    statusMapper: (status) => ({
      phase: status.ready ? 'Complete' : 'Processing',
      outputUrls: status.endpoint ? [status.endpoint] : [],
    }),
  }
);

const ergonomicMappedTarget = typeKro.operationTarget<TenantGraphSpec, TenantGraphStatus, ImageStatus>(
  tenantGraph,
  { namespace: 'media' },
  {
    statusMapper: (status) => ({
      phase: status.ready ? 'Complete' : 'Processing',
      outputUrls: status.endpoint ? [status.endpoint] : [],
    }),
  }
);
const lightweightMappedTarget = handlerOperationTargetFactory<TenantGraphSpec, TenantGraphStatus, ImageStatus>(
  tenantGraph,
  { namespace: 'media' },
  {
    statusMapper: (status) => ({
      phase: status.ready ? 'Complete' : 'Processing',
      outputUrls: status.endpoint ? [status.endpoint] : [],
    }),
  }
);

imageHandlerContext.apply(mappedTarget);
imageHandlerContext.delete(mappedTarget);
imageHandlerContext.apply(ergonomicMappedTarget);
imageHandlerContext.delete(ergonomicMappedTarget);
imageHandlerContext.apply(lightweightMappedTarget);
imageHandlerContext.delete(lightweightMappedTarget);

const tenantStack = typeKro.asOperationTargetFactory<
  TenantGraphSpec,
  TenantGraphStatus,
  ImageStatus
>(tenantGraph, {
  statusMapper: (status) => ({
    phase: status.ready ? 'Complete' : 'Processing',
    outputUrls: status.endpoint ? [status.endpoint] : [],
  }),
});

const ergonomicTenantStack = typeKro.targetFactory<
  TenantGraphSpec,
  TenantGraphStatus,
  ImageStatus
>(tenantGraph, {
  statusMapper: (status) => ({
    phase: status.ready ? 'Complete' : 'Processing',
    outputUrls: status.endpoint ? [status.endpoint] : [],
  }),
});
const lightweightTenantStack = handlerTargetFactory<
  TenantGraphSpec,
  TenantGraphStatus,
  ImageStatus
>(tenantGraph, {
  statusMapper: (status) => ({
    phase: status.ready ? 'Complete' : 'Processing',
    outputUrls: status.endpoint ? [status.endpoint] : [],
  }),
});

const stack = tenantStack({ namespace: 'media' });
const ergonomicStack = ergonomicTenantStack({ namespace: 'media' });
const lightweightStack = lightweightTenantStack({ namespace: 'media' });
const composableStack = tenantStack({ namespace: 'media', plan: undefined });
const composableTarget = typeKro.toOperationTarget<TenantGraphSpec, TenantGraphStatus, ImageStatus>(
  tenantGraph,
  { namespace: 'media', plan: undefined },
  {
    statusMapper: (status) => ({
      phase: status.ready ? 'Complete' : 'Processing',
      outputUrls: status.endpoint ? [status.endpoint] : [],
    }),
  }
);

const composableSpec = composableStack.spec;
const composableTargetSpec = composableTarget.spec;

expectTypeUsage(composableSpec, composableTargetSpec);

imageHandlerContext.apply(stack);
imageHandlerContext.delete(stack);
imageHandlerContext.plan(stack);
imageHandlerContext.apply(ergonomicStack);
imageHandlerContext.delete(ergonomicStack);
imageHandlerContext.plan(ergonomicStack);
imageHandlerContext.apply(lightweightStack);
imageHandlerContext.delete(lightweightStack);
imageHandlerContext.plan(lightweightStack);
imageHandlerContext.apply([stack, composableStack], {
  status: { phase: 'Processing', outputUrls: [] },
  events: [
    imageHandlerContext.recordEvent({
      kind: 'event',
      type: 'Normal',
      reason: 'TenantStackApplyRequested',
      message: 'Tenant stack apply requested',
    }),
  ],
});
imageHandlerContext.delete([stack], {
  deleteTargets: [{ target: composableStack, options: { propagationPolicy: 'Foreground' } }],
  status: { phase: 'Pending', outputUrls: [] },
});

// @ts-expect-error statusMapper is required when graph status differs from handler status.
typeKro.createGraphAdapter<TenantGraphSpec, TenantGraphStatus, ImageStatus>();

// @ts-expect-error statusMapper is required when graph status differs from handler status.
typeKro.graphAdapter<TenantGraphSpec, TenantGraphStatus, ImageStatus>();

// @ts-expect-error statusMapper is required for TypeKro operation targets with different handler status.
typeKro.toOperationTarget<TenantGraphSpec, TenantGraphStatus, ImageStatus>(tenantGraph, {
  namespace: 'media',
});

// @ts-expect-error statusMapper is required for TypeKro operation targets with different handler status.
typeKro.operationTarget<TenantGraphSpec, TenantGraphStatus, ImageStatus>(tenantGraph, {
  namespace: 'media',
});

// @ts-expect-error statusMapper is required for target factories with different handler status.
typeKro.asOperationTargetFactory<TenantGraphSpec, TenantGraphStatus, ImageStatus>(tenantGraph);

// @ts-expect-error statusMapper is required for target factories with different handler status.
typeKro.targetFactory<TenantGraphSpec, TenantGraphStatus, ImageStatus>(tenantGraph);

async function useNamedCapabilityPayloads() {
  const charge = await billing.post<ChargeRequest>('/charges', {
    amountCents: 2500,
    currency: 'USD',
  });

  const chargeId: string = charge.chargeId;

  return chargeId;
}

expectTypeUsage(useNamedCapabilityPayloads);

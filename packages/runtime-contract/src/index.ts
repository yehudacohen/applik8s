import { type as arkType } from 'arktype';

type JsonSchema = Readonly<Record<string, unknown>>;

const payloadSchemaKinds = [
  'handlerInput',
  'normalizedOperationPlan',
  'operatorManifest',
  'handlerError',
  'capabilityRequest',
  'capabilityResponse',
];

const operationKinds = ['apply', 'patch', 'delete', 'status', 'event', 'finalizer', 'requeue'];
const javascriptRuntimeFeatures = ['closures', 'asyncFunctions', 'promises', 'es6Proxy'];
export const canonicalRuntimeContractVersion = 'applik8s.runtime-contract/v1alpha1';
export const canonicalHandlerAbiVersion = 'applik8s.handler/v1alpha1';
export type SupportedHandlerAbiVersion = typeof canonicalHandlerAbiVersion;
export const supportedHandlerAbiVersions: readonly SupportedHandlerAbiVersion[] = [canonicalHandlerAbiVersion];

export interface RuntimeContractRegistryEntry {
  readonly abiVersion: SupportedHandlerAbiVersion;
  readonly contractVersion: typeof canonicalRuntimeContractVersion;
  readonly runtimeAdapterKind: 'wasmComponent';
  readonly witPackage: string;
  readonly world: string;
  readonly contract: CanonicalRuntimeContract;
}

const jsonValueSchema: JsonSchema = {
  description: 'Arbitrary JSON value owned by user schemas or external capability payloads.',
};

const stringMapSchema: JsonSchema = {
  type: 'object',
  additionalProperties: { type: 'string' },
};

const objectRefSchema: JsonSchema = objectSchema(
  {
    apiVersion: { type: 'string' },
    kind: { type: 'string' },
    name: { type: 'string' },
    namespace: { type: 'string' },
    uid: { type: 'string' },
    resourceVersion: { type: 'string' },
  },
  ['apiVersion', 'kind', 'name']
);

const kubernetesConnectionNameSchema: JsonSchema = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,62}$' };
const kubernetesConnectionBindingSchema: JsonSchema = objectSchema(
  {
    kubeconfigSecretRef: objectSchema(
      {
        name: { type: 'string', minLength: 1 },
        namespace: { type: 'string', minLength: 1 },
        key: { type: 'string', minLength: 1 },
      },
      ['name', 'namespace', 'key']
    ),
    context: { type: 'string', minLength: 1 },
    endpointPolicy: objectSchema(
      {
        name: { type: 'string', minLength: 1 },
        version: { type: 'string', minLength: 1 },
        scheme: constSchema('https'),
        hosts: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
        ports: { type: 'array', minItems: 1, items: { type: 'integer', minimum: 1, maximum: 65535 } },
        allowedCidrs: { type: 'array', items: { type: 'string', minLength: 1 } },
        tlsServerNames: { type: 'array', items: { type: 'string', minLength: 1 } },
        redirects: constSchema('deny'),
      },
      ['name', 'version', 'scheme', 'hosts', 'ports', 'redirects']
    ),
  },
  ['kubeconfigSecretRef', 'context', 'endpointPolicy']
);
const kubernetesConnectionBindingsSchema: JsonSchema = {
  type: 'object',
  propertyNames: kubernetesConnectionNameSchema,
  additionalProperties: kubernetesConnectionBindingSchema,
};

const objectMetaSchema: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    namespace: { type: 'string' },
    uid: { type: 'string' },
    resourceVersion: { type: 'string' },
    generation: { type: 'number' },
    labels: stringMapSchema,
    annotations: stringMapSchema,
    finalizers: { type: 'array', items: { type: 'string' } },
    deletionTimestamp: { type: 'string' },
    creationTimestamp: { type: 'string' },
  },
  required: ['name'],
  additionalProperties: true,
};

const kubernetesObjectSchema: JsonSchema = {
  type: 'object',
  properties: {
    apiVersion: { type: 'string' },
    kind: { type: 'string' },
    metadata: objectMetaSchema,
    spec: jsonValueSchema,
    status: jsonValueSchema,
  },
  required: ['apiVersion', 'kind', 'metadata'],
  additionalProperties: true,
};

const diagnosticSchema: JsonSchema = objectSchema(
  {
    severity: enumSchema(['info', 'warning', 'error']),
    code: { type: 'string' },
    message: { type: 'string' },
    sourceLocation: objectSchema(
      {
        file: { type: 'string' },
        line: { type: 'number' },
        column: { type: 'number' },
      },
      ['file', 'line', 'column']
    ),
  },
  ['severity', 'code', 'message']
);

const jsonPatchEntrySchema: JsonSchema = objectSchema(
  {
    op: enumSchema(['add', 'remove', 'replace', 'move', 'copy', 'test']),
    path: { type: 'string' },
    value: jsonValueSchema,
    from: { type: 'string' },
  },
  ['op', 'path']
);

const deleteOptionsSchema: JsonSchema = objectSchema({
  propagationPolicy: enumSchema(['Foreground', 'Background', 'Orphan']),
  gracePeriodSeconds: { type: 'number' },
  preconditions: objectSchema({ uid: { type: 'string' }, resourceVersion: { type: 'string' } }, ['uid']),
});

const requeuePolicySchema: JsonSchema = objectSchema({
  afterSeconds: { type: 'number' },
  reason: { type: 'string' },
});

const applyOwnershipSchema: JsonSchema = {
  oneOf: [
    objectSchema({ mode: constSchema('auto') }, ['mode']),
    objectSchema({ mode: constSchema('none') }, ['mode']),
    objectSchema({ mode: constSchema('reference'), ref: objectRefSchema, blockOwnerDeletion: { type: 'boolean' } }, ['mode', 'ref']),
  ],
};

const remoteMutationAuthoritySchema: JsonSchema = {
  oneOf: [
    objectSchema({ mode: constSchema('managed'), identity: { type: 'string' }, sourceUid: { type: 'string' } }, ['mode', 'identity', 'sourceUid']),
    objectSchema({ mode: constSchema('existing'), precondition: objectSchema({ uid: { type: 'string' }, resourceVersion: { type: 'string' } }, ['uid', 'resourceVersion']) }, ['mode', 'precondition']),
  ],
};

const operationSchema: JsonSchema = {
  oneOf: [
    objectSchema({ kind: constSchema('apply'), resource: kubernetesObjectSchema, fieldManager: { type: 'string' }, force: { type: 'boolean' }, ownership: applyOwnershipSchema, connection: kubernetesConnectionNameSchema, authority: remoteMutationAuthoritySchema }, ['kind', 'resource']),
    objectSchema({ kind: constSchema('patch'), ref: objectRefSchema, patch: { type: 'array', items: jsonPatchEntrySchema }, connection: kubernetesConnectionNameSchema, authority: remoteMutationAuthoritySchema }, ['kind', 'ref', 'patch']),
    objectSchema({ kind: constSchema('delete'), ref: objectRefSchema, options: deleteOptionsSchema, connection: kubernetesConnectionNameSchema, authority: remoteMutationAuthoritySchema }, ['kind', 'ref']),
    objectSchema({ kind: constSchema('status'), status: jsonValueSchema, ref: objectRefSchema }, ['kind', 'status']),
    objectSchema({ kind: constSchema('event'), type: enumSchema(['Normal', 'Warning']), reason: { type: 'string' }, message: { type: 'string' }, regarding: objectRefSchema }, ['kind', 'type', 'reason', 'message']),
    objectSchema({ kind: constSchema('finalizer'), operation: enumSchema(['add', 'remove']), finalizer: { type: 'string' } }, ['kind', 'operation', 'finalizer']),
    objectSchema({ kind: constSchema('requeue'), policy: requeuePolicySchema }, ['kind', 'policy']),
  ],
};

export const runtimePayloadSchemas: Readonly<Record<string, JsonSchema>> = {
  handlerInput: objectSchema(
    {
      abiVersion: constSchema('applik8s.handler/v1alpha1'),
      handlerId: { type: 'string' },
      event: enumSchema(['reconcile', 'created', 'updated', 'deleted', 'finalize', 'statusChanged']),
      object: kubernetesObjectSchema,
      previous: kubernetesObjectSchema,
      observed: objectSchema({ relatedObjects: { type: 'array', items: kubernetesObjectSchema }, resourceVersion: { type: 'string' } }, ['relatedObjects']),
      config: jsonValueSchema,
      capabilities: { type: 'object', additionalProperties: capabilityDescriptorSchema() },
      runtime: objectSchema(
        {
          operatorName: { type: 'string' },
          reconcileId: { type: 'string' },
          bundleDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
          runtimeVersion: { type: 'string' },
          startedAt: { type: 'string' },
        },
        ['operatorName', 'reconcileId', 'bundleDigest', 'runtimeVersion', 'startedAt']
      ),
    },
    ['abiVersion', 'handlerId', 'event', 'object', 'runtime']
  ),
  normalizedOperationPlan: objectSchema(
    {
      operations: { type: 'array', items: operationSchema },
      diagnostics: { type: 'array', items: diagnosticSchema },
    },
    ['operations']
  ),
  operatorManifest: objectSchema(
    {
      apiVersion: constSchema('applik8s.operator/v1alpha1'),
      kind: constSchema('OperatorBundle'),
      metadata: objectSchema({ name: { type: 'string' }, labels: stringMapSchema, annotations: stringMapSchema }, ['name']),
      spec: objectSchema({
        handlerAbi: constSchema('applik8s.handler/v1alpha1'),
        payloadSchemaDigests: { type: 'object' },
        requiresRuntime: { type: 'string' },
        handlerArtifact: objectSchema({ kind: constSchema('wasm-component'), path: { type: 'string' }, digest: { type: 'string' } }, ['kind', 'path', 'digest']),
        adapterRequirements: { type: 'object' },
        handlerExports: { type: 'array', items: objectSchema({ handlerId: { type: 'string' }, exportName: { type: 'string' }, event: { type: 'string' }, finalizers: { type: 'array', items: { type: 'string' } } }, ['handlerId', 'exportName', 'event']) },
        ownedCrds: { type: 'array' },
        readResources: { type: 'array', items: objectSchema({
          apiVersion: { type: 'string' },
          kind: { type: 'string' },
          plural: { type: 'string' },
          scope: enumSchema(['Namespaced', 'Cluster']),
          namespaces: { oneOf: [{ const: 'all' }, { type: 'array', items: { type: 'string' } }] },
          access: enumSchema(['local', 'connection', 'both']),
        }, ['apiVersion', 'kind', 'plural', 'scope', 'access']) },
        watches: { type: 'array' },
        permissions: { type: 'array' },
        capabilities: { type: 'object' },
        kubernetesConnectionBindings: kubernetesConnectionBindingsSchema,
        security: { type: 'object' },
        lifecycle: { type: 'object' },
        runtime: { type: 'object' },
        bundle: { type: 'object' },
      }, ['handlerAbi', 'payloadSchemaDigests', 'requiresRuntime', 'handlerArtifact', 'handlerExports', 'ownedCrds', 'watches', 'permissions', 'security', 'lifecycle', 'bundle']),
    },
    ['apiVersion', 'kind', 'metadata', 'spec']
  ),
  handlerError: objectSchema(
    {
      code: { type: 'string' },
      message: { type: 'string' },
      severity: enumSchema(['info', 'warning', 'error']),
      contextJson: { type: 'string' },
      causeJson: { type: 'string' },
      recoveryJson: { type: 'string' },
    },
    ['code', 'message', 'severity', 'contextJson']
  ),
  capabilityRequest: objectSchema(
    {
      capabilityName: { type: 'string' },
      method: enumSchema(['GET', 'POST', 'PUT', 'DELETE']),
      path: { type: 'string' },
      body: jsonValueSchema,
      options: objectSchema({ idempotencyKey: { type: 'string' }, timeoutMs: { type: 'number' }, headers: stringMapSchema }),
      reconcileId: { type: 'string' },
    },
    ['capabilityName', 'method', 'path', 'reconcileId']
  ),
  capabilityResponse: {
    oneOf: [
      objectSchema({ ok: constSchema(true), value: jsonValueSchema, observedAt: { type: 'string' } }, ['ok', 'value']),
      objectSchema({ ok: constSchema(false), error: { type: 'object' } }, ['ok', 'error']),
    ],
  },
};

export const canonicalRuntimeContractSchema = arkType({
  contractVersion: '"applik8s.runtime-contract/v1alpha1"',
  abiVersion: '"applik8s.handler/v1alpha1"',
  runtimeAdapterKind: '"wasmComponent"',
  witPackage: 'string',
  world: 'string',
  witSource: 'string',
  wireFormat: {
    inputEncoding: '"jsonString"',
    outputEncoding: '"jsonString"',
    errorEncoding: '"jsonString"',
  },
  canonical: {
    handleExport: '"handle"',
    capabilityRequestImport: '"capability-request"',
    kubernetesReadImport: '"kubernetes-read"',
    logImport: '"log"',
    cancelImport: '"cancel"',
  },
  payloadSchemaKinds: 'string[]',
  operationKinds: 'string[]',
  javascriptRuntimeFeatures: 'string[]',
  payloadSchemas: 'Record<string, unknown>',
  generatedBy: '"@applik8s/runtime-contract"',
});

export function canonicalHandlerWit(): string {
  return `package applik8s:handler;

interface capabilities {
  capability-request: func(request-json: string) -> result<string, string>;
}

interface kubernetes {
  kubernetes-read: func(request-json: string) -> result<string, string>;
}

world handler {
  import capabilities;
  import kubernetes;
  import log: func(event-json: string);
  import cancel: func(reason-json: string);

  export handle: func(input-json: string) -> result<string, string>;
}
`;
}

export function canonicalRuntimeContract() {
  return {
    contractVersion: canonicalRuntimeContractVersion,
    abiVersion: canonicalHandlerAbiVersion,
    runtimeAdapterKind: 'wasmComponent',
    witPackage: 'applik8s:handler',
    world: 'handler',
    witSource: canonicalHandlerWit(),
    wireFormat: {
      inputEncoding: 'jsonString',
      outputEncoding: 'jsonString',
      errorEncoding: 'jsonString',
    },
    canonical: {
      handleExport: 'handle',
      capabilityRequestImport: 'capability-request',
      kubernetesReadImport: 'kubernetes-read',
      logImport: 'log',
      cancelImport: 'cancel',
    },
    payloadSchemaKinds,
    operationKinds,
    javascriptRuntimeFeatures,
    payloadSchemas: runtimePayloadSchemas,
    generatedBy: '@applik8s/runtime-contract',
  };
}

export type CanonicalRuntimeContract = ReturnType<typeof canonicalRuntimeContract>;

export function canonicalRuntimeContractRegistry(): readonly RuntimeContractRegistryEntry[] {
  const contract = canonicalRuntimeContract();
  return [
    {
      abiVersion: canonicalHandlerAbiVersion,
      contractVersion: canonicalRuntimeContractVersion,
      runtimeAdapterKind: 'wasmComponent',
      witPackage: contract.witPackage,
      world: contract.world,
      contract,
    },
  ];
}

export function runtimeContractForAbiVersion(abiVersion: string): CanonicalRuntimeContract | undefined {
  return canonicalRuntimeContractRegistry().find((entry) => entry.abiVersion === abiVersion)?.contract;
}

export function assertCanonicalRuntimeContract(value: unknown): void {
  const result = canonicalRuntimeContractSchema(value);
  if (result && typeof result === 'object' && 'problems' in result) {
    throw new Error(String(result.problems));
  }
}

function objectSchema(properties: Readonly<Record<string, JsonSchema>>, required: readonly string[] = []): JsonSchema {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function enumSchema(values: readonly string[]): JsonSchema {
  return { enum: values };
}

function constSchema(value: string | boolean): JsonSchema {
  return { const: value };
}

function capabilityDescriptorSchema(): JsonSchema {
  return objectSchema({
    name: { type: 'string' },
    kind: { type: 'string' },
    endpoint: { type: 'string' },
    auth: objectSchema({ type: { type: 'string' }, secretRef: objectSchema({ name: { type: 'string' }, namespace: { type: 'string' }, key: { type: 'string' } }) }),
    permissions: { type: 'array', items: objectSchema({
      apiGroups: { type: 'array', items: { type: 'string' } },
      resources: { type: 'array', items: { type: 'string' } },
      verbs: { type: 'array', items: { type: 'string' } },
      resourceNames: { type: 'array', items: { type: 'string' } },
      namespaces: { oneOf: [{ const: 'all' }, { type: 'array', items: { type: 'string' } }] },
    }, ['apiGroups', 'resources', 'verbs']) },
    policy: objectSchema({ timeoutMs: { type: 'number' }, idempotencyKeyRequired: { type: 'boolean' }, failureMode: { type: 'string' } }),
    execution: objectSchema({
      liveExecution: enumSchema(['disabled', 'hostProtocol']),
      protocol: enumSchema(['notImplemented', 'applik8s.capability/v1alpha1', 'applik8s.kubernetes-connection/v1alpha1']),
      audit: objectSchema({ recordRequests: { type: 'boolean' }, recordResponses: { type: 'boolean' }, includePayloads: constSchema(false) }),
      redaction: objectSchema({ requestBody: constSchema('redacted'), responseBody: constSchema('redacted'), headers: constSchema('redacted'), errors: constSchema('publicMessageOnly') }),
      idempotency: objectSchema({ requiredForMutations: { type: 'boolean' }, keySource: enumSchema(['handlerProvided', 'notApplicable']) }),
    }),
    sensitive: { type: 'boolean' },
    kubernetesConnection: objectSchema({ endpointPolicy: { type: 'string' } }, ['endpointPolicy']),
  }, ['name', 'kind']);
}

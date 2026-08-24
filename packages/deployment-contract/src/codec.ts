import {
  normalizeApplicationDeploymentGraph,
} from "./serialization.js";
import type {
  ApplicationDeploymentGraph,
  ApplicationDeploymentNodeKind,
} from "./types.js";
import { validateApplicationDeploymentGraph } from "./validation.js";

export class ApplicationDeploymentGraphDecodeError extends Error {
  readonly diagnostics: readonly string[];

  constructor(diagnostics: readonly string[]) {
    super(
      `ApplicationDeploymentGraph decoding failed:\n${diagnostics
        .map((diagnostic) => `- ${diagnostic}`)
        .join("\n")}`,
    );
    this.name = "ApplicationDeploymentGraphDecodeError";
    this.diagnostics = diagnostics;
  }
}

export function decodeApplicationDeploymentGraph(
  input: string | unknown,
): ApplicationDeploymentGraph {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch (cause) {
      throw new ApplicationDeploymentGraphDecodeError([
        `input is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      ]);
    }
  }
  const diagnostics: string[] = [];
  validateGraphShape(value, diagnostics);
  if (diagnostics.length > 0) {
    throw new ApplicationDeploymentGraphDecodeError(diagnostics);
  }
  // typecast: validateGraphShape exhaustively checks the closed graph
  // typecast: shape validation covers the envelope, taxonomy, contracts, inputs, outputs, and edges.
  const graph = value as ApplicationDeploymentGraph;
  const semantic = validateApplicationDeploymentGraph(graph);
  if (!semantic.valid) {
    throw new ApplicationDeploymentGraphDecodeError(
      semantic.diagnostics.map(
        (diagnostic) => `[${diagnostic.code}] ${diagnostic.message}`,
      ),
    );
  }
  return normalizeApplicationDeploymentGraph(graph);
}

function validateGraphShape(value: unknown, diagnostics: string[]): void {
  if (!record(value, "$", diagnostics)) return;
  exactKeys(value, "$", ["apiVersion", "kind", "metadata", "runtimeAccess", "nodes", "edges"], [], diagnostics);
  literal(
    value.apiVersion,
    "applik8s.deploymentGraph/v1alpha1",
    "$.apiVersion",
    diagnostics,
  );
  literal(value.kind, "ApplicationDeploymentGraph", "$.kind", diagnostics);
  validateMetadata(value.metadata, diagnostics);
  jsonValue(value.runtimeAccess, '$.runtimeAccess', diagnostics);
  if (array(value.nodes, "$.nodes", diagnostics)) {
    for (const [index, node] of value.nodes.entries()) {
      validateNode(node, `$.nodes[${index}]`, diagnostics);
    }
  }
  if (array(value.edges, "$.edges", diagnostics)) {
    for (const [index, edge] of value.edges.entries()) {
      validateEdge(edge, `$.edges[${index}]`, diagnostics);
    }
  }
}

function validateMetadata(value: unknown, diagnostics: string[]): void {
  const path = "$.metadata";
  if (!record(value, path, diagnostics)) return;
  exactKeys(
    value,
    path,
    ["identity", "mode", "strategy", "sourceGraphDigest", "compilerVersion"],
    ["profileTransition"],
    diagnostics,
  );
  enumString(value.mode, ["fresh"], `${path}.mode`, diagnostics);
  enumString(value.strategy, ["direct", "kro"], `${path}.strategy`, diagnostics);
  string(value.sourceGraphDigest, `${path}.sourceGraphDigest`, diagnostics);
  string(value.compilerVersion, `${path}.compilerVersion`, diagnostics);
  if (value.profileTransition !== undefined) {
    validateProfileTransition(value.profileTransition, diagnostics);
  }
  const identityPath = `${path}.identity`;
  if (!record(value.identity, identityPath, diagnostics)) return;
  exactKeys(
    value.identity,
    identityPath,
    [
      "connection",
      "application",
      "controlPlaneNamespace",
      "instance",
      "profile",
    ],
    [],
    diagnostics,
  );
  for (const field of [
    "application",
    "controlPlaneNamespace",
    "instance",
    "profile",
  ]) {
    string(value.identity[field], `${identityPath}.${field}`, diagnostics);
  }
  const connectionPath = `${identityPath}.connection`;
  if (!record(value.identity.connection, connectionPath, diagnostics)) return;
  exactKeys(
    value.identity.connection,
    connectionPath,
    ["provider", "cluster", "digest"],
    [],
    diagnostics,
  );
  for (const field of ["provider", "cluster", "digest"]) {
    string(
      value.identity.connection[field],
      `${connectionPath}.${field}`,
      diagnostics,
    );
  }
}

function validateProfileTransition(
  value: unknown,
  diagnostics: string[],
): void {
  const path = '$.metadata.profileTransition';
  if (!record(value, path, diagnostics)) return;
  exactKeys(
    value,
    path,
    ['apiVersion', 'installation', 'mode', 'entries', 'acknowledgements'],
    [],
    diagnostics,
  );
  literal(
    value.apiVersion,
    'applik8s.profileTransitionPlan/v1alpha1',
    `${path}.apiVersion`,
    diagnostics,
  );
  enumString(
    value.mode,
    ['fresh', 'unchanged', 'transition'],
    `${path}.mode`,
    diagnostics,
  );
  const installationPath = `${path}.installation`;
  if (record(value.installation, installationPath, diagnostics)) {
    exactKeys(
      value.installation,
      installationPath,
      ['namespace', 'name'],
      [],
      diagnostics,
    );
    string(
      value.installation.namespace,
      `${installationPath}.namespace`,
      diagnostics,
    );
    string(
      value.installation.name,
      `${installationPath}.name`,
      diagnostics,
    );
  }
  if (array(value.entries, `${path}.entries`, diagnostics)) {
    for (const [index, entry] of value.entries.entries()) {
      jsonValue(entry, `${path}.entries[${index}]`, diagnostics);
    }
  }
  stringArray(
    value.acknowledgements,
    `${path}.acknowledgements`,
    diagnostics,
  );
}

function validateNode(value: unknown, path: string, diagnostics: string[]): void {
  if (!record(value, path, diagnostics)) return;
  exactKeys(
    value,
    path,
    [
      "id",
      "kind",
      "contractVersion",
      "source",
      "provider",
      "scope",
      "capabilities",
      "configurationDigest",
      "inputs",
      "outputs",
      "lifecycle",
      "spec",
    ],
    [],
    diagnostics,
  );
  string(value.id, `${path}.id`, diagnostics);
  const kind = enumString(
    value.kind,
    [
      "artifact",
      "externalProvider",
      "kubernetesComposition",
      "kubernetesDirect",
      "singleton",
      "externalReference",
      "secretReference",
      "statusProjection",
    ],
    `${path}.kind`,
    diagnostics,
  );
  integer(value.contractVersion, `${path}.contractVersion`, diagnostics);
  string(value.configurationDigest, `${path}.configurationDigest`, diagnostics);
  validateSource(value.source, `${path}.source`, diagnostics);
  validateProvider(value.provider, `${path}.provider`, diagnostics);
  validateScope(value.scope, `${path}.scope`, diagnostics);
  validateCapabilities(value.capabilities, `${path}.capabilities`, diagnostics);
  validateInputs(value.inputs, `${path}.inputs`, diagnostics);
  validateOutputs(value.outputs, `${path}.outputs`, diagnostics);
  validateLifecycle(value.lifecycle, `${path}.lifecycle`, diagnostics);
  validateSpec(value.spec, kind, `${path}.spec`, diagnostics);
}

function validateSource(value: unknown, path: string, diagnostics: string[]): void {
  if (!record(value, path, diagnostics)) return;
  exactKeys(
    value,
    path,
    [],
    ["semanticNodeId", "artifactPath", "file", "line", "column"],
    diagnostics,
  );
  for (const field of ["semanticNodeId", "artifactPath", "file"]) {
    if (value[field] !== undefined) string(value[field], `${path}.${field}`, diagnostics);
  }
  for (const field of ["line", "column"]) {
    if (value[field] !== undefined) integer(value[field], `${path}.${field}`, diagnostics);
  }
}

function validateProvider(value: unknown, path: string, diagnostics: string[]): void {
  if (!record(value, path, diagnostics)) return;
  exactKeys(value, path, ["interface", "implementation", "version"], [], diagnostics);
  for (const field of ["interface", "implementation", "version"]) {
    string(value[field], `${path}.${field}`, diagnostics);
  }
}

function validateScope(value: unknown, path: string, diagnostics: string[]): void {
  if (!record(value, path, diagnostics)) return;
  exactKeys(value, path, ["connectionDigest"], ["namespace"], diagnostics);
  string(value.connectionDigest, `${path}.connectionDigest`, diagnostics);
  if (value.namespace !== undefined) string(value.namespace, `${path}.namespace`, diagnostics);
}

function validateCapabilities(
  value: unknown,
  path: string,
  diagnostics: string[],
): void {
  if (!record(value, path, diagnostics)) return;
  exactKeys(value, path, ["strategies", "alchemy"], [], diagnostics);
  literal(value.alchemy, true, `${path}.alchemy`, diagnostics);
  if (array(value.strategies, `${path}.strategies`, diagnostics)) {
    for (const [index, strategy] of value.strategies.entries()) {
      enumString(
        strategy,
        ["direct", "kro"],
        `${path}.strategies[${index}]`,
        diagnostics,
      );
    }
  }
}

function validateInputs(value: unknown, path: string, diagnostics: string[]): void {
  if (!record(value, path, diagnostics)) return;
  for (const [name, input] of Object.entries(value)) {
    const inputPath = `${path}.${name}`;
    if (!record(input, inputPath, diagnostics)) continue;
    const kind = enumString(
      input.kind,
      ["literal", "output", "secretReference"],
      `${inputPath}.kind`,
      diagnostics,
    );
    if (kind === "literal") {
      exactKeys(input, inputPath, ["kind", "value"], [], diagnostics);
      jsonValue(input.value, `${inputPath}.value`, diagnostics);
    } else if (kind === "output") {
      exactKeys(
        input,
        inputPath,
        ["kind", "nodeId", "output", "sensitivity", "persistence"],
        [],
        diagnostics,
      );
      string(input.nodeId, `${inputPath}.nodeId`, diagnostics);
      string(input.output, `${inputPath}.output`, diagnostics);
      sensitivity(input.sensitivity, `${inputPath}.sensitivity`, diagnostics);
      persistence(input.persistence, `${inputPath}.persistence`, diagnostics);
    } else if (kind === "secretReference") {
      exactKeys(input, inputPath, ["kind", "nodeId"], ["key"], diagnostics);
      string(input.nodeId, `${inputPath}.nodeId`, diagnostics);
      if (input.key !== undefined) string(input.key, `${inputPath}.key`, diagnostics);
    }
  }
}

function validateOutputs(value: unknown, path: string, diagnostics: string[]): void {
  if (!array(value, path, diagnostics)) return;
  for (const [index, output] of value.entries()) {
    const outputPath = `${path}[${index}]`;
    if (!record(output, outputPath, diagnostics)) continue;
    exactKeys(
      output,
      outputPath,
      ["name", "type", "sensitivity", "persistence"],
      [],
      diagnostics,
    );
    string(output.name, `${outputPath}.name`, diagnostics);
    enumString(
      output.type,
      [
        "string",
        "number",
        "boolean",
        "json",
        "secretReference",
        "resourceReference",
        "artifactReference",
        "artifactDigest",
      ],
      `${outputPath}.type`,
      diagnostics,
    );
    sensitivity(output.sensitivity, `${outputPath}.sensitivity`, diagnostics);
    persistence(output.persistence, `${outputPath}.persistence`, diagnostics);
  }
}

function validateLifecycle(
  value: unknown,
  path: string,
  diagnostics: string[],
): void {
  if (!record(value, path, diagnostics)) return;
  exactKeys(
    value,
    path,
    ["ownership", "deletion", "adoption"],
    ["namespaceNodeId"],
    diagnostics,
  );
  enumString(
    value.ownership,
    ["application", "shared", "external"],
    `${path}.ownership`,
    diagnostics,
  );
  enumString(
    value.deletion,
    ["delete", "retain", "orphan", "none"],
    `${path}.deletion`,
    diagnostics,
  );
  enumString(
    value.adoption,
    ["createOnly", "createOrAdoptExact", "externalOnly"],
    `${path}.adoption`,
    diagnostics,
  );
  if (value.namespaceNodeId !== undefined) {
    string(value.namespaceNodeId, `${path}.namespaceNodeId`, diagnostics);
  }
}

function validateSpec(
  value: unknown,
  kind: ApplicationDeploymentNodeKind | undefined,
  path: string,
  diagnostics: string[],
): void {
  if (!record(value, path, diagnostics) || !kind) return;
  const required: Readonly<Record<ApplicationDeploymentNodeKind, readonly string[]>> = {
    artifact: ["artifactType", "sourceDescriptor"],
    externalProvider: ["resourceType"],
    kubernetesComposition: ["compositionId", "fragmentIds"],
    kubernetesDirect: ["compositionId", "reason"],
    singleton: ["singletonKey"],
    externalReference: ["referenceType", "reference"],
    secretReference: ["source", "name"],
    statusProjection: ["field", "sourceNodeId", "sourcePath", "classification"],
  };
  for (const field of required[kind]) {
    if (!(field in value)) diagnostics.push(`${path}.${field} is required.`);
  }
  if (kind === "artifact") {
    enumString(
      value.artifactType,
      ["containerImage", "wasmComponent", "migration", "generatedRuntime"],
      `${path}.artifactType`,
      diagnostics,
    );
    jsonValue(value.sourceDescriptor, `${path}.sourceDescriptor`, diagnostics);
  } else if (kind === "externalProvider") {
    string(value.resourceType, `${path}.resourceType`, diagnostics);
    if (value.controller !== undefined) string(value.controller, `${path}.controller`, diagnostics);
  } else if (kind === "kubernetesComposition") {
    string(value.compositionId, `${path}.compositionId`, diagnostics);
    stringArray(value.fragmentIds, `${path}.fragmentIds`, diagnostics);
    if (value.namespaceNodeIds !== undefined) {
      stringArray(value.namespaceNodeIds, `${path}.namespaceNodeIds`, diagnostics);
    }
  } else if (kind === "kubernetesDirect") {
    string(value.compositionId, `${path}.compositionId`, diagnostics);
    string(value.reason, `${path}.reason`, diagnostics);
  } else if (kind === "singleton") {
    string(value.singletonKey, `${path}.singletonKey`, diagnostics);
  } else if (kind === "externalReference") {
    string(value.referenceType, `${path}.referenceType`, diagnostics);
    jsonValue(value.reference, `${path}.reference`, diagnostics);
  } else if (kind === "secretReference") {
    enumString(
      value.source,
      ["kubernetesSecret", "hostBinding"],
      `${path}.source`,
      diagnostics,
    );
    string(value.name, `${path}.name`, diagnostics);
    for (const field of ["namespace", "key"]) {
      if (value[field] !== undefined) string(value[field], `${path}.${field}`, diagnostics);
    }
  } else if (kind === "statusProjection") {
    for (const field of ["field", "sourceNodeId", "sourcePath"]) {
      string(value[field], `${path}.${field}`, diagnostics);
    }
    enumString(
      value.classification,
      ["live", "desired", "static"],
      `${path}.classification`,
      diagnostics,
    );
  }
  jsonValue(value, path, diagnostics);
}

function validateEdge(value: unknown, path: string, diagnostics: string[]): void {
  if (!record(value, path, diagnostics)) return;
  exactKeys(value, path, ["from", "to", "relationship"], ["output"], diagnostics);
  string(value.from, `${path}.from`, diagnostics);
  string(value.to, `${path}.to`, diagnostics);
  enumString(
    value.relationship,
    [
      "requiresOutput",
      "requiresReady",
      "installsApi",
      "owns",
      "retains",
      "publishes",
      "projectsStatus",
    ],
    `${path}.relationship`,
    diagnostics,
  );
  if (value.output !== undefined) string(value.output, `${path}.output`, diagnostics);
}

function exactKeys(
  value: Record<string, unknown>,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  diagnostics: string[],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const field of required) {
    if (!(field in value)) diagnostics.push(`${path}.${field} is required.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) diagnostics.push(`${path}.${key} is not supported.`);
  }
}

function record(
  value: unknown,
  path: string,
  diagnostics: string[],
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push(`${path} must be an object.`);
    return false;
  }
  return true;
}

function array(
  value: unknown,
  path: string,
  diagnostics: string[],
): value is readonly unknown[] {
  if (!Array.isArray(value)) {
    diagnostics.push(`${path} must be an array.`);
    return false;
  }
  return true;
}

function string(
  value: unknown,
  path: string,
  diagnostics: string[],
): value is string {
  if (typeof value !== "string" || !value.trim()) {
    diagnostics.push(`${path} must be a non-empty string.`);
    return false;
  }
  return true;
}

function integer(value: unknown, path: string, diagnostics: string[]): void {
  if (!Number.isSafeInteger(value)) diagnostics.push(`${path} must be an integer.`);
}

function literal(
  value: unknown,
  expected: string | boolean,
  path: string,
  diagnostics: string[],
): void {
  if (value !== expected) diagnostics.push(`${path} must be ${JSON.stringify(expected)}.`);
}

function enumString<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  diagnostics: string[],
): T | undefined {
  const matched =
    typeof value === "string"
      ? allowed.find((candidate) => candidate === value)
      : undefined;
  if (!matched) {
    diagnostics.push(`${path} must be one of ${allowed.join(", ")}.`);
    return undefined;
  }
  return matched;
}

function stringArray(value: unknown, path: string, diagnostics: string[]): void {
  if (!array(value, path, diagnostics)) return;
  for (const [index, entry] of value.entries()) {
    string(entry, `${path}[${index}]`, diagnostics);
  }
}

function sensitivity(value: unknown, path: string, diagnostics: string[]): void {
  enumString(value, ["public", "sensitive"], path, diagnostics);
}

function persistence(value: unknown, path: string, diagnostics: string[]): void {
  enumString(
    value,
    ["state", "redacted", "reference", "ephemeral"],
    path,
    diagnostics,
  );
}

function jsonValue(value: unknown, path: string, diagnostics: string[]): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      diagnostics.push(`${path} must contain only finite JSON numbers.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      jsonValue(entry, `${path}[${index}]`, diagnostics);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      jsonValue(entry, `${path}.${key}`, diagnostics);
    }
    return;
  }
  diagnostics.push(`${path} must contain only JSON-compatible values.`);
}

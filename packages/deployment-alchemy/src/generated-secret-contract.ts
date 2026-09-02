// typecast-file-boundary: Portable deployment JSON is validated at this provider adapter boundary.
import type { DeploymentJsonObject } from "@applik8s/deployment-contract";
import type {
  ApplicationGeneratedSecretProps,
  ApplicationGeneratedSecretValue,
} from "@applik8s/deployment-provider-kubernetes";

export interface GeneratedSecretConfiguration {
  readonly namespace: string;
  readonly name: string;
  readonly secretType?: ApplicationGeneratedSecretProps["secretType"];
  readonly values: Readonly<Record<string, ApplicationGeneratedSecretValue>>;
  readonly consumers: readonly string[];
}
export function decodeGeneratedSecretConfiguration(
  value: unknown,
  nodeId: string,
): GeneratedSecretConfiguration {
  const configuration = requiredObject(value, `${nodeId}.configuration`);
  const values = requiredObject(
    configuration.values,
    `${nodeId}.configuration.values`,
  );
  return {
    namespace: requiredString(
      configuration.namespace,
      `${nodeId}.configuration.namespace`,
    ),
    name: requiredString(
      configuration.name,
      `${nodeId}.configuration.name`,
    ),
    ...(configuration.secretType === undefined
      ? {}
      : {
          secretType: requiredSecretType(
            configuration.secretType,
            `${nodeId}.configuration.secretType`,
          ),
        }),
    values: Object.fromEntries(
      Object.entries(values).map(([key, entry]) => [
        key,
        generatedSecretValue(
          entry,
          `${nodeId}.configuration.values.${key}`,
        ),
      ]),
    ),
    consumers: Array.isArray(configuration.consumers)
      ? configuration.consumers.map((entry, index) =>
          requiredString(
            entry,
            `${nodeId}.configuration.consumers.${index}`,
          ),
        )
      : [],
  };
}
function generatedSecretValue(
  value: unknown,
  label: string,
): ApplicationGeneratedSecretValue {
  const contract = requiredObject(value, label);
  if (contract.kind === "hostEnvironment") {
    return {
      kind: "hostEnvironment",
      name: requiredString(contract.name, `${label}.name`),
    };
  }
  if (contract.kind === "hostEnvironmentJson") {
    return {
      kind: "hostEnvironmentJson",
      name: requiredString(contract.name, `${label}.name`),
      property: requiredString(contract.property, `${label}.property`),
    };
  }
  if (contract.kind === "publicLiteral") {
    return {
      kind: "publicLiteral",
      value: requiredString(contract.value, `${label}.value`),
    };
  }
  if (
    contract.kind === "random" &&
    contract.encoding === "base64url" &&
    typeof contract.bytes === "number" &&
    Number.isInteger(contract.bytes)
  ) {
    return {
      kind: "random",
      bytes: contract.bytes,
      encoding: "base64url",
      ...(contract.characters === undefined
        ? {}
        : {
            characters: requiredInteger(
              contract.characters,
              `${label}.characters`,
            ),
          }),
    };
  }
  if (contract.kind === "template" && Array.isArray(contract.segments)) {
    return {
      kind: "template",
      segments: contract.segments.map((segment, index) =>
        generatedSecretTemplateSegment(
          segment,
          `${label}.segments.${index}`,
        ),
      ),
    };
  }
  if (
    contract.kind === "jwkSet" &&
    contract.algorithm === "RS256" &&
    typeof contract.modulusLength === "number" &&
    [2048, 3072, 4096].includes(contract.modulusLength)
  ) {
    return {
      kind: "jwkSet",
      algorithm: "RS256",
      modulusLength: contract.modulusLength as 2048 | 3072 | 4096,
      keyId: requiredString(contract.keyId, `${label}.keyId`),
    };
  }
  throw new Error(`${label} has an unsupported generated value contract.`);
}
function generatedSecretTemplateSegment(
  value: unknown,
  label: string,
): Extract<ApplicationGeneratedSecretValue, { readonly kind: "template" }>["segments"][number] {
  const segment = requiredObject(value, label);
  if (segment.kind === "literal") {
    return {
      kind: "literal",
      value: requiredString(segment.value, `${label}.value`),
    };
  }
  if (segment.kind === "value") {
    if (segment.transform !== undefined && segment.transform !== "uriComponent") {
      throw new Error(`${label}.transform must be uriComponent.`);
    }
    return {
      kind: "value",
      key: requiredString(segment.key, `${label}.key`),
      ...(segment.transform === "uriComponent" ? { transform: "uriComponent" as const } : {}),
    };
  }
  throw new Error(`${label} has an unsupported generated template segment.`);
}
function requiredSecretType(
  value: unknown,
  label: string,
): NonNullable<ApplicationGeneratedSecretProps["secretType"]> {
  if (value === "Opaque" || value === "kubernetes.io/basic-auth") return value;
  throw new Error(`${label} must be Opaque or kubernetes.io/basic-auth.`);
}

function requiredObject(value: unknown, label: string): DeploymentJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as DeploymentJsonObject;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requiredInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer.`);
  }
  return value;
}

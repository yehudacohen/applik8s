import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
export type ApplicationGeneratedSecretValue =
  | {
      /**
       * Explicit operation-host binding. The environment variable name is
       * portable state; its value is resolved only while the Kubernetes
       * provider reconciles, for development or production installations.
       */
      readonly kind: "hostEnvironment";
      readonly name: string;
    }
  | {
      /** Extract one non-empty string property from a JSON environment value. */
      readonly kind: "hostEnvironmentJson";
      readonly name: string;
      readonly property: string;
    }
  | {
      readonly kind: "random";
      readonly bytes: number;
      readonly encoding: "base64url";
      /** At least 32 base64url characters preserve 192 bits of entropy. */
      readonly characters?: number;
    }
  | {
      readonly kind: "jwkSet";
      readonly algorithm: "RS256";
      readonly modulusLength: 2048 | 3072 | 4096;
      readonly keyId: string;
    }
  | { readonly kind: "publicLiteral"; readonly value: string }
  | {
      readonly kind: "template";
      readonly segments: readonly (
        | { readonly kind: "literal"; readonly value: string }
        | { readonly kind: "value"; readonly key: string; readonly transform?: "uriComponent" }
      )[];
    };
export interface ApplicationGeneratedSecretProps {
  readonly deploymentNodeId: string;
  /** Stable application-installation identity; node ids are graph-local. */
  readonly deploymentOwnerId: string;
  readonly context: string;
  readonly namespace: string;
  readonly name: string;
  readonly secretType?: "Opaque" | "kubernetes.io/basic-auth";
  readonly values: Readonly<Record<string, ApplicationGeneratedSecretValue>>;
  readonly consumers: readonly string[];
  readonly deletionPolicy: "delete" | "retain";
  /** Alchemy dependency handles; values contain no credential material. */
  readonly prerequisites?: readonly unknown[];
}
export interface ApplicationGeneratedSecretAttributes
  extends Pick<
    ApplicationGeneratedSecretProps,
    "deploymentNodeId" | "namespace" | "name"
  > {
  readonly keys: readonly string[];
  readonly ownership: "managed" | "external";
  readonly ready: true;
}
/** Stable label projection; the full graph identity remains in an annotation. */
export function applicationGeneratedSecretDeploymentNodeLabel(deploymentNodeId: string): string {
  const value = deploymentNodeId.trim();
  if (
    value.length <= 63 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value)
  ) {
    return value;
  }
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 12);
  const readable = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 50)
    .replace(/[^a-z0-9]+$/g, "");
  return `${readable || "deployment-node"}-${digest}`;
}
function generatedValue(
  contract: Exclude<ApplicationGeneratedSecretValue, { kind: "template" }>,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  if (contract.kind === "hostEnvironment") {
    const value = environment[contract.name];
    if (!value) {
      throw new Error(
        `Generated Secret requires non-empty operation-host environment variable ${contract.name}.`,
      );
    }
    return value;
  }
  if (contract.kind === "hostEnvironmentJson") {
    const source = environment[contract.name];
    if (!source) {
      throw new Error(
        `Generated Secret requires non-empty operation-host environment variable ${contract.name}.`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new Error(
        `Generated Secret environment variable ${contract.name} must contain a JSON object.`,
      );
    }
    const value = parsed && typeof parsed === "object"
      ? Reflect.get(parsed, contract.property)
      : undefined;
    if (typeof value !== "string" || !value) {
      throw new Error(
        `Generated Secret environment variable ${contract.name} requires non-empty string property ${contract.property}.`,
      );
    }
    return value;
  }
  if (contract.kind === "publicLiteral") return contract.value;
  if (contract.kind === "jwkSet") {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: contract.modulusLength,
      publicExponent: 0x10001,
    });
    const key = {
      ...privateKey.export({ format: "jwk" }),
      alg: contract.algorithm,
      kid: contract.keyId,
      use: "sig",
    };
    return JSON.stringify({ keys: [key] });
  }
  const encoded = randomBytes(contract.bytes).toString(contract.encoding);
  return contract.characters === undefined
    ? encoded
    : encoded.slice(0, contract.characters);
}

/** Pure except for cryptographic generation; exported for contract tests. */
export function materializeApplicationGeneratedSecretValues(
  contracts: Readonly<Record<string, ApplicationGeneratedSecretValue>>,
  environment: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string>> {
  const generated: Record<string, string> = {};
  for (const [key, contract] of Object.entries(contracts)) {
    if (contract.kind !== "template") {
      generated[key] = generatedValue(contract, environment);
    }
  }
  const pending = new Map(
    Object.entries(contracts).filter((entry) => entry[1].kind === "template"),
  );
  while (pending.size > 0) {
    const ready = [...pending].filter(([, contract]) => {
      if (contract.kind !== "template") return false;
      return contract.segments.every(
        (segment) =>
          segment.kind === "literal" || generated[segment.key] !== undefined,
      );
    });
    if (ready.length === 0) {
      throw new Error(
        `Generated Secret templates contain missing or cyclic sibling references: ${[
          ...pending.keys(),
        ].join(", ")}.`,
      );
    }
    for (const [key, contract] of ready) {
      if (contract.kind !== "template") continue;
      generated[key] = contract.segments
        .map((segment) => {
          if (segment.kind === "literal") return segment.value;
          const sibling = generated[segment.key];
          if (sibling === undefined) {
            throw new Error(`Generated Secret template references unresolved sibling ${segment.key}.`);
          }
          return segment.transform === "uriComponent"
            ? encodeURIComponent(sibling)
            : sibling;
        })
        .join("");
      pending.delete(key);
    }
  }
  return generated;
}

export function validateApplicationGeneratedSecretProps(props: ApplicationGeneratedSecretProps): void {
  if (
    [
      props.deploymentNodeId,
      props.deploymentOwnerId,
      props.context,
      props.namespace,
      props.name,
    ].some((value) => !value.trim()) ||
    Object.keys(props.values).length === 0
  ) {
    throw new Error(
      "Generated Secret requires node, owner, context, namespace, name, and value contracts.",
    );
  }
  if (
    props.secretType !== undefined &&
    props.secretType !== "Opaque" &&
    props.secretType !== "kubernetes.io/basic-auth"
  ) {
    throw new Error(
      `Generated Secret ${props.namespace}/${props.name} has unsupported type ${JSON.stringify(props.secretType)}.`,
    );
  }
  for (const [key, contract] of Object.entries(props.values)) {
    validateGeneratedSecretValue(props, key, contract);
  }
  validateTemplateDependencies(props.values);
}

function validateGeneratedSecretValue(props: ApplicationGeneratedSecretProps, key: string, contract: ApplicationGeneratedSecretValue): void {
  const identity = `${props.namespace}/${props.name} key ${key}`;
  if (!key.trim()) throw new Error("Generated Secret keys must not be empty.");
  if (
    contract.kind === "hostEnvironment" &&
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(contract.name)
  ) {
    throw new Error(
      `Generated Secret ${identity} has an invalid host environment binding.`,
    );
  }
  if (
    contract.kind === "hostEnvironmentJson" &&
    (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(contract.name) || !contract.property.trim())
  ) {
    throw new Error(
      `Generated Secret ${identity} has an invalid JSON host environment binding.`,
    );
  }
  if (
    contract.kind === "publicLiteral" &&
    (!contract.value.trim() ||
      /(?:password|passwd|token|private[-_]?key|client[-_]?secret|credential)/i.test(
        key,
      ))
  ) {
    throw new Error(
      `Generated Secret ${identity} cannot persist sensitive or empty literal material; use a random value contract.`,
    );
  }
  if (
    contract.kind === "random" &&
    (!Number.isInteger(contract.bytes) ||
      contract.bytes < 32 ||
      contract.bytes > 4096 ||
      contract.encoding !== "base64url" ||
      (contract.characters !== undefined &&
        (!Number.isInteger(contract.characters) ||
          contract.characters < 32 ||
          contract.characters >
            Math.floor((contract.bytes * 4 + 2) / 3))))
  ) {
    throw new Error(
      `Generated Secret ${identity} has an unsafe random value contract.`,
    );
  }
  if (
    contract.kind === "jwkSet" &&
    (contract.algorithm !== "RS256" ||
      ![2048, 3072, 4096].includes(contract.modulusLength) ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/.test(
        contract.keyId,
      ))
  ) {
    throw new Error(
      `Generated Secret ${identity} has an unsafe JWK Set contract.`,
    );
  }
  if (
    contract.kind === "template" &&
    (contract.segments.length === 0 ||
      contract.segments.some((segment) =>
        segment.kind === "literal"
          ? segment.value.length === 0
          : !segment.key.trim()
            || !Object.hasOwn(props.values, segment.key)
            || (segment.transform !== undefined && segment.transform !== "uriComponent"),
      ))
  ) {
    throw new Error(
      `Generated Secret ${identity} has an invalid template contract.`,
    );
  }
}

function validateTemplateDependencies(values: Readonly<Record<string, ApplicationGeneratedSecretValue>>): void {
  materializeApplicationGeneratedSecretValues(
    Object.fromEntries(
      Object.entries(values).map(([key, contract]) => [
        key,
        contract.kind === "template"
          ? contract
          : contract.kind === "hostEnvironment" || contract.kind === "hostEnvironmentJson"
            ? { kind: "publicLiteral", value: `environment-${key}` }
          : { kind: "publicLiteral", value: `generated-${key}` },
      ]),
    ),
  );
}

// typecast-file-boundary: package manifests are parsed from repository-owned JSON before their narrow maintainability fields are inspected.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const cliPath = "packages/cli/src/cli.ts";
const cli = await readFile(cliPath, "utf8");
const authoringManifest = JSON.parse(
  await readFile("packages/applik8s/package.json", "utf8"),
) as {
  readonly bin?: unknown;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly dependencies?: Readonly<Record<string, string>>;
};
const cliManifest = JSON.parse(
  await readFile("packages/cli/package.json", "utf8"),
) as {
  readonly bin?: Readonly<Record<string, string>>;
};
if (authoringManifest.bin !== undefined) {
  throw new Error(
    "The lightweight authoring package must not own the applik8s executable.",
  );
}
if (authoringManifest.exports?.["./cli"] !== undefined) {
  throw new Error(
    "The authoring package must not restore the broad legacy CLI subpath.",
  );
}
if (cliManifest.bin?.applik8s !== "dist/bin.js") {
  throw new Error("@applik8s/cli must be the sole owner of the applik8s executable.");
}
for (const deploymentOnlyDependency of [
  "@applik8s/compiler",
  "@applik8s/deployment-alchemy",
  "@applik8s/deployment-contract",
  "@applik8s/deployment-provider-oci",
  "@applik8s/deployment-typekro",
  "@aws-sdk/client-s3",
  "@aws-sdk/s3-request-presigner",
  "@hatchet-dev/typescript-sdk",
  "@kubernetes/client-node",
  "@nats-io/jetstream",
  "@nats-io/nats-core",
  "@nats-io/transport-node",
  "nats",
  "postgres",
  "commander",
]) {
  if (authoringManifest.dependencies?.[deploymentOnlyDependency] !== undefined) {
    throw new Error(
      `The authoring package must not depend on deployment-only package ${deploymentOnlyDependency}.`,
    );
  }
}
for (const obsolete of [
  "packages/applik8s/src/bin.ts",
  "packages/applik8s/src/cli.ts",
  "packages/applik8s/src/node-build-runner.mjs",
  "packages/applik8s/src/node-deploy-runner.mjs",
  "packages/applik8s/src/application-deployment-compatibility.ts",
  "packages/applik8s/src/factories/alchemy.ts",
  "packages/applik8s/src/event-log-jetstream-runtime.ts",
  "packages/applik8s/src/model-command-processor-runtime.ts",
  "packages/applik8s/src/kubernetes-api-client.ts",
  "packages/applik8s/src/deployment-legacy-support.ts",
  "packages/applik8s/src/application-provider-preparation.ts",
  "packages/applik8s/src/application-postgres-preparation.ts",
  "packages/applik8s/src/application-valkey-preparation.ts",
  "packages/applik8s/src/container-registry-preparation.ts",
  "packages/applik8s/src/container-deployment-plan.ts",
  "packages/cli/src/application-deployment-compatibility.ts",
  "packages/cli/src/application-kro-provider-migration.ts",
  "packages/cli/src/application-kro-provider-migration-kubernetes.ts",
  "packages/cli/src/application-deployment-receipts.ts",
  "examples/chirp-start/src/schema.ts",
]) {
  if (await stat(obsolete).then(() => true).catch(() => false)) {
    throw new Error(`CLI implementation leaked back into the authoring package: ${obsolete}.`);
  }
}
const commandPrincipalSource = await readFile("packages/applik8s/src/command-principal.ts", "utf8");
if (commandPrincipalSource.includes("applicationCommandContextValues")) {
  throw new Error("Removed request-context compatibility alias returned.");
}
const providerSource = await readFile("packages/applik8s/src/application-providers.ts", "utf8");
const hatchetProvider = functionBody(
  providerSource,
  "export interface ApplicationHatchetWorkflowEngineProvider",
  "export type ApplicationWorkflowEngineProvider",
);
if (hatchetProvider.includes("readonly credentialsSecret?")) {
  throw new Error("Removed Hatchet credentialsSecret compatibility alias returned.");
}
const compilerReactive = await readFile(
  "packages/compiler/src/application-reactive/index.ts",
  "utf8",
);
const compilerWorkflows = await readFile(
  "packages/compiler/src/application-workflows/contracts.ts",
  "utf8",
);
if (
  compilerReactive.includes(
    "const legacy = objectConfig(config.credentialsSecret)",
  ) ||
  compilerWorkflows.includes(
    "const legacyCredentials = objectConfig(config.credentialsSecret)",
  )
) {
  throw new Error(
    "Removed Hatchet credentialsSecret compatibility lowering returned.",
  );
}
if (providerSource.includes("preparationTimeoutMs")) {
  throw new Error("Removed provider-preparation timeout surface returned.");
}
const exposureSource = await readFile(
  "packages/applik8s/src/application-exposure.ts",
  "utf8",
);
const applicationSource = await readFile(
  "packages/applik8s/src/application.ts",
  "utf8",
);
if (
  exposureSource.includes("applicationLegacyTlsMode") ||
  applicationSource.includes("readonly tlsSecretName?") ||
  applicationSource.includes("'required' | 'optional' | 'disabled' | ApplicationTlsIntent")
) {
  throw new Error("Removed pre-intent app.expose TLS compatibility surface returned.");
}
const typeKroProviders = await readFile(
  "packages/deployment-typekro/src/providers.ts",
  "utf8",
);
const deploymentProviders = await readFile(
  "packages/deployment-compiler/src/providers.ts",
  "utf8",
);
for (const obsoletePreparationIdentity of [
  "applik8s-valkey-cluster-preparation",
  "applik8s-postgres-cluster-preparation",
  "ApplicationValkeyClusterPreparation",
  "ApplicationPostgresClusterPreparation",
]) {
  if (
    typeKroProviders.includes(obsoletePreparationIdentity) ||
    deploymentProviders.includes(obsoletePreparationIdentity)
  ) {
    throw new Error(
      `Removed provider-preparation identity returned: ${obsoletePreparationIdentity}.`,
    );
  }
}
const generatedSecretProvider = await readFile(
  "packages/deployment-provider-kubernetes/src/generated-secret.ts",
  "utf8",
);
if (
  generatedSecretProvider.includes("isLegacyManagedSecret") ||
  generatedSecretProvider.includes("applik8s.dev/direct-preparation")
) {
  throw new Error("Removed generated-Secret preparation ownership fallback returned.");
}
const deploymentCommandPath =
  "packages/cli/src/application-deployment-command.ts";
const deploymentCommand = await readFile(deploymentCommandPath, "utf8");
const ordinaryDeploy = functionBody(
  deploymentCommand,
  "export async function runApplicationDeploy(",
  "export async function runApplicationDelete(",
);
for (const forbidden of [
  "prepareApplicationProviderPrerequisites",
  "buildGeneratedImages",
  "materializeGeneratedDeployment",
  ".factory(",
  "kubectl",
]) {
  if (ordinaryDeploy.includes(forbidden)) {
    throw new Error(
      `Ordinary deploy contains legacy orchestration ${JSON.stringify(forbidden)}.`,
    );
  }
}
for (const forbidden of [
  "application-deployment-compatibility",
  "application-kro-provider-migration",
  "application-deployment-receipts",
  "--migrate-kro-owned-provider-data",
  "--confirm-legacy-typekro-node-fetch-manager",
  "--keep-direct-preparation",
]) {
  if (cli.includes(forbidden) || deploymentCommand.includes(forbidden)) {
    throw new Error(`Removed pre-graph lifecycle surface returned: ${forbidden}.`);
  }
}

const budgets = [
  { path: cliPath, maximum: 350, reason: "steady-state CLI router" },
  {
    path: deploymentCommandPath,
    maximum: 450,
    reason: "graph-backed deployment command",
  },
  {
    path: "packages/cli/src/node-build-runner.mjs",
    maximum: 120,
    reason: "compiler-only Node isolation adapter",
  },
  {
    path: "packages/cli/src/node-typescript-loader.mjs",
    maximum: 130,
    reason: "shared workspace TypeScript loader",
  },
  {
    path: "packages/cli/src/application-deployment-observer.ts",
    maximum: 360,
    reason: "read-only deployment observer",
  },
  {
    path: "packages/cli/src/application-deployment-files.ts",
    maximum: 350,
    reason: "deployment artifact selection",
  },
  {
    path: "packages/cli/src/application-deployment-registry.ts",
    maximum: 150,
    reason: "registry discovery",
  },
  {
    path: "packages/deployment-alchemy/src/backend.ts",
    maximum: 550,
    reason: "generic Alchemy coordinator",
  },
  {
    path: "packages/deployment-alchemy/src/artifact-resources.ts",
    maximum: 200,
    reason: "Alchemy OCI artifact materializer",
  },
  {
    path: "packages/deployment-alchemy/src/generated-secrets.ts",
    maximum: 150,
    reason: "Alchemy generated-secret materializer",
  },
  {
    path: "packages/deployment-alchemy/src/harbor-resources.ts",
    maximum: 220,
    reason: "Alchemy Harbor project materializer",
  },
  {
    path: "packages/deployment-alchemy/src/typekro-ordering.ts",
    maximum: 120,
    reason: "Alchemy TypeKro ordering adapter",
  },
  {
    path: "packages/deployment-typekro/src/composition.ts",
    maximum: 725,
    reason: "TypeKro materialized composition assembler",
  },
  {
    path: "packages/deployment-typekro/src/expression-reconstruction.ts",
    maximum: 340,
    reason: "serialized KRO/CEL expression reconstruction",
  },
  {
    path: "packages/deployment-provider-harbor/src",
    maximum: 300,
    reason: "Harbor effect adapter",
  },
  {
    path: "packages/deployment-provider-kubernetes/src",
    maximum: 320,
    reason: "Kubernetes effect adapter",
  },
  {
    path: "packages/deployment-provider-oci/src",
    maximum: 450,
    reason: "OCI effect adapter",
  },
];

for (const budget of budgets) {
  const lines = await sourceLines(budget.path);
  if (lines > budget.maximum) {
    throw new Error(
      `${budget.reason} is ${lines} lines, exceeding its ${budget.maximum}-line ratchet at ${budget.path}.`,
    );
  }
}
if (lineCount(ordinaryDeploy) > 190) {
  throw new Error(
    `Ordinary deploy is ${lineCount(ordinaryDeploy)} lines; keep it below the 190-line orchestration budget.`,
  );
}

console.log(
  "Deployment maintainability: the CLI is thin, pre-graph lifecycle code is absent, ordinary deployment has no provider engine, and package/LOC ratchets passed.",
);

function functionBody(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Cannot locate maintainability slice ${start} -> ${end}.`);
  }
  return source.slice(startIndex, endIndex);
}

async function sourceLines(path: string): Promise<number> {
  const metadata = await stat(path);
  if (metadata.isFile()) return lineCount(await readFile(path, "utf8"));
  const entries = await readdir(path, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      total += await sourceLines(join(path, entry.name));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      total += lineCount(await readFile(join(path, entry.name), "utf8"));
    }
  }
  return total;
}

function lineCount(source: string): number {
  return source.length === 0 ? 0 : source.split("\n").length;
}

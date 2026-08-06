import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type } from "arktype";
import { createResource, kubernetesComposition, singleton } from "typekro";
import {
  ARTIFACT_PLAN_VERSION,
  SEMANTIC_PLAN_VERSION,
  artifactOutput,
  decodeKroArtifactBundle,
} from "typekro/experimental/planning";

const root = process.cwd();
const expected = {
  typekro: "0.33.5",
  alchemy: "2.0.0-beta.58",
  effect: "4.0.0-beta.84",
  semanticPlan: 1,
  artifactPlan: 1,
};

await assertPinnedDependencyCohort();
await assertRequiredExportSurface();
await assertPlanningAndAlchemyMaterialization();
await assertSingletonSchedulingParity();

console.log(
  [
    "TypeKro provider qualification passed.",
    `- TypeKro ${expected.typekro}`,
    `- semantic/artifact plans ${expected.semanticPlan}/${expected.artifactPlan}`,
    `- Alchemy ${expected.alchemy}`,
    `- Effect ${expected.effect}`,
    "- direct and KRO declarations preserve one typed artifact output",
    "- KRO uses the stable nested artifact-binding map",
    "- direct singleton prerequisites preserve canonical artifact dependencies",
  ].join("\n"),
);

async function assertPinnedDependencyCohort() {
  const packagePins = [
    ["package.json", "dependencies", "typekro", expected.typekro],
    ["packages/applik8s/package.json", "dependencies", "typekro", expected.typekro],
    ["packages/cli/package.json", "dependencies", "typekro", expected.typekro],
    [
      "packages/deployment-typekro/package.json",
      "dependencies",
      "typekro",
      expected.typekro,
    ],
    [
      "packages/deployment-alchemy/package.json",
      "dependencies",
      "typekro",
      expected.typekro,
    ],
    [
      "packages/deployment-alchemy/package.json",
      "dependencies",
      "alchemy",
      expected.alchemy,
    ],
    [
      "packages/deployment-alchemy/package.json",
      "dependencies",
      "effect",
      expected.effect,
    ],
  ];
  for (const [path, section, dependency, version] of packagePins) {
    const manifest = await readJson(path);
    assertEqual(
      manifest[section]?.[dependency],
      version,
      `${path} must pin ${dependency}`,
    );
  }

  const typeKroManifest = await readJson("node_modules/typekro/package.json");
  const alchemyManifest = await readJson(
    "packages/deployment-alchemy/node_modules/alchemy/package.json",
  );
  const effectManifest = await readJson(
    "packages/deployment-alchemy/node_modules/effect/package.json",
  );
  assertEqual(typeKroManifest.version, expected.typekro, "installed TypeKro");
  assertEqual(alchemyManifest.version, expected.alchemy, "installed Alchemy");
  assertEqual(effectManifest.version, expected.effect, "installed Effect");
  assertEqual(
    typeKroManifest.dependencies?.alchemy,
    expected.alchemy,
    "TypeKro Alchemy cohort",
  );
  assertEqual(
    typeKroManifest.dependencies?.effect,
    expected.effect,
    "TypeKro Effect cohort",
  );
  assertEqual(
    SEMANTIC_PLAN_VERSION,
    expected.semanticPlan,
    "TypeKro semantic plan version",
  );
  assertEqual(
    ARTIFACT_PLAN_VERSION,
    expected.artifactPlan,
    "TypeKro artifact plan version",
  );
}

async function assertRequiredExportSurface() {
  const required = new Map([
    [
      "typekro",
      [
        "createResource",
        "getCurrentCompositionContext",
        "kubernetesComposition",
      ],
    ],
    [
      "typekro/advanced",
      ["createSchemaProxy", "registerPortableReadinessEvaluator"],
    ],
    [
      "typekro/alchemy",
      ["KroResource", "kroProvider", "materializeAlchemyResources"],
    ],
    [
      "typekro/experimental/planning",
      ["artifactOutput", "decodeKroArtifactBundle", "lowerPlanValue"],
    ],
    ["typekro/containers", ["buildContainer", "harbor", "ociRegistry"]],
    ["typekro/cnpg", ["cluster", "ClusterConfigSchema"]],
    ["typekro/envoy-ai-gateway", ["makeEnvoyAIGateway"]],
    [
      "typekro/kubernetes",
      ["customResourceDefinition", "namespace"],
    ],
    [
      "typekro/opensearch",
      ["makeOpenSearchCluster", "makeOpenSearchOperatorBootstrap"],
    ],
    ["typekro/ory", ["oryIdentityStack", "oryPlatformStack"]],
    ["typekro/rook", ["rookObjectStorageClaim"]],
    ["typekro/valkey", ["valkey", "valkeyBootstrap", "ValkeyConfigSchema"]],
    [
      "typekro/harbor",
      ["HarborApiClient", "reconcileHarborProject", "deleteHarborProject"],
    ],
  ]);

  for (const [specifier, names] of required) {
    // static-import-exception: the qualification intentionally probes a table of installed public package entrypoints.
    const module = await import(specifier);
    for (const name of names) {
      if (!(name in module)) {
        throw new Error(
          `TypeKro ${expected.typekro} qualification requires ${specifier} to export ${name}.`,
        );
      }
    }
  }
}

async function assertPlanningAndAlchemyMaterialization() {
  const Spec = type({ name: "string" });
  const Status = type({ ready: "boolean" });
  const composition = kubernetesComposition(
    {
      name: "applik8s-typekro-qualification",
      apiVersion: "qualification.applik8s.dev/v1alpha1",
      kind: "Applik8sTypeKroQualification",
      spec: Spec,
      status: Status,
    },
    (spec) => {
      createResource({
        id: "qualifiedConfig",
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: spec.name },
        data: {
          image: artifactOutput("artifact.web", "immutableReference"),
        },
      });
      return { ready: true };
    },
  );
  const planning = {
    strict: true,
    inputs: {
      "artifact.web": {
        kind: "artifact",
        requirement: {
          id: "artifact.web",
          kind: "container-image",
          descriptor: { purpose: "typekro-qualification" },
          outputs: ["immutableReference"],
        },
      },
    },
  };
  const inspection = composition.inspect();
  const plan = composition.plan({ name: "qualified" }, planning);
  assertEqual(inspection.version, 1, "composition inspection version");
  assertEqual(plan.version, 1, "desired-state plan version");
  assertNoErrorDiagnostics(inspection.diagnostics, "composition inspection");
  assertNoErrorDiagnostics(plan.diagnostics, "desired-state plan");

  const declarationsByMode = new Map();
  for (const mode of ["direct", "kro"]) {
    const factory = composition.factory(mode, {
      namespace: "typekro-qualification",
      waitForReady: false,
      plan: planning,
    });
    try {
      const declarations = await factory.toAlchemyResources(
        { name: "qualified" },
        { instanceNameOverride: "qualified" },
      );
      if (declarations.length === 0) {
        throw new Error(`${mode} materialization emitted no Alchemy declarations.`);
      }
      declarationsByMode.set(mode, declarations);
    } finally {
      await factory.dispose?.();
    }
  }

  const direct = declarationsByMode.get("direct");
  const directUses = direct.flatMap(
    (declaration) => declaration.artifactOutputUses ?? [],
  );
  assertArtifactUse(directUses, "direct");
  const directRecord = direct.find(
    (declaration) =>
      typeof declaration.props?.artifactExecutionRecord === "string",
  )?.props.artifactExecutionRecord;
  if (
    typeof directRecord !== "string" ||
    !directRecord.includes('"kind":"artifact-output"')
  ) {
    throw new Error(
      "Direct TypeKro declaration did not retain the artifact output in its execution record.",
    );
  }

  const kro = declarationsByMode.get("kro");
  const resourceGraph = kro.find(
    (declaration) =>
      declaration.props?.resource?.kind === "ResourceGraphDefinition",
  );
  const instance = kro.find(
    (declaration) =>
      declaration.props?.resource?.kind === "Applik8sTypeKroQualification",
  );
  if (!resourceGraph || !instance) {
    throw new Error(
      "KRO materialization must emit one ResourceGraphDefinition and one instance.",
    );
  }
  if (!instance.dependsOn.includes(resourceGraph.id)) {
    throw new Error("KRO instance must depend on its ResourceGraphDefinition.");
  }
  const bindingSchema =
    resourceGraph.props.resource.spec?.schema?.spec?.typekroArtifactBindings;
  assertEqual(
    bindingSchema,
    "map[string]map[string]string",
    "stable KRO artifact-binding schema",
  );
  const bundleSource = resourceGraph.props.kroArtifactBundle;
  if (typeof bundleSource !== "string") {
    throw new Error("KRO ResourceGraphDefinition is missing its artifact bundle.");
  }
  const bundle = decodeKroArtifactBundle(bundleSource);
  assertArtifactUse(
    bundle.artifactRequirements.flatMap((requirement) =>
      requirement.outputs.map((output) => ({
        requirementId: requirement.id,
        output,
      })),
    ),
    "KRO",
  );
}

async function assertSingletonSchedulingParity() {
  const Spec = type({ name: "string" });
  const Status = type({ ready: "boolean" });
  const owner = kubernetesComposition(
    {
      name: "applik8s-typekro-qualification-owner",
      apiVersion: "qualification.applik8s.dev/v1alpha1",
      kind: "Applik8sTypeKroQualificationOwner",
      spec: Spec,
      status: Status,
    },
    () => {
      createResource({
        id: "ownerConfig",
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "applik8s-typekro-qualification-owner" },
      });
      return { ready: true };
    },
  );
  const consumer = kubernetesComposition(
    {
      name: "applik8s-typekro-singleton-qualification",
      apiVersion: "qualification.applik8s.dev/v1alpha1",
      kind: "Applik8sTypeKroSingletonQualification",
      spec: Spec,
      status: Status,
    },
    (spec) => {
      singleton(owner, {
        id: "qualification-owner",
        spec: { name: "owner" },
      });
      createResource({
        id: "consumerConfig",
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: spec.name },
      });
      return { ready: true };
    },
  );
  const factory = consumer.factory("direct", {
    namespace: "typekro-qualification",
    waitForReady: false,
  });
  try {
    const declarations = await factory.toAlchemyResources({
      name: "qualified",
    });
    const byId = new Map(
      declarations.map((declaration) => [declaration.id, declaration]),
    );
    for (const declaration of declarations) {
      const encoded = declaration.props?.artifactExecutionRecord;
      if (typeof encoded !== "string") continue;
      const record = JSON.parse(encoded);
      const expectedDependencies = [...(record.dependencies ?? [])].sort();
      const suppliedDependencies = declaration.dependsOn
        .map((id) => byId.get(id)?.props?.resourceId)
        .filter((id) => typeof id === "string")
        .sort();
      if (
        JSON.stringify(suppliedDependencies)
        !== JSON.stringify(expectedDependencies)
      ) {
        throw new Error(
          `TypeKro direct singleton scheduling corrupts canonical dependencies for ${declaration.props?.resourceId}: `
          + `artifact record expects [${expectedDependencies.join(", ")}], `
          + `Alchemy declaration supplies [${suppliedDependencies.join(", ")}].`,
        );
      }
    }
  } finally {
    await factory.dispose?.();
  }
}

function assertArtifactUse(uses, label) {
  if (
    !uses.some(
      (use) =>
        use.requirementId === "artifact.web" &&
        use.output === "immutableReference",
    )
  ) {
    throw new Error(
      `${label} materialization lost artifact.web.immutableReference.`,
    );
  }
}

function assertNoErrorDiagnostics(diagnostics, label) {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `${label} produced TypeKro errors:\n${errors
        .map((diagnostic) => `- [${diagnostic.code}] ${diagnostic.message}`)
        .join("\n")}`,
    );
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

function assertEqual(actual, expectedValue, label) {
  if (actual !== expectedValue) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expectedValue)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

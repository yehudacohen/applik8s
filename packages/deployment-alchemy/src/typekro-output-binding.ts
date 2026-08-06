// typecast-file-boundary: Alchemy Output values are decoded at this adapter boundary.
import type { ApplicationDeploymentGraph } from "@applik8s/deployment-contract";
import type { AdaptedTypeKroDeployment } from "@applik8s/deployment-typekro";
import * as Output from "alchemy/Output";
import type { AlchemyArtifactBinding } from "typekro/alchemy";
import {
  collectArtifactOutputUses,
  materializePlanOutputs,
  materializePlanValue,
  type PlanValue,
} from "typekro/experimental/planning";

export function typeKroCompositionOutputBinding(
  graph: ApplicationDeploymentGraph,
  group: AdaptedTypeKroDeployment["direct"][number],
  resources: Readonly<Record<string, unknown>>,
  bindings: Readonly<Record<string, AlchemyArtifactBinding>>,
): AlchemyArtifactBinding | undefined {
  const outputNames = [
    ...new Set(
      graph.edges
        .filter(
          (edge) =>
            edge.relationship === "requiresOutput" &&
            edge.from === group.deploymentNodeId &&
            edge.output,
        )
        .map((edge) => edge.output as string),
    ),
  ].sort();
  if (outputNames.length === 0) return undefined;

  const outputs = Object.fromEntries(
    outputNames.map((name) => {
      const value = group.outputs[name];
      if (!value) {
        throw new Error(
          `TypeKro composition ${group.deploymentNodeId} does not declare required output ${name}.`,
        );
      }
      return [name, value];
    }),
  );
  const handles = Object.values(resources);
  const representative = handles.at(-1);
  if (!representative) {
    throw new Error(
      `TypeKro composition ${group.deploymentNodeId} cannot publish outputs without a materialized resource.`,
    );
  }

  const artifactUses = uniqueArtifactOutputUses([
    group.spec,
    ...Object.values(outputs),
  ]);
  const artifactInputs: Array<{
    readonly requirementId: string;
    readonly output: string;
  }> = [];
  const inputExpressions: ReturnType<typeof Output.asOutput>[] = handles.map(
    (resource) =>
      Output.of(
        resource as AlchemyArtifactBinding["resource"],
      ) as ReturnType<typeof Output.asOutput>,
  );
  for (const use of artifactUses) {
    const binding = bindings[use.requirementId];
    if (!binding || !Object.hasOwn(binding.outputs, use.output)) {
      throw new Error(
        `TypeKro composition output ${group.deploymentNodeId} requires unsupplied artifact ${use.requirementId}.${use.output}.`,
      );
    }
    inputExpressions.push(
      Output.of(binding.resource) as ReturnType<typeof Output.asOutput>,
    );
    inputExpressions.push(Output.asOutput(binding.outputs[use.output]));
    artifactInputs.push({
      requirementId: use.requirementId,
      output: use.output,
    });
  }

  const hydrated = Output.map(Output.all(...inputExpressions), (resolved) => {
    const values = resolved as readonly unknown[];
    const liveResources: Record<string, unknown> = {};
    handles.forEach((_handle, index) => {
      const resource = values[index] as
        | {
            readonly resourceId?: string;
            readonly deployedResource?: unknown;
          }
        | undefined;
      if (resource?.resourceId && resource.deployedResource) {
        liveResources[resource.resourceId] = resource.deployedResource;
      }
    });
    const artifactOutputs: Record<string, Record<string, unknown>> = {};
    let cursor = handles.length;
    for (const input of artifactInputs) {
      // Each artifact contributes a dependency handle followed by the output.
      cursor += 1;
      const value = values[cursor];
      cursor += 1;
      const requirement = artifactOutputs[input.requirementId] ?? {};
      requirement[input.output] = value;
      artifactOutputs[input.requirementId] = requirement;
    }
    const needsSpec = Object.values(outputs).some(planValueReferencesSpec);
    const spec = needsSpec
      ? materializePlanValue(group.spec, {
          ...(Object.keys(artifactOutputs).length > 0
            ? { artifactOutputs }
            : {}),
        })
      : undefined;
    return materializePlanOutputs(outputs, {
      ...(spec !== undefined ? { spec } : {}),
      resources: liveResources,
      ...(Object.keys(artifactOutputs).length > 0
        ? { artifactOutputs }
        : {}),
    });
  });

  return {
    // The hydrated Output itself carries every resource/provider dependency.
    // A representative ResourceLike satisfies TypeKro's artifact-binding
    // contract and provides a stable owner for the dependency edge.
    resource: representative as AlchemyArtifactBinding["resource"],
    outputs: Object.fromEntries(
      outputNames.map((name) => [
        name,
        Output.map(hydrated, (values) => values[name]),
      ]),
    ),
  };
}

function uniqueArtifactOutputUses(values: readonly PlanValue[]) {
  const uses = new Map<
    string,
    ReturnType<typeof collectArtifactOutputUses>[number]
  >();
  for (const value of values) {
    for (const use of collectArtifactOutputUses(value)) {
      uses.set(`${use.requirementId}\u0000${use.output}`, use);
    }
  }
  return [...uses.values()].sort((left, right) =>
    `${left.requirementId}\u0000${left.output}`.localeCompare(
      `${right.requirementId}\u0000${right.output}`,
    ),
  );
}

function planValueReferencesSpec(value: PlanValue): boolean {
  switch (value.kind) {
    case "reference":
      return value.source === "spec";
    case "expression":
      return value.expression.references.some(
        (reference) => reference.source === "spec",
      );
    case "template":
      return value.segments.some((segment) =>
        segment.kind === "reference"
          ? segment.source === "spec"
          : segment.kind === "expression"
            ? segment.expression.references.some(
                (reference) => reference.source === "spec",
              )
            : false,
      );
    case "array":
      return value.items.some(planValueReferencesSpec);
    case "object":
      return value.entries.some((entry) =>
        planValueReferencesSpec(entry.value),
      );
    case "sensitive-value":
      return planValueReferencesSpec(value.value);
    default:
      return false;
  }
}

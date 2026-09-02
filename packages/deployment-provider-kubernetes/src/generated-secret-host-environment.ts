import type { V1Secret } from "@kubernetes/client-node";
import {
  type ApplicationGeneratedSecretProps,
  materializeApplicationGeneratedSecretValues,
} from "./generated-secret-contract.js";

export function hostEnvironmentSecretDrifted(
  existing: V1Secret,
  props: ApplicationGeneratedSecretProps,
): boolean {
  const desired = hostEnvironmentSecretData(props);
  return Object.entries(desired).some(
    ([key, value]) => existing.data?.[key] !== value,
  );
}

export function hostEnvironmentSecretData(
  props: ApplicationGeneratedSecretProps,
): Readonly<Record<string, string>> {
  const bindings = Object.fromEntries(
    Object.entries(props.values).filter(
      (entry): entry is [
        string,
        Extract<
          ApplicationGeneratedSecretProps["values"][string],
          { readonly kind: "hostEnvironment" | "hostEnvironmentJson" }
        >,
      ] => entry[1].kind === "hostEnvironment" || entry[1].kind === "hostEnvironmentJson",
    ),
  );
  if (Object.keys(bindings).length === 0) return {};
  if (
    Object.values(bindings).some(
      (binding) => !process.env[binding.name]?.trim(),
    )
  ) {
    // Existing managed Secrets remain observable without their original
    // operation-host source. A complete environment explicitly rotates them.
    return {};
  }
  const allValuesAreReproducible = Object.values(props.values).every((value) =>
    value.kind === "hostEnvironment"
    || value.kind === "hostEnvironmentJson"
    || value.kind === "publicLiteral"
    || value.kind === "template");
  const values = materializeApplicationGeneratedSecretValues(
    allValuesAreReproducible ? props.values : bindings,
    process.env,
  );
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      Buffer.from(value, "utf8").toString("base64"),
    ]),
  );
}

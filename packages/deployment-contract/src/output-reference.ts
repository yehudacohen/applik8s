const prefix = "applik8s.deployment-output/v1:";
const optionalPrefix = "applik8s.deployment-output-optional/v1:";

export interface ApplicationDeploymentOutputReference {
  readonly nodeId: string;
  readonly output: string;
  readonly optional: boolean;
}

/**
 * Portable compiler placeholder for a value produced by another deployment
 * graph node. The TypeKro/Alchemy adapter lowers this into artifactOutput()
 * only when a matching requiresOutput edge exists.
 */
export function applicationDeploymentOutputReference(
  nodeId: string,
  output: string,
): string {
  if (!nodeId.trim() || !output.trim()) {
    throw new Error("Deployment output references require nodeId and output.");
  }
  return `${prefix}${encodeURIComponent(nodeId)}:${encodeURIComponent(output)}`;
}

export function applicationOptionalDeploymentOutputReference(
  nodeId: string,
  output: string,
): string {
  if (!nodeId.trim() || !output.trim()) {
    throw new Error("Deployment output references require nodeId and output.");
  }
  return `${optionalPrefix}${encodeURIComponent(nodeId)}:${encodeURIComponent(output)}`;
}

export function parseApplicationDeploymentOutputReference(
  value: string,
): ApplicationDeploymentOutputReference | undefined {
  const optional = value.startsWith(optionalPrefix);
  if (!optional && !value.startsWith(prefix)) return undefined;
  const encoded = value.slice(
    optional ? optionalPrefix.length : prefix.length,
  );
  const separator = encoded.indexOf(":");
  if (separator < 1 || separator === encoded.length - 1) {
    throw new Error(`Malformed deployment output reference ${value}.`);
  }
  const nodeId = decodeURIComponent(encoded.slice(0, separator));
  const output = decodeURIComponent(encoded.slice(separator + 1));
  if (!nodeId.trim() || !output.trim()) {
    throw new Error(`Malformed deployment output reference ${value}.`);
  }
  return { nodeId, output, optional };
}

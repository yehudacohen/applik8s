import {
  type ApplicationDeploymentIdentity,
  type ApplicationDeploymentStrategy,
  digestApplicationDeploymentValue,
} from "@applik8s/deployment-contract";

export interface ApplicationAlchemyStackIdentity {
  readonly key: string;
  readonly digest: string;
  readonly canonical: string;
  readonly identity: ApplicationDeploymentIdentity;
  readonly strategy: ApplicationDeploymentStrategy;
}

export function applicationAlchemyStackIdentity(
  identity: ApplicationDeploymentIdentity,
  strategy: ApplicationDeploymentStrategy,
): ApplicationAlchemyStackIdentity {
  const fields = [
    identity.connection.provider,
    identity.connection.cluster,
    identity.connection.digest,
    identity.application,
    identity.controlPlaneNamespace,
    identity.instance,
    identity.profile,
  ];
  if (fields.some((field) => !field.trim())) {
    throw new Error("Alchemy Stack identity fields must be non-empty.");
  }
  const canonical = fields
    .map((field) => `${new TextEncoder().encode(field).length}:${field}`)
    .join("|");
  const digest = digestApplicationDeploymentValue({ canonical });
  const safeApplication = identity.application
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  const key = `applik8s-${safeApplication || "application"}-${digest.slice(7, 31)}`;
  return { key, digest, canonical, identity, strategy };
}

export function sameApplicationAlchemyStackIdentity(
  left: ApplicationAlchemyStackIdentity,
  right: ApplicationAlchemyStackIdentity,
): boolean {
  return (
    left.key === right.key &&
    left.digest === right.digest &&
    left.canonical === right.canonical &&
    left.strategy === right.strategy
  );
}

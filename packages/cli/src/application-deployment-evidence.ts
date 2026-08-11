import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JsonObject } from '@applik8s/core';
import {
  digestApplicationDeploymentGraph,
  type ApplicationDeploymentGraph,
} from '@applik8s/deployment-contract';
import {
  applicationDeploymentEvidenceDigest,
  createApplicationDeploymentEvidenceReceipt,
  type ApplicationDeploymentEvidenceReceipt,
  type ApplicationDeploymentReceiptAction,
} from '@applik8s/operations';
import { publishApplicationDeploymentReceipt } from './application-operator-authority-command.js';

/**
 * Records bounded, non-authoritative evidence about one exact deployment
 * graph. The receipt can inform Launchpad, but never participates in planning,
 * ownership, retry, adoption, update, or deletion decisions.
 */
export async function recordApplicationDeploymentEvidence(input: {
  readonly graph: ApplicationDeploymentGraph;
  readonly action: ApplicationDeploymentReceiptAction;
  readonly state: ApplicationDeploymentEvidenceReceipt['state'];
  readonly evidence: JsonObject;
  readonly outDir: string;
  readonly cwd: string;
  stdout(message: string): void;
  readonly now?: Date;
}): Promise<ApplicationDeploymentEvidenceReceipt> {
  const now = input.now ?? new Date();
  const graphDigest = digestApplicationDeploymentGraph(input.graph);
  const artifactSetDigest = applicationDeploymentEvidenceDigest(
    input.graph.nodes
      .filter((node) => node.kind === 'artifact')
      .map((node) => ({
        id: node.id,
        configurationDigest: node.configurationDigest,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
  const receipt = createApplicationDeploymentEvidenceReceipt({
    id: `${input.action}:${input.graph.metadata.identity.application}:${now.toISOString()}`,
    action: input.action,
    state: input.state,
    sourceGraphDigest: input.graph.metadata.sourceGraphDigest,
    deploymentGraphDigest: graphDigest,
    artifactSetDigest,
    installation: {
      application: input.graph.metadata.identity.application,
      namespace: input.graph.metadata.identity.controlPlaneNamespace,
      name: input.graph.metadata.identity.instance,
      profile: input.graph.metadata.identity.profile,
    },
    cluster: {
      provider: input.graph.metadata.identity.connection.provider,
      identity: input.graph.metadata.identity.connection.cluster,
      digest: input.graph.metadata.identity.connection.digest,
    },
    observedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 4 * 60 * 60_000).toISOString(),
    evidence: input.evidence,
  });
  const directory = join(input.cwd, input.outDir, 'typekro', 'evidence');
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${input.action}.json`);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'w',
    mode: 0o600,
  });
  await rename(temporary, path);
  const published = await publishApplicationDeploymentReceipt(
    receipt,
    input.outDir,
    { cwd: input.cwd, stdout: input.stdout },
  );
  input.stdout(
    published
      ? `Launchpad evidence: ${input.action} observation published through canonical application authority.`
      : `Launchpad evidence: ${input.action} observation written to ${path}; set the compiled application database environment to publish it.`,
  );
  return receipt;
}

interface ApplicationEvidenceIo {
  readonly outDir: string;
  readonly cwd: string;
  stdout(message: string): void;
}

export function recordApplicationPlanEvidence(input: ApplicationEvidenceIo & {
  readonly graph: ApplicationDeploymentGraph;
  readonly resourceCount: number;
  readonly pendingChangeCount: number;
  readonly declarationCount: number;
}): Promise<ApplicationDeploymentEvidenceReceipt> {
  return recordApplicationDeploymentEvidence({
    ...input,
    action: 'plan',
    state: input.pendingChangeCount === 0 ? 'ready' : 'action-required',
    evidence: {
      resourceCount: input.resourceCount,
      pendingChangeCount: input.pendingChangeCount,
      declarationCount: input.declarationCount,
      strategy: input.graph.metadata.strategy,
    },
  });
}

export function recordApplicationDeployEvidence(input: ApplicationEvidenceIo & {
  readonly graph: ApplicationDeploymentGraph;
  readonly resourceCount: number;
  readonly appliedArtifactCount: number;
  readonly declarationCount: number;
  readonly instanceState: string;
  readonly endpointObserved: boolean;
}): Promise<ApplicationDeploymentEvidenceReceipt> {
  return recordApplicationDeploymentEvidence({
    ...input,
    action: 'deploy',
    state: 'ready',
    evidence: {
      resourceCount: input.resourceCount,
      appliedArtifactCount: input.appliedArtifactCount,
      declarationCount: input.declarationCount,
      instanceState: input.instanceState,
      endpointObserved: input.endpointObserved,
    },
  });
}

export function recordApplicationStatusEvidence(input: ApplicationEvidenceIo & {
  readonly graph: ApplicationDeploymentGraph;
  readonly state: ApplicationDeploymentEvidenceReceipt['state'];
  readonly instanceState: string;
  readonly definitionState: string;
  readonly resourceCount: number;
  readonly pendingChangeCount: number;
  readonly declarationCount: number;
}): Promise<ApplicationDeploymentEvidenceReceipt> {
  return recordApplicationDeploymentEvidence({
    ...input,
    action: 'status',
    evidence: {
      instanceState: input.instanceState,
      definitionState: input.definitionState,
      resourceCount: input.resourceCount,
      pendingChangeCount: input.pendingChangeCount,
      declarationCount: input.declarationCount,
    },
  });
}

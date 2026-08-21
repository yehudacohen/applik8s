import type { DeploymentJsonObject } from './types.js';
import { sha256Hex } from './serialization.js';
import {
  applicationRuntimeArtifactId,
  validateApplicationRuntimeArtifact,
  type ApplicationRuntimeArtifact,
} from './runtime-artifact.js';

export interface ApplicationAwsDeploymentPlan {
  readonly apiVersion: 'applik8s.awsPlan/v1alpha1';
  readonly application: string;
  readonly environment: string;
  readonly region: string;
  readonly accountId?: string;
  readonly lifecycleAuthority: 'alchemy';
  readonly resources: readonly ApplicationAwsPlanResource[];
  readonly runtimeArtifacts: readonly ApplicationRuntimeArtifact[];
  readonly runtimeBindings: readonly ApplicationAwsRuntimeBinding[];
  readonly edges: readonly ApplicationAwsPlanEdge[];
  readonly diagnostics: readonly ApplicationAwsPlanDiagnostic[];
  readonly digest: `sha256:${string}`;
}

export interface ApplicationAwsRuntimeBinding {
  readonly id: string;
  readonly kind: 'postgresUrl';
  readonly environmentName: string;
  readonly resourceId: string;
  readonly database: string;
  readonly sensitivity: 'sensitive';
}

export type ApplicationAwsService =
  | 'acm'
  | 'athena'
  | 'cloudwatch'
  | 'dynamodb'
  | 'ec2'
  | 'ecr'
  | 'ecs'
  | 'elasticache'
  | 'elastic-load-balancing'
  | 'eventbridge-scheduler'
  | 'efs'
  | 'glue'
  | 'iam'
  | 'kinesis'
  | 'rds'
  | 'route53'
  | 's3'
  | 'service-discovery'
  | 'secrets-manager'
  | 'sqs';

export interface ApplicationAwsPlanResource {
  readonly id: string;
  readonly service: ApplicationAwsService;
  readonly resourceType: string;
  readonly semanticNodeId?: string;
  readonly physicalName: string;
  readonly lifecycle: {
    readonly ownership: 'application' | 'shared' | 'external';
    readonly deletion: 'delete' | 'retain' | 'none';
    readonly adoption: 'createOnly' | 'createOrAdoptExact' | 'externalOnly';
  };
  readonly network: 'public' | 'private' | 'control-plane' | 'none';
  readonly configuration: DeploymentJsonObject;
  readonly outputs: readonly {
    readonly name: string;
    readonly sensitivity: 'public' | 'sensitive';
    readonly persistence: 'state' | 'reference' | 'redacted' | 'ephemeral';
  }[];
  readonly provenance: { readonly graphNodeId?: string; readonly source?: string };
}

export interface ApplicationAwsPlanEdge {
  readonly from: string;
  readonly to: string;
  readonly relationship: 'requiresReady' | 'requiresOutput' | 'networkAccess' | 'assumesRole' | 'publishes';
  readonly output?: string;
}

export interface ApplicationAwsPlanDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code:
    | 'AWS_PROVIDER_INCOMPATIBLE'
    | 'AWS_CONFIGURATION_UNRESOLVED'
    | 'AWS_RUNTIME_ACCESS_UNRESOLVED'
    | 'AWS_COST_BOUND_EXCEEDED'
    | 'AWS_SENSITIVE_DATA';
  readonly message: string;
  readonly subjectId?: string;
}

export function normalizeApplicationAwsDeploymentPlan(plan: ApplicationAwsDeploymentPlan): ApplicationAwsDeploymentPlan {
  const resources = [...plan.resources].sort((left, right) => left.id.localeCompare(right.id));
  const runtimeBindings = [...plan.runtimeBindings].sort((left, right) => left.id.localeCompare(right.id));
  const runtimeArtifacts = [...plan.runtimeArtifacts]
    .map((artifact) => ({
      ...artifact,
      ...(artifact.container ? { container: { ...artifact.container, command: [...artifact.container.command] } } : {}),
    }))
    .sort((left, right) => applicationRuntimeArtifactId(left).localeCompare(applicationRuntimeArtifactId(right)));
  const edges = [...plan.edges].sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  const diagnostics = [...plan.diagnostics].sort((left, right) => left.code.localeCompare(right.code) || (left.subjectId ?? '').localeCompare(right.subjectId ?? ''));
  const content = { ...plan, resources, runtimeArtifacts, runtimeBindings, edges, diagnostics, digest: undefined };
  return { ...plan, resources, runtimeArtifacts, runtimeBindings, edges, diagnostics, digest: sha256(stableJson(content)) };
}

export function validateApplicationAwsDeploymentPlan(plan: ApplicationAwsDeploymentPlan): readonly ApplicationAwsPlanDiagnostic[] {
  const diagnostics: ApplicationAwsPlanDiagnostic[] = [...plan.diagnostics];
  const resources = new Map<string, ApplicationAwsPlanResource>();
  for (const resource of plan.resources) {
    if (!resource.id || resources.has(resource.id)) diagnostics.push({ severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', message: `AWS resource identity ${resource.id || '<empty>'} is empty or duplicated.`, subjectId: resource.id });
    resources.set(resource.id, resource);
    if (!resource.physicalName || resource.physicalName.length > 255) diagnostics.push({ severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', message: `AWS resource ${resource.id} has an invalid physical name.`, subjectId: resource.id });
    if (resource.lifecycle.ownership === 'external' && (resource.lifecycle.deletion !== 'none' || resource.lifecycle.adoption !== 'externalOnly')) diagnostics.push({ severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', message: `External AWS resource ${resource.id} cannot be adopted or deleted.`, subjectId: resource.id });
  }
  for (const edge of plan.edges) {
    if (!resources.has(edge.from) || !resources.has(edge.to) || edge.from === edge.to) diagnostics.push({ severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', message: `AWS edge ${edge.from} ${edge.relationship} ${edge.to} is invalid.` });
    if (edge.relationship === 'requiresOutput' && !edge.output) diagnostics.push({ severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', message: `AWS output edge ${edge.from} -> ${edge.to} does not name an output.` });
  }
  const bindingIds = new Set<string>();
  const bindingEnvironments = new Set<string>();
  for (const binding of plan.runtimeBindings) {
    if (!binding.id || bindingIds.has(binding.id)) diagnostics.push({ severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', message: `AWS runtime binding ${binding.id || '<empty>'} is empty or duplicated.`, subjectId: binding.id });
    bindingIds.add(binding.id);
    if (!/^[A-Z_][A-Z0-9_]*$/u.test(binding.environmentName) || bindingEnvironments.has(binding.environmentName)) diagnostics.push({ severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', message: `AWS runtime binding environment ${binding.environmentName} is invalid or duplicated.`, subjectId: binding.id });
    bindingEnvironments.add(binding.environmentName);
    if (!resources.has(binding.resourceId)) diagnostics.push({ severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', message: `AWS runtime binding ${binding.id} references missing resource ${binding.resourceId}.`, subjectId: binding.id });
  }
  const artifactIds = new Set<string>();
  for (const artifact of plan.runtimeArtifacts) {
    const id = applicationRuntimeArtifactId(artifact);
    if (artifactIds.has(id)) diagnostics.push({ severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', message: `AWS runtime artifact ${id} is duplicated.`, subjectId: id });
    artifactIds.add(id);
    for (const error of validateApplicationRuntimeArtifact(artifact)) diagnostics.push({ severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', message: `AWS runtime artifact ${id} ${error}.`, subjectId: id });
  }
  const expected = normalizeApplicationAwsDeploymentPlan({ ...plan, diagnostics: plan.diagnostics }).digest;
  if (plan.digest !== expected) diagnostics.push({ severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', message: 'AWS plan digest does not match its canonical content.' });
  if (containsSensitiveValue(plan)) diagnostics.push({ severity: 'error', code: 'AWS_SENSITIVE_DATA', message: 'AWS plan contains a credential-shaped key or value.' });
  return diagnostics;
}

export function serializeApplicationAwsDeploymentPlan(plan: ApplicationAwsDeploymentPlan): string {
  if (containsSensitiveValue(plan)) throw new Error('AWS_SENSITIVE_DATA: AWS plan contains a credential-shaped key or value and cannot be serialized.');
  return `${stableJson(normalizeApplicationAwsDeploymentPlan(plan))}\n`;
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${sha256Hex(value)}`;
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
}

function containsSensitiveValue(value: unknown, key = ''): boolean {
  if (/(?:password|bearer|private[-_]?key|secretValue|accessToken|apiKey)$/iu.test(key)) return true;
  if (typeof value === 'string') return /^(?:Bearer\s+|(?:sk|rk|pk)_[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16})/u.test(value);
  if (Array.isArray(value)) return value.some((entry) => containsSensitiveValue(entry));
  if (value && typeof value === 'object') return Object.entries(value).some(([entryKey, entry]) => containsSensitiveValue(entry, entryKey));
  return false;
}

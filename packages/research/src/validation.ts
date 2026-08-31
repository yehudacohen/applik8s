// typecast-file-boundary: research evidence and artifact-link payloads are fully normalized before their versioned contract types are restored.
import { createHash } from 'node:crypto';
import { canonicalJsonV1String, type JsonObject, type JsonValue } from '@applik8s/core';
import {
  applicationResearchEvidenceProtocol,
  type ApplicationResearchArtifactLink,
  type ApplicationResearchArtifactLinkInput,
  type ApplicationResearchCitationSpan,
  type ApplicationResearchEvidenceCommit,
  type ApplicationResearchEvidenceListInput,
  type ApplicationResearchEvidenceRecord,
} from './contracts.js';

export function normalizeResearchEvidenceCommit(
  input: ApplicationResearchEvidenceCommit,
): ApplicationResearchEvidenceCommit {
  if (!input || typeof input !== 'object') throw new Error('Research evidence commit must be an object.');
  const canonicalUrl = absoluteHttpUrl(input.canonicalUrl);
  const retrievedAt = timestamp(input.retrievedAt, 'retrievedAt');
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.contentDigest)) {
    throw new Error('Research evidence contentDigest must be a complete lowercase sha256 digest.');
  }
  if (!['digest-only', 'licensed-reference', 'retained-snapshot'].includes(input.snapshotPolicy)) {
    throw new Error('Research evidence snapshotPolicy is invalid.');
  }
  if (input.snapshotPolicy === 'retained-snapshot' && !input.snapshotArtifactId?.trim()) {
    throw new Error('Retained research evidence requires snapshotArtifactId.');
  }
  const citations = Object.freeze(input.citations.map((citation, index) => normalizeCitation(citation, index)));
  return Object.freeze({
    principalScope: bounded(input.principalScope, 'principalScope', 1, 512),
    runId: bounded(input.runId, 'runId', 1, 512),
    queryId: bounded(input.queryId, 'queryId', 1, 512),
    retrievalId: bounded(input.retrievalId, 'retrievalId', 1, 512),
    canonicalUrl,
    searchReceipt: jsonObject(input.searchReceipt, 'searchReceipt'),
    retrievedAt,
    contentDigest: input.contentDigest,
    snapshotPolicy: input.snapshotPolicy,
    ...(input.snapshotArtifactId ? { snapshotArtifactId: bounded(input.snapshotArtifactId, 'snapshotArtifactId', 1, 1_024) } : {}),
    citations,
    visibility: jsonObject(input.visibility, 'visibility'),
    ...(input.causalArtifactIds ? {
      causalArtifactIds: Object.freeze([...new Set(input.causalArtifactIds.map((value) => bounded(value, 'causalArtifactId', 1, 1_024)))].sort()),
    } : {}),
  });
}

export function normalizeResearchEvidenceListInput(
  input: ApplicationResearchEvidenceListInput,
): Required<ApplicationResearchEvidenceListInput> {
  if (!input || typeof input !== 'object') throw new Error('Research evidence list input must be an object.');
  const afterVersion = input.afterVersion ?? 0;
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(afterVersion) || afterVersion < 0) throw new Error('Research evidence afterVersion must be a non-negative integer.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Research evidence limit must be an integer between 1 and 500.');
  return Object.freeze({
    principalScope: bounded(input.principalScope, 'principalScope', 1, 512),
    runId: bounded(input.runId, 'runId', 1, 512),
    afterVersion,
    limit,
  });
}

export function normalizeResearchArtifactLinkInput(
  input: ApplicationResearchArtifactLinkInput,
): ApplicationResearchArtifactLinkInput {
  if (!input || typeof input !== 'object') throw new Error('Research artifact link must be an object.');
  const evidenceIds = uniqueNonEmpty(input.evidenceIds, 'evidenceIds');
  if (evidenceIds.length === 0) throw new Error('Research artifact link requires at least one evidence ID.');
  const claims = Object.freeze(input.claims.map((claim, index) => {
    if (!claim || typeof claim !== 'object') throw new Error(`Research artifact claim ${index} must be an object.`);
    const cited = uniqueNonEmpty(claim.evidenceIds, `claims[${index}].evidenceIds`);
    if (cited.length === 0) throw new Error(`Research artifact claim ${index} requires evidence.`);
    if (cited.some((id) => !evidenceIds.includes(id))) throw new Error(`Research artifact claim ${index} references evidence outside the artifact link.`);
    return Object.freeze({ claim: bounded(claim.claim, `claims[${index}].claim`, 1, 8_000), evidenceIds: cited });
  }));
  return Object.freeze({
    principalScope: bounded(input.principalScope, 'principalScope', 1, 512),
    runId: bounded(input.runId, 'runId', 1, 512),
    artifactId: bounded(input.artifactId, 'artifactId', 1, 1_024),
    evidenceIds,
    claims,
  });
}

export function researchEvidenceId(input: ApplicationResearchEvidenceCommit): string {
  return `evidence_${digest({ runId: input.runId, retrievalId: input.retrievalId, contentDigest: input.contentDigest })}`;
}

export function researchArtifactLinkId(input: ApplicationResearchArtifactLinkInput): string {
  return `evidence_link_${digest({ runId: input.runId, artifactId: input.artifactId })}`;
}

export function evidenceRecord(
  input: ApplicationResearchEvidenceCommit,
  version: number,
  committedAt: string,
): ApplicationResearchEvidenceRecord {
  return Object.freeze({
    apiVersion: applicationResearchEvidenceProtocol,
    id: researchEvidenceId(input),
    ...input,
    version,
    committedAt,
  });
}

export function artifactLinkRecord(
  input: ApplicationResearchArtifactLinkInput,
  linkedAt: string,
): ApplicationResearchArtifactLink {
  return Object.freeze({
    apiVersion: 'applik8s.researchArtifactEvidence/v1alpha1',
    id: researchArtifactLinkId(input),
    ...input,
    linkedAt,
  });
}

function normalizeCitation(value: ApplicationResearchCitationSpan, index: number): ApplicationResearchCitationSpan {
  if (!value || typeof value !== 'object') throw new Error(`Research citation ${index} must be an object.`);
  if (!Number.isSafeInteger(value.start) || !Number.isSafeInteger(value.end) || value.start < 0 || value.end <= value.start) {
    throw new Error(`Research citation ${index} requires a non-empty non-negative span.`);
  }
  return Object.freeze({
    start: value.start,
    end: value.end,
    ...(value.quote ? { quote: bounded(value.quote, `citations[${index}].quote`, 1, 8_000) } : {}),
    ...(value.claim ? { claim: bounded(value.claim, `citations[${index}].claim`, 1, 8_000) } : {}),
  });
}

function uniqueNonEmpty(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values)) throw new Error(`Research ${label} must be an array.`);
  return Object.freeze([...new Set(values.map((value) => bounded(value, label, 1, 1_024)))].sort());
}

function absoluteHttpUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Research evidence canonicalUrl must be an absolute HTTP or HTTPS URL.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Research evidence canonicalUrl must use HTTP or HTTPS.');
  url.username = '';
  url.password = '';
  url.hash = '';
  return url.toString();
}

function timestamp(value: string, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(`Research evidence ${label} must be an ISO-compatible timestamp.`);
  return new Date(value).toISOString();
}

function bounded(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`Research evidence ${label} must be a string.`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) throw new Error(`Research evidence ${label} must contain between ${minimum} and ${maximum} characters.`);
  return normalized;
}

function jsonObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Research evidence ${label} must be a JSON object.`);
  try {
    const normalized = JSON.parse(canonicalJsonV1String(value as JsonValue)) as JsonObject;
    return Object.freeze(normalized);
  } catch {
    throw new Error(`Research evidence ${label} must contain only JSON values.`);
  }
}

function digest(value: JsonValue): string {
  return createHash('sha256').update(canonicalJsonV1String(value)).digest('hex').slice(0, 32);
}

// typecast-file-boundary: Canonical telemetry literals and decoded carrier records are narrowed only after bounded validation in this protocol owner.
export const applicationTelemetryEnvelopeVersion = "applik8s.telemetry/v1alpha1" as const;
export const applicationTelemetrySemanticVersion = "applik8s.telemetrySemantics/v1alpha1" as const;

export type ApplicationTelemetryBoundaryKind =
  | "actor"
  | "agent"
  | "event"
  | "http"
  | "model"
  | "operation"
  | "processor"
  | "provider"
  | "query"
  | "reconciler"
  | "schedule"
  | "task"
  | "workflow";

export type ApplicationTelemetryPrincipalClass =
  | "anonymous"
  | "human"
  | "service"
  | "system"
  | "unknown";

export type ApplicationTelemetryInvocationKind =
  | "cancellation"
  | "live"
  | "replay"
  | "retry";

export interface ApplicationTelemetryIdentityV1 {
  readonly application: string;
  readonly environment: string;
  readonly target: string;
  readonly operation: string;
  readonly execution: string;
  readonly attempt: number;
  readonly service?: string;
  readonly provider?: string;
  readonly definition?: string;
  readonly instance?: string;
  readonly occurrence?: string;
  readonly actor?: string;
  readonly principalClass?: ApplicationTelemetryPrincipalClass;
  readonly causalPrincipalClass?: ApplicationTelemetryPrincipalClass;
}

export interface ApplicationTelemetryEnvelopeV1 {
  readonly version: typeof applicationTelemetryEnvelopeVersion;
  readonly traceparent: string;
  readonly tracestate?: string;
  readonly baggage: Readonly<Record<string, string>>;
  readonly identity: ApplicationTelemetryIdentityV1;
  readonly invocation: {
    readonly kind: ApplicationTelemetryInvocationKind;
    readonly relationship: "asynchronous" | "synchronous";
    readonly replaySuppressed: boolean;
  };
  readonly sampled: boolean;
}

export interface ApplicationTelemetryEnvelopeOptions {
  readonly traceparent: string;
  readonly tracestate?: string;
  readonly baggage?: Readonly<Record<string, string>>;
  readonly identity: ApplicationTelemetryIdentityV1;
  readonly invocation?: Partial<ApplicationTelemetryEnvelopeV1["invocation"]>;
  readonly sampled?: boolean;
}

export type ApplicationTelemetryMetricKind = "counter" | "gauge" | "histogram";
export type ApplicationTelemetryMetricTemporality = "cumulative" | "delta";

export interface ApplicationTelemetryMetricDefinition {
  readonly name: string;
  readonly description: string;
  readonly unit: string;
  readonly kind: ApplicationTelemetryMetricKind;
  readonly temporality: ApplicationTelemetryMetricTemporality;
  readonly allowedAttributes: readonly string[];
  readonly boundaries?: readonly number[];
}

const boundaryAttributes = Object.freeze([
  "applik8s.boundary.kind",
  "applik8s.operation",
  "applik8s.result",
  "applik8s.invocation.kind",
  "applik8s.provider",
  "error.type",
]);

export const applicationTelemetryMetricCatalog = Object.freeze({
  "applik8s.operation.count": metric(
    "applik8s.operation.count",
    "Completed Applik8s managed execution attempts.",
    "{attempt}",
    "counter",
    "cumulative",
    boundaryAttributes,
  ),
  "applik8s.operation.duration": metric(
    "applik8s.operation.duration",
    "Duration of Applik8s managed execution attempts.",
    "s",
    "histogram",
    "cumulative",
    boundaryAttributes,
    [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  ),
  "applik8s.delivery.lag": metric(
    "applik8s.delivery.lag",
    "Lag between durable issuance and an admitted consumer attempt.",
    "s",
    "histogram",
    "cumulative",
    ["applik8s.boundary.kind", "applik8s.operation", "applik8s.result"],
    [0.001, 0.01, 0.1, 0.5, 1, 5, 30, 60, 300, 900, 3600],
  ),
  "applik8s.retry.count": metric(
    "applik8s.retry.count",
    "Admitted retry attempts by managed execution family.",
    "{attempt}",
    "counter",
    "cumulative",
    ["applik8s.boundary.kind", "applik8s.operation", "applik8s.result"],
  ),
  "applik8s.telemetry.export.failure": metric(
    "applik8s.telemetry.export.failure",
    "Telemetry export attempts that failed before reaching the selected provider.",
    "{failure}",
    "counter",
    "cumulative",
    ["applik8s.signal", "applik8s.provider", "error.type"],
  ),
  "applik8s.telemetry.drop": metric(
    "applik8s.telemetry.drop",
    "Telemetry records dropped by a bounded framework policy.",
    "{record}",
    "counter",
    "cumulative",
    ["applik8s.signal", "applik8s.drop.reason"],
  ),
  "applik8s.telemetry.queue.size": metric(
    "applik8s.telemetry.queue.size",
    "Current bounded telemetry export queue size.",
    "{record}",
    "gauge",
    "cumulative",
    ["applik8s.signal", "applik8s.provider"],
  ),
  "applik8s.actor.authority.decode": metric(
    "applik8s.actor.authority.decode",
    "Actor authority envelopes decoded by format and result.",
    "{envelope}",
    "counter",
    "cumulative",
    ["applik8s.actor.authority.format", "applik8s.actor.authority.result"],
  ),
  "applik8s.actor.authority.legacy_read": metric(
    "applik8s.actor.authority.legacy_read",
    "Legacy actor authority envelopes read during the rolling migration.",
    "{envelope}",
    "counter",
    "cumulative",
    ["applik8s.actor.authority.format"],
  ),
  "applik8s.runtime.integrity.envelope": metric(
    "applik8s.runtime.integrity.envelope",
    "Signed-envelope operations by purpose, wire format, and bounded result.",
    "{envelope}",
    "counter",
    "cumulative",
    [
      "applik8s.runtime.integrity.purpose",
      "applik8s.runtime.integrity.format",
      "applik8s.runtime.integrity.operation",
      "applik8s.runtime.integrity.result",
      "error.type",
    ],
  ),
} satisfies Readonly<Record<string, ApplicationTelemetryMetricDefinition>>);

export type ApplicationTelemetryMetricName = keyof typeof applicationTelemetryMetricCatalog;

export class ApplicationTelemetryContractError extends Error {
  readonly code:
    | "TELEMETRY_BAGGAGE_INVALID"
    | "TELEMETRY_ENVELOPE_INVALID"
    | "TELEMETRY_IDENTITY_INVALID"
    | "TELEMETRY_METRIC_INVALID";

  constructor(
    code: ApplicationTelemetryContractError["code"],
    message: string,
  ) {
    super(message);
    this.name = "ApplicationTelemetryContractError";
    this.code = code;
  }
}

export function createApplicationTelemetryEnvelopeV1(
  options: ApplicationTelemetryEnvelopeOptions,
): ApplicationTelemetryEnvelopeV1 {
  const envelope: ApplicationTelemetryEnvelopeV1 = {
    version: applicationTelemetryEnvelopeVersion,
    traceparent: options.traceparent,
    ...(options.tracestate === undefined ? {} : { tracestate: options.tracestate }),
    baggage: Object.freeze(Object.fromEntries(
      Object.entries(options.baggage ?? {}).sort(([left], [right]) => left.localeCompare(right)),
    )),
    identity: Object.freeze({ ...options.identity }),
    invocation: Object.freeze({
      kind: options.invocation?.kind ?? "live",
      relationship: options.invocation?.relationship ?? "synchronous",
      replaySuppressed: options.invocation?.replaySuppressed
        ?? options.invocation?.kind === "replay",
    }),
    sampled: options.sampled ?? traceparentSampled(options.traceparent),
  };
  validateApplicationTelemetryEnvelopeV1(envelope);
  return Object.freeze(envelope);
}

export function validateApplicationTelemetryEnvelopeV1(
  value: unknown,
): asserts value is ApplicationTelemetryEnvelopeV1 {
  if (!record(value) || value.version !== applicationTelemetryEnvelopeVersion) {
    throw new ApplicationTelemetryContractError(
      "TELEMETRY_ENVELOPE_INVALID",
      `Telemetry envelope version must be ${applicationTelemetryEnvelopeVersion}.`,
    );
  }
  const traceparent = value.traceparent;
  if (typeof traceparent !== "string" || !traceparentPattern.test(traceparent)) {
    throw new ApplicationTelemetryContractError(
      "TELEMETRY_ENVELOPE_INVALID",
      "Telemetry traceparent must be a canonical W3C version 00 carrier with non-zero trace and span identifiers.",
    );
  }
  if (value.tracestate !== undefined && (
    typeof value.tracestate !== "string"
    || codePointLength(value.tracestate) > 512
    || containsControlCharacter(value.tracestate)
  )) {
    throw new ApplicationTelemetryContractError(
      "TELEMETRY_ENVELOPE_INVALID",
      "Telemetry tracestate must be a bounded control-character-free string.",
    );
  }
  validateIdentity(value.identity);
  validateBaggage(value.baggage);
  if (!record(value.invocation)
    || !["cancellation", "live", "replay", "retry"].includes(String(value.invocation.kind))
    || !["asynchronous", "synchronous"].includes(String(value.invocation.relationship))
    || typeof value.invocation.replaySuppressed !== "boolean"
    || value.invocation.replaySuppressed !== (value.invocation.kind === "replay")
    || typeof value.sampled !== "boolean"
    || value.sampled !== traceparentSampled(traceparent)) {
    throw new ApplicationTelemetryContractError(
      "TELEMETRY_ENVELOPE_INVALID",
      "Telemetry invocation and sampling fields are invalid.",
    );
  }
}

export function applicationTelemetryMetricDefinition(
  name: string,
): ApplicationTelemetryMetricDefinition {
  const definition = Reflect.get(applicationTelemetryMetricCatalog, name) as
    | ApplicationTelemetryMetricDefinition
    | undefined;
  if (!definition) {
    throw new ApplicationTelemetryContractError(
      "TELEMETRY_METRIC_INVALID",
      `Telemetry metric ${JSON.stringify(name)} is not in the versioned Applik8s metric catalog.`,
    );
  }
  return definition;
}

export function validateApplicationTelemetryMetricAttributes(
  definition: ApplicationTelemetryMetricDefinition,
  attributes: Readonly<Record<string, string | number | boolean>>,
): void {
  const allowed = new Set(definition.allowedAttributes);
  for (const [key, value] of Object.entries(attributes)) {
    if (!allowed.has(key)) {
      throw new ApplicationTelemetryContractError(
        "TELEMETRY_METRIC_INVALID",
        `Telemetry metric ${definition.name} does not allow attribute ${JSON.stringify(key)}.`,
      );
    }
    if (typeof value === "string" && (value.length > 128 || containsControlCharacter(value))) {
      throw new ApplicationTelemetryContractError(
        "TELEMETRY_METRIC_INVALID",
        `Telemetry metric ${definition.name} attribute ${JSON.stringify(key)} is not bounded.`,
      );
    }
  }
}

export function redactApplicationTelemetryValue(
  value: unknown,
  deniedFields: readonly string[] = defaultDeniedTelemetryFields,
): unknown {
  const denied = new Set([
    ...defaultDeniedTelemetryFields,
    ...deniedFields.map((field) => field.trim().toLowerCase()).filter(Boolean),
  ]);
  return redactValue(value, denied, new WeakSet<object>(), 0);
}

export const defaultDeniedTelemetryFields = Object.freeze([
  "authorization",
  "body",
  "cookie",
  "credential",
  "document",
  "email",
  "header",
  "modelinput",
  "modeloutput",
  "password",
  "payload",
  "prompt",
  "principal",
  "query",
  "rawcontext",
  "secret",
  "token",
  "userid",
]);

function metric(
  name: string,
  description: string,
  unit: string,
  kind: ApplicationTelemetryMetricKind,
  temporality: ApplicationTelemetryMetricTemporality,
  allowedAttributes: readonly string[],
  boundaries?: readonly number[],
): ApplicationTelemetryMetricDefinition {
  return Object.freeze({
    name,
    description,
    unit,
    kind,
    temporality,
    allowedAttributes: Object.freeze([...allowedAttributes]),
    ...(boundaries ? { boundaries: Object.freeze([...boundaries]) } : {}),
  });
}

const traceparentPattern = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u;
// Canonical Applik8s identities are URI-shaped and therefore retain percent-
// encoded semantic segments. Query/fragment characters remain excluded.
const identityPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@%-]{0,255}$/u;
const baggageKeyPattern = /^[a-z][a-z0-9_.-]{0,62}$/u;
const principalClasses = new Set<ApplicationTelemetryPrincipalClass>([
  "anonymous",
  "human",
  "service",
  "system",
  "unknown",
]);

function validateIdentity(value: unknown): asserts value is ApplicationTelemetryIdentityV1 {
  if (!record(value)) {
    throw new ApplicationTelemetryContractError(
      "TELEMETRY_IDENTITY_INVALID",
      "Telemetry identity must be an object.",
    );
  }
  for (const field of ["application", "environment", "target", "operation", "execution"] as const) {
    if (typeof value[field] !== "string" || !identityPattern.test(value[field])) {
      throw new ApplicationTelemetryContractError(
        "TELEMETRY_IDENTITY_INVALID",
        `Telemetry identity ${field} must be a bounded stable identifier.`,
      );
    }
  }
  for (const field of ["service", "provider", "definition", "instance", "occurrence", "actor"] as const) {
    if (value[field] !== undefined && (
      typeof value[field] !== "string"
      || !identityPattern.test(value[field])
    )) {
      throw new ApplicationTelemetryContractError(
        "TELEMETRY_IDENTITY_INVALID",
        `Telemetry identity ${field} must be a bounded stable identifier when present.`,
      );
    }
  }
  if (!Number.isSafeInteger(value.attempt) || Number(value.attempt) < 1) {
    throw new ApplicationTelemetryContractError(
      "TELEMETRY_IDENTITY_INVALID",
      "Telemetry attempt identity must be a positive integer.",
    );
  }
  for (const field of ["principalClass", "causalPrincipalClass"] as const) {
    if (value[field] !== undefined && !principalClasses.has(value[field] as ApplicationTelemetryPrincipalClass)) {
      throw new ApplicationTelemetryContractError(
        "TELEMETRY_IDENTITY_INVALID",
        `Telemetry ${field} must be a principal class rather than a raw principal identity.`,
      );
    }
  }
}

function validateBaggage(value: unknown): asserts value is Readonly<Record<string, string>> {
  if (!record(value)) {
    throw new ApplicationTelemetryContractError(
      "TELEMETRY_BAGGAGE_INVALID",
      "Telemetry baggage must be an object.",
    );
  }
  let bytes = 0;
  for (const [key, entry] of Object.entries(value)) {
    if (!baggageKeyPattern.test(key)
      || typeof entry !== "string"
      || codePointLength(entry) > 256
      || containsControlCharacter(entry)) {
      throw new ApplicationTelemetryContractError(
        "TELEMETRY_BAGGAGE_INVALID",
        `Telemetry baggage entry ${JSON.stringify(key)} is invalid or unbounded.`,
      );
    }
    bytes += new TextEncoder().encode(`${key}=${entry}`).byteLength;
  }
  if (bytes > 8_192) {
    throw new ApplicationTelemetryContractError(
      "TELEMETRY_BAGGAGE_INVALID",
      "Telemetry baggage exceeds the 8192-byte carrier limit.",
    );
  }
}

function traceparentSampled(traceparent: string): boolean {
  return traceparent.endsWith("-01");
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) return true;
  }
  return false;
}

function codePointLength(value: string): number {
  return [...value].length;
}

function redactValue(
  value: unknown,
  denied: ReadonlySet<string>,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") return value.slice(0, 2_048);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (value === undefined) return undefined;
  if (typeof value !== "object") return String(value).slice(0, 256);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => redactValue(entry, denied, seen, depth + 1));
  }
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, entry]) => {
    const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
    const sensitive = [...denied].some((field) => normalized.includes(field.replace(/[^a-z0-9]/giu, "")));
    return [key, sensitive ? "[REDACTED]" : redactValue(entry, denied, seen, depth + 1)];
  }));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

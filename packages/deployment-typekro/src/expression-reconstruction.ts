import type { ApplicationDeploymentGraph } from "@applik8s/deployment-contract";
import { Cel } from "typekro";

export interface ExpressionContext {
  readonly spec: object;
  readonly resources: ReadonlyMap<string, unknown>;
  readonly graph: ApplicationDeploymentGraph;
  readonly preserveResourceCel?: boolean;
}

export function expressionContext(
  spec: object,
  resources: ReadonlyMap<string, unknown>,
  graph: ApplicationDeploymentGraph,
  options: { readonly preserveResourceCel?: boolean } = {},
): ExpressionContext {
  return { spec, resources, graph, ...options };
}

export function transformExpressionString(
  value: string,
  context: ExpressionContext,
): unknown {
  const expressions = interpolationSegments(value);
  if (!expressions) return value;
  if (expressions.length === 1 && expressions[0]?.kind === "expression") {
    return expressionValue(expressions[0].value, context);
  }
  const parts: unknown[] = [];
  for (const [index, segment] of expressions.entries()) {
    if (index > 0) parts.push(" + ");
    if (segment.kind === "literal") {
      parts.push(JSON.stringify(segment.value));
    } else {
      parts.push("string(", expressionValue(segment.value, context), ")");
    }
  }
  // Build a canonical CEL expression rather than a template-shaped value.
  // Keeping DNS suffixes inside quoted CEL literals prevents TypeKro's
  // dependency scanner from mistaking `.svc` for a resource reference.
  // typecast: Cel.expr accepts the reconstructed heterogeneous expression parts.
  return Cel.expr<string>(...(parts as never[]));
}

type InterpolationSegment =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "expression"; readonly value: string };

function interpolationSegments(
  value: string,
): readonly InterpolationSegment[] | undefined {
  const first = value.indexOf("${");
  if (first < 0) return undefined;
  const segments: InterpolationSegment[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf("${", cursor);
    if (start < 0) {
      if (cursor < value.length) {
        segments.push({ kind: "literal", value: value.slice(cursor) });
      }
      break;
    }
    if (start > cursor) {
      segments.push({ kind: "literal", value: value.slice(cursor, start) });
    }
    const end = expressionEnd(value, start + 2);
    if (end < 0) {
      throw new Error(`Unterminated KRO expression in ${JSON.stringify(value)}.`);
    }
    segments.push({
      kind: "expression",
      value: value.slice(start + 2, end),
    });
    cursor = end + 1;
  }
  return segments;
}

function expressionEnd(value: string, start: number): number {
  let depth = 0;
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

function expressionValue(source: string, context: ExpressionContext): unknown {
  if (
    source.trim() === "json.marshal(schema.spec)" &&
    context.graph.metadata.strategy === "direct"
  ) {
    // KRO owns json.marshal(schema.spec). Direct planning has the authoritative
    // concrete installation spec in the deployment graph and must produce the
    // same ConfigMap string without asking the direct CEL evaluator to emulate
    // KRO's json namespace.
    const root = context.graph.nodes.find(
      (node) => node.kind === "kubernetesComposition",
    );
    if (!root || root.kind !== "kubernetesComposition") {
      throw new Error(
        "Application deployment graph has no Kubernetes composition root.",
      );
    }
    return JSON.stringify(root.spec.installationSpec);
  }
  const references = expressionReferences(source, context);
  if (
    references.length === 1 &&
    references[0]?.start === 0 &&
    references[0].end === source.length
  ) {
    return references[0].value;
  }
  const parts: unknown[] = [];
  let cursor = 0;
  for (const reference of references) {
    if (reference.start > cursor) {
      parts.push(source.slice(cursor, reference.start));
    }
    parts.push(reference.value);
    cursor = reference.end;
  }
  if (cursor < source.length) parts.push(source.slice(cursor));
  return Cel.expr(...parts);
}

interface ExpressionReference {
  readonly start: number;
  readonly end: number;
  readonly value: unknown;
}

function expressionReferences(
  source: string,
  context: ExpressionContext,
): readonly ExpressionReference[] {
  const references: ExpressionReference[] = [];
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (!identifierStart(character)) continue;
    const identifierEnd = readIdentifierEnd(source, index);
    const identifier = source.slice(index, identifierEnd);
    let root: unknown;
    let pathStart = identifierEnd;
    if (
      identifier === "schema" &&
      source.slice(identifierEnd, identifierEnd + 5) === ".spec"
    ) {
      root = context.spec;
      pathStart = identifierEnd + 5;
    } else if (
      identifier === "resources" &&
      source[identifierEnd] === "."
    ) {
      const resourceStart = identifierEnd + 1;
      const resourceEnd = readIdentifierEnd(source, resourceStart);
      const resourceId = source.slice(resourceStart, resourceEnd);
      root = context.resources.get(resourceId);
      pathStart = resourceEnd;
      if (!root) {
        throw new Error(
          `KRO expression references resource ${resourceId} before it is materialized.`,
        );
      }
    } else {
      root = context.resources.get(identifier);
      if (!root) {
        index = identifierEnd - 1;
        continue;
      }
    }
    if (
      context.preserveResourceCel &&
      identifier !== "schema"
    ) {
      // Compiler-emitted status CEL is already a complete portable
      // expression over the materialized graph. Replacing its resource paths
      // with TypeKro proxies can fold authored template fields (for example a
      // ConfigMap data value) back into schema.spec, which KRO forbids in
      // status mappings. Preserve the resource reference verbatim and let
      // TypeKro validate/serialize the finished CEL contract.
      index = identifierEnd - 1;
      continue;
    }
    if (index > 0 && identifierPart(source[index - 1])) {
      index = identifierEnd - 1;
      continue;
    }
    const path = readReferencePath(source, pathStart);
    if (identifier === "schema" && path.segments.length === 0) {
      // TypeKro's schema proxy represents individual fields as references, but
      // the spec root is an evaluator namespace rather than a KubernetesRef.
      // Preserve it as CEL so expressions such as json.marshal(schema.spec)
      // retain their whole-spec meaning in KRO and direct execution.
      index = path.end - 1;
      continue;
    }
    references.push({
      start: index,
      end: path.end,
      value: reflectPath(root, path.segments),
    });
    index = path.end - 1;
  }
  return references;
}

function readReferencePath(
  source: string,
  start: number,
): { readonly end: number; readonly segments: readonly string[] } {
  const segments: string[] = [];
  let cursor = start;
  while (cursor < source.length) {
    if (source[cursor] === ".") {
      const segmentStart = cursor + 1;
      if (!identifierStart(source[segmentStart])) break;
      const segmentEnd = readIdentifierEnd(source, segmentStart);
      segments.push(source.slice(segmentStart, segmentEnd));
      cursor = segmentEnd;
      continue;
    }
    if (source[cursor] === "[") {
      const bracket = readBracketSegment(source, cursor);
      if (!bracket) break;
      segments.push(bracket.segment);
      cursor = bracket.end;
      continue;
    }
    break;
  }
  return { end: cursor, segments };
}

function readBracketSegment(
  source: string,
  start: number,
): { readonly segment: string; readonly end: number } | undefined {
  let cursor = start + 1;
  while (source[cursor] === " ") cursor += 1;
  const quote = source[cursor];
  if (quote === "'" || quote === '"') {
    cursor += 1;
    let segment = "";
    let escaped = false;
    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (escaped) {
        segment += character;
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        cursor += 1;
        break;
      } else {
        segment += character;
      }
    }
    while (source[cursor] === " ") cursor += 1;
    return source[cursor] === "]"
      ? { segment, end: cursor + 1 }
      : undefined;
  }
  const numberStart = cursor;
  while (/[0-9]/.test(source[cursor] ?? "")) cursor += 1;
  if (cursor === numberStart) return undefined;
  const segment = source.slice(numberStart, cursor);
  while (source[cursor] === " ") cursor += 1;
  return source[cursor] === "]"
    ? { segment, end: cursor + 1 }
    : undefined;
}

function reflectPath(root: unknown, segments: readonly string[]): unknown {
  let value = root;
  for (const segment of segments) {
    if (
      (typeof value !== "object" && typeof value !== "function") ||
      value === null
    ) {
      throw new Error(`Cannot resolve TypeKro reference segment ${segment}.`);
    }
    value = Reflect.get(value, segment);
  }
  return value;
}

function identifierStart(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z_]/.test(value);
}

function identifierPart(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_]/.test(value);
}

function readIdentifierEnd(value: string, start: number): number {
  let cursor = start;
  while (identifierPart(value[cursor])) cursor += 1;
  return cursor;
}

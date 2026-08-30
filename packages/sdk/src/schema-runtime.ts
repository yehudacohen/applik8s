// typecast-file-boundary: emitted JSON Schema is recursively validated before conversion to ArkType's runtime schema vocabulary.
import type { Type } from 'arktype';

import type {
  Applik8sError,
  ArkTypeSchemaSource,
  CustomSchemaSource,
  Diagnostic,
  JsonObject,
  JsonSchemaSource,
  JsonValue,
  Result,
  RuntimeSchema,
  SchemaContract,
} from '@applik8s/core';
import type { SchemaInput } from './interfaces.js';

type RuntimeSchemaSource<T extends object> = (ArkTypeSchemaSource<T> | JsonSchemaSource<T> | CustomSchemaSource<T>) & { readonly arktype?: Type<T> };
type ArkTypeRuntimeSchemaSource<T extends object> = RuntimeSchemaSource<T> & { readonly kind: 'arktype'; readonly arktype: Type<T> };

/**
 * Emits the portable structural portion of an ArkType contract.
 *
 * Predicates, including `Type.narrow(...)`, remain authoritative at runtime
 * but cannot be represented by JSON Schema. Their already-constrained base is
 * safe to publish as the wire shape. Morphs and every other unsupported
 * construct continue to fail closed through ArkType's default policy.
 */
export function emitArkTypeStructuralJsonSchema<TValue>(
  schema: Type<TValue>,
): JsonObject {
  // typecast: ArkType's emitted value is JSON-compatible and is subsequently
  // validated by the shared schema diagnostics boundary.
  return schema.toJsonSchema({
    fallback: {
      predicate: (context) => context.base,
    },
  }) as JsonObject;
}

export function normalizeSchema<T extends object>(input: SchemaInput<T>, name: string): RuntimeSchema<T> {
  if (isRuntimeSchema(input)) {
    return input;
  }
  if (isSchemaSource<T>(input)) {
    return toRuntimeSchema(input);
  }
  return toRuntimeSchema({ kind: 'arktype', ref: { kind: 'arktype', exportName: name }, arktype: input });
}

export function toRuntimeSchema<T extends object>(source: RuntimeSchemaSource<T>): RuntimeSchema<T> {
  // Compiler-discovered ArkType schemas arrive as structural JSON Schema. Run
  // that representation through the same nullable/literal normalization as a
  // live ArkType schema so generated gateways do not reject their own schema.
  const normalizedSource = source.kind === 'jsonSchema'
    ? { ...source, schema: toDraft7Subset(source.schema) }
    : source;
  const contract = schemaContract(normalizedSource);
  return {
    source: normalizedSource,
    contract,
    validate(value) {
      if (normalizedSource.kind === 'arktype') {
        if (!hasArkType(normalizedSource)) {
          return unsupportedSchemaResult(normalizedSource, 'runtime validation');
        }
        const schema = arktypeJsonSchema(normalizedSource);
        if (!schema.ok) {
          return schema;
        }
        const diagnostics = unsupportedJsonSchemaDiagnostics(schema.value, '$');
        if (diagnostics.length > 0) {
          return err('SCHEMA_UNSUPPORTED', diagnostics[0]?.message ?? 'ArkType schema emits unsupported JSON Schema keywords.');
        }
        if (typeof normalizedSource.arktype !== 'function') {
          return unsupportedSchemaResult(normalizedSource, 'runtime validation');
        }
        const result = normalizedSource.arktype(value);
        if (isArkTypeErrors(result)) {
          return err('SCHEMA_INVALID', String(result));
        }
        // typecast: ArkType has accepted the value, establishing the runtime T contract for supported structural schemas.
        return ok(result as T);
      }
      if (normalizedSource.kind === 'jsonSchema') {
        const diagnostics = unsupportedJsonSchemaDiagnostics(normalizedSource.schema, '$');
        if (diagnostics.length > 0) {
          return err('SCHEMA_UNSUPPORTED', diagnostics[0]?.message ?? 'JSON Schema uses unsupported validation keywords.');
        }
        const errors = validateJsonValue(value, normalizedSource.schema, '$');
        if (errors.length > 0) {
          return err('SCHEMA_INVALID', errors[0] ?? 'Value does not match JSON Schema.');
        }
        // typecast: JSON Schema validation establishes the public T contract for the supported schema subset.
        return ok(value as T);
      }

      return unsupportedSchemaResult(normalizedSource, 'runtime validation');
    },
    emitOpenApiSchema() {
      if (normalizedSource.kind === 'arktype') {
        if (!hasArkType(normalizedSource)) {
          return unsupportedSchemaResult(normalizedSource, 'Kubernetes OpenAPI emission');
        }
        const schema = arktypeJsonSchema(normalizedSource);
        return schema.ok
          ? ok({ kind: 'kubernetesOpenApi', source: source.ref, schema: cloneJson(schema.value), diagnostics: unsupportedJsonSchemaDiagnostics(schema.value, '$') })
          : schema;
      }
      if (normalizedSource.kind === 'jsonSchema') {
        return ok({ kind: 'kubernetesOpenApi', source: normalizedSource.ref, schema: cloneJson(normalizedSource.schema), diagnostics: unsupportedJsonSchemaDiagnostics(normalizedSource.schema, '$') });
      }
      return unsupportedSchemaResult(normalizedSource, 'Kubernetes OpenAPI emission');
    },
    emitJsonSchema() {
      if (normalizedSource.kind === 'arktype') {
        if (!hasArkType(normalizedSource)) {
          return unsupportedSchemaResult(normalizedSource, 'JSON Schema emission');
        }
        const schema = arktypeJsonSchema(normalizedSource);
        return schema.ok
          ? ok({ kind: 'jsonSchema', source: source.ref, schema: cloneJson(schema.value), diagnostics: unsupportedJsonSchemaDiagnostics(schema.value, '$') })
          : schema;
      }
      if (normalizedSource.kind === 'jsonSchema') {
        return ok({ kind: 'jsonSchema', source: normalizedSource.ref, schema: cloneJson(normalizedSource.schema), diagnostics: unsupportedJsonSchemaDiagnostics(normalizedSource.schema, '$') });
      }
      return unsupportedSchemaResult(normalizedSource, 'JSON Schema emission');
    },
  };
}

function schemaContract<T extends object>(source: RuntimeSchemaSource<T>): SchemaContract<T> {
  const emittedSchema = source.kind === 'jsonSchema' ? ok(source.schema) : source.kind === 'arktype' && hasArkType(source) ? arktypeJsonSchema(source) : undefined;
  const diagnostics = emittedSchema
    ? emittedSchema.ok ? unsupportedJsonSchemaDiagnostics(emittedSchema.value, '$') : [schemaDiagnostic(emittedSchema.error.message)]
    : [schemaDiagnostic(`${source.kind} schemas require an explicit structural schema adapter before runtime validation or CRD emission.`)];
  const aligned = (source.kind === 'jsonSchema' || source.kind === 'arktype') && diagnostics.length === 0;
  const structural = {
    checked: source.kind === 'jsonSchema' || source.kind === 'arktype',
    valid: aligned,
    diagnostics,
  };

  return {
    source: source.ref,
    typeScript: {
      representation: source.inferredType === undefined ? 'declared' : 'inferred',
      ...(source.inferredType === undefined ? {} : { inferredType: source.inferredType }),
    },
    runtimeValidation: {
      mode: source.kind === 'jsonSchema' || source.kind === 'arktype' ? 'structuralSubset' : source.kind === 'custom' ? 'externalCustom' : 'objectOnly',
      validatesUnknownFields: emittedSchema?.ok === true && emittedSchema.value.additionalProperties === false,
      diagnostics,
    },
    kubernetesOpenApi: {
      mode: source.kind === 'jsonSchema' || source.kind === 'arktype' ? 'structuralSubset' : source.kind === 'custom' ? 'externalCustom' : 'broadObjectFallback',
      structural,
      diagnostics,
    },
    jsonSchema: {
      mode: source.kind === 'jsonSchema' || source.kind === 'arktype' ? 'structuralSubset' : source.kind === 'custom' ? 'externalCustom' : 'broadObjectFallback',
      structural,
      diagnostics,
    },
    equivalence: {
      typeScriptRuntimeAligned: aligned,
      runtimeOpenApiAligned: aligned,
      openApiJsonSchemaAligned: source.kind === 'jsonSchema' || source.kind === 'arktype',
      discrepancies: diagnostics.map((diagnostic) => ({
        layer: source.kind === 'jsonSchema' ? 'kubernetesOpenApi' : 'runtimeValidation',
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
      })),
    },
  };
}

function hasArkType<T extends object>(source: RuntimeSchemaSource<T> & { readonly kind: 'arktype' }): source is ArkTypeRuntimeSchemaSource<T> {
  return typeof source.arktype === 'function' || Boolean(source.arktype && typeof source.arktype === 'object');
}

function arktypeJsonSchema<T extends object>(source: ArkTypeRuntimeSchemaSource<T>): Result<JsonObject> {
  const emitter = Reflect.get(source.arktype, 'toJsonSchema');
  if (typeof emitter !== 'function') {
    return unsupportedSchemaResult(source, 'JSON Schema emission');
  }
  const emitted = emitArkTypeStructuralJsonSchema(source.arktype);
  if (!isJsonObject(emitted)) {
    return err('SCHEMA_UNSUPPORTED', `ArkType schema ${schemaRefName(source.ref)} did not emit a JSON object schema.`);
  }
  return ok(toDraft7Subset(emitted));
}

function toDraft7Subset(schema: JsonObject): JsonObject {
  const normalized: Record<string, unknown> = { ...schema };
  delete normalized.$schema;

  const nullableSchema = nullableAnyOfSchema(normalized.anyOf);
  if (nullableSchema) {
    const { anyOf: _anyOf, ...metadata } = normalized;
    return toDraft7Subset({ ...nullableSchema, ...metadata, nullable: true });
  }

  if ('const' in normalized) {
    const constValue = normalized.const;
    if (isScalarJsonValue(constValue)) {
      delete normalized.const;
      normalized.enum = [constValue];
    }
  }

  if (isJsonObject(normalized.properties)) {
    normalized.properties = Object.fromEntries(Object.entries(normalized.properties).map(([key, value]) => [key, isJsonObject(value) ? toDraft7Subset(value) : value]));
  }
  for (const keyword of ['$defs', 'definitions'] as const) {
    if (isJsonObject(normalized[keyword])) {
      normalized[keyword] = Object.fromEntries(
        Object.entries(normalized[keyword]).map(([key, value]) => [
          key,
          isJsonObject(value) ? toDraft7Subset(value) : value,
        ]),
      );
    }
  }
  if (isJsonObject(normalized.items)) {
    normalized.items = toDraft7Subset(normalized.items);
  }
  if (isJsonObject(normalized.additionalProperties)) {
    normalized.additionalProperties = toDraft7Subset(normalized.additionalProperties);
  }
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(normalized[keyword])) {
      normalized[keyword] = normalized[keyword].map((branch) =>
        isJsonObject(branch) ? toDraft7Subset(branch) : branch
      );
    }
  }
  if (isJsonObject(normalized.not)) {
    normalized.not = toDraft7Subset(normalized.not);
  }
  if (normalized.type === undefined) {
    const enumType = scalarEnumType(normalized.enum);
    if (enumType) {
      normalized.type = enumType;
    }
  }
  // typecast: normalization preserves the JSON object shape while removing/rewriting only schema metadata fields.
  return normalized as JsonObject;
}

function nullableAnyOfSchema(value: unknown): JsonObject | undefined {
  if (!Array.isArray(value) || value.length !== 2) {
    return undefined;
  }
  const [left, right] = value;
  if (isNullSchema(left) && isJsonObject(right)) {
    return right;
  }
  if (isNullSchema(right) && isJsonObject(left)) {
    return left;
  }
  return undefined;
}

function isNullSchema(value: unknown): boolean {
  return isJsonObject(value) && value.type === 'null';
}

function scalarEnumType(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const nonNullValues = value.filter((item) => item !== null);
  if (nonNullValues.length === 0) {
    return undefined;
  }
  if (nonNullValues.every((item) => typeof item === 'string')) {
    return 'string';
  }
  if (nonNullValues.every((item) => typeof item === 'boolean')) {
    return 'boolean';
  }
  if (nonNullValues.every((item) => typeof item === 'number')) {
    return nonNullValues.every((item) => Number.isInteger(item)) ? 'integer' : 'number';
  }
  return undefined;
}

function isScalarJsonValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isArkTypeErrors(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, ' arkKind') === 'errors');
}

function unsupportedSchemaResult(source: { readonly kind: RuntimeSchemaSource<object>['kind']; readonly ref: RuntimeSchemaSource<object>['ref'] }, boundary: string): Result<never> {
  return err(
    'SCHEMA_UNSUPPORTED',
    `${source.kind} schema ${schemaRefName(source.ref)} cannot be used for ${boundary} until it has an explicit structural schema adapter.`
  );
}

function schemaRefName(ref: RuntimeSchemaSource<object>['ref']): string {
  return ref.exportName ?? ref.moduleSpecifier ?? ref.kind;
}

interface JsonSchemaValidationState {
  calls: number;
}

function validateJsonValue(
  value: JsonValue,
  schema: JsonObject,
  path: string,
  root: JsonObject = schema,
  state: JsonSchemaValidationState = { calls: 0 },
  ancestors: ReadonlySet<object> = new Set<object>(),
  referenceTrail: ReadonlySet<string> = new Set<string>(),
): readonly string[] {
  state.calls += 1;
  if (state.calls > 10_000) return [`${path} exceeds the bounded JSON Schema validation budget.`];
  if (value === undefined) return [`${path} must not be undefined.`];
  if (typeof value === 'number' && !Number.isFinite(value)) return [`${path} must be a finite JSON number.`];
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    return [`${path} must be a JSON value.`];
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
      return [`${path} must be a plain JSON object.`];
    }
    if (Object.getOwnPropertySymbols(value).length > 0) return [`${path} must not contain symbol keys.`];
    if (ancestors.has(value)) return [`${path} must not contain a cyclic JSON value.`];
  }

  // OpenAPI-compatible nullable is a sibling constraint. Preserve it before
  // following a local reference so `{ $ref, nullable: true }` accepts null.
  if (value === null && schema.nullable === true) return [];
  const reference = readString(schema, '$ref');
  if (reference) {
    if (referenceTrail.has(reference)) {
      return [`${path} contains a circular JSON Schema reference without descending through data: ${reference}.`];
    }
    const resolved = resolveLocalJsonSchemaReference(root, reference);
    if (!resolved) return [`${path} references unresolved local JSON Schema ${reference}.`];
    const nextTrail = new Set(referenceTrail);
    nextTrail.add(reference);
    const resolvedErrors = validateJsonValue(value, resolved, path, root, state, ancestors, nextTrail);
    if (resolvedErrors.length > 0) return resolvedErrors;
    const { $ref: _reference, ...siblings } = schema;
    return Object.keys(siblings).length === 0
      ? []
      : validateJsonValue(value, siblings, path, root, state, ancestors, referenceTrail);
  }

  const anyOf = readSchemaArray(schema, 'anyOf');
  if (anyOf) {
    const matches = anyOf.filter((branch) => validateJsonValue(
      value,
      branch,
      path,
      root,
      state,
      ancestors,
      referenceTrail,
    ).length === 0);
    if (matches.length === 0) return [`${path} must match at least one anyOf branch.`];
  }

  const oneOf = readSchemaArray(schema, 'oneOf');
  if (oneOf) {
    const matches = oneOf.filter((branch) => validateJsonValue(
      value,
      branch,
      path,
      root,
      state,
      ancestors,
      referenceTrail,
    ).length === 0);
    if (matches.length !== 1) return [`${path} must match exactly one oneOf branch; matched ${matches.length}.`];
  }

  const allOf = readSchemaArray(schema, 'allOf');
  if (allOf) {
    for (const branch of allOf) {
      const errors = validateJsonValue(value, branch, path, root, state, ancestors, referenceTrail);
      if (errors.length > 0) return errors;
    }
  }

  const excluded = readSchema(schema, 'not');
  if (excluded && validateJsonValue(value, excluded, path, root, state, ancestors, referenceTrail).length === 0) {
    return [`${path} must not match the excluded schema.`];
  }

  if (value === null) {
    return schema.nullable === true
      || schema.type === 'null'
      || anyOf !== undefined
      || oneOf !== undefined
      || allOf !== undefined
      ? []
      : [`${path} must not be null.`];
  }

  const enumValues = readArray(schema, 'enum');
  if (enumValues && !enumValues.some((candidate) => deepEqual(candidate, value))) {
    return [`${path} must be one of ${JSON.stringify(enumValues)}.`];
  }

  const type = readString(schema, 'type');
  if (type && !matchesJsonSchemaType(value, type)) {
    return [`${path} must be ${type}.`];
  }

  const pattern = readString(schema, 'pattern');
  if (pattern && typeof value === 'string' && !new RegExp(pattern).test(value)) {
    return [`${path} must match pattern ${pattern}.`];
  }

  const format = readString(schema, 'format');
  if (format) {
    const formatError = validateJsonSchemaFormat(value, format, path);
    if (formatError) return [formatError];
  }

  if (typeof value === 'number') {
    const minimum = readNumber(schema, 'minimum');
    if (minimum !== undefined && value < minimum) return [`${path} must be greater than or equal to ${minimum}.`];
    const maximum = readNumber(schema, 'maximum');
    if (maximum !== undefined && value > maximum) return [`${path} must be less than or equal to ${maximum}.`];
    const exclusiveMinimum = readNumber(schema, 'exclusiveMinimum');
    if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) return [`${path} must be greater than ${exclusiveMinimum}.`];
    const exclusiveMaximum = readNumber(schema, 'exclusiveMaximum');
    if (exclusiveMaximum !== undefined && value >= exclusiveMaximum) return [`${path} must be less than ${exclusiveMaximum}.`];
    const multipleOf = readNumber(schema, 'multipleOf');
    if (multipleOf !== undefined && multipleOf > 0 && !isJsonSchemaMultiple(value, multipleOf)) return [`${path} must be a multiple of ${multipleOf}.`];
  }

  if (typeof value === 'string') {
    const minLength = readNonNegativeInteger(schema, 'minLength');
    if (minLength !== undefined && [...value].length < minLength) return [`${path} must contain at least ${minLength} characters.`];
    const maxLength = readNonNegativeInteger(schema, 'maxLength');
    if (maxLength !== undefined && [...value].length > maxLength) return [`${path} must contain at most ${maxLength} characters.`];
  }

  if (type === 'object' || (isJsonObject(value) && schema.properties !== undefined)) {
    if (!isJsonObject(value)) {
      return [`${path} must be object.`];
    }

    const required = readStringArray(schema, 'required') ?? [];
    for (const key of required) {
      if (!(key in value)) {
        return [`${path}.${key} is required.`];
      }
    }

    const properties = readSchemaMap(schema, 'properties');
    const descendantAncestors = new Set(ancestors);
    descendantAncestors.add(value);
    if (properties) {
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (key in value) {
          const errors = validateJsonValue(
            value[key] as JsonValue,
            propertySchema,
            `${path}.${key}`,
            root,
            state,
            descendantAncestors,
            new Set<string>(),
          );
          if (errors.length > 0) {
            return errors;
          }
        }
      }
    }

    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(properties ?? {}));
      const extra = Object.keys(value).find((key) => !allowed.has(key));
      if (extra) {
        return [`${path}.${extra} is not allowed by additionalProperties: false.`];
      }
    }

    const additionalPropertiesSchema = readSchema(schema, 'additionalProperties');
    if (additionalPropertiesSchema) {
      const allowed = new Set(Object.keys(properties ?? {}));
      for (const [key, propertyValue] of Object.entries(value)) {
        if (!allowed.has(key)) {
          const errors = validateJsonValue(
            propertyValue as JsonValue,
            additionalPropertiesSchema,
            `${path}.${key}`,
            root,
            state,
            descendantAncestors,
            new Set<string>(),
          );
          if (errors.length > 0) {
            return errors;
          }
        }
      }
    }
  }

  if (type === 'array') {
    if (!Array.isArray(value)) {
      return [`${path} must be array.`];
    }

    const minItems = readNonNegativeInteger(schema, 'minItems');
    if (minItems !== undefined && value.length < minItems) return [`${path} must contain at least ${minItems} items.`];
    const maxItems = readNonNegativeInteger(schema, 'maxItems');
    if (maxItems !== undefined && value.length > maxItems) return [`${path} must contain at most ${maxItems} items.`];
    if (schema.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) return [`${path} must contain unique items.`];

    const itemSchema = readSchema(schema, 'items');
    if (itemSchema) {
      const descendantAncestors = new Set(ancestors);
      descendantAncestors.add(value);
      for (const [index, item] of value.entries()) {
        const errors = validateJsonValue(
          item,
          itemSchema,
          `${path}[${index}]`,
          root,
          state,
          descendantAncestors,
          new Set<string>(),
        );
        if (errors.length > 0) {
          return errors;
        }
      }
    }
  }

  return [];
}

function unsupportedJsonSchemaDiagnostics(
  schema: JsonObject,
  path: string,
  root: JsonObject = schema,
  visitedReferences: Set<string> = new Set<string>(),
) {
  const diagnostics: Diagnostic[] = [];
  const supportedKeywords = new Set(['type', 'required', 'properties', 'items', 'enum', 'nullable', 'additionalProperties', 'description', 'title', 'default', 'examples', 'deprecated', '$schema', '$ref', '$defs', 'definitions', 'pattern', 'format', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'oneOf', 'anyOf', 'allOf', 'not', 'xKubernetesValidations']);
  for (const key of Object.keys(schema)) {
    if (!supportedKeywords.has(key)) {
      diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path} uses unsupported JSON Schema keyword ${key}.` });
    }
  }

  if ('$ref' in schema) {
    const reference = readString(schema, '$ref');
    const resolved = reference ? resolveLocalJsonSchemaReference(root, reference) : undefined;
    if (!reference || !reference.startsWith('#/') || !resolved) {
      diagnostics.push({
        severity: 'warning',
        code: 'SCHEMA_UNSUPPORTED',
        message: `${path}.$ref must resolve to a local JSON Schema object.`,
      });
    } else if (!visitedReferences.has(reference)) {
      visitedReferences.add(reference);
      diagnostics.push(...unsupportedJsonSchemaDiagnostics(
        resolved,
        `${path}.$ref(${reference})`,
        root,
        visitedReferences,
      ));
    }
  }

  for (const keyword of ['$defs', 'definitions'] as const) {
    if (keyword in schema && readSchemaMap(schema, keyword) === undefined) {
      diagnostics.push({
        severity: 'warning',
        code: 'SCHEMA_UNSUPPORTED',
        message: `${path}.${keyword} must be an object whose values are schemas.`,
      });
    }
  }

  for (const keyword of ['oneOf', 'anyOf', 'allOf'] as const) {
    if (keyword in schema && readSchemaArray(schema, keyword) === undefined) {
      diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path}.${keyword} must be a non-empty array of schema objects.` });
    }
  }
  if ('not' in schema && readSchema(schema, 'not') === undefined) {
    diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path}.not must be a schema object.` });
  }

  const type = schema.type;
  if (type !== undefined && (typeof type !== 'string' || !isSupportedJsonSchemaType(type))) {
    diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path}.type must be one of object, array, string, number, integer, or boolean.` });
  }

  if ('required' in schema && readStringArray(schema, 'required') === undefined) {
    diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path}.required must be an array of strings.` });
  }

  if ('properties' in schema && readSchemaMap(schema, 'properties') === undefined) {
    diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path}.properties must be an object whose values are schemas.` });
  }

  if ('items' in schema && readSchema(schema, 'items') === undefined) {
    diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path}.items must be a schema object.` });
  }

  if ('additionalProperties' in schema && typeof schema.additionalProperties !== 'boolean' && !isJsonObject(schema.additionalProperties)) {
    diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path}.additionalProperties must be boolean or a schema object.` });
  }

  if ('enum' in schema && readArray(schema, 'enum') === undefined) {
    diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path}.enum must be an array.` });
  }

  if ('nullable' in schema && typeof schema.nullable !== 'boolean') {
    diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path}.nullable must be boolean.` });
  }

  if ('pattern' in schema) {
    if (typeof schema.pattern !== 'string') {
      diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path}.pattern must be a string.` });
    } else {
      try { new RegExp(schema.pattern); } catch {
        diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path}.pattern must be a valid JavaScript regular expression.` });
      }
    }
  }

  if ('format' in schema) {
    const format = readString(schema, 'format');
    if (!format || !supportedRuntimeJsonSchemaFormats.has(format)) {
      diagnostics.push({
        severity: 'warning',
        code: 'SCHEMA_UNSUPPORTED',
        message: `${path}.format ${JSON.stringify(format ?? schema.format)} must be one of ${[...supportedRuntimeJsonSchemaFormats].join(', ')}.`,
      });
    }
  }

  for (const keyword of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'] as const) {
    if (keyword in schema && readNumber(schema, keyword) === undefined) {
      diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path}.${keyword} must be a finite number.` });
    }
  }
  if ('multipleOf' in schema && (readNumber(schema, 'multipleOf') ?? 0) <= 0) {
    diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path}.multipleOf must be greater than zero.` });
  }
  for (const keyword of ['minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
    if (keyword in schema && readNonNegativeInteger(schema, keyword) === undefined) {
      diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path}.${keyword} must be a non-negative integer.` });
    }
  }
  if ('uniqueItems' in schema && typeof schema.uniqueItems !== 'boolean') {
    diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path}.uniqueItems must be boolean.` });
  }
  if ('xKubernetesValidations' in schema) {
    const validations = schema.xKubernetesValidations;
    if (!Array.isArray(validations) || validations.length === 0 || validations.some((validation) =>
      !isJsonObject(validation)
      || typeof validation.rule !== 'string'
      || validation.rule.trim().length === 0
      || (validation.message !== undefined && typeof validation.message !== 'string')
    )) {
      diagnostics.push({ severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message: `${path}.xKubernetesValidations must be a non-empty array of CEL rule objects.` });
    }
  }

  const properties = readSchemaMap(schema, 'properties');
  if (properties) {
    for (const [key, propertySchema] of Object.entries(properties)) {
      diagnostics.push(...unsupportedJsonSchemaDiagnostics(propertySchema, `${path}.${key}`, root, visitedReferences));
    }
  }

  for (const keyword of ['$defs', 'definitions'] as const) {
    const definitions = readSchemaMap(schema, keyword);
    if (!definitions) continue;
    for (const [key, definition] of Object.entries(definitions)) {
      diagnostics.push(...unsupportedJsonSchemaDiagnostics(
        definition,
        `${path}.${keyword}.${key}`,
        root,
        visitedReferences,
      ));
    }
  }

  const itemSchema = readSchema(schema, 'items');
  if (itemSchema) {
    diagnostics.push(...unsupportedJsonSchemaDiagnostics(itemSchema, `${path}[]`, root, visitedReferences));
  }

  const additionalPropertiesSchema = readSchema(schema, 'additionalProperties');
  if (additionalPropertiesSchema) {
    diagnostics.push(...unsupportedJsonSchemaDiagnostics(additionalPropertiesSchema, `${path}.*`, root, visitedReferences));
  }
  for (const keyword of ['oneOf', 'anyOf', 'allOf'] as const) {
    const branches = readSchemaArray(schema, keyword);
    if (branches) {
      for (const [index, branch] of branches.entries()) {
        diagnostics.push(...unsupportedJsonSchemaDiagnostics(branch, `${path}.${keyword}[${index}]`, root, visitedReferences));
      }
    }
  }
  const excluded = readSchema(schema, 'not');
  if (excluded) {
    diagnostics.push(...unsupportedJsonSchemaDiagnostics(excluded, `${path}.not`, root, visitedReferences));
  }

  return diagnostics;
}

function resolveLocalJsonSchemaReference(
  root: JsonObject,
  reference: string,
): JsonObject | undefined {
  if (!reference.startsWith('#/')) return undefined;
  let current: JsonValue = root;
  for (const encoded of reference.slice(2).split('/')) {
    if (!isJsonObject(current)) return undefined;
    const segment = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
    const next: JsonValue | undefined = current[segment];
    if (next === undefined) return undefined;
    current = next;
  }
  return isJsonObject(current) ? current : undefined;
}

function schemaDiagnostic(message: string): Diagnostic {
  return { severity: 'warning', code: 'SCHEMA_UNSUPPORTED', message };
}

const supportedRuntimeJsonSchemaFormats = new Set([
  'uuid',
  'date-time',
  'int32',
  'int64',
]);

function validateJsonSchemaFormat(
  value: JsonValue,
  format: string,
  path: string,
): string | undefined {
  if (format === 'uuid' && typeof value === 'string') {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)
      ? undefined
      : `${path} must be a UUID.`;
  }
  if (format === 'date-time' && typeof value === 'string') {
    return isRfc3339DateTime(value)
      ? undefined
      : `${path} must be an RFC 3339 date-time.`;
  }
  if (format === 'int32' && typeof value === 'number') {
    return Number.isInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647
      ? undefined
      : `${path} must be a signed 32-bit integer.`;
  }
  if (format === 'int64' && typeof value === 'number') {
    return Number.isSafeInteger(value)
      ? undefined
      : `${path} must be a JSON-safe integer for the int64 format.`;
  }
  return undefined;
}

function isRfc3339DateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    return false;
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth && Number.isFinite(Date.parse(value));
}

function matchesJsonSchemaType(value: JsonValue, type: string): boolean {
  if (type === 'null') return value === null;
  switch (type) {
    case 'object':
      return isJsonObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

function isSupportedJsonSchemaType(type: string): boolean {
  return type === 'object' || type === 'array' || type === 'string' || type === 'number' || type === 'integer' || type === 'boolean' || type === 'null';
}

function readString(schema: JsonObject, key: string): string | undefined {
  const value = schema[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(schema: JsonObject, key: string): number | undefined {
  const value = schema[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readNonNegativeInteger(schema: JsonObject, key: string): number | undefined {
  const value = readNumber(schema, key);
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isJsonSchemaMultiple(value: number, multipleOf: number): boolean {
  const quotient = value / multipleOf;
  return Math.abs(quotient - Math.round(quotient)) <= Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8;
}

function readArray(schema: JsonObject, key: string): readonly JsonValue[] | undefined {
  const value = schema[key];
  return Array.isArray(value) ? value : undefined;
}

function readStringArray(schema: JsonObject, key: string): readonly string[] | undefined {
  const value = readArray(schema, key);
  return value?.every((item) => typeof item === 'string') ? value : undefined;
}

function readSchema(schema: JsonObject, key: string): JsonObject | undefined {
  const value = schema[key];
  return isJsonObject(value) ? value : undefined;
}

function readSchemaArray(
  schema: JsonObject,
  key: 'oneOf' | 'anyOf' | 'allOf',
): readonly JsonObject[] | undefined {
  const value = schema[key];
  return Array.isArray(value) && value.length > 0 && value.every(isJsonObject)
    ? value
    : undefined;
}

function readSchemaMap(schema: JsonObject, key: string): Readonly<Record<string, JsonObject>> | undefined {
  const value = schema[key];
  if (!isJsonObject(value)) {
    return undefined;
  }

  const entries = Object.entries(value);
  if (!entries.every(([, candidate]) => isJsonObject(candidate))) {
    return undefined;
  }

  // typecast: every value was checked to be a JSON object schema.
  return value as Readonly<Record<string, JsonObject>>;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cloneJson<T extends JsonValue>(value: T): T {
  // typecast: JSON parse/stringify preserves the JsonValue shape while detaching references.
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRuntimeSchema<T extends object>(input: SchemaInput<T>): input is RuntimeSchema<T> {
  return Boolean(input && typeof input === 'object' && 'validate' in input && 'emitOpenApiSchema' in input && 'emitJsonSchema' in input);
}

function isSchemaSource<T extends object>(input: SchemaInput<T>): input is ArkTypeSchemaSource<T> | JsonSchemaSource<T> | CustomSchemaSource<T> {
  return Boolean(input && typeof input === 'object' && 'kind' in input && 'ref' in input);
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err(code: Applik8sError['code'], message: string): Result<never> {
  return { ok: false, error: { code, message, severity: 'error', context: {} } };
}

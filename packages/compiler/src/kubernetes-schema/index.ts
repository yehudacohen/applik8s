import type { Diagnostic, JsonObject } from '@applik8s/core';

export function validateStructuralOpenApiSchema(schema: JsonObject, path: string): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  validateStructuralSchemaNode(schema, path, true, diagnostics);
  return diagnostics;
}

export function toKubernetesStructuralOpenApiSchema(schema: JsonObject): JsonObject {
  const normalized: Record<string, unknown> = { ...schema };
  if (isJsonObject(normalized.properties)) {
    const properties: Record<string, JsonObject> = {};
    for (const [key, value] of Object.entries(normalized.properties)) {
      if (isJsonObject(value)) {
        properties[key] = toKubernetesStructuralOpenApiSchema(value);
      }
    }
    normalized.properties = properties;
    if (typeof normalized.additionalProperties === 'boolean') {
      delete normalized.additionalProperties;
    }
  }
  if (isJsonObject(normalized.items)) {
    normalized.items = toKubernetesStructuralOpenApiSchema(normalized.items);
  }
  if (isJsonObject(normalized.additionalProperties)) {
    normalized.additionalProperties = toKubernetesStructuralOpenApiSchema(normalized.additionalProperties);
  }
  // typecast: normalization preserves JSON object shape while removing Kubernetes-forbidden schema fields.
  return normalized as JsonObject;
}

/**
 * Extends an already validated authored status schema with Applik8s-owned,
 * restart-safe runtime state. The reserved envelope is deliberately absent
 * from the user's TypeScript status type while both Kubernetes emitters share
 * this exact storage contract.
 */
export function withApplik8sFrameworkStatusSchema(
  schema: JsonObject,
  path: string,
): JsonObject {
  if (schema.type !== 'object') {
    throw new Error(`CRD schema ${path} must be an object for framework status.`);
  }
  const properties = isJsonObject(schema.properties)
    ? { ...schema.properties }
    : {};
  if (properties.applik8s !== undefined) {
    throw new Error(
      `CRD schema ${path}.applik8s is reserved for framework-owned status.`,
    );
  }
  properties.applik8s = {
    type: 'object',
    properties: {
      trackedExecutions: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            resourceUid: { type: 'string', minLength: 1 },
            resourceGeneration: {
              type: 'integer',
              format: 'int64',
              minimum: 1,
            },
            workflow: { type: 'string', minLength: 1 },
            workflowRevision: { type: 'string', minLength: 1 },
            run: { type: 'string', minLength: 1 },
            idempotencyKey: { type: 'string', minLength: 1 },
            phase: {
              type: 'string',
              enum: [
                'Admitted',
                'Running',
                'Succeeded',
                'Failed',
                'Cancelled',
                'TimedOut',
              ],
            },
            admittedAt: { type: 'string', format: 'date-time' },
            startedAt: { type: 'string', format: 'date-time' },
            finishedAt: { type: 'string', format: 'date-time' },
            progress: { 'x-kubernetes-preserve-unknown-fields': true },
            result: {
              type: 'object',
              'x-kubernetes-preserve-unknown-fields': true,
            },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                retryable: { type: 'boolean' },
              },
              required: ['code', 'message', 'retryable'],
            },
            onGenerationChange: {
              type: 'string',
              enum: ['supersede', 'cancel'],
            },
            onDelete: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['detach', 'cancel'] },
                timeoutMs: {
                  type: 'integer',
                  format: 'int64',
                  minimum: 1,
                },
                onTimeout: {
                  type: 'string',
                  enum: ['detach', 'block'],
                },
              },
              required: ['action'],
            },
            cancellationRequestedAt: {
              type: 'string',
              format: 'date-time',
            },
            detached: { type: 'boolean' },
            superseded: {
              type: 'object',
              properties: {
                resourceGeneration: {
                  type: 'integer',
                  format: 'int64',
                  minimum: 1,
                },
                workflow: { type: 'string', minLength: 1 },
                workflowRevision: { type: 'string', minLength: 1 },
                run: { type: 'string', minLength: 1 },
                phase: {
                  type: 'string',
                  enum: [
                    'Admitted',
                    'Running',
                    'Succeeded',
                    'Failed',
                    'Cancelled',
                    'TimedOut',
                  ],
                },
                supersededAt: { type: 'string', format: 'date-time' },
                cancellationRequested: { type: 'boolean' },
              },
              required: [
                'resourceGeneration',
                'workflow',
                'workflowRevision',
                'run',
                'phase',
                'supersededAt',
                'cancellationRequested',
              ],
            },
          },
          required: [
            'resourceUid',
            'resourceGeneration',
            'workflow',
            'workflowRevision',
            'run',
            'phase',
            'admittedAt',
            'onGenerationChange',
            'onDelete',
          ],
        },
      },
    },
  };
  return { ...schema, properties };
}

function validateStructuralSchemaNode(schema: JsonObject, path: string, root: boolean, diagnostics: Diagnostic[]): void {
  if ('oneOf' in schema || 'anyOf' in schema || 'allOf' in schema || 'not' in schema) {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path} uses composition keywords, which are not supported.`));
  }
  if (schema.default !== undefined) {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.default is not supported until defaulting/pruning semantics are explicit.`));
  }
  const preserveUnknownFields = schema['x-kubernetes-preserve-unknown-fields'];
  if (preserveUnknownFields !== undefined && typeof preserveUnknownFields !== 'boolean') {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.x-kubernetes-preserve-unknown-fields must be a boolean.`));
  }
  if (preserveUnknownFields === true) {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.x-kubernetes-preserve-unknown-fields: true is not supported until unknown-field retention semantics are explicit.`));
  }

  const type = schema.type;
  if (root && type !== 'object') {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path} root must declare type: object.`));
  }
  if (type !== undefined && typeof type !== 'string') {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.type must be a string.`));
  } else if (typeof type === 'string' && !isSupportedJsonSchemaType(type)) {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.type must be one of object, array, string, number, integer, or boolean.`));
  }
  if (schema.nullable !== undefined && typeof schema.nullable !== 'boolean') {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.nullable must be a boolean.`));
  }
  if (schema.nullable === true && type === undefined) {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.nullable requires an explicit type.`));
  }
  validateEnum(schema, path, diagnostics);

  const required = schema.required;
  if (required !== undefined && (!Array.isArray(required) || !required.every((item) => typeof item === 'string'))) {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.required must be an array of strings.`));
  }

  const properties = schema.properties;
  if (properties !== undefined) {
    if (!isJsonObject(properties)) {
      diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.properties must be an object.`));
    } else {
      if (Array.isArray(required)) {
        for (const requiredField of required) {
          if (!(requiredField in properties)) {
            diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.required includes ${requiredField}, but ${path}.properties.${requiredField} is not declared.`));
          }
        }
      }
      for (const [propertyName, propertySchema] of Object.entries(properties)) {
        if (!isKubernetesJsonFieldName(propertyName)) {
          diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.${propertyName} is not a Kubernetes-compatible JSON field name.`));
        }
        if (isJsonObject(propertySchema)) {
          validateStructuralSchemaNode(propertySchema, `${path}.${propertyName}`, false, diagnostics);
        } else {
          diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.${propertyName} must be an object schema.`));
        }
      }
    }
  }

  const items = schema.items;
  if (items !== undefined) {
    if (Array.isArray(items)) {
      diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.items must not be a tuple schema array.`));
    } else if (!isJsonObject(items)) {
      diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.items must be an object schema.`));
    } else {
      validateStructuralSchemaNode(items, `${path}[]`, false, diagnostics);
    }
  }
  if (type === 'array' && items === undefined) {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path} with type array must declare items.`));
  }

  const additionalProperties = schema.additionalProperties;
  if (additionalProperties !== undefined && typeof additionalProperties !== 'boolean') {
    if (!isJsonObject(additionalProperties)) {
      diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.additionalProperties must be boolean or an object schema.`));
    } else {
      validateStructuralSchemaNode(additionalProperties, `${path}.*`, false, diagnostics);
    }
  }
  if (type === 'object') {
    const hasProperties = isJsonObject(properties) && Object.keys(properties).length > 0;
    const hasMapSchema = isJsonObject(additionalProperties) || additionalProperties === true;
    if (!root && !hasProperties && !hasMapSchema) {
      diagnostics.push(kubernetesDiagnostic(`CRD schema ${path} object must declare properties or additionalProperties.`));
    }
  }
  validateKubernetesListExtensions(schema, path, diagnostics);
}

function validateEnum(schema: JsonObject, path: string, diagnostics: Diagnostic[]): void {
  const values = schema.enum;
  if (values === undefined) {
    return;
  }
  if (!Array.isArray(values) || values.length === 0) {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.enum must be a non-empty array.`));
    return;
  }
  const type = typeof schema.type === 'string' ? schema.type : undefined;
  if (type === undefined) {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.enum requires an explicit scalar type.`));
    return;
  }
  if (!['string', 'number', 'integer', 'boolean'].includes(type)) {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.enum is supported only for scalar string, number, integer, or boolean fields.`));
    return;
  }
  for (const value of values) {
    if (value === null && schema.nullable === true) {
      continue;
    }
    if (!enumValueMatchesType(value, type)) {
      diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.enum contains a value that does not match type ${type}.`));
      return;
    }
  }
}

function enumValueMatchesType(value: unknown, type: string): boolean {
  switch (type) {
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

function validateKubernetesListExtensions(schema: JsonObject, path: string, diagnostics: Diagnostic[]): void {
  const listType = schema['x-kubernetes-list-type'];
  const listMapKeys = schema['x-kubernetes-list-map-keys'];
  if (listType === undefined && listMapKeys === undefined) {
    return;
  }
  if (schema.type !== 'array') {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path} uses Kubernetes list extensions but is not type array.`));
    return;
  }
  if (listType !== undefined && !['atomic', 'set', 'map'].includes(String(listType))) {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.x-kubernetes-list-type must be atomic, set, or map.`));
  }
  if (listMapKeys === undefined) {
    return;
  }
  if (listType !== 'map') {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.x-kubernetes-list-map-keys requires x-kubernetes-list-type: map.`));
  }
  if (!Array.isArray(listMapKeys) || listMapKeys.length === 0 || !listMapKeys.every((item) => typeof item === 'string' && item.length > 0)) {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.x-kubernetes-list-map-keys must be a non-empty array of strings.`));
    return;
  }
  const itemProperties = isJsonObject(schema.items) && isJsonObject(schema.items.properties) ? schema.items.properties : undefined;
  if (!itemProperties) {
    diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.x-kubernetes-list-map-keys requires array items with object properties.`));
    return;
  }
  const required = isJsonObject(schema.items) && Array.isArray(schema.items.required) ? schema.items.required : undefined;
  for (const key of listMapKeys) {
    if (!(key in itemProperties)) {
      diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.x-kubernetes-list-map-keys references missing item property ${key}.`));
    } else if (!required?.includes(key)) {
      diagnostics.push(kubernetesDiagnostic(`CRD schema ${path}.x-kubernetes-list-map-keys references item property ${key}, but ${path}[].required does not require it.`));
    }
  }
}

function isSupportedJsonSchemaType(type: string): boolean {
  return type === 'object' || type === 'array' || type === 'string' || type === 'number' || type === 'integer' || type === 'boolean';
}

function isKubernetesJsonFieldName(name: string): boolean {
  return name.length > 0 && !name.startsWith('$') && !name.includes('.') && !name.includes('/');
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function kubernetesDiagnostic(message: string): Diagnostic {
  return { severity: 'error', code: 'MANIFEST_INVALID', message };
}

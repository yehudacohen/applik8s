import { canonicalJsonV1String } from '@applik8s/core';

export function boundedScheduleString(value: unknown, name: string, maximumLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength) {
    throw new Error(`applik8s-workflow-schedule-${name}-invalid`);
  }
  return value;
}

export function boundedCronExpression(value: unknown): string {
  const expression = boundedScheduleString(value, 'expression', 200);
  if (!/^([-0-9*/,]+\s+){4}[-0-9*/,]+$/.test(expression)) throw new Error('applik8s-workflow-schedule-expression-invalid');
  return expression;
}

export function boundedJsonObject(value: unknown, name: string, maximumBytes: number): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`applik8s-workflow-schedule-${name}-invalid`);
  let encoded: string;
  try {
    encoded = canonicalWorkflowJson(value);
  } catch (cause) {
    throw new Error(`applik8s-workflow-schedule-${name}-invalid`, { cause });
  }
  if (Buffer.byteLength(encoded) > maximumBytes) throw new Error(`applik8s-workflow-schedule-${name}-too-large`);
  const parsed: unknown = JSON.parse(encoded);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`applik8s-workflow-schedule-${name}-invalid`);
  // typecast: canonical JSON serialization plus the runtime object guard establishes the schedule-input transport shape.
  return parsed as Record<string, unknown>;
}

export function canonicalWorkflowJson(value: unknown): string {
  return canonicalJsonV1String(value);
}

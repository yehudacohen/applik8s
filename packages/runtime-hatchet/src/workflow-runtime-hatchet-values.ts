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
    encoded = canonicalJson(value);
  } catch (cause) {
    throw new Error(`applik8s-workflow-schedule-${name}-invalid`, { cause });
  }
  if (Buffer.byteLength(encoded) > maximumBytes) throw new Error(`applik8s-workflow-schedule-${name}-too-large`);
  const parsed: unknown = JSON.parse(encoded);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`applik8s-workflow-schedule-${name}-invalid`);
  // typecast: canonical JSON serialization plus the runtime object guard establishes the schedule-input transport shape.
  return parsed as Record<string, unknown>;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

function canonicalJsonValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== 'object') throw new Error('Value is not JSON-serializable.');
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, canonicalJsonValue(nested)]));
}

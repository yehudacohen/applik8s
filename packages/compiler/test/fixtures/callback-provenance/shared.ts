export function sharedProjection(
  kind: string,
  input: unknown,
  context: unknown,
) {
  return { kind, input, context };
}

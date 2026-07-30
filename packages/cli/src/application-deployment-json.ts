/** Fail closed before untyped cluster state crosses the deployment contract. */
export function assertDeploymentJson(value: unknown, path: string): void {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertDeploymentJson(entry, `${path}[${index}]`);
    }
    return;
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} contains a non-JSON object.`);
    }
    for (const [key, entry] of Object.entries(value)) {
      assertDeploymentJson(entry, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`${path} contains a non-JSON value.`);
}

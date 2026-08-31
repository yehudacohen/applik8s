export interface BoundedHttpSourceRetrieverOptions {
  readonly allowInsecureHttp?: boolean;
  readonly allowedPorts?: readonly number[];
  readonly maximumRedirects?: number;
  readonly timeoutMs?: number;
  readonly maximumBytes?: number;
  readonly userAgent?: string;
}

export function normalizeBoundedHttpSourceRetrieverOptions(
  options: BoundedHttpSourceRetrieverOptions,
): Readonly<Required<BoundedHttpSourceRetrieverOptions>> {
  const timeoutMs = boundedInteger(options.timeoutMs ?? 15_000, 100, 60_000, 'timeoutMs');
  const maximumBytes = boundedInteger(options.maximumBytes ?? 2_000_000, 1_024, 8_000_000, 'maximumBytes');
  const maximumRedirects = boundedInteger(options.maximumRedirects ?? 5, 0, 10, 'maximumRedirects');
  const allowedPorts = Object.freeze([...(options.allowedPorts ?? [80, 443])].map((port) => boundedInteger(port, 1, 65_535, 'allowed port')));
  const userAgent = options.userAgent?.trim() || 'applik8s-source-retriever/0.9';
  if (userAgent.length > 256 || /[\r\n]/u.test(userAgent)) throw new Error('Source retriever userAgent is invalid.');
  return Object.freeze({
    allowInsecureHttp: options.allowInsecureHttp ?? false,
    allowedPorts,
    maximumRedirects,
    timeoutMs,
    maximumBytes,
    userAgent,
  });
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Source retriever ${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

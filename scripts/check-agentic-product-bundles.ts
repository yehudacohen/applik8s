import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

interface AssetBudget {
  readonly maximumJavaScriptBytes: number;
  readonly maximumJavaScriptGzipBytes: number;
  readonly maximumChunkBytes: number;
  readonly maximumChunkGzipBytes: number;
  readonly maximumCssBytes: number;
  readonly maximumCssGzipBytes: number;
}

interface BundleBudget {
  readonly apiVersion: 'applik8s.agenticStartBundleBudget/v1alpha2';
  readonly client: AssetBudget;
  readonly server: Pick<AssetBudget,
    | 'maximumJavaScriptBytes'
    | 'maximumJavaScriptGzipBytes'
    | 'maximumChunkBytes'
    | 'maximumChunkGzipBytes'>;
  readonly tracedDependencies: Pick<AssetBudget,
    | 'maximumJavaScriptBytes'
    | 'maximumJavaScriptGzipBytes'
    | 'maximumChunkBytes'
    | 'maximumChunkGzipBytes'>;
}

export interface AgenticProductBundleReport {
  readonly javascriptBytes: number;
  readonly javascriptGzipBytes: number;
  readonly cssBytes: number;
  readonly cssGzipBytes: number;
  readonly largestChunk: {
    readonly name: string;
    readonly bytes: number;
    readonly gzipBytes: number;
  };
  readonly serverJavaScriptBytes: number;
  readonly serverJavaScriptGzipBytes: number;
  readonly largestServerChunk: {
    readonly name: string;
    readonly bytes: number;
    readonly gzipBytes: number;
  };
  readonly tracedDependencyJavaScriptBytes: number;
  readonly tracedDependencyJavaScriptGzipBytes: number;
  readonly largestTracedDependencyChunk?: {
    readonly name: string;
    readonly bytes: number;
    readonly gzipBytes: number;
  };
}

export async function checkAgenticProductBundles(
  generatedRoot: string,
  budgetPath = resolve('docs/v07-agentic-start-bundle-budget.json'),
): Promise<AgenticProductBundleReport> {
  // The version check below establishes the reviewed bundle-budget contract.
  // typecast: budget fields participate in release authority only after that check.
  const budget = JSON.parse(await readFile(budgetPath, 'utf8')) as BundleBudget;
  if (budget.apiVersion !== 'applik8s.agenticStartBundleBudget/v1alpha2') {
    throw new Error(`Unsupported Agentic Start bundle budget ${budget.apiVersion}.`);
  }
  const assetsRoot = join(generatedRoot, '.output/public/assets');
  const assets = await readdir(assetsRoot);
  const measured = await Promise.all(
    assets
      .filter(name => name.endsWith('.js') || name.endsWith('.css'))
      .map(async name => {
        const bytes = await readFile(join(assetsRoot, name));
        return { name, bytes: bytes.byteLength, gzipBytes: gzipSync(bytes).byteLength };
      }),
  );
  const javascript = measured.filter(asset => asset.name.endsWith('.js'));
  const styles = measured.filter(asset => asset.name.endsWith('.css'));
  if (javascript.length === 0) {
    throw new Error(`Agentic Start build produced no JavaScript assets in ${assetsRoot}.`);
  }
  const largestChunk = javascript.reduce((largest, asset) => (
    asset.bytes > largest.bytes ? asset : largest
  ));
  const serverRoot = join(generatedRoot, '.output/server');
  // Nitro's compiled output and its traced runtime dependencies have different
  // optimization semantics. Keep both visible and bounded without counting
  // copied dependencies twice as compiled chunks.
  const serverJavaScript = await measureJavaScriptTree(serverRoot, '', 'node_modules');
  const tracedDependencyJavaScript = await measureJavaScriptTree(join(serverRoot, 'node_modules'))
    .catch((error: unknown) => isMissingDirectory(error) ? [] : Promise.reject(error));
  if (serverJavaScript.length === 0) {
    throw new Error(`Agentic Start build produced no server JavaScript in ${serverRoot}.`);
  }
  const largestServerChunk = serverJavaScript.reduce((largest, asset) => (
    asset.bytes > largest.bytes ? asset : largest
  ));
  const largestTracedDependencyChunk = tracedDependencyJavaScript.length > 0
    ? tracedDependencyJavaScript.reduce((largest, asset) => (
      asset.bytes > largest.bytes ? asset : largest
    ))
    : undefined;
  const report = {
    javascriptBytes: sum(javascript.map(asset => asset.bytes)),
    javascriptGzipBytes: sum(javascript.map(asset => asset.gzipBytes)),
    cssBytes: sum(styles.map(asset => asset.bytes)),
    cssGzipBytes: sum(styles.map(asset => asset.gzipBytes)),
    largestChunk,
    serverJavaScriptBytes: sum(serverJavaScript.map(asset => asset.bytes)),
    serverJavaScriptGzipBytes: sum(serverJavaScript.map(asset => asset.gzipBytes)),
    largestServerChunk,
    tracedDependencyJavaScriptBytes: sum(tracedDependencyJavaScript.map(asset => asset.bytes)),
    tracedDependencyJavaScriptGzipBytes: sum(tracedDependencyJavaScript.map(asset => asset.gzipBytes)),
    ...(largestTracedDependencyChunk ? { largestTracedDependencyChunk } : {}),
  } satisfies AgenticProductBundleReport;
  const findings = [
    over(report.javascriptBytes, budget.client.maximumJavaScriptBytes, 'client JavaScript'),
    over(report.javascriptGzipBytes, budget.client.maximumJavaScriptGzipBytes, 'compressed client JavaScript'),
    over(report.largestChunk.bytes, budget.client.maximumChunkBytes, `largest chunk ${report.largestChunk.name}`),
    over(report.largestChunk.gzipBytes, budget.client.maximumChunkGzipBytes, `compressed largest chunk ${report.largestChunk.name}`),
    over(report.cssBytes, budget.client.maximumCssBytes, 'client CSS'),
    over(report.cssGzipBytes, budget.client.maximumCssGzipBytes, 'compressed client CSS'),
    over(report.serverJavaScriptBytes, budget.server.maximumJavaScriptBytes, 'server JavaScript'),
    over(report.serverJavaScriptGzipBytes, budget.server.maximumJavaScriptGzipBytes, 'compressed server JavaScript'),
    over(report.largestServerChunk.bytes, budget.server.maximumChunkBytes, `largest server chunk ${report.largestServerChunk.name}`),
    over(report.largestServerChunk.gzipBytes, budget.server.maximumChunkGzipBytes, `compressed largest server chunk ${report.largestServerChunk.name}`),
    over(report.tracedDependencyJavaScriptBytes, budget.tracedDependencies.maximumJavaScriptBytes, 'traced dependency JavaScript'),
    over(report.tracedDependencyJavaScriptGzipBytes, budget.tracedDependencies.maximumJavaScriptGzipBytes, 'compressed traced dependency JavaScript'),
    report.largestTracedDependencyChunk
      ? over(report.largestTracedDependencyChunk.bytes, budget.tracedDependencies.maximumChunkBytes, `largest traced dependency chunk ${report.largestTracedDependencyChunk.name}`)
      : undefined,
    report.largestTracedDependencyChunk
      ? over(report.largestTracedDependencyChunk.gzipBytes, budget.tracedDependencies.maximumChunkGzipBytes, `compressed largest traced dependency chunk ${report.largestTracedDependencyChunk.name}`)
      : undefined,
  ].filter((finding): finding is string => finding !== undefined);
  if (findings.length > 0) {
    throw new Error(`Agentic Start bundle budget failed:\n- ${findings.join('\n- ')}`);
  }
  return report;
}

async function measureJavaScriptTree(root: string, relative = '', excludedDirectory?: string): Promise<readonly {
  readonly name: string;
  readonly bytes: number;
  readonly gzipBytes: number;
}[]> {
  const directory = join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const measured = await Promise.all(entries.map(async entry => {
    if (entry.isDirectory() && entry.name === excludedDirectory) return [];
    const path = join(relative, entry.name);
    if (entry.isDirectory()) return measureJavaScriptTree(root, path, excludedDirectory);
    if (!entry.name.endsWith('.js') && !entry.name.endsWith('.mjs')) return [];
    const bytes = await readFile(join(root, path));
    return [{ name: path, bytes: bytes.byteLength, gzipBytes: gzipSync(bytes).byteLength }];
  }));
  return measured.flat();
}

function isMissingDirectory(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT');
}

function over(actual: number, maximum: number, label: string): string | undefined {
  return actual > maximum ? `${label} is ${actual} bytes; maximum is ${maximum}.` : undefined;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

if (import.meta.main) {
  const generatedRoot = process.argv[2];
  if (!generatedRoot) throw new Error('Usage: bun scripts/check-agentic-product-bundles.ts <generated-project>');
  const report = await checkAgenticProductBundles(resolve(generatedRoot));
  console.log(`Agentic Start bundle budget passed: client ${report.javascriptBytes} JS bytes (${report.javascriptGzipBytes} gzip), compiled server ${report.serverJavaScriptBytes} JS bytes (${report.serverJavaScriptGzipBytes} gzip), traced dependencies ${report.tracedDependencyJavaScriptBytes} JS bytes (${report.tracedDependencyJavaScriptGzipBytes} gzip); largest client ${report.largestChunk.name} is ${report.largestChunk.bytes} bytes (${report.largestChunk.gzipBytes} gzip), largest server ${report.largestServerChunk.name} is ${report.largestServerChunk.bytes} bytes (${report.largestServerChunk.gzipBytes} gzip)${report.largestTracedDependencyChunk ? `, largest traced dependency ${report.largestTracedDependencyChunk.name} is ${report.largestTracedDependencyChunk.bytes} bytes (${report.largestTracedDependencyChunk.gzipBytes} gzip)` : ''}.`);
}

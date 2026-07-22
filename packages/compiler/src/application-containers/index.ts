import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export interface GeneratedApplicationContainerArtifact {
  /** Literal image reference consumed by the generated Kubernetes workload. */
  readonly image: string;
  /** Registry-independent image name passed to TypeKro's container() primitive. */
  readonly imageName: string;
  readonly tag: string;
  readonly baseImage: string;
  readonly contextPath: string;
  readonly dockerfilePath: string;
  readonly entrypoint: string;
  readonly command: readonly string[];
  readonly sourceDigest: string;
}

/**
 * Turns a compiler-generated, build-time-complete JavaScript bundle into an
 * immutable OCI build input. Kubernetes resources reference the resulting
 * image; executable source is never transported through a ConfigMap.
 *
 * Building/publishing remains an explicit pre-deploy side effect. The CLI
 * lowers this artifact through TypeKro's async container() primitive, which
 * selects the concrete registry implementation for the deployment target.
 */
export async function emitGeneratedApplicationContainer(options: {
  readonly graphName: string;
  readonly workloadName: string;
  readonly role: string;
  readonly artifactDir: string;
  readonly sourcePath: string;
  readonly sourceMapPath?: string;
  /**
   * Include the external source map in the runtime image. Source maps remain
   * available as compiler artifacts when this is false. Runtime inclusion is
   * opt-in because generated Node commands do not enable source-map loading,
   * and maps can materially increase image size and source disclosure.
   */
  readonly includeSourceMap?: boolean;
  /** Filename inside destinationDirectory. Defaults to the source basename. */
  readonly destinationFileName?: string;
  readonly entrypoint: string;
  readonly command?: readonly string[];
  readonly destinationDirectory?: string;
  readonly baseImage: string;
  readonly sourceDigest: string;
}): Promise<GeneratedApplicationContainerArtifact> {
  if (!/@sha256:[a-f0-9]{64}$/.test(options.baseImage)) {
    throw new Error(`Generated application container base image ${options.baseImage} must be pinned by a full sha256 digest.`);
  }
  const contextPath = join(options.artifactDir, 'container');
  const dockerfilePath = join(contextPath, 'Dockerfile');
  const sourceFile = basename(options.sourcePath);
  const destinationFile = options.destinationFileName ?? sourceFile;
  if (!destinationFile || basename(destinationFile) !== destinationFile || destinationFile === '.' || destinationFile === '..') {
    throw new Error(`Generated container destination filename ${destinationFile} must be a plain filename.`);
  }
  const sourceMapFile = options.includeSourceMap && options.sourceMapPath ? basename(options.sourceMapPath) : undefined;
  const destinationDirectory = options.destinationDirectory ?? '/app';
  const command = options.command ?? ['node', options.entrypoint];
  // Container contexts are compiler-owned outputs. Recreate the directory so
  // a prior opt-in source map or renamed entrypoint cannot leak into a later
  // build or inflate local artifact evidence.
  await rm(contextPath, { recursive: true, force: true });
  await mkdir(contextPath, { recursive: true });
  await copyFile(options.sourcePath, join(contextPath, sourceFile));
  if (options.sourceMapPath && sourceMapFile) await copyFile(options.sourceMapPath, join(contextPath, sourceMapFile));

  const dockerfile = generatedContainerDockerfile({
    baseImage: options.baseImage,
    sourceFile,
    destinationFile,
    ...(sourceMapFile ? { sourceMapFile } : {}),
    destinationDirectory,
    command,
  });
  const sourceMap = sourceMapFile && options.sourceMapPath ? await readFile(options.sourceMapPath) : undefined;
  const imageName = containerImageName(options.graphName, options.role, options.workloadName);
  const buildInputDigest = createHash('sha256')
    .update(options.sourceDigest)
    .update('\0')
    .update(dockerfile)
    .update('\0')
    .update(sourceMap ?? '')
    .digest('hex');
  const tag = `sha-${buildInputDigest}`;
  const image = `${imageName}:${tag}`;
  await writeFile(dockerfilePath, dockerfile);
  await writeFile(join(contextPath, '.dockerignore'), ['*', `!${sourceFile}`, ...(sourceMapFile ? [`!${sourceMapFile}`] : []), '!Dockerfile', '!.dockerignore', ''].join('\n'));
  return { image, imageName, tag, baseImage: options.baseImage, contextPath, dockerfilePath, entrypoint: options.entrypoint, command, sourceDigest: `sha256:${buildInputDigest}` };
}

function generatedContainerDockerfile(options: { readonly baseImage: string; readonly sourceFile: string; readonly destinationFile: string; readonly sourceMapFile?: string; readonly destinationDirectory: string; readonly command: readonly string[] }): string {
  const baseImageArgument = ['$', '{APPLIK8S_BASE_IMAGE}'].join('');
  return [
    `ARG APPLIK8S_BASE_IMAGE=${options.baseImage}`,
    `FROM ${baseImageArgument}`,
    `WORKDIR ${options.destinationDirectory}`,
    `COPY --chown=1000:1000 ${options.sourceFile} ${options.destinationDirectory}/${options.destinationFile}`,
    ...(options.sourceMapFile ? [`COPY --chown=1000:1000 ${options.sourceMapFile} ${options.destinationDirectory}/${options.sourceMapFile}`] : []),
    'USER 1000:1000',
    `CMD ${JSON.stringify(options.command)}`,
    '',
  ].join('\n');
}

function containerImageName(graphName: string, role: string, workloadName: string): string {
  const segment = (value: string) => value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '') || 'application';
  return `applik8s/${segment(graphName)}-${segment(role)}-${segment(workloadName)}`;
}

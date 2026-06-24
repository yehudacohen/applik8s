export interface ImageRef {
  readonly registry?: string;
  readonly repository: string;
  readonly tag?: string;
  readonly digest?: string;
}

export type ImageRefInput = string | ImageRef;

export interface BuildRecipe {
  readonly context: string;
  readonly dockerfile?: string;
  readonly target?: string;
  readonly platforms?: readonly string[];
  readonly tags?: readonly string[];
  readonly labels?: Readonly<Record<string, string>>;
  readonly buildArgs?: Readonly<Record<string, string>>;
}

export interface ContainerFile {
  readonly source: string;
  readonly destination: string;
  readonly mode?: string;
}

export interface PublishRecipe {
  readonly enabled: boolean;
  readonly registry?: string;
  readonly repository?: string;
  readonly tags?: readonly string[];
}

export interface ContainerRecipe {
  readonly image: ImageRefInput;
  readonly baseImage?: ImageRefInput;
  readonly files?: readonly ContainerFile[];
  readonly build?: BuildRecipe;
  readonly publish?: PublishRecipe;
}

export interface ContainerArtifact {
  readonly image: ImageRef;
  readonly digest?: string;
  readonly build?: BuildRecipe;
  readonly publish?: PublishRecipe;
}

export function imageRef(input: ImageRefInput): ImageRef {
  if (typeof input !== 'string') {
    return input;
  }

  const [rawWithoutDigest, digest] = input.split('@');
  const withoutDigest = rawWithoutDigest ?? '';
  const lastSlash = withoutDigest.lastIndexOf('/');
  const lastColon = withoutDigest.lastIndexOf(':');
  const hasTag = lastColon > lastSlash;
  const name = hasTag ? withoutDigest.slice(0, lastColon) : withoutDigest;
  const tag = hasTag ? withoutDigest.slice(lastColon + 1) : undefined;
  const parts = name.split('/');
  const first = parts[0] ?? '';
  const hasRegistry = Boolean(first && (first.includes('.') || first.includes(':') || first === 'localhost') && parts.length > 1);
  const registry = hasRegistry ? first : undefined;
  const repository = hasRegistry ? parts.slice(1).join('/') : name;

  return {
    ...(registry ? { registry } : {}),
    repository,
    ...(tag ? { tag } : {}),
    ...(digest ? { digest } : {}),
  };
}

export function imageRefString(input: ImageRefInput): string {
  const ref = imageRef(input);
  const name = ref.registry ? `${ref.registry}/${ref.repository}` : ref.repository;
  const tagged = ref.tag ? `${name}:${ref.tag}` : name;
  return ref.digest ? `${tagged}@${ref.digest}` : tagged;
}

export function containerArtifact(recipe: ContainerRecipe): ContainerArtifact {
  return {
    image: imageRef(recipe.image),
    ...(recipe.baseImage ? { baseImage: imageRef(recipe.baseImage) } : {}),
    ...(recipe.files ? { files: recipe.files } : {}),
    ...(recipe.build ? { build: recipe.build } : {}),
    ...(recipe.publish ? { publish: recipe.publish } : {}),
  };
}

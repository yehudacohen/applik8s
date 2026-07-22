export const publishablePackageNames = Object.freeze([
  'applik8s',
  'client',
  'react',
  'server',
  'vite',
  'tanstack-start',
  'core',
  'sdk',
  'compiler',
  'runtime-contract',
  'runtime',
  'testing',
  'typekro-adapter',
  'typetainer',
]);

export const publishablePackageDirectories = Object.freeze(
  publishablePackageNames.map((name) => `packages/${name}`),
);

export const publishablePackageManifestPaths = Object.freeze(
  publishablePackageDirectories.map((directory) => `${directory}/package.json`),
);

const publishOrder = [
  'core',
  'runtime-contract',
  'typetainer',
  'sdk',
  'compiler',
  'testing',
  'runtime',
  'typekro-adapter',
  'client',
  'react',
  'server',
  'vite',
  'tanstack-start',
  'applik8s',
];

if (publishOrder.length !== publishablePackageNames.length || publishOrder.some((name) => !publishablePackageNames.includes(name))) {
  throw new Error('The Applik8s publish order must contain every publishable package exactly once.');
}

export const publishOrderDirectories = Object.freeze(publishOrder.map((name) => `packages/${name}`));

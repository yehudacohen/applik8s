import { module } from '@applik8s/applik8s';
import {
  applicationArtifacts,
  applicationArtifactSchema,
} from './schema.js';

export * from './schema.js';
export * from './queries.js';

function installArtifacts() {
  return { Artifact: applicationArtifacts };
}

export const artifacts = module(
  'artifacts',
  { schema: applicationArtifactSchema },
  installArtifacts,
);

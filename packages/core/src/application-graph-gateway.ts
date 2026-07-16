import type { SourceLocation } from './common.js';
import type {
  ApplicationGraphNodeRef,
  ApplicationMessageContractSchema,
  ApplicationResourceRef,
} from './application-graph.js';

export interface ApplicationHandlerDependencies {
  readonly source: string;
  readonly resolveDir: string;
}

export interface ApplicationSerializedCallbackContract {
  readonly source: string;
  readonly dependencies?: ApplicationHandlerDependencies;
  readonly location?: SourceLocation;
  readonly unresolved?: readonly string[];
}

/** Declarative Kubernetes snapshot/watch authority for a public query. */
export interface ApplicationKubernetesQueryAuthorityContract {
  readonly kind: 'kubernetes-list-watch';
  readonly model: ApplicationGraphNodeRef;
  readonly resource: ApplicationResourceRef & {
    readonly plural: string;
    readonly scope: 'Namespaced' | 'Cluster';
  };
  readonly namespace?: string;
  readonly namespaceResolver?: ApplicationSerializedCallbackContract;
  readonly labelSelector?: ApplicationSerializedCallbackContract;
  readonly fieldSelector?: ApplicationSerializedCallbackContract;
  readonly filter?: ApplicationSerializedCallbackContract;
  readonly compare?: ApplicationSerializedCallbackContract;
  readonly project: ApplicationSerializedCallbackContract;
  readonly limit?: ApplicationSerializedCallbackContract;
  readonly pageSize: number;
  readonly maxPages: number;
  readonly maxItems: number;
}

export interface ApplicationKubernetesCreateAuthorityContract {
  readonly kind: 'kubernetes-create';
  readonly input: ApplicationMessageContractSchema;
  readonly authorize: ApplicationSerializedCallbackContract;
  readonly place: ApplicationSerializedCallbackContract;
}

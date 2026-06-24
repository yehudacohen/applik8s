import type { OperatorDefinition, Result } from '@applik8s/core';

export interface OperatorDiscoveryRequest {
  readonly entrypoint: string;
}

export interface OperatorDiscoveryResult {
  readonly operators: readonly OperatorDefinition[];
}

export interface OperatorDiscovery {
  discover(request: OperatorDiscoveryRequest): Promise<Result<OperatorDiscoveryResult>>;
}

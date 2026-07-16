import {
  ApplicationCommandClient,
  ApplicationQueryClient,
  createHttpApplicationCommandTransport,
  createHttpApplicationQueryTransport,
  installApplicationOperationRuntime,
  type ApplicationOperationContract,
  type ApplicationQuerySnapshot,
} from '@applik8s/client';
import {
  ApplicationCommandClientProvider,
  ApplicationQueryClientProvider,
} from '@applik8s/react';
import { createElement, useEffect, useMemo, type ReactNode } from 'react';

export interface Applik8sStartProviderProps {
  readonly children?: ReactNode;
  readonly baseUrl?: string;
  readonly dehydrated?: readonly ApplicationQuerySnapshot[];
  readonly queryClient?: ApplicationQueryClient;
  readonly commandClient?: ApplicationCommandClient;
}

/**
 * Installs the same-origin browser authority for generated model facades.
 * Provider SDKs, Kubernetes clients, Drizzle, TypeKro, and credentials never cross this boundary.
 */
export function Applik8sStartProvider(props: Applik8sStartProviderProps): ReactNode {
  const baseUrl = props.baseUrl ?? '/__applik8s/v1';
  const queryClient = useMemo(
    () => props.queryClient ?? new ApplicationQueryClient(createHttpApplicationQueryTransport({ baseUrl })),
    [baseUrl, props.queryClient],
  );
  const commandClient = useMemo(
    () => props.commandClient ?? new ApplicationCommandClient(createHttpApplicationCommandTransport({ baseUrl })),
    [baseUrl, props.commandClient],
  );
  useMemo(() => {
    if (props.dehydrated) queryClient.hydrate(props.dehydrated);
  }, [props.dehydrated, queryClient]);
  useEffect(
    () => installApplicationOperationRuntime({
      execute(operation, input) {
        if (operation.transport !== 'command') {
          throw new Error(`Direct browser operation ${operation.id} uses unsupported ${operation.transport} transport.`);
        }
        return commandClient.execute(operation.id, input);
      },
      async snapshotQuery<TInput, TValue>(operation: ApplicationOperationContract, input: TInput): Promise<ApplicationQuerySnapshot<TValue>> {
        if (operation.transport !== 'query') {
          throw new Error(`Direct browser preload ${operation.id} uses unsupported ${operation.transport} transport.`);
        }
        const snapshot = await queryClient.transport.snapshot<TInput, TValue>(operation.id, input);
        queryClient.hydrate([snapshot]);
        return snapshot;
      },
    }),
    [commandClient, queryClient],
  );
  return createElement(
    ApplicationQueryClientProvider,
    { client: queryClient },
    createElement(ApplicationCommandClientProvider, { client: commandClient }, props.children),
  );
}

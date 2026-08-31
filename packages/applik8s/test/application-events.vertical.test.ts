// typecast-file-boundary: Event fixtures deliberately erase handler generics while verifying the public callback and dispatch contracts.
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  bindApplicationCallableDependencies,
  bindApplicationProviderDependencies,
  bindApplicationProviderOperation,
} from '../src/application-provider-runtime.js';
import { app, applicationGraphFor, defineApplicationProvider, KubernetesCluster, ManagedModelStore, OperatorRuntime, sdk } from '../src/index.js';

describe('application-native Kubernetes lifecycle handlers', () => {
  it('groups resource-owned events into one inferred operator and preserves finalizer metadata', () => {
    const application = app('events', { namespace: 'events' });
    const WidgetDependency = sdk.kubernetes.resource({
      apiVersion: 'config.example/v1alpha1',
      kind: 'WidgetDependency',
      plural: 'widgetdependencies',
      namespaces: ['events'],
    });
    const Widget = application.resource('Widget', {
      apiVersion: 'widgets.example/v1alpha1',
      spec: type({ name: 'string' }),
      status: type({ 'phase?': 'string' }),
      controller: {
        name: 'widgets-controller',
        scope: 'Cluster',
        reads: { WidgetDependency },
        secondaryWatches: (resource) => [
          sdk.watch(WidgetDependency).enqueue(resource, {
            namespace: 'source',
            map: {
              mode: 'targetNameFromSourceField',
              source: { kind: 'label', key: 'widgets.example/name' },
            },
          }),
        ],
        permissions: [{ apiGroups: [''], resources: ['namespaces'], verbs: ['get'] }],
      },
    });
    Widget.on.created(async (widget) => { widget.status.phase = 'Ready'; });
    Widget.on.updated(async (widget) => { widget.status.phase = 'Updated'; });
    Widget.on.finalize(
      async (widget) => { widget.status.phase = 'Deleting'; },
      { finalizer: 'widgets.example/cleanup' },
    );

    // typecast: inspect the heterogeneous generated installation through the exact controller fields under test.
    const installation = application.operatorInstalls[0] as
      | { readonly operator?: {
          readonly handlers?: ReadonlyArray<{ readonly event: string; readonly finalizers?: readonly string[] }>;
          readonly permissions?: readonly unknown[];
          readonly reads?: Readonly<Record<string, unknown>>;
          readonly secondaryWatches?: readonly unknown[];
        }; readonly operatorName?: string }
      | undefined;
    expect(installation?.operator?.handlers?.map((handler) => handler.event)).toEqual(['created', 'updated', 'finalize']);
    expect(installation?.operator?.handlers?.[2]?.finalizers).toEqual(['widgets.example/cleanup']);
    expect(installation?.operatorName).toBe('widgets-controller');
    expect(installation?.operator?.reads).toEqual({ WidgetDependency });
    expect(installation?.operator?.secondaryWatches).toHaveLength(1);
    expect(installation?.operator?.permissions).toEqual(expect.arrayContaining([
      { apiGroups: [''], resources: ['namespaces'], verbs: ['get'] },
    ]));
    const graph = applicationGraphFor(application.composition);
    const widgetNode = graph?.nodes.find(candidate => candidate.kind === 'crd' && candidate.name === 'Widget');
    expect(widgetNode && widgetNode.kind === 'crd' ? widgetNode.managed?.finalizers : undefined).toMatchObject([
      { name: 'widgets.example/cleanup' },
    ]);
    expect(graph?.providerRequirements.filter(requirement => requirement.consumer.nodeId === widgetNode?.id).map(requirement => requirement.interface).sort()).toEqual([
      'ManagedModelStore',
      'OperatorRuntime',
    ]);
  });

  it('does not expose application-level lifecycle or reconciliation aliases', () => {
    const application = app('empty-events');
    const Widget = application.resource('Widget', {
      apiVersion: 'widgets.example/v1alpha1',
      spec: type({ name: 'string' }),
    });
    expect(Widget.status).toBeDefined();
    expect(Widget.statusSubresource).toBe(true);
    expect('on' in application).toBe(false);
    expect('reconcile' in application).toBe(false);
    const node = applicationGraphFor(application.composition)?.nodes.find(candidate => candidate.kind === 'crd' && candidate.name === 'Widget');
    expect(node && node.kind === 'crd' ? node.managed : undefined).toBeUndefined();
    // @ts-expect-error Resource.on.* is the only public Kubernetes lifecycle registration surface.
    void application.on;
    // @ts-expect-error Resource.on.reconcile(...) is the only public continuous-reconciliation surface.
    void application.reconcile;
  });

  it('uses one provider-neutral reconcile view for Kubernetes-backed models', () => {
    const application = app('portable-kubernetes-model', { namespace: 'portable' });
    const Workspace = application.crd('Workspace', {
      apiVersion: 'workspaces.example/v1alpha1',
      spec: type({ version: 'string' }),
      status: type({ phase: "'Pending' | 'Ready'" }),
    });
    application.provide(
      Workspace.store,
      ManagedModelStore.kubernetes({ cluster: KubernetesCluster.current() }),
    );
    application.provide(
      OperatorRuntime,
      OperatorRuntime.kubernetes({ cluster: KubernetesCluster.current() }),
    );

    Workspace.on.reconcile(async (workspace, context) => {
      expect(workspace.id).toBeTypeOf('string');
      expect(workspace.value.version).toBeTypeOf('string');
      await workspace.status.update({ phase: 'Ready' });
      await workspace.conditions.set({
        type: 'Ready',
        status: 'True',
        reason: 'Converged',
        message: 'Workspace is ready.',
      });
      return context.requeueAfter('5m');
    });

    expect(Workspace.statusConvention).toEqual({
      ownership: 'handlerAuthoritative',
      observedGenerationField: 'observedGeneration',
      conditionsField: 'conditions',
    });
    expect(Workspace.store.qualification.name).toBe('workspace');
    expect(application.operatorInstalls).toHaveLength(1);
    const node = applicationGraphFor(application.composition)?.nodes.find(
      candidate => candidate.kind === 'crd' && candidate.name === 'Workspace',
    );
    expect(node && node.kind === 'crd' ? node.managed : undefined).toMatchObject({
      statusSchemaVersion: 'kubernetes-resource-status-v1',
      store: { interface: 'ManagedModelStore' },
      runtime: { interface: 'OperatorRuntime' },
      lifecycle: {
        generation: 'kubernetesMetadataGeneration',
        lease: { fencing: 'uidGenerationResourceVersion' },
        status: 'schemaCompleteCompareAndSet',
        deletion: 'intentThenFinalize',
      },
      activation: 'providerNative',
    });
    expect(node && node.kind === 'crd' ? node.managed?.reconcile?.handlerSource : undefined).toContain('workspace.status.update');
  });

  it('internalizes narrowly scoped tracking-finalizer authority for resource-native handlers', () => {
    const application = app('tracked-events', { namespace: 'tracked-events' });
    const WorkflowJob = application.resource('WorkflowJob', {
      apiVersion: 'workflows.example/v1alpha1',
      spec: type({ proofId: 'string' }),
      status: type({ 'phase?': 'string' }),
    });

    WorkflowJob.on.reconcile(async (job) => {
      job.status.phase = 'Ready';
    });

    // typecast: inspect heterogeneous generated operator-install evidence exposed by the application composition.
    const installation = application.operatorInstalls[0] as
      | { readonly operator?: { readonly handlers?: ReadonlyArray<{ readonly permissions?: readonly unknown[] }> } }
      | undefined;
    expect(installation?.operator?.handlers?.[0]?.permissions).toEqual([
      {
        apiGroups: ['workflows.example'],
        resources: ['workflowjobs'],
        scope: 'Namespaced',
        verbs: ['patch'],
      },
      {
        apiGroups: ['workflows.example'],
        resources: ['workflowjobs/finalizers'],
        scope: 'Namespaced',
        verbs: ['patch', 'update'],
      },
    ]);
  });

  it('fails closed when a resource reconciler captures a provider operation that lacks a host-mediated WASM bridge', () => {
    const application = app('provider-reconciler', {
      namespace: 'provider-reconciler',
    });
    const Widget = application.resource('Widget', {
      apiVersion: 'widgets.example/v1alpha1',
      spec: type({ id: 'string' }),
      status: type({ 'phase?': 'string' }),
      controller: { name: 'widgets-controller' },
    });
    const AcquisitionProvider = defineApplicationProvider({
      interface: 'ReconcilerAcquisitionProvider',
      version: 'v1alpha1',
      accepts: (candidate): candidate is { readonly kind: 'acquisition' } =>
        Boolean(candidate && typeof candidate === 'object' && Reflect.get(candidate, 'kind') === 'acquisition'),
    }).named('primary');
    const acquire = bindApplicationProviderOperation(
      bindApplicationProviderDependencies(
        async (_input: { readonly id: string }) => ({ value: 'unused' }),
        [AcquisitionProvider],
      ),
      {
        member: 'acquire',
        runtime: {
          module: '@fixture/acquisition/runtime',
          export: 'acquireItem',
          access: {
            kind: 'provider',
            operations: ['connection.use', 'network.connect'],
          },
        },
      },
    );
    const acquireThroughHelper = bindApplicationCallableDependencies(
      async (id: string) => acquire({ id }),
      [{ identifier: 'acquire', value: acquire }],
    );
    const reconcile = bindApplicationCallableDependencies(
      async (widget: { readonly spec: { readonly id: string } }) => {
        await acquireThroughHelper(widget.spec.id);
      },
      [{ identifier: 'acquireThroughHelper', value: acquireThroughHelper }],
    );

    expect(() => Widget.on.reconcile(reconcile as never)).toThrow(
      /Resource controller widgets-controller cannot call provider operation.*acquire.*ReconcilerAcquisitionProvider\.acquire.*componentized WASM.*host-mediated provider operation.*Stream\.onEvent/s,
    );
    expect(application.operatorInstalls).toHaveLength(0);
  });
});
// typecast-file-boundary: Event fixtures deliberately erase handler generics while verifying the public callback and dispatch contracts.

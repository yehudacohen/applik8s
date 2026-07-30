import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { app } from '../src/index.js';

describe('application-native Kubernetes lifecycle handlers', () => {
  it('groups explicit events into one app-owned operator and preserves finalizer metadata', () => {
    const application = app('events', { namespace: 'events' });
    const Widget = application.resource('Widget', {
      apiVersion: 'widgets.example/v1alpha1',
      spec: type({ name: 'string' }),
      status: type({ 'phase?': 'string' }),
    });
    // typecast: inspect the stable public handler projection without coupling to the full generic operator type.
    const deployed = application.on(Widget, {
      created: async (widget) => { widget.status.phase = 'Ready'; },
      updated: async (widget) => { widget.status.phase = 'Updated'; },
      finalize: {
        finalizer: 'widgets.example/cleanup',
        handler: async (widget) => { widget.status.phase = 'Deleting'; },
      },
    }) as { readonly definition: { readonly handlers: ReadonlyArray<{ readonly event: string; readonly finalizers?: readonly string[] }> } };

    expect(deployed.definition.handlers.map((handler) => handler.event)).toEqual(['created', 'updated', 'finalize']);
    expect(deployed.definition.handlers[2]?.finalizers).toEqual(['widgets.example/cleanup']);
  });

  it('fails closed when a controller declares no lifecycle event', () => {
    const application = app('empty-events');
    const Widget = application.resource('Widget', {
      apiVersion: 'widgets.example/v1alpha1',
      spec: type({ name: 'string' }),
    });
    expect(() => application.on(Widget, {})).toThrow(/at least one lifecycle handler/);
  });
});

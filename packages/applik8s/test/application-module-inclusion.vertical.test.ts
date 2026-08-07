import { describe, expect, expectTypeOf, it } from 'vitest';
import { type } from 'arktype';
import {
  app,
  applicationGraphFor,
  defineApplicationModule,
  module,
} from '../src/index.js';
import { field, model } from '../src/drizzle.js';

describe('application module inclusion', () => {
  it('installs named modules once and resolves nested module dependencies', () => {
    const application = app('module-fixture');
    let dependencyInstalls = 0;
    let featureInstalls = 0;

    function dependency(target: typeof application) {
      dependencyInstalls += 1;
      return target.config('dependency', {});
    }

    function feature(target: typeof application) {
      featureInstalls += 1;
      return Object.freeze({
        dependency: target.include(dependency),
      });
    }

    const first = application.include(feature);
    const second = application.include(feature);

    expect(first).toBe(second);
    expect(dependencyInstalls).toBe(1);
    expect(featureInstalls).toBe(1);
    expect(applicationGraphFor(application.composition)?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'config',
          name: 'dependency',
        }),
      ]),
    );
  });

  it('fails closed for recursive module inclusion', () => {
    const application = app('module-cycle-fixture');

    function alpha(target: typeof application): unknown {
      return target.include(beta);
    }

    function beta(target: typeof application): unknown {
      return target.include(alpha);
    }

    expect(() => application.include(alpha)).toThrow(
      'module inclusion cycle: alpha -> beta -> alpha',
    );
  });

  it('declares an application-owned CRD without a separate entity value', () => {
    const application = app('named-crd-fixture');
    const ImportJob = application.crd('ImportJob', {
      apiVersion: 'imports.example.dev/v1alpha1',
      spec: type({ source: 'string' }),
      status: type({ phase: "'Pending' | 'Ready'" }),
    });

    ImportJob.on.reconcile(async (resource) => {
      resource.status.phase = 'Ready';
    });

    expect(ImportJob.kind).toBe('ImportJob');
    expect(ImportJob.apiVersion).toBe('imports.example.dev/v1alpha1');
    expect(applicationGraphFor(application.composition)?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'crd', name: 'ImportJob' }),
        expect.objectContaining({ kind: 'operator' }),
      ]),
    );
  });

  it('promotes a module model exactly once when its schema joins the bound database', () => {
    const application = app('module-model-fixture');
    application.database.postgres('application', { schema: {} });
    const Note = model('notes', {
      id: field.uuid('id').defaultRandom().primaryKey(),
      body: field.text('body').notNull(),
    });
    const notes = defineApplicationModule(
      function installNotes() {
        throw new Error('Include notes through application.include(notes).');
      },
      {
        name: 'notes',
        schema: { Note },
        install() {
          return Object.freeze({ Note });
        },
      },
    );

    const included = application.include(notes);

    expect(included.Note).toBe(Note);
    expect(Note.$model.name).toBe('Note');
    expect(Note.$model.database).toBe('application');
    expect(Note.create).toBeTypeOf('function');
    expect(applicationGraphFor(application.composition)?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'model', name: 'Note' }),
      ]),
    );
  });

  it('infers callback-native exports, freezes them, and installs once per application', () => {
    const firstApplication = app('callback-module-first');
    const secondApplication = app('callback-module-second');
    firstApplication.database.postgres('application', { schema: {} });
    secondApplication.database.postgres('application', { schema: {} });
    const Note = model('callback_notes', {
      id: field.uuid('id').defaultRandom().primaryKey(),
      body: field.text('body').notNull(),
    });
    let installs = 0;
    const notes = module('callback-notes', (application) => {
      installs += 1;
      const Reader = application.role('callback-note-reader');
      return { Note, Reader };
    });

    const first = firstApplication.include(notes);
    const same = firstApplication.include(notes);
    const second = secondApplication.include(notes);

    expect(first).toBe(same);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(installs).toBe(2);
    expect(first.Note).toBe(Note);
    expectTypeOf(first.Note).toEqualTypeOf<typeof Note>();
    expect(Note.$model.database).toBe('application');
  });

  it('binds explicit module schema before setup and rejects invalid exports', () => {
    const application = app('callback-module-explicit-schema');
    application.database.postgres('application', { schema: {} });
    const Note = model('explicit_notes', {
      id: field.uuid('id').defaultRandom().primaryKey(),
    });
    const notes = module(
      'explicit-notes',
      { schema: { Note } },
      () => {
        expect(Note.create).toBeTypeOf('function');
        return { Note };
      },
    );

    expect(application.include(notes).Note).toBe(Note);
    expect(() => application.include(module('invalid', () => (
      { missing: undefined }
    )))).toThrow('export "missing" is undefined');
  });

  it('accepts one directly owned model without a structural schema map', () => {
    const application = app('callback-module-direct-model');
    application.database.postgres('application', { schema: {} });
    const Note = model('direct_module_notes', {
      id: field.uuid('id').defaultRandom().primaryKey(),
      body: field.text('body').notNull(),
    });
    const notes = module('direct-notes', Note, () => {
      expect(Note.create).toBeTypeOf('function');
      return { Note };
    });

    expect(application.include(notes).Note).toBe(Note);
    expect(Note.$model.database).toBe('application');
  });

  it('fails closed for duplicate module identities and missing schema providers', () => {
    const application = app('callback-module-diagnostics');
    const first = module('same-name', () => ({ value: 'first' }));
    const second = module('same-name', () => ({ value: 'second' }));

    expect(application.include(first)).toEqual({ value: 'first' });
    expect(() => application.include(second)).toThrow(
      'includes distinct modules named "same-name"',
    );

    const Note = model('missing_provider_notes', {
      id: field.uuid('id').defaultRandom().primaryKey(),
    });
    const requiresDatabase = module(
      'requires-database',
      { schema: { Note } },
      () => ({ Note }),
    );
    expect(() => application.include(requiresDatabase)).toThrow(
      'requires the application profile to provide and bind its native database',
    );
  });
});

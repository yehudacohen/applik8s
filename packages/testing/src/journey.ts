// typecast-file-boundary: Journey decoding validates callback outputs, evidence, and versioned result records before restoring generic application types.
import type {
  ApplicationIdentityReference,
  JsonObject,
} from '@applik8s/core';

export const journeyDefinitionVersion = 'applik8s.journeyDefinition/v1alpha1' as const;
export const journeyResultVersion = 'applik8s.journeyResult/v1alpha1' as const;

export type JourneyMode = 'local' | 'deployed' | 'browser';
export type JourneyRequirement =
  | 'identity-fixtures'
  | 'application-events'
  | 'authority-explanations'
  | 'application-plan'
  | 'browser';

export interface JourneyDependencyReference {
  readonly kind: 'model' | 'operation' | 'event' | 'job' | 'workflow' | 'provider' | 'page' | 'broad';
  readonly id: string;
  readonly reason: string;
}

export interface JourneyDefinitionOptions {
  readonly modes?: readonly JourneyMode[];
  readonly requirements?: readonly JourneyRequirement[];
  /** Explicit only when closure discovery cannot prove a dynamic dependency. */
  readonly dependencies?: readonly JourneyDependencyReference[];
  readonly timeoutMs?: number;
}

export interface JourneyDefinition {
  readonly apiVersion: typeof journeyDefinitionVersion;
  readonly kind: 'Journey';
  readonly id: string;
  readonly options: Readonly<Required<Pick<JourneyDefinitionOptions, 'modes' | 'requirements' | 'dependencies'>> & Pick<JourneyDefinitionOptions, 'timeoutMs'>>;
  readonly handler: JourneyHandler;
}

export type JourneyHandler = (context: JourneyContext) => Promise<void> | void;

export type JourneyRoleReference = string | { readonly id: string };

export interface JourneyIdentityFixtureRequest {
  readonly roles?: readonly JourneyRoleReference[];
  readonly traits?: JsonObject;
  readonly label?: string;
}

export interface JourneyIdentityFixture {
  readonly id: string;
  readonly runId: string;
  readonly identity: ApplicationIdentityReference;
  readonly principalId: string;
}

export interface JourneyEventWaitOptions {
  readonly timeoutMs?: number;
  readonly description?: string;
}

export interface JourneyAuthorityExpectation {
  readonly operationId: string;
  readonly target: JsonObject;
}

export interface JourneyAuthorityDecision {
  readonly allowed: boolean;
  readonly explanation: string;
  readonly receipt?: string;
}

export interface JourneyOwnedResourceDescription {
  readonly id: string;
  readonly kind: string;
  readonly scope: string;
  readonly summary: string;
  readonly remediation?: string;
}

export interface JourneyCleanupContract<T> {
  readonly cleanup: (resource: T, context: JourneyCleanupContext) => Promise<void> | void;
  readonly verifyAbsent: (resource: T, context: JourneyCleanupContext) => Promise<boolean> | boolean;
  readonly dependsOn?: readonly unknown[];
  readonly timeoutMs?: number;
  readonly maximumAttempts?: number;
}

export interface JourneyCleanupContext {
  readonly runId: string;
  readonly leaseId: string;
  readonly signal: AbortSignal;
}

export interface JourneyIsolationLease {
  readonly id: string;
  readonly scope: string;
  readonly expiresAt: string;
  readonly orphanPolicy: 'retain-with-remediation' | 'fail';
}

export interface JourneyRunOptions {
  readonly application: string;
  readonly mode: JourneyMode;
  readonly runId: string;
  readonly fixtureSeed: string;
  readonly sourceRevision: string;
  readonly sourceDigest: string;
  readonly profile?: string;
  readonly deploymentId?: string;
  readonly planDigest?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface JourneyEvidenceReference {
  readonly kind: string;
  readonly reference: string;
  readonly digest?: string;
}

export interface JourneyRunEnvironment {
  readonly isolation: JourneyIsolationLease;
  readonly providerReceipts: readonly JourneyEvidenceReference[];
  readonly physicalResourceReceipts: readonly JourneyEvidenceReference[];
  readonly evidence: readonly JourneyEvidenceReference[];
}

export interface JourneyExecutionAdapter {
  readonly mode: JourneyMode;
  readonly boundary: 'public-admission';
  supports(requirement: JourneyRequirement): boolean;
  begin(definition: JourneyDefinition, options: JourneyRunOptions): Promise<JourneyRunEnvironment>;
  createIdentity?(
    request: JourneyIdentityFixtureRequest,
    run: JourneyRunEnvironment,
    options: JourneyRunOptions,
    signal: AbortSignal,
  ): Promise<JourneyIdentityFixture>;
  runAs<T>(
    identity: JourneyIdentityFixture,
    closure: () => Promise<T> | T,
    run: JourneyRunEnvironment,
    signal: AbortSignal,
  ): Promise<T>;
  waitForEvent?<TEvent>(
    selection: unknown,
    predicate: (event: TEvent) => boolean,
    options: JourneyEventWaitOptions,
    run: JourneyRunEnvironment,
    signal: AbortSignal,
  ): Promise<TEvent>;
  checkAuthority?(
    identity: JourneyIdentityFixture,
    expectation: JourneyAuthorityExpectation,
    run: JourneyRunEnvironment,
    signal: AbortSignal,
  ): Promise<JourneyAuthorityDecision>;
  readApplicationPlan?(run: JourneyRunEnvironment, signal: AbortSignal): Promise<unknown>;
  browser?: JourneyBrowserAdapter;
  describeOwnedResource(resource: unknown, run: JourneyRunEnvironment): JourneyOwnedResourceDescription;
  verifyCleanupAuthority(
    resource: JourneyOwnedResourceDescription,
    run: JourneyRunEnvironment,
    signal: AbortSignal,
  ): Promise<boolean>;
  finish?(
    result: JourneyResultDraft,
    run: JourneyRunEnvironment,
    signal: AbortSignal,
  ): Promise<readonly JourneyEvidenceReference[]>;
}

export type JourneyBrowserTarget =
  | { readonly by: 'role'; readonly role: string; readonly name?: string }
  | { readonly by: 'label' | 'text' | 'testId' | 'placeholder'; readonly value: string };

/** Provider-neutral browser surface used by source-owned product journeys. */
export interface JourneyBrowserAdapter {
  goto(path: string, run: JourneyRunEnvironment, signal: AbortSignal): Promise<void>;
  click(target: JourneyBrowserTarget, run: JourneyRunEnvironment, signal: AbortSignal): Promise<void>;
  fill(target: JourneyBrowserTarget, value: string, run: JourneyRunEnvironment, signal: AbortSignal): Promise<void>;
  visible(target: JourneyBrowserTarget, run: JourneyRunEnvironment, signal: AbortSignal): Promise<boolean>;
  text(target: JourneyBrowserTarget, run: JourneyRunEnvironment, signal: AbortSignal): Promise<string>;
  accessibility?(run: JourneyRunEnvironment, signal: AbortSignal): Promise<readonly JourneyBrowserAccessibilityFinding[]>;
}

export interface JourneyBrowserAccessibilityFinding {
  readonly rule: string;
  readonly impact: 'minor' | 'moderate' | 'serious' | 'critical';
  readonly target: string;
  readonly summary: string;
}

export interface JourneyBrowserContext {
  goto(path: string): Promise<void>;
  click(target: JourneyBrowserTarget): Promise<void>;
  fill(target: JourneyBrowserTarget, value: string): Promise<void>;
  expectVisible(target: JourneyBrowserTarget, description?: string): Promise<void>;
  expectText(target: JourneyBrowserTarget, expected: string | RegExp, description?: string): Promise<void>;
  expectAccessible(options?: { readonly maximumImpact?: JourneyBrowserAccessibilityFinding['impact'] }): Promise<void>;
}

export interface JourneyAssertion<T> {
  toEqual(expected: T): Promise<void>;
  toMatch(expected: JourneyDeepPartial<T>): Promise<void>;
  toSatisfy(predicate: (value: T) => boolean, description?: string): Promise<void>;
  toReject(predicate?: (error: unknown) => boolean, description?: string): Promise<void>;
}

export type JourneyDeepPartial<T> = T extends readonly (infer U)[]
  ? readonly JourneyDeepPartial<U>[]
  : T extends object
    ? { readonly [K in keyof T]?: JourneyDeepPartial<T[K]> }
    : T;

export interface JourneyAuthorityAssertion {
  toAllow(): Promise<JourneyAuthorityDecision>;
  toDeny(): Promise<JourneyAuthorityDecision>;
}

export interface JourneyContext {
  readonly runId: string;
  readonly fixtureSeed: string;
  readonly mode: JourneyMode;
  identity(request?: JourneyIdentityFixtureRequest): Promise<JourneyIdentityFixture>;
  as<T>(identity: JourneyIdentityFixture, closure: () => Promise<T> | T): Promise<T>;
  expect<T>(actual: Promise<T> | T): JourneyAssertion<T>;
  expectEvent<TEvent>(
    selection: unknown,
    predicate: (event: TEvent) => boolean,
    options?: JourneyEventWaitOptions,
  ): Promise<TEvent>;
  expectAuthority(identity: JourneyIdentityFixture, expectation: JourneyAuthorityExpectation): JourneyAuthorityAssertion;
  expectPlan(predicate: (plan: unknown) => boolean, description?: string): Promise<void>;
  browser(): JourneyBrowserContext;
  step<T>(name: string, closure: () => Promise<T> | T): Promise<T>;
  owns<T>(resource: T, contract: JourneyCleanupContract<T>): T;
}

export interface JourneyStepResult {
  readonly id: string;
  readonly name: string;
  readonly status: 'passed' | 'failed';
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface JourneyAssertionResult {
  readonly id: string;
  readonly kind: 'result' | 'event' | 'authority' | 'plan';
  readonly description: string;
  readonly status: 'passed' | 'failed' | 'blocked';
}

export interface JourneyCleanupResult {
  readonly resource: JourneyOwnedResourceDescription;
  readonly status: 'removed' | 'alreadyAbsent' | 'failed' | 'blocked';
  readonly attempts: number;
  readonly diagnostic?: string;
}

export interface JourneyDiagnostic {
  readonly code:
    | 'JOURNEY_FIXTURE_UNAVAILABLE'
    | 'JOURNEY_AUTHORITY_SETUP_FAILED'
    | 'JOURNEY_DEPENDENCY_UNRESOLVED'
    | 'JOURNEY_ASSERTION_TIMEOUT'
    | 'JOURNEY_CLEANUP_INCOMPLETE'
    | 'JOURNEY_PROVIDER_INCOMPATIBLE'
    | 'JOURNEY_EVIDENCE_REDACTION_FAILED';
  readonly message: string;
  readonly source?: string;
}

export interface JourneyResultDraft {
  readonly apiVersion: typeof journeyResultVersion;
  readonly journeyId: string;
  readonly runId: string;
  readonly mode: JourneyMode;
  readonly fixtureSeed: string;
  readonly source: { readonly revision: string; readonly digest: string };
  readonly deployment?: { readonly id?: string; readonly profile?: string; readonly planDigest?: string };
  readonly dependencies: readonly JourneyDependencyReference[];
  readonly steps: readonly JourneyStepResult[];
  readonly assertions: readonly JourneyAssertionResult[];
  readonly cleanup: readonly JourneyCleanupResult[];
  readonly providerReceipts: readonly JourneyEvidenceReference[];
  readonly physicalResourceReceipts: readonly JourneyEvidenceReference[];
  readonly evidence: readonly JourneyEvidenceReference[];
  readonly diagnostics: readonly JourneyDiagnostic[];
  readonly status: 'passed' | 'failed' | 'blocked' | 'cleanupFailed';
}

export type JourneyResult = JourneyResultDraft;

export class JourneyExecutionError extends Error {
  constructor(
    readonly code: JourneyDiagnostic['code'],
    message: string,
    readonly source?: string,
  ) {
    super(message);
    this.name = 'JourneyExecutionError';
  }
}

export function journey(
  id: string,
  handler: JourneyHandler,
  options: JourneyDefinitionOptions = {},
): JourneyDefinition {
  validateJourneyId(id);
  if (typeof handler !== 'function') throw new TypeError(`Journey ${id} requires a handler.`);
  const modes = unique(options.modes ?? ['local', 'deployed']);
  const requirements = unique(options.requirements ?? []);
  const dependencies = [...(options.dependencies ?? [])].map((dependency) => {
    requireText(dependency.id, 'journey dependency ID');
    requireText(dependency.reason, 'journey dependency reason');
    return Object.freeze({ ...dependency });
  });
  if (modes.length === 0) throw new TypeError(`Journey ${id} must support at least one execution mode.`);
  if (options.timeoutMs !== undefined) requirePositiveInteger(options.timeoutMs, `Journey ${id} timeoutMs`);
  return Object.freeze({
    apiVersion: journeyDefinitionVersion,
    kind: 'Journey',
    id,
    options: Object.freeze({
      modes: Object.freeze(modes),
      requirements: Object.freeze(requirements),
      dependencies: Object.freeze(dependencies),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    }),
    handler,
  });
}

export function defineJourneyAdapter<T extends JourneyExecutionAdapter>(adapter: T): T {
  if (adapter.boundary !== 'public-admission') {
    throw new TypeError('Journey adapters must traverse the public admission boundary.');
  }
  return Object.freeze(adapter);
}

export type LocalJourneyAdapterOptions = Omit<JourneyExecutionAdapter, 'mode' | 'boundary'>;

/** Defines a local journey adapter while preserving the production admission boundary. */
export function localJourneyAdapter(options: LocalJourneyAdapterOptions): JourneyExecutionAdapter {
  return defineJourneyAdapter({
    ...options,
    mode: 'local',
    boundary: 'public-admission',
  });
}

function browserTargetDescription(target: JourneyBrowserTarget): string {
  return target.by === 'role'
    ? `${target.role}${target.name ? ` named ${target.name}` : ''}`
    : `${target.by} ${target.value}`;
}

export async function runJourney(
  definition: JourneyDefinition,
  adapter: JourneyExecutionAdapter,
  options: JourneyRunOptions,
): Promise<JourneyResult> {
  validateRunOptions(definition, adapter, options);
  const diagnostics: JourneyDiagnostic[] = [];
  const steps: JourneyStepResult[] = [];
  const assertions: JourneyAssertionResult[] = [];
  const timeoutMs = options.timeoutMs ?? definition.options.timeoutMs ?? 30_000;
  const controller = linkedAbortController(options.signal);
  const timer = setTimeout(() => controller.abort(new JourneyExecutionError(
    'JOURNEY_ASSERTION_TIMEOUT',
    `Journey ${definition.id} exceeded its ${timeoutMs}ms deadline.`,
    definition.id,
  )), timeoutMs);
  let environment: JourneyRunEnvironment | undefined;
  let handlerFailed = false;
  let cleanupExecutionFailed = false;
  let blocked = false;
  let cleanup: readonly JourneyCleanupResult[] = [];
  let context: JourneyContextRuntime | undefined;
  let adapterEvidence: readonly JourneyEvidenceReference[] = [];
  let finishFailed = false;
  try {
    const unsupported = definition.options.requirements.filter((requirement) => !adapter.supports(requirement));
    if (unsupported.length > 0) {
      blocked = true;
      diagnostics.push({
        code: 'JOURNEY_PROVIDER_INCOMPATIBLE',
        message: `Journey ${definition.id} requires unsupported ${unsupported.join(', ')} in ${options.mode} mode.`,
        source: definition.id,
      });
    } else {
      environment = await withinDeadline(
        adapter.begin(definition, options),
        controller.signal,
        timeoutMs,
        `Journey ${definition.id} setup`,
      );
      validateEnvironment(environment, options);
      context = new JourneyContextRuntime(definition, adapter, environment, options, controller.signal, steps, assertions);
      try {
        await withinDeadline(
          context.step('journey', () => definition.handler(context as JourneyContext)),
          controller.signal,
          timeoutMs,
          `Journey ${definition.id}`,
        );
      } catch (error) {
        handlerFailed = true;
        diagnostics.push(diagnosticFromError(error, definition.id));
      }
      try {
        cleanup = await context.cleanup();
      } catch (error) {
        cleanupExecutionFailed = true;
        diagnostics.push({
          ...diagnosticFromError(error, definition.id),
          code: 'JOURNEY_CLEANUP_INCOMPLETE',
        });
      }
      if (cleanup.some(({ status }) => status === 'failed' || status === 'blocked')) {
        diagnostics.push({
          code: 'JOURNEY_CLEANUP_INCOMPLETE',
          message: `Journey ${definition.id} left ${cleanup.filter(({ status }) => status === 'failed' || status === 'blocked').length} owned fixture(s) requiring remediation.`,
          source: definition.id,
        });
      }
    }
  } catch (error) {
    handlerFailed = true;
    diagnostics.push(diagnosticFromError(error, definition.id));
  } finally {
    clearTimeout(timer);
  }

  const cleanupFailed = cleanupExecutionFailed
    || cleanup.some(({ status }) => status === 'failed' || status === 'blocked');
  const status: JourneyResult['status'] = cleanupFailed
    ? 'cleanupFailed'
    : blocked
      ? 'blocked'
      : handlerFailed || assertions.some(({ status: assertionStatus }) => assertionStatus === 'failed')
        ? 'failed'
        : 'passed';
  const baseEvidence = environment?.evidence ?? [];
  const draft = resultDraft(definition, options, environment, {
    steps,
    assertions,
    cleanup,
    diagnostics,
    evidence: baseEvidence,
    status,
  });
  if (environment && adapter.finish) {
    try {
      adapterEvidence = await withinDeadline(
        adapter.finish(draft, environment, controller.signal),
        controller.signal,
        timeoutMs,
        `Journey ${definition.id} evidence finalization`,
      );
    } catch (error) {
      finishFailed = true;
      diagnostics.push(diagnosticFromError(error, definition.id));
    }
  }
  let result = resultDraft(definition, options, environment, {
    steps,
    assertions,
    cleanup,
    diagnostics,
    evidence: [...baseEvidence, ...adapterEvidence],
    status: finishFailed || diagnostics.some(({ code }) => code === 'JOURNEY_EVIDENCE_REDACTION_FAILED') ? 'failed' : status,
  });
  try {
    assertPublicJourneyResult(result);
  } catch (error) {
    diagnostics.push(diagnosticFromError(error, definition.id));
    // Fail closed without returning any adapter-supplied reference that could contain a credential.
    result = resultDraft(definition, options, undefined, {
      steps,
      assertions,
      cleanup,
      diagnostics,
      evidence: [],
      status: 'failed',
    });
    assertPublicJourneyResult(result);
  }
  return Object.freeze(result);
}

interface OwnedFixture {
  readonly resource: unknown;
  readonly description: JourneyOwnedResourceDescription;
  readonly contract: JourneyCleanupContract<unknown>;
  readonly dependencies: readonly string[];
  readonly registration: number;
}

class JourneyContextRuntime implements JourneyContext {
  readonly #owned = new Map<string, OwnedFixture>();
  #assertionIndex = 0;
  #stepIndex = 0;

  constructor(
    readonly definition: JourneyDefinition,
    readonly adapter: JourneyExecutionAdapter,
    readonly environment: JourneyRunEnvironment,
    readonly options: JourneyRunOptions,
    readonly signal: AbortSignal,
    readonly steps: JourneyStepResult[],
    readonly assertions: JourneyAssertionResult[],
  ) {}

  get runId(): string { return this.options.runId; }
  get fixtureSeed(): string { return this.options.fixtureSeed; }
  get mode(): JourneyMode { return this.options.mode; }

  async identity(request: JourneyIdentityFixtureRequest = {}): Promise<JourneyIdentityFixture> {
    ensureRequirement(this.adapter, 'identity-fixtures');
    const createIdentity = requireAdapterMethod(this.adapter.createIdentity, 'identity-fixtures');
    const fixture = await createIdentity(normalizeIdentityRequest(request), this.environment, this.options, this.signal);
    if (fixture.runId !== this.runId || !fixture.id.trim() || !fixture.principalId.trim()) {
      throw new JourneyExecutionError('JOURNEY_AUTHORITY_SETUP_FAILED', 'Identity fixture is not bound to the active journey run.', this.definition.id);
    }
    return fixture;
  }

  async as<T>(identity: JourneyIdentityFixture, closure: () => Promise<T> | T): Promise<T> {
    if (identity.runId !== this.runId) {
      throw new JourneyExecutionError('JOURNEY_AUTHORITY_SETUP_FAILED', `Identity ${identity.id} belongs to another journey run.`, this.definition.id);
    }
    return this.adapter.runAs(identity, closure, this.environment, this.signal);
  }

  expect<T>(actual: Promise<T> | T): JourneyAssertion<T> {
    const value = Promise.resolve(actual);
    return {
      toEqual: (expected) => this.assertResult('equals expected value', async () => deepEqual(await value, expected)),
      toMatch: (expected) => this.assertResult('matches expected shape', async () => deepMatch(await value, expected)),
      toSatisfy: (predicate, description = 'satisfies predicate') => this.assertResult(description, async () => predicate(await value)),
      toReject: async (predicate, description = 'rejects as expected') => {
        await this.assertResult(description, async () => {
          try {
            await value;
            return false;
          } catch (error) {
            return predicate ? predicate(error) : true;
          }
        });
      },
    };
  }

  async expectEvent<TEvent>(
    selection: unknown,
    predicate: (event: TEvent) => boolean,
    options: JourneyEventWaitOptions = {},
  ): Promise<TEvent> {
    ensureRequirement(this.adapter, 'application-events');
    const id = this.nextAssertionId();
    const description = options.description ?? 'observes expected application event';
    try {
      const waitForEvent = requireAdapterMethod(this.adapter.waitForEvent, 'application-events');
      const event = await waitForEvent(selection, predicate, options, this.environment, this.signal);
      if (!predicate(event)) throw new Error('Event adapter returned an event that did not satisfy the journey predicate.');
      this.assertions.push({ id, kind: 'event', description, status: 'passed' });
      return event;
    } catch (error) {
      this.assertions.push({ id, kind: 'event', description, status: 'failed' });
      throw asJourneyError(error, 'JOURNEY_ASSERTION_TIMEOUT', description, this.definition.id);
    }
  }

  expectAuthority(identity: JourneyIdentityFixture, expectation: JourneyAuthorityExpectation): JourneyAuthorityAssertion {
    const check = async (allowed: boolean): Promise<JourneyAuthorityDecision> => {
      ensureRequirement(this.adapter, 'authority-explanations');
      const id = this.nextAssertionId();
      const description = `${allowed ? 'allows' : 'denies'} ${expectation.operationId}`;
      const checkAuthority = requireAdapterMethod(this.adapter.checkAuthority, 'authority-explanations');
      const decision = await checkAuthority(identity, expectation, this.environment, this.signal);
      const status = decision.allowed === allowed ? 'passed' : 'failed';
      this.assertions.push({ id, kind: 'authority', description, status });
      if (status === 'failed') throw new JourneyExecutionError('JOURNEY_AUTHORITY_SETUP_FAILED', `Authority unexpectedly ${decision.allowed ? 'allowed' : 'denied'} ${expectation.operationId}.`, this.definition.id);
      return decision;
    };
    return { toAllow: () => check(true), toDeny: () => check(false) };
  }

  async expectPlan(predicate: (plan: unknown) => boolean, description = 'application plan satisfies expectation'): Promise<void> {
    ensureRequirement(this.adapter, 'application-plan');
    const id = this.nextAssertionId();
    const readApplicationPlan = requireAdapterMethod(this.adapter.readApplicationPlan, 'application-plan');
    const plan = await readApplicationPlan(this.environment, this.signal);
    const status = predicate(plan) ? 'passed' : 'failed';
    this.assertions.push({ id, kind: 'plan', description, status });
    if (status === 'failed') throw new JourneyExecutionError('JOURNEY_DEPENDENCY_UNRESOLVED', description, this.definition.id);
  }

  browser(): JourneyBrowserContext {
    ensureRequirement(this.adapter, 'browser');
    const browser = this.adapter.browser;
    if (!browser) {
      throw new JourneyExecutionError(
        'JOURNEY_PROVIDER_INCOMPATIBLE',
        `Journey ${this.definition.id} requires a browser adapter.`,
        this.definition.id,
      );
    }
    const assertion = async (description: string, predicate: () => Promise<boolean>) => {
      const id = this.nextAssertionId();
      try {
        const passed = await predicate();
        this.assertions.push({ id, kind: 'result', description, status: passed ? 'passed' : 'failed' });
        if (!passed) throw new JourneyExecutionError('JOURNEY_DEPENDENCY_UNRESOLVED', description, this.definition.id);
      } catch (error) {
        if (!this.assertions.some(entry => entry.id === id)) {
          this.assertions.push({ id, kind: 'result', description, status: 'failed' });
        }
        throw error;
      }
    };
    const context: JourneyBrowserContext = Object.freeze({
      goto: (path: string) => browser.goto(path, this.environment, this.signal),
      click: (target: JourneyBrowserTarget) => browser.click(target, this.environment, this.signal),
      fill: (target: JourneyBrowserTarget, value: string) => browser.fill(target, value, this.environment, this.signal),
      expectVisible: (target: JourneyBrowserTarget, description = `browser target ${browserTargetDescription(target)} is visible`) =>
        assertion(description, () => browser.visible(target, this.environment, this.signal)),
      expectText: (target: JourneyBrowserTarget, expected: string | RegExp, description = `browser target ${browserTargetDescription(target)} has expected text`) =>
        assertion(description, async () => {
          const actual = await browser.text(target, this.environment, this.signal);
          return typeof expected === 'string' ? actual.includes(expected) : expected.test(actual);
        }),
      expectAccessible: async ({ maximumImpact = 'moderate' }: { readonly maximumImpact?: JourneyBrowserAccessibilityFinding['impact'] } = {}) => {
        if (!browser.accessibility) {
          throw new JourneyExecutionError('JOURNEY_PROVIDER_INCOMPATIBLE', 'Browser adapter does not provide accessibility evidence.', this.definition.id);
        }
        const impacts = ['minor', 'moderate', 'serious', 'critical'] as const;
        const maximum = impacts.indexOf(maximumImpact);
        await assertion(`browser has no accessibility findings above ${maximumImpact}`, async () =>
          (await browser.accessibility?.(this.environment, this.signal) ?? [])
            .every(finding => impacts.indexOf(finding.impact) <= maximum));
      },
    });
    return context;
  }

  async step<T>(name: string, closure: () => Promise<T> | T): Promise<T> {
    requireText(name, 'journey step name');
    const id = `step:${++this.#stepIndex}`;
    const startedAt = new Date().toISOString();
    const timeoutMs = this.options.timeoutMs ?? this.definition.options.timeoutMs ?? 30_000;
    try {
      const result = await withinDeadline(
        Promise.resolve().then(closure),
        this.signal,
        timeoutMs,
        `Journey step ${name}`,
      );
      this.steps.push({ id, name, status: 'passed', startedAt, completedAt: new Date().toISOString() });
      return result;
    } catch (error) {
      this.steps.push({ id, name, status: 'failed', startedAt, completedAt: new Date().toISOString() });
      throw error;
    }
  }

  owns<T>(resource: T, contract: JourneyCleanupContract<T>): T {
    const description = this.adapter.describeOwnedResource(resource, this.environment);
    requireText(description.id, 'owned fixture ID');
    if (description.scope !== this.environment.isolation.scope) {
      throw new JourneyExecutionError('JOURNEY_CLEANUP_INCOMPLETE', `Fixture ${description.id} is outside isolation scope ${this.environment.isolation.scope}.`, this.definition.id);
    }
    if (this.#owned.has(description.id)) {
      throw new JourneyExecutionError('JOURNEY_CLEANUP_INCOMPLETE', `Fixture ${description.id} is registered more than once.`, this.definition.id);
    }
    const dependencies = (contract.dependsOn ?? []).map((dependency) => this.adapter.describeOwnedResource(dependency, this.environment).id);
    this.#owned.set(description.id, {
      resource,
      description,
      contract: eraseCleanupContract(resource, contract),
      dependencies,
      registration: this.#owned.size,
    });
    return resource;
  }

  async cleanup(): Promise<readonly JourneyCleanupResult[]> {
    const ordered = cleanupOrder(this.#owned);
    const blocked = new Set<string>();
    const results: JourneyCleanupResult[] = [];
    for (const fixture of ordered) {
      if (blocked.has(fixture.description.id)) {
        results.push({
          resource: fixture.description,
          status: 'blocked',
          attempts: 0,
          diagnostic: 'A dependent fixture could not be removed; dependency cleanup was withheld.',
        });
        blockDependencies(fixture.description.id, this.#owned, blocked);
        continue;
      }
      const result = await cleanupFixture(fixture, this.adapter, this.environment, this.options);
      results.push(result);
      if (result.status === 'failed' || result.status === 'blocked') {
        blockDependencies(fixture.description.id, this.#owned, blocked);
      }
    }
    return results;
  }

  async assertResult(description: string, assertion: () => Promise<boolean>): Promise<void> {
    const id = this.nextAssertionId();
    try {
      const matches = await assertion();
      this.assertions.push({ id, kind: 'result', description, status: matches ? 'passed' : 'failed' });
      if (!matches) throw new JourneyExecutionError('JOURNEY_DEPENDENCY_UNRESOLVED', `Journey assertion failed: ${description}.`, this.definition.id);
    } catch (error) {
      if (!this.assertions.some((entry) => entry.id === id)) {
        this.assertions.push({ id, kind: 'result', description, status: 'failed' });
      }
      throw error;
    }
  }

  nextAssertionId(): string { return `assertion:${++this.#assertionIndex}`; }
}

async function cleanupFixture(
  fixture: OwnedFixture,
  adapter: JourneyExecutionAdapter,
  environment: JourneyRunEnvironment,
  options: JourneyRunOptions,
): Promise<JourneyCleanupResult> {
  const maximumAttempts = fixture.contract.maximumAttempts ?? 3;
  const timeoutMs = fixture.contract.timeoutMs ?? 10_000;
  requirePositiveInteger(maximumAttempts, `Fixture ${fixture.description.id} maximumAttempts`);
  requirePositiveInteger(timeoutMs, `Fixture ${fixture.description.id} timeoutMs`);
  let diagnostic: string | undefined;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    // Cleanup receives its own bounded signal so a timed-out journey cannot strand its fixtures.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Cleanup timed out after ${timeoutMs}ms.`)), timeoutMs);
    const context: JourneyCleanupContext = {
      runId: options.runId,
      leaseId: environment.isolation.id,
      signal: controller.signal,
    };
    try {
      if (!(await withinDeadline(
        adapter.verifyCleanupAuthority(fixture.description, environment, controller.signal),
        controller.signal,
        timeoutMs,
        `Cleanup authority check for ${fixture.description.id}`,
      ))) {
        return { resource: fixture.description, status: 'blocked', attempts: attempt, diagnostic: 'Cleanup lease does not authorize this resource identity.' };
      }
      if (await withinDeadline(
        Promise.resolve(fixture.contract.verifyAbsent(fixture.resource, context)),
        controller.signal,
        timeoutMs,
        `Cleanup absence check for ${fixture.description.id}`,
      )) {
        return { resource: fixture.description, status: 'alreadyAbsent', attempts: attempt };
      }
      await withinDeadline(
        Promise.resolve(fixture.contract.cleanup(fixture.resource, context)),
        controller.signal,
        timeoutMs,
        `Cleanup for ${fixture.description.id}`,
      );
      if (await withinDeadline(
        Promise.resolve(fixture.contract.verifyAbsent(fixture.resource, context)),
        controller.signal,
        timeoutMs,
        `Cleanup absence check for ${fixture.description.id}`,
      )) {
        return { resource: fixture.description, status: 'removed', attempts: attempt };
      }
      diagnostic = 'Cleanup completed without proving resource absence.';
    } catch (error) {
      diagnostic = errorMessage(error);
    } finally {
      clearTimeout(timer);
    }
  }
  return { resource: fixture.description, status: 'failed', attempts: maximumAttempts, ...(diagnostic ? { diagnostic } : {}) };
}

function cleanupOrder(owned: ReadonlyMap<string, OwnedFixture>): readonly OwnedFixture[] {
  const incoming = new Map([...owned.keys()].map((id) => [id, 0]));
  for (const fixture of owned.values()) {
    for (const dependency of fixture.dependencies) {
      if (!owned.has(dependency)) {
        throw new JourneyExecutionError('JOURNEY_CLEANUP_INCOMPLETE', `Fixture ${fixture.description.id} depends on unregistered fixture ${dependency}.`);
      }
      incoming.set(dependency, (incoming.get(dependency) ?? 0) + 1);
    }
  }
  const ready = [...owned.values()]
    .filter(({ description }) => incoming.get(description.id) === 0)
    .sort((left, right) => right.registration - left.registration);
  const output: OwnedFixture[] = [];
  while (ready.length > 0) {
    const fixture = ready.shift();
    if (!fixture) break;
    output.push(fixture);
    for (const dependency of fixture.dependencies) {
      const next = (incoming.get(dependency) ?? 0) - 1;
      incoming.set(dependency, next);
      if (next === 0) {
        const candidate = owned.get(dependency);
        if (candidate) {
          ready.push(candidate);
          ready.sort((left, right) => right.registration - left.registration);
        }
      }
    }
  }
  if (output.length !== owned.size) {
    throw new JourneyExecutionError('JOURNEY_CLEANUP_INCOMPLETE', 'Owned fixture cleanup dependencies contain a cycle.');
  }
  return output;
}

function blockDependencies(id: string, owned: ReadonlyMap<string, OwnedFixture>, blocked: Set<string>): void {
  for (const dependency of owned.get(id)?.dependencies ?? []) {
    if (blocked.has(dependency)) continue;
    blocked.add(dependency);
    blockDependencies(dependency, owned, blocked);
  }
}

function resultDraft(
  definition: JourneyDefinition,
  options: JourneyRunOptions,
  environment: JourneyRunEnvironment | undefined,
  values: Pick<JourneyResultDraft, 'steps' | 'assertions' | 'cleanup' | 'diagnostics' | 'evidence' | 'status'>,
): JourneyResultDraft {
  return {
    apiVersion: journeyResultVersion,
    journeyId: definition.id,
    runId: options.runId,
    mode: options.mode,
    fixtureSeed: options.fixtureSeed,
    source: { revision: options.sourceRevision, digest: options.sourceDigest },
    ...(
      options.deploymentId || options.profile || options.planDigest
        ? { deployment: {
            ...(options.deploymentId ? { id: options.deploymentId } : {}),
            ...(options.profile ? { profile: options.profile } : {}),
            ...(options.planDigest ? { planDigest: options.planDigest } : {}),
          } }
        : {}
    ),
    dependencies: definition.options.dependencies.map((dependency) => ({ ...dependency })),
    steps: values.steps.map((step) => ({ ...step })),
    assertions: values.assertions.map((assertion) => ({ ...assertion })),
    cleanup: values.cleanup.map((entry) => ({
      ...entry,
      resource: { ...entry.resource },
    })),
    diagnostics: values.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    evidence: values.evidence.map((reference) => ({ ...reference })),
    status: values.status,
    providerReceipts: (environment?.providerReceipts ?? []).map((reference) => ({ ...reference })),
    physicalResourceReceipts: (environment?.physicalResourceReceipts ?? []).map((reference) => ({ ...reference })),
  };
}

function validateRunOptions(definition: JourneyDefinition, adapter: JourneyExecutionAdapter, options: JourneyRunOptions): void {
  if (adapter.boundary !== 'public-admission') throw new TypeError('Journey adapter does not traverse the public admission boundary.');
  if (adapter.mode !== options.mode) throw new TypeError(`Journey adapter mode ${adapter.mode} does not match requested ${options.mode}.`);
  if (!definition.options.modes.includes(options.mode)) throw new TypeError(`Journey ${definition.id} does not support ${options.mode} mode.`);
  for (const [label, value] of [
    ['application', options.application],
    ['run ID', options.runId],
    ['fixture seed', options.fixtureSeed],
    ['source revision', options.sourceRevision],
  ] as const) requireText(value, `journey ${label}`);
  requireDigest(options.sourceDigest, 'journey source digest');
  if (options.planDigest !== undefined) requireDigest(options.planDigest, 'journey plan digest');
  if (options.timeoutMs !== undefined) requirePositiveInteger(options.timeoutMs, 'journey timeoutMs');
}

function validateEnvironment(environment: JourneyRunEnvironment, options: JourneyRunOptions): void {
  requireText(environment.isolation.id, 'journey isolation lease ID');
  requireText(environment.isolation.scope, 'journey isolation scope');
  if (Date.parse(environment.isolation.expiresAt) <= Date.now()) {
    throw new JourneyExecutionError('JOURNEY_FIXTURE_UNAVAILABLE', `Journey isolation lease ${environment.isolation.id} is expired.`);
  }
  if (!environment.isolation.scope.includes(options.runId)) {
    throw new JourneyExecutionError('JOURNEY_FIXTURE_UNAVAILABLE', `Journey isolation scope is not bound to run ${options.runId}.`);
  }
}

function normalizeIdentityRequest(request: JourneyIdentityFixtureRequest): JourneyIdentityFixtureRequest {
  return {
    ...(request.roles ? { roles: request.roles.map((role) => typeof role === 'string' ? role : role.id) } : {}),
    ...(request.traits ? { traits: request.traits } : {}),
    ...(request.label ? { label: request.label } : {}),
  };
}

function ensureRequirement(adapter: JourneyExecutionAdapter, requirement: JourneyRequirement): void {
  if (!adapter.supports(requirement)) {
    throw new JourneyExecutionError('JOURNEY_PROVIDER_INCOMPATIBLE', `Journey adapter does not support ${requirement}.`);
  }
}

function requireAdapterMethod<T>(method: T | undefined, requirement: JourneyRequirement): T {
  if (!method) {
    throw new JourneyExecutionError(
      'JOURNEY_PROVIDER_INCOMPATIBLE',
      `Journey adapter declares ${requirement} support without implementing it.`,
    );
  }
  return method;
}

function eraseCleanupContract<T>(
  registered: T,
  contract: JourneyCleanupContract<T>,
): JourneyCleanupContract<unknown> {
  return {
    cleanup: (_resource, context) => contract.cleanup(registered, context),
    verifyAbsent: (_resource, context) => contract.verifyAbsent(registered, context),
    ...(contract.dependsOn ? { dependsOn: contract.dependsOn } : {}),
    ...(contract.timeoutMs !== undefined ? { timeoutMs: contract.timeoutMs } : {}),
    ...(contract.maximumAttempts !== undefined ? { maximumAttempts: contract.maximumAttempts } : {}),
  };
}

function linkedAbortController(parent?: AbortSignal): AbortController {
  const controller = new AbortController();
  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener('abort', () => controller.abort(parent.reason), { once: true });
  return controller;
}

function diagnosticFromError(error: unknown, source: string): JourneyDiagnostic {
  if (error instanceof JourneyExecutionError) {
    return { code: error.code, message: redactDiagnostic(error.message), source: error.source ?? source };
  }
  return { code: 'JOURNEY_DEPENDENCY_UNRESOLVED', message: redactDiagnostic(errorMessage(error)), source };
}

function asJourneyError(
  error: unknown,
  code: JourneyDiagnostic['code'],
  message: string,
  source: string,
): JourneyExecutionError {
  return error instanceof JourneyExecutionError
    ? error
    : new JourneyExecutionError(code, `${message}: ${errorMessage(error)}`, source);
}

function deepMatch(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && expected.length === actual.length
      && expected.every((entry, index) => deepMatch(actual[index], entry));
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return false;
    return Object.entries(expected).every(([key, value]) => deepMatch(Reflect.get(actual, key), value));
  }
  return false;
}

function deepEqual(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual)
      && Array.isArray(expected)
      && actual.length === expected.length
      && expected.every((entry, index) => deepEqual(actual[index], entry));
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    return actualKeys.length === expectedKeys.length
      && actualKeys.every((key, index) => key === expectedKeys[index])
      && expectedKeys.every((key) => deepEqual(Reflect.get(actual, key), Reflect.get(expected, key)));
  }
  return false;
}

async function withinDeadline<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
  description: string,
): Promise<T> {
  if (signal.aborted) throw timeoutError(signal.reason, description, timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    abortListener = () => reject(timeoutError(signal.reason, description, timeoutMs));
    signal.addEventListener('abort', abortListener, { once: true });
    timer = setTimeout(() => reject(new JourneyExecutionError(
      'JOURNEY_ASSERTION_TIMEOUT',
      `${description} exceeded its ${timeoutMs}ms deadline.`,
    )), timeoutMs);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
}

function timeoutError(reason: unknown, description: string, timeoutMs: number): JourneyExecutionError {
  return reason instanceof JourneyExecutionError
    ? reason
    : new JourneyExecutionError(
        'JOURNEY_ASSERTION_TIMEOUT',
        `${description} exceeded its ${timeoutMs}ms deadline.`,
      );
}

function unique<T extends string>(values: readonly T[]): T[] {
  if (new Set(values).size !== values.length) throw new TypeError('Journey options cannot contain duplicate values.');
  return [...values];
}

function validateJourneyId(id: string): void {
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*\.v[1-9][0-9]*$/u.test(id)) {
    throw new TypeError(`Journey ID ${JSON.stringify(id)} must be a stable lower-case versioned identity such as post.publish.v1.`);
  }
}

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new TypeError(`${label} must be non-empty.`);
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer.`);
}

function requireDigest(value: string, label: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new TypeError(`${label} must be a full sha256 digest.`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redactDiagnostic(message: string): string {
  return message
    .replace(/\b(authorization|cookie|password|secret|token|credential|private[-_ ]?key)\s*[:=]\s*[^\s,;]+/giu, '$1=[REDACTED]')
    .replace(/\bBearer\s+[^\s,;]+/giu, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|AKIA[A-Z0-9]{8,})\b/gu, '[REDACTED]')
    .slice(0, 2_048);
}

function assertPublicJourneyResult(result: JourneyResult): void {
  visit(result, '$');
  function visit(value: unknown, path: string): void {
    if (typeof value === 'string') {
      if (/password|secret|token|credential|private.?key|authorization/i.test(path)) {
        throw new JourneyExecutionError('JOURNEY_EVIDENCE_REDACTION_FAILED', `Journey result contains sensitive field ${path}.`);
      }
      if (/^(?:Bearer\s+|sk-[A-Za-z0-9]|AKIA[A-Z0-9])/u.test(value)) {
        throw new JourneyExecutionError('JOURNEY_EVIDENCE_REDACTION_FAILED', `Journey result contains a credential-shaped value at ${path}.`);
      }
      return;
    }
    if (value === null || typeof value === 'number' || typeof value === 'boolean' || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        visit(entry, `${path}[${index}]`);
      });
      return;
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([key, entry]) => {
        visit(entry, `${path}.${key}`);
      });
      return;
    }
    throw new JourneyExecutionError('JOURNEY_EVIDENCE_REDACTION_FAILED', `Journey result contains non-JSON value at ${path}.`);
  }
}

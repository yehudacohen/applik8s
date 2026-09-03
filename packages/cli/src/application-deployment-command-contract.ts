export interface ApplicationDeploymentCommandIo {
  readonly cwd: string;
  stdout(message: string): void;
  stderr(message: string): void;
}

export interface ApplicationDeployCommandOptions {
  readonly context: string;
  /** Canonical v0.9 assembly profile; independent of installation capacity/profile fields. */
  readonly profile?: string;
  readonly strategy?: 'direct' | 'kro';
  readonly outDir?: string;
  readonly compositionName?: string;
  readonly connectionBindings?: string;
  readonly instance?: string;
  readonly skipAppBuild?: boolean;
  readonly skipImageBuild?: boolean;
  readonly planOnly?: boolean;
  /** Canonical ApplicationPlan rendering selected by `applik8s plan`. */
  readonly planFormat?: 'text' | 'json' | 'graph';
  /** Previous canonical ApplicationPlan used for a categorized plan diff. */
  readonly planDiff?: string;
  /** Replace the generated ApplicationHost through a TypeKro dev aspect. */
  readonly development?: boolean;
  /**
   * Permit one reviewed TypeKro root-schema migration during this deployment.
   *
   * This is deliberately invocation-scoped rather than a project default:
   * subsequent deployments return to fail-closed compatibility.
   */
  readonly allowBreakingChanges?: boolean;
  /** Exact released deployment lineage acknowledged for active-state migration. */
  readonly migrateFrom?: '0.7.1';
  readonly runtimeEntrypoint?: string;
  readonly acknowledge?: readonly string[];
}

export interface ApplicationDeleteCommandOptions {
  readonly context: string;
  /** Assembly profile recorded by the deployment being observed or destroyed. */
  readonly profile?: string;
  readonly outDir?: string;
  readonly compositionName?: string;
  readonly instanceName?: string;
  readonly controlPlaneNamespace?: string;
}

export interface ApplicationStatusCommandOptions
  extends ApplicationDeleteCommandOptions {
  readonly json?: boolean;
}

export interface ApplicationDeploymentCommandRuntime {
  runChild(options: {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
  }): Promise<number>;
  runBuild(
    entrypoint: string,
    options: {
      readonly outDir?: string;
      readonly typekro?: boolean;
      readonly compositionName?: string;
      readonly connectionBindings?: string;
      readonly production?: boolean;
      readonly executionTarget?: 'kubernetes' | 'local' | 'aws-local' | 'aws';
      readonly profile?: string;
      /**
       * Authored installation manifest used to concretize schema.spec values
       * before profile-specific artifact validation. The isolated compiler
       * receives the path, never the manifest contents, in its process argv.
       */
      readonly installationSpecPath?: string;
    },
    io: ApplicationDeploymentCommandIo,
  ): Promise<number>;
}

export type ApplicationDeploymentPhase =
  | 'application-build'
  | 'composition-compile'
  | 'instance-selection'
  | 'profile-transition'
  | 'deployment-plan'
  | 'deployment-migration'
  | 'registry-resolution'
  | 'pull-secret-verification'
  | 'alchemy-plan'
  | 'alchemy-apply'
  | 'alchemy-destroy'
  | 'authoritative-readiness'
  | 'exposure-verification';

export const applicationDeploymentPhaseRemediation: Readonly<
  Record<ApplicationDeploymentPhase, string>
> = {
  'application-build': 'Run the application package build directly and fix its first reported error.',
  'composition-compile': 'Run applik8s build --typekro and inspect the compiler diagnostic.',
  'instance-selection': 'Provide exactly one authored root Application CR with --instance <path>.',
  'profile-transition': 'Inspect the current and desired installation profiles, then supply only the exact acknowledgement printed by the plan when a reviewed destructive transition is intentional.',
  'deployment-plan': 'Inspect application-deployment-graph.json and fix the first invalid identity, dependency, output, ownership, or lifecycle diagnostic.',
  'deployment-migration': 'Inspect the generated migration proposal and persisted migration run; resume the same deployment, or follow its explicit forward-recovery diagnostic.',
  'registry-resolution': 'Verify the selected Kubernetes context, registry Service, and provider endpoint.',
  'pull-secret-verification': 'Ensure the graph-created pull Secret is present in every authored workload namespace.',
  'alchemy-plan': 'Inspect the portable deployment graph and TypeKro semantic diagnostics.',
  'alchemy-apply': 'Inspect the failed Alchemy resource and retry only after its dependency is healthy.',
  'alchemy-destroy': 'Inspect the failed resource/finalizer and resume the same Alchemy destroy transaction.',
  'authoritative-readiness': 'Inspect the root Application status and the pending provider or workload named by it.',
  'exposure-verification': 'Inspect the projected URL and the selected exposure provider.',
};

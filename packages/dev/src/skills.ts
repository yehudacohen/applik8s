export interface Applik8sDevelopmentSkillCatalog {
  readonly apiVersion: 'applik8s.devSkills/v1alpha1';
  readonly release: string;
  readonly topics: readonly { readonly id: string; readonly publicPackages: readonly string[]; readonly introspection: readonly string[] }[];
}

export function applik8sDevelopmentSkills(release = '0.8.0'): Applik8sDevelopmentSkillCatalog {
  return {
    apiVersion: 'applik8s.devSkills/v1alpha1', release,
    topics: [
      { id: 'models-and-events', publicPackages: ['@applik8s/applik8s'], introspection: ['application.explain', 'operation-catalog', 'application-graph'] },
      { id: 'workflows-schedules-actors', publicPackages: ['@applik8s/applik8s'], introspection: ['application-plan', 'runtime-access'] },
      { id: 'profiles-and-targets', publicPackages: ['@applik8s/deployment-contract'], introspection: ['target-compatibility', 'provider-guarantees', 'application-plan'] },
      { id: 'agentic-start', publicPackages: ['@applik8s/start-agentic'], introspection: ['package-catalog', 'generated-route-inventory'] },
    ],
  };
}

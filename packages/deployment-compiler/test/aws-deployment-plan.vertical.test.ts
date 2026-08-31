// typecast-file-boundary: Test fixtures intentionally construct partial portable graphs at the compiler input boundary.
import type { ApplicationGraph } from '@applik8s/core';
import { applicationRuntimeEndpointEnvironmentName, type DeploymentJsonObject, validateApplicationAwsDeploymentPlan } from '@applik8s/deployment-contract';
import { describe, expect, it } from 'vitest';
import { compileApplicationAwsDeploymentPlan, validateAwsRuntimeAccessParity } from '../src/index.js';

describe('v0.8 AWS deployment planning', () => {
  it('lowers one semantic graph into a deterministic, exact-access Alchemy plan without mutating it', () => {
    const graph = awsGraph();
    const before = JSON.stringify(graph);
    const request = {
      graph,
      environment: 'production',
      region: 'us-east-1',
      accountId: '123456789012',
      availabilityZones: ['us-east-1a', 'us-east-1b'],
    } as const;

    const first = compileApplicationAwsDeploymentPlan(request);
    const second = compileApplicationAwsDeploymentPlan(request);

    expect(first).toEqual(second);
    expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(validateApplicationAwsDeploymentPlan(first)).toEqual([]);
    expect(JSON.stringify(graph)).toBe(before);
    expect(first.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'foundation.network', service: 'ec2', resourceType: 'vpc' }),
      expect.objectContaining({ id: 'foundation.registry', service: 'ecr', resourceType: 'repository' }),
      expect.objectContaining({ id: 'foundation.compute', service: 'ecs', resourceType: 'cluster' }),
      expect.objectContaining({ id: 'provider.provider.TransactionalDatabase', service: 'rds', resourceType: 'postgresql-instance' }),
      expect.objectContaining({ id: 'provider.provider.ObjectStorage', service: 's3', resourceType: 'bucket' }),
      expect.objectContaining({ id: 'provider.provider.HttpExposure', service: 'elastic-load-balancing' }),
      expect.objectContaining({ id: 'scheduler.admission', service: 'sqs', resourceType: 'queue' }),
      expect.objectContaining({ id: 'scheduler.dead-letter', service: 'sqs', resourceType: 'queue' }),
      expect.objectContaining({ id: 'scheduler.execution-role', service: 'iam', resourceType: 'role' }),
      expect.objectContaining({ service: 'eventbridge-scheduler', resourceType: 'schedule' }),
      expect.objectContaining({ service: 'iam', resourceType: 'role' }),
      expect.objectContaining({ service: 'ecs', resourceType: 'fargate-service', semanticNodeId: 'server.web' }),
    ]));

    const host = first.resources.find(({ resourceType }) => resourceType === 'fargate-service');
    const role = first.resources.find((resource) => resource.id === host?.configuration.runtimeRoleResourceId);
    expect(role?.configuration.statements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actions: ['s3:AbortMultipartUpload', 's3:PutObject'],
        resources: [expect.stringMatching(/^arn:aws:s3:::[a-z0-9-]+\/tenants\/\*$/u)],
      }),
    ]));
    expect(JSON.stringify(role)).not.toContain('"resources":["*"]');
    expect(first.runtimeBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'postgresUrl', environmentName: 'APPLIK8S_DATABASE_DOCUMENTS_URL', resourceId: 'provider.provider.TransactionalDatabase', database: 'documents' }),
      expect.objectContaining({ kind: 'postgresUrl', environmentName: 'APPLIK8S_SCHEDULE_DATABASE_URL', resourceId: 'provider.provider.TransactionalDatabase', database: 'postgres' }),
    ]));
    const fixedSchedule = first.resources.find(({ service, resourceType }) => service === 'eventbridge-scheduler' && resourceType === 'schedule');
    expect(fixedSchedule?.configuration).toMatchObject({ maximumRetryAttempts: 2, maximumEventAgeSeconds: 3600 });
    expect(host?.configuration).toMatchObject({ scheduleAccess: true, runtimeBindingEnvironmentNames: expect.arrayContaining(['APPLIK8S_SCHEDULE_DATABASE_URL']) });
    const hostRole = first.resources.find(({ id }) => id === host?.configuration.runtimeRoleResourceId);
    expect(hostRole?.configuration.statements).toEqual(expect.arrayContaining([
      expect.objectContaining({ actions: expect.arrayContaining(['sqs:ReceiveMessage']), resources: [expect.stringMatching(/:documents-production-schedule-admission$/u)] }),
      expect.objectContaining({
        actions: ['iam:PassRole'],
        resources: ['output://scheduler.execution-role/roleArn'],
        conditions: { StringEquals: { 'iam:PassedToService': ['scheduler.amazonaws.com'] } },
      }),
    ]));
  });

  it('fails closed in the plan when an authored provider has no qualified AWS implementation', () => {
    const base = awsGraph();
    const graph: ApplicationGraph = { ...base, nodes: [...base.nodes, {
        id: 'provider.Search', kind: 'provider', name: 'Search', stability: 'stable',
        interface: 'Search', implementation: 'opensearch',
      }] };
    const plan = compileApplicationAwsDeploymentPlan({ graph, environment: 'review', region: 'us-west-2', accountId: '123456789012' });
    expect(plan.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'AWS_PROVIDER_INCOMPATIBLE', subjectId: 'provider.Search' }),
    ]);
  });

  it('rejects MiniStack-incomplete Kinesis before Alchemy can mutate AWS-local state', () => {
    const graph: ApplicationGraph = {
      ...awsGraph(),
      nodes: [{
        id: 'provider.EventLog',
        kind: 'provider',
        name: 'EventLog',
        stability: 'stable',
        interface: 'EventLog',
        implementation: 'kinesis',
      }],
      edges: [],
      providerRequirements: [],
      providerBindings: [],
    };
    const plan = compileApplicationAwsDeploymentPlan({
      graph,
      environment: 'review',
      region: 'us-east-1',
      accountId: '000000000000',
      target: 'aws-local',
      includeApplicationHosts: false,
    });
    expect(plan.resources.some(({ service }) => service === 'kinesis')).toBe(false);
    expect(plan.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'AWS_PROVIDER_INCOMPATIBLE',
        subjectId: 'provider.EventLog',
        message: expect.stringMatching(/ListTagsForResource/u),
      }),
    ]);
  });

  it('lowers a default provider alias through its canonical authority without duplicating infrastructure', () => {
    const base = awsGraph();
    const objectStorage = base.nodes.find((node) => node.id === 'provider.ObjectStorage');
    if (!objectStorage || objectStorage.kind !== 'provider') throw new Error('ObjectStorage fixture provider is missing.');
    const canonicalId = 'provider.object-storage.v1alpha1.primary';
    const graph: ApplicationGraph = {
      ...base,
      nodes: [
        ...base.nodes.filter((node) => node.id !== objectStorage.id),
        { ...objectStorage, id: canonicalId },
        { ...objectStorage, config: { ...(objectStorage.config ?? {}), aliasOf: canonicalId } },
      ],
    };
    const plan = compileApplicationAwsDeploymentPlan({
      graph,
      environment: 'review',
      profile: 'review',
      region: 'us-east-1',
      accountId: '123456789012',
    });
    const buckets = plan.resources.filter(({ service, resourceType }) => service === 's3' && resourceType === 'bucket');
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.semanticNodeId).toBe(canonicalId);
    expect(plan.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([]);
  });

  it('materializes exact per-workload and per-target security groups for a database-only runtime', () => {
    const base = awsGraph();
    const graph: ApplicationGraph = {
      ...base,
      nodes: base.nodes.filter((node) => [
        'provider.TransactionalDatabase',
        'provider.HttpExposure',
        'model.document',
        'server.web',
      ].includes(node.id)),
      edges: base.edges.filter((edge) => edge.from.nodeId === 'server.web' && edge.to.nodeId === 'provider.TransactionalDatabase'),
      providerRequirements: [],
      providerBindings: [],
    };
    const plan = compileApplicationAwsDeploymentPlan({
      graph,
      environment: 'review',
      region: 'us-east-1',
      accountId: '123456789012',
    });
    expect(plan.diagnostics).toEqual([]);
    const host = plan.resources.find(({ resourceType }) => resourceType === 'fargate-service');
    const database = plan.resources.find(({ service }) => service === 'rds');
    const executionRole = plan.resources.find(({ id }) => id === host?.configuration.executionRoleResourceId);
    const workloadGroup = plan.resources.find(({ id }) => id === host?.configuration.runtimeAccessSecurityGroupResourceId);
    const targetGroup = plan.resources.find(({ id }) => id === database?.configuration.runtimeAccessSecurityGroupResourceId);
    const serviceEndpoints = plan.resources.filter(({ service, resourceType }) => service === 'ec2' && resourceType === 'vpc-endpoint');
    const endpointServices = serviceEndpoints.map(({ configuration }) => configuration.endpointService).sort();
    expect(workloadGroup).toMatchObject({
      service: 'ec2',
      resourceType: 'security-group',
      configuration: {
        runtimeAccessKind: 'workload',
        workloadResourceId: host?.id,
        egressMode: 'explicit',
      },
    });
    const egressRules = workloadGroup?.configuration.egressRules;
    expect(Array.isArray(egressRules)).toBe(true);
    if (!Array.isArray(egressRules)) throw new Error('Expected a concrete workload egress rule array.');
    expect(egressRules.some((rule) => isRecord(rule) && rule.kind === 'securityGroup' && rule.protocol === 'tcp' && rule.port === 5432 && rule.targetResourceId === database?.id)).toBe(true);
    expect(egressRules.some((rule) => isRecord(rule) && rule.kind === 'cidr' && rule.protocol === 'tcp' && rule.port === 53 && rule.cidr === '10.64.0.2/32')).toBe(true);
    expect(egressRules.some((rule) => isRecord(rule) && rule.kind === 'cidr' && rule.protocol === 'udp' && rule.port === 53 && rule.cidr === '10.64.0.2/32')).toBe(true);
    expect(egressRules.some((rule) => isRecord(rule) && rule.kind === 'securityGroup' && rule.protocol === 'tcp' && rule.port === 443 && typeof rule.targetResourceId === 'string' && rule.targetResourceId.startsWith('runtime-network.aws-service.'))).toBe(true);
    expect(egressRules.some((rule) => isRecord(rule) && rule.kind === 'prefixList' && rule.protocol === 'tcp' && rule.port === 443 && typeof rule.targetResourceId === 'string' && rule.targetResourceId.startsWith('runtime-network.aws-service.'))).toBe(true);
    expect(endpointServices).toEqual(['ecr.api', 'ecr.dkr', 'logs', 's3', 'secretsmanager']);
    expect(serviceEndpoints.find(({ configuration }) => configuration.endpointService === 's3')?.configuration)
      .toMatchObject({ endpointType: 'gateway', routeTableScope: 'private' });
    expect(serviceEndpoints
      .filter(({ configuration }) => configuration.endpointType === 'interface')
      .every(({ configuration }) => typeof configuration.securityGroupResourceId === 'string'))
      .toBe(true);
    expect(targetGroup).toMatchObject({
      service: 'ec2',
      resourceType: 'security-group',
      configuration: {
        runtimeAccessKind: 'target',
        targetResourceId: database?.id,
        egressMode: 'explicit',
      },
    });
    const ingressRules = targetGroup?.configuration.ingressRules;
    expect(Array.isArray(ingressRules)).toBe(true);
    if (!Array.isArray(ingressRules)) throw new Error('Expected a concrete target ingress rule array.');
    expect(ingressRules.some((rule) => isRecord(rule)
      && rule.kind === 'securityGroup'
      && rule.protocol === 'tcp'
      && rule.port === 5432
      && rule.sourceSecurityGroupResourceId === workloadGroup?.id)).toBe(true);
    expect(host?.configuration.runtimeAccessSecurityGroupResourceId).not.toBe('foundation.security-group.application');
    expect(database?.configuration.runtimeAccessSecurityGroupResourceId).not.toBe('foundation.security-group.application');
    expect(executionRole).toMatchObject({
      service: 'iam',
      resourceType: 'role',
      configuration: {
        rolePurpose: 'ecs-execution',
        managedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'],
        statements: [{ effect: 'Allow', actions: ['secretsmanager:GetSecretValue'], resources: ['output://provider.provider.TransactionalDatabase/secretArn'] }],
      },
    });
    expect(validateAwsRuntimeAccessParity(plan.runtimeAccess, plan.resources, plan.edges)).toEqual([]);
    expect(validateAwsRuntimeAccessParity(
      plan.runtimeAccess,
      plan.resources.filter(({ id }) => id !== executionRole?.id),
      plan.edges,
    )).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'RUNTIME_ACCESS_EXECUTION_ROLE_MISSING' })]));
    expect(validateAwsRuntimeAccessParity(
      plan.runtimeAccess,
      plan.resources.map((entry) => entry.id === executionRole?.id
        ? { ...entry, configuration: { ...entry.configuration, statements: [] } }
        : entry),
      plan.edges,
    )).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'RUNTIME_ACCESS_BOOTSTRAP_IAM_MISSING' })]));
    expect(validateAwsRuntimeAccessParity(
      plan.runtimeAccess,
      plan.resources.filter(({ id }) => id !== workloadGroup?.id),
      plan.edges,
    )).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'RUNTIME_ACCESS_NETWORK_MISSING' })]));
    const secretsEndpoint = serviceEndpoints.find(({ configuration }) => configuration.endpointService === 'secretsmanager');
    expect(validateAwsRuntimeAccessParity(
      plan.runtimeAccess,
      plan.resources.filter(({ id }) => id !== secretsEndpoint?.id),
      plan.edges,
    )).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'RUNTIME_ACCESS_NETWORK_MISSING' })]));
    const mutateWorkloadRules = (mutate: (rule: DeploymentJsonObject) => DeploymentJsonObject) => plan.resources.map((entry) => entry.id === workloadGroup?.id
      ? {
          ...entry,
          configuration: {
            ...entry.configuration,
            egressRules: (entry.configuration.egressRules as DeploymentJsonObject[]).map(mutate),
          },
        }
      : entry);
    expect(validateAwsRuntimeAccessParity(plan.runtimeAccess, mutateWorkloadRules((rule) => rule.targetResourceId === database?.id ? { ...rule, port: 5433 } : rule), plan.edges))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'RUNTIME_ACCESS_NETWORK_WRONG_PORT' })]));
    expect(validateAwsRuntimeAccessParity(plan.runtimeAccess, mutateWorkloadRules((rule) => rule.targetResourceId === database?.id ? { ...rule, protocol: 'udp' } : rule), plan.edges))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'RUNTIME_ACCESS_NETWORK_WRONG_PROTOCOL' })]));
    expect(validateAwsRuntimeAccessParity(plan.runtimeAccess, plan.resources.map((entry) => entry.id === workloadGroup?.id
      ? { ...entry, configuration: { ...entry.configuration, policyDigest: `sha256:${'0'.repeat(64)}` } }
      : entry), plan.edges))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'RUNTIME_ACCESS_NETWORK_MISBOUND' })]));
    expect(validateAwsRuntimeAccessParity(plan.runtimeAccess, mutateWorkloadRules((rule) => rule.targetResourceId === database?.id
      ? { ...rule, targetSecurityGroupResourceId: 'foundation.security-group.application' }
      : rule), plan.edges))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'RUNTIME_ACCESS_NETWORK_MISBOUND' })]));
    expect(validateAwsRuntimeAccessParity(plan.runtimeAccess, plan.resources.map((entry) => entry.id === workloadGroup?.id
      ? {
          ...entry,
          configuration: {
            ...entry.configuration,
            egressRules: [...(entry.configuration.egressRules as DeploymentJsonObject[]), { kind: 'cidr', protocol: 'tcp', port: 443, cidr: '0.0.0.0/0' }],
          },
        }
      : entry), plan.edges))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'RUNTIME_ACCESS_NETWORK_WIDENED' })]));
  });

  it('does not install service discovery for an external aws-local host with no in-target services', () => {
    const graph: ApplicationGraph = {
      ...awsGraph(),
      nodes: awsGraph().nodes.filter((node) => node.kind === 'provider' && ['ObjectStorage', 'Queue', 'EventLog'].includes(node.interface)),
      edges: [],
    };
    const plan = compileApplicationAwsDeploymentPlan({
      graph,
      target: 'aws-local',
      includeApplicationHosts: false,
      environment: 'review',
      region: 'us-east-1',
      accountId: '000000000000',
    });
    expect(plan.resources.some(({ service }) => service === 'service-discovery')).toBe(false);
    expect(plan.resources.some(({ service }) => service === 'ec2')).toBe(false);
    expect(plan.resources.some(({ service }) => service === 'ecs' || service === 'ecr' || service === 'cloudwatch')).toBe(false);
  });

  it('requires an HTTP exposure for exported realtime actors and records that routing demand on celld', () => {
    const graph = awsActorGraph();
    const withoutExposure: ApplicationGraph = {
      ...graph,
      nodes: graph.nodes.filter((node) => node.kind !== 'provider' || node.interface !== 'HttpExposure'),
    };
    const rejected = compileApplicationAwsDeploymentPlan({ graph: withoutExposure, environment: 'review', region: 'us-east-1', accountId: '123456789012' });
    expect(rejected.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'AWS_CONFIGURATION_UNRESOLVED', message: expect.stringMatching(/realtime actors require an HttpExposure/u) }),
    ]));

    const accepted = compileApplicationAwsDeploymentPlan({ graph, environment: 'review', region: 'us-east-1', accountId: '123456789012' });
    expect(accepted.diagnostics).toEqual([]);
    expect(accepted.resources.find(({ resourceType }) => resourceType === 'celld-fleet')?.configuration)
      .toMatchObject({ publicConnectionGateway: true });
  });

  it('lowers managed TLS and DNS per exposure using the most-specific target hosted zone', () => {
    const base = awsGraph();
    const graph: ApplicationGraph = {
      ...base,
      nodes: [
        ...base.nodes,
        { id: 'provider.Certificate', kind: 'provider', name: 'Certificate', stability: 'stable', interface: 'Certificate', implementation: 'cert-manager' },
        { id: 'provider.DnsPublication', kind: 'provider', name: 'DnsPublication', stability: 'stable', interface: 'DnsPublication', implementation: 'external-dns' },
        {
          id: 'exposure.web', kind: 'exposure', name: 'web', stability: 'stable',
          provider: { interface: 'HttpExposure', nodeId: 'provider.HttpExposure' },
          certificate: { interface: 'Certificate', nodeId: 'provider.Certificate' },
          dnsPublication: { interface: 'DnsPublication', nodeId: 'provider.DnsPublication' },
          service: 'web', hostnames: ['app.customer.example.com', 'api.example.com'],
          tlsIntent: { mode: 'managed', secretName: 'web-tls', issuerRef: { name: 'production', kind: 'ClusterIssuer' } },
          dnsIntent: { mode: 'managed', ttlSeconds: 120 }, publicUrl: 'https://app.customer.example.com',
          transport: { kind: 'ingress' },
          readiness: { ingress: 'resourceApplied', service: 'resourceApplied', loadBalancer: 'statusObserved', certificate: 'readyCondition', dns: 'propagationUnverified', publicUrl: 'derived' },
          generatedResources: [],
        },
      ],
    };
    const missing = compileApplicationAwsDeploymentPlan({ graph, environment: 'production', region: 'us-east-1', accountId: '123456789012' });
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({ code: 'AWS_CONFIGURATION_UNRESOLVED', subjectId: 'exposure.web', message: expect.stringMatching(/hosted-zone binding/u) }));

    const plan = compileApplicationAwsDeploymentPlan({
      graph, environment: 'production', region: 'us-east-1', accountId: '123456789012',
      hostedZones: { 'example.com': 'ZEXAMPLE', 'customer.example.com': 'ZCUSTOMER' },
    });
    expect(plan.diagnostics).toEqual([]);
    expect(plan.resources.filter(({ service }) => service === 'acm')).toEqual([
      expect.objectContaining({
        semanticNodeId: 'exposure.web',
        configuration: expect.objectContaining({
          domainName: 'app.customer.example.com',
          subjectAlternativeNames: ['api.example.com'],
          domainValidationOptions: [
            { domainName: 'app.customer.example.com', hostedZoneId: 'ZCUSTOMER' },
            { domainName: 'api.example.com', hostedZoneId: 'ZEXAMPLE' },
          ],
        }),
      }),
    ]);
    expect(plan.resources.filter(({ service }) => service === 'route53')).toEqual(expect.arrayContaining([
      expect.objectContaining({ configuration: expect.objectContaining({ recordName: 'app.customer.example.com', hostedZoneId: 'ZCUSTOMER', loadBalancerResourceId: 'provider.provider.HttpExposure' }) }),
      expect.objectContaining({ configuration: expect.objectContaining({ recordName: 'api.example.com', hostedZoneId: 'ZEXAMPLE', loadBalancerResourceId: 'provider.provider.HttpExposure' }) }),
    ]));
    expect(plan.resources.find(({ id }) => id === 'provider.provider.HttpExposure')?.configuration.tlsRequired).toBe(true);
  });

  it('rejects invalid account, region, environment, and single-zone production requests before effects', () => {
    const graph = awsGraph();
    expect(() => compileApplicationAwsDeploymentPlan({ graph, environment: 'Production', region: 'us-east-1', accountId: '123456789012' })).toThrow(/environment/u);
    expect(() => compileApplicationAwsDeploymentPlan({ graph, environment: 'production', region: 'earth-1', accountId: '123456789012' })).toThrow(/region/u);
    expect(() => compileApplicationAwsDeploymentPlan({ graph, environment: 'production', region: 'us-east-1', accountId: '123' })).toThrow(/accountId/u);
    expect(() => compileApplicationAwsDeploymentPlan({ graph, environment: 'production', region: 'us-east-1', accountId: '123456789012', availabilityZones: ['us-east-1a'] })).toThrow(/two availability zones/u);
  });

  it('fails closed instead of rounding unsupported second-precision schedules', () => {
    const base = awsGraph();
    const secondPrecision = {
      ...base,
      nodes: base.nodes.map((node) => node.kind === 'schedule'
        ? { ...node, definition: { ...node.definition, every: '30s', requirements: { ...node.definition.requirements, precision: 'second' as const } } }
        : node),
    } satisfies ApplicationGraph;
    expect(() => compileApplicationAwsDeploymentPlan({ graph: secondPrecision, environment: 'review', region: 'us-east-1', accountId: '123456789012' }))
      .toThrow(/SCHEDULE_PRECISION_UNSUPPORTED/u);

    const inexactMinute = {
      ...base,
      nodes: base.nodes.map((node) => node.kind === 'schedule'
        ? { ...node, definition: { ...node.definition, every: '90s' } }
        : node),
    } satisfies ApplicationGraph;
    expect(() => compileApplicationAwsDeploymentPlan({ graph: inexactMinute, environment: 'review', region: 'us-east-1', accountId: '123456789012' }))
      .toThrow(/exact multiples of 60 seconds/u);
  });

  it('plans immutable S3/Glue/Athena lakehouse infrastructure with a managed cursor authority', () => {
    const graph = awsLakehouseGraph();
    const plan = compileApplicationAwsDeploymentPlan({ graph, environment: 'review', region: 'us-east-1', accountId: '123456789012' });
    expect(plan.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ service: 's3', resourceType: 'lakehouse-dataset', configuration: expect.objectContaining({ qualification: 'history', catalogResourceId: expect.any(String) }) }),
      expect.objectContaining({ service: 'glue', resourceType: 'catalog-database', configuration: { qualification: 'history' } }),
      expect.objectContaining({ service: 's3', resourceType: 'bucket', configuration: expect.objectContaining({ purpose: 'athena-query-results', forceDestroy: false }) }),
      expect.objectContaining({ service: 'athena', resourceType: 'workgroup', configuration: expect.objectContaining({ qualification: 'history-queries', resultBucketResourceId: expect.any(String) }) }),
      expect.objectContaining({ id: 'lakehouse.cursor-signing', service: 'secrets-manager' }),
    ]));
    expect(plan.diagnostics).toEqual([]);
  });

  it('carries compiler-owned runtime identity into one exact-role Fargate worker', () => {
    const base = awsGraph();
    const graph: ApplicationGraph = {
      ...base,
      nodes: [
        ...base.nodes,
        { id: 'provider.EventLog', kind: 'provider', name: 'EventLog', stability: 'stable', interface: 'EventLog', implementation: 'kinesis' },
        { id: 'provider.AuditDatabase', kind: 'provider', name: 'AuditDatabase', stability: 'stable', interface: 'TransactionalDatabase', implementation: 'postgres' },
        {
          id: 'model.audit', kind: 'model', name: 'Audit', stability: 'stable', entity: { name: 'Audit' },
          database: { interface: 'TransactionalDatabase', nodeId: 'provider.AuditDatabase' },
          schema: { identity: ['id'], constraints: [], indexes: [], migrations: { strategy: 'none', compatibility: 'schemaCompatibleOnly' }, transactions: 'required' },
          materialization: { mode: 'providerBacked', provider: { interface: 'TransactionalDatabase', nodeId: 'provider.AuditDatabase' }, backingResources: [], connection: {}, runtimeBoundary: { serializedCallbacks: 'generatedRuntimeClient', scriptExecution: 'scriptRuntimeClient' }, reconciliation: { ownership: 'application', schemaDrift: 'failClosed', deletionPolicy: 'retain' } },
          runtime: { name: 'Audit', tableName: 'audit', provider: 'postgres', database: 'audit', clusterName: 'audit', secretName: 'audit-app', secretKey: 'uri', connectionEnvName: 'APPLIK8S_DATABASE_AUDIT_URL', constraints: [], indexes: [], retention: { mode: 'retain' } },
        },
        { id: 'command.document-create', kind: 'command', name: 'document-create', stability: 'stable', contract: { name: 'document.create', version: 'v1', input: { kind: 'declared', runtime: 'arktype', jsonSchema: {} }, output: { kind: 'declared', runtime: 'arktype', jsonSchema: {} }, errors: [] } },
        {
          id: 'commandHandler.document-create', kind: 'commandHandler', name: 'document-create', stability: 'stable', model: { nodeId: 'model.document' }, command: { nodeId: 'command.document-create' },
          key: { kind: 'field', source: 'input.id' }, ordering: 'serial', missing: 'reject', transaction: { models: [{ nodeId: 'model.document' }], history: [], outbox: [] },
          retry: { mode: 'boundedExponentialBackoff', maxAttempts: 5 }, retention: { replayWindowSeconds: 3600, auditWindowSeconds: 3600, publishedOutboxWindowSeconds: 3600, cleanupIntervalSeconds: 60, cleanupBatchSize: 100 },
          effectBoundary: 'transactionSafeOnly', effectEnforcement: { sourceAnalysis: 'closedStructuralAllowlist', runtimeMembrane: 'asyncContextAmbientIo', externalEffects: 'outboxOrTaskOnly' }, handlerSource: 'async () => ({})',
          projectionReadiness: { submissionAcknowledgement: 'transportOnly', durableResultAuthority: 'postgresCommandResults', duplicateRecovery: 'idempotentRedelivery', correlation: 'commandCorrelationCausation', resultRevisionAuthority: 'postgresCommandResults', stateRevisionAuthority: 'modelRevision', reconciliationLink: 'modelRevisionWhenPresent' },
        },
        {
          id: 'processor.documents', kind: 'processor', name: 'documents', stability: 'stable', handlers: [{ nodeId: 'commandHandler.document-create' }], runtime: 'node',
          deployment: { replicas: 1, concurrency: 1, maxAckPending: 32, resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '1', memory: '512Mi' } }, disruption: { maxUnavailable: 1 } },
          inference: 'generated', lifecycle: 'longLived', eventLog: { interface: 'EventLog', nodeId: 'provider.EventLog' },
        },
      ],
      edges: [...base.edges, { from: { nodeId: 'provider.EventLog' }, to: { nodeId: 'processor.documents' }, relationship: 'provides' }],
    };
    const artifact = {
      nodeId: 'processor.documents',
      name: 'documents-worker',
      role: 'processor' as const,
      source: '/workspace/application/.applik8s/compiled/processors/documents/worker.mjs',
      digest: `sha256:${'a'.repeat(64)}` as const,
      container: {
        image: 'applik8s/documents-worker:generated',
        imageName: 'documents-worker',
        tag: 'generated',
        baseImage: 'node:22.20.0-bookworm-slim',
        contextPath: '/workspace/application/.applik8s/compiled/processors/documents/container',
        dockerfilePath: '/workspace/application/.applik8s/compiled/processors/documents/container/Dockerfile',
        entrypoint: '/app/worker.mjs',
        command: ['node', '/app/worker.mjs'],
        sourceDigest: `sha256:${'b'.repeat(64)}` as const,
      },
    };
    const plan = compileApplicationAwsDeploymentPlan({
      graph,
      environment: 'review',
      region: 'us-east-1',
      accountId: '123456789012',
      runtimeArtifacts: [artifact],
      workspaceRoot: '/workspace/application',
    });

    expect(plan.diagnostics).toEqual([]);
    expect(plan.runtimeArtifacts).toEqual([expect.objectContaining({
      nodeId: 'processor.documents',
      source: '.applik8s/compiled/processors/documents/worker.mjs',
      container: expect.objectContaining({ contextPath: '.applik8s/compiled/processors/documents/container' }),
    })]);
    const worker = plan.resources.find(({ resourceType }) => resourceType === 'fargate-worker');
    const role = plan.resources.find(({ id }) => id === worker?.configuration.runtimeRoleResourceId);
    const executionRole = plan.resources.find(({ id }) => id === worker?.configuration.executionRoleResourceId);
    expect(worker).toMatchObject({
      service: 'ecs',
      semanticNodeId: artifact.nodeId,
      configuration: {
        artifactId: 'processor:processor.documents',
        artifactDigest: artifact.digest,
        artifactSourceDigest: artifact.container.sourceDigest,
        command: artifact.container.command,
        desiredCount: 1,
        autoscalingMinCapacity: 1,
        autoscalingMaxCapacity: 4,
        autoscalingTargetCpuUtilization: 60,
        runtimeRoleResourceId: role?.id,
        eventTransport: 'kinesis',
        eventStreamResourceId: 'provider.provider.EventLog',
        checkpointTableResourceId: 'framework.kinesis-checkpoints',
        databaseEnvironmentName: 'APPLIK8S_DATABASE_DOCUMENTS_URL',
        runtimeBindingEnvironmentNames: ['APPLIK8S_DATABASE_DOCUMENTS_URL'],
      },
    });
    expect(plan.resources).toContainEqual(expect.objectContaining({ id: 'framework.kinesis-checkpoints', service: 'dynamodb', resourceType: 'kinesis-checkpoint-table' }));
    expect(role?.configuration.statements).toEqual(expect.arrayContaining([
      expect.objectContaining({ actions: expect.arrayContaining(['kinesis:GetRecords', 'kinesis:PutRecord']) }),
      expect.objectContaining({ actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:UpdateItem'] }),
    ]));
    expect(JSON.stringify(role?.configuration.statements)).not.toContain('secretsmanager:GetSecretValue');
    expect(executionRole).toMatchObject({
      service: 'iam', resourceType: 'role',
      configuration: {
        rolePurpose: 'ecs-execution',
        managedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'],
        statements: [expect.objectContaining({ actions: ['secretsmanager:GetSecretValue'], resources: ['output://provider.provider.TransactionalDatabase/secretArn'] })],
      },
    });
    expect(JSON.stringify(role)).not.toContain('provider.provider.AuditDatabase');
    expect(JSON.stringify(worker)).not.toContain('APPLIK8S_DATABASE_AUDIT_URL');
    expect(plan.edges).toContainEqual({ from: role?.id, to: worker?.id, relationship: 'assumesRole' });
    expect(plan.edges).toContainEqual({ from: executionRole?.id, to: worker?.id, relationship: 'assumesRole', output: 'ecs-execution' });
  });

  it('places serving runtime artifacts behind private service discovery instead of treating them as background workers', () => {
    const graph = awsGraph();
    const artifact = {
      nodeId: 'server.web', name: 'typed-http', role: 'http' as const,
      executionNodeIds: ['server.web', 'schedule.cleanup'],
      source: '/workspace/application/.applik8s/compiled/http/web/runtime.mjs',
      digest: `sha256:${'c'.repeat(64)}` as const,
      container: {
        image: 'applik8s/typed-http:generated', imageName: 'typed-http', tag: 'generated', baseImage: 'node:22.20.0-bookworm-slim',
        contextPath: '/workspace/application/.applik8s/compiled/http/web/container', dockerfilePath: '/workspace/application/.applik8s/compiled/http/web/container/Dockerfile',
        entrypoint: '/app/http.mjs', command: ['node', '/app/http.mjs'], sourceDigest: `sha256:${'d'.repeat(64)}` as const,
      },
    };
    const plan = compileApplicationAwsDeploymentPlan({ graph, environment: 'review', region: 'us-east-1', accountId: '123456789012', runtimeArtifacts: [artifact] });
    const service = plan.resources.find(({ resourceType }) => resourceType === 'fargate-runtime-service');
    expect(service).toMatchObject({
      service: 'ecs', semanticNodeId: 'server.web',
      configuration: {
        artifactId: 'http:server.web', port: 3000, healthPort: 3000, healthPath: '/readyz',
        desiredCount: 2,
        autoscalingMinCapacity: 2,
        autoscalingMaxCapacity: 8,
        autoscalingTargetCpuUtilization: 60,
        discoveryNamespaceResourceId: 'foundation.discovery',
      },
      outputs: expect.arrayContaining([expect.objectContaining({ name: 'endpoint' })]),
    });
    expect(String(service?.configuration.endpoint)).toMatch(/^http:\/\/[a-z0-9-]+\.[a-z0-9-]+\.internal:3000$/u);
    expect(plan.edges).toContainEqual({ from: 'foundation.discovery', to: service?.id, relationship: 'requiresReady' });
    expect(plan.resources.some(({ resourceType }) => resourceType === 'fargate-service')).toBe(false);
  });

  it('lowers an AWS finite Job artifact to a private controller with exact worker network inputs', () => {
    const base = awsGraph();
    const jobRuntime = {
      id: 'provider.JobRuntime',
      kind: 'provider' as const,
      name: 'JobRuntime',
      stability: 'experimental' as const,
      interface: 'JobRuntime',
      implementation: 'aws-job-runtime',
      config: {},
    };
    const graph = { ...base, nodes: [...base.nodes, jobRuntime] };
    const artifact = {
      nodeId: jobRuntime.id,
      name: 'jobs',
      role: 'job' as const,
      source: '/workspace/application/.applik8s/compiled/jobs/controller.mjs',
      digest: `sha256:${'e'.repeat(64)}` as const,
      container: {
        image: 'applik8s/jobs:generated', imageName: 'jobs', tag: 'generated', baseImage: 'node:22-alpine',
        contextPath: '/workspace/application/.applik8s/compiled/jobs/container',
        dockerfilePath: '/workspace/application/.applik8s/compiled/jobs/container/Dockerfile',
        entrypoint: '/app/controller.mjs', command: ['node', '/app/controller.mjs'],
        sourceDigest: `sha256:${'f'.repeat(64)}` as const,
      },
    };
    const plan = compileApplicationAwsDeploymentPlan({
      graph,
      environment: 'review',
      region: 'us-east-1',
      accountId: '123456789012',
      runtimeArtifacts: [artifact],
    });
    const service = plan.resources.find(({ semanticNodeId }) => semanticNodeId === jobRuntime.id);
    expect(plan.diagnostics).toEqual([]);
    expect(service).toMatchObject({
      service: 'ecs',
      resourceType: 'fargate-runtime-service',
      configuration: {
        artifactId: `job:${jobRuntime.id}`,
        finiteJobController: true,
        port: 8091,
        healthPort: 8091,
        healthPath: '/healthz',
        runtimeBindingEnvironmentNames: ['DATABASE_URL'],
        jobPrivateSubnetResourceIds: ['foundation.subnet.private.1', 'foundation.subnet.private.2'],
        jobSecurityGroupResourceIds: [expect.stringMatching(/^runtime-network\.workload\./u)],
      },
    });
    expect(plan.runtimeBindings).toContainEqual(expect.objectContaining({
      environmentName: 'DATABASE_URL',
      resourceId: expect.stringContaining('TransactionalDatabase'),
    }));
  });

  it('binds a caller only to its compiler-declared runtime receiver', () => {
    const base = awsGraph();
    const receiver = base.nodes.find((node) => node.id === 'server.web');
    if (receiver?.kind !== 'server') throw new Error('Expected the HTTP receiver fixture.');
    const callerNode = { ...receiver, id: 'server.caller', name: 'caller' };
    const graph: ApplicationGraph = { ...base, nodes: [...base.nodes, callerNode] };
    const container = (name: string, digest: string) => ({
      image: `applik8s/${name}:generated`, imageName: name, tag: 'generated', baseImage: 'node:22.20.0-bookworm-slim',
      contextPath: `/workspace/${name}/container`, dockerfilePath: `/workspace/${name}/container/Dockerfile`,
      entrypoint: '/app/http.mjs', command: ['node', '/app/http.mjs'], sourceDigest: `sha256:${digest.repeat(64)}` as const,
    });
    const endpointEnvironmentName = applicationRuntimeEndpointEnvironmentName(receiver.id);
    const runtimeArtifacts = [
      { nodeId: receiver.id, name: 'receiver', role: 'http' as const, source: '/workspace/receiver.mjs', digest: `sha256:${'a'.repeat(64)}` as const, container: container('receiver', 'b'), executionNodeIds: [receiver.id, 'schedule.cleanup'] },
      {
        nodeId: callerNode.id, name: 'caller', role: 'http' as const, source: '/workspace/caller.mjs', digest: `sha256:${'c'.repeat(64)}` as const, container: container('caller', 'd'),
        runtimeEndpoints: [{ nodeId: receiver.id, environmentName: endpointEnvironmentName }],
      },
    ];
    const plan = compileApplicationAwsDeploymentPlan({ graph, environment: 'review', region: 'us-east-1', accountId: '123456789012', runtimeArtifacts });
    expect(plan.diagnostics).toEqual([]);
    const services = plan.resources.filter(({ resourceType }) => resourceType === 'fargate-runtime-service');
    const receiverService = services.find(({ semanticNodeId }) => semanticNodeId === receiver.id);
    const callerService = services.find(({ semanticNodeId }) => semanticNodeId === callerNode.id);
    expect(callerService?.configuration.runtimeEndpointBindings).toEqual([{
      environmentName: endpointEnvironmentName,
      resourceId: receiverService?.id,
    }]);
    expect(JSON.stringify(callerService)).not.toContain(applicationRuntimeEndpointEnvironmentName('server.unrelated'));
    expect(plan.edges).toContainEqual({ from: receiverService?.id, to: callerService?.id, relationship: 'requiresReady' });
  });

  it('lowers Hatchet into an exact private workflow authority and binds only dependent workloads', () => {
    const base = awsGraph();
    const workflowProvider = {
      id: 'provider.WorkflowEngine', kind: 'provider', name: 'WorkflowEngine', stability: 'stable',
      interface: 'WorkflowEngine', implementation: 'hatchet', config: {},
    } as const;
    const graph: ApplicationGraph = {
      ...base,
      nodes: [...base.nodes, workflowProvider],
      edges: [
        ...base.edges,
        { from: { nodeId: workflowProvider.id }, to: { nodeId: 'server.web' }, relationship: 'provides' },
      ],
      providerRequirements: [
        ...base.providerRequirements,
        {
          id: 'requirement.workflow.server',
          interface: 'WorkflowEngine',
          consumer: { nodeId: 'server.web' },
          provider: { interface: 'WorkflowEngine', nodeId: workflowProvider.id },
          required: true,
          purpose: 'durable workflow invocation',
          diagnostics: { missing: 'missing workflow engine', ambiguous: 'ambiguous workflow engine' },
        },
      ],
      providerBindings: [
        ...base.providerBindings,
        {
          requirement: 'requirement.workflow.server',
          provider: { interface: 'WorkflowEngine', nodeId: workflowProvider.id },
          generatedResources: [],
          runtime: {},
        },
      ],
    };
    const plan = compileApplicationAwsDeploymentPlan({
      graph,
      environment: 'review',
      region: 'us-east-1',
      accountId: '123456789012',
    });
    expect(plan.diagnostics).toEqual([]);
    const engine = plan.resources.find(({ resourceType }) => resourceType === 'hatchet-service');
    expect(engine).toMatchObject({
      service: 'ecs',
      semanticNodeId: workflowProvider.id,
      configuration: {
        image: expect.stringMatching(/^ghcr\.io\/hatchet-dev\/hatchet\/hatchet-lite@sha256:[a-f0-9]{64}$/u),
        databaseResourceId: `provider.${workflowProvider.id}.database`,
        credentialsResourceId: `provider.${workflowProvider.id}.credentials`,
        configFilesystemResourceId: `provider.${workflowProvider.id}.config`,
        workerTokenResourceId: `provider.${workflowProvider.id}.worker-token`,
        workerTokenRoleResourceId: `provider.${workflowProvider.id}.worker-token-role`,
      },
    });
    expect(plan.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `provider.${workflowProvider.id}.credentials`, service: 'secrets-manager', resourceType: 'database-credentials' }),
      expect.objectContaining({ id: `provider.${workflowProvider.id}.database`, service: 'rds', resourceType: 'postgresql-instance' }),
      expect.objectContaining({ id: `provider.${workflowProvider.id}.config`, service: 'efs', resourceType: 'shared-filesystem', lifecycle: expect.objectContaining({ deletion: 'retain' }) }),
      expect.objectContaining({ id: `provider.${workflowProvider.id}.worker-token`, service: 'secrets-manager', resourceType: 'workflow-token', configuration: expect.objectContaining({ issuance: 'deployment-bootstrap' }) }),
      expect.objectContaining({
        id: `provider.${workflowProvider.id}.worker-token-role`,
        service: 'iam',
        resourceType: 'role',
        configuration: expect.objectContaining({
          rolePurpose: 'workflow-token-bootstrap',
          statements: [{ effect: 'Allow', actions: ['secretsmanager:PutSecretValue'], resources: [`output://provider.${workflowProvider.id}.worker-token/secretArn`] }],
        }),
      }),
    ]));
    const host = plan.resources.find(({ resourceType, semanticNodeId }) => resourceType === 'fargate-service' && semanticNodeId === 'server.web');
    expect(host?.configuration.workflowEngineResourceIds).toEqual([engine?.id]);
    const hostAccess = plan.runtimeAccess.workloads.find(({ aws }) => aws?.resourceId === host?.id)?.aws;
    expect(hostAccess?.privatePeers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capabilityId: workflowProvider.id,
        protocol: 'TCP',
        port: 7077,
        endpoint: { target: 'aws', resourceId: engine?.id },
        requirementIds: expect.arrayContaining([expect.any(String)]),
      }),
    ]));
    expect(hostAccess?.networkConnections).toEqual(expect.arrayContaining([engine?.id]));
    expect(plan.edges).toEqual(expect.arrayContaining([
      { from: `provider.${workflowProvider.id}.credentials`, to: `provider.${workflowProvider.id}.database`, relationship: 'requiresReady' },
      { from: `provider.${workflowProvider.id}.database`, to: engine?.id, relationship: 'requiresReady' },
      { from: `provider.${workflowProvider.id}.config`, to: engine?.id, relationship: 'requiresReady' },
      { from: `provider.${workflowProvider.id}.worker-token`, to: engine?.id, relationship: 'requiresReady' },
      { from: `provider.${workflowProvider.id}.worker-token`, to: `provider.${workflowProvider.id}.worker-token-role`, relationship: 'requiresOutput', output: 'secretArn' },
      { from: `provider.${workflowProvider.id}.worker-token-role`, to: engine?.id, relationship: 'requiresReady' },
    ]));
  });
});

function awsGraph(): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name: 'documents' },
    nodes: [
      { id: 'provider.TransactionalDatabase', kind: 'provider', name: 'TransactionalDatabase', stability: 'stable', interface: 'TransactionalDatabase', implementation: 'postgres' },
      { id: 'provider.ObjectStorage', kind: 'provider', name: 'ObjectStorage', stability: 'stable', interface: 'ObjectStorage', implementation: 's3', config: { objectStorage: { kind: 's3', prefix: 'tenants' } } },
      { id: 'provider.Scheduler', kind: 'provider', name: 'Scheduler', stability: 'stable', interface: 'Scheduler', implementation: 'target-selected' },
      { id: 'provider.Observability', kind: 'provider', name: 'Observability', stability: 'stable', interface: 'Observability', implementation: 'cloudwatch' },
      { id: 'provider.HttpExposure', kind: 'provider', name: 'HttpExposure', stability: 'stable', interface: 'HttpExposure', implementation: 'aws-alb' },
      {
        id: 'model.document', kind: 'model', name: 'Document', stability: 'stable', entity: { name: 'Document' },
        database: { interface: 'TransactionalDatabase', nodeId: 'provider.TransactionalDatabase' },
        schema: { identity: ['id'], constraints: [], indexes: [], migrations: { strategy: 'none', compatibility: 'schemaCompatibleOnly' }, transactions: 'required' },
        materialization: { mode: 'providerBacked', provider: { interface: 'TransactionalDatabase', nodeId: 'provider.TransactionalDatabase' }, backingResources: [], connection: {}, runtimeBoundary: { serializedCallbacks: 'generatedRuntimeClient', scriptExecution: 'scriptRuntimeClient' }, reconciliation: { ownership: 'application', schemaDrift: 'failClosed', deletionPolicy: 'retain' } },
        runtime: { name: 'Document', tableName: 'documents', provider: 'postgres', database: 'documents', clusterName: 'documents', secretName: 'documents-app', secretKey: 'uri', connectionEnvName: 'APPLIK8S_DATABASE_DOCUMENTS_URL', constraints: [], indexes: [], retention: { mode: 'retain' } },
      },
      {
        id: 'objectStore.documents', kind: 'objectStore', name: 'documents', stability: 'stable',
        provider: { interface: 'ObjectStorage', nodeId: 'provider.ObjectStorage' }, objectMode: 'immutable', maxObjectBytes: 1024,
        contentTypes: ['application/pdf'], browserAccess: { upload: 'signed', download: 'signed', downloadAccess: 'owner', ttlSeconds: 60 },
        integrity: 'sha256', credentials: 'server-only', deletion: 'explicit',
      },
      {
        id: 'schedule.cleanup', kind: 'schedule', name: 'cleanup', stability: 'stable',
        definition: { id: 'documents.cleanup', configuration: 'fixed', every: '1h', timezone: 'UTC', overlap: 'skip', misfires: 'latest', maximumLatenessSeconds: 300, retry: { maxAttempts: 3, maximumAgeSeconds: 3600 }, requirements: { configuration: 'fixed', cardinality: 'bounded', precision: 'minute' } },
        scheduler: { interface: 'Scheduler', nodeId: 'provider.Scheduler' },
        state: { interface: 'TransactionalDatabase', nodeId: 'provider.TransactionalDatabase' },
        handler: { source: 'async () => undefined', location: { file: 'src/cleanup.ts', line: 1, column: 1 } },
        functionNative: true,
      },
      {
        id: 'server.web', kind: 'server', name: 'web', stability: 'stable', routes: [], resources: [], indexes: [],
        deployment: { replicas: 2, port: 3000, maxRequestBodyBytes: 1_048_576, mutationRateLimit: { maxRequests: 100, windowSeconds: 60 } },
        exposure: { interface: 'HttpExposure', nodeId: 'provider.HttpExposure' },
        observability: {
          health: { mode: 'http', readinessPath: '/-/healthz', livenessPath: '/-/healthz' },
          logs: { format: 'json', component: 'web', failureEvents: [] },
          metrics: { mode: 'none', names: [] }, events: [], sourceMaps: 'required', replayArtifacts: [],
          diagnosticsArtifact: { kind: 'routeDiagnostics', path: 'diagnostics.json' },
        },
      },
    ],
    edges: [
      { from: { nodeId: 'server.web' }, to: { nodeId: 'objectStore.documents' }, relationship: 'writes' },
      { from: { nodeId: 'server.web' }, to: { nodeId: 'provider.TransactionalDatabase' }, relationship: 'reads' },
    ],
    providerRequirements: [], providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function awsLakehouseGraph(): ApplicationGraph {
  const graph = awsGraph();
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        id: 'provider.lakehouse-dataset.v1alpha1.history', kind: 'provider', name: 'LakehouseDataset', stability: 'stable',
        interface: 'LakehouseDataset', implementation: 's3-dataset',
        config: { qualification: { name: 'history', compatibilityRevision: 'v1alpha1' }, lakehouseDataset: { kind: 's3-dataset', bucket: 'managed', prefix: 'history', region: 'us-east-1', catalog: 'history', schemaRevision: 'v1' } },
      },
      {
        id: 'provider.lakehouse-query.v1alpha1.history-queries', kind: 'provider', name: 'LakehouseQuery', stability: 'stable',
        interface: 'LakehouseQuery', implementation: 'athena-queries',
        config: { qualification: { name: 'history-queries', compatibilityRevision: 'v1alpha1' }, lakehouseQuery: { kind: 'athena-queries', workgroup: 'managed', region: 'us-east-1', resultLocation: 'managed' } },
      },
    ],
  };
}

function awsActorGraph(): ApplicationGraph {
  const graph = awsGraph();
  const schema = { kind: 'declared' as const, runtime: 'arktype' as const, jsonSchema: { type: 'object', properties: {}, additionalProperties: false } };
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      { id: 'provider.ActorRuntime', kind: 'provider', name: 'ActorRuntime', stability: 'experimental', interface: 'ActorRuntime', implementation: 'celld-actors' },
      {
        id: 'actor.workspace.v1', kind: 'actor', name: 'workspace.v1', stability: 'experimental',
        definition: {
          id: 'workspace.v1', key: schema, state: schema, stateVersion: 1,
          migrationDigest: 'sha256:none', migrations: [], protocol: [],
          requirements: {
            durableState: true, serializedTurns: true, transactionalOutbox: true, durableAlarms: true,
            realtimeConnections: true, connectionLeases: true, realtimeMessages: true, realtimeBroadcast: true,
          },
        },
        runtime: { interface: 'ActorRuntime', nodeId: 'provider.ActorRuntime' }, handlers: [],
        semantics: { serialization: 'fullTurnPerIdentity', admission: 'idempotentReceipt', references: 'inertAddress' },
        publication: { boundary: 'entrypoint-export' },
      },
    ],
  };
}

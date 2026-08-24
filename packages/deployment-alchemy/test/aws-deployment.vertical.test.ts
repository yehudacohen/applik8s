// typecast-file-boundary: Test doubles intentionally model untyped AWS SDK responses and Alchemy state records.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ApplicationAwsDeploymentPlan,
  type ApplicationAwsPlanResource,
  applicationRuntimeAccessPlanDigest,
  applicationRuntimeEndpointEnvironmentName,
  normalizeApplicationAwsDeploymentPlan,
  serializeApplicationAwsDeploymentPlan,
  validateApplicationAwsDeploymentPlan,
} from "@applik8s/deployment-contract";
import { afterEach, describe, expect, test } from "vitest";
import {
  type ApplicationAwsTargetDriver,
  type ApplicationAwsTargetState,
  applicationAwsOutputKey,
  applicationAwsStackName,
  createApplicationAwsDeployment,
  createAwsCliTargetDriver,
  synthesizeApplicationAwsCloudFormationTemplate,
} from "../src/index.js";

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("AWS Alchemy target", () => {
  test("lowers the canonical topology to a deterministic private Fargate template", () => {
    const plan = fixturePlan();
    const first = synthesizeApplicationAwsCloudFormationTemplate(plan, { imageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/demo@sha256:abc" });
    const second = synthesizeApplicationAwsCloudFormationTemplate(plan, { imageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/demo@sha256:abc" });
    expect(first).toEqual(second);
    const serialized = JSON.stringify(first);
    expect(serialized).toContain("AWS::EC2::VPC");
    expect(serialized).toContain("AWS::ECS::TaskDefinition");
    expect(serialized).toContain("AWS::ECS::Service");
    expect(serialized).toContain("AWS::ApplicationAutoScaling::ScalableTarget");
    expect(serialized).toContain("AWS::ApplicationAutoScaling::ScalingPolicy");
    expect(serialized).toContain("ECSServiceAverageCPUUtilization");
    expect(serialized).toContain("DISABLED");
    expect(serialized).toContain("awslogs");
    expect(serialized).not.toContain("AWS_SECRET_ACCESS_KEY");
    const foundation = synthesizeApplicationAwsCloudFormationTemplate(plan, { phase: "foundation", imageUri: "unused" });
    expect(JSON.stringify(foundation)).not.toContain("AWS::ECS::TaskDefinition");
  });

  test("materializes exposure-scoped ACM validation and Route53 aliases without placeholder provider values", () => {
    const base = fixturePlan();
    const loadBalancer = planResource('provider.HttpExposure', 'elastic-load-balancing', 'application-load-balancer', 'demo-alb', 'provider.HttpExposure', {
      publicSubnets: ['foundation.subnet.public.1', 'foundation.subnet.public.2'], tlsRequired: true,
    }, ['dnsName', 'zoneId', 'loadBalancerArn']);
    const certificate = planResource('exposure.web.certificate', 'acm', 'certificate', 'demo-web-certificate', 'exposure.web', {
      validation: 'DNS', domainName: 'app.customer.example.com', subjectAlternativeNames: ['api.example.com'],
      domainValidationOptions: [
        { domainName: 'app.customer.example.com', hostedZoneId: 'ZCUSTOMER' },
        { domainName: 'api.example.com', hostedZoneId: 'ZEXAMPLE' },
      ],
    }, ['certificateArn', 'validationRecords']);
    const dns = planResource('exposure.web.dns.api', 'route53', 'record-publication', 'demo-web-dns', 'exposure.web', {
      recordName: 'api.example.com', hostedZoneId: 'ZEXAMPLE', recordType: 'A', alias: true,
      loadBalancerResourceId: loadBalancer.id,
    }, ['fqdn']);
    const plan = normalizeApplicationAwsDeploymentPlan({
      ...base,
      resources: [...base.resources, loadBalancer, certificate, dns],
      edges: [
        ...base.edges,
        { from: certificate.id, to: loadBalancer.id, relationship: 'requiresReady' },
        { from: loadBalancer.id, to: dns.id, relationship: 'requiresOutput', output: 'dnsName' },
      ],
    });
    const template = synthesizeApplicationAwsCloudFormationTemplate(plan, { imageUri: `demo@sha256:${'a'.repeat(64)}` });
    const serialized = JSON.stringify(template);
    expect(serialized).toContain('AWS::CertificateManager::Certificate');
    expect(serialized).toContain('AWS::Route53::RecordSet');
    expect(serialized).toContain('app.customer.example.com');
    expect(serialized).toContain('api.example.com');
    expect(serialized).toContain('ZCUSTOMER');
    expect(serialized).toContain('ZEXAMPLE');
    const listener = Object.values(template.Resources).find(({ Type }) => Type === 'AWS::ElasticLoadBalancingV2::Listener');
    expect(listener?.Properties).toMatchObject({ Port: 443, Protocol: 'HTTPS', Certificates: [expect.objectContaining({ CertificateArn: expect.any(Object) })] });
  });

  test("rejects credential canaries before AWS plans can enter Alchemy state or serialized artifacts", () => {
    const base = fixturePlan();
    const leaked = normalizeApplicationAwsDeploymentPlan({
      ...base,
      resources: base.resources.map((resource, index) => index === 0
        ? { ...resource, configuration: { ...resource.configuration, apiKey: 'sk_release_canary_1234567890' } }
        : resource),
    });
    expect(validateApplicationAwsDeploymentPlan(leaked)).toContainEqual(expect.objectContaining({ code: 'AWS_SENSITIVE_DATA' }));
    expect(() => serializeApplicationAwsDeploymentPlan(leaked)).toThrow(/AWS_SENSITIVE_DATA/u);
    expect(() => createApplicationAwsDeployment({
      plan: leaked,
      stateRoot: '/unused',
      driver: {
        async read() { return undefined; },
        async reconcile() { throw new Error('must not reconcile'); },
        async delete() {},
      },
    })).toThrow(/AWS_SENSITIVE_DATA/u);
  });

  test("adds the OpenTelemetry sidecar only to workloads bound to the collector", () => {
    const base = fixturePlan();
    const collector = planResource("provider.observability", "cloudwatch", "otel-collector", "demo-telemetry", "provider.observability", { logGroup: "foundation.logs", traces: true, metrics: true }, ["logGroupArn", "traceDestinationArn"]);
    const unbound = normalizeApplicationAwsDeploymentPlan({ ...base, resources: [...base.resources, collector] });
    const imageUri = `demo@sha256:${"a".repeat(64)}`;
    expect(JSON.stringify(synthesizeApplicationAwsCloudFormationTemplate(unbound, { imageUri }))).not.toContain("aws-otel-collector");
    const bound = normalizeApplicationAwsDeploymentPlan({
      ...unbound,
      resources: unbound.resources.map((resource) => resource.id === "application-host.web"
        ? { ...resource, configuration: { ...resource.configuration, observabilityResourceIds: [collector.id] } }
        : resource),
    });
    const serialized = JSON.stringify(synthesizeApplicationAwsCloudFormationTemplate(bound, { imageUri }));
    const sidecars = Object.values(synthesizeApplicationAwsCloudFormationTemplate(bound, { imageUri }).Resources)
      .filter(({ Type }) => Type === "AWS::ECS::TaskDefinition")
      .flatMap((resource) => {
        const properties = resource.Properties;
        const definitions = properties && typeof properties === "object" && !Array.isArray(properties)
          ? (properties as Record<string, unknown>).ContainerDefinitions
          : undefined;
        return Array.isArray(definitions) ? definitions : [];
      })
      .filter((definition) => definition && typeof definition === "object" && !Array.isArray(definition) && definition.Name === "aws-otel-collector");
    expect(sidecars).toHaveLength(1);
    expect(serialized).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
  });

  test("lowers each compiler runtime artifact with its immutable image and exact planned task role", () => {
    const plan = runtimeArtifactFixturePlan();
    const artifactId = 'processor:processor.events';
    const image = `123456789012.dkr.ecr.us-east-1.amazonaws.com/demo@sha256:${'d'.repeat(64)}`;
    expect(() => synthesizeApplicationAwsCloudFormationTemplate(plan, { imageUri: `demo@sha256:${'a'.repeat(64)}` })).toThrow(/runtime artifact/u);
    const template = synthesizeApplicationAwsCloudFormationTemplate(plan, {
      imageUri: `demo@sha256:${'a'.repeat(64)}`,
      artifactImageUris: { [artifactId]: image },
    });
    const serialized = JSON.stringify(template);
    expect(serialized).toContain(image);
    expect(serialized).toContain('processor.events');
    expect(serialized).toContain('node /app/processor.mjs'.split(' ').join('","'));
    expect(serialized).toContain('AWS::DynamoDB::Table');
    expect(serialized).toContain('APPLIK8S_KINESIS_CHECKPOINT_TABLE');
    expect(serialized).toContain('APPLIK8S_KINESIS_STREAM');
    expect(serialized).toContain('dynamodb:UpdateItem');
    expect(serialized).toContain('kinesis:GetRecords');
    expect(serialized).not.toContain('"effect":"Allow"');
    expect(Object.values(template.Resources).filter((resource) => resource.Type === 'AWS::ECS::Service')).toHaveLength(2);
    expect(Object.values(template.Resources).filter((resource) => resource.Type === 'AWS::ApplicationAutoScaling::ScalableTarget')).toHaveLength(2);
    expect(Object.values(template.Resources).filter((resource) => resource.Type === 'AWS::ApplicationAutoScaling::ScalingPolicy')).toHaveLength(2);
  });

  test("lowers serving compiler artifacts as private discoverable ECS services with separate health and traffic ports", () => {
    const base = fixturePlan();
    const discovery = planResource("foundation.discovery", "service-discovery", "private-dns-namespace", "demo-internal", undefined, { namespaceName: "demo.internal", vpcResourceId: "foundation.network" }, ["namespaceId", "namespaceArn"]);
    const artifact = {
      name: "workflow", nodeId: "workflowWorker.main", role: "workflow" as const, source: ".applik8s/workflow.mjs", digest: `sha256:${"c".repeat(64)}` as const,
      container: { image: "workflow:generated", imageName: "workflow", tag: "generated", baseImage: "node:22", contextPath: ".applik8s/workflow", dockerfilePath: ".applik8s/workflow/Dockerfile", entrypoint: "/app/worker.mjs", command: ["node", "/app/worker.mjs"], sourceDigest: `sha256:${"d".repeat(64)}` as const },
    };
    const service = planResource("runtime-artifact.workflow", "ecs", "fargate-runtime-service", "demo-workflow", artifact.nodeId, {
      artifactId: "workflow:workflowWorker.main", command: artifact.container.command, desiredCount: 2,
      port: 8081, healthPort: 8080, healthPath: "/ready", discoveryNamespaceResourceId: discovery.id,
      discoveryName: "demo-workflow", endpoint: "http://demo-workflow.demo.internal:8081",
      runtimeBindingEnvironmentNames: [], runtimePublicOutputResourceIds: [], eventStreamResourceIds: [], actorRuntimeResourceIds: [], lakehouseResourceIds: [], observabilityResourceIds: [], runtimeSecretResourceIds: [], scheduleAccess: false,
    }, ["serviceArn", "endpoint"]);
    const callerArtifact = {
      ...artifact,
      name: "mcp",
      nodeId: "mcpServer.public",
      role: "mcp" as const,
      digest: `sha256:${"a".repeat(64)}` as const,
      container: { ...artifact.container, imageName: "mcp", sourceDigest: `sha256:${"b".repeat(64)}` as const },
      runtimeEndpoints: [{ nodeId: artifact.nodeId, environmentName: applicationRuntimeEndpointEnvironmentName(artifact.nodeId) }],
    };
    const caller = planResource("runtime-artifact.mcp", "ecs", "fargate-runtime-service", "demo-mcp", callerArtifact.nodeId, {
      artifactId: "mcp:mcpServer.public", command: callerArtifact.container.command, desiredCount: 1,
      port: 8080, healthPort: 8080, healthPath: "/ready", discoveryNamespaceResourceId: discovery.id,
      discoveryName: "demo-mcp", endpoint: "http://demo-mcp.demo.internal:8080",
      runtimeEndpointBindings: [{ environmentName: applicationRuntimeEndpointEnvironmentName(artifact.nodeId), resourceId: service.id }],
      runtimeBindingEnvironmentNames: [], runtimePublicOutputResourceIds: [], eventStreamResourceIds: [], actorRuntimeResourceIds: [], lakehouseResourceIds: [], observabilityResourceIds: [], runtimeSecretResourceIds: [], scheduleAccess: false,
    }, ["serviceArn", "endpoint"]);
    const plan = normalizeApplicationAwsDeploymentPlan({ ...base, resources: [...base.resources, discovery, service, caller], runtimeArtifacts: [artifact, callerArtifact], edges: [...base.edges, { from: discovery.id, to: service.id, relationship: "requiresReady" }, { from: discovery.id, to: caller.id, relationship: "requiresReady" }, { from: service.id, to: caller.id, relationship: "requiresReady" }] });
    const image = `registry.example/workflow@sha256:${"e".repeat(64)}`;
    const callerImage = `registry.example/mcp@sha256:${"1".repeat(64)}`;
    const template = synthesizeApplicationAwsCloudFormationTemplate(plan, { imageUri: `registry.example/app@sha256:${"f".repeat(64)}`, artifactImageUris: { "workflow:workflowWorker.main": image, "mcp:mcpServer.public": callerImage } });
    const serialized = JSON.stringify(template);
    expect(serialized).toContain("AWS::ServiceDiscovery::PrivateDnsNamespace");
    expect(serialized).toContain("AWS::ServiceDiscovery::Service");
    expect(serialized).toContain('"ContainerPort":8080');
    expect(serialized).toContain('"ContainerPort":8081');
    expect(serialized).toContain("http://demo-workflow.demo.internal:8081");
    expect(serialized).toContain(applicationRuntimeEndpointEnvironmentName(artifact.nodeId));
    expect(serialized).toContain(callerImage);
    expect(serialized).toContain(image);
    expect(Object.values(template.Resources).filter((resource) => resource.Type === "AWS::ApplicationAutoScaling::ScalableTarget")).toHaveLength(3);
    expect(Object.values(template.Resources).filter((resource) => resource.Type === "AWS::ApplicationAutoScaling::ScalingPolicy")).toHaveLength(3);
  });

  test("uses Alchemy as the plan/apply/destroy authority and repairs missing live state", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "applik8s-aws-alchemy-"));
    temporary.push(stateRoot);
    const plan = fixturePlan();
    const calls: string[] = [];
    let live: ApplicationAwsTargetState | undefined;
    const driver: ApplicationAwsTargetDriver = {
      async read() { calls.push("read"); return live; },
      async reconcile(props) {
        calls.push(`reconcile:${props.plan.digest}`);
        live = {
          stackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/demo/one",
          stackName: applicationAwsStackName(props.plan),
          status: "CREATE_COMPLETE",
          planDigest: props.plan.digest,
          outputs: { Url: "https://demo.example" },
          directOutputs: {},
          ownership: "managed",
          ready: true,
        };
        return live;
      },
      async delete() { calls.push("delete"); live = undefined; },
    };
    const deployment = createApplicationAwsDeployment({
      plan,
      stateRoot,
      imageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/demo@sha256:abc",
      driver,
    });
    expect((await deployment.plan()).changes.map(({ action }) => action)).toContain("create");
    const applied = await deployment.apply();
    expect(applied.aws.status).toBe("CREATE_COMPLETE");
    expect((await deployment.plan()).changes.every(({ action }) => action === "noop")).toBe(true);
    live = undefined;
    expect((await deployment.plan()).changes.some(({ action }) => action === "update")).toBe(true);
    await deployment.apply();
    await deployment.destroy();
    expect(calls.some((call) => call.startsWith("reconcile:"))).toBe(true);
    expect(calls).toContain("delete");
  });

  test("uses native CloudFormation drift detection before reporting a target as ready", async () => {
    const plan = fixturePlan();
    const calls: string[][] = [];
    const driver = createAwsCliTargetDriver({
      region: plan.region,
      accountId: plan.accountId!,
      detectDrift: true,
      command: async (args) => {
        calls.push([...args]);
        if (args[0] === 'cloudformation' && args[1] === 'describe-stacks') return JSON.stringify({ Stacks: [{
          StackId: 'stack',
          StackName: applicationAwsStackName(plan),
          StackStatus: 'UPDATE_COMPLETE',
          Tags: [
            { Key: 'applik8s.dev/application', Value: plan.application },
            { Key: 'applik8s.dev/environment', Value: plan.environment },
            { Key: 'applik8s.dev/plan-digest', Value: plan.digest },
          ],
          Outputs: [],
        }] });
        if (args[0] === 'cloudformation' && args[1] === 'detect-stack-drift') return JSON.stringify({ StackDriftDetectionId: 'drift-one' });
        if (args[0] === 'cloudformation' && args[1] === 'describe-stack-drift-detection-status') {
          return JSON.stringify({ DetectionStatus: 'DETECTION_COMPLETE', StackDriftStatus: 'DRIFTED' });
        }
        throw new Error(`Unexpected AWS command ${args.join(' ')}`);
      },
    });
    expect(await driver.read({ plan })).toBeUndefined();
    expect(calls.map((args) => args.slice(0, 2))).toEqual([
      ['cloudformation', 'describe-stacks'],
      ['cloudformation', 'detect-stack-drift'],
      ['cloudformation', 'describe-stack-drift-detection-status'],
    ]);
  });

  test("fails closed when a host image or provider artifact is unresolved", () => {
    const plan = fixturePlan();
    expect(() => synthesizeApplicationAwsCloudFormationTemplate(plan)).toThrow(/imageUri/u);
    const actorState = planResource("provider.actor.state", "s3", "bucket", "demo-actor-state", "provider.actor", {}, ["bucketName", "bucketArn"]);
    const actorAuthorization = planResource("provider.actor.authorization", "secrets-manager", "secret-authority", "demo-actor-auth", "provider.actor", {}, ["secretArn"]);
    const actorConnectionSigning = planResource("provider.actor.connection-signing", "secrets-manager", "secret-authority", "demo-actor-ticket", "provider.actor", {}, ["secretArn"]);
    const actor = planResource("provider.actor", "ecs", "celld-fleet", "demo-actors", "provider.actor", {
      stateResourceId: actorState.id,
      authorizationResourceId: actorAuthorization.id,
      connectionSigningResourceId: actorConnectionSigning.id,
      internalDnsName: "actors.internal",
      applicationEndpoint: "http://demo-service.actors.internal:3000",
    });
    const withActor = normalizeApplicationAwsDeploymentPlan({ ...plan, resources: [...plan.resources, actorState, actorAuthorization, actorConnectionSigning, actor] });
    expect(() => synthesizeApplicationAwsCloudFormationTemplate(withActor, { imageUri: "demo@sha256:abc" })).toThrow(/celldWorkerImageUri/u);
  });

  test("boots celld only after its Worker is deployed and keeps the fleet private", () => {
    const plan = actorFixturePlan();
    const applicationImage = `demo@sha256:${"a".repeat(64)}`;
    const workerImage = `demo@sha256:${"b".repeat(64)}`;
    const foundation = synthesizeApplicationAwsCloudFormationTemplate(plan, {
      phase: "foundation",
      imageUri: applicationImage,
    });
    const bootstrap = synthesizeApplicationAwsCloudFormationTemplate(plan, {
      phase: "bootstrap",
      imageUri: applicationImage,
      celldWorkerImageUri: workerImage,
    });
    const complete = synthesizeApplicationAwsCloudFormationTemplate(plan, {
      phase: "complete",
      imageUri: applicationImage,
      celldWorkerImageUri: workerImage,
    });
    const foundationJson = JSON.stringify(foundation);
    const bootstrapJson = JSON.stringify(bootstrap);
    const completeJson = JSON.stringify(complete);
    expect(foundationJson).not.toContain("celld-worker-deployment");
    expect(foundationJson).not.toContain("AWS::ECS::Service");
    expect(bootstrapJson).toContain("celld-worker-deployment");
    expect(bootstrapJson).toContain(workerImage);
    expect(bootstrapJson).not.toContain('"Name":"celld"');
    expect(bootstrapJson).not.toContain('"Name":"application"');
    expect(completeJson).toContain('"Name":"celld"');
    expect(completeJson).toContain('"--internal-listen"');
    expect(completeJson).toContain('"ContainerPort":8081');
    expect(completeJson).toContain('"CELLD_VAR_APPLIK8S_ACTOR_AUTHORIZATION"');
    expect(completeJson).toContain('"CELLD_VAR_APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION"');
    expect(completeJson).toContain('"CELLD_VAR_APPLIK8S_ACTOR_CONNECTION_SIGNING_KEY"');
    expect(completeJson).toContain('"Name":"application"');
    expect(completeJson).toContain('"AssignPublicIp":"DISABLED"');
    expect(completeJson).toContain("AWS::ServiceDiscovery::PrivateDnsNamespace");
    expect(completeJson).toContain("APPLIK8S_ACTOR_ENDPOINT");
    expect(completeJson).toContain("APPLIK8S_ACTOR_AUTHORIZATION");
    expect(completeJson).toContain("APPLIK8S_INTERNAL_OPERATION_SECRET");
    expect(completeJson).toContain("APPLIK8S_ACTOR_CONNECTION_SIGNING_KEY");
    expect(completeJson).toContain("AWS::ElasticLoadBalancingV2::ListenerRule");
    expect(completeJson).toContain("/__applik8s/v1/actors/*");
  });

  test("boots Hatchet before consumers and exposes only exact private workflow bindings", () => {
    const plan = hatchetFixturePlan();
    const imageUri = `demo@sha256:${"a".repeat(64)}`;
    const foundation = synthesizeApplicationAwsCloudFormationTemplate(plan, { phase: "foundation", imageUri });
    const bootstrap = synthesizeApplicationAwsCloudFormationTemplate(plan, { phase: "bootstrap", imageUri });
    const complete = synthesizeApplicationAwsCloudFormationTemplate(plan, { phase: "complete", imageUri });
    const foundationJson = JSON.stringify(foundation);
    const bootstrapJson = JSON.stringify(bootstrap);
    const completeJson = JSON.stringify(complete);
    expect(foundationJson).not.toContain("hatchet-lite");
    expect(foundationJson).not.toContain("AWS::EFS::FileSystem");
    expect(bootstrapJson).toContain("AWS::EFS::FileSystem");
    expect(bootstrapJson).toContain("AWS::RDS::DBInstance");
    expect(bootstrapJson).toContain("ghcr.io/hatchet-dev/hatchet/hatchet-lite@sha256:");
    expect(bootstrapJson).toContain("public.ecr.aws/aws-cli/aws-cli@sha256:");
    expect(bootstrapJson).toContain("secretsmanager:PutSecretValue");
    expect(bootstrapJson).toContain("workerTokenTaskDefinitionArn");
    expect(bootstrapJson).not.toContain('"Name":"application"');
    expect(completeJson).toContain('"Name":"application"');
    expect(completeJson).toContain("HATCHET_CLIENT_HOST_PORT");
    expect(completeJson).toContain("HATCHET_CLIENT_API_URL");
    expect(completeJson).toContain("HATCHET_CLIENT_TOKEN");
    expect(completeJson).not.toContain("HATCHET_CLIENT_TOKEN_VALUE");
    expect(completeJson).not.toContain('"Action":["secretsmanager:*"]');
  });

  test("deploys the celld Worker exactly once between bootstrap and complete stacks", async () => {
    const root = await mkdtemp(join(tmpdir(), "applik8s-aws-celld-"));
    temporary.push(root);
    const plan = actorFixturePlan();
    const repositoryUri = "123456789012.dkr.ecr.us-east-1.amazonaws.com/demo-artifacts";
    const applicationImage = `${repositoryUri}@sha256:${"a".repeat(64)}`;
    const workerImage = `${repositoryUri}@sha256:${"b".repeat(64)}`;
    const calls: string[][] = [];
    const deployedTemplates: string[] = [];
    const outputRecord = {
      [applicationAwsOutputKey("foundation.registry", "repositoryUri")]: repositoryUri,
      [applicationAwsOutputKey("foundation.compute", "clusterArn")]: "arn:aws:ecs:us-east-1:123456789012:cluster/demo",
      [applicationAwsOutputKey("foundation.subnet.private.1", "subnetId")]: "subnet-private-a",
      [applicationAwsOutputKey("foundation.subnet.private.2", "subnetId")]: "subnet-private-b",
      [applicationAwsOutputKey("provider.actor", "deploymentTaskDefinitionArn")]: "arn:aws:ecs:us-east-1:123456789012:task-definition/demo-actors-deployment:1",
      [applicationAwsOutputKey("provider.actor", "deploymentSecurityGroupId")]: "sg-celld",
    };
    const driver = createAwsCliTargetDriver({
      region: plan.region,
      accountId: plan.accountId!,
      cwd: root,
      command: async (args) => {
        calls.push([...args]);
        if (args[0] === "cloudformation" && args[1] === "deploy") {
          const templatePath = args[args.indexOf("--template-file") + 1];
          deployedTemplates.push(await readFile(templatePath!, "utf8"));
          return "{}";
        }
        if (args[0] === "cloudformation" && args[1] === "get-template") return existingStackTemplateResponse();
        if (args[0] === "cloudformation" && args[1] === "describe-stacks") return JSON.stringify({
          Stacks: [{
            StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/demo/one",
            StackName: applicationAwsStackName(plan),
            StackStatus: "UPDATE_COMPLETE",
            Tags: [
              { Key: "applik8s.dev/application", Value: plan.application },
              { Key: "applik8s.dev/environment", Value: plan.environment },
              { Key: "applik8s.dev/plan-digest", Value: plan.digest },
            ],
            Outputs: Object.entries(outputRecord).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })),
          }],
        });
        if (args[0] === "ecs" && args[1] === "run-task") return JSON.stringify({ tasks: [{ taskArn: "arn:aws:ecs:us-east-1:123456789012:task/demo/worker" }] });
        if (args[0] === "ecs" && args[1] === "describe-tasks") return JSON.stringify({ tasks: [{ containers: [{ name: "celld-worker-deployment", exitCode: 0 }] }] });
        return "{}";
      },
      buildApplicationImage: async () => applicationImage,
      buildCelldWorkerImage: async () => workerImage,
    });
    const state = await driver.reconcile({ plan });
    expect(state.imageUri).toBe(applicationImage);
    expect(deployedTemplates).toHaveLength(3);
    expect(deployedTemplates[0]).toContain("ExistingApplicationService");
    expect(deployedTemplates[0]).not.toContain("celld-worker-deployment");
    expect(deployedTemplates[1]).toContain("celld-worker-deployment");
    expect(deployedTemplates[1]).not.toContain('"Name": "celld"');
    expect(deployedTemplates[2]).toContain('"Name": "celld"');
    expect(calls.filter(([service, operation]) => service === "ecs" && operation === "run-task")).toHaveLength(1);
    expect(calls.filter(([service, operation]) => service === "ecs" && operation === "wait")).toHaveLength(1);
    expect(calls.filter(([service, operation]) => service === "ecs" && operation === "describe-tasks")).toHaveLength(1);
  });

  test("issues the Hatchet worker token exactly once between bootstrap and consumer stacks", async () => {
    const root = await mkdtemp(join(tmpdir(), "applik8s-aws-hatchet-"));
    temporary.push(root);
    const plan = hatchetFixturePlan();
    const repositoryUri = "123456789012.dkr.ecr.us-east-1.amazonaws.com/demo-artifacts";
    const applicationImage = `${repositoryUri}@sha256:${"a".repeat(64)}`;
    const calls: string[][] = [];
    const deployedTemplates: string[] = [];
    const engine = plan.resources.find(({ resourceType }) => resourceType === "hatchet-service")!;
    const outputRecord = {
      [applicationAwsOutputKey("foundation.registry", "repositoryUri")]: repositoryUri,
      [applicationAwsOutputKey("foundation.compute", "clusterArn")]: "arn:aws:ecs:us-east-1:123456789012:cluster/demo",
      [applicationAwsOutputKey("foundation.subnet.private.1", "subnetId")]: "subnet-private-a",
      [applicationAwsOutputKey("foundation.subnet.private.2", "subnetId")]: "subnet-private-b",
      [applicationAwsOutputKey(engine.id, "workerTokenTaskDefinitionArn")]: "arn:aws:ecs:us-east-1:123456789012:task-definition/demo-hatchet-token:1",
      [applicationAwsOutputKey(engine.id, "workerTokenSecurityGroupId")]: "sg-hatchet",
    };
    const driver = createAwsCliTargetDriver({
      region: plan.region,
      accountId: plan.accountId!,
      cwd: root,
      command: async (args) => {
        calls.push([...args]);
        if (args[0] === "cloudformation" && args[1] === "deploy") {
          const templatePath = args[args.indexOf("--template-file") + 1];
          deployedTemplates.push(await readFile(templatePath!, "utf8"));
          return "{}";
        }
        if (args[0] === "cloudformation" && args[1] === "get-template") return existingStackTemplateResponse();
        if (args[0] === "cloudformation" && args[1] === "describe-stacks") return JSON.stringify({
          Stacks: [{
            StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/demo/one",
            StackName: applicationAwsStackName(plan), StackStatus: "UPDATE_COMPLETE",
            Tags: [
              { Key: "applik8s.dev/application", Value: plan.application },
              { Key: "applik8s.dev/environment", Value: plan.environment },
              { Key: "applik8s.dev/plan-digest", Value: plan.digest },
            ],
            Outputs: Object.entries(outputRecord).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })),
          }],
        });
        if (args[0] === "ecs" && args[1] === "run-task") return JSON.stringify({ tasks: [{ taskArn: "arn:aws:ecs:us-east-1:123456789012:task/demo/hatchet-token" }] });
        if (args[0] === "ecs" && args[1] === "describe-tasks") return JSON.stringify({ tasks: [{ containers: [{ name: "issue-token", exitCode: 0 }, { name: "publish-token", exitCode: 0 }] }] });
        return "{}";
      },
      buildApplicationImage: async () => applicationImage,
    });
    await driver.reconcile({ plan });
    expect(deployedTemplates).toHaveLength(3);
    expect(deployedTemplates[0]).not.toContain("hatchet-lite");
    expect(deployedTemplates[1]).toContain("hatchet-lite");
    expect(deployedTemplates[1]).not.toContain('"Name": "application"');
    expect(deployedTemplates[2]).toContain('"Name": "application"');
    expect(calls.filter(([service, operation]) => service === "ecs" && operation === "run-task")).toHaveLength(1);
    expect(calls.filter(([service, operation]) => service === "ecs" && operation === "wait")).toHaveLength(1);
    expect(calls.filter(([service, operation]) => service === "ecs" && operation === "describe-tasks")).toHaveLength(1);
  });

  test("publishes serving runtime artifacts as well as background workers", async () => {
    const root = await mkdtemp(join(tmpdir(), "applik8s-aws-runtime-services-"));
    temporary.push(root);
    const plan = runtimeServiceArtifactFixturePlan();
    const repositoryUri = "123456789012.dkr.ecr.us-east-1.amazonaws.com/demo-artifacts";
    const applicationImage = `${repositoryUri}@sha256:${"a".repeat(64)}`;
    const serviceImage = `${repositoryUri}@sha256:${"b".repeat(64)}`;
    const builds: string[] = [];
    const outputRecord = { [applicationAwsOutputKey("foundation.registry", "repositoryUri")]: repositoryUri };
    const driver = createAwsCliTargetDriver({
      region: plan.region,
      accountId: plan.accountId!,
      cwd: root,
      command: async (args) => {
        if (args[0] === "cloudformation" && args[1] === "get-template") return existingStackTemplateResponse();
        if (args[0] === "cloudformation" && args[1] === "describe-stacks") return JSON.stringify({ Stacks: [{
          StackId: "stack", StackName: applicationAwsStackName(plan), StackStatus: "UPDATE_COMPLETE",
          Tags: [
            { Key: "applik8s.dev/application", Value: plan.application },
            { Key: "applik8s.dev/environment", Value: plan.environment },
            { Key: "applik8s.dev/plan-digest", Value: plan.digest },
          ],
          Outputs: Object.entries(outputRecord).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })),
        }] });
        return "{}";
      },
      buildApplicationImage: async () => applicationImage,
      buildRuntimeArtifactImage: async ({ artifact }) => { builds.push(`${artifact.role}:${artifact.nodeId}`); return serviceImage; },
    });
    const state = await driver.reconcile({ plan });
    expect(builds).toEqual(["http:server.generated"]);
    expect(state.artifactImageUris).toEqual({ "http:server.generated": serviceImage });
  });

  test("fails the deployment when celld Worker bootstrap does not complete successfully", async () => {
    const root = await mkdtemp(join(tmpdir(), "applik8s-aws-celld-failure-"));
    temporary.push(root);
    const plan = actorFixturePlan();
    const repositoryUri = "123456789012.dkr.ecr.us-east-1.amazonaws.com/demo-artifacts";
    const outputRecord = {
      [applicationAwsOutputKey("foundation.registry", "repositoryUri")]: repositoryUri,
      [applicationAwsOutputKey("foundation.compute", "clusterArn")]: "cluster",
      [applicationAwsOutputKey("foundation.subnet.private.1", "subnetId")]: "subnet-a",
      [applicationAwsOutputKey("foundation.subnet.private.2", "subnetId")]: "subnet-b",
      [applicationAwsOutputKey("provider.actor", "deploymentTaskDefinitionArn")]: "worker-task",
      [applicationAwsOutputKey("provider.actor", "deploymentSecurityGroupId")]: "sg-celld",
    };
    const driver = createAwsCliTargetDriver({
      region: plan.region,
      accountId: plan.accountId!,
      cwd: root,
      command: async (args) => {
        if (args[0] === "cloudformation" && args[1] === "get-template") return existingStackTemplateResponse();
        if (args[0] === "cloudformation" && args[1] === "describe-stacks") return JSON.stringify({ Stacks: [{
          StackId: "stack", StackName: applicationAwsStackName(plan), StackStatus: "UPDATE_COMPLETE",
          Tags: [
            { Key: "applik8s.dev/application", Value: plan.application },
            { Key: "applik8s.dev/environment", Value: plan.environment },
            { Key: "applik8s.dev/plan-digest", Value: plan.digest },
          ],
          Outputs: Object.entries(outputRecord).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })),
        }] });
        if (args[0] === "ecs" && args[1] === "run-task") return JSON.stringify({ tasks: [{ taskArn: "worker" }] });
        if (args[0] === "ecs" && args[1] === "describe-tasks") return JSON.stringify({ tasks: [{ containers: [{ exitCode: 17, reason: "Worker deployment rejected" }] }] });
        return "{}";
      },
      buildApplicationImage: async () => `${repositoryUri}@sha256:${"a".repeat(64)}`,
      buildCelldWorkerImage: async () => `${repositoryUri}@sha256:${"b".repeat(64)}`,
    });
    await expect(driver.reconcile({ plan })).rejects.toThrow(/exit code 17.*Worker deployment rejected/u);
  });

  test("renders durable Scheduler admission with contextual identity, redrive, runtime bindings, and least privilege", () => {
    const base = fixturePlan();
    const hostRole = planResource("runtime-role.server-web", "iam", "role", "demo-server-web", "server.web", {
      assumeService: "ecs-tasks.amazonaws.com",
      statements: [
        { effect: "Allow", actions: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes"], resources: ["arn:aws:sqs:us-east-1:123456789012:demo-schedule-admission"] },
        { effect: "Allow", actions: ["scheduler:CreateSchedule", "scheduler:UpdateSchedule", "scheduler:DeleteSchedule", "scheduler:GetSchedule"], resources: ["arn:aws:scheduler:us-east-1:123456789012:schedule/demo-schedules/*"] },
      ],
    }, ["roleArn"]);
    const schedulerExecutionRole = planResource("scheduler.execution-role", "iam", "role", "demo-scheduler-execution", undefined, {
      assumeService: "scheduler.amazonaws.com",
      statements: [{ effect: "Allow", actions: ["sqs:SendMessage"], resources: ["arn:aws:sqs:us-east-1:123456789012:demo-schedule-admission", "arn:aws:sqs:us-east-1:123456789012:demo-schedule-dlq"] }],
    }, ["roleArn"]);
    const resources = [
      ...base.resources.filter(({ id }) => id !== "application-host.web"),
      { ...base.resources.find(({ id }) => id === "application-host.web")!, configuration: { ...base.resources.find(({ id }) => id === "application-host.web")!.configuration, runtimeRoleResourceId: hostRole.id, runtimeBindingEnvironmentNames: ["APPLIK8S_SCHEDULE_DATABASE_URL"], scheduleAccess: true } },
      hostRole,
      schedulerExecutionRole,
      planResource("scheduler.receipts", "rds", "postgresql-instance", "demo-schedule-receipts", undefined, {}, ["endpoint", "port", "secretArn"]),
      planResource("scheduler.group", "eventbridge-scheduler", "schedule-group", "demo-schedules", undefined, {}, ["groupArn"]),
      planResource("scheduler.admission", "sqs", "queue", "demo-schedule-admission", undefined, { visibilityTimeoutSeconds: 300, receiveWaitTimeSeconds: 20, encrypted: true }, ["queueArn", "queueUrl"]),
      planResource("scheduler.dead-letter", "sqs", "queue", "demo-schedule-dlq", undefined, { encrypted: true, retentionSeconds: 1_209_600 }, ["queueArn", "queueUrl"]),
      planResource("schedule.cleanup", "eventbridge-scheduler", "schedule", "demo-cleanup", "schedule.cleanup", {
        definitionId: "cleanup.v1",
        expression: "rate(1 hour)",
        timezone: "UTC",
        maximumRetryAttempts: 3,
        maximumEventAgeSeconds: 3600,
      }, ["scheduleArn"]),
    ];
    const plan = normalizeApplicationAwsDeploymentPlan({
      ...base,
      resources,
      runtimeBindings: [{
        id: "postgres-url.schedule-receipts",
        kind: "postgresUrl",
        environmentName: "APPLIK8S_SCHEDULE_DATABASE_URL",
        resourceId: "scheduler.receipts",
        database: "postgres",
        sensitivity: "sensitive",
      }],
      edges: [
        ...base.edges,
        { from: "scheduler.dead-letter", to: "scheduler.admission", relationship: "requiresReady" },
        { from: "scheduler.group", to: "schedule.cleanup", relationship: "requiresReady" },
        { from: "scheduler.admission", to: "schedule.cleanup", relationship: "requiresOutput", output: "queueArn" },
        { from: "scheduler.dead-letter", to: "schedule.cleanup", relationship: "requiresOutput", output: "queueArn" },
      ],
    });
    const template = synthesizeApplicationAwsCloudFormationTemplate(plan, { imageUri: "demo@sha256:abc" });
    const serialized = JSON.stringify(template);
    expect(serialized).toContain("applik8s.scheduleAdmission/v1alpha1");
    expect(serialized).toContain("<aws.scheduler.scheduled-time>");
    expect(serialized).toContain("RedrivePolicy");
    expect(serialized).toContain("APPLIK8S_AWS_SCHEDULE_QUEUE_URL");
    expect(serialized).toContain("sqs:ReceiveMessage");
    expect(serialized).toContain("scheduler:CreateSchedule");
    expect(serialized).not.toContain('"Action":["sqs:*"]');
  });

  test("publishes the compiler artifact after the ECR foundation and deploys only its immutable digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "applik8s-aws-image-"));
    temporary.push(root);
    const plan = fixturePlan();
    const repositoryUri = "123456789012.dkr.ecr.us-east-1.amazonaws.com/demo-artifacts";
    const imageUri = `${repositoryUri}@sha256:${"a".repeat(64)}`;
    const calls: string[][] = [];
    const builds: string[] = [];
    const driver = createAwsCliTargetDriver({
      region: plan.region,
      ...(plan.accountId ? { accountId: plan.accountId } : {}),
      cwd: root,
      command: async (args) => {
        calls.push([...args]);
        if (args[0] === "cloudformation" && args[1] === "get-template") return existingStackTemplateResponse();
        if (args[0] === "cloudformation" && args[1] === "describe-stacks") return JSON.stringify({
          Stacks: [{
            StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/demo/one",
            StackName: applicationAwsStackName(plan),
            StackStatus: "UPDATE_COMPLETE",
            Tags: [
              { Key: "applik8s.dev/application", Value: plan.application },
              { Key: "applik8s.dev/environment", Value: plan.environment },
              { Key: "applik8s.dev/plan-digest", Value: plan.digest },
            ],
            Outputs: [{ OutputKey: applicationAwsOutputKey("foundation.registry", "repositoryUri"), OutputValue: repositoryUri }],
          }],
        });
        return "{}";
      },
      buildApplicationImage: async ({ repositoryUri: repository }) => {
        builds.push(repository);
        return imageUri;
      },
    });
    const state = await driver.reconcile({ plan });
    expect(builds).toEqual([repositoryUri]);
    expect(state.imageUri).toBe(imageUri);
    expect(calls.filter(([service, operation]) => service === "cloudformation" && operation === "deploy")).toHaveLength(2);
  });

  test("binds exact lakehouse buckets, catalogs, workgroups, cursor authority, and IAM into the application task", () => {
    const plan = lakehouseFixturePlan();
    const template = synthesizeApplicationAwsCloudFormationTemplate(plan, { imageUri: "demo@sha256:abc" });
    const serialized = JSON.stringify(template);
    expect(serialized).toContain("APPLIK8S_AWS_LAKEHOUSE_BINDINGS");
    expect(serialized).toContain("APPLIK8S_CURSOR_SECRET");
    expect(serialized).toContain("arn:aws:glue:us-east-1:123456789012:database/demo-history");
    expect(serialized).toContain("arn:aws:athena:us-east-1:123456789012:workgroup/demo-history-queries");
    expect(serialized).toContain("history/*");
    expect(serialized).toContain("results/*");
    expect(serialized).not.toContain('"Action":["s3:*"]');
    expect(serialized).not.toContain('"Action":["glue:*"]');
    expect(serialized).not.toContain('"Action":["athena:*"]');
  });
});

function existingStackTemplateResponse(): string {
  return JSON.stringify({
    TemplateBody: {
      AWSTemplateFormatVersion: "2010-09-09",
      Description: "Previously deployed application",
      Resources: {
        ExistingApplicationService: {
          Type: "AWS::ECS::Service",
          Properties: { ServiceName: "previous-application" },
        },
      },
      Outputs: {
        ExistingApplicationServiceArn: { Value: "arn:aws:ecs:us-east-1:123456789012:service/previous-application" },
      },
    },
  });
}

function fixturePlan(): ApplicationAwsDeploymentPlan {
  const resources = [
    planResource("foundation.network", "ec2", "vpc", "demo-vpc", undefined, { cidrBlock: "10.64.0.0/16", enableDnsSupport: true, enableDnsHostnames: true }, ["vpcId"]),
    planResource("foundation.subnet.public.1", "ec2", "subnet", "demo-public-1", undefined, { availabilityZone: "us-east-1a", cidrBlock: "10.64.0.0/24", mapPublicIpOnLaunch: true }, ["subnetId"]),
    planResource("foundation.subnet.public.2", "ec2", "subnet", "demo-public-2", undefined, { availabilityZone: "us-east-1b", cidrBlock: "10.64.1.0/24", mapPublicIpOnLaunch: true }, ["subnetId"]),
    planResource("foundation.subnet.private.1", "ec2", "subnet", "demo-private-1", undefined, { availabilityZone: "us-east-1a", cidrBlock: "10.64.16.0/24", mapPublicIpOnLaunch: false }, ["subnetId"]),
    planResource("foundation.subnet.private.2", "ec2", "subnet", "demo-private-2", undefined, { availabilityZone: "us-east-1b", cidrBlock: "10.64.17.0/24", mapPublicIpOnLaunch: false }, ["subnetId"]),
    planResource("foundation.security-group.application", "ec2", "security-group", "demo-application", undefined, { description: "private application traffic" }, ["securityGroupId"]),
    planResource("foundation.registry", "ecr", "repository", "demo-artifacts", undefined, { imageTagMutability: "IMMUTABLE", scanOnPush: true }, ["repositoryUri", "repositoryArn"]),
    planResource("foundation.compute", "ecs", "cluster", "demo-compute", undefined, { containerInsights: true }, ["clusterArn", "clusterName"]),
    planResource("foundation.logs", "cloudwatch", "log-group", "/applik8s/demo/test", undefined, { retentionDays: 30 }, ["logGroupArn"]),
    planResource("foundation.discovery", "service-discovery", "private-dns-namespace", "demo-internal", undefined, { namespaceName: "demo.internal", vpcResourceId: "foundation.network" }, ["namespaceId", "namespaceArn"]),
    planResource("application-host.web", "ecs", "fargate-service", "demo-web", "server.web", { desiredCount: 1, port: 3000, healthPath: "/-/healthz" }, ["serviceArn", "endpoint"]),
  ];
  const runtimeAccessContent = {
    apiVersion: 'applik8s.runtimeAccessPlan/v1alpha1' as const,
    application: 'demo',
    target: 'aws' as const,
    sourceGraphDigest: `sha256:${'c'.repeat(64)}` as const,
    executions: [],
    diagnostics: [],
  };
  return normalizeApplicationAwsDeploymentPlan({
    apiVersion: "applik8s.awsPlan/v1alpha1",
    application: "demo",
    environment: "test",
    region: "us-east-1",
    accountId: "123456789012",
    lifecycleAuthority: "alchemy",
    runtimeAccess: { ...runtimeAccessContent, digest: applicationRuntimeAccessPlanDigest(runtimeAccessContent) },
    resources,
    runtimeArtifacts: [],
    runtimeBindings: [],
    edges: [
      { from: "foundation.network", to: "foundation.subnet.public.1", relationship: "requiresReady" },
      { from: "foundation.network", to: "foundation.subnet.public.2", relationship: "requiresReady" },
      { from: "foundation.network", to: "foundation.subnet.private.1", relationship: "requiresReady" },
      { from: "foundation.network", to: "foundation.subnet.private.2", relationship: "requiresReady" },
      { from: "foundation.network", to: "foundation.discovery", relationship: "requiresReady" },
      { from: "foundation.compute", to: "application-host.web", relationship: "requiresReady" },
    ],
    diagnostics: [],
    digest: `sha256:${"0".repeat(64)}`,
  });
}

function runtimeArtifactFixturePlan(): ApplicationAwsDeploymentPlan {
  const plan = fixturePlan();
  const database = planResource('provider.documents', 'rds', 'postgresql-instance', 'demo-documents', 'provider.documents', {}, ['endpoint', 'port', 'secretArn']);
  const stream = planResource('provider.events', 'kinesis', 'stream', 'demo-events', 'provider.events', { mode: 'ON_DEMAND', encrypted: true }, ['streamArn', 'streamName']);
  const checkpoints = planResource('framework.kinesis-checkpoints', 'dynamodb', 'kinesis-checkpoint-table', 'demo-kinesis-checkpoints', undefined, {
    partitionKey: 'consumerKey', sortKey: 'shardId', billingMode: 'PAY_PER_REQUEST', serverSideEncryption: true, pointInTimeRecovery: false,
  }, ['tableName', 'tableArn']);
  const role = planResource('runtime-role.processor-events', 'iam', 'role', 'demo-processor-events', 'processor.events', {
    assumeService: 'ecs-tasks.amazonaws.com', statements: [
      { effect: 'Allow', actions: ['kinesis:GetRecords'], resources: ['arn:aws:kinesis:us-east-1:123456789012:stream/demo-events'] },
      { effect: 'Allow', actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'], resources: ['arn:aws:dynamodb:us-east-1:123456789012:table/demo-kinesis-checkpoints'] },
    ],
  }, ['roleArn']);
  const worker = planResource('runtime-artifact.processor-events', 'ecs', 'fargate-worker', 'demo-events', 'processor.events', {
    artifactId: 'processor:processor.events', artifactDigest: `sha256:${'b'.repeat(64)}`, artifactSourceDigest: `sha256:${'c'.repeat(64)}`,
    command: ['node', '/app/processor.mjs'], desiredCount: 1, runtimeRoleResourceId: role.id,
    eventTransport: 'kinesis', eventStreamResourceId: stream.id, checkpointTableResourceId: checkpoints.id, consumer: 'processor:processor.events',
    processorConcurrency: 1, databaseEnvironmentName: 'APPLIK8S_DATABASE_DOCUMENTS_URL',
  }, ['serviceArn']);
  return normalizeApplicationAwsDeploymentPlan({
    ...plan,
    resources: [...plan.resources, database, stream, checkpoints, role, worker],
    runtimeArtifacts: [{
      name: 'events', nodeId: 'processor.events', role: 'processor', source: '.applik8s/processor.mjs', digest: `sha256:${'b'.repeat(64)}`,
      container: {
        image: 'applik8s/events:generated', imageName: 'events', tag: 'generated', baseImage: 'node:22.20.0-bookworm-slim',
        contextPath: '.applik8s/container', dockerfilePath: '.applik8s/container/Dockerfile', entrypoint: '/app/processor.mjs', command: ['node', '/app/processor.mjs'], sourceDigest: `sha256:${'c'.repeat(64)}`,
      },
    }],
    runtimeBindings: [{
      id: 'postgres-url.documents', kind: 'postgresUrl', environmentName: 'APPLIK8S_DATABASE_DOCUMENTS_URL',
      resourceId: database.id, database: 'documents', sensitivity: 'sensitive',
    }],
    edges: [
      ...plan.edges,
      { from: role.id, to: worker.id, relationship: 'assumesRole' },
      { from: stream.id, to: worker.id, relationship: 'requiresReady' },
      { from: checkpoints.id, to: worker.id, relationship: 'requiresReady' },
    ],
  });
}

function runtimeServiceArtifactFixturePlan(): ApplicationAwsDeploymentPlan {
  const plan = fixturePlan();
  const artifact = {
    name: "generated-http",
    nodeId: "server.generated",
    role: "http" as const,
    source: ".applik8s/generated-http.mjs",
    digest: `sha256:${"c".repeat(64)}` as const,
    container: {
      image: "applik8s/generated-http:generated",
      imageName: "generated-http",
      tag: "generated",
      baseImage: "node:22.20.0-bookworm-slim",
      contextPath: ".applik8s/generated-http/container",
      dockerfilePath: ".applik8s/generated-http/container/Dockerfile",
      entrypoint: "/app/http.mjs",
      command: ["node", "/app/http.mjs"],
      sourceDigest: `sha256:${"d".repeat(64)}` as const,
    },
  };
  const service = planResource("runtime-artifact.generated-http", "ecs", "fargate-runtime-service", "demo-generated-http", artifact.nodeId, {
    artifactId: "http:server.generated",
    artifactDigest: artifact.digest,
    artifactSourceDigest: artifact.container.sourceDigest,
    command: artifact.container.command,
    desiredCount: 1,
    port: 3001,
    healthPort: 3001,
    healthPath: "/readyz",
    discoveryNamespaceResourceId: "foundation.discovery",
    discoveryName: "demo-generated-http",
    endpoint: "http://demo-generated-http.demo.internal:3001",
    runtimeBindingEnvironmentNames: [],
    runtimePublicOutputResourceIds: [],
    eventStreamResourceIds: [],
    actorRuntimeResourceIds: [],
    lakehouseResourceIds: [],
    observabilityResourceIds: [],
    workflowEngineResourceIds: [],
    runtimeSecretResourceIds: [],
    scheduleAccess: false,
  }, ["serviceArn", "endpoint"]);
  return normalizeApplicationAwsDeploymentPlan({
    ...plan,
    resources: [...plan.resources, service],
    runtimeArtifacts: [artifact],
    edges: [...plan.edges, { from: "foundation.discovery", to: service.id, relationship: "requiresReady" }],
  });
}

function hatchetFixturePlan(): ApplicationAwsDeploymentPlan {
  const plan = fixturePlan();
  const semanticNodeId = "provider.WorkflowEngine";
  const base = `provider.${semanticNodeId}`;
  const credentials = planResource(`${base}.credentials`, "secrets-manager", "database-credentials", "demo-workflow-db", semanticNodeId, {
    username: "hatchet", passwordLength: 48, urlSafe: true,
  }, ["secretArn"]);
  const database = planResource(`${base}.database`, "rds", "postgresql-instance", "demo-workflow-db", semanticNodeId, {
    engineVersion: "17", storageGiB: 20, multiAz: false, encrypted: true, deletionProtection: false,
    databaseName: "hatchet", masterUsername: "hatchet", credentialsResourceId: credentials.id,
    purpose: "workflow-engine", workflowEngineResourceId: base,
  }, ["endpoint", "port"]);
  const filesystem = {
    ...planResource(`${base}.config`, "efs", "shared-filesystem", "demo-workflow-config", semanticNodeId, {
      encrypted: true, accessPointPath: "/hatchet-config", workflowEngineResourceId: base,
    }, ["fileSystemId", "accessPointArn"]),
    lifecycle: { ownership: "application" as const, deletion: "retain" as const, adoption: "createOrAdoptExact" as const },
  };
  const token = planResource(`${base}.worker-token`, "secrets-manager", "workflow-token", "demo-workflow-token", semanticNodeId, {
    authority: "hatchet-worker-token", issuance: "deployment-bootstrap",
  }, ["secretArn"]);
  const engine = planResource(base, "ecs", "hatchet-service", "demo-workflows", semanticNodeId, {
    image: "ghcr.io/hatchet-dev/hatchet/hatchet-lite@sha256:5405c7f3991e85b7490b4e9fd7187bf5699f7cdd5b6e0c9a751751164b801aa9",
    tenantId: "707d0855-80ab-4e1f-a156-f1c4546cbf52",
    databaseResourceId: database.id,
    credentialsResourceId: credentials.id,
    configFilesystemResourceId: filesystem.id,
    workerTokenResourceId: token.id,
    discoveryNamespaceResourceId: "foundation.discovery",
    discoveryName: "demo-workflows",
    apiPort: 8888,
    grpcPort: 7077,
    desiredCount: 1,
    privateSubnets: ["foundation.subnet.private.1", "foundation.subnet.private.2"],
  }, ["endpoint", "grpcEndpoint", "workerTokenTaskDefinitionArn", "workerTokenSecurityGroupId"]);
  const host = plan.resources.find(({ id }) => id === "application-host.web")!;
  return normalizeApplicationAwsDeploymentPlan({
    ...plan,
    resources: [
      ...plan.resources.filter(({ id }) => id !== host.id),
      { ...host, configuration: { ...host.configuration, workflowEngineResourceIds: [engine.id], runtimePublicOutputResourceIds: [engine.id] } },
      credentials, database, filesystem, token, engine,
    ],
    edges: [
      ...plan.edges,
      { from: credentials.id, to: database.id, relationship: "requiresReady" },
      { from: database.id, to: engine.id, relationship: "requiresReady" },
      { from: filesystem.id, to: engine.id, relationship: "requiresReady" },
      { from: token.id, to: engine.id, relationship: "requiresReady" },
      { from: "foundation.compute", to: engine.id, relationship: "requiresReady" },
      { from: "foundation.discovery", to: engine.id, relationship: "requiresReady" },
      { from: engine.id, to: host.id, relationship: "requiresReady" },
    ],
  });
}

function actorFixturePlan(): ApplicationAwsDeploymentPlan {
  const plan = fixturePlan();
  const exposure = planResource("provider.HttpExposure", "elastic-load-balancing", "application-load-balancer", "demo-actors-alb", "provider.HttpExposure", {
    publicSubnets: ["foundation.subnet.public.1", "foundation.subnet.public.2"],
    tlsRequired: false,
  }, ["dnsName", "zoneId", "loadBalancerArn"]);
  const state = planResource("provider.actor.state", "s3", "bucket", "demo-actor-state", "provider.actor", { versioning: true }, ["bucketName", "bucketArn"]);
  const authorization = planResource("provider.actor.authorization", "secrets-manager", "secret-authority", "demo-actor-auth", "provider.actor", {}, ["secretArn"]);
  const connectionSigning = planResource("provider.actor.connection-signing", "secrets-manager", "secret-authority", "demo-actor-ticket", "provider.actor", {}, ["secretArn"]);
  const fleet = planResource("provider.actor", "ecs", "celld-fleet", "demo-actors", "provider.actor", {
    stateBucketResourceId: state.id,
    authorizationResourceId: authorization.id,
    connectionSigningResourceId: connectionSigning.id,
    internalDnsName: "actors.demo.internal",
    applicationEndpoint: "http://demo-web.actors.demo.internal:3000",
    workerProtocol: "applik8s.actor-worker/v1alpha1",
    publicConnectionGateway: true,
    image: `ghcr.io/denoland/celld@sha256:${"c".repeat(64)}`,
    port: 8080,
  }, ["endpoint"]);
  return normalizeApplicationAwsDeploymentPlan({
    ...plan,
    resources: [
      ...plan.resources.filter(({ id }) => id !== "application-host.web"),
      { ...plan.resources.find(({ id }) => id === "application-host.web")!, configuration: { ...plan.resources.find(({ id }) => id === "application-host.web")!.configuration, actorRuntimeResourceIds: [fleet.id], runtimePublicOutputResourceIds: [fleet.id] } },
      state,
      authorization,
      connectionSigning,
      fleet,
      exposure,
    ],
    edges: [
      ...plan.edges,
      { from: state.id, to: fleet.id, relationship: "requiresReady" },
      { from: authorization.id, to: fleet.id, relationship: "requiresReady" },
      { from: connectionSigning.id, to: fleet.id, relationship: "requiresReady" },
      { from: fleet.id, to: "application-host.web", relationship: "requiresReady" },
    ],
  });
}

function lakehouseFixturePlan(): ApplicationAwsDeploymentPlan {
  const plan = fixturePlan();
  const dataset = planResource("provider.history", "s3", "lakehouse-dataset", "demo-history", "provider.history", { qualification: "history", prefix: "history", region: "us-east-1", catalogResourceId: "provider.history.catalog" }, ["bucketName", "bucketArn"]);
  const catalog = planResource("provider.history.catalog", "glue", "catalog-database", "demo-history", "provider.history", { qualification: "history" }, ["databaseName", "databaseArn"]);
  const results = planResource("provider.history-queries.results", "s3", "bucket", "demo-history-results", "provider.history-queries", { purpose: "athena-query-results", forceDestroy: false }, ["bucketName", "bucketArn"]);
  const query = planResource("provider.history-queries.query", "athena", "workgroup", "demo-history-queries", "provider.history-queries", { qualification: "history-queries", resultBucketResourceId: results.id, bytesScannedCutoffPerQuery: 10_000_000 }, ["workgroupName", "workgroupArn"]);
  const cursor = { ...planResource("lakehouse.cursor-signing", "secrets-manager", "secret-authority", "demo-lakehouse-cursor", undefined, { passwordLength: 48 }, ["secretArn"]), outputs: [{ name: "secretArn", sensitivity: "sensitive" as const, persistence: "reference" as const }] };
  const role = planResource("runtime-role.server-web", "iam", "role", "demo-server-web", "server.web", {
    assumeService: "ecs-tasks.amazonaws.com",
    statements: [
      { effect: "Allow", actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"], resources: ["arn:aws:s3:::demo-history", "arn:aws:s3:::demo-history/history/*", "arn:aws:s3:::demo-history-results", "arn:aws:s3:::demo-history-results/results/*"] },
      { effect: "Allow", actions: ["glue:GetDatabase", "glue:GetTable", "glue:CreateTable"], resources: ["arn:aws:glue:us-east-1:123456789012:database/demo-history"] },
      { effect: "Allow", actions: ["athena:StartQueryExecution", "athena:GetQueryExecution", "athena:GetQueryResults", "athena:StopQueryExecution"], resources: ["arn:aws:athena:us-east-1:123456789012:workgroup/demo-history-queries"] },
    ],
  }, ["roleArn"]);
  const host = plan.resources.find(({ id }) => id === "application-host.web")!;
  return normalizeApplicationAwsDeploymentPlan({
    ...plan,
    resources: [...plan.resources.filter(({ id }) => id !== host.id), { ...host, configuration: { ...host.configuration, runtimeRoleResourceId: role.id, lakehouseResourceIds: [dataset.id, catalog.id, results.id, query.id], runtimePublicOutputResourceIds: [dataset.id, catalog.id, results.id, query.id] } }, dataset, catalog, results, query, cursor, role],
    edges: [...plan.edges, { from: results.id, to: query.id, relationship: "requiresReady" }],
  });
}

function planResource(
  id: string,
  service: ApplicationAwsPlanResource["service"],
  resourceType: string,
  physicalName: string,
  semanticNodeId?: string,
  configuration: ApplicationAwsPlanResource["configuration"] = {},
  outputNames: readonly string[] = [],
): ApplicationAwsPlanResource {
  return {
    id,
    service,
    resourceType,
    ...(semanticNodeId ? { semanticNodeId } : {}),
    physicalName,
    lifecycle: { ownership: "application", deletion: "delete", adoption: "createOrAdoptExact" },
    network: "private",
    configuration,
    outputs: outputNames.map((name) => ({ name, sensitivity: "public", persistence: "state" })),
    provenance: {},
  };
}

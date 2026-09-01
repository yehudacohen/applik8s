// typecast-file-boundary: native AWS deployment tests inspect deliberately partial provider declarations after lifecycle normalization.
import {
  normalizeApplicationAwsDeploymentPlan,
  type ApplicationAwsDeploymentPlan,
  type ApplicationAwsPlanResource,
} from "@applik8s/deployment-contract";
import { describe, expect, test } from "vitest";
import { applicationAwsNativeResourceDeclarations } from "../src/index.js";
import {
  applicationAwsNativeRemovalPolicyForTest,
  applicationAwsNativeWorkloadEnvironmentForTest,
} from "../src/aws-native-resources.js";

describe("AWS native Alchemy resource graph", () => {
  test("maps each portable resource to a concrete Alchemy resource identity", () => {
    const declarations = applicationAwsNativeResourceDeclarations(fixturePlan());
    expect(declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "foundation.network", type: "AWS.EC2.VPC" }),
      expect.objectContaining({ id: "foundation.subnet.private.1", type: "AWS.EC2.Subnet", dependsOn: ["foundation.network"] }),
      expect.objectContaining({ id: "foundation.registry", type: "AWS.ECR.Repository" }),
      expect.objectContaining({ id: "provider.database.subnet-group", type: "AWS.RDS.DBSubnetGroup", logicalRole: "supporting" }),
      expect.objectContaining({ id: "provider.database", type: "AWS.RDS.DBInstance", dependsOn: expect.arrayContaining(["provider.database.subnet-group"]) }),
      expect.objectContaining({ id: "provider.objects", type: "AWS.S3.Bucket" }),
      expect.objectContaining({ id: "provider.queue", type: "AWS.SQS.Queue" }),
      expect.objectContaining({ id: "provider.events", type: "AWS.Kinesis.Stream" }),
    ]));
    expect(declarations.some(({ type }) => type.includes("CloudFormation"))).toBe(false);
    expect(new Set(declarations.map(({ id }) => id))).toHaveLength(declarations.length);
  });

  test("maps data-plane support services to upstream native Alchemy resources", () => {
    const plan = fixturePlan([
      resource("provider.catalog", "glue", "catalog-database", "demo-catalog", {}, ["databaseName"]),
      resource("provider.query", "athena", "workgroup", "demo-query", { resultBucketResourceId: "provider.objects" }, ["workgroupName"]),
      resource("foundation.discovery", "service-discovery", "private-dns-namespace", "demo-internal", { namespaceName: "demo.internal" }, ["namespaceId"]),
    ]);
    expect(applicationAwsNativeResourceDeclarations(plan)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "provider.catalog", type: "AWS.Glue.Database" }),
      expect.objectContaining({ id: "provider.query", type: "AWS.Athena.WorkGroup" }),
      expect.objectContaining({ id: "foundation.discovery", type: "AWS.CloudMap.PrivateDnsNamespace" }),
    ]));
  });

  test("maps Aurora PostgreSQL directly to Alchemy's native Aurora composition", () => {
    const plan = fixturePlan([
      resource(
        "provider.aurora",
        "rds",
        "aurora-postgresql-cluster",
        "demo-aurora",
        { databaseName: "application", readers: 1, minimumCapacity: 0.5, maximumCapacity: 4 },
        ["endpoint", "readerEndpoint", "port", "secretArn"],
      ),
    ]);
    expect(applicationAwsNativeResourceDeclarations(plan)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "provider.aurora", type: "AWS.RDS.Aurora", logicalRole: "primary" }),
    ]));
  });

  test("projects portable deletion policy onto every native Alchemy declaration", () => {
    const deleted = resource("delete-me", "s3", "bucket", "delete-me", {}, ["bucketName"]);
    const retained = {
      ...resource("retain-me", "rds", "aurora-postgresql-cluster", "retain-me", {}, ["endpoint"]),
      lifecycle: { ownership: "application", deletion: "retain", adoption: "createOrAdoptExact" } as const,
    };
    expect(applicationAwsNativeRemovalPolicyForTest(deleted)).toBe("destroy");
    expect(applicationAwsNativeRemovalPolicyForTest(retained)).toBe("retain");
  });

  test("expands stateful services into independently owned native identities", () => {
    const plan = fixturePlan([
      resource("provider.workflow-files", "efs", "shared-filesystem", "demo-workflows", { accessPointPath: "/hatchet" }, ["fileSystemId", "accessPointArn"]),
      resource("provider.index", "elasticache", "valkey-replication-group", "demo-valkey", { replicas: 2 }, ["endpoint", "port"]),
    ]);
    const declarations = applicationAwsNativeResourceDeclarations(plan);
    expect(declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "provider.workflow-files.filesystem", type: "AWS.EFS.FileSystem", logicalRole: "supporting" }),
      expect.objectContaining({ id: "provider.workflow-files.mount-target.1", type: "AWS.EFS.MountTarget", dependsOn: expect.arrayContaining(["foundation.subnet.private.1"]) }),
      expect.objectContaining({ id: "provider.workflow-files.mount-target.2", type: "AWS.EFS.MountTarget", dependsOn: expect.arrayContaining(["foundation.subnet.private.2"]) }),
      expect.objectContaining({ id: "provider.workflow-files", type: "AWS.EFS.AccessPoint", logicalRole: "primary" }),
      expect.objectContaining({ id: "provider.index.subnet-group", type: "Applik8s.AWS.ElastiCache.SubnetGroup", logicalRole: "supporting" }),
      expect.objectContaining({ id: "provider.index", type: "Applik8s.AWS.ElastiCache.ValkeyReplicationGroup", dependsOn: expect.arrayContaining(["provider.index.subnet-group"]) }),
    ]));
    expect(declarations.some(({ type }) => type.includes("CloudFormation"))).toBe(false);
  });

  test("models long-running services and bootstrap work as separate native ECS resources", () => {
    const plan = fixturePlan([
      resource("foundation.compute", "ecs", "cluster", "native-demo-compute", {}, ["clusterArn"]),
      resource("foundation.logs", "cloudwatch", "log-group", "/applik8s/native-demo/test", {}, ["logGroupArn"]),
      resource("foundation.discovery", "service-discovery", "private-dns-namespace", "native-demo-internal", { namespaceName: "native-demo.internal" }, ["namespaceId"]),
      resource("provider.actor", "ecs", "celld-fleet", "native-demo-actors", {
        image: `registry.example/celld@sha256:${"1".repeat(64)}`,
        discoveryNamespaceResourceId: "foundation.discovery",
        discoveryName: "actors",
        stateBucketResourceId: "provider.objects",
        authorizationResourceId: "provider.actor.authorization",
        connectionSigningResourceId: "provider.actor.signing",
        applicationEndpoint: "http://application.native-demo.internal:3000",
        workerProtocol: "applik8s.actorAuthority/v1alpha1",
        autoscalingMinCapacity: 1,
        autoscalingMaxCapacity: 4,
        autoscalingTargetCpuUtilization: 60,
      }, ["endpoint"]),
    ]);
    const declarations = applicationAwsNativeResourceDeclarations(plan);
    expect(declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "provider.actor.task-definition", type: "AWS.ECS.TaskDefinition" }),
      expect.objectContaining({ id: "provider.actor.discovery", type: "AWS.CloudMap.Service" }),
      expect.objectContaining({ id: "provider.actor.worker-deployment.task-definition", type: "AWS.ECS.TaskDefinition" }),
      expect.objectContaining({ id: "provider.actor.worker-deployment", type: "Applik8s.AWS.ECS.OneShotTask" }),
      expect.objectContaining({ id: "provider.actor.autoscaling.target", type: "AWS.ApplicationAutoScaling.ScalableTarget", dependsOn: ["provider.actor"] }),
      expect.objectContaining({ id: "provider.actor.autoscaling.policy", type: "AWS.ApplicationAutoScaling.ScalingPolicy", dependsOn: ["provider.actor.autoscaling.target"] }),
      expect.objectContaining({ id: "provider.actor", type: "AWS.ECS.Service" }),
    ]));
    expect(new Set(declarations.filter(({ type }) => type.startsWith("Applik8s.AWS.")).map(({ type }) => type))).toEqual(
      new Set(["Applik8s.AWS.ECS.OneShotTask"]),
    );
    expect(declarations.some(({ type }) => type.includes("CloudFormation"))).toBe(false);
  });

  test("projects finite Job controller identity and bounded worker networking without image commands", () => {
    const plan = fixturePlan();
    const controller = resource("runtime.jobs", "ecs", "fargate-runtime-service", "native-demo-jobs", {
      finiteJobController: true,
      jobPrivateSubnetResourceIds: ["foundation.subnet.private.1", "foundation.subnet.private.2"],
      jobSecurityGroupResourceIds: ["runtime.jobs.security-group"],
    }, ["serviceArn", "endpoint"]);
    const environment = applicationAwsNativeWorkloadEnvironmentForTest(controller, plan, {
      "foundation.subnet.private.1": { subnetId: "subnet-a" },
      "foundation.subnet.private.2": { subnetId: "subnet-b" },
      "runtime.jobs.security-group": { groupId: "sg-jobs" },
    });
    expect(environment).toMatchObject({
      APPLIK8S_APPLICATION_NAME: "native-demo",
      APPLIK8S_DEPLOYMENT_ID: "test",
      APPLIK8S_AWS_JOB_CONTAINER: "runtime",
      APPLIK8S_AWS_JOB_SUBNETS: JSON.stringify(["subnet-a", "subnet-b"]),
      APPLIK8S_AWS_JOB_SECURITY_GROUPS: JSON.stringify(["sg-jobs"]),
    });
  });

  test("hydrates exact lakehouse bindings from native S3, Glue, and Athena outputs", () => {
    const dataset = resource("provider.history", "s3", "lakehouse-dataset", "native-history", {
      qualification: "history",
      prefix: "history/events",
      region: "us-east-1",
      catalogResourceId: "provider.history.catalog",
      forceDeleteUnretainedData: true,
    }, ["bucketName", "bucketArn"]);
    const catalog = resource("provider.history.catalog", "glue", "catalog-database", "native-history-catalog", {
      qualification: "history",
    }, ["databaseName", "databaseArn"]);
    const query = resource("provider.history.query", "athena", "workgroup", "native-history-query", {
      qualification: "history-queries",
      region: "us-east-1",
    }, ["workgroupName", "workgroupArn"]);
    const plan = fixturePlan([dataset, catalog, query]);
    const workload = resource("runtime.history", "ecs", "fargate-worker", "native-history-worker", {
      lakehouseResourceIds: [dataset.id, catalog.id, query.id],
    }, ["serviceArn"]);
    const environment = applicationAwsNativeWorkloadEnvironmentForTest(workload, plan, {
      [dataset.id]: { bucketName: "resolved-history-bucket" },
      [catalog.id]: { databaseName: "resolved_history_catalog" },
      [query.id]: { workgroupName: "resolved-history-query" },
    });
    expect(JSON.parse(String(environment.APPLIK8S_AWS_LAKEHOUSE_BINDINGS))).toEqual({
      datasets: {
        history: {
          bucket: "resolved-history-bucket",
          prefix: "history/events",
          region: "us-east-1",
          catalogDatabase: "resolved_history_catalog",
          forceDeleteUnretainedData: true,
        },
      },
      queries: {
        "history-queries": { workgroup: "resolved-history-query", region: "us-east-1" },
      },
    });
  });

  test("rejects dependency cycles before creating an Alchemy stack", () => {
    const plan = normalizeApplicationAwsDeploymentPlan({
      ...fixturePlan(),
      edges: [
        { from: "provider.queue", to: "provider.events", relationship: "requiresReady" },
        { from: "provider.events", to: "provider.queue", relationship: "requiresReady" },
      ],
    });
    expect(() => applicationAwsNativeResourceDeclarations(plan)).toThrow(/dependency cycle/u);
  });

  test("fails closed when a portable plan kind has no native Alchemy resource", () => {
    const plan = fixturePlan([
      resource("provider.unsupported", "s3", "future-aggregate", "unsupported", {}, []),
    ]);
    expect(() => applicationAwsNativeResourceDeclarations(plan)).toThrow(
      /native Alchemy lowering is not implemented.*refuses to invent an aggregate fallback resource/u,
    );
  });
});

function fixturePlan(additional: readonly ApplicationAwsPlanResource[] = []): ApplicationAwsDeploymentPlan {
  return normalizeApplicationAwsDeploymentPlan({
    apiVersion: "applik8s.awsPlan/v1alpha1",
    application: "native-demo",
    environment: "test",
    region: "us-east-1",
    accountId: "123456789012",
    lifecycleAuthority: "alchemy",
    runtimeAccess: {
      apiVersion: "applik8s.runtimeAccessPlan/v1alpha1",
      application: "native-demo",
      target: "aws",
      sourceGraphDigest: `sha256:${"0".repeat(64)}`,
      executions: [],
      workloads: [],
      diagnostics: [],
      digest: `sha256:${"0".repeat(64)}`,
    },
    resources: [
      resource("foundation.network", "ec2", "vpc", "native-demo-vpc", { cidrBlock: "10.64.0.0/16" }, ["vpcId"]),
      resource("foundation.subnet.private.1", "ec2", "subnet", "native-demo-private-1", { cidrBlock: "10.64.16.0/24", availabilityZone: "us-east-1a" }, ["subnetId"]),
      resource("foundation.subnet.private.2", "ec2", "subnet", "native-demo-private-2", { cidrBlock: "10.64.17.0/24", availabilityZone: "us-east-1b" }, ["subnetId"]),
      resource("foundation.registry", "ecr", "repository", "native-demo-images", { imageTagMutability: "IMMUTABLE" }, ["repositoryUri"]),
      resource("provider.database", "rds", "postgresql-instance", "native-demo-db", { engineVersion: "17", storageGiB: 20 }, ["endpoint", "port", "secretArn"]),
      resource("provider.objects", "s3", "bucket", "native-demo-objects", { versioning: true }, ["bucketName", "bucketArn"]),
      resource("provider.queue", "sqs", "queue", "native-demo-queue", { visibilityTimeoutSeconds: 300 }, ["queueArn", "queueUrl"]),
      resource("provider.events", "kinesis", "stream", "native-demo-events", { mode: "ON_DEMAND" }, ["streamArn", "streamName"]),
      ...additional,
    ],
    runtimeArtifacts: [],
    runtimeBindings: [],
    edges: [
      { from: "foundation.network", to: "foundation.subnet.private.1", relationship: "requiresReady" },
      { from: "foundation.network", to: "foundation.subnet.private.2", relationship: "requiresReady" },
      { from: "foundation.subnet.private.1", to: "provider.database", relationship: "networkAccess" },
      { from: "foundation.subnet.private.2", to: "provider.database", relationship: "networkAccess" },
    ],
    diagnostics: [],
    digest: `sha256:${"0".repeat(64)}`,
  });
}

function resource(
  id: string,
  service: ApplicationAwsPlanResource["service"],
  resourceType: string,
  physicalName: string,
  configuration: ApplicationAwsPlanResource["configuration"],
  outputs: readonly string[],
): ApplicationAwsPlanResource {
  return {
    id,
    service,
    resourceType,
    physicalName,
    lifecycle: { ownership: "application", deletion: "delete", adoption: "createOrAdoptExact" },
    network: "none",
    configuration,
    outputs: outputs.map((name) => ({ name, sensitivity: "public", persistence: "state" })),
    provenance: {},
  };
}

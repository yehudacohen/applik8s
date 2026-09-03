// typecast-file-boundary: the portable AWS plan is validated before this
// target adapter maps its discriminated resource kinds into Alchemy's typed
// AWS constructors. The isolated casts keep that versioned adapter explicit.
import type {
  ApplicationAwsDeploymentPlan,
  ApplicationAwsPlanResource,
  DeploymentJsonObject,
} from "@applik8s/deployment-contract";
import type * as ecs from "@distilled.cloud/aws/ecs";
import * as secretsmanager from "@distilled.cloud/aws/secrets-manager";
import * as AWS from "alchemy/AWS";
import { fromEnvironment as awsCredentialsFromEnvironment } from "alchemy/AWS/Credentials";
import { fromEnvironment as awsEndpointFromEnvironment } from "alchemy/AWS/Endpoint";
import { fromEnvironment as awsRegionFromEnvironment } from "alchemy/AWS/Region";
import { DockerLive } from "alchemy/Docker";
import * as Output from "alchemy/Output";
import * as Provider from "alchemy/Provider";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import {
  ApplicationAwsOneShotTask,
  applicationAwsNativeComputeProviderLayer,
  applicationAwsNativeComputeResources,
} from "./aws-native-compute-resources.js";
import {
  ApplicationAwsElastiCacheSubnetGroup,
  ApplicationAwsValkeyReplicationGroup,
  applicationAwsNativeStatefulProviderLayer,
  applicationAwsNativeStatefulResources,
} from "./aws-native-stateful-resources.js";

export interface ApplicationAwsNativeResourceDeclaration {
  readonly id: string;
  readonly planResourceId: string;
  readonly type: string;
  readonly logicalRole: "primary" | "supporting";
  readonly dependsOn: readonly string[];
}

export interface ApplicationAwsNativeMaterializationOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly resourceTags?: Readonly<Record<string, string>>;
  readonly imageUri?: unknown;
  readonly artifactImageUris?: Readonly<Record<string, unknown>>;
  readonly celldWorkerImageUri?: unknown;
  readonly phase?: "all" | "foundation" | "workloads";
  readonly seedResources?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly seedOutputs?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface ApplicationAwsNativeProviderOptions {
  readonly accountId: string;
  readonly region: string;
  readonly endpoint?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export interface ApplicationAwsNativeMaterialization {
  readonly resources: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /**
   * Alchemy outputs remain dependency-carrying values while the stack is
   * compiled. They are resolved before the stack result is returned.
   */
  readonly outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

function withApplicationAwsNativeRemovalPolicy<R, E, A>(
  effect: Effect.Effect<R, E, A>,
  resource: Pick<ApplicationAwsPlanResource, "lifecycle">,
): Effect.Effect<R, E, A> {
  // typecast: Alchemy's RemovalPolicy decorator is typed for infallible
  // declaration effects even though native resource compositions retain
  // their provider error channel at this adapter boundary.
  const decorate = (
    resource.lifecycle.deletion === "retain"
      ? RemovalPolicy.retain()
      : RemovalPolicy.destroy()
  ) as unknown as (
    value: Effect.Effect<R, E, A>,
  ) => Effect.Effect<R, E, A>;
  return decorate(effect);
}

/** @internal Contract probe proving portable lifecycle reaches Alchemy. */
export function applicationAwsNativeRemovalPolicyForTest(
  resource: Pick<ApplicationAwsPlanResource, "lifecycle">,
): "destroy" | "retain" {
  return Effect.runSync(withApplicationAwsNativeRemovalPolicy(
    Effect.gen(function* () {
      return yield* RemovalPolicy.RemovalPolicy;
    }),
    resource,
  ) as Effect.Effect<"destroy" | "retain", never, never>);
}

const nativeTypeByPlanKind: Readonly<Record<string, string>> = {
  "acm/certificate": "AWS.ACM.Certificate",
  "cloudwatch/log-group": "AWS.Logs.LogGroup",
  "dynamodb/table": "AWS.DynamoDB.Table",
  "ec2/security-group": "AWS.EC2.SecurityGroup",
  "ec2/subnet": "AWS.EC2.Subnet",
  "ec2/vpc": "AWS.EC2.VPC",
  "ec2/vpc-endpoint": "AWS.EC2.VpcEndpoint",
  "ec2/internet-gateway": "AWS.EC2.InternetGateway",
  "ec2/elastic-ip": "AWS.EC2.EIP",
  "ec2/nat-gateway": "AWS.EC2.NatGateway",
  "ec2/route-table": "AWS.EC2.RouteTable",
  "ec2/route": "AWS.EC2.Route",
  "ec2/route-table-association": "AWS.EC2.RouteTableAssociation",
  "ecr/repository": "AWS.ECR.Repository",
  "ecs/cluster": "AWS.ECS.Cluster",
  "ecs/celld-fleet": "AWS.ECS.Service",
  "ecs/hatchet-service": "AWS.ECS.Service",
  "ecs/fargate-service": "AWS.ECS.Service",
  "ecs/fargate-runtime-service": "AWS.ECS.Service",
  "ecs/fargate-worker": "AWS.ECS.Service",
  "efs/shared-filesystem": "AWS.EFS.FileSystem",
  "elasticache/valkey-replication-group": "Applik8s.AWS.ElastiCache.ValkeyReplicationGroup",
  "elastic-load-balancing/application-load-balancer": "AWS.ELBv2.LoadBalancer",
  "eventbridge-scheduler/schedule": "AWS.Scheduler.Schedule",
  "eventbridge-scheduler/schedule-group": "AWS.Scheduler.ScheduleGroup",
  "iam/role": "AWS.IAM.Role",
  "kinesis/stream": "AWS.Kinesis.Stream",
  "rds/postgresql-instance": "AWS.RDS.DBInstance",
  "rds/aurora-postgresql-cluster": "AWS.RDS.Aurora",
  "route53/record-publication": "AWS.Route53.Record",
  "s3/bucket": "AWS.S3.Bucket",
  "s3/lakehouse-dataset": "AWS.S3.Bucket",
  "secrets-manager/database-credentials": "AWS.SecretsManager.Secret",
  "secrets-manager/secret-authority": "AWS.SecretsManager.Secret",
  "secrets-manager/workflow-token": "AWS.SecretsManager.Secret",
  "sqs/queue": "AWS.SQS.Queue",
  "service-discovery/private-dns-namespace": "AWS.CloudMap.PrivateDnsNamespace",
  "glue/catalog-database": "AWS.Glue.Database",
  "athena/workgroup": "AWS.Athena.WorkGroup",
};

/**
 * A deliberately small AWS provider collection for the resources emitted by
 * the Applik8s plan. Unlike Alchemy's login-oriented default collection, this
 * layer can be pinned to an explicit endpoint for MiniStack/LocalStack while
 * retaining the exact same native resource providers used in production.
 */
export function applicationAwsNativeProviders(options: ApplicationAwsNativeProviderOptions) {
  const localCredentials = Effect.succeed({
    accessKeyId: Redacted.make(options.environment?.AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? "test"),
    secretAccessKey: Redacted.make(options.environment?.AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? "test"),
    sessionToken: optionalRedacted(options.environment?.AWS_SESSION_TOKEN ?? process.env.AWS_SESSION_TOKEN),
    region: options.region,
  });
  // The deployment boundary already has an explicit account, region, and
  // confined credential environment. Materialize that authority directly
  // instead of falling through Alchemy's interactive AuthProvider lookup.
  const environment = Layer.succeed(AWS.AWSEnvironment, Effect.succeed({
    accountId: options.accountId,
    region: options.region,
    credentials: localCredentials,
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
  }));
  const credentials = awsCredentialsFromEnvironment;
  const region = awsRegionFromEnvironment;
  const endpoint = awsEndpointFromEnvironment;
  return Layer.effect(
    AWS.Providers,
    Provider.collection([
      AWS.ACM.Certificate,
      AWS.Logs.LogGroup,
      AWS.DynamoDB.Table,
      AWS.EC2.SecurityGroup,
      AWS.EC2.SecurityGroupRule,
      AWS.EC2.Subnet,
      AWS.EC2.Vpc,
      AWS.EC2.VpcEndpoint,
      AWS.EC2.InternetGateway,
      AWS.EC2.EIP,
      AWS.EC2.NatGateway,
      AWS.EC2.RouteTable,
      AWS.EC2.Route,
      AWS.EC2.RouteTableAssociation,
      AWS.ECR.Repository,
      AWS.ECS.Cluster,
      AWS.ECS.Service,
      AWS.ELBv2.LoadBalancer,
      AWS.ELBv2.TargetGroup,
      AWS.ELBv2.Listener,
      AWS.Scheduler.Schedule,
      AWS.Scheduler.ScheduleGroup,
      AWS.IAM.Role,
      AWS.Kinesis.Stream,
      AWS.RDS.DBInstance,
      AWS.RDS.DBCluster,
      AWS.RDS.DBSubnetGroup,
      AWS.Route53.Record,
      AWS.S3.Bucket,
      AWS.SecretsManager.Secret,
      AWS.SQS.Queue,
      AWS.EFS.FileSystem,
      AWS.EFS.MountTarget,
      AWS.EFS.AccessPoint,
      AWS.CloudMap.PrivateDnsNamespace,
      AWS.CloudMap.Service,
      AWS.Glue.Database,
      AWS.Athena.WorkGroup,
      AWS.ECS.TaskDefinition,
      AWS.ApplicationAutoScaling.ScalableTarget,
      AWS.ApplicationAutoScaling.ScalingPolicy,
      ...applicationAwsNativeComputeResources,
      ...applicationAwsNativeStatefulResources,
    ]),
  ).pipe(
    Layer.provide(Layer.mergeAll(
      AWS.ACM.CertificateProvider(),
      AWS.Logs.LogGroupProvider(),
      AWS.DynamoDB.TableProvider(),
      AWS.EC2.SecurityGroupProvider(),
      AWS.EC2.SecurityGroupRuleProvider(),
      AWS.EC2.SubnetProvider(),
      AWS.EC2.VpcProvider(),
      AWS.EC2.VpcEndpointProvider(),
      AWS.EC2.InternetGatewayProvider(),
      AWS.EC2.EIPProvider(),
      AWS.EC2.NatGatewayProvider(),
      AWS.EC2.RouteTableProvider(),
      AWS.EC2.RouteProvider(),
      AWS.EC2.RouteTableAssociationProvider(),
      AWS.ECR.RepositoryProvider(),
      AWS.ECS.ClusterProvider(),
      AWS.ECS.ServiceProvider(),
      AWS.ELBv2.LoadBalancerProvider(),
      AWS.ELBv2.TargetGroupProvider(),
      AWS.ELBv2.ListenerProvider(),
      AWS.Scheduler.ScheduleProvider(),
      AWS.Scheduler.ScheduleGroupProvider(),
      AWS.IAM.RoleProvider(),
      AWS.Kinesis.StreamProvider(),
      AWS.RDS.DBInstanceProvider(),
      AWS.RDS.DBClusterProvider(),
      AWS.RDS.DBSubnetGroupProvider(),
      AWS.Route53.RecordProvider(),
      AWS.S3.BucketProvider(),
      AWS.SecretsManager.SecretProvider(),
      AWS.SQS.QueueProvider(),
      AWS.EFS.FileSystemProvider(),
      AWS.EFS.MountTargetProvider(),
      AWS.EFS.AccessPointProvider(),
      AWS.CloudMap.PrivateDnsNamespaceProvider(),
      AWS.CloudMap.ServiceProvider(),
      AWS.Glue.DatabaseProvider(),
      AWS.Athena.WorkGroupProvider(),
      AWS.ECS.TaskDefinitionProvider(),
      AWS.ApplicationAutoScaling.ScalableTargetProvider(),
      AWS.ApplicationAutoScaling.ScalingPolicyProvider(),
      applicationAwsNativeComputeProviderLayer(),
      applicationAwsNativeStatefulProviderLayer(),
    )),
    Layer.provideMerge(credentials),
    Layer.provideMerge(region),
    Layer.provideMerge(endpoint),
    Layer.provideMerge(environment),
    Layer.provideMerge(DockerLive),
    Layer.orDie,
  );
}

/**
 * Returns the concrete Alchemy resource topology without synthesizing an
 * intermediate deployment language. One semantic resource can expand into
 * multiple native resources when AWS itself requires supporting identities.
 */
export function applicationAwsNativeResourceDeclarations(
  plan: ApplicationAwsDeploymentPlan,
): readonly ApplicationAwsNativeResourceDeclaration[] {
  const dependencies = dependencyMap(plan);
  return topologicalPlanResources(plan).flatMap<ApplicationAwsNativeResourceDeclaration>((resource) => {
    const type = nativeTypeByPlanKind[planKind(resource)];
    if (!type) {
      throw new Error(
        `AWS native Alchemy lowering is not implemented for ${planKind(resource)} (${resource.id}). `
        + "The target refuses to invent an aggregate fallback resource.",
      );
    }
    if (resource.service === "rds" && resource.resourceType === "postgresql-instance") {
      return [
        {
          id: `${resource.id}.subnet-group`,
          planResourceId: resource.id,
          type: "AWS.RDS.DBSubnetGroup",
          logicalRole: "supporting" as const,
          dependsOn: privateSubnetIds(plan),
        },
        {
          id: resource.id,
          planResourceId: resource.id,
          type,
          logicalRole: "primary" as const,
          dependsOn: [...new Set([...(dependencies.get(resource.id) ?? []), `${resource.id}.subnet-group`])].sort(),
        },
      ];
    }
    if (resource.service === "ec2" && resource.resourceType === "security-group" && resource.configuration.egressMode === "unqualified-all") {
      return [
        { id: resource.id, planResourceId: resource.id, type, logicalRole: "primary" as const, dependsOn: dependencies.get(resource.id) ?? [] },
        { id: `${resource.id}.self-ingress`, planResourceId: resource.id, type: "AWS.EC2.SecurityGroupRule", logicalRole: "supporting" as const, dependsOn: [resource.id] },
      ];
    }
    if (resource.service === "elastic-load-balancing" && resource.resourceType === "application-load-balancer") {
      return [
        {
          id: `${resource.id}.security-group`,
          planResourceId: resource.id,
          type: "AWS.EC2.SecurityGroup",
          logicalRole: "supporting" as const,
          dependsOn: ["foundation.network"],
        },
        {
          id: resource.id,
          planResourceId: resource.id,
          type,
          logicalRole: "primary" as const,
          dependsOn: [...new Set([...(dependencies.get(resource.id) ?? []), `${resource.id}.security-group`])].sort(),
        },
      ];
    }
    if (resource.service === "efs" && resource.resourceType === "shared-filesystem") {
      const subnetIds = privateSubnetIds(plan);
      return [
        {
          id: `${resource.id}.filesystem`,
          planResourceId: resource.id,
          type: "AWS.EFS.FileSystem",
          logicalRole: "supporting" as const,
          dependsOn: dependencies.get(resource.id) ?? [],
        },
        ...subnetIds.map((subnetId) => ({
          id: `${resource.id}.mount-target.${subnetId.split(".").at(-1)}`,
          planResourceId: resource.id,
          type: "AWS.EFS.MountTarget",
          logicalRole: "supporting" as const,
          dependsOn: [`${resource.id}.filesystem`, subnetId],
        })),
        {
          id: resource.id,
          planResourceId: resource.id,
          type: "AWS.EFS.AccessPoint",
          logicalRole: "primary" as const,
          dependsOn: [
            `${resource.id}.filesystem`,
            ...subnetIds.map((subnetId) => `${resource.id}.mount-target.${subnetId.split(".").at(-1)}`),
          ],
        },
      ];
    }
    if (resource.service === "elasticache" && resource.resourceType === "valkey-replication-group") {
      return [
        {
          id: `${resource.id}.auth-token`,
          planResourceId: resource.id,
          type: "AWS.SecretsManager.Secret",
          logicalRole: "supporting" as const,
          dependsOn: [],
        },
        {
          id: `${resource.id}.subnet-group`,
          planResourceId: resource.id,
          type: "Applik8s.AWS.ElastiCache.SubnetGroup",
          logicalRole: "supporting" as const,
          dependsOn: privateSubnetIds(plan),
        },
        {
          id: resource.id,
          planResourceId: resource.id,
          type,
          logicalRole: "primary" as const,
          dependsOn: [...new Set([...(dependencies.get(resource.id) ?? []), `${resource.id}.subnet-group`])].sort(),
        },
      ];
    }
    if (nativeEcsWorkload(resource)) {
      const declarations: ApplicationAwsNativeResourceDeclaration[] = [
        {
          id: `${resource.id}.task-definition`,
          planResourceId: resource.id,
          type: "AWS.ECS.TaskDefinition",
          logicalRole: "supporting",
          dependsOn: dependencies.get(resource.id) ?? [],
        },
      ];
      if (stringConfig(resource.configuration, "discoveryNamespaceResourceId")) {
        declarations.push({
          id: `${resource.id}.discovery`,
          planResourceId: resource.id,
          type: "AWS.CloudMap.Service",
          logicalRole: "supporting",
          dependsOn: [requiredStringConfig(resource, "discoveryNamespaceResourceId")],
        });
      }
      if (resource.resourceType === "fargate-service") {
        const loadBalancer = plan.resources.find(({ service, resourceType }) => service === "elastic-load-balancing" && resourceType === "application-load-balancer");
        if (loadBalancer) {
          declarations.push(
            { id: `${resource.id}.target-group`, planResourceId: resource.id, type: "AWS.ELBv2.TargetGroup", logicalRole: "supporting", dependsOn: ["foundation.network"] },
            { id: `${resource.id}.listener`, planResourceId: resource.id, type: "AWS.ELBv2.Listener", logicalRole: "supporting", dependsOn: [loadBalancer.id, `${resource.id}.target-group`] },
            { id: `${resource.id}.alb-ingress`, planResourceId: resource.id, type: "AWS.EC2.SecurityGroupRule", logicalRole: "supporting", dependsOn: [loadBalancer.id, workloadSecurityGroupResourceId(resource)] },
          );
        }
      }
      declarations.push({
        id: resource.id,
        planResourceId: resource.id,
        type: "AWS.ECS.Service",
        logicalRole: "primary",
        dependsOn: [...new Set([...(dependencies.get(resource.id) ?? []), `${resource.id}.task-definition`])].sort(),
      });
      if (numberConfig(resource.configuration, "autoscalingMaxCapacity") !== undefined) {
        declarations.push(
          {
            id: `${resource.id}.autoscaling.target`,
            planResourceId: resource.id,
            type: "AWS.ApplicationAutoScaling.ScalableTarget",
            logicalRole: "supporting",
            dependsOn: [resource.id],
          },
          {
            id: `${resource.id}.autoscaling.policy`,
            planResourceId: resource.id,
            type: "AWS.ApplicationAutoScaling.ScalingPolicy",
            logicalRole: "supporting",
            dependsOn: [`${resource.id}.autoscaling.target`],
          },
        );
      }
      if (resource.resourceType === "celld-fleet") {
        declarations.push(
          { id: `${resource.id}.worker-deployment.task-definition`, planResourceId: resource.id, type: "AWS.ECS.TaskDefinition", logicalRole: "supporting", dependsOn: dependencies.get(resource.id) ?? [] },
          { id: `${resource.id}.worker-deployment`, planResourceId: resource.id, type: "Applik8s.AWS.ECS.OneShotTask", logicalRole: "supporting", dependsOn: [`${resource.id}.worker-deployment.task-definition`] },
        );
      }
      if (resource.resourceType === "hatchet-service") {
        declarations.push(
          { id: `${resource.id}.worker-token.task-definition`, planResourceId: resource.id, type: "AWS.ECS.TaskDefinition", logicalRole: "supporting", dependsOn: [...new Set([...(dependencies.get(resource.id) ?? []), resource.id])].sort() },
          { id: `${resource.id}.worker-token`, planResourceId: resource.id, type: "Applik8s.AWS.ECS.OneShotTask", logicalRole: "supporting", dependsOn: [`${resource.id}.worker-token.task-definition`] },
        );
      }
      return declarations;
    }
    return [{
      id: resource.id,
      planResourceId: resource.id,
      type,
      logicalRole: "primary" as const,
      dependsOn: dependencies.get(resource.id) ?? [],
    }];
  });
}

/**
 * Instantiates the native Alchemy graph. Outputs are passed directly into
 * downstream constructors, so Alchemy owns dependency discovery, adoption,
 * diffing, lifecycle, and state instead of an aggregate stack resource.
 */
export function materializeApplicationAwsNativeResources(
  plan: ApplicationAwsDeploymentPlan,
  options: ApplicationAwsNativeMaterializationOptions = {},
): Effect.Effect<ApplicationAwsNativeMaterialization, unknown, AWS.Providers> {
  return Effect.gen(function* () {
    const resources: Record<string, Readonly<Record<string, unknown>>> = { ...(options.seedResources ?? {}) };
    const outputs: Record<string, Readonly<Record<string, unknown>>> = { ...(options.seedOutputs ?? {}) };
    for (const resource of topologicalPlanResources(plan)) {
      const workload = nativeEcsWorkload(resource);
      if (options.phase === "foundation" && workload) continue;
      if (options.phase === "workloads" && !workload) continue;
      const output = yield* instantiateNativeResource(resource, plan, resources, options);
      resources[resource.id] = output;
      outputs[resource.id] = selectPlanOutputs(resource, output);
    }
    return { resources, outputs };
  });
}

function instantiateNativeResource(
  resource: ApplicationAwsPlanResource,
  plan: ApplicationAwsDeploymentPlan,
  outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  options: ApplicationAwsNativeMaterializationOptions,
): Effect.Effect<Readonly<Record<string, unknown>>, unknown, AWS.Providers> {
  const config = resource.configuration;
  const tags = applicationTags(plan, resource, options.resourceTags);
  const vpcId = () => outputValue(outputs, "foundation.network", "vpcId");
  const privateSubnets = () => privateSubnetIds(plan).map((id) => outputValue(outputs, id, "subnetId"));
  const publicSubnets = () => publicSubnetIds(plan).map((id) => outputValue(outputs, id, "subnetId"));
  const key = planKind(resource);
  let effect: Effect.Effect<unknown, unknown, AWS.Providers>;
  switch (key) {
    case "ec2/vpc":
      effect = AWS.EC2.Vpc(resource.id, {
        ...(stringConfig(config, "cidrBlock") ? { cidrBlock: stringConfig(config, "cidrBlock") } : {}),
        enableDnsSupport: booleanConfig(config, "enableDnsSupport") ?? true,
        enableDnsHostnames: booleanConfig(config, "enableDnsHostnames") ?? true,
        tags,
      } as never);
      break;
    case "ec2/subnet":
      effect = AWS.EC2.Subnet(resource.id, {
        vpcId: vpcId(),
        cidrBlock: stringConfig(config, "cidrBlock"),
        availabilityZone: stringConfig(config, "availabilityZone"),
        mapPublicIpOnLaunch: booleanConfig(config, "mapPublicIpOnLaunch") ?? false,
        tags,
      } as never);
      break;
    case "ec2/security-group":
      effect = Effect.gen(function* () {
        const group = yield* AWS.EC2.SecurityGroup(resource.id, {
          vpcId: vpcId(),
          groupName: resource.physicalName,
          description: stringConfig(config, "description") ?? `Applik8s ${resource.id}`,
          ingress: securityGroupRules(config.ingressRules, outputs, "ingress"),
          egress: config.egressMode === "unqualified-all"
            ? [{ ipProtocol: "-1", cidrIpv4: "0.0.0.0/0" }]
            : securityGroupRules(config.egressRules, outputs, "egress"),
          tags,
        } as never);
        if (config.egressMode === "unqualified-all") {
          yield* AWS.EC2.SecurityGroupRule(`${resource.id}.self-ingress`, {
            groupId: group.groupId,
            type: "ingress",
            ipProtocol: "-1",
            referencedGroupId: group.groupId,
            description: "Unqualified private workload communication",
            tags,
          } as never);
        }
        return group;
      }) as never;
      break;
    case "ec2/vpc-endpoint":
      effect = AWS.EC2.VpcEndpoint(resource.id, {
        vpcId: vpcId(),
        serviceName: requiredStringConfig(resource, "serviceName"),
        vpcEndpointType: stringConfig(config, "endpointType") === "interface" ? "Interface" : "Gateway",
        ...(stringConfig(config, "endpointType") === "interface"
          ? {
              subnetIds: privateSubnets(),
              securityGroupIds: [outputValue(outputs, requiredStringConfig(resource, "securityGroupResourceId"), "securityGroupId")],
              privateDnsEnabled: booleanConfig(config, "privateDnsEnabled") ?? true,
            }
          : {}),
        tags,
      } as never);
      break;
    case "ec2/internet-gateway":
      effect = AWS.EC2.InternetGateway(resource.id, { vpcId: vpcId(), tags } as never);
      break;
    case "ec2/elastic-ip":
      effect = AWS.EC2.EIP(resource.id, { domain: "vpc", tags } as never);
      break;
    case "ec2/nat-gateway":
      effect = AWS.EC2.NatGateway(resource.id, {
        subnetId: outputValue(outputs, requiredStringConfig(resource, "publicSubnetResourceId"), "subnetId"),
        allocationId: outputValue(outputs, requiredStringConfig(resource, "elasticIpResourceId"), "allocationId"),
        connectivityType: "public",
        tags,
      } as never);
      break;
    case "ec2/route-table":
      effect = AWS.EC2.RouteTable(resource.id, { vpcId: vpcId(), tags } as never);
      break;
    case "ec2/route": {
      const routeTableId = outputValue(outputs, requiredStringConfig(resource, "routeTableResourceId"), "routeTableId");
      const gatewayResourceId = stringConfig(config, "gatewayResourceId");
      const natGatewayResourceId = stringConfig(config, "natGatewayResourceId");
      effect = AWS.EC2.Route(resource.id, {
        routeTableId,
        destinationCidrBlock: stringConfig(config, "destinationCidrBlock") ?? "0.0.0.0/0",
        ...(gatewayResourceId ? { gatewayId: outputValue(outputs, gatewayResourceId, "internetGatewayId") } : {}),
        ...(natGatewayResourceId ? { natGatewayId: outputValue(outputs, natGatewayResourceId, "natGatewayId") } : {}),
      } as never);
      break;
    }
    case "ec2/route-table-association":
      effect = AWS.EC2.RouteTableAssociation(resource.id, {
        routeTableId: outputValue(outputs, requiredStringConfig(resource, "routeTableResourceId"), "routeTableId"),
        subnetId: outputValue(outputs, requiredStringConfig(resource, "subnetResourceId"), "subnetId"),
      } as never);
      break;
    case "ecr/repository":
      effect = AWS.ECR.Repository(resource.id, {
        repositoryName: resource.physicalName,
        imageTagMutability: stringConfig(config, "imageTagMutability") ?? "IMMUTABLE",
        scanOnPush: booleanConfig(config, "scanOnPush") ?? true,
        tags,
      } as never);
      break;
    case "ecs/cluster":
      effect = AWS.ECS.Cluster(resource.id, {
        clusterName: resource.physicalName,
        settings: booleanConfig(config, "containerInsights") === false ? [] : [{ name: "containerInsights", value: "enabled" }],
        tags,
      } as never);
      break;
    case "ecs/fargate-service":
    case "ecs/fargate-runtime-service":
    case "ecs/fargate-worker":
    case "ecs/celld-fleet":
    case "ecs/hatchet-service":
      effect = materializeNativeEcsWorkload(resource, plan, outputs, options, tags) as never;
      break;
    case "cloudwatch/log-group":
      effect = AWS.Logs.LogGroup(resource.id, {
        logGroupName: resource.physicalName,
        ...(numberConfig(config, "retentionDays") === undefined ? {} : { retentionInDays: numberConfig(config, "retentionDays") }),
        tags,
      } as never);
      break;
    case "s3/bucket":
    case "s3/lakehouse-dataset":
      effect = AWS.S3.Bucket(resource.id, {
        bucketName: resource.physicalName,
        forceDestroy: booleanConfig(config, "forceDestroy") ?? false,
        versioning: booleanConfig(config, "versioning") === false ? "Suspended" : "Enabled",
        publicAccessBlock: booleanConfig(config, "publicAccessBlock") === false
          ? { blockPublicAcls: false, blockPublicPolicy: false, ignorePublicAcls: false, restrictPublicBuckets: false }
          : { blockPublicAcls: true, blockPublicPolicy: true, ignorePublicAcls: true, restrictPublicBuckets: true },
        encryption: { sseAlgorithm: "AES256" },
        tags,
      } as never);
      break;
    case "sqs/queue": {
      const visibilityTimeout = durationSecondsConfig(config, "visibilityTimeoutSeconds");
      const receiveMessageWaitTime = durationSecondsConfig(config, "receiveWaitTimeSeconds");
      const messageRetentionPeriod = durationSecondsConfig(config, "retentionSeconds");
      const queueProps: AWS.SQS.QueueProps = {
        queueName: resource.physicalName,
        ...(visibilityTimeout === undefined ? {} : { visibilityTimeout }),
        ...(receiveMessageWaitTime === undefined ? {} : { receiveMessageWaitTime }),
        ...(messageRetentionPeriod === undefined ? {} : { messageRetentionPeriod }),
        sqsManagedSseEnabled: booleanConfig(config, "encrypted") ?? true,
        tags,
      };
      effect = AWS.SQS.Queue(resource.id, queueProps as never);
      break;
    }
    case "kinesis/stream":
      effect = AWS.Kinesis.Stream(resource.id, {
        streamName: resource.physicalName,
        streamMode: stringConfig(config, "mode") ?? "ON_DEMAND",
        retentionPeriod: `${numberConfig(config, "retentionHours") ?? 24} hours`,
        encryption: booleanConfig(config, "encrypted") ?? true,
        tags,
      } as never);
      break;
    case "dynamodb/table":
      effect = AWS.DynamoDB.Table(resource.id, dynamoTableProps(resource, tags) as never);
      break;
    case "iam/role":
      effect = AWS.IAM.Role(resource.id, iamRoleProps(resource, tags, outputs) as never);
      break;
    case "secrets-manager/database-credentials":
    case "secrets-manager/secret-authority":
    case "secrets-manager/workflow-token":
      effect = AWS.SecretsManager.Secret(resource.id, secretProps(resource, options, tags) as never);
      break;
    case "rds/postgresql-instance": {
      const subnetGroup = AWS.RDS.DBSubnetGroup(`${resource.id}.subnet-group`, {
        dbSubnetGroupName: boundedName(`${resource.physicalName}-subnets`, 255),
        subnetIds: privateSubnets(),
        tags,
      } as never);
      effect = Effect.gen(function* () {
        const group = yield* subnetGroup;
        const credentialsResourceId = stringConfig(config, "credentialsResourceId");
        const credential = credentialsResourceId
          ? yield* readDatabaseCredential(outputValue(outputs, credentialsResourceId, "secretArn"))
          : undefined;
        const database = yield* AWS.RDS.DBInstance(resource.id, {
          dbInstanceIdentifier: resource.physicalName,
          dbInstanceClass: stringConfig(config, "instanceClass") ?? "db.t4g.micro",
          engine: "postgres",
          engineVersion: stringConfig(config, "engineVersion"),
          dbName: stringConfig(config, "databaseName") ?? "postgres",
          allocatedStorage: numberConfig(config, "storageGiB") ?? 20,
          storageType: "gp3",
          masterUsername: credential?.username ?? stringConfig(config, "masterUsername") ?? "applik8s",
          ...(credential
            ? { masterUserPassword: Redacted.make(credential.password) }
            : { manageMasterUserPassword: true }),
          port: numberConfig(config, "port") ?? 5432,
          multiAZ: booleanConfig(config, "multiAz") ?? false,
          storageEncrypted: booleanConfig(config, "encrypted") ?? true,
          deletionProtection: booleanConfig(config, "deletionProtection") ?? false,
          dbSubnetGroupName: group.dbSubnetGroupName,
          vpcSecurityGroupIds: runtimeSecurityGroupIds(resource, outputs),
          tags,
        } as never);
        return database;
      }) as never;
      break;
    }
    case "rds/aurora-postgresql-cluster": {
      effect = Effect.gen(function* () {
        const database = yield* AWS.RDS.Aurora(resource.id, {
          databaseName: stringConfig(config, "databaseName") ?? "application",
          engine: "aurora-postgresql",
          engineVersion: stringConfig(config, "engineVersion"),
          subnetIds: privateSubnets(),
          securityGroupIds: runtimeSecurityGroupIds(resource, outputs),
          readers: numberConfig(config, "readers") ?? 0,
          scaling: {
            minCapacity: numberConfig(config, "minimumCapacity") ?? 0.5,
            maxCapacity: numberConfig(config, "maximumCapacity") ?? 1,
          },
          port: numberConfig(config, "port") ?? 5432,
          storageEncrypted: booleanConfig(config, "encrypted") ?? true,
          deletionProtection: booleanConfig(config, "deletionProtection") ?? false,
          tags,
        } as never);
        return {
          ...database,
          endpoint: database.cluster.endpoint,
          readerEndpoint: database.cluster.readerEndpoint,
          port: database.cluster.port,
          secretArn: database.secret.secretArn,
        };
      }) as never;
      break;
    }
    case "efs/shared-filesystem": {
      effect = Effect.gen(function* () {
        const fileSystem = yield* AWS.EFS.FileSystem(`${resource.id}.filesystem`, {
          encrypted: booleanConfig(config, "encrypted") ?? true,
          performanceMode: "generalPurpose",
          throughputMode: "elastic",
          tags,
        } as never);
        const securityGroupIds = runtimeSecurityGroupIds(resource, outputs) as readonly string[];
        for (const subnetId of privateSubnetIds(plan)) {
          yield* AWS.EFS.MountTarget(`${resource.id}.mount-target.${subnetId.split(".").at(-1)}`, {
            fileSystemId: fileSystem.fileSystemId,
            subnetId: outputValue(outputs, subnetId, "subnetId"),
            securityGroups: securityGroupIds,
          } as never);
        }
        const path = stringConfig(config, "accessPointPath") ?? "/applik8s";
        const accessPoint = yield* AWS.EFS.AccessPoint(resource.id, {
          fileSystemId: fileSystem.fileSystemId,
          posixUser: { uid: 1000, gid: 1000 },
          rootDirectory: {
            path,
            creationInfo: { ownerUid: 1000, ownerGid: 1000, permissions: "0755" },
          },
          tags,
        } as never);
        return {
          fileSystemId: fileSystem.fileSystemId,
          fileSystemArn: fileSystem.fileSystemArn,
          accessPointId: accessPoint.accessPointId,
          accessPointArn: accessPoint.accessPointArn,
          path,
        };
      }) as never;
      break;
    }
    case "elasticache/valkey-replication-group": {
      effect = Effect.gen(function* () {
        const subnetGroup = yield* ApplicationAwsElastiCacheSubnetGroup(`${resource.id}.subnet-group`, {
          name: boundedName(`${resource.physicalName}-subnets`, 255),
          description: `Private subnets for ${resource.physicalName}`,
          subnetIds: privateSubnets(),
          tags,
        });
        const authToken = yield* AWS.SecretsManager.Secret(`${resource.id}.auth-token`, {
          name: boundedName(`${resource.physicalName}-auth`, 512),
          generateSecretString: {
            secretStringTemplate: "{}",
            generateStringKey: "value",
            PasswordLength: 48,
            ExcludePunctuation: true,
          },
          tags,
        } as never);
        const authTokenArn = yield* (yield* authToken.secretArn);
        const token = yield* readSecretScalar(authTokenArn, "value");
        const group = yield* ApplicationAwsValkeyReplicationGroup(resource.id, {
          replicationGroupId: boundedName(resource.physicalName, 40),
          description: `Applik8s Valkey authority ${resource.id}`,
          subnetGroupName: subnetGroup.name,
          securityGroupIds: runtimeSecurityGroupIds(resource, outputs) as readonly string[],
          port: numberConfig(config, "port") ?? 6379,
          replicas: Math.max(1, numberConfig(config, "replicas") ?? 1),
          encryptedAtRest: booleanConfig(config, "encryptedAtRest") ?? true,
          encryptedInTransit: booleanConfig(config, "encryptedInTransit") ?? true,
          authToken: Redacted.make(token),
          tags,
        });
        return {
          replicationGroupId: group.replicationGroupId,
          replicationGroupArn: group.replicationGroupArn,
          endpoint: group.endpoint,
          port: group.port,
          status: group.status,
          replicas: group.replicas,
          secretArn: authToken.secretArn,
        };
      }) as never;
      break;
    }
    case "acm/certificate":
      effect = AWS.ACM.Certificate(resource.id, {
        domainName: requiredStringConfig(resource, "domainName"),
        subjectAlternativeNames: [...stringArray(config.subjectAlternativeNames)],
        validationMethod: "DNS",
        hostedZoneId: firstHostedZoneId(config),
        tags,
      } as never);
      break;
    case "elastic-load-balancing/application-load-balancer":
      effect = Effect.gen(function* () {
        const port = booleanConfig(config, "tlsRequired") ? 443 : 80;
        const group = yield* AWS.EC2.SecurityGroup(`${resource.id}.security-group`, {
          vpcId: vpcId(),
          groupName: boundedName(`${resource.physicalName}-ingress`, 255),
          description: `Public ingress for ${resource.physicalName}`,
          ingress: [{ ipProtocol: "tcp", fromPort: port, toPort: port, cidrIpv4: "0.0.0.0/0" }],
          egress: [{ ipProtocol: "-1", cidrIpv4: "0.0.0.0/0" }],
          tags,
        } as never);
        const loadBalancer = yield* AWS.ELBv2.LoadBalancer(resource.id, {
          name: resource.physicalName,
          type: "application",
          scheme: "internet-facing",
          subnets: publicSubnets(),
          securityGroups: [group.groupId],
          tags,
        } as never);
        return {
          loadBalancerArn: loadBalancer.loadBalancerArn,
          loadBalancerName: loadBalancer.loadBalancerName,
          dnsName: loadBalancer.dnsName,
          canonicalHostedZoneId: loadBalancer.canonicalHostedZoneId,
          vpcId: loadBalancer.vpcId,
          scheme: loadBalancer.scheme,
          type: loadBalancer.type,
          securityGroups: loadBalancer.securityGroups,
          subnets: loadBalancer.subnets,
          securityGroupId: group.groupId,
        };
      }) as never;
      break;
    case "route53/record-publication": {
      const loadBalancerId = requiredStringConfig(resource, "loadBalancerResourceId");
      effect = AWS.Route53.Record(resource.id, {
        hostedZoneId: requiredStringConfig(resource, "hostedZoneId"),
        name: requiredStringConfig(resource, "recordName"),
        type: stringConfig(config, "recordType") ?? "A",
        aliasTarget: {
          dnsName: outputValue(outputs, loadBalancerId, "dnsName"),
          hostedZoneId: outputValue(outputs, loadBalancerId, "zoneId"),
          evaluateTargetHealth: false,
        },
      } as never);
      break;
    }
    case "eventbridge-scheduler/schedule-group":
      effect = AWS.Scheduler.ScheduleGroup(resource.id, { name: resource.physicalName, tags });
      break;
    case "eventbridge-scheduler/schedule":
      effect = AWS.Scheduler.Schedule(resource.id, scheduleProps(resource, outputs) as never);
      break;
    case "service-discovery/private-dns-namespace":
      effect = AWS.CloudMap.PrivateDnsNamespace(resource.id, {
        name: requiredStringConfig(resource, "namespaceName"),
        vpc: vpcId(),
        description: `Private discovery for ${plan.application}/${plan.environment}`,
        tags,
      } as never);
      break;
    case "glue/catalog-database":
      effect = AWS.Glue.Database(resource.id, {
        databaseName: resource.physicalName,
        description: `Applik8s lakehouse catalog for ${plan.application}/${plan.environment}`,
        parameters: tags,
      } as never);
      break;
    case "athena/workgroup": {
      const resultBucketId = requiredStringConfig(resource, "resultBucketResourceId");
      effect = AWS.Athena.WorkGroup(resource.id, {
        workgroupName: resource.physicalName,
        outputLocation: composeString("s3://", outputValue(outputs, resultBucketId, "bucketName"), "/athena-results/"),
        enforceWorkGroupConfiguration: booleanConfig(config, "enforceConfiguration") ?? true,
        publishCloudWatchMetricsEnabled: booleanConfig(config, "publishMetrics") ?? true,
        ...(numberConfig(config, "bytesScannedCutoffPerQuery") === undefined
          ? {}
          : { bytesScannedCutoffPerQuery: numberConfig(config, "bytesScannedCutoffPerQuery") }),
        tags,
      } as never);
      break;
    }
    default:
      return Effect.fail(new Error(
        `AWS native Alchemy lowering is not implemented for ${key} (${resource.id}). `
        + "The target refuses to fall back to CloudFormation or an aggregate AWS stack resource.",
      ));
  }
  return withApplicationAwsNativeRemovalPolicy(effect, resource).pipe(
    Effect.map((value) => objectValue(value)),
  );
}

function readDatabaseCredential(secretArn: string) {
  return secretsmanager.getSecretValue({ SecretId: secretArn }).pipe(
    Effect.map(({ SecretString }) => {
      if (!SecretString) throw new Error(`AWS database credential ${secretArn} has no SecretString.`);
      const value = JSON.parse(typeof SecretString === "string" ? SecretString : Redacted.value(SecretString)) as unknown;
      const record = objectValue(value);
      const username = stringConfig(record, "username");
      const password = stringConfig(record, "password");
      if (!username || !password) throw new Error(`AWS database credential ${secretArn} must contain username and password.`);
      return { username, password };
    }),
  );
}

function readSecretScalar(secretArn: string, key: string) {
  return secretsmanager.getSecretValue({ SecretId: secretArn }).pipe(
    Effect.map(({ SecretString }) => {
      if (!SecretString) throw new Error(`AWS secret ${secretArn} has no SecretString.`);
      const value = JSON.parse(typeof SecretString === "string" ? SecretString : Redacted.value(SecretString)) as unknown;
      const scalar = stringConfig(objectValue(value), key);
      if (!scalar) throw new Error(`AWS secret ${secretArn} must contain ${key}.`);
      return scalar;
    }),
  );
}

interface ApplicationAwsTaskDefinitionAdapterProps {
  readonly family: string;
  readonly image: string | Output.Output<string>;
  readonly containerName: string;
  readonly entryPoint?: readonly string[];
  readonly command?: readonly string[];
  readonly portMappings: readonly { readonly containerPort: number; readonly protocol?: "tcp" | "udp" }[];
  readonly environment: Readonly<Record<string, string>>;
  readonly secrets: Readonly<Record<string, string>>;
  readonly taskRoleArn?: unknown;
  readonly executionRoleArn?: unknown;
  readonly cpu: string;
  readonly memory: string;
  readonly logGroupName: string;
  readonly logRegion: string;
  readonly healthCheck?: { readonly command: readonly string[]; readonly interval: number; readonly timeout: number; readonly retries: number; readonly startPeriod: number };
  readonly mount?: { readonly fileSystemId: string; readonly accessPointId: string; readonly containerPath: string; readonly iam?: "ENABLED" | "DISABLED" };
  readonly sidecars?: readonly ecs.ContainerDefinition[];
  readonly containers?: readonly ecs.ContainerDefinition[];
  readonly volumes?: readonly ecs.Volume[];
  readonly tags: Readonly<Record<string, string>>;
}

/** Maps Applik8s' portable task shape onto Alchemy's native ECS lifecycle. */
function applicationAwsTaskDefinition(
  id: string,
  props: ApplicationAwsTaskDefinitionAdapterProps,
) {
  const container: ecs.ContainerDefinition = {
    name: props.containerName,
    image: props.image as string,
    essential: true,
    ...(props.command ? { command: [...props.command] } : {}),
    ...(props.entryPoint ? { entryPoint: [...props.entryPoint] } : {}),
    portMappings: props.portMappings.map(({ containerPort, protocol }) => ({ containerPort, protocol: protocol ?? "tcp" })),
    environment: Object.entries(props.environment).map(([name, value]) => ({ name, value })),
    secrets: Object.entries(props.secrets).map(([name, valueFrom]) => ({ name, valueFrom })),
    logConfiguration: {
      logDriver: "awslogs",
      options: {
        "awslogs-group": props.logGroupName,
        "awslogs-region": props.logRegion,
        "awslogs-stream-prefix": props.containerName,
      },
    },
    ...(props.healthCheck ? { healthCheck: { ...props.healthCheck, command: [...props.healthCheck.command] } } : {}),
    ...(props.mount ? { mountPoints: [{ sourceVolume: "data", containerPath: props.mount.containerPath, readOnly: false }] } : {}),
  };
  return AWS.ECS.TaskDefinition(id, {
    family: props.family,
    containerDefinitions: props.containers ? [...props.containers] : [container, ...(props.sidecars ?? [])],
    cpu: props.cpu,
    memory: props.memory,
    ...(props.taskRoleArn ? { taskRoleArn: props.taskRoleArn } : {}),
    ...(props.executionRoleArn ? { executionRoleArn: props.executionRoleArn } : {}),
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    volumes: props.volumes
      ? [...props.volumes]
      : props.mount
        ? [{
            name: "data",
            efsVolumeConfiguration: {
              fileSystemId: props.mount.fileSystemId,
              transitEncryption: "ENABLED",
              authorizationConfig: { accessPointId: props.mount.accessPointId, iam: props.mount.iam ?? "DISABLED" },
            },
          }]
        : [],
    tags: props.tags,
  } as never);
}

function materializeNativeEcsWorkload(
  resource: ApplicationAwsPlanResource,
  plan: ApplicationAwsDeploymentPlan,
  outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  options: ApplicationAwsNativeMaterializationOptions,
  tags: Readonly<Record<string, string>>,
) {
  return Effect.gen(function* () {
    const config = resource.configuration;
    const port = numberConfig(config, "port") ?? numberConfig(config, "apiPort") ?? 3000;
    const healthPort = numberConfig(config, "healthPort") ?? port;
    const image = nativeWorkloadImage(resource, options);
    const taskRoleResourceId = stringConfig(config, "runtimeRoleResourceId");
    const executionRoleResourceId = stringConfig(config, "executionRoleResourceId");
    const taskRoleArn = taskRoleResourceId ? outputValue(outputs, taskRoleResourceId, "roleArn") : undefined;
    const executionRoleArn = executionRoleResourceId ? outputValue(outputs, executionRoleResourceId, "roleArn") : undefined;
    const logGroupName = outputValue(outputs, "foundation.logs", "logGroupName");
    if (resource.resourceType === "celld-fleet") {
      yield* materializeCelldWorkerDeployment(resource, plan, outputs, options, {
        ...(taskRoleArn ? { taskRoleArn } : {}),
        ...(executionRoleArn ? { executionRoleArn } : {}),
        logGroupName,
        tags,
      });
    }
    const healthCheck = nativeHealthCheck(resource, healthPort);
    const efsMount = nativeEfsMount(resource, outputs);
    const task = yield* applicationAwsTaskDefinition(`${resource.id}.task-definition`, {
      family: boundedName(resource.physicalName, 255),
      image,
      containerName: nativeContainerName(resource),
      ...(resource.resourceType === "hatchet-service"
        ? {
            entryPoint: ["/bin/sh", "-ec"],
            // biome-ignore lint/suspicious/noTemplateCurlyInString: the container shell expands these environment variables.
            command: ['export DATABASE_URL="postgresql://${DATABASE_POSTGRES_USERNAME}:${DATABASE_POSTGRES_PASSWORD}@${DATABASE_POSTGRES_HOST}:${DATABASE_POSTGRES_PORT}/hatchet?sslmode=require"; exec ./hatchet-lite'],
          }
        : resource.resourceType === "celld-fleet"
          ? { command: nativeCelldCommand(resource, plan, outputs) }
        : stringArray(config.command).length > 0 ? { command: stringArray(config.command) } : {}),
      portMappings: nativeContainerPorts(resource),
      environment: nativeWorkloadEnvironment(resource, plan, outputs),
      secrets: nativeWorkloadSecrets(resource, plan, outputs),
      ...(taskRoleArn ? { taskRoleArn } : {}),
      ...(executionRoleArn ? { executionRoleArn } : {}),
      cpu: resource.resourceType === "celld-fleet" || resource.resourceType === "hatchet-service" ? "1024" : "512",
      memory: resource.resourceType === "celld-fleet" || resource.resourceType === "hatchet-service" ? "2048" : "1024",
      logGroupName,
      logRegion: plan.region,
      ...(healthCheck ? { healthCheck } : {}),
      ...(efsMount ? { mount: efsMount } : {}),
      ...(stringConfig(config, "observability") === "cloudwatch"
        ? { sidecars: [awsOtelSidecar(plan, logGroupName)] }
        : {}),
      tags,
    } as never);

    const discoveryNamespaceResourceId = stringConfig(config, "discoveryNamespaceResourceId");
    const discovery = discoveryNamespaceResourceId
      ? yield* AWS.CloudMap.Service(`${resource.id}.discovery`, {
          name: stringConfig(config, "discoveryName") ?? resource.physicalName,
          namespaceId: outputValue(outputs, discoveryNamespaceResourceId, "namespaceId"),
          dnsRecords: [{ type: "A", ttl: "10 seconds" }],
          tags,
        } as never)
      : undefined;

    let loadBalancers: readonly Readonly<Record<string, unknown>>[] | undefined;
    if (resource.resourceType === "fargate-service") {
      const loadBalancer = plan.resources.find(({ service, resourceType }) =>
        service === "elastic-load-balancing" && resourceType === "application-load-balancer");
      if (loadBalancer) {
        const target = yield* AWS.ELBv2.TargetGroup(`${resource.id}.target-group`, {
          name: boundedName(`${resource.physicalName}-tg`, 32),
          vpcId: outputValue(outputs, "foundation.network", "vpcId"),
          port,
          protocol: "HTTP",
          targetType: "ip",
          healthCheckPath: stringConfig(config, "healthPath") ?? "/-/healthz",
          matcher: { HttpCode: "200-399" },
          tags,
        } as never);
        const certificate = plan.resources.find(({ service }) => service === "acm");
        yield* AWS.ELBv2.Listener(`${resource.id}.listener`, {
          loadBalancerArn: outputValue(outputs, loadBalancer.id, "loadBalancerArn"),
          targetGroupArn: target.targetGroupArn,
          port: certificate ? 443 : 80,
          protocol: certificate ? "HTTPS" : "HTTP",
          ...(certificate ? { certificates: [outputValue(outputs, certificate.id, "certificateArn")] } : {}),
        } as never);
        const workloadSecurityGroupId = outputValue(outputs, workloadSecurityGroupResourceId(resource), "securityGroupId");
        yield* AWS.EC2.SecurityGroupRule(`${resource.id}.alb-ingress`, {
          groupId: workloadSecurityGroupId,
          type: "ingress",
          ipProtocol: "tcp",
          fromPort: port,
          toPort: port,
          referencedGroupId: outputValue(outputs, loadBalancer.id, "securityGroupId"),
          description: `Public load balancer ingress for ${resource.physicalName}`,
          tags,
        } as never);
        loadBalancers = [{
          targetGroupArn: target.targetGroupArn,
          containerName: task.containerName,
          containerPort: port,
        }];
      }
    }

    const service = yield* AWS.ECS.Service(resource.id, {
      cluster: outputValue(outputs, "foundation.compute", "clusterArn"),
      task: {
        taskDefinitionArn: task.taskDefinitionArn,
        containerName: task.containerName,
        port,
      },
      serviceName: resource.physicalName,
      desiredCount: Math.max(0, numberConfig(config, "desiredCount") ?? 1),
      vpcId: outputValue(outputs, "foundation.network", "vpcId"),
      subnets: privateSubnetIds(plan).map((id) => outputValue(outputs, id, "subnetId")),
      securityGroups: runtimeSecurityGroupIds(resource, outputs) as readonly string[],
      assignPublicIp: false,
      launchType: "FARGATE",
      ...(loadBalancers ? { loadBalancers: loadBalancers as never } : {}),
      ...(discovery ? { serviceRegistries: [{ registryArn: discovery.serviceArn }] } : {}),
      deploymentConfiguration: {
        deploymentCircuitBreaker: { enable: true, rollback: true },
        minimumHealthyPercent: resource.resourceType === "celld-fleet" ? 0 : 100,
        maximumPercent: resource.resourceType === "celld-fleet" ? 100 : 200,
      },
      ...(loadBalancers ? { healthCheckGracePeriodSeconds: 60 } : {}),
      tags,
    } as never);
    if (numberConfig(config, "autoscalingMaxCapacity") !== undefined) {
      const resourceId = mapStringInputs(
        [outputValue(outputs, "foundation.compute", "clusterName"), service.serviceName],
        ([clusterName, serviceName]) => `service/${String(clusterName)}/${String(serviceName)}`,
      );
      const target = yield* AWS.ApplicationAutoScaling.ScalableTarget(`${resource.id}.autoscaling.target`, {
        serviceNamespace: "ecs",
        resourceId,
        scalableDimension: "ecs:service:DesiredCount",
        minCapacity: Math.max(0, numberConfig(config, "autoscalingMinCapacity") ?? numberConfig(config, "desiredCount") ?? 1),
        maxCapacity: Math.max(1, numberConfig(config, "autoscalingMaxCapacity") ?? 4),
        tags,
      } as never);
      yield* AWS.ApplicationAutoScaling.ScalingPolicy(`${resource.id}.autoscaling.policy`, {
        policyName: boundedName(`${resource.physicalName}-cpu`, 256),
        serviceNamespace: target.serviceNamespace,
        resourceId: target.resourceId,
        scalableDimension: target.scalableDimension,
        targetTracking: {
          TargetValue: numberConfig(config, "autoscalingTargetCpuUtilization") ?? 60,
          PredefinedMetricSpecification: { PredefinedMetricType: "ECSServiceAverageCPUUtilization" },
        },
      } as never);
    }
    if (resource.resourceType === "hatchet-service") {
      yield* materializeHatchetWorkerToken(resource, plan, outputs, {
        serviceArn: service.serviceArn,
        ...(executionRoleArn ? { executionRoleArn } : {}),
        logGroupName,
        tags,
      });
    }
    const endpoint = stringConfig(config, "endpoint")
      ?? (discoveryNamespaceResourceId
        ? `http://${stringConfig(config, "discoveryName") ?? resource.physicalName}.${namespaceName(plan, discoveryNamespaceResourceId)}:${port}`
        : undefined);
    return {
      serviceArn: service.serviceArn,
      serviceName: service.serviceName,
      clusterArn: service.clusterArn,
      taskDefinitionArn: service.taskDefinitionArn,
      status: service.status,
      ...(endpoint ? { endpoint } : {}),
      ...(resource.resourceType === "hatchet-service" && endpoint
        ? { grpcEndpoint: endpoint.replace(/:\d+$/u, `:${numberConfig(config, "grpcPort") ?? 7077}`) }
        : {}),
    };
  });
}

function materializeCelldWorkerDeployment(
  resource: ApplicationAwsPlanResource,
  plan: ApplicationAwsDeploymentPlan,
  outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  options: ApplicationAwsNativeMaterializationOptions,
  context: {
    readonly taskRoleArn?: string;
    readonly executionRoleArn?: string;
    readonly logGroupName: string;
    readonly tags: Readonly<Record<string, string>>;
  },
) {
  return Effect.gen(function* () {
    const image = options.celldWorkerImageUri;
    if (!validImmutableImageInput(image)) {
      return yield* Effect.fail(new Error(`AWS celld fleet ${resource.id} requires one immutable compiler-owned Worker deployment image.`));
    }
    const stateBucket = requiredStringConfig(resource, "stateBucketResourceId");
    const authorization = requiredStringConfig(resource, "authorizationResourceId");
    const connectionSigning = requiredStringConfig(resource, "connectionSigningResourceId");
    const deployment = yield* applicationAwsTaskDefinition(`${resource.id}.worker-deployment.task-definition`, {
      family: boundedName(`${resource.physicalName}-worker-deployment`, 255),
      image,
      containerName: "celld-worker-deployment",
      portMappings: [],
      environment: {
        AWS_REGION: plan.region,
        CELLD_BUCKET: composeString("s3://", outputValue(outputs, stateBucket, "bucketName")),
        APPLIK8S_ACTOR_APPLICATION_ENDPOINT: requiredStringConfig(resource, "applicationEndpoint"),
        APPLIK8S_ACTOR_WORKER_REVISION: requiredStringConfig(resource, "workerProtocol"),
      },
      secrets: {
        APPLIK8S_ACTOR_AUTHORIZATION: stringInput(outputValue(outputs, authorization, "secretArn"), `${authorization}.secretArn`),
        APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION: stringInput(outputValue(outputs, authorization, "secretArn"), `${authorization}.secretArn`),
        CELLD_VAR_APPLIK8S_ACTOR_CONNECTION_SIGNING_KEY: stringInput(outputValue(outputs, connectionSigning, "secretArn"), `${connectionSigning}.secretArn`),
      },
      ...(context.taskRoleArn ? { taskRoleArn: context.taskRoleArn } : {}),
      ...(context.executionRoleArn ? { executionRoleArn: context.executionRoleArn } : {}),
      cpu: "512",
      memory: "1024",
      logGroupName: context.logGroupName,
      logRegion: plan.region,
      tags: context.tags,
    } as never);
    return yield* ApplicationAwsOneShotTask(`${resource.id}.worker-deployment`, {
      clusterArn: outputValue(outputs, "foundation.compute", "clusterArn"),
      taskDefinitionArn: deployment.taskDefinitionArn,
      subnets: privateSubnetIds(plan).map((id) => outputValue(outputs, id, "subnetId")),
      securityGroupIds: runtimeSecurityGroupIds(resource, outputs) as readonly string[],
      receiptDigest: composeString(`${plan.digest}:`, image),
    });
  });
}

function materializeHatchetWorkerToken(
  resource: ApplicationAwsPlanResource,
  plan: ApplicationAwsDeploymentPlan,
  outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  context: {
    readonly serviceArn: unknown;
    readonly executionRoleArn?: string;
    readonly logGroupName: string;
    readonly tags: Readonly<Record<string, string>>;
  },
) {
  return Effect.gen(function* () {
    // Preserve an explicit dependency on the healthy Hatchet service before
    // the bootstrap task begins polling its shared configuration volume.
    yield* Effect.succeed(context.serviceArn);
    const image = requiredStringConfig(resource, "image");
    const filesystemId = requiredStringConfig(resource, "configFilesystemResourceId");
    const workerTokenId = requiredStringConfig(resource, "workerTokenResourceId");
    const workerTokenRoleId = requiredStringConfig(resource, "workerTokenRoleResourceId");
    const workerTokenArn = stringInput(outputValue(outputs, workerTokenId, "secretArn"), `${workerTokenId}.secretArn`);
    const workerRoleArn = outputValue(outputs, workerTokenRoleId, "roleArn");
    const logConfiguration = (prefix: string) => ({
      logDriver: "awslogs" as const,
      options: {
        "awslogs-group": context.logGroupName,
        "awslogs-region": plan.region,
        "awslogs-stream-prefix": prefix,
      },
    });
    const task = yield* applicationAwsTaskDefinition(`${resource.id}.worker-token.task-definition`, {
      family: boundedName(`${resource.physicalName}-worker-token`, 255),
      image,
      containerName: "issue-token",
      portMappings: [],
      environment: {},
      secrets: {},
      taskRoleArn: workerRoleArn,
      ...(context.executionRoleArn ? { executionRoleArn: context.executionRoleArn } : {}),
      cpu: "512",
      memory: "1024",
      logGroupName: context.logGroupName,
      logRegion: plan.region,
      containers: [
        {
          name: "issue-token",
          image,
          essential: true,
          entryPoint: ["/bin/sh", "-ec"],
          command: [`set -eu; umask 077; until token="$(./hatchet-admin token create --config /config --tenant-id ${requiredStringConfig(resource, "tenantId")} 2>/dev/null)"; do sleep 2; done; test -n "$token"; printf %s "$token" > /bootstrap/token`],
          mountPoints: [
            { sourceVolume: "hatchet-config", containerPath: "/config", readOnly: true },
            { sourceVolume: "token-output", containerPath: "/bootstrap", readOnly: false },
          ],
          logConfiguration: logConfiguration("hatchet-token-issuer"),
        },
        {
          name: "publish-token",
          image: "public.ecr.aws/aws-cli/aws-cli@sha256:cd2b1ed9b2181b2b8341f6584ec019b117cc13d3ec142a244d8908e1bb8ea487",
          essential: true,
          entryPoint: ["/bin/sh", "-ec"],
          command: ['test -s /bootstrap/token; aws secretsmanager put-secret-value --secret-id "$WORKER_TOKEN_SECRET_ARN" --secret-string file:///bootstrap/token >/dev/null'],
          dependsOn: [{ containerName: "issue-token", condition: "SUCCESS" }],
          environment: [{ name: "AWS_REGION", value: plan.region }, { name: "WORKER_TOKEN_SECRET_ARN", value: workerTokenArn as string }],
          mountPoints: [{ sourceVolume: "token-output", containerPath: "/bootstrap", readOnly: true }],
          logConfiguration: logConfiguration("hatchet-token-publisher"),
        },
      ],
      volumes: [
        {
          name: "hatchet-config",
          efsVolumeConfiguration: {
            fileSystemId: outputValue(outputs, filesystemId, "fileSystemId"),
            transitEncryption: "ENABLED",
            authorizationConfig: { accessPointId: outputValue(outputs, filesystemId, "accessPointId"), iam: "DISABLED" },
          },
        },
        { name: "token-output" },
      ],
      tags: context.tags,
    });
    return yield* ApplicationAwsOneShotTask(`${resource.id}.worker-token`, {
      clusterArn: outputValue(outputs, "foundation.compute", "clusterArn"),
      taskDefinitionArn: task.taskDefinitionArn,
      subnets: privateSubnetIds(plan).map((id) => outputValue(outputs, id, "subnetId")),
      securityGroupIds: runtimeSecurityGroupIds(resource, outputs) as readonly string[],
      receiptDigest: composeString(`${plan.digest}:`, workerTokenArn),
    });
  });
}

function nativeWorkloadImage(
  resource: ApplicationAwsPlanResource,
  options: ApplicationAwsNativeMaterializationOptions,
): string | Output.Output<string> {
  const configured = stringConfig(resource.configuration, "image");
  const artifactId = stringConfig(resource.configuration, "artifactId");
  const image = resource.resourceType === "fargate-service"
    ? options.imageUri
    : artifactId
      ? options.artifactImageUris?.[artifactId]
      : configured;
  if (!validImmutableImageInput(image)) {
    throw new Error(`AWS workload ${resource.id} requires one immutable OCI image URI.`);
  }
  return image as string | Output.Output<string>;
}

function nativeContainerName(resource: ApplicationAwsPlanResource): string {
  if (resource.resourceType === "celld-fleet") return "celld";
  if (resource.resourceType === "hatchet-service") return "hatchet";
  if (resource.resourceType === "fargate-service") return "application";
  return "runtime";
}

function nativeContainerPorts(resource: ApplicationAwsPlanResource): readonly { readonly containerPort: number; readonly protocol: "tcp" }[] {
  const config = resource.configuration;
  const ports = resource.resourceType === "hatchet-service"
    ? [numberConfig(config, "apiPort") ?? 8888, numberConfig(config, "grpcPort") ?? 7077]
    : resource.resourceType === "celld-fleet"
      ? [numberConfig(config, "port") ?? 8080, numberConfig(config, "peerPort") ?? 8081]
      : [numberConfig(config, "port")].filter((value): value is number => value !== undefined);
  return [...new Set(ports)].map((containerPort) => ({ containerPort, protocol: "tcp" as const }));
}

function nativeHealthCheck(resource: ApplicationAwsPlanResource, port: number) {
  if (resource.resourceType === "fargate-worker") return undefined;
  const path = stringConfig(resource.configuration, "healthPath")
    ?? (resource.resourceType === "celld-fleet" ? "/healthz" : undefined);
  if (!path) return undefined;
  return {
    command: ["CMD-SHELL", `wget -q -O - http://127.0.0.1:${port}${path} >/dev/null || exit 1`],
    interval: 10,
    timeout: 5,
    retries: 6,
    startPeriod: 30,
  };
}

function nativeEfsMount(
  resource: ApplicationAwsPlanResource,
  outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
) {
  const id = stringConfig(resource.configuration, "configFilesystemResourceId");
  if (!id) return undefined;
  return {
    fileSystemId: outputValue(outputs, id, "fileSystemId") as string,
    accessPointId: outputValue(outputs, id, "accessPointId") as string,
    containerPath: "/config",
  };
}

function nativeWorkloadEnvironment(
  resource: ApplicationAwsPlanResource,
  plan: ApplicationAwsDeploymentPlan,
  outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Readonly<Record<string, unknown>> {
  const config = resource.configuration;
  const environment: Record<string, unknown> = {
    APPLIK8S_DEPLOYMENT_TARGET: "aws",
    APPLIK8S_APPLICATION_NAME: plan.application,
    APPLIK8S_DEPLOYMENT_ID: plan.environment,
    APPLIK8S_ENVIRONMENT_ID: plan.environment,
    AWS_REGION: plan.region,
  };
  for (const entry of arrayObjects(config.callableProviderEnvironment)) {
    const name = stringConfig(entry, "name");
    const value = stringConfig(entry, "value");
    if (name && value !== undefined) environment[name] = value;
  }
  if (stringConfig(config, "eventTransport") === "kinesis") {
    environment.APPLIK8S_EVENT_TRANSPORT = "kinesis";
    environment.APPLIK8S_KINESIS_STREAM = stringInput(outputValue(outputs, requiredStringConfig(resource, "eventStreamResourceId"), "streamName"), "event stream name");
    environment.APPLIK8S_KINESIS_CHECKPOINT_TABLE = stringInput(outputValue(outputs, requiredStringConfig(resource, "checkpointTableResourceId"), "tableName"), "checkpoint table name");
    environment.APPLIK8S_KINESIS_CONSUMER = stringConfig(config, "consumer") ?? resource.id;
    environment.APPLIK8S_PROCESSOR_CONCURRENCY = String(numberConfig(config, "processorConcurrency") ?? 1);
  }
  const bindings = runtimeBindingsForWorkload(plan, resource);
  if (bindings.length > 0) environment.NODE_OPTIONS = "--import=@applik8s/runtime-aws/bootstrap";
  for (const [index, binding] of bindings.entries()) {
    const host = outputValue(outputs, binding.resourceId, "endpointAddress");
    const port = outputValue(outputs, binding.resourceId, "endpointPort");
    environment[`APPLIK8S_AWS_RUNTIME_BINDING_${index}`] = mapStringInputs([host, port], ([resolvedHost, resolvedPort]) => JSON.stringify({
      kind: "postgresUrl",
      environmentName: binding.environmentName,
      database: binding.database,
      host: resolvedHost,
      port: resolvedPort,
      secretEnvironmentName: runtimeBindingSecretEnvironmentName(index),
    }));
  }
  for (const entry of arrayObjects(config.runtimeEndpointBindings)) {
    const name = stringConfig(entry, "environmentName");
    const resourceId = stringConfig(entry, "resourceId");
    if (name && resourceId) environment[name] = stringInput(outputValue(outputs, resourceId, "endpoint"), `${resourceId}.endpoint`);
  }
  if (stringConfig(config, "observability") === "cloudwatch") {
    environment.OTEL_SERVICE_NAME = plan.application;
    environment.OTEL_RESOURCE_ATTRIBUTES = `deployment.environment.name=${plan.environment},service.namespace=applik8s`;
    environment.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4318";
  }
  for (const binding of arrayObjects(config.objectStorageBindings)) {
    const purpose = stringConfig(binding, "purpose");
    const resourceId = stringConfig(binding, "resourceId");
    if (!resourceId || (purpose !== "task" && purpose !== "rebuild")) continue;
    const prefix = purpose === "task" ? "APPLIK8S_TASK_OBJECT" : "APPLIK8S_REBUILD_OBJECT";
    environment[`${prefix}_BUCKET`] = stringInput(outputValue(outputs, resourceId, "bucketName"), `${resourceId}.bucketName`);
    environment[`${prefix}_REGION`] = plan.region;
    environment[`${prefix}_PREFIX`] = "";
    environment[`${prefix}_FORCE_PATH_STYLE`] = "false";
  }
  const lakehouseResourceIds = new Set(stringArrayConfig(config, "lakehouseResourceIds"));
  if (lakehouseResourceIds.size > 0) {
    const datasets = plan.resources
      .filter(({ id, service, resourceType }) =>
        lakehouseResourceIds.has(id) && service === "s3" && resourceType === "lakehouse-dataset")
      .sort((left, right) => left.id.localeCompare(right.id));
    const queries = plan.resources
      .filter(({ id, service, resourceType }) =>
        lakehouseResourceIds.has(id) && service === "athena" && resourceType === "workgroup")
      .sort((left, right) => left.id.localeCompare(right.id));
    const resolvedInputs: unknown[] = [];
    for (const dataset of datasets) {
      const catalogResourceId = requiredStringConfig(dataset, "catalogResourceId");
      if (!lakehouseResourceIds.has(catalogResourceId)) {
        throw new Error(`AWS lakehouse dataset ${dataset.id} requires catalog ${catalogResourceId}, but that catalog is not in the workload's exact binding set.`);
      }
      resolvedInputs.push(
        outputValue(outputs, dataset.id, "bucketName"),
        outputValue(outputs, catalogResourceId, "databaseName"),
      );
    }
    for (const query of queries) resolvedInputs.push(outputValue(outputs, query.id, "workgroupName"));
    environment.APPLIK8S_AWS_LAKEHOUSE_BINDINGS = mapStringInputs(resolvedInputs, (resolved) => {
      let offset = 0;
      return JSON.stringify({
        datasets: Object.fromEntries(datasets.map((dataset) => {
          const qualification = stringConfig(dataset.configuration, "qualification") ?? dataset.semanticNodeId ?? dataset.id;
          const bucket = String(resolved[offset++]);
          const catalogDatabase = String(resolved[offset++]);
          return [qualification, {
            bucket,
            prefix: stringConfig(dataset.configuration, "prefix") ?? "lakehouse",
            region: stringConfig(dataset.configuration, "region") ?? plan.region,
            catalogDatabase,
            forceDeleteUnretainedData: booleanConfig(dataset.configuration, "forceDeleteUnretainedData") === true,
          }];
        })),
        queries: Object.fromEntries(queries.map((query) => {
          const qualification = stringConfig(query.configuration, "qualification") ?? query.semanticNodeId ?? query.id;
          return [qualification, {
            workgroup: String(resolved[offset++]),
            region: stringConfig(query.configuration, "region") ?? plan.region,
          }];
        })),
      });
    });
  }
  if (resource.resourceType === "hatchet-service") {
    const databaseId = requiredStringConfig(resource, "databaseResourceId");
    const discoveryNamespaceId = requiredStringConfig(resource, "discoveryNamespaceResourceId");
    const host = `${requiredStringConfig(resource, "discoveryName")}.${namespaceName(plan, discoveryNamespaceId)}`;
    environment.DATABASE_POSTGRES_HOST = stringInput(outputValue(outputs, databaseId, "endpointAddress"), `${databaseId}.endpointAddress`);
    environment.DATABASE_POSTGRES_PORT = stringInput(outputValue(outputs, databaseId, "endpointPort"), `${databaseId}.endpointPort`);
    environment.DATABASE_POSTGRES_SSL_MODE = "require";
    environment.SERVER_AUTH_COOKIE_DOMAIN = host;
    environment.SERVER_AUTH_COOKIE_INSECURE = "t";
    environment.SERVER_AUTH_SET_EMAIL_VERIFIED = "t";
    environment.SERVER_GRPC_BIND_ADDRESS = "0.0.0.0";
    environment.SERVER_GRPC_INSECURE = "t";
    environment.SERVER_GRPC_BROADCAST_ADDRESS = `${host}:${numberConfig(config, "grpcPort") ?? 7077}`;
    environment.SERVER_GRPC_PORT = String(numberConfig(config, "grpcPort") ?? 7077);
    environment.SERVER_INTERNAL_CLIENT_INTERNAL_GRPC_BROADCAST_ADDRESS = `127.0.0.1:${numberConfig(config, "grpcPort") ?? 7077}`;
    environment.SERVER_MSGQUEUE_KIND = "postgres";
    environment.SERVER_URL = `http://${host}:${numberConfig(config, "apiPort") ?? 8888}`;
  }
  if (resource.resourceType === "celld-fleet") {
    environment.CELLD_WATCH = "/tmp/celld";
    const applicationEndpoint = stringConfig(config, "applicationEndpoint");
    if (applicationEndpoint) environment.CELLD_VAR_APPLIK8S_ACTOR_APPLICATION_ENDPOINT = applicationEndpoint;
  }
  if (booleanConfig(config, "finiteJobController") === true) {
    const subnetIds = stringArrayConfig(config, "jobPrivateSubnetResourceIds").map((id) =>
      outputValue(outputs, id, "subnetId"));
    if (subnetIds.length === 0) throw new Error(`AWS finite Job controller ${resource.id} requires private subnets.`);
    const securityGroupIds = stringArrayConfig(config, "jobSecurityGroupResourceIds").map((id) =>
      outputValue(outputs, id, "groupId"));
    environment.APPLIK8S_AWS_JOB_CONTAINER = nativeContainerName(resource);
    environment.APPLIK8S_AWS_JOB_SUBNETS = mapStringInputs(subnetIds, (values) => JSON.stringify(values));
    if (securityGroupIds.length > 0) {
      environment.APPLIK8S_AWS_JOB_SECURITY_GROUPS = mapStringInputs(securityGroupIds, (values) => JSON.stringify(values));
    }
  }
  return environment;
}

/** @internal Pure regression seam for portable-plan environment projection. */
export function applicationAwsNativeWorkloadEnvironmentForTest(
  resource: ApplicationAwsPlanResource,
  plan: ApplicationAwsDeploymentPlan,
  outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Readonly<Record<string, unknown>> {
  return nativeWorkloadEnvironment(resource, plan, outputs);
}

function nativeWorkloadSecrets(
  resource: ApplicationAwsPlanResource,
  plan: ApplicationAwsDeploymentPlan,
  outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Readonly<Record<string, unknown>> {
  const config = resource.configuration;
  const secrets: Record<string, unknown> = {};
  for (const [index, binding] of runtimeBindingsForWorkload(plan, resource).entries()) {
    secrets[runtimeBindingSecretEnvironmentName(index)] = stringInput(outputValue(outputs, binding.resourceId, "masterUserSecretArn"), `${binding.resourceId}.masterUserSecretArn`);
  }
  for (const entry of arrayObjects(config.callableProviderSecretEnvironment)) {
    const name = stringConfig(entry, "name");
    const resourceId = stringConfig(entry, "resourceId");
    const key = stringConfig(entry, "key");
    if (name && resourceId) {
      const arn = stringInput(outputValue(outputs, resourceId, "secretArn"), `${resourceId}.secretArn`);
      secrets[name] = key ? composeString("", arn, `:${key}::`) : arn;
    }
  }
  if (resource.resourceType === "hatchet-service") {
    const credentials = requiredStringConfig(resource, "credentialsResourceId");
    const arn = stringInput(outputValue(outputs, credentials, "secretArn"), `${credentials}.secretArn`);
    secrets.DATABASE_POSTGRES_USERNAME = composeString("", arn, ":username::");
    secrets.DATABASE_POSTGRES_PASSWORD = composeString("", arn, ":password::");
  }
  if (resource.resourceType === "celld-fleet") {
    const authorization = requiredStringConfig(resource, "authorizationResourceId");
    const connectionSigning = requiredStringConfig(resource, "connectionSigningResourceId");
    const authorizationArn = stringInput(outputValue(outputs, authorization, "secretArn"), `${authorization}.secretArn`);
    secrets.CELLD_VAR_APPLIK8S_ACTOR_AUTHORIZATION = authorizationArn;
    secrets.CELLD_VAR_APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION = authorizationArn;
    secrets.CELLD_VAR_APPLIK8S_ACTOR_CONNECTION_SIGNING_KEY = stringInput(outputValue(outputs, connectionSigning, "secretArn"), `${connectionSigning}.secretArn`);
  }
  const workerTokenId = stringConfig(config, "workerTokenResourceId");
  if (workerTokenId) secrets.HATCHET_CLIENT_TOKEN = stringInput(outputValue(outputs, workerTokenId, "secretArn"), `${workerTokenId}.secretArn`);
  return secrets;
}

function awsOtelSidecar(plan: ApplicationAwsDeploymentPlan, logGroupName: unknown) {
  return {
    name: "aws-otel-collector",
    image: "public.ecr.aws/aws-observability/aws-otel-collector@sha256:d053740297b1c25525e1ee3fffbba33e4acf0115ffbc21feb68d16e9d220b9b8",
    essential: false,
    command: ["--config=/etc/ecs/ecs-default-config.yaml"],
    portMappings: [{ containerPort: 4317, protocol: "tcp" as const }, { containerPort: 4318, protocol: "tcp" as const }],
    environment: [{ name: "AWS_REGION", value: plan.region }, { name: "AOT_CONFIG_CONTENT", value: "" }],
    logConfiguration: {
      logDriver: "awslogs" as const,
      options: { "awslogs-group": logGroupName, "awslogs-region": plan.region, "awslogs-stream-prefix": "otel-collector" },
    },
    healthCheck: {
      command: ["CMD-SHELL", "wget -q -O - http://127.0.0.1:13133/ >/dev/null || exit 1"],
      interval: 10,
      timeout: 5,
      retries: 6,
      startPeriod: 20,
    },
  };
}

function nativeCelldCommand(
  resource: ApplicationAwsPlanResource,
  plan: ApplicationAwsDeploymentPlan,
  outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): readonly unknown[] {
  const config = resource.configuration;
  const stateBucket = requiredStringConfig(resource, "stateBucketResourceId");
  const discoveryName = stringConfig(config, "discoveryName") ?? resource.physicalName;
  const namespace = namespaceName(plan, requiredStringConfig(resource, "discoveryNamespaceResourceId"));
  const port = numberConfig(config, "port") ?? 8080;
  const peerPort = numberConfig(config, "peerPort") ?? 8081;
  return [
    "--bucket", composeString("s3://", outputValue(outputs, stateBucket, "bucketName")),
    "--region", plan.region,
    "--listen", `0.0.0.0:${port}`,
    "--internal-listen", `0.0.0.0:${peerPort}`,
    "--advertise", `${discoveryName}.${namespace}:${peerPort}`,
  ];
}

function runtimeBindingsForWorkload(
  plan: ApplicationAwsDeploymentPlan,
  resource: ApplicationAwsPlanResource,
) {
  const names = new Set(stringArray(resource.configuration.runtimeBindingEnvironmentNames));
  return plan.runtimeBindings.filter(({ environmentName }) => names.has(environmentName));
}

function runtimeBindingSecretEnvironmentName(index: number): string {
  return `APPLIK8S_AWS_RUNTIME_BINDING_SECRET_${index}`;
}

function namespaceName(plan: ApplicationAwsDeploymentPlan, resourceId: string): string {
  const resource = plan.resources.find(({ id }) => id === resourceId);
  if (!resource) throw new Error(`AWS discovery namespace ${resourceId} is absent.`);
  return requiredStringConfig(resource, "namespaceName");
}

function arrayObjects(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) ? value.map(objectValue) : [];
}

function secretProps(
  resource: ApplicationAwsPlanResource,
  options: ApplicationAwsNativeMaterializationOptions,
  tags: Readonly<Record<string, string>>,
): Readonly<Record<string, unknown>> {
  const config = resource.configuration;
  const environmentEntries = arrayObjects(config.environmentEntries);
  if (environmentEntries.length > 0) {
    const payload = Object.fromEntries(environmentEntries.map((entry) => {
      const secretField = stringConfig(entry, "secretField");
      const environmentReference = stringConfig(entry, "environmentReference");
      if (!secretField || !environmentReference) {
        throw new Error(`AWS Secret ${resource.id} contains an invalid deployment-environment entry.`);
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(environmentReference)) {
        throw new Error(`AWS Secret ${resource.id} environment reference ${JSON.stringify(environmentReference)} is invalid.`);
      }
      const value = options.environment?.[environmentReference] ?? process.env[environmentReference];
      if (!value) throw new Error(`AWS Secret ${resource.id} requires environment variable ${environmentReference}.`);
      return [secretField, value];
    }));
    return { name: resource.physicalName, secretString: Redacted.make(JSON.stringify(payload)), tags };
  }
  const environmentKeys = objectValue(config.environmentKeys);
  if (environmentKeys) {
    const payload = Object.fromEntries(Object.entries(environmentKeys).map(([secretKey, environmentName]) => {
      if (typeof environmentName !== "string") throw new Error(`AWS Secret ${resource.id} environment mapping ${secretKey} is invalid.`);
      const value = options.environment?.[environmentName] ?? process.env[environmentName];
      if (!value) throw new Error(`AWS Secret ${resource.id} requires environment variable ${environmentName}.`);
      return [secretKey, value];
    }));
    return { name: resource.physicalName, secretString: Redacted.make(JSON.stringify(payload)), tags };
  }
  const username = stringConfig(config, "username");
  return {
    name: resource.physicalName,
    generateSecretString: {
      secretStringTemplate: JSON.stringify(username ? { username } : {}),
      generateStringKey: username ? "password" : "value",
      PasswordLength: numberConfig(config, "passwordLength") ?? 48,
      ExcludePunctuation: booleanConfig(config, "urlSafe") ?? true,
    },
    tags,
  };
}

function dynamoTableProps(resource: ApplicationAwsPlanResource, tags: Readonly<Record<string, string>>): Readonly<Record<string, unknown>> {
  const config = resource.configuration;
  const partitionKey = stringConfig(config, "partitionKey") ?? "pk";
  const sortKey = stringConfig(config, "sortKey");
  return {
    tableName: resource.physicalName,
    partitionKey,
    ...(sortKey ? { sortKey } : {}),
    attributes: { [partitionKey]: "S", ...(sortKey ? { [sortKey]: "S" } : {}) },
    billingMode: "PAY_PER_REQUEST",
    pointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: booleanConfig(config, "pointInTimeRecovery") ?? true },
    ...(stringConfig(config, "ttlAttribute") ? { timeToLiveSpecification: { AttributeName: stringConfig(config, "ttlAttribute"), Enabled: true } } : {}),
    tags,
  };
}

function iamRoleProps(
  resource: ApplicationAwsPlanResource,
  tags: Readonly<Record<string, string>>,
  outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Readonly<Record<string, unknown>> {
  const config = resource.configuration;
  const service = stringConfig(config, "assumeService") ?? "ecs-tasks.amazonaws.com";
  const statements = Array.isArray(config.statements) ? config.statements.map((candidate) => {
    const statement = objectValue(candidate);
    return {
      Effect: stringConfig(statement, "effect") ?? "Allow",
      Action: stringArray(statement.actions),
      Resource: stringArray(statement.resources).map((value) => resolvePlannedOutputReference(value, outputs)),
      ...(objectValue(statement.conditions) && Object.keys(objectValue(statement.conditions)).length > 0
        ? { Condition: statement.conditions }
        : {}),
    };
  }) : [];
  return {
    roleName: resource.physicalName,
    assumeRolePolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: service }, Action: ["sts:AssumeRole"] }] },
    ...(statements.length > 0 ? { inlinePolicies: { Applik8sRuntime: { Version: "2012-10-17", Statement: statements } } } : {}),
    tags,
  };
}

function resolvePlannedOutputReference(
  value: string,
  outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): unknown {
  if (!value.startsWith("output://")) return value;
  const separator = value.lastIndexOf("/");
  if (separator <= "output://".length || separator === value.length - 1) {
    throw new Error(`AWS IAM output reference ${value} is malformed.`);
  }
  return outputValue(outputs, value.slice("output://".length, separator), value.slice(separator + 1));
}

function scheduleProps(resource: ApplicationAwsPlanResource, outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>): Readonly<Record<string, unknown>> {
  const config = resource.configuration;
  const queue = requiredStringConfig(resource, "targetQueue");
  const role = outputValue(outputs, "scheduler.execution-role", "roleArn");
  return {
    name: resource.physicalName,
    groupName: outputValue(outputs, "scheduler.group", "groupName"),
    scheduleExpression: requiredStringConfig(resource, "expression"),
    scheduleExpressionTimezone: stringConfig(config, "timezone"),
    flexibleTimeWindow: { Mode: "OFF" },
    target: {
      Arn: outputValue(outputs, queue, "queueArn"),
      RoleArn: role,
      Input: JSON.stringify({ scheduleId: requiredStringConfig(resource, "definitionId") }),
      RetryPolicy: {
        MaximumEventAgeInSeconds: numberConfig(config, "maximumEventAgeSeconds"),
        MaximumRetryAttempts: numberConfig(config, "maximumRetryAttempts"),
      },
    },
  };
}

function securityGroupRules(
  value: unknown,
  outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  direction: "ingress" | "egress",
): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) return [];
  return value.map((candidate) => {
    const rule = objectValue(candidate);
    const protocol = stringConfig(rule, "protocol") ?? "-1";
    const port = numberConfig(rule, "port");
    const groupResourceId = stringConfig(rule, direction === "ingress" ? "sourceSecurityGroupResourceId" : "targetSecurityGroupResourceId");
    const prefixListResourceId = rule.kind === "prefixList" ? stringConfig(rule, "targetResourceId") : undefined;
    return {
      ipProtocol: protocol,
      ...(port === undefined ? {} : { fromPort: port, toPort: port }),
      ...(groupResourceId ? { referencedGroupId: outputValue(outputs, groupResourceId, "securityGroupId") } : {}),
      ...(prefixListResourceId
        ? { prefixListId: outputValue(outputs, prefixListResourceId, "prefixListId") }
        : stringConfig(rule, "prefixListId") ? { prefixListId: stringConfig(rule, "prefixListId") } : {}),
      ...(stringConfig(rule, "cidr") ? { cidrIpv4: stringConfig(rule, "cidr") } : {}),
    };
  });
}

function runtimeSecurityGroupIds(resource: ApplicationAwsPlanResource, outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>): readonly unknown[] {
  return [outputValue(outputs, workloadSecurityGroupResourceId(resource), "securityGroupId")];
}

function workloadSecurityGroupResourceId(resource: ApplicationAwsPlanResource): string {
  return stringConfig(resource.configuration, "runtimeAccessSecurityGroupResourceId") ?? "foundation.security-group.application";
}

function selectPlanOutputs(
  resource: ApplicationAwsPlanResource,
  native: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const aliases: Readonly<Record<string, string>> = {
    securityGroupId: "groupId",
    endpoint: "endpointAddress",
    port: "endpointPort",
    secretArn: "masterUserSecretArn",
    zoneId: "canonicalHostedZoneId",
    groupArn: "scheduleGroupArn",
    groupName: "scheduleGroupName",
    fqdn: "name",
  };
  return Object.fromEntries(resource.outputs.flatMap(({ name }) => {
    const value = native[name] ?? native[aliases[name] ?? ""];
    return value === undefined ? [] : [[name, value] as const];
  }));
}

function outputValue(
  outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  resourceId: string,
  name: string,
): never {
  const resource = outputs[resourceId];
  if (!resource) throw new Error(`AWS native resource ${resourceId} must be materialized before ${name} can be referenced.`);
  const aliases: Readonly<Record<string, string>> = { securityGroupId: "groupId", zoneId: "canonicalHostedZoneId", groupName: "scheduleGroupName" };
  const value = resource[name] ?? resource[aliases[name] ?? ""];
  if (value === undefined) throw new Error(`AWS native resource ${resourceId} does not expose ${name}.`);
  return value as never;
}

function stringInput(value: unknown, label: string): string | Output.Output<string> {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Output.isOutput(value)) return Output.map(value, (resolved) => String(resolved));
  throw new Error(`AWS native Alchemy graph expected ${label} to resolve to a scalar string.`);
}

function composeString(prefix: string, value: unknown, suffix = ""): string | Output.Output<string> {
  const input = stringInput(value, "a composed resource output");
  return Output.isOutput(input)
    ? Output.map(input, (resolved) => `${prefix}${resolved}${suffix}`)
    : `${prefix}${input}${suffix}`;
}

function mapStringInputs(
  values: readonly unknown[],
  project: (resolved: readonly unknown[]) => string,
): string | Output.Output<string> {
  if (!values.some(Output.isOutput)) return project(values);
  const inputs = values.map((value) => Output.asOutput(value));
  return Output.map(
    Output.all(...inputs) as Output.Output<readonly unknown[]>,
    project,
  );
}

function validImmutableImageInput(value: unknown): boolean {
  return Output.isOutput(value)
    || (typeof value === "string" && /^[^\s@]+@sha256:[a-f0-9]{64}$/u.test(value));
}

function dependencyMap(plan: ApplicationAwsDeploymentPlan): ReadonlyMap<string, readonly string[]> {
  const dependencies = new Map<string, Set<string>>();
  for (const { from, to } of plan.edges) {
    const current = dependencies.get(to) ?? new Set<string>();
    current.add(from);
    dependencies.set(to, current);
  }
  return new Map([...dependencies].map(([id, values]) => [id, [...values].sort()]));
}

function topologicalPlanResources(plan: ApplicationAwsDeploymentPlan): readonly ApplicationAwsPlanResource[] {
  const byId = new Map(plan.resources.map((resource) => [resource.id, resource]));
  const dependencies = dependencyMap(plan);
  const remaining = new Set(byId.keys());
  const ordered: ApplicationAwsPlanResource[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((id) => (dependencies.get(id) ?? []).every((dependency) => !remaining.has(dependency)))
      .sort();
    if (ready.length === 0) throw new Error(`AWS plan contains a dependency cycle among ${[...remaining].sort().join(", ")}.`);
    for (const id of ready) {
      const resource = byId.get(id);
      if (!resource) throw new Error(`AWS plan topology lost resource ${id}.`);
      ordered.push(resource);
      remaining.delete(id);
    }
  }
  return ordered;
}

function applicationTags(
  plan: ApplicationAwsDeploymentPlan,
  resource: ApplicationAwsPlanResource,
  additional: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  return {
    ...additional,
    "applik8s.dev/application": plan.application,
    "applik8s.dev/environment": plan.environment,
    "applik8s.dev/resource-id": resource.id,
    "applik8s.dev/plan-digest": plan.digest,
  };
}

function privateSubnetIds(plan: ApplicationAwsDeploymentPlan): readonly string[] {
  return plan.resources.filter(({ id }) => id.startsWith("foundation.subnet.private.")).map(({ id }) => id).sort();
}

function publicSubnetIds(plan: ApplicationAwsDeploymentPlan): readonly string[] {
  return plan.resources.filter(({ id }) => id.startsWith("foundation.subnet.public.")).map(({ id }) => id).sort();
}

function planKind(resource: ApplicationAwsPlanResource): string {
  return `${resource.service}/${resource.resourceType}`;
}

function nativeEcsWorkload(resource: ApplicationAwsPlanResource): boolean {
  return resource.service === "ecs" && [
    "celld-fleet",
    "hatchet-service",
    "fargate-service",
    "fargate-runtime-service",
    "fargate-worker",
  ].includes(resource.resourceType);
}

function requiredStringConfig(resource: ApplicationAwsPlanResource, key: string): string {
  const value = stringConfig(resource.configuration, key);
  if (!value) throw new Error(`AWS resource ${resource.id} requires configuration.${key}.`);
  return value;
}

function stringConfig(value: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function stringArrayConfig(value: Readonly<Record<string, unknown>> | undefined, key: string): readonly string[] {
  const candidate = value?.[key];
  return Array.isArray(candidate) && candidate.every((entry) => typeof entry === "string" && entry.length > 0)
    ? candidate
    : [];
}

function numberConfig(value: Readonly<Record<string, unknown>> | undefined, key: string): number | undefined {
  const candidate = value?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function durationSecondsConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): `${number} seconds` | undefined {
  const seconds = numberConfig(value, key);
  return seconds === undefined ? undefined : `${seconds} seconds`;
}

function booleanConfig(value: Readonly<Record<string, unknown>> | undefined, key: string): boolean | undefined {
  const candidate = value?.[key];
  return typeof candidate === "boolean" ? candidate : undefined;
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || (typeof value !== "object" && typeof value !== "function") || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function firstHostedZoneId(config: DeploymentJsonObject): string | undefined {
  const options = config.domainValidationOptions;
  if (!Array.isArray(options)) return undefined;
  return stringConfig(objectValue(options[0]), "hostedZoneId");
}

function boundedName(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit);
}

function optionalRedacted(value: string | undefined): Redacted.Redacted<string> | undefined {
  return value ? Redacted.make(value) : undefined;
}

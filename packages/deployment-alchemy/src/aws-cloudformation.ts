// typecast-file-boundary: Canonical plan JSON is lowered into CloudFormation's structurally typed intrinsic-value model.
import { createHash } from "node:crypto";
import type {
  ApplicationAwsDeploymentPlan,
  ApplicationAwsPlanResource,
  DeploymentJsonObject,
  DeploymentJsonValue,
} from "@applik8s/deployment-contract";

export interface ApplicationAwsTemplateOptions {
  readonly imageUri?: string;
  readonly artifactImageUris?: Readonly<Record<string, string>>;
  readonly celldWorkerImageUri?: string;
  readonly phase?: "foundation" | "bootstrap" | "complete";
  readonly directOutputs?: Readonly<Record<string, Readonly<Record<string, string | number>>>>;
}

export interface ApplicationAwsCloudFormationTemplate {
  readonly AWSTemplateFormatVersion: "2010-09-09";
  readonly Description: string;
  readonly Resources: Readonly<Record<string, DeploymentJsonObject>>;
  readonly Outputs: Readonly<Record<string, DeploymentJsonObject>>;
}

/**
 * Pure lowering from the canonical AWS plan to the declarative portion of the
 * target transaction. ElastiCache, Athena, and Glue are deliberately handled
 * by the adjacent direct-resource driver because the pinned MiniStack release
 * does not expose their CloudFormation resource types.
 */
export function synthesizeApplicationAwsCloudFormationTemplate(
  plan: ApplicationAwsDeploymentPlan,
  options: ApplicationAwsTemplateOptions = {},
): ApplicationAwsCloudFormationTemplate {
  const resources: Record<string, DeploymentJsonObject> = {};
  const outputs: Record<string, DeploymentJsonObject> = {};
  const logical = new Map(plan.resources.map((resource) => [resource.id, logicalId(resource.id)]));
  const privateSubnets = plan.resources.filter(({ id }) => id.startsWith("foundation.subnet.private."));
  const publicSubnets = plan.resources.filter(({ id }) => id.startsWith("foundation.subnet.public."));
  const network = plan.resources.find(({ id }) => id === "foundation.network");
  const securityGroup = plan.resources.find(({ id }) => id === "foundation.security-group.application");
  const hatchetSemanticIds = new Set(plan.resources
    .filter(({ service, resourceType }) => service === "ecs" && resourceType === "hatchet-service")
    .flatMap(({ semanticNodeId }) => semanticNodeId ? [semanticNodeId] : []));

  for (const entry of plan.resources) {
    if (directAwsResource(entry)) continue;
    if (options.phase === "foundation" && entry.semanticNodeId && hatchetSemanticIds.has(entry.semanticNodeId)) continue;
    if ((options.phase === "foundation" || options.phase === "bootstrap") && (entry.resourceType === "fargate-service" || entry.resourceType === "fargate-runtime-service" || entry.resourceType === "fargate-worker")) continue;
    if (options.phase === "foundation" && entry.resourceType === "celld-fleet") continue;
    const id = logical.get(entry.id)!;
    switch (`${entry.service}:${entry.resourceType}`) {
      case "ec2:vpc":
        resources[id] = resource("AWS::EC2::VPC", {
          CidrBlock: stringConfig(entry, "cidrBlock"),
          EnableDnsSupport: booleanConfig(entry, "enableDnsSupport", true),
          EnableDnsHostnames: booleanConfig(entry, "enableDnsHostnames", true),
          Tags: tags(plan, entry),
        });
        addNetworkFoundation(resources, plan, entry, id, logical, publicSubnets, privateSubnets);
        break;
      case "ec2:subnet":
        if (!network) throw new Error(`AWS subnet ${entry.id} requires foundation.network.`);
        resources[id] = resource("AWS::EC2::Subnet", {
          VpcId: ref(logical.get(network.id)!),
          AvailabilityZone: stringConfig(entry, "availabilityZone"),
          CidrBlock: stringConfig(entry, "cidrBlock"),
          MapPublicIpOnLaunch: booleanConfig(entry, "mapPublicIpOnLaunch", false),
          Tags: tags(plan, entry),
        }, [logical.get(network.id)!]);
        if (entry.id.includes(".public.")) addPublicSubnetRoute(resources, entry, id);
        break;
      case "ec2:security-group": {
        if (!network) throw new Error(`AWS security group ${entry.id} requires foundation.network.`);
        const explicitEgress = stringConfig(entry, "egressMode", "unqualified-all") === "explicit";
        resources[id] = resource("AWS::EC2::SecurityGroup", {
          GroupDescription: stringConfig(entry, "description"),
          VpcId: ref(logical.get(network.id)!),
          SecurityGroupIngress: [],
          SecurityGroupEgress: explicitEgress ? [] : [{ IpProtocol: "-1", CidrIp: "0.0.0.0/0" }],
          Tags: tags(plan, entry),
        }, [logical.get(network.id)!]);
        addRuntimeSecurityGroupRules(resources, entry, id, logical);
        break;
      }
      case "ecr:repository":
        resources[id] = resource("AWS::ECR::Repository", {
          RepositoryName: entry.physicalName,
          ImageTagMutability: stringConfig(entry, "imageTagMutability", "IMMUTABLE"),
          ImageScanningConfiguration: { ScanOnPush: booleanConfig(entry, "scanOnPush", true) },
          EncryptionConfiguration: { EncryptionType: "AES256" },
          Tags: tags(plan, entry),
        });
        break;
      case "ecs:cluster":
        resources[id] = resource("AWS::ECS::Cluster", {
          ClusterName: entry.physicalName,
          ClusterSettings: [{ Name: "containerInsights", Value: booleanConfig(entry, "containerInsights", true) ? "enabled" : "disabled" }],
          Tags: tags(plan, entry),
        });
        break;
      case "service-discovery:private-dns-namespace":
        if (!network) throw new Error(`AWS service discovery ${entry.id} requires foundation.network.`);
        resources[id] = resource("AWS::ServiceDiscovery::PrivateDnsNamespace", {
          Name: stringConfig(entry, "namespaceName"),
          Vpc: ref(logical.get(stringConfig(entry, "vpcResourceId"))!),
          Description: `Private Applik8s runtime discovery for ${plan.application}/${plan.environment}`,
          Tags: tags(plan, entry),
        }, [logical.get(stringConfig(entry, "vpcResourceId"))!]);
        break;
      case "cloudwatch:log-group":
        resources[id] = resource("AWS::Logs::LogGroup", {
          LogGroupName: entry.physicalName,
          RetentionInDays: numberConfig(entry, "retentionDays", 30),
          Tags: tags(plan, entry),
        });
        break;
      case "iam:role":
        resources[id] = resource("AWS::IAM::Role", {
          RoleName: entry.physicalName,
          AssumeRolePolicyDocument: assumeRolePolicy(stringConfig(entry, "assumeService", "ecs-tasks.amazonaws.com")),
          Policies: [{ PolicyName: "applik8s-runtime-access", PolicyDocument: { Version: "2012-10-17", Statement: cloudFormationPolicyStatements(entry, plan, logical) } }],
          Tags: tags(plan, entry),
        });
        break;
      case "dynamodb:kinesis-checkpoint-table":
        resources[id] = resource("AWS::DynamoDB::Table", {
          TableName: entry.physicalName,
          BillingMode: stringConfig(entry, "billingMode", "PAY_PER_REQUEST"),
          AttributeDefinitions: [
            { AttributeName: stringConfig(entry, "partitionKey", "consumerKey"), AttributeType: "S" },
            { AttributeName: stringConfig(entry, "sortKey", "shardId"), AttributeType: "S" },
          ],
          KeySchema: [
            { AttributeName: stringConfig(entry, "partitionKey", "consumerKey"), KeyType: "HASH" },
            { AttributeName: stringConfig(entry, "sortKey", "shardId"), KeyType: "RANGE" },
          ],
          SSESpecification: { SSEEnabled: booleanConfig(entry, "serverSideEncryption", true) },
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: booleanConfig(entry, "pointInTimeRecovery", false) },
          Tags: tags(plan, entry),
        }, undefined, entry.lifecycle.deletion === "retain" ? "Retain" : undefined);
        break;
      case "rds:postgresql-instance":
        if (!securityGroup) throw new Error(`AWS PostgreSQL ${entry.id} requires foundation.security-group.application.`);
        addPostgres(resources, plan, entry, id, logical, privateSubnets, securityGroupForEntry(plan, entry, securityGroup));
        break;
      case "efs:shared-filesystem":
        if (!securityGroup) throw new Error(`AWS filesystem ${entry.id} requires foundation.security-group.application.`);
        addSharedFileSystem(resources, plan, entry, id, logical, privateSubnets, securityGroup);
        break;
      case "s3:bucket":
      case "s3:lakehouse-dataset":
        resources[id] = resource("AWS::S3::Bucket", {
          BucketName: entry.physicalName,
          BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] },
          PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
          VersioningConfiguration: { Status: booleanConfig(entry, "versioning", true) ? "Enabled" : "Suspended" },
          Tags: tags(plan, entry),
        }, undefined, entry.lifecycle.deletion === "retain" ? "Retain" : undefined);
        break;
      case "sqs:queue": {
        const deadLetterQueue = entry.id === "scheduler.admission"
          ? plan.resources.find(({ id: resourceId }) => resourceId === "scheduler.dead-letter")
          : undefined;
        resources[id] = resource("AWS::SQS::Queue", {
          QueueName: entry.physicalName,
          SqsManagedSseEnabled: booleanConfig(entry, "encrypted", true),
          VisibilityTimeout: numberConfig(entry, "visibilityTimeoutSeconds", 300),
          ReceiveMessageWaitTimeSeconds: numberConfig(entry, "receiveWaitTimeSeconds", 0),
          MessageRetentionPeriod: numberConfig(entry, "retentionSeconds", 345_600),
          ...(deadLetterQueue
            ? {
                RedrivePolicy: {
                  deadLetterTargetArn: getAtt(logical.get(deadLetterQueue.id)!, "Arn"),
                  maxReceiveCount: 5,
                },
              }
            : {}),
          Tags: tagRecord(plan, entry),
        }, deadLetterQueue ? [logical.get(deadLetterQueue.id)!] : undefined);
        break;
      }
      case "kinesis:stream":
        resources[id] = resource("AWS::Kinesis::Stream", {
          Name: entry.physicalName,
          StreamModeDetails: { StreamMode: stringConfig(entry, "mode", "ON_DEMAND") },
          RetentionPeriodHours: numberConfig(entry, "retentionHours", 24),
          ...(booleanConfig(entry, "encrypted", true) ? { StreamEncryption: { EncryptionType: "KMS", KeyId: "alias/aws/kinesis" } } : {}),
          Tags: tags(plan, entry),
        });
        break;
      case "eventbridge-scheduler:schedule-group":
        resources[id] = resource("AWS::Scheduler::ScheduleGroup", { Name: entry.physicalName, Tags: tags(plan, entry) });
        break;
      case "eventbridge-scheduler:schedule":
        addSchedule(resources, plan, entry, id, logical);
        break;
      case "secrets-manager:secret-authority":
        resources[id] = resource("AWS::SecretsManager::Secret", {
          Name: entry.physicalName,
          Description: `Applik8s secret authority for ${entry.semanticNodeId ?? entry.id}`,
          GenerateSecretString: { PasswordLength: 48, ExcludePunctuation: true },
          Tags: tags(plan, entry),
        }, undefined, entry.lifecycle.deletion === "retain" ? "Retain" : undefined);
        break;
      case "secrets-manager:database-credentials":
        resources[id] = resource("AWS::SecretsManager::Secret", {
          Name: entry.physicalName,
          Description: `Applik8s database credentials for ${entry.semanticNodeId ?? entry.id}`,
          GenerateSecretString: {
            SecretStringTemplate: JSON.stringify({ username: stringConfig(entry, "username", "applik8s") }),
            GenerateStringKey: "password",
            PasswordLength: numberConfig(entry, "passwordLength", 48),
            ExcludeCharacters: "\\\"'`$&|;<> (){}[]:/?#@!+,=%",
          },
          Tags: tags(plan, entry),
        }, undefined, entry.lifecycle.deletion === "retain" ? "Retain" : undefined);
        break;
      case "secrets-manager:workflow-token":
        resources[id] = resource("AWS::SecretsManager::Secret", {
          Name: entry.physicalName,
          Description: `Applik8s managed workflow credential for ${entry.semanticNodeId ?? entry.id}`,
          Tags: tags(plan, entry),
        }, undefined, entry.lifecycle.deletion === "retain" ? "Retain" : undefined);
        break;
      case "elastic-load-balancing:application-load-balancer": {
        if (!network) throw new Error(`AWS load balancer ${entry.id} requires foundation.network.`);
        const loadBalancerSecurityGroup = `${id}SecurityGroup`;
        resources[loadBalancerSecurityGroup] = resource("AWS::EC2::SecurityGroup", {
          GroupDescription: `Public ingress for ${entry.physicalName}`,
          VpcId: ref(logical.get(network.id)!),
          SecurityGroupIngress: [{ IpProtocol: "tcp", FromPort: booleanConfig(entry, "tlsRequired", false) ? 443 : 80, ToPort: booleanConfig(entry, "tlsRequired", false) ? 443 : 80, CidrIp: "0.0.0.0/0" }],
          SecurityGroupEgress: [{ IpProtocol: "-1", CidrIp: "0.0.0.0/0" }],
          Tags: tags(plan, entry),
        }, [logical.get(network.id)!]);
        resources[id] = resource("AWS::ElasticLoadBalancingV2::LoadBalancer", {
          Name: entry.physicalName.slice(0, 32),
          Scheme: "internet-facing",
          Type: "application",
          Subnets: publicSubnets.map((subnet) => ref(logical.get(subnet.id)!)),
          SecurityGroups: [ref(loadBalancerSecurityGroup)],
          Tags: tags(plan, entry),
        }, [...publicSubnets.map((subnet) => logical.get(subnet.id)!), loadBalancerSecurityGroup]);
        break;
      }
      case "acm:certificate":
        addCertificate(resources, plan, entry, id);
        break;
      case "route53:record-publication":
        addDnsRecord(resources, plan, entry, id, logical);
        break;
      case "ecs:fargate-service":
        if (!securityGroup) throw new Error(`AWS application service ${entry.id} requires foundation.security-group.application.`);
        addApplicationService(resources, plan, entry, id, logical, privateSubnets, securityGroupForEntry(plan, entry, securityGroup), options);
        break;
      case "ecs:fargate-worker":
        if (!securityGroup) throw new Error(`AWS runtime worker ${entry.id} requires foundation.security-group.application.`);
        addRuntimeWorker(resources, plan, entry, id, logical, privateSubnets, securityGroupForEntry(plan, entry, securityGroup), options);
        outputs[applicationAwsOutputKey(entry.id, "imageUri")] = {
          Description: `${entry.id}.imageUri`,
          Value: requiredArtifactImage(entry, options),
        };
        break;
      case "ecs:fargate-runtime-service":
        if (!securityGroup) throw new Error(`AWS runtime service ${entry.id} requires foundation.security-group.application.`);
        addRuntimeService(resources, plan, entry, id, logical, privateSubnets, securityGroupForEntry(plan, entry, securityGroup), options);
        outputs[applicationAwsOutputKey(entry.id, "imageUri")] = {
          Description: `${entry.id}.imageUri`,
          Value: requiredArtifactImage(entry, options),
        };
        break;
      case "cloudwatch:otel-collector":
        // The collector is a sidecar on every generated host task. This
        // explicit wait handle keeps the semantic provider visible in the
        // target plan without inventing a second collector lifecycle.
        resources[id] = resource("AWS::CloudFormation::WaitConditionHandle", {});
        break;
      case "ecs:celld-fleet":
        if (!securityGroup) throw new Error(`AWS celld fleet ${entry.id} requires foundation.security-group.application.`);
        addCelldFleet(resources, plan, entry, id, logical, privateSubnets, securityGroup, options);
        break;
      case "ecs:hatchet-service":
        if (!securityGroup) throw new Error(`AWS Hatchet service ${entry.id} requires foundation.security-group.application.`);
        addHatchetService(resources, plan, entry, id, logical, privateSubnets, securityGroup);
        break;
      default:
        throw new Error(`AWS plan resource ${entry.id} (${entry.service}/${entry.resourceType}) has no CloudFormation lowering.`);
    }
    if (options.phase === "bootstrap" && entry.resourceType === "celld-fleet") {
      outputs[applicationAwsOutputKey(entry.id, "deploymentTaskDefinitionArn")] = {
        Description: `${entry.id}.deploymentTaskDefinitionArn`,
        Value: ref(`${id}DeploymentTaskDefinition`),
      };
      outputs[applicationAwsOutputKey(entry.id, "deploymentSecurityGroupId")] = {
        Description: `${entry.id}.deploymentSecurityGroupId`,
        Value: ref(`${id}SecurityGroup`),
      };
    } else if (options.phase === "bootstrap" && entry.resourceType === "hatchet-service") {
      outputs[applicationAwsOutputKey(entry.id, "workerTokenTaskDefinitionArn")] = {
        Description: `${entry.id}.workerTokenTaskDefinitionArn`,
        Value: ref(`${id}WorkerTokenTaskDefinition`),
      };
      outputs[applicationAwsOutputKey(entry.id, "workerTokenSecurityGroupId")] = {
        Description: `${entry.id}.workerTokenSecurityGroupId`,
        Value: ref(`${id}SecurityGroup`),
      };
    } else {
      addOutputs(outputs, entry, id, options.directOutputs?.[entry.id], plan, logical);
    }
  }

  if (options.phase !== "foundation" && options.imageUri) {
    outputs.ApplicationImageUri = { Description: "Immutable compiler-owned ApplicationHost image", Value: options.imageUri };
  }

  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: `Applik8s ${plan.application}/${plan.environment} ${plan.digest}`,
    Resources: compactObject(resources),
    Outputs: compactObject(outputs),
  };
}

function addRuntimeWorker(
  resources: Record<string, DeploymentJsonObject>,
  plan: ApplicationAwsDeploymentPlan,
  entry: ApplicationAwsPlanResource,
  id: string,
  logical: ReadonlyMap<string, string>,
  privateSubnets: readonly ApplicationAwsPlanResource[],
  securityGroup: ApplicationAwsPlanResource,
  options: ApplicationAwsTemplateOptions,
): void {
  const image = requiredArtifactImage(entry, options);
  const cluster = required(plan, "foundation.compute");
  const logs = required(plan, "foundation.logs");
  const executionRole = `${id}ExecutionRole`;
  const generatedTaskRole = `${id}TaskRole`;
  const task = `${id}TaskDefinition`;
  const runtimeRoleResourceId = optionalString(entry.configuration.runtimeRoleResourceId);
  const runtimeRole = runtimeRoleResourceId ? required(plan, runtimeRoleResourceId) : undefined;
  resources[executionRole] = resource("AWS::IAM::Role", {
    AssumeRolePolicyDocument: assumeRolePolicy("ecs-tasks.amazonaws.com"),
    ManagedPolicyArns: ["arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"],
    Policies: [{
      PolicyName: "applik8s-runtime-secrets",
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: secretResourceArns(plan, logical, entry).length > 0
          ? [{ Effect: "Allow", Action: ["secretsmanager:GetSecretValue"], Resource: secretResourceArns(plan, logical, entry) }]
          : [{ Effect: "Deny", Action: ["secretsmanager:GetSecretValue"], Resource: ["*"] }],
      },
    }],
    Tags: tags(plan, entry),
  });
  if (!runtimeRole) {
    resources[generatedTaskRole] = resource("AWS::IAM::Role", {
      AssumeRolePolicyDocument: assumeRolePolicy("ecs-tasks.amazonaws.com"),
      Policies: [{ PolicyName: "applik8s-no-runtime-access", PolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Deny", Action: ["*"], Resource: ["*"] }] } }],
      Tags: tags(plan, entry),
    });
  }
  const taskRoleArn = runtimeRole ? getAtt(logical.get(runtimeRole.id)!, "Arn") : getAtt(generatedTaskRole, "Arn");
  resources[task] = resource("AWS::ECS::TaskDefinition", {
    Family: entry.physicalName,
    RequiresCompatibilities: ["FARGATE"],
    NetworkMode: "awsvpc",
    Cpu: "512",
    Memory: "1024",
    ExecutionRoleArn: getAtt(executionRole, "Arn"),
    TaskRoleArn: taskRoleArn,
    ContainerDefinitions: [{
      Name: "runtime",
      Image: image,
      Essential: true,
      Command: arrayConfig(entry, "command"),
      Environment: applicationEnvironment(plan, logical, options.directOutputs, entry),
      Secrets: applicationSecrets(plan, logical, entry),
      LogConfiguration: { LogDriver: "awslogs", Options: { "awslogs-group": ref(logical.get(logs.id)!), "awslogs-region": plan.region, "awslogs-stream-prefix": stringConfig(entry, "artifactId", "runtime") } },
    }, ...otelSidecarDefinitions(plan, logical, entry)],
    Tags: tags(plan, entry),
  }, [executionRole, ...(runtimeRole ? [logical.get(runtimeRole.id)!] : [generatedTaskRole]), logical.get(logs.id)!]);
  resources[id] = resource("AWS::ECS::Service", {
    ServiceName: entry.physicalName,
    Cluster: ref(logical.get(cluster.id)!),
    TaskDefinition: ref(task),
    DesiredCount: numberConfig(entry, "desiredCount", 1),
    LaunchType: "FARGATE",
    EnableECSManagedTags: true,
    DeploymentConfiguration: { DeploymentCircuitBreaker: { Enable: true, Rollback: true }, MinimumHealthyPercent: 100, MaximumPercent: 200 },
    NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: "DISABLED", SecurityGroups: [ref(logical.get(securityGroup.id)!)], Subnets: privateSubnets.map((subnet) => ref(logical.get(subnet.id)!)) } },
    Tags: tags(plan, entry),
  }, [logical.get(cluster.id)!, task, logical.get(securityGroup.id)!, ...privateSubnets.map((subnet) => logical.get(subnet.id)!)]);
  addEcsServiceAutoscaling(resources, entry, id, logical.get(cluster.id)!);
}

function addRuntimeSecurityGroupRules(
  resources: Record<string, DeploymentJsonObject>,
  entry: ApplicationAwsPlanResource,
  id: string,
  logical: ReadonlyMap<string, string>,
): void {
  for (const [index, rule] of arrayObjects(entry.configuration.egressRules).entries()) {
    const protocol = optionalString(rule.protocol);
    const port = typeof rule.port === "number" && Number.isInteger(rule.port) ? rule.port : undefined;
    if (!protocol || !port || port < 1 || port > 65_535) throw new Error(`AWS security group ${entry.id} has an invalid egress rule at index ${index}.`);
    const targetSecurityGroupResourceId = optionalString(rule.targetSecurityGroupResourceId);
    const cidr = optionalString(rule.cidr);
    if (Boolean(targetSecurityGroupResourceId) === Boolean(cidr)) throw new Error(`AWS security group ${entry.id} egress rule ${index} must name exactly one destination.`);
    const targetLogicalId = targetSecurityGroupResourceId ? logical.get(targetSecurityGroupResourceId) : undefined;
    if (targetSecurityGroupResourceId && !targetLogicalId) throw new Error(`AWS security group ${entry.id} egress rule ${index} names missing group ${targetSecurityGroupResourceId}.`);
    resources[`${id}RuntimeEgress${index + 1}`] = resource("AWS::EC2::SecurityGroupEgress", {
      GroupId: ref(id),
      IpProtocol: protocol,
      FromPort: port,
      ToPort: port,
      ...(targetLogicalId ? { DestinationSecurityGroupId: ref(targetLogicalId) } : { CidrIp: cidr ?? "" }),
      Description: optionalString(rule.peerIdentity) ?? optionalString(rule.egressIdentity) ?? `Applik8s runtime egress ${index + 1}`,
    }, [id, ...(targetLogicalId ? [targetLogicalId] : [])]);
  }
  for (const [index, rule] of arrayObjects(entry.configuration.ingressRules).entries()) {
    const protocol = optionalString(rule.protocol);
    const port = typeof rule.port === "number" && Number.isInteger(rule.port) ? rule.port : undefined;
    const sourceSecurityGroupResourceId = optionalString(rule.sourceSecurityGroupResourceId);
    const sourceLogicalId = sourceSecurityGroupResourceId ? logical.get(sourceSecurityGroupResourceId) : undefined;
    if (!protocol || !port || port < 1 || port > 65_535 || !sourceSecurityGroupResourceId || !sourceLogicalId) {
      throw new Error(`AWS security group ${entry.id} has an invalid ingress rule at index ${index}.`);
    }
    resources[`${id}RuntimeIngress${index + 1}`] = resource("AWS::EC2::SecurityGroupIngress", {
      GroupId: ref(id),
      IpProtocol: protocol,
      FromPort: port,
      ToPort: port,
      SourceSecurityGroupId: ref(sourceLogicalId),
      Description: optionalString(rule.peerIdentity) ?? `Applik8s runtime ingress ${index + 1}`,
    }, [id, sourceLogicalId]);
  }
}

function addRuntimeService(
  resources: Record<string, DeploymentJsonObject>,
  plan: ApplicationAwsDeploymentPlan,
  entry: ApplicationAwsPlanResource,
  id: string,
  logical: ReadonlyMap<string, string>,
  privateSubnets: readonly ApplicationAwsPlanResource[],
  securityGroup: ApplicationAwsPlanResource,
  options: ApplicationAwsTemplateOptions,
): void {
  const image = requiredArtifactImage(entry, options);
  const cluster = required(plan, "foundation.compute");
  const logs = required(plan, "foundation.logs");
  const namespace = required(plan, stringConfig(entry, "discoveryNamespaceResourceId"));
  const namespaceId = logical.get(namespace.id)!;
  const executionRole = `${id}ExecutionRole`;
  const generatedTaskRole = `${id}TaskRole`;
  const task = `${id}TaskDefinition`;
  const discovery = `${id}Discovery`;
  const ingress = `${id}Ingress`;
  const port = numberConfig(entry, "port", 8080);
  const healthPort = numberConfig(entry, "healthPort", port);
  const runtimeRoleResourceId = optionalString(entry.configuration.runtimeRoleResourceId);
  const runtimeRole = runtimeRoleResourceId ? required(plan, runtimeRoleResourceId) : undefined;
  resources[executionRole] = resource("AWS::IAM::Role", {
    AssumeRolePolicyDocument: assumeRolePolicy("ecs-tasks.amazonaws.com"),
    ManagedPolicyArns: ["arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"],
    Policies: [{
      PolicyName: "applik8s-runtime-secrets",
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: secretResourceArns(plan, logical, entry).length > 0
          ? [{ Effect: "Allow", Action: ["secretsmanager:GetSecretValue"], Resource: secretResourceArns(plan, logical, entry) }]
          : [{ Effect: "Deny", Action: ["secretsmanager:GetSecretValue"], Resource: ["*"] }],
      },
    }],
    Tags: tags(plan, entry),
  });
  if (!runtimeRole) {
    resources[generatedTaskRole] = resource("AWS::IAM::Role", {
      AssumeRolePolicyDocument: assumeRolePolicy("ecs-tasks.amazonaws.com"),
      Policies: [{ PolicyName: "applik8s-no-runtime-access", PolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Deny", Action: ["*"], Resource: ["*"] }] } }],
      Tags: tags(plan, entry),
    });
  }
  const taskRoleArn = runtimeRole ? getAtt(logical.get(runtimeRole.id)!, "Arn") : getAtt(generatedTaskRole, "Arn");
  const ports = [...new Set([port, healthPort])];
  resources[task] = resource("AWS::ECS::TaskDefinition", {
    Family: entry.physicalName,
    RequiresCompatibilities: ["FARGATE"],
    NetworkMode: "awsvpc",
    Cpu: "512",
    Memory: "1024",
    ExecutionRoleArn: getAtt(executionRole, "Arn"),
    TaskRoleArn: taskRoleArn,
    ContainerDefinitions: [{
      Name: "runtime",
      Image: image,
      Essential: true,
      Command: arrayConfig(entry, "command"),
      PortMappings: ports.map((containerPort) => ({ ContainerPort: containerPort, Protocol: "tcp" })),
      Environment: applicationEnvironment(plan, logical, options.directOutputs, entry),
      Secrets: applicationSecrets(plan, logical, entry),
      LogConfiguration: { LogDriver: "awslogs", Options: { "awslogs-group": ref(logical.get(logs.id)!), "awslogs-region": plan.region, "awslogs-stream-prefix": stringConfig(entry, "artifactId", "runtime") } },
      HealthCheck: { Command: ["CMD-SHELL", `wget -q -O - http://127.0.0.1:${healthPort}${stringConfig(entry, "healthPath", "/ready")} >/dev/null || exit 1`], Interval: 10, Timeout: 5, Retries: 6, StartPeriod: 30 },
    }, ...otelSidecarDefinitions(plan, logical, entry)],
    Tags: tags(plan, entry),
  }, [executionRole, ...(runtimeRole ? [logical.get(runtimeRole.id)!] : [generatedTaskRole]), logical.get(logs.id)!]);
  resources[discovery] = resource("AWS::ServiceDiscovery::Service", {
    Name: stringConfig(entry, "discoveryName"),
    NamespaceId: getAtt(namespaceId, "Id"),
    DnsConfig: { DnsRecords: [{ Type: "A", TTL: 10 }], RoutingPolicy: "MULTIVALUE" },
    HealthCheckCustomConfig: { FailureThreshold: 1 },
    Tags: tags(plan, entry),
  }, [namespaceId]);
  resources[ingress] = resource("AWS::EC2::SecurityGroupIngress", {
    GroupId: ref(logical.get(securityGroup.id)!),
    IpProtocol: "tcp",
    FromPort: port,
    ToPort: port,
    SourceSecurityGroupId: ref(logical.get(securityGroup.id)!),
  }, [logical.get(securityGroup.id)!]);
  resources[id] = resource("AWS::ECS::Service", {
    ServiceName: entry.physicalName,
    Cluster: ref(logical.get(cluster.id)!),
    TaskDefinition: ref(task),
    DesiredCount: numberConfig(entry, "desiredCount", 1),
    LaunchType: "FARGATE",
    EnableECSManagedTags: true,
    DeploymentConfiguration: { DeploymentCircuitBreaker: { Enable: true, Rollback: true }, MinimumHealthyPercent: 100, MaximumPercent: 200 },
    NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: "DISABLED", SecurityGroups: [ref(logical.get(securityGroup.id)!)], Subnets: privateSubnets.map((subnet) => ref(logical.get(subnet.id)!)) } },
    ServiceRegistries: [{ RegistryArn: getAtt(discovery, "Arn") }],
    Tags: tags(plan, entry),
  }, [logical.get(cluster.id)!, task, discovery, ingress, ...privateSubnets.map((subnet) => logical.get(subnet.id)!)]);
  addEcsServiceAutoscaling(resources, entry, id, logical.get(cluster.id)!);
}

function requiredArtifactImage(entry: ApplicationAwsPlanResource, options: ApplicationAwsTemplateOptions): string {
  const artifactId = stringConfig(entry, "artifactId");
  const image = options.artifactImageUris?.[artifactId];
  if (!image || !/^[^\s@]+@sha256:[a-f0-9]{64}$/u.test(image)) throw new Error(`AWS runtime artifact ${artifactId} requires an immutable image URI.`);
  return image;
}

function addCelldFleet(
  resources: Record<string, DeploymentJsonObject>,
  plan: ApplicationAwsDeploymentPlan,
  entry: ApplicationAwsPlanResource,
  id: string,
  logical: ReadonlyMap<string, string>,
  privateSubnets: readonly ApplicationAwsPlanResource[],
  applicationSecurityGroup: ApplicationAwsPlanResource,
  options: ApplicationAwsTemplateOptions,
): void {
  if (!options.celldWorkerImageUri?.trim()) throw new Error(`AWS celld fleet ${entry.id} requires an immutable celldWorkerImageUri.`);
  const stateId = stringConfig(entry, "stateBucketResourceId");
  const authorizationId = stringConfig(entry, "authorizationResourceId");
  const connectionSigningId = stringConfig(entry, "connectionSigningResourceId");
  const state = required(plan, stateId);
  const authorization = required(plan, authorizationId);
  const connectionSigning = required(plan, connectionSigningId);
  const cluster = required(plan, "foundation.compute");
  const logs = required(plan, "foundation.logs");
  const network = required(plan, "foundation.network");
  const port = numberConfig(entry, "port", 8080);
  const peerPort = numberConfig(entry, "peerPort", port + 1);
  const namespace = `${id}Namespace`;
  const discovery = `${id}Discovery`;
  const securityGroup = `${id}SecurityGroup`;
  const executionRole = `${id}ExecutionRole`;
  const runtimeRoleResourceId = optionalString(entry.configuration.runtimeRoleResourceId);
  const runtimeRole = runtimeRoleResourceId ? required(plan, runtimeRoleResourceId) : undefined;
  const generatedTaskRole = `${id}TaskRole`;
  const taskRole = runtimeRole ? logical.get(runtimeRole.id)! : generatedTaskRole;
  const task = `${id}TaskDefinition`;
  const deploymentTask = `${id}DeploymentTaskDefinition`;
  const namespaceName = internalDnsName(plan);
  const serviceName = boundedDnsLabel(entry.physicalName);
  const loadBalancer = plan.resources.find(({ service }) => service === "elastic-load-balancing");
  const applicationService = plan.resources.find(({ service, resourceType }) => service === "ecs" && resourceType === "fargate-service");
  const publicConnectionGateway = booleanConfig(entry, "publicConnectionGateway", false);
  const loadBalancerId = publicConnectionGateway && loadBalancer ? logical.get(loadBalancer.id) : undefined;
  const applicationServiceId = applicationService ? logical.get(applicationService.id) : undefined;
  if (publicConnectionGateway && (!loadBalancerId || !applicationServiceId)) {
    throw new Error(`AWS celld fleet ${entry.id} publishes realtime actor connections but has no application load balancer and ApplicationHost.`);
  }
  resources[namespace] = resource("AWS::ServiceDiscovery::PrivateDnsNamespace", {
    Name: namespaceName,
    Vpc: ref(logical.get(network.id)!),
    Description: `Private Applik8s actor and application discovery for ${plan.application}/${plan.environment}`,
    Tags: tags(plan, entry),
  }, [logical.get(network.id)!]);
  resources[discovery] = resource("AWS::ServiceDiscovery::Service", {
    Name: serviceName,
    NamespaceId: getAtt(namespace, "Id"),
    DnsConfig: { DnsRecords: [{ Type: "A", TTL: 10 }], RoutingPolicy: "MULTIVALUE" },
    HealthCheckCustomConfig: { FailureThreshold: 1 },
    Tags: tags(plan, entry),
  }, [namespace]);
  resources[securityGroup] = resource("AWS::EC2::SecurityGroup", {
    GroupDescription: `Private celld fleet for ${entry.physicalName}`,
    VpcId: ref(logical.get(network.id)!),
    SecurityGroupIngress: [
      { IpProtocol: "tcp", FromPort: port, ToPort: port, SourceSecurityGroupId: ref(logical.get(applicationSecurityGroup.id)!) },
      ...(loadBalancerId ? [{ IpProtocol: "tcp", FromPort: port, ToPort: port, SourceSecurityGroupId: ref(`${loadBalancerId}SecurityGroup`) }] : []),
      { IpProtocol: "tcp", FromPort: peerPort, ToPort: peerPort, SourceSecurityGroupId: ref(securityGroup) },
    ],
    SecurityGroupEgress: [{ IpProtocol: "-1", CidrIp: "0.0.0.0/0" }],
    Tags: tags(plan, entry),
  }, [logical.get(network.id)!, logical.get(applicationSecurityGroup.id)!]);
  resources[executionRole] = resource("AWS::IAM::Role", {
    AssumeRolePolicyDocument: assumeRolePolicy("ecs-tasks.amazonaws.com"),
    ManagedPolicyArns: ["arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"],
    Policies: [{ PolicyName: "applik8s-celld-runtime-secrets", PolicyDocument: { Version: "2012-10-17", Statement: [{
      Effect: "Allow",
      Action: ["secretsmanager:GetSecretValue"],
      Resource: [ref(logical.get(authorization.id)!), ref(logical.get(connectionSigning.id)!)],
    }] } }],
    Tags: tags(plan, entry),
  });
  if (!runtimeRole) {
    resources[generatedTaskRole] = resource("AWS::IAM::Role", {
      AssumeRolePolicyDocument: assumeRolePolicy("ecs-tasks.amazonaws.com"),
      Policies: [{ PolicyName: "celld-fleet-bucket", PolicyDocument: { Version: "2012-10-17", Statement: [{
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket", "s3:GetBucketLocation"],
        Resource: [getAtt(logical.get(state.id)!, "Arn"), { "Fn::Sub": [`${"${BucketArn}"}/*`, { BucketArn: getAtt(logical.get(state.id)!, "Arn") }] }],
      }] } }],
      Tags: tags(plan, entry),
    });
  }
  resources[deploymentTask] = resource("AWS::ECS::TaskDefinition", {
    Family: `${entry.physicalName}-deployment`,
    RequiresCompatibilities: ["FARGATE"],
    NetworkMode: "awsvpc",
    Cpu: "512",
    Memory: "1024",
    ExecutionRoleArn: getAtt(executionRole, "Arn"),
    TaskRoleArn: getAtt(taskRole, "Arn"),
    ContainerDefinitions: [{
      Name: "celld-worker-deployment",
      Image: options.celldWorkerImageUri,
      Essential: true,
      Environment: [
        { Name: "AWS_REGION", Value: plan.region },
        { Name: "CELLD_BUCKET", Value: { "Fn::Sub": [`s3://${"${Bucket}"}`, { Bucket: ref(logical.get(state.id)!) }] } },
        { Name: "APPLIK8S_ACTOR_APPLICATION_ENDPOINT", Value: stringConfig(entry, "applicationEndpoint") },
        { Name: "APPLIK8S_ACTOR_WORKER_REVISION", Value: stringConfig(entry, "workerProtocol") },
      ],
      Secrets: [
        { Name: "APPLIK8S_ACTOR_AUTHORIZATION", ValueFrom: ref(logical.get(authorization.id)!) },
        { Name: "APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION", ValueFrom: ref(logical.get(authorization.id)!) },
        { Name: "CELLD_VAR_APPLIK8S_ACTOR_CONNECTION_SIGNING_KEY", ValueFrom: ref(logical.get(connectionSigning.id)!) },
      ],
      LogConfiguration: { LogDriver: "awslogs", Options: { "awslogs-group": ref(logical.get(logs.id)!), "awslogs-region": plan.region, "awslogs-stream-prefix": "celld-deploy" } },
    }],
    Tags: tags(plan, entry),
  }, [executionRole, taskRole, logical.get(logs.id)!, logical.get(state.id)!, logical.get(authorization.id)!, logical.get(connectionSigning.id)!]);
  if (options.phase === "bootstrap") return;
  const advertised = `${serviceName}.${namespaceName}:${peerPort}`;
  resources[task] = resource("AWS::ECS::TaskDefinition", {
    Family: entry.physicalName,
    RequiresCompatibilities: ["FARGATE"],
    NetworkMode: "awsvpc",
    Cpu: "1024",
    Memory: "2048",
    ExecutionRoleArn: getAtt(executionRole, "Arn"),
    TaskRoleArn: getAtt(taskRole, "Arn"),
    ContainerDefinitions: [{
      Name: "celld",
      Image: stringConfig(entry, "image"),
      Essential: true,
      Command: ["--bucket", { "Fn::Sub": [`s3://${"${Bucket}"}`, { Bucket: ref(logical.get(state.id)!) }] }, "--region", plan.region, "--listen", `0.0.0.0:${port}`, "--internal-listen", `0.0.0.0:${peerPort}`, "--advertise", advertised],
      PortMappings: [{ ContainerPort: port, Protocol: "tcp" }, { ContainerPort: peerPort, Protocol: "tcp" }],
      Environment: [
        { Name: "AWS_REGION", Value: plan.region },
        { Name: "CELLD_WATCH", Value: "/tmp/celld" },
        { Name: "CELLD_VAR_APPLIK8S_ACTOR_APPLICATION_ENDPOINT", Value: stringConfig(entry, "applicationEndpoint") },
      ],
      Secrets: [
        { Name: "CELLD_VAR_APPLIK8S_ACTOR_AUTHORIZATION", ValueFrom: ref(logical.get(authorization.id)!) },
        { Name: "CELLD_VAR_APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION", ValueFrom: ref(logical.get(authorization.id)!) },
        { Name: "CELLD_VAR_APPLIK8S_ACTOR_CONNECTION_SIGNING_KEY", ValueFrom: ref(logical.get(connectionSigning.id)!) },
      ],
      LogConfiguration: { LogDriver: "awslogs", Options: { "awslogs-group": ref(logical.get(logs.id)!), "awslogs-region": plan.region, "awslogs-stream-prefix": "celld" } },
      HealthCheck: { Command: ["CMD-SHELL", `wget -q -O - http://127.0.0.1:${port}/healthz >/dev/null || exit 1`], Interval: 10, Timeout: 5, Retries: 12, StartPeriod: 60 },
    }],
    Tags: tags(plan, entry),
  }, [executionRole, taskRole, logical.get(logs.id)!, logical.get(state.id)!, logical.get(authorization.id)!, logical.get(connectionSigning.id)!]);
  const actorTargetGroup = `${id}PublicTargetGroup`;
  const actorListenerRule = `${id}PublicListenerRule`;
  if (loadBalancerId && applicationServiceId) {
    resources[actorTargetGroup] = resource("AWS::ElasticLoadBalancingV2::TargetGroup", {
      Name: `${entry.physicalName.slice(0, 25)}-${digest(`${entry.id}:actors`).slice(0, 6)}`,
      Port: port,
      Protocol: "HTTP",
      TargetType: "ip",
      VpcId: ref(logical.get(network.id)!),
      HealthCheckEnabled: true,
      HealthCheckPath: "/healthz",
      Matcher: { HttpCode: "200-399" },
      Tags: tags(plan, entry),
    });
    resources[actorListenerRule] = resource("AWS::ElasticLoadBalancingV2::ListenerRule", {
      ListenerArn: ref(`${applicationServiceId}Listener`),
      Priority: 10,
      Conditions: [{ Field: "path-pattern", PathPatternConfig: { Values: ["/__applik8s/v1/actors", "/__applik8s/v1/actors/*"] } }],
      Actions: [{ Type: "forward", TargetGroupArn: ref(actorTargetGroup) }],
    }, [`${applicationServiceId}Listener`, actorTargetGroup]);
  }
  resources[id] = resource("AWS::ECS::Service", {
    ServiceName: entry.physicalName,
    Cluster: ref(logical.get(cluster.id)!),
    TaskDefinition: ref(task),
    DesiredCount: numberConfig(entry, "desiredCount", 1),
    LaunchType: "FARGATE",
    EnableECSManagedTags: true,
    DeploymentConfiguration: { DeploymentCircuitBreaker: { Enable: true, Rollback: true }, MinimumHealthyPercent: 0, MaximumPercent: 100 },
    NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: "DISABLED", SecurityGroups: [ref(securityGroup)], Subnets: privateSubnets.map((subnet) => ref(logical.get(subnet.id)!)) } },
    ServiceRegistries: [{ RegistryArn: getAtt(discovery, "Arn") }],
    ...(loadBalancerId && applicationServiceId ? {
      LoadBalancers: [{ ContainerName: "celld", ContainerPort: port, TargetGroupArn: ref(actorTargetGroup) }],
      HealthCheckGracePeriodSeconds: 60,
    } : {}),
    Tags: tags(plan, entry),
  }, [logical.get(cluster.id)!, task, discovery, securityGroup, ...(loadBalancerId && applicationServiceId ? [actorListenerRule, actorTargetGroup] : []), ...privateSubnets.map((subnet) => logical.get(subnet.id)!)]);
}

export function applicationAwsStackName(plan: ApplicationAwsDeploymentPlan): string {
  const normalized = `${plan.application}-${plan.environment}`.toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/^-+|-+$/gu, "") || "applik8s";
  return normalized.length <= 128 ? normalized : `${normalized.slice(0, 115).replace(/-+$/gu, "")}-${digest(normalized).slice(0, 12)}`;
}

/** Stable CloudFormation output identity for one canonical AWS plan output. */
export function applicationAwsOutputKey(resourceId: string, outputName: string): string {
  return logicalId(`${resourceId}.${outputName}`);
}

export function directAwsResource(resource: ApplicationAwsPlanResource): boolean {
  return resource.service === "elasticache" || resource.service === "athena" || resource.service === "glue";
}

function addNetworkFoundation(resources: Record<string, DeploymentJsonObject>, plan: ApplicationAwsDeploymentPlan, entry: ApplicationAwsPlanResource, vpcId: string, logical: ReadonlyMap<string, string>, publicSubnets: readonly ApplicationAwsPlanResource[], privateSubnets: readonly ApplicationAwsPlanResource[]): void {
  const internetGateway = `${vpcId}InternetGateway`;
  const attachment = `${vpcId}InternetGatewayAttachment`;
  const routeTable = `${vpcId}PublicRouteTable`;
  resources[internetGateway] = resource("AWS::EC2::InternetGateway", { Tags: tags(plan, entry) });
  resources[attachment] = resource("AWS::EC2::VPCGatewayAttachment", { InternetGatewayId: ref(internetGateway), VpcId: ref(vpcId) }, [internetGateway, vpcId]);
  resources[routeTable] = resource("AWS::EC2::RouteTable", { VpcId: ref(vpcId), Tags: tags(plan, entry) }, [vpcId]);
  resources[`${vpcId}DefaultPublicRoute`] = resource("AWS::EC2::Route", { RouteTableId: ref(routeTable), DestinationCidrBlock: "0.0.0.0/0", GatewayId: ref(internetGateway) }, [attachment, routeTable]);
  for (const subnet of publicSubnets) {
    resources[`${logical.get(subnet.id)!}RouteAssociation`] = resource("AWS::EC2::SubnetRouteTableAssociation", { RouteTableId: ref(routeTable), SubnetId: ref(logical.get(subnet.id)!) }, [routeTable, logical.get(subnet.id)!]);
  }
  // Private Fargate tasks need outbound access for ECR pulls and external
  // providers. Use one NAT per availability zone so the production topology
  // does not make another zone's gateway a hidden availability dependency.
  for (const [index, subnet] of privateSubnets.entries()) {
    const publicSubnet = publicSubnets[index] ?? publicSubnets[0];
    if (!publicSubnet) throw new Error("AWS networking requires at least one public subnet for private egress.");
    const eip = `${vpcId}NatEip${index + 1}`;
    const nat = `${vpcId}NatGateway${index + 1}`;
    const privateRouteTable = `${vpcId}PrivateRouteTable${index + 1}`;
    const privateSubnetId = logical.get(subnet.id)!;
    resources[eip] = resource("AWS::EC2::EIP", { Domain: "vpc", Tags: tags(plan, entry) }, [attachment]);
    resources[nat] = resource("AWS::EC2::NatGateway", {
      AllocationId: getAtt(eip, "AllocationId"),
      SubnetId: ref(logical.get(publicSubnet.id)!),
      Tags: tags(plan, entry),
    }, [attachment, eip, logical.get(publicSubnet.id)!]);
    resources[privateRouteTable] = resource("AWS::EC2::RouteTable", { VpcId: ref(vpcId), Tags: tags(plan, entry) }, [vpcId]);
    resources[`${privateRouteTable}DefaultRoute`] = resource("AWS::EC2::Route", {
      RouteTableId: ref(privateRouteTable),
      DestinationCidrBlock: "0.0.0.0/0",
      NatGatewayId: ref(nat),
    }, [privateRouteTable, nat]);
    resources[`${privateSubnetId}RouteAssociation`] = resource("AWS::EC2::SubnetRouteTableAssociation", {
      RouteTableId: ref(privateRouteTable),
      SubnetId: ref(privateSubnetId),
    }, [privateRouteTable, privateSubnetId]);
  }
}

function addPublicSubnetRoute(_resources: Record<string, DeploymentJsonObject>, _entry: ApplicationAwsPlanResource, _id: string): void {
  // Associations are emitted with the network because CloudFormation accepts
  // forward references and this keeps one deterministic public route table.
}

function addPostgres(resources: Record<string, DeploymentJsonObject>, plan: ApplicationAwsDeploymentPlan, entry: ApplicationAwsPlanResource, id: string, logical: ReadonlyMap<string, string>, privateSubnets: readonly ApplicationAwsPlanResource[], securityGroup: ApplicationAwsPlanResource): void {
  const subnetGroup = `${id}SubnetGroup`;
  const credentialsResourceId = optionalString(entry.configuration.credentialsResourceId);
  const credentials = credentialsResourceId ? required(plan, credentialsResourceId) : undefined;
  const workflowEngineResourceId = optionalString(entry.configuration.workflowEngineResourceId);
  const databaseSecurityGroupId = workflowEngineResourceId
    ? `${logical.get(workflowEngineResourceId)!}SecurityGroup`
    : logical.get(securityGroup.id)!;
  resources[subnetGroup] = resource("AWS::RDS::DBSubnetGroup", {
    DBSubnetGroupDescription: `Applik8s private database subnets for ${entry.physicalName}`,
    SubnetIds: privateSubnets.map((subnet) => ref(logical.get(subnet.id)!)),
    Tags: tags(plan, entry),
  }, privateSubnets.map((subnet) => logical.get(subnet.id)!));
  resources[id] = resource("AWS::RDS::DBInstance", {
    DBInstanceIdentifier: entry.physicalName,
    Engine: "postgres",
    EngineVersion: stringConfig(entry, "engineVersion", "17"),
    DBInstanceClass: stringConfig(entry, "instanceClass", "db.t4g.micro"),
    AllocatedStorage: String(numberConfig(entry, "storageGiB", 20)),
    StorageEncrypted: booleanConfig(entry, "encrypted", true),
    MultiAZ: booleanConfig(entry, "multiAz", false),
    DeletionProtection: booleanConfig(entry, "deletionProtection", false),
    PubliclyAccessible: false,
    ...(optionalString(entry.configuration.databaseName) ? { DBName: stringConfig(entry, "databaseName") } : {}),
    MasterUsername: stringConfig(entry, "masterUsername", "applik8s"),
    ...(credentials
      ? {
          MasterUserPassword: {
            "Fn::Sub": [
              "{{resolve:secretsmanager:${CredentialSecret}:SecretString:password}}",
              { CredentialSecret: ref(logical.get(credentials.id)!) },
            ],
          },
        }
      : { ManageMasterUserPassword: true }),
    DBSubnetGroupName: ref(subnetGroup),
    VPCSecurityGroups: [ref(databaseSecurityGroupId)],
    BackupRetentionPeriod: plan.environment === "production" ? 7 : 1,
    Tags: tags(plan, entry),
  }, [subnetGroup, databaseSecurityGroupId, ...(credentials ? [logical.get(credentials.id)!] : [])], entry.lifecycle.deletion === "retain" ? "Snapshot" : undefined);
  if (workflowEngineResourceId) {
    resources[`${id}Ingress`] = resource("AWS::EC2::SecurityGroupIngress", {
      GroupId: ref(databaseSecurityGroupId),
      IpProtocol: "tcp",
      FromPort: 5432,
      ToPort: 5432,
      SourceSecurityGroupId: ref(databaseSecurityGroupId),
      Description: "Hatchet service access to its PostgreSQL authority",
    }, [databaseSecurityGroupId]);
  }
}

function addSharedFileSystem(
  resources: Record<string, DeploymentJsonObject>,
  plan: ApplicationAwsDeploymentPlan,
  entry: ApplicationAwsPlanResource,
  id: string,
  logical: ReadonlyMap<string, string>,
  privateSubnets: readonly ApplicationAwsPlanResource[],
  applicationSecurityGroup: ApplicationAwsPlanResource,
): void {
  const network = required(plan, "foundation.network");
  const workflowEngineResourceId = stringConfig(entry, "workflowEngineResourceId");
  const workflowEngineId = logical.get(workflowEngineResourceId);
  if (!workflowEngineId) throw new Error(`AWS filesystem ${entry.id} names unknown workflow engine ${workflowEngineResourceId}.`);
  const securityGroup = `${id}SecurityGroup`;
  resources[securityGroup] = resource("AWS::EC2::SecurityGroup", {
    GroupDescription: `Encrypted Hatchet configuration access for ${entry.physicalName}`,
    VpcId: ref(logical.get(network.id)!),
    SecurityGroupIngress: [
      { IpProtocol: "tcp", FromPort: 2049, ToPort: 2049, SourceSecurityGroupId: ref(`${workflowEngineId}SecurityGroup`) },
    ],
    SecurityGroupEgress: [{ IpProtocol: "-1", CidrIp: "0.0.0.0/0" }],
    Tags: tags(plan, entry),
  }, [logical.get(network.id)!, `${workflowEngineId}SecurityGroup`]);
  resources[id] = resource("AWS::EFS::FileSystem", {
    Encrypted: booleanConfig(entry, "encrypted", true),
    BackupPolicy: { Status: plan.environment === "production" ? "ENABLED" : "DISABLED" },
    LifecyclePolicies: [{ TransitionToIA: "AFTER_30_DAYS" }],
    PerformanceMode: "generalPurpose",
    ThroughputMode: "bursting",
    FileSystemTags: tags(plan, entry),
  }, undefined, entry.lifecycle.deletion === "retain" ? "Retain" : undefined);
  resources[`${id}AccessPoint`] = resource("AWS::EFS::AccessPoint", {
    FileSystemId: ref(id),
    PosixUser: { Uid: "1000", Gid: "1000" },
    RootDirectory: {
      Path: stringConfig(entry, "accessPointPath", "/hatchet-config"),
      CreationInfo: { OwnerUid: "1000", OwnerGid: "1000", Permissions: "0700" },
    },
    AccessPointTags: tags(plan, entry),
  }, [id]);
  for (const [index, subnet] of privateSubnets.entries()) {
    resources[`${id}MountTarget${index + 1}`] = resource("AWS::EFS::MountTarget", {
      FileSystemId: ref(id),
      SubnetId: ref(logical.get(subnet.id)!),
      SecurityGroups: [ref(securityGroup)],
    }, [id, securityGroup, logical.get(subnet.id)!]);
  }
}

function addHatchetService(
  resources: Record<string, DeploymentJsonObject>,
  plan: ApplicationAwsDeploymentPlan,
  entry: ApplicationAwsPlanResource,
  id: string,
  logical: ReadonlyMap<string, string>,
  privateSubnets: readonly ApplicationAwsPlanResource[],
  applicationSecurityGroup: ApplicationAwsPlanResource,
): void {
  const cluster = required(plan, "foundation.compute");
  const logs = required(plan, "foundation.logs");
  const network = required(plan, "foundation.network");
  const database = required(plan, stringConfig(entry, "databaseResourceId"));
  const credentials = required(plan, stringConfig(entry, "credentialsResourceId"));
  const filesystem = required(plan, stringConfig(entry, "configFilesystemResourceId"));
  const workerToken = required(plan, stringConfig(entry, "workerTokenResourceId"));
  const namespace = required(plan, stringConfig(entry, "discoveryNamespaceResourceId"));
  const image = stringConfig(entry, "image");
  if (!/^[^\s@]+@sha256:[a-f0-9]{64}$/u.test(image)) throw new Error(`AWS Hatchet service ${entry.id} requires an immutable image digest.`);
  const apiPort = numberConfig(entry, "apiPort", 8888);
  const grpcPort = numberConfig(entry, "grpcPort", 7077);
  const discoveryName = stringConfig(entry, "discoveryName");
  const namespaceName = stringConfig(namespace, "namespaceName");
  const securityGroup = `${id}SecurityGroup`;
  const executionRole = `${id}ExecutionRole`;
  const taskRole = `${id}TaskRole`;
  const task = `${id}TaskDefinition`;
  const discovery = `${id}Discovery`;
  const workerTokenTask = `${id}WorkerTokenTaskDefinition`;
  const workerTokenRole = `${id}WorkerTokenRole`;
  const filesystemId = logical.get(filesystem.id)!;
  const credentialSecret = logical.get(credentials.id)!;
  const workerTokenSecret = logical.get(workerToken.id)!;
  resources[securityGroup] = resource("AWS::EC2::SecurityGroup", {
    GroupDescription: `Private Hatchet workflow engine for ${entry.physicalName}`,
    VpcId: ref(logical.get(network.id)!),
    SecurityGroupIngress: [
      { IpProtocol: "tcp", FromPort: apiPort, ToPort: apiPort, SourceSecurityGroupId: ref(logical.get(applicationSecurityGroup.id)!) },
      { IpProtocol: "tcp", FromPort: grpcPort, ToPort: grpcPort, SourceSecurityGroupId: ref(logical.get(applicationSecurityGroup.id)!) },
      { IpProtocol: "tcp", FromPort: apiPort, ToPort: apiPort, SourceSecurityGroupId: ref(securityGroup) },
      { IpProtocol: "tcp", FromPort: grpcPort, ToPort: grpcPort, SourceSecurityGroupId: ref(securityGroup) },
    ],
    SecurityGroupEgress: [{ IpProtocol: "-1", CidrIp: "0.0.0.0/0" }],
    Tags: tags(plan, entry),
  }, [logical.get(network.id)!, logical.get(applicationSecurityGroup.id)!]);
  resources[executionRole] = resource("AWS::IAM::Role", {
    AssumeRolePolicyDocument: assumeRolePolicy("ecs-tasks.amazonaws.com"),
    ManagedPolicyArns: ["arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"],
    Policies: [{
      PolicyName: "applik8s-hatchet-database-credentials",
      PolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["secretsmanager:GetSecretValue"], Resource: [ref(credentialSecret)] }] },
    }],
    Tags: tags(plan, entry),
  });
  resources[taskRole] = resource("AWS::IAM::Role", {
    AssumeRolePolicyDocument: assumeRolePolicy("ecs-tasks.amazonaws.com"),
    Policies: [{ PolicyName: "applik8s-hatchet-no-aws-api", PolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Deny", Action: ["*"], Resource: ["*"] }] } }],
    Tags: tags(plan, entry),
  });
  resources[workerTokenRole] = resource("AWS::IAM::Role", {
    AssumeRolePolicyDocument: assumeRolePolicy("ecs-tasks.amazonaws.com"),
    Policies: [{
      PolicyName: "applik8s-publish-hatchet-worker-token",
      PolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["secretsmanager:PutSecretValue"], Resource: [ref(workerTokenSecret)] }] },
    }],
    Tags: tags(plan, entry),
  });
  resources[discovery] = resource("AWS::ServiceDiscovery::Service", {
    Name: discoveryName,
    NamespaceId: getAtt(logical.get(namespace.id)!, "Id"),
    DnsConfig: { DnsRecords: [{ Type: "A", TTL: 10 }], RoutingPolicy: "MULTIVALUE" },
    HealthCheckCustomConfig: { FailureThreshold: 1 },
    Tags: tags(plan, entry),
  }, [logical.get(namespace.id)!]);
  const credentialValue = (key: "username" | "password"): DeploymentJsonValue => ({ "Fn::Join": ["", [ref(credentialSecret), `:${key}::`]] });
  const logConfiguration = (prefix: string): DeploymentJsonObject => ({
    LogDriver: "awslogs",
    Options: { "awslogs-group": ref(logical.get(logs.id)!), "awslogs-region": plan.region, "awslogs-stream-prefix": prefix },
  });
  resources[task] = resource("AWS::ECS::TaskDefinition", {
    Family: entry.physicalName,
    RequiresCompatibilities: ["FARGATE"],
    NetworkMode: "awsvpc",
    Cpu: "1024",
    Memory: "2048",
    ExecutionRoleArn: getAtt(executionRole, "Arn"),
    TaskRoleArn: getAtt(taskRole, "Arn"),
    Volumes: [workflowConfigVolume(filesystemId)],
    ContainerDefinitions: [{
      Name: "hatchet",
      Image: image,
      Essential: true,
      EntryPoint: ["/bin/sh", "-ec"],
      Command: ['export DATABASE_URL="postgresql://${DATABASE_POSTGRES_USERNAME}:${DATABASE_POSTGRES_PASSWORD}@${DATABASE_POSTGRES_HOST}:${DATABASE_POSTGRES_PORT}/hatchet?sslmode=require"; exec ./hatchet-lite'],
      PortMappings: [{ ContainerPort: apiPort, Protocol: "tcp" }, { ContainerPort: grpcPort, Protocol: "tcp" }],
      Environment: [
        { Name: "DATABASE_POSTGRES_HOST", Value: getAtt(logical.get(database.id)!, "Endpoint.Address") },
        { Name: "DATABASE_POSTGRES_PORT", Value: getAtt(logical.get(database.id)!, "Endpoint.Port") },
        { Name: "DATABASE_POSTGRES_SSL_MODE", Value: "require" },
        { Name: "SERVER_AUTH_COOKIE_DOMAIN", Value: `${discoveryName}.${namespaceName}` },
        { Name: "SERVER_AUTH_COOKIE_INSECURE", Value: "t" },
        { Name: "SERVER_AUTH_SET_EMAIL_VERIFIED", Value: "t" },
        { Name: "SERVER_GRPC_BIND_ADDRESS", Value: "0.0.0.0" },
        { Name: "SERVER_GRPC_INSECURE", Value: "t" },
        { Name: "SERVER_GRPC_BROADCAST_ADDRESS", Value: `${discoveryName}.${namespaceName}:${grpcPort}` },
        { Name: "SERVER_GRPC_PORT", Value: String(grpcPort) },
        { Name: "SERVER_INTERNAL_CLIENT_INTERNAL_GRPC_BROADCAST_ADDRESS", Value: `127.0.0.1:${grpcPort}` },
        { Name: "SERVER_MSGQUEUE_KIND", Value: "postgres" },
        { Name: "SERVER_URL", Value: `http://${discoveryName}.${namespaceName}:${apiPort}` },
      ],
      Secrets: [
        { Name: "DATABASE_POSTGRES_USERNAME", ValueFrom: credentialValue("username") },
        { Name: "DATABASE_POSTGRES_PASSWORD", ValueFrom: credentialValue("password") },
      ],
      MountPoints: [{ SourceVolume: "hatchet-config", ContainerPath: "/config", ReadOnly: false }],
      LogConfiguration: logConfiguration("hatchet"),
    }],
    Tags: tags(plan, entry),
  }, [executionRole, taskRole, logical.get(database.id)!, filesystemId, `${filesystemId}AccessPoint`, logical.get(logs.id)!]);
  resources[id] = resource("AWS::ECS::Service", {
    ServiceName: entry.physicalName,
    Cluster: ref(logical.get(cluster.id)!),
    TaskDefinition: ref(task),
    DesiredCount: numberConfig(entry, "desiredCount", 1),
    LaunchType: "FARGATE",
    EnableECSManagedTags: true,
    DeploymentConfiguration: { DeploymentCircuitBreaker: { Enable: true, Rollback: true }, MinimumHealthyPercent: 100, MaximumPercent: 200 },
    NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: "DISABLED", SecurityGroups: [ref(securityGroup)], Subnets: privateSubnets.map((subnet) => ref(logical.get(subnet.id)!)) } },
    ServiceRegistries: [{ RegistryArn: getAtt(discovery, "Arn") }],
    Tags: tags(plan, entry),
  }, [logical.get(cluster.id)!, task, discovery, securityGroup, ...privateSubnets.map((subnet) => logical.get(subnet.id)!), ...privateSubnets.map((_, index) => `${filesystemId}MountTarget${index + 1}`)]);
  const awsCliImage = "public.ecr.aws/aws-cli/aws-cli@sha256:cd2b1ed9b2181b2b8341f6584ec019b117cc13d3ec142a244d8908e1bb8ea487";
  resources[workerTokenTask] = resource("AWS::ECS::TaskDefinition", {
    Family: `${entry.physicalName}-worker-token`,
    RequiresCompatibilities: ["FARGATE"],
    NetworkMode: "awsvpc",
    Cpu: "512",
    Memory: "1024",
    ExecutionRoleArn: getAtt(executionRole, "Arn"),
    TaskRoleArn: getAtt(workerTokenRole, "Arn"),
    Volumes: [workflowConfigVolume(filesystemId), { Name: "token-output" }],
    ContainerDefinitions: [
      {
        Name: "issue-token",
        Image: image,
        Essential: true,
        EntryPoint: ["/bin/sh", "-ec"],
        Command: [`set -eu; umask 077; until token="$(./hatchet-admin token create --config /config --tenant-id ${stringConfig(entry, "tenantId")} 2>/dev/null)"; do sleep 2; done; test -n "${'$'}token"; printf %s "${'$'}token" > /bootstrap/token`],
        MountPoints: [
          { SourceVolume: "hatchet-config", ContainerPath: "/config", ReadOnly: true },
          { SourceVolume: "token-output", ContainerPath: "/bootstrap", ReadOnly: false },
        ],
        LogConfiguration: logConfiguration("hatchet-token-issuer"),
      },
      {
        Name: "publish-token",
        Image: awsCliImage,
        Essential: true,
        EntryPoint: ["/bin/sh", "-ec"],
        Command: ['test -s /bootstrap/token; aws secretsmanager put-secret-value --secret-id "$WORKER_TOKEN_SECRET_ARN" --secret-string file:///bootstrap/token >/dev/null'],
        DependsOn: [{ ContainerName: "issue-token", Condition: "SUCCESS" }],
        Environment: [
          { Name: "AWS_REGION", Value: plan.region },
          { Name: "WORKER_TOKEN_SECRET_ARN", Value: ref(workerTokenSecret) },
        ],
        MountPoints: [{ SourceVolume: "token-output", ContainerPath: "/bootstrap", ReadOnly: true }],
        LogConfiguration: logConfiguration("hatchet-token-publisher"),
      },
    ],
    Tags: tags(plan, entry),
  }, [executionRole, workerTokenRole, filesystemId, `${filesystemId}AccessPoint`, workerTokenSecret, logical.get(logs.id)!]);
}

function workflowConfigVolume(filesystemId: string): DeploymentJsonObject {
  return {
    Name: "hatchet-config",
    EFSVolumeConfiguration: {
      FilesystemId: ref(filesystemId),
      TransitEncryption: "ENABLED",
      AuthorizationConfig: { AccessPointId: ref(`${filesystemId}AccessPoint`), IAM: "DISABLED" },
    },
  };
}

function addSchedule(resources: Record<string, DeploymentJsonObject>, plan: ApplicationAwsDeploymentPlan, entry: ApplicationAwsPlanResource, id: string, logical: ReadonlyMap<string, string>): void {
  const group = required(plan, "scheduler.group");
  const queue = required(plan, "scheduler.admission");
  const deadLetter = required(plan, "scheduler.dead-letter");
  const role = required(plan, "scheduler.execution-role");
  resources[id] = resource("AWS::Scheduler::Schedule", {
    Name: entry.physicalName,
    GroupName: ref(logical.get(group.id)!),
    FlexibleTimeWindow: { Mode: "OFF" },
    ScheduleExpression: stringConfig(entry, "expression"),
    ScheduleExpressionTimezone: stringConfig(entry, "timezone", "UTC"),
    State: "ENABLED",
    Target: {
      Arn: getAtt(logical.get(queue.id)!, "Arn"),
      RoleArn: getAtt(logical.get(role.id)!, "Arn"),
      Input: JSON.stringify({
        schemaVersion: "applik8s.scheduleAdmission/v1alpha1",
        definitionId: stringConfig(entry, "definitionId"),
        instanceId: "fixed",
        overlap: stringConfig(entry, "overlap", "skip"),
        overlapKey: "fixed",
        scheduledAt: "<aws.scheduler.scheduled-time>",
        schedulerExecutionId: "<aws.scheduler.execution-id>",
        schedulerAttempt: "<aws.scheduler.attempt-number>",
      }),
      DeadLetterConfig: { Arn: getAtt(logical.get(deadLetter.id)!, "Arn") },
      RetryPolicy: {
        MaximumEventAgeInSeconds: numberConfig(entry, "maximumEventAgeSeconds", 21_600),
        MaximumRetryAttempts: numberConfig(entry, "maximumRetryAttempts", 4),
      },
    },
  }, [logical.get(group.id)!, logical.get(queue.id)!, logical.get(deadLetter.id)!, logical.get(role.id)!]);
}

function addCertificate(resources: Record<string, DeploymentJsonObject>, plan: ApplicationAwsDeploymentPlan, entry: ApplicationAwsPlanResource, id: string): void {
  const domainName = optionalString(entry.configuration.domainName);
  const validationOptions = arrayObjects(entry.configuration.domainValidationOptions)
    .map((option) => ({ DomainName: optionalString(option.domainName), HostedZoneId: optionalString(option.hostedZoneId) }))
    .filter((option): option is { readonly DomainName: string; readonly HostedZoneId: string } => Boolean(option.DomainName && option.HostedZoneId));
  if (!domainName || validationOptions.length === 0) throw new Error(`AWS certificate ${entry.id} requires domainName and complete domainValidationOptions.`);
  resources[id] = resource("AWS::CertificateManager::Certificate", {
    DomainName: domainName,
    ValidationMethod: "DNS",
    ...(arrayStrings(entry.configuration.subjectAlternativeNames).length > 0 ? { SubjectAlternativeNames: arrayStrings(entry.configuration.subjectAlternativeNames) } : {}),
    DomainValidationOptions: validationOptions,
    Tags: tags(plan, entry),
  });
}

function addDnsRecord(resources: Record<string, DeploymentJsonObject>, plan: ApplicationAwsDeploymentPlan, entry: ApplicationAwsPlanResource, id: string, logical: ReadonlyMap<string, string>): void {
  const recordName = optionalString(entry.configuration.recordName);
  const hostedZoneId = optionalString(entry.configuration.hostedZoneId);
  const loadBalancerResourceId = optionalString(entry.configuration.loadBalancerResourceId);
  const loadBalancer = loadBalancerResourceId
    ? plan.resources.find(({ id }) => id === loadBalancerResourceId)
    : plan.resources.find(({ service }) => service === "elastic-load-balancing");
  if (!recordName || !hostedZoneId || !loadBalancer) throw new Error(`AWS DNS publication ${entry.id} requires recordName, hostedZoneId, and a planned load balancer.`);
  resources[id] = resource("AWS::Route53::RecordSet", {
    HostedZoneId: hostedZoneId,
    Name: recordName,
    Type: "A",
    AliasTarget: {
      DNSName: getAtt(logical.get(loadBalancer.id)!, "DNSName"),
      HostedZoneId: getAtt(logical.get(loadBalancer.id)!, "CanonicalHostedZoneID"),
    },
  }, [logical.get(loadBalancer.id)!]);
}

function addApplicationService(resources: Record<string, DeploymentJsonObject>, plan: ApplicationAwsDeploymentPlan, entry: ApplicationAwsPlanResource, id: string, logical: ReadonlyMap<string, string>, privateSubnets: readonly ApplicationAwsPlanResource[], securityGroup: ApplicationAwsPlanResource, options: ApplicationAwsTemplateOptions): void {
  if (!options.imageUri?.trim()) throw new Error(`AWS application host ${entry.id} requires an immutable imageUri.`);
  const cluster = required(plan, "foundation.compute");
  const logs = required(plan, "foundation.logs");
  const executionRole = `${id}ExecutionRole`;
  const generatedTaskRole = `${id}TaskRole`;
  const task = `${id}TaskDefinition`;
  const runtimeRoleResourceId = optionalString(entry.configuration.runtimeRoleResourceId);
  const runtimeRole = runtimeRoleResourceId ? required(plan, runtimeRoleResourceId) : undefined;
  const loadBalancer = plan.resources.find(({ service }) => service === "elastic-load-balancing");
  const certificates = plan.resources.filter(({ service, resourceType }) => service === "acm" && resourceType === "certificate");
  const port = numberConfig(entry, "port", 3000);
  const actorFleet = plan.resources.find(({ service, resourceType }) => service === "ecs" && resourceType === "celld-fleet");
  const actorFleetId = actorFleet ? logical.get(actorFleet.id)! : undefined;
  const applicationDiscovery = actorFleet ? `${id}Discovery` : undefined;
  if (actorFleet && applicationDiscovery && actorFleetId) {
    resources[applicationDiscovery] = resource("AWS::ServiceDiscovery::Service", {
      Name: boundedDnsLabel(entry.physicalName),
      NamespaceId: getAtt(`${actorFleetId}Namespace`, "Id"),
      DnsConfig: { DnsRecords: [{ Type: "A", TTL: 10 }], RoutingPolicy: "MULTIVALUE" },
      HealthCheckCustomConfig: { FailureThreshold: 1 },
      Tags: tags(plan, entry),
    }, [`${actorFleetId}Namespace`]);
    resources[`${id}IngressFromCelld`] = resource("AWS::EC2::SecurityGroupIngress", {
      GroupId: ref(logical.get(securityGroup.id)!),
      IpProtocol: "tcp",
      FromPort: port,
      ToPort: port,
      SourceSecurityGroupId: ref(`${actorFleetId}SecurityGroup`),
    }, [logical.get(securityGroup.id)!, `${actorFleetId}SecurityGroup`]);
  }
  resources[executionRole] = resource("AWS::IAM::Role", {
    AssumeRolePolicyDocument: assumeRolePolicy("ecs-tasks.amazonaws.com"),
    ManagedPolicyArns: ["arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"],
    Policies: [{
      PolicyName: "applik8s-runtime-secrets",
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: secretResourceArns(plan, logical, entry).length > 0
          ? [{ Effect: "Allow", Action: ["secretsmanager:GetSecretValue"], Resource: secretResourceArns(plan, logical, entry) }]
          : [{ Effect: "Deny", Action: ["secretsmanager:GetSecretValue"], Resource: ["*"] }],
      },
    }],
    Tags: tags(plan, entry),
  });
  if (!runtimeRole) {
    resources[generatedTaskRole] = resource("AWS::IAM::Role", {
      AssumeRolePolicyDocument: assumeRolePolicy("ecs-tasks.amazonaws.com"),
      Policies: [{ PolicyName: "applik8s-no-runtime-access", PolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Deny", Action: ["*"], Resource: ["*"] }] } }],
      Tags: tags(plan, entry),
    });
  }
  const taskRoleArn = runtimeRole ? getAtt(logical.get(runtimeRole.id)!, "Arn") : getAtt(generatedTaskRole, "Arn");
  resources[task] = resource("AWS::ECS::TaskDefinition", {
    Family: entry.physicalName,
    RequiresCompatibilities: ["FARGATE"],
    NetworkMode: "awsvpc",
    Cpu: "512",
    Memory: "1024",
    ExecutionRoleArn: getAtt(executionRole, "Arn"),
    TaskRoleArn: taskRoleArn,
    ContainerDefinitions: [{
      Name: "application",
      Image: options.imageUri,
      Essential: true,
      PortMappings: [{ ContainerPort: port, Protocol: "tcp" }],
      Environment: applicationEnvironment(plan, logical, options.directOutputs, entry),
      Secrets: applicationSecrets(plan, logical, entry),
      LogConfiguration: { LogDriver: "awslogs", Options: { "awslogs-group": ref(logical.get(logs.id)!), "awslogs-region": plan.region, "awslogs-stream-prefix": "application" } },
      HealthCheck: { Command: ["CMD-SHELL", `wget -q -O - http://127.0.0.1:${port}${stringConfig(entry, "healthPath", "/-/healthz")} >/dev/null || exit 1`], Interval: 10, Timeout: 5, Retries: 6, StartPeriod: 30 },
    }, ...otelSidecarDefinitions(plan, logical, entry)],
    Tags: tags(plan, entry),
  }, [executionRole, ...(runtimeRole ? [logical.get(runtimeRole.id)!] : [generatedTaskRole]), logical.get(logs.id)!]);
  const dependencies = [logical.get(cluster.id)!, task, logical.get(securityGroup.id)!, ...privateSubnets.map((subnet) => logical.get(subnet.id)!)];
  const loadBalancers: DeploymentJsonObject[] = [];
  if (loadBalancer) {
    const loadBalancerId = logical.get(loadBalancer.id)!;
    const targetGroup = `${id}TargetGroup`;
    const listener = `${id}Listener`;
    resources[targetGroup] = resource("AWS::ElasticLoadBalancingV2::TargetGroup", {
      Name: `${entry.physicalName.slice(0, 25)}-${digest(entry.id).slice(0, 6)}`,
      Port: port,
      Protocol: "HTTP",
      TargetType: "ip",
      VpcId: ref(logical.get(required(plan, "foundation.network").id)!),
      HealthCheckEnabled: true,
      HealthCheckPath: stringConfig(entry, "healthPath", "/-/healthz"),
      Matcher: { HttpCode: "200-399" },
      Tags: tags(plan, entry),
    });
    const certificateArns = certificates.map((certificate) => ({ CertificateArn: ref(logical.get(certificate.id)!) }));
    resources[listener] = resource("AWS::ElasticLoadBalancingV2::Listener", {
      LoadBalancerArn: ref(loadBalancerId),
      Port: certificateArns.length > 0 ? 443 : 80,
      Protocol: certificateArns.length > 0 ? "HTTPS" : "HTTP",
      ...(certificateArns.length > 0 ? { Certificates: certificateArns } : {}),
      DefaultActions: [{ Type: "forward", TargetGroupArn: ref(targetGroup) }],
    }, [loadBalancerId, targetGroup, ...certificates.map((certificate) => logical.get(certificate.id)!)]);
    resources[`${id}IngressFromLoadBalancer`] = resource("AWS::EC2::SecurityGroupIngress", {
      GroupId: ref(logical.get(securityGroup.id)!),
      IpProtocol: "tcp",
      FromPort: port,
      ToPort: port,
      SourceSecurityGroupId: ref(`${loadBalancerId}SecurityGroup`),
    }, [logical.get(securityGroup.id)!, `${loadBalancerId}SecurityGroup`]);
    loadBalancers.push({ ContainerName: "application", ContainerPort: port, TargetGroupArn: ref(targetGroup) });
    dependencies.push(listener, targetGroup);
  }
  resources[id] = resource("AWS::ECS::Service", {
    ServiceName: entry.physicalName,
    Cluster: ref(logical.get(cluster.id)!),
    TaskDefinition: ref(task),
    DesiredCount: numberConfig(entry, "desiredCount", 1),
    LaunchType: "FARGATE",
    EnableECSManagedTags: true,
    DeploymentConfiguration: { DeploymentCircuitBreaker: { Enable: true, Rollback: true }, MinimumHealthyPercent: 100, MaximumPercent: 200 },
    NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: "DISABLED", SecurityGroups: [ref(logical.get(securityGroup.id)!)], Subnets: privateSubnets.map((subnet) => ref(logical.get(subnet.id)!)) } },
    ...(applicationDiscovery ? { ServiceRegistries: [{ RegistryArn: getAtt(applicationDiscovery, "Arn") }] } : {}),
    ...(loadBalancers.length ? { LoadBalancers: loadBalancers, HealthCheckGracePeriodSeconds: 60 } : {}),
    Tags: tags(plan, entry),
  }, dependencies);
  addEcsServiceAutoscaling(resources, entry, id, logical.get(cluster.id)!);
}

function addEcsServiceAutoscaling(
  resources: Record<string, DeploymentJsonObject>,
  entry: ApplicationAwsPlanResource,
  serviceLogicalId: string,
  clusterLogicalId: string,
): void {
  const desiredCount = numberConfig(entry, "desiredCount", 1);
  const minimum = numberConfig(entry, "autoscalingMinCapacity", desiredCount);
  const maximum = numberConfig(
    entry,
    "autoscalingMaxCapacity",
    Math.max(4, desiredCount * 4),
  );
  const targetCpu = numberConfig(
    entry,
    "autoscalingTargetCpuUtilization",
    60,
  );
  if (minimum < 0 || maximum < minimum || targetCpu <= 0 || targetCpu > 100) {
    throw new Error(
      `AWS ECS autoscaling for ${entry.id} requires 0 <= min <= max and target CPU in 1..100.`,
    );
  }
  const target = `${serviceLogicalId}ScalingTarget`;
  const policy = `${serviceLogicalId}CpuScalingPolicy`;
  resources[target] = resource(
    "AWS::ApplicationAutoScaling::ScalableTarget",
    {
      ServiceNamespace: "ecs",
      ScalableDimension: "ecs:service:DesiredCount",
      MinCapacity: minimum,
      MaxCapacity: maximum,
      ResourceId: {
        "Fn::Join": [
          "",
          [
            "service/",
            ref(clusterLogicalId),
            "/",
            getAtt(serviceLogicalId, "Name"),
          ],
        ],
      },
    },
    [serviceLogicalId, clusterLogicalId],
  );
  resources[policy] = resource(
    "AWS::ApplicationAutoScaling::ScalingPolicy",
    {
      PolicyName: `${entry.physicalName}-cpu`,
      PolicyType: "TargetTrackingScaling",
      ScalingTargetId: ref(target),
      TargetTrackingScalingPolicyConfiguration: {
        PredefinedMetricSpecification: {
          PredefinedMetricType: "ECSServiceAverageCPUUtilization",
        },
        TargetValue: targetCpu,
        ScaleInCooldown: 60,
        ScaleOutCooldown: 30,
      },
    },
    [target],
  );
}

function applicationEnvironment(
  plan: ApplicationAwsDeploymentPlan,
  logical: ReadonlyMap<string, string>,
  directOutputs: ApplicationAwsTemplateOptions["directOutputs"],
  workload?: ApplicationAwsPlanResource,
): readonly DeploymentJsonObject[] {
  const result: DeploymentJsonObject[] = [
    { Name: "APPLIK8S_DEPLOYMENT_TARGET", Value: "aws" },
    { Name: "APPLIK8S_APPLICATION_NAME", Value: plan.application },
    { Name: "APPLIK8S_ENVIRONMENT_ID", Value: plan.environment },
    { Name: "AWS_REGION", Value: plan.region },
  ];
  if (workload?.resourceType === "fargate-worker" && workload.configuration.eventTransport === "kinesis") {
    const stream = required(plan, stringConfig(workload, "eventStreamResourceId"));
    const checkpoint = required(plan, stringConfig(workload, "checkpointTableResourceId"));
    result.push(
      { Name: "APPLIK8S_EVENT_TRANSPORT", Value: "kinesis" },
      { Name: "APPLIK8S_KINESIS_STREAM", Value: ref(logical.get(stream.id)!) },
      { Name: "APPLIK8S_KINESIS_CHECKPOINT_TABLE", Value: ref(logical.get(checkpoint.id)!) },
      { Name: "APPLIK8S_KINESIS_CONSUMER", Value: stringConfig(workload, "consumer") },
      { Name: "APPLIK8S_PROCESSOR_CONCURRENCY", Value: String(numberConfig(workload, "processorConcurrency", 1)) },
      ...(stringConfig(workload, "databaseEnvironmentName")
        ? [{ Name: "APPLIK8S_DATABASE_URL_BINDING", Value: stringConfig(workload, "databaseEnvironmentName") }]
        : []),
    );
  } else if (workload?.resourceType === "fargate-service") {
    const streamIds = new Set(arrayConfig(workload, "eventStreamResourceIds").filter((value): value is string => typeof value === "string"));
    const streams = plan.resources.filter(({ id, service, resourceType }) => streamIds.has(id) && service === "kinesis" && resourceType === "stream");
    if (streams.length === 1) {
      result.push(
        { Name: "APPLIK8S_EVENT_TRANSPORT", Value: "kinesis" },
        { Name: "APPLIK8S_KINESIS_STREAM", Value: ref(logical.get(streams[0]!.id)!) },
      );
    }
  }
  const runtimeBindingEnvironmentNames = new Set(arrayConfig(workload ?? emptyAwsPlanResource, "runtimeBindingEnvironmentNames").filter((value): value is string => typeof value === "string"));
  const runtimeBindings = plan.runtimeBindings.filter(({ environmentName }) => runtimeBindingEnvironmentNames.has(environmentName));
  if (runtimeBindings.length > 0) {
    result.push({ Name: "NODE_OPTIONS", Value: "--import=@applik8s/runtime-aws/bootstrap" });
    for (const [index, binding] of runtimeBindings.entries()) {
      const resource = plan.resources.find(({ id }) => id === binding.resourceId);
      const id = logical.get(binding.resourceId);
      if (!resource || !id || resource.service !== "rds") throw new Error(`AWS runtime binding ${binding.id} does not resolve to an RDS resource.`);
      result.push({
        Name: `APPLIK8S_AWS_RUNTIME_BINDING_${index}`,
        Value: { "Fn::Join": ["", [
          `{"kind":"postgresUrl","environmentName":${JSON.stringify(binding.environmentName)},"database":${JSON.stringify(binding.database)},"host":"`,
          getAtt(id, "Endpoint.Address"),
          `","port":`,
          getAtt(id, "Endpoint.Port"),
          `,"secretArn":"`,
          getAtt(id, "MasterUserSecret.SecretArn"),
          `"}`,
        ]] },
      });
    }
  }
  for (const binding of arrayConfig(workload ?? emptyAwsPlanResource, "runtimeEndpointBindings")) {
    const endpoint = binding && typeof binding === "object" && !Array.isArray(binding)
      ? binding as DeploymentJsonObject
      : undefined;
    if (!endpoint) throw new Error(`AWS runtime endpoint binding ${JSON.stringify(binding)} is not an object.`);
    const environmentName = typeof endpoint.environmentName === "string" ? endpoint.environmentName : undefined;
    const resourceId = typeof endpoint.resourceId === "string" ? endpoint.resourceId : undefined;
    const target = resourceId ? plan.resources.find(({ id }) => id === resourceId) : undefined;
    if (!environmentName || !target || target.service !== "ecs" || target.resourceType !== "fargate-runtime-service") {
      throw new Error(`AWS runtime endpoint binding ${JSON.stringify(binding)} does not resolve to one generated runtime service.`);
    }
    result.push({ Name: environmentName, Value: stringConfig(target, "endpoint") });
  }
  const observabilityIds = new Set(arrayConfig(workload ?? emptyAwsPlanResource, "observabilityResourceIds").filter((value): value is string => typeof value === "string"));
  if (plan.resources.some(({ id, service, resourceType }) => observabilityIds.has(id) && service === "cloudwatch" && resourceType === "otel-collector")) {
    result.push(
      { Name: "OTEL_SERVICE_NAME", Value: plan.application },
      { Name: "OTEL_RESOURCE_ATTRIBUTES", Value: `deployment.environment.name=${plan.environment},service.namespace=applik8s` },
      { Name: "OTEL_EXPORTER_OTLP_ENDPOINT", Value: "http://127.0.0.1:4318" },
    );
  }
  const scheduleQueue = plan.resources.find(({ id }) => id === "scheduler.admission");
  const scheduleGroup = plan.resources.find(({ id }) => id === "scheduler.group");
  if (scheduleQueue && scheduleGroup && workload?.configuration.scheduleAccess === true) {
    result.push(
      { Name: "APPLIK8S_AWS_SCHEDULE_QUEUE_URL", Value: ref(logical.get(scheduleQueue.id)!) },
      { Name: "APPLIK8S_AWS_SCHEDULE_QUEUE_ARN", Value: getAtt(logical.get(scheduleQueue.id)!, "Arn") },
      { Name: "APPLIK8S_AWS_SCHEDULE_DLQ_ARN", Value: getAtt(logical.get("scheduler.dead-letter")!, "Arn") },
      { Name: "APPLIK8S_AWS_SCHEDULE_GROUP", Value: ref(logical.get(scheduleGroup.id)!) },
      { Name: "APPLIK8S_AWS_SCHEDULE_ROLE_ARN", Value: getAtt(logical.get("scheduler.execution-role")!, "Arn") },
    );
  }
  const actorRuntimeIds = new Set(arrayConfig(workload ?? emptyAwsPlanResource, "actorRuntimeResourceIds").filter((value): value is string => typeof value === "string"));
  const actorFleet = plan.resources.find(({ id, service, resourceType }) => actorRuntimeIds.has(id) && service === "ecs" && resourceType === "celld-fleet");
  if (actorFleet) {
    result.push({ Name: "APPLIK8S_ACTOR_ENDPOINT", Value: celldEndpoint(plan, actorFleet) });
    const applicationEndpoint = actorFleet.configuration.applicationEndpoint;
    if (typeof applicationEndpoint === "string" && applicationEndpoint.trim()) {
      result.push({ Name: "APPLIK8S_ACTOR_APPLICATION_ENDPOINT", Value: applicationEndpoint });
    }
  }
  const workflowEngineIds = new Set(arrayConfig(workload ?? emptyAwsPlanResource, "workflowEngineResourceIds").filter((value): value is string => typeof value === "string"));
  const workflowEngines = plan.resources.filter(({ id, service, resourceType }) => workflowEngineIds.has(id) && service === "ecs" && resourceType === "hatchet-service");
  if (workflowEngines.length > 1) throw new Error(`AWS workload ${workload?.id ?? "unknown"} resolves to multiple WorkflowEngine authorities.`);
  const workflowEngine = workflowEngines[0];
  if (workflowEngine) {
    const namespace = required(plan, stringConfig(workflowEngine, "discoveryNamespaceResourceId"));
    const host = `${stringConfig(workflowEngine, "discoveryName")}.${stringConfig(namespace, "namespaceName")}`;
    result.push(
      { Name: "HATCHET_CLIENT_HOST_PORT", Value: `${host}:${numberConfig(workflowEngine, "grpcPort", 7077)}` },
      { Name: "HATCHET_CLIENT_API_URL", Value: `http://${host}:${numberConfig(workflowEngine, "apiPort", 8888)}` },
      { Name: "HATCHET_CLIENT_TLS_STRATEGY", Value: "none" },
    );
  }
  const lakehouseBindings = applicationAwsLakehouseBindings(plan, arrayConfig(workload ?? emptyAwsPlanResource, "lakehouseResourceIds").filter((value): value is string => typeof value === "string"));
  if (lakehouseBindings) result.push({ Name: "APPLIK8S_AWS_LAKEHOUSE_BINDINGS", Value: JSON.stringify(lakehouseBindings) });
  const publicOutputIds = new Set(arrayConfig(workload ?? emptyAwsPlanResource, "runtimePublicOutputResourceIds").filter((value): value is string => typeof value === "string"));
  const ordinaryObjectStores = plan.resources.filter(({ id, service, resourceType, configuration }) =>
    publicOutputIds.has(id)
    && service === "s3"
    && resourceType === "bucket"
    && configuration.purpose !== "athena-query-results"
    && configuration.authority !== "celld-fleet");
  if (ordinaryObjectStores.length === 1) {
    result.push(...objectStorageEnvironment(ordinaryObjectStores[0]!, logical, "APPLIK8S_OBJECT_STORAGE"));
  }
  for (const binding of arrayConfig(workload ?? emptyAwsPlanResource, "objectStorageBindings")) {
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new Error(`AWS workload object storage binding ${JSON.stringify(binding)} is invalid.`);
    const objectBinding = binding as DeploymentJsonObject;
    const purpose = typeof objectBinding.purpose === "string" ? objectBinding.purpose : undefined;
    const resourceId = typeof objectBinding.resourceId === "string" ? objectBinding.resourceId : undefined;
    const resource = resourceId ? plan.resources.find(({ id }) => id === resourceId) : undefined;
    if (!resource || resource.service !== "s3" || resource.resourceType !== "bucket" || (purpose !== "task" && purpose !== "rebuild")) {
      throw new Error(`AWS workload object storage binding ${JSON.stringify(binding)} does not resolve to one ordinary S3 store.`);
    }
    result.push(...objectStorageEnvironment(resource, logical, purpose === "task" ? "APPLIK8S_TASK_OBJECT" : "APPLIK8S_REBUILD_OBJECT"));
  }
  for (const resource of plan.resources.filter(({ id, semanticNodeId }) => publicOutputIds.has(id) && semanticNodeId)) {
    const values = directOutputs?.[resource.id];
    for (const output of resource.outputs.filter(({ sensitivity }) => sensitivity === "public")) {
      const value = values?.[output.name];
      const native = directAwsResource(resource) ? undefined : outputValue(resource, output.name, logical.get(resource.id)!);
      if (value === undefined && native === undefined) continue;
      result.push({ Name: `APPLIK8S_${resource.semanticNodeId!.replace(/[^A-Za-z0-9]+/gu, "_").toUpperCase()}_${output.name.replace(/[^A-Za-z0-9]+/gu, "_").toUpperCase()}`, Value: value === undefined ? native! : String(value) });
    }
  }
  return result;
}

function objectStorageEnvironment(
  resource: ApplicationAwsPlanResource,
  logical: ReadonlyMap<string, string>,
  prefix: "APPLIK8S_OBJECT_STORAGE" | "APPLIK8S_TASK_OBJECT" | "APPLIK8S_REBUILD_OBJECT",
): readonly DeploymentJsonObject[] {
  const id = logical.get(resource.id);
  if (!id) throw new Error(`AWS object store ${resource.id} has no CloudFormation identity.`);
  return [
    ...(prefix === "APPLIK8S_OBJECT_STORAGE" ? [{ Name: `${prefix}_ENABLED`, Value: "true" }] : []),
    { Name: `${prefix}_BUCKET`, Value: ref(id) },
    { Name: `${prefix}_REGION`, Value: { Ref: "AWS::Region" } },
    { Name: `${prefix}_PREFIX`, Value: typeof resource.configuration.prefix === "string" ? resource.configuration.prefix : "" },
    { Name: `${prefix}_FORCE_PATH_STYLE`, Value: "false" },
  ];
}

function applicationSecrets(plan: ApplicationAwsDeploymentPlan, logical: ReadonlyMap<string, string>, workload: ApplicationAwsPlanResource): readonly DeploymentJsonObject[] {
  const secrets: DeploymentJsonObject[] = [];
  const actorRuntimeIds = new Set(arrayConfig(workload, "actorRuntimeResourceIds").filter((value): value is string => typeof value === "string"));
  const actorFleet = plan.resources.find(({ id, service, resourceType }) => actorRuntimeIds.has(id) && service === "ecs" && resourceType === "celld-fleet");
  if (actorFleet) {
    const authorization = required(plan, stringConfig(actorFleet, "authorizationResourceId"));
    const connectionSigning = required(plan, stringConfig(actorFleet, "connectionSigningResourceId"));
    const valueFrom = ref(logical.get(authorization.id)!);
    secrets.push(
      { Name: "APPLIK8S_ACTOR_AUTHORIZATION", ValueFrom: valueFrom },
      { Name: "APPLIK8S_INTERNAL_OPERATION_SECRET", ValueFrom: valueFrom },
      { Name: "APPLIK8S_ACTOR_CONNECTION_SIGNING_KEY", ValueFrom: ref(logical.get(connectionSigning.id)!) },
    );
  }
  const workflowEngineIds = new Set(arrayConfig(workload, "workflowEngineResourceIds").filter((value): value is string => typeof value === "string"));
  const workflowEngines = plan.resources.filter(({ id, service, resourceType }) => workflowEngineIds.has(id) && service === "ecs" && resourceType === "hatchet-service");
  if (workflowEngines.length > 1) throw new Error(`AWS workload ${workload.id} resolves to multiple WorkflowEngine credentials.`);
  const workflowEngine = workflowEngines[0];
  if (workflowEngine) {
    const token = required(plan, stringConfig(workflowEngine, "workerTokenResourceId"));
    secrets.push({ Name: "HATCHET_CLIENT_TOKEN", ValueFrom: ref(logical.get(token.id)!) });
  }
  const lakehouseResourceIds = arrayConfig(workload, "lakehouseResourceIds").filter((value): value is string => typeof value === "string");
  const lakehouseCursor = lakehouseResourceIds.length > 0 ? plan.resources.find(({ id }) => id === "lakehouse.cursor-signing") : undefined;
  if (lakehouseCursor) {
    secrets.push({ Name: "APPLIK8S_CURSOR_SECRET", ValueFrom: ref(logical.get(lakehouseCursor.id)!) });
  }
  const runtimeSecretIds = new Set(arrayConfig(workload, "runtimeSecretResourceIds").filter((value): value is string => typeof value === "string"));
  for (const entry of plan.resources.filter(({ id, service, resourceType }) => runtimeSecretIds.has(id) && service === "secrets-manager" && resourceType === "secret-authority")) {
    const configuredEnvironmentName = entry.configuration.environmentName;
    const environmentName = typeof configuredEnvironmentName === "string" && configuredEnvironmentName.trim()
      ? configuredEnvironmentName
      : undefined;
    const id = logical.get(entry.id);
    if (environmentName && id) secrets.push({ Name: environmentName, ValueFrom: ref(id) });
  }
  return secrets;
}

function secretResourceArns(plan: ApplicationAwsDeploymentPlan, logical: ReadonlyMap<string, string>, workload: ApplicationAwsPlanResource): readonly DeploymentJsonValue[] {
  return applicationSecrets(plan, logical, workload).flatMap((entry) => entry.ValueFrom ? [entry.ValueFrom] : []);
}

function sensitiveOutputValue(entry: ApplicationAwsPlanResource, name: string, id: string): DeploymentJsonValue | undefined {
  if (name !== "secretArn") return undefined;
  if (entry.service === "rds") return getAtt(id, "MasterUserSecret.SecretArn");
  if (entry.service === "secrets-manager") return ref(id);
  return undefined;
}

function otelSidecarDefinitions(
  plan: ApplicationAwsDeploymentPlan,
  logical: ReadonlyMap<string, string>,
  workload: ApplicationAwsPlanResource,
): readonly DeploymentJsonObject[] {
  const declaredCollectors = new Set(
    arrayConfig(workload, "observabilityResourceIds")
      .filter((value): value is string => typeof value === "string"),
  );
  const collector = plan.resources.find(({ id, service, resourceType }) =>
    declaredCollectors.has(id)
    && service === "cloudwatch"
    && resourceType === "otel-collector");
  const logs = plan.resources.find(({ service, resourceType }) => service === "cloudwatch" && resourceType === "log-group");
  if (!collector || !logs) return [];
  return [{
    Name: "aws-otel-collector",
    Image: "public.ecr.aws/aws-observability/aws-otel-collector:v0.49.0",
    Essential: false,
    Command: ["--config=/etc/ecs/ecs-default-config.yaml"],
    PortMappings: [
      { ContainerPort: 4317, Protocol: "tcp" },
      { ContainerPort: 4318, Protocol: "tcp" },
    ],
    Environment: [
      { Name: "AWS_REGION", Value: plan.region },
      { Name: "AOT_CONFIG_CONTENT", Value: "" },
    ],
    LogConfiguration: {
      LogDriver: "awslogs",
      Options: {
        "awslogs-group": ref(logical.get(logs.id)!),
        "awslogs-region": plan.region,
        "awslogs-stream-prefix": "otel-collector",
      },
    },
    HealthCheck: {
      Command: ["CMD-SHELL", "wget -q -O - http://127.0.0.1:13133/ >/dev/null || exit 1"],
      Interval: 10,
      Timeout: 5,
      Retries: 6,
      StartPeriod: 20,
    },
  }];
}

function applicationAwsLakehouseBindings(plan: ApplicationAwsDeploymentPlan, resourceIds: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  const included = new Set(resourceIds);
  const datasets = plan.resources.filter(({ id, service, resourceType }) => included.has(id) && service === "s3" && resourceType === "lakehouse-dataset");
  const catalogs = plan.resources.filter(({ id, service, resourceType }) => included.has(id) && service === "glue" && resourceType === "catalog-database");
  const queries = plan.resources.filter(({ id, service, resourceType }) => included.has(id) && service === "athena" && resourceType === "workgroup");
  if (datasets.length === 0 && queries.length === 0) return undefined;
  return {
    datasets: Object.fromEntries(datasets.map((entry) => {
      const catalogId = stringConfig(entry, "catalogResourceId");
      const catalog = catalogs.find(({ id }) => id === catalogId);
      if (!catalog) throw new Error(`AWS lakehouse dataset ${entry.id} has no exact Glue catalog binding.`);
      return [stringConfig(entry, "qualification"), {
      bucket: entry.physicalName,
      prefix: stringConfig(entry, "prefix", "lakehouse"),
      region: stringConfig(entry, "region", plan.region),
      catalogDatabase: catalog.physicalName,
      }];
    })),
    queries: Object.fromEntries(queries.map((entry) => [stringConfig(entry, "qualification"), {
      workgroup: entry.physicalName,
      region: stringConfig(entry, "region", plan.region),
    }])),
  };
}

function addOutputs(
  outputs: Record<string, DeploymentJsonObject>,
  entry: ApplicationAwsPlanResource,
  id: string,
  direct: Readonly<Record<string, string | number>> | undefined,
  plan: ApplicationAwsDeploymentPlan,
  logical: ReadonlyMap<string, string>,
): void {
  for (const output of entry.outputs) {
    const key = applicationAwsOutputKey(entry.id, output.name);
    const directValue = direct?.[output.name];
    const nativeValue = output.sensitivity === "sensitive"
      ? sensitiveOutputValue(entry, output.name, id)
      : outputValue(entry, output.name, id, plan, logical);
    if (directValue === undefined && nativeValue === undefined) continue;
    outputs[key] = {
      Description: `${entry.id}.${output.name}${output.sensitivity === "sensitive" ? " reference" : ""}`,
      Value: directValue === undefined ? nativeValue! : String(directValue),
    };
  }
}

function outputValue(
  entry: ApplicationAwsPlanResource,
  name: string,
  id: string,
  plan?: ApplicationAwsDeploymentPlan,
  logical?: ReadonlyMap<string, string>,
): DeploymentJsonValue | undefined {
  if (entry.service === "service-discovery" && entry.resourceType === "private-dns-namespace") {
    if (name === "namespaceId") return getAtt(id, "Id");
    if (name === "namespaceArn") return getAtt(id, "Arn");
  }
  if (entry.service === "ecs" && entry.resourceType === "fargate-runtime-service" && name === "endpoint") return stringConfig(entry, "endpoint");
  if (entry.service === "ecs" && (entry.resourceType === "fargate-service" || entry.resourceType === "fargate-runtime-service") && name === "serviceArn") return ref(id);
  if (entry.service === "ecs" && entry.resourceType === "fargate-service" && name === "endpoint") {
    const loadBalancer = plan?.resources.find(({ service }) => service === "elastic-load-balancing");
    const loadBalancerId = loadBalancer && logical?.get(loadBalancer.id);
    if (loadBalancerId) {
      const certificate = plan?.resources.some(({ service }) => service === "acm");
      return { "Fn::Join": ["", [certificate ? "https://" : "http://", getAtt(loadBalancerId, "DNSName")]] };
    }
    const actorFleet = plan?.resources.find(({ service, resourceType }) => service === "ecs" && resourceType === "celld-fleet");
    if (actorFleet) return `http://${boundedDnsLabel(entry.physicalName)}.${internalDnsName(plan!)}:${numberConfig(entry, "port", 3000)}`;
    return undefined;
  }
  if (entry.service === "ecs" && entry.resourceType === "celld-fleet") {
    if (name === "endpoint") return `http://${boundedDnsLabel(entry.physicalName)}.${String(entry.configuration.internalDnsName ?? "actors.internal")}:${numberConfig(entry, "port", 8080)}`;
    if (name === "deploymentId") return entry.configuration.workerProtocol ?? "applik8s.actorAuthority/v1alpha1";
    if (name === "deploymentTaskDefinitionArn") return ref(`${id}DeploymentTaskDefinition`);
    if (name === "deploymentSecurityGroupId") return ref(`${id}SecurityGroup`);
  }
  if (entry.service === "ecs" && entry.resourceType === "hatchet-service") {
    const namespace = plan ? required(plan, stringConfig(entry, "discoveryNamespaceResourceId")) : undefined;
    const namespaceName = namespace ? stringConfig(namespace, "namespaceName") : "applik8s.internal";
    const discoveryName = stringConfig(entry, "discoveryName");
    if (name === "endpoint") return `http://${discoveryName}.${namespaceName}:${numberConfig(entry, "apiPort", 8888)}`;
    if (name === "grpcEndpoint") return `${discoveryName}.${namespaceName}:${numberConfig(entry, "grpcPort", 7077)}`;
    if (name === "workerTokenTaskDefinitionArn") return ref(`${id}WorkerTokenTaskDefinition`);
    if (name === "workerTokenSecurityGroupId") return ref(`${id}SecurityGroup`);
  }
  if (entry.service === "efs" && entry.resourceType === "shared-filesystem") {
    if (name === "fileSystemId") return ref(id);
    if (name === "accessPointArn") return getAtt(`${id}AccessPoint`, "Arn");
  }
  const attributes: Readonly<Record<string, string>> = {
    vpcId: "VpcId", subnetId: "SubnetId", securityGroupId: "GroupId", repositoryUri: "RepositoryUri", repositoryArn: "Arn",
    clusterArn: "Arn", clusterName: "ClusterName", logGroupArn: "Arn", roleArn: "Arn", endpoint: "Endpoint.Address", port: "Endpoint.Port",
    bucketArn: "Arn", streamArn: "Arn", tableArn: "Arn", queueArn: "Arn", groupArn: "Arn", scheduleArn: "Arn", secretArn: "Arn",
    dnsName: "DNSName", zoneId: "CanonicalHostedZoneID", loadBalancerArn: "LoadBalancerArn", certificateArn: "Arn", databaseArn: "Arn", workgroupArn: "Arn", serviceArn: "ServiceArn",
  };
  if (name === "bucketName" || name === "streamName" || name === "tableName" || name === "workgroupName" || name === "databaseName" || name === "repositoryName") return ref(id);
  if (name === "queueUrl") return ref(id);
  if (name === "fqdn") return entry.configuration.recordName ?? entry.physicalName;
  if (name === "prefix") return entry.configuration.prefix ?? "";
  return getAtt(id, attributes[name] ?? name);
}

function internalDnsName(plan: ApplicationAwsDeploymentPlan): string {
  return `${boundedDnsLabel(`${plan.application}-${plan.environment}`)}.actors.internal`;
}

function celldEndpoint(plan: ApplicationAwsDeploymentPlan, entry: ApplicationAwsPlanResource): string {
  return `http://${boundedDnsLabel(entry.physicalName)}.${internalDnsName(plan)}:${numberConfig(entry, "port", 8080)}`;
}

function boundedDnsLabel(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/^-+|-+$/gu, "") || "applik8s";
  return normalized.length <= 63 ? normalized : `${normalized.slice(0, 50).replace(/-+$/gu, "")}-${digest(normalized).slice(0, 12)}`;
}

function resource(type: string, properties: DeploymentJsonObject, dependsOn?: readonly string[], deletionPolicy?: "Retain" | "Snapshot"): DeploymentJsonObject {
  return compactObject({ Type: type, Properties: compactObject(properties), ...(dependsOn?.length ? { DependsOn: [...new Set(dependsOn)].sort() } : {}), ...(deletionPolicy ? { DeletionPolicy: deletionPolicy, UpdateReplacePolicy: deletionPolicy } : {}) });
}

function tags(plan: ApplicationAwsDeploymentPlan, entry: ApplicationAwsPlanResource): readonly DeploymentJsonObject[] {
  return Object.entries(tagRecord(plan, entry)).map(([Key, Value]) => ({ Key, Value }));
}

function tagRecord(plan: ApplicationAwsDeploymentPlan, entry: ApplicationAwsPlanResource): Readonly<Record<string, string>> {
  return { "applik8s.dev/application": plan.application, "applik8s.dev/environment": plan.environment, "applik8s.dev/resource-id": entry.id, "applik8s.dev/plan-digest": plan.digest };
}

function assumeRolePolicy(service: string): DeploymentJsonObject {
  return { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: service }, Action: "sts:AssumeRole" }] };
}

function ref(id: string): DeploymentJsonObject { return { Ref: id }; }
function getAtt(id: string, attribute: string): DeploymentJsonObject { return { "Fn::GetAtt": [id, attribute] }; }
function required(plan: ApplicationAwsDeploymentPlan, id: string): ApplicationAwsPlanResource { const found = plan.resources.find((resource) => resource.id === id); if (!found) throw new Error(`AWS plan is missing required resource ${id}.`); return found; }
function securityGroupForEntry(plan: ApplicationAwsDeploymentPlan, entry: ApplicationAwsPlanResource, fallback: ApplicationAwsPlanResource): ApplicationAwsPlanResource {
  const resourceId = optionalString(entry.configuration.runtimeAccessSecurityGroupResourceId);
  if (!resourceId) return fallback;
  const group = required(plan, resourceId);
  if (group.service !== "ec2" || group.resourceType !== "security-group") throw new Error(`AWS resource ${entry.id} names non-security-group ${resourceId}.`);
  return group;
}
function stringConfig(entry: ApplicationAwsPlanResource, key: string, fallback?: string): string { const value = entry.configuration[key]; if (typeof value === "string" && value.trim()) return value; if (fallback !== undefined) return fallback; throw new Error(`AWS resource ${entry.id} requires string configuration ${key}.`); }
function numberConfig(entry: ApplicationAwsPlanResource, key: string, fallback: number): number { const value = entry.configuration[key]; return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function booleanConfig(entry: ApplicationAwsPlanResource, key: string, fallback: boolean): boolean { const value = entry.configuration[key]; return typeof value === "boolean" ? value : fallback; }
function arrayConfig(entry: ApplicationAwsPlanResource, key: string): readonly DeploymentJsonValue[] { const value = entry.configuration[key]; return Array.isArray(value) ? value : []; }
function cloudFormationPolicyStatements(entry: ApplicationAwsPlanResource, plan: ApplicationAwsDeploymentPlan, logical: ReadonlyMap<string, string>): readonly DeploymentJsonObject[] {
  return arrayConfig(entry, "statements").map((statement) => {
    if (!statement || typeof statement !== "object" || Array.isArray(statement)) throw new Error(`AWS role ${entry.id} has an invalid policy statement.`);
    const record = statement as DeploymentJsonObject;
    const effect = record.Effect ?? record.effect;
    const action = record.Action ?? record.actions;
    const resources = record.Resource ?? record.resources;
    const condition = record.Condition ?? record.conditions;
    if (effect !== "Allow" && effect !== "Deny" || !Array.isArray(action) || !Array.isArray(resources)) throw new Error(`AWS role ${entry.id} has an incomplete policy statement.`);
    return compactObject({ Effect: effect, Action: action, Resource: resources.map((value) => policyResource(value, plan, logical)), ...(condition ? { Condition: condition } : {}) });
  });
}
function policyResource(value: DeploymentJsonValue, plan: ApplicationAwsDeploymentPlan, logical: ReadonlyMap<string, string>): DeploymentJsonValue {
  if (typeof value !== "string" || !value.startsWith("output://")) return value;
  const match = /^output:\/\/(.+)\/([^/]+)$/u.exec(value);
  if (!match) throw new Error(`AWS policy resource reference ${value} is malformed.`);
  const entry = required(plan, match[1]!);
  const output = entry.outputs.find(({ name }) => name === match[2]);
  if (!output) throw new Error(`AWS policy resource reference ${value} names an undeclared output.`);
  const resolved = output.sensitivity === "sensitive"
    ? sensitiveOutputValue(entry, output.name, logical.get(entry.id)!)
    : outputValue(entry, output.name, logical.get(entry.id)!);
  if (!resolved) throw new Error(`AWS policy resource reference ${value} cannot be materialized.`);
  return resolved;
}
const emptyAwsPlanResource: ApplicationAwsPlanResource = {
  id: "none", service: "ecs", resourceType: "none", physicalName: "none",
  lifecycle: { ownership: "external", deletion: "none", adoption: "externalOnly" }, network: "none", configuration: {}, outputs: [], provenance: {},
};
function optionalString(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
function arrayStrings(value: unknown): readonly string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : []; }
function arrayObjects(value: unknown): readonly DeploymentJsonObject[] { return Array.isArray(value) ? value.filter((item): item is DeploymentJsonObject => Boolean(item && typeof item === "object" && !Array.isArray(item))) : []; }
function logicalId(value: string): string { const words = value.split(/[^A-Za-z0-9]+/u).filter(Boolean); const base = words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join("") || "Resource"; return `${base.slice(0, 220)}${digest(value).slice(0, 16)}`; }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
// typecast: object entries are only filtered, never transformed; callers pass
// typecast: closed deployment JSON records and retain their exact shape.
function compactObject<T extends Readonly<Record<string, unknown>>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T; }

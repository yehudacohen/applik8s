// typecast-file-boundary: Distilled AWS and Alchemy use independently generic
// state types; assertions are isolated to this provider implementation edge.
import * as elasticache from "@distilled.cloud/aws/elasticache";
import * as Diff from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource, type Resource as AlchemyResource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";

export interface ApplicationAwsElastiCacheSubnetGroupProps {
  readonly name: string;
  readonly description: string;
  readonly subnetIds: readonly string[];
  readonly tags: Readonly<Record<string, string>>;
}

export interface ApplicationAwsElastiCacheSubnetGroupState {
  readonly name: string;
  readonly subnetIds: readonly string[];
}

type ApplicationAwsElastiCacheSubnetGroupResource = AlchemyResource<
  "Applik8s.AWS.ElastiCache.SubnetGroup",
  ApplicationAwsElastiCacheSubnetGroupProps,
  ApplicationAwsElastiCacheSubnetGroupState
>;

export const ApplicationAwsElastiCacheSubnetGroup = Resource<ApplicationAwsElastiCacheSubnetGroupResource>(
  "Applik8s.AWS.ElastiCache.SubnetGroup",
);

export interface ApplicationAwsValkeyReplicationGroupProps {
  readonly replicationGroupId: string;
  readonly description: string;
  readonly subnetGroupName: string;
  readonly securityGroupIds: readonly string[];
  readonly port: number;
  readonly replicas: number;
  readonly encryptedAtRest: boolean;
  readonly encryptedInTransit: boolean;
  readonly authToken: Redacted.Redacted<string>;
  readonly tags: Readonly<Record<string, string>>;
}

export interface ApplicationAwsValkeyReplicationGroupState {
  readonly replicationGroupId: string;
  readonly replicationGroupArn: string;
  readonly endpoint: string;
  readonly port: number;
  readonly status: string;
  readonly replicas: number;
}

type ApplicationAwsValkeyReplicationGroupResource = AlchemyResource<
  "Applik8s.AWS.ElastiCache.ValkeyReplicationGroup",
  ApplicationAwsValkeyReplicationGroupProps,
  ApplicationAwsValkeyReplicationGroupState
>;

export const ApplicationAwsValkeyReplicationGroup = Resource<ApplicationAwsValkeyReplicationGroupResource>(
  "Applik8s.AWS.ElastiCache.ValkeyReplicationGroup",
);

export const applicationAwsNativeStatefulResources = [
  ApplicationAwsElastiCacheSubnetGroup,
  ApplicationAwsValkeyReplicationGroup,
] as const;

class ApplicationAwsStatefulPending extends Error {
  readonly _tag = "ApplicationAwsStatefulPending";
}

export function applicationAwsNativeStatefulProviderLayer() {
  return Layer.mergeAll(elasticacheSubnetGroupProvider(), valkeyReplicationGroupProvider());
}

function elasticacheSubnetGroupProvider() {
  return Provider.succeed(ApplicationAwsElastiCacheSubnetGroup, {
    version: 1,
    stables: ["name"],
    list: () => Effect.succeed([]),
    diff: ({ olds, news }) => Effect.succeed(
      Diff.isResolved(news) && olds.name !== news.name
        ? { action: "replace" as const, deleteFirst: true }
        : undefined,
    ),
    read: ({ olds, output }) => {
      const name = output?.name ?? (Diff.isResolved(olds) ? olds.name : undefined);
      return name ? readElastiCacheSubnetGroup(name) : Effect.succeed(undefined);
    },
    reconcile: ({ news }) => Effect.gen(function* () {
      const current = yield* readElastiCacheSubnetGroup(news.name);
      if (!current) {
        yield* elasticache.createCacheSubnetGroup({
          CacheSubnetGroupName: news.name,
          CacheSubnetGroupDescription: news.description,
          SubnetIds: [...news.subnetIds],
          Tags: awsTags(news.tags),
        });
      } else if (!sameStrings(current.subnetIds, news.subnetIds)) {
        yield* elasticache.modifyCacheSubnetGroup({
          CacheSubnetGroupName: news.name,
          CacheSubnetGroupDescription: news.description,
          SubnetIds: [...news.subnetIds],
        });
      }
      const reconciled = yield* readElastiCacheSubnetGroup(news.name);
      if (!reconciled) return yield* Effect.fail(new Error(`ElastiCache subnet group ${news.name} disappeared during reconciliation.`));
      return reconciled;
    }),
    delete: ({ output }) => elasticache.deleteCacheSubnetGroup({ CacheSubnetGroupName: output.name }).pipe(
      Effect.catchTag("CacheSubnetGroupNotFoundFault", () => Effect.void),
    ),
  });
}

function valkeyReplicationGroupProvider() {
  return Provider.succeed(ApplicationAwsValkeyReplicationGroup, {
    version: 1,
    stables: ["replicationGroupId", "replicationGroupArn"],
    list: () => Effect.succeed([]),
    diff: ({ olds, news }) => Effect.succeed(
      Diff.isResolved(news) && (
        olds.replicationGroupId !== news.replicationGroupId
        || olds.subnetGroupName !== news.subnetGroupName
        || olds.encryptedAtRest !== news.encryptedAtRest
        || olds.encryptedInTransit !== news.encryptedInTransit
      )
        ? { action: "replace" as const, deleteFirst: true }
        : undefined,
    ),
    read: ({ olds, output }) => {
      const id = output?.replicationGroupId ?? (Diff.isResolved(olds) ? olds.replicationGroupId : undefined);
      return id ? readValkeyReplicationGroup(id) : Effect.succeed(undefined);
    },
    reconcile: ({ news }) => Effect.gen(function* () {
      let current = yield* readValkeyReplicationGroup(news.replicationGroupId);
      if (!current) {
        yield* elasticache.createReplicationGroup({
          ReplicationGroupId: news.replicationGroupId,
          ReplicationGroupDescription: news.description,
          Engine: "valkey",
          CacheNodeType: "cache.t4g.micro",
          CacheSubnetGroupName: news.subnetGroupName,
          SecurityGroupIds: [...news.securityGroupIds],
          Port: news.port,
          NumCacheClusters: news.replicas,
          AutomaticFailoverEnabled: news.replicas > 1,
          MultiAZEnabled: news.replicas > 1,
          TransitEncryptionEnabled: news.encryptedInTransit,
          ...(news.encryptedInTransit ? { TransitEncryptionMode: "required" as const } : {}),
          AtRestEncryptionEnabled: news.encryptedAtRest,
          AuthToken: Redacted.value(news.authToken),
          Tags: awsTags(news.tags),
        });
        current = yield* waitForValkeyReplicationGroup(news.replicationGroupId, "available");
      } else if (current.replicas !== news.replicas) {
        const operation = news.replicas > current.replicas
          ? elasticache.increaseReplicaCount
          : elasticache.decreaseReplicaCount;
        yield* operation({
          ReplicationGroupId: news.replicationGroupId,
          NewReplicaCount: Math.max(0, news.replicas - 1),
          ApplyImmediately: true,
        });
        current = yield* waitForValkeyReplicationGroup(news.replicationGroupId, "available");
      }
      return current;
    }),
    delete: ({ output }) => elasticache.deleteReplicationGroup({
      ReplicationGroupId: output.replicationGroupId,
      RetainPrimaryCluster: false,
    }).pipe(
      Effect.catchTag("ReplicationGroupNotFoundFault", () => Effect.void),
      Effect.flatMap(() => waitForDeletedValkeyReplicationGroup(output.replicationGroupId)),
    ),
  });
}

function readElastiCacheSubnetGroup(name: string) {
  return elasticache.describeCacheSubnetGroups({ CacheSubnetGroupName: name }).pipe(
    Effect.map(({ CacheSubnetGroups }) => {
      const current = CacheSubnetGroups?.[0];
      return current?.CacheSubnetGroupName
        ? {
            name: current.CacheSubnetGroupName,
            subnetIds: (current.Subnets ?? []).flatMap(({ SubnetIdentifier }) => SubnetIdentifier ? [SubnetIdentifier] : []).sort(),
          }
        : undefined;
    }),
    Effect.catchTag("CacheSubnetGroupNotFoundFault", () => Effect.succeed(undefined)),
  );
}

function readValkeyReplicationGroup(replicationGroupId: string) {
  return elasticache.describeReplicationGroups({ ReplicationGroupId: replicationGroupId }).pipe(
    Effect.map(({ ReplicationGroups }) => {
      const current = ReplicationGroups?.[0];
      const endpoint = current?.ConfigurationEndpoint ?? current?.NodeGroups?.[0]?.PrimaryEndpoint;
      return current?.ReplicationGroupId && current.ARN
        ? {
            replicationGroupId: current.ReplicationGroupId,
            replicationGroupArn: current.ARN,
            endpoint: endpoint?.Address ?? "",
            port: endpoint?.Port ?? 6379,
            status: current.Status ?? "unknown",
            replicas: current.MemberClusters?.length ?? 1,
          }
        : undefined;
    }),
    Effect.catchTag("ReplicationGroupNotFoundFault", () => Effect.succeed(undefined)),
  );
}

function waitForValkeyReplicationGroup(replicationGroupId: string, status: string) {
  return readValkeyReplicationGroup(replicationGroupId).pipe(
    Effect.flatMap((state) => state?.status === status
      ? Effect.succeed(state)
      : Effect.fail(new ApplicationAwsStatefulPending())),
    retryStateful(),
  );
}

function waitForDeletedValkeyReplicationGroup(replicationGroupId: string) {
  return readValkeyReplicationGroup(replicationGroupId).pipe(
    Effect.flatMap((state) => state ? Effect.fail(new ApplicationAwsStatefulPending()) : Effect.void),
    retryStateful(),
  );
}

function retryStateful<A, E, R>() {
  return (effect: Effect.Effect<A, E | ApplicationAwsStatefulPending, R>) => effect.pipe(Effect.retry({
    while: (error) => error instanceof ApplicationAwsStatefulPending,
    schedule: Schedule.spaced("1 second"),
    times: 900,
  }));
}

function awsTags(tags: Readonly<Record<string, string>>) {
  return Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

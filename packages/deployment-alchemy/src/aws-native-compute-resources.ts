// typecast-file-boundary: Alchemy's generic Resource contract requires literal
// resource tags and discriminated diff results at this provider adapter edge.
import * as ecs from "@distilled.cloud/aws/ecs";
import * as Diff from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource, type Resource as AlchemyResource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

export interface ApplicationAwsOneShotTaskProps {
  readonly clusterArn: string;
  readonly taskDefinitionArn: string;
  readonly subnets: readonly string[];
  readonly securityGroupIds: readonly string[];
  readonly receiptDigest: string;
}

export interface ApplicationAwsOneShotTaskState {
  readonly taskArn: string;
  readonly clusterArn: string;
  readonly taskDefinitionArn: string;
  readonly receiptDigest: string;
  readonly stoppedAt: string;
}

type ApplicationAwsOneShotTaskResource = AlchemyResource<
  "Applik8s.AWS.ECS.OneShotTask",
  ApplicationAwsOneShotTaskProps,
  ApplicationAwsOneShotTaskState
>;

/**
 * A deployment-time ECS task with a durable completion receipt. Alchemy's
 * RunTask binding is callable rather than a lifecycle resource, so this is an
 * intentionally retained Applik8s extension.
 */
export const ApplicationAwsOneShotTask = Resource<ApplicationAwsOneShotTaskResource>(
  "Applik8s.AWS.ECS.OneShotTask",
  { defaultRemovalPolicy: "retain" },
);

export const applicationAwsNativeComputeResources = [ApplicationAwsOneShotTask] as const;

export function applicationAwsNativeComputeProviderLayer() {
  return Layer.mergeAll(oneShotTaskProvider());
}

function oneShotTaskProvider() {
  return Provider.succeed(ApplicationAwsOneShotTask, {
    version: 1,
    stables: ["taskArn", "clusterArn", "taskDefinitionArn", "receiptDigest"],
    list: () => Effect.succeed([]),
    diff: ({ olds, news }) => Effect.succeed(
      Diff.isResolved(news) && (
        olds.clusterArn !== news.clusterArn
        || olds.taskDefinitionArn !== news.taskDefinitionArn
        || olds.receiptDigest !== news.receiptDigest
      )
        ? { action: "replace" as const, deleteFirst: false }
        : undefined,
    ),
    read: ({ output }) => Effect.succeed(output),
    reconcile: ({ news, session }) => Effect.gen(function* () {
      const started = yield* ecs.runTask({
        cluster: news.clusterArn,
        taskDefinition: news.taskDefinitionArn,
        launchType: "FARGATE",
        count: 1,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: [...news.subnets],
            securityGroups: [...news.securityGroupIds],
            assignPublicIp: "DISABLED",
          },
        },
      });
      const failures = started.failures ?? [];
      if (failures.length > 0) {
        return yield* Effect.fail(new Error(`AWS rejected one-shot ECS task: ${JSON.stringify(failures)}.`));
      }
      const taskArn = started.tasks?.[0]?.taskArn;
      if (!taskArn) return yield* Effect.fail(new Error("AWS ECS did not return a task ARN for one-shot deployment work."));
      yield* session.note(`Waiting for one-shot ECS task ${taskArn}...`);
      const completed = yield* waitForStoppedTask(news.clusterArn, taskArn);
      const failed = (completed.containers ?? []).filter(({ exitCode }) => exitCode !== 0);
      if (failed.length > 0) {
        const evidence = failed.map(({ name, exitCode, reason }) => ({ name, exitCode, reason }));
        return yield* Effect.fail(new Error(`One-shot ECS task ${taskArn} failed: ${JSON.stringify(evidence)}.`));
      }
      return {
        taskArn,
        clusterArn: news.clusterArn,
        taskDefinitionArn: news.taskDefinitionArn,
        receiptDigest: news.receiptDigest,
        stoppedAt: new Date().toISOString(),
      };
    }),
    delete: () => Effect.void,
  });
}

function waitForStoppedTask(clusterArn: string, taskArn: string) {
  return Effect.gen(function* () {
    const described = yield* ecs.describeTasks({ cluster: clusterArn, tasks: [taskArn] });
    const task = described.tasks?.[0];
    if (task?.lastStatus !== "STOPPED") {
      return yield* Effect.fail({ _tag: "ApplicationAwsTaskPending" as const });
    }
    return task;
  }).pipe(Effect.retry({
    while: (error) => Boolean(error && typeof error === "object" && Reflect.get(error, "_tag") === "ApplicationAwsTaskPending"),
    schedule: Schedule.spaced("2 seconds"),
    times: 450,
  }));
}

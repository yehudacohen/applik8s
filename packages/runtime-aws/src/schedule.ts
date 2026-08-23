// typecast-file-boundary: AWS Scheduler and SQS admissions are decoded from SDK transport values and validated before execution.
import { createHash, randomUUID } from 'node:crypto'
import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
  ResourceNotFoundException,
  SchedulerClient,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler'
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  type ReceiveMessageCommandOutput,
} from '@aws-sdk/client-sqs'
import { applicationScheduleImmediateInvocationAdmission, applicationScheduleOccurrenceId, applicationScheduleProjectedDesiredState, type ApplicationScheduleAdmissionRunner, type ApplicationScheduleConvergenceResult, type ApplicationScheduleDefinitionContract, type ApplicationScheduleInstance, type ApplicationScheduleManagementReceipt, type ApplicationScheduleStateAuthority } from '@applik8s/applik8s'
import { type ApplicationAdmissionInvocationContextV1, canonicalJsonCompatibleV1Policy, canonicalJsonV1String } from '@applik8s/core'
import { createPostgresApplicationScheduleStateAuthority } from '@applik8s/runtime-postgres/schedule-state'
import postgres, { type Sql } from 'postgres'

export interface AwsApplicationScheduleAdmission {
  readonly schemaVersion: 'applik8s.scheduleAdmission/v1alpha1'
  readonly applicationId: string
  readonly environmentId: string
  readonly definitionId: string
  readonly instanceId: string
  readonly scheduledAt: string
  readonly admittedAt: string
  readonly attempt: number
  readonly overlap: 'allow' | 'skip'
  readonly overlapKey: string
  readonly input?: object
  readonly schedulerExecutionId?: string
}

export interface AwsApplicationScheduleReceipt {
  readonly occurrenceId: string
  readonly state: 'succeeded' | 'failed' | 'skipped'
  readonly [key: string]: unknown
}

export interface AwsApplicationScheduleQueueRunner {
  stop(): Promise<void>
}

export interface AwsApplicationScheduleRuntimeConfiguration {
  readonly applicationId: string
  readonly environmentId: string
  readonly region?: string
  readonly queueUrl: string
  readonly queueArn: string
  readonly deadLetterQueueArn: string
  readonly groupName: string
  readonly executionRoleArn: string
  readonly databaseUrl: string
}

type ScheduleDefinition = ApplicationScheduleDefinitionContract<object>
type ScheduleInstance = ApplicationScheduleInstance<object>

interface ScheduleHandlerRequest {
  readonly definition: ScheduleDefinition
  readonly input: object
  readonly handler: (input: object, context: Record<string, unknown>) => unknown | Promise<unknown>
  readonly callerAdmission: ApplicationAdmissionInvocationContextV1
}

interface ScheduleReconcileRequest {
  readonly definition: ScheduleDefinition
  readonly instance: ScheduleInstance
  readonly handler: (input: object, context: Record<string, unknown>) => unknown | Promise<unknown>
  readonly management?: ApplicationScheduleManagementReceipt
}

export interface AwsApplicationScheduleRuntime {
  invoke(request: ScheduleHandlerRequest): Promise<unknown>
  reconcile(request: ScheduleReconcileRequest): Promise<ApplicationScheduleConvergenceResult>
  remove(definitionId: string, instanceId: string, management?: ApplicationScheduleManagementReceipt): Promise<ApplicationScheduleConvergenceResult>
  recover(): Promise<readonly ApplicationScheduleConvergenceResult[]>
  close(): Promise<void>
}

/**
 * AWS Scheduler runtime used by function-native `.schedule()` calls. Static
 * schedules are reconciled by CloudFormation; dynamic instances use the same
 * group, queue, role, admission envelope, and lifecycle identity.
 */
export async function createAwsApplicationScheduleRuntime(
  configuration: AwsApplicationScheduleRuntimeConfiguration,
  dependencies: {
    readonly scheduler?: SchedulerClient
    readonly admissionRunner?: ApplicationScheduleAdmissionRunner
    readonly stateAuthority?: ApplicationScheduleStateAuthority
  } = {},
): Promise<AwsApplicationScheduleRuntime> {
  validateConfiguration(configuration)
  const scheduler = dependencies.scheduler ?? new SchedulerClient(configuration.region ? { region: configuration.region } : {})
  const stateAuthority = dependencies.stateAuthority
    ?? createPostgresApplicationScheduleStateAuthority({
      databaseUrl: configuration.databaseUrl,
      applicationId: configuration.applicationId,
      environmentId: configuration.environmentId,
    })
  const ownsStateAuthority = !dependencies.stateAuthority
  const project = async (request: {
    readonly definition: ScheduleDefinition
    readonly instance: ScheduleInstance
    readonly overlapKey: string
    readonly management?: ApplicationScheduleManagementReceipt
  }): Promise<'created' | 'updated' | 'unchanged'> => {
    const name = dynamicScheduleName(configuration, request.definition.id, request.instance.id)
    const existing = await readSchedule(scheduler, configuration.groupName, name)
    const target = {
      Arn: configuration.queueArn,
      RoleArn: configuration.executionRoleArn,
      Input: JSON.stringify({
        schemaVersion: 'applik8s.scheduleAdmission/v1alpha1',
        definitionId: request.definition.id,
        instanceId: request.instance.id,
        input: request.instance.input,
        overlap: request.definition.overlap,
        overlapKey: request.overlapKey,
        scheduledAt: '<aws.scheduler.scheduled-time>',
        schedulerExecutionId: '<aws.scheduler.execution-id>',
        schedulerAttempt: '<aws.scheduler.attempt-number>',
      }),
      RetryPolicy: {
        MaximumEventAgeInSeconds: clamp(request.definition.retry.maximumAgeSeconds, 60, 86_400),
        MaximumRetryAttempts: clamp(request.definition.retry.maxAttempts - 1, 0, 185),
      },
      DeadLetterConfig: { Arn: configuration.deadLetterQueueArn },
    }
    const desiredDigest = createHash('sha256').update(canonicalJsonV1String({
      definitionId: request.definition.id,
      instance: request.instance,
      target,
    }, canonicalJsonCompatibleV1Policy)).digest('hex')
    const description = scheduleDescription(request.instance.revision, desiredDigest, request.management?.id)
    const common = {
      Name: name,
      GroupName: configuration.groupName,
      ScheduleExpression: awsScheduleExpression(request.instance, request.definition),
      ScheduleExpressionTimezone: request.instance.timezone ?? request.definition.timezone,
      FlexibleTimeWindow: { Mode: 'OFF' as const },
      State: request.instance.enabled === false ? 'DISABLED' as const : 'ENABLED' as const,
      Target: target,
      Description: description,
      ...(request.instance.at && request.instance.deleteAfterCompletion
        ? { ActionAfterCompletion: 'DELETE' as const }
        : {}),
    }
    if (existing) {
      const ownership = parseScheduleDescription(existing.Description)
      if (!ownership) {
        throw new Error(`AWS Scheduler resource ${configuration.groupName}/${name} is not owned by Applik8s; refusing adoption.`)
      }
      if (ownership.revision === request.instance.revision && ownership.digest !== desiredDigest) {
        throw new Error(`Schedule ${request.definition.id}/${request.instance.id} revision ${request.instance.revision} conflicts with different desired state.`)
      }
      if (compareRevision(request.instance.revision, ownership.revision) < 0) {
        throw new Error(`Schedule ${request.definition.id}/${request.instance.id} revision ${request.instance.revision} is stale; current revision is ${ownership.revision}.`)
      }
      if (ownership.digest === desiredDigest && awsScheduleMatches(existing, common)) return 'unchanged'
      await scheduler.send(new UpdateScheduleCommand({
        ...common,
        ClientToken: scheduleClientToken(configuration, request.definition.id, request.instance.id, request.instance.revision, desiredDigest),
      }))
      return 'updated'
    }
    await scheduler.send(new CreateScheduleCommand({
      ...common,
      ClientToken: scheduleClientToken(configuration, request.definition.id, request.instance.id, request.instance.revision, desiredDigest),
    }))
    return 'created'
  }
  const runtime: AwsApplicationScheduleRuntime = {
    async invoke(request) {
      const now = new Date().toISOString()
			const occurrenceId = applicationScheduleOccurrenceId({
				applicationId: configuration.applicationId,
				environmentId: configuration.environmentId,
				definitionId: request.definition.id,
				instanceId: 'immediate',
				scheduledAt: now,
			})
      const invocationAdmission = applicationScheduleImmediateInvocationAdmission({
        caller: request.callerAdmission,
        definitionId: request.definition.id,
        instanceId: 'immediate',
        occurrenceId,
        admittedAt: now,
        maximumAgeSeconds: request.definition.retry.maximumAgeSeconds,
      })
      const invokeHandler = async () => request.handler(request.input, {
        definitionId: request.definition.id,
        instanceId: 'immediate',
				occurrenceId,
        scheduledAt: now,
        admittedAt: now,
        startedAt: now,
        attempt: 1,
        trigger: 'immediate',
				admission: invocationAdmission,
        signal: new AbortController().signal,
      })
      return dependencies.admissionRunner
        ? dependencies.admissionRunner.run(invocationAdmission, invokeHandler)
        : invokeHandler()
    },
    async reconcile(request) {
      if (request.definition.configuration !== 'dynamic') {
        throw new Error(`AWS Scheduler cannot reconcile a dynamic instance for fixed definition ${request.definition.id}.`)
      }
      const canonical = await stateAuthority.reconcile(request)
      const state = await project({
        definition: request.definition,
        instance: request.instance,
        overlapKey: scheduleOverlapKey(request.definition, request.instance),
        ...(request.management ? { management: request.management } : {}),
      })
      if (!await stateAuthority.markProjected(request.definition.id, request.instance.id, request.instance.revision, 'active')) {
        await runtime.recover()
        throw new Error(`Schedule ${request.definition.id}:${request.instance.id} revision ${request.instance.revision} was superseded during AWS projection.`)
      }
      return { ...canonical, state: state === 'unchanged' ? canonical.state : state }
    },
    async remove(definitionId, instanceId, management) {
      const canonical = await stateAuthority.remove(definitionId, instanceId, management)
      const name = dynamicScheduleName(configuration, definitionId, instanceId)
      try {
        await scheduler.send(new DeleteScheduleCommand({ Name: name, GroupName: configuration.groupName }))
        if (!await stateAuthority.markProjected(definitionId, instanceId, canonical.revision, 'removed')) {
          await runtime.recover()
          throw new Error(`Schedule ${definitionId}:${instanceId} removal was superseded during AWS projection.`)
        }
        return { ...canonical, state: 'removed' }
      } catch (error) {
        if (isNotFound(error)) {
          if (!await stateAuthority.markProjected(definitionId, instanceId, canonical.revision, 'removed')) {
            await runtime.recover()
            throw new Error(`Schedule ${definitionId}:${instanceId} removal was superseded during AWS projection.`)
          }
          return canonical
        }
        throw error
      }
    },
    async recover() {
      const recovered: ApplicationScheduleConvergenceResult[] = []
      for (const record of await stateAuthority.pending()) {
        if (record.state === 'active') {
          const desired = applicationScheduleProjectedDesiredState(record)
          const state = await project(desired)
          if (!await stateAuthority.markProjected(record.definitionId, record.instanceId, record.revision, 'active')) {
            throw new Error(`Schedule ${record.definitionId}:${record.instanceId} changed during AWS recovery.`)
          }
          recovered.push({ definitionId: record.definitionId, instanceId: record.instanceId, revision: record.revision, state, ...(record.management ? { management: record.management } : {}) })
          continue
        }
        const name = dynamicScheduleName(configuration, record.definitionId, record.instanceId)
        try {
          await scheduler.send(new DeleteScheduleCommand({ Name: name, GroupName: configuration.groupName }))
        } catch (error) {
          if (!isNotFound(error)) throw error
        }
        if (!await stateAuthority.markProjected(record.definitionId, record.instanceId, record.revision, 'removed')) {
          throw new Error(`Schedule ${record.definitionId}:${record.instanceId} changed during AWS recovery.`)
        }
        recovered.push({ definitionId: record.definitionId, instanceId: record.instanceId, revision: record.revision, state: 'removed', ...(record.management ? { management: record.management } : {}) })
      }
      return recovered
    },
    async close() {
      if (ownsStateAuthority) await stateAuthority.close?.()
      if (!dependencies.scheduler) scheduler.destroy()
    },
  }
  await runtime.recover()
  return runtime
}

/**
 * Starts a bounded SQS admission loop. PostgreSQL is the canonical occurrence
 * receipt and lease authority; SQS visibility is delivery backpressure only.
 */
export async function startAwsApplicationScheduleQueueRunner(options: {
  readonly configuration: AwsApplicationScheduleRuntimeConfiguration
  readonly concurrency?: number
  readonly execute: (admission: AwsApplicationScheduleAdmission, signal: AbortSignal) => Promise<AwsApplicationScheduleReceipt>
  readonly onError?: (error: unknown) => void
}): Promise<AwsApplicationScheduleQueueRunner> {
  validateConfiguration(options.configuration)
  const concurrency = clamp(options.concurrency ?? 4, 1, 32)
  const sql = postgres(options.configuration.databaseUrl, { max: concurrency + 1 })
  await ensureOccurrenceAuthority(sql)
  const sqs = new SQSClient(options.configuration.region ? { region: options.configuration.region } : {})
  const controller = new AbortController()
  const workers = Array.from({ length: concurrency }, () => admissionLoop({
    ...options,
    sql,
    sqs,
    signal: controller.signal,
  }).catch((error) => {
    if (!controller.signal.aborted) options.onError?.(error)
  }))
  return {
    async stop() {
      controller.abort()
      await Promise.all(workers)
      await sql.end({ timeout: 5 })
      sqs.destroy()
    },
  }
}

async function admissionLoop(options: {
  readonly configuration: AwsApplicationScheduleRuntimeConfiguration
  readonly execute: (admission: AwsApplicationScheduleAdmission, signal: AbortSignal) => Promise<AwsApplicationScheduleReceipt>
  readonly onError?: (error: unknown) => void
  readonly sql: Sql
  readonly sqs: SQSClient
  readonly signal: AbortSignal
}): Promise<void> {
  while (!options.signal.aborted) {
    let response: ReceiveMessageCommandOutput
    try {
      response = await options.sqs.send(new ReceiveMessageCommand({
        QueueUrl: options.configuration.queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,
        VisibilityTimeout: 300,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }), { abortSignal: options.signal })
    } catch (error) {
      if (options.signal.aborted) return
      options.onError?.(error)
      await abortableDelay(1_000, options.signal)
      continue
    }
    for (const message of response.Messages ?? []) {
      const receiptHandle = message.ReceiptHandle
      if (!receiptHandle || !message.Body) continue
      const attempt = positiveInteger(message.Attributes?.ApproximateReceiveCount, 1)
      try {
        const admission = parseAdmission(message.Body, options.configuration, attempt)
        const id = applicationScheduleOccurrenceId({
          applicationId: options.configuration.applicationId,
          environmentId: options.configuration.environmentId,
          definitionId: admission.definitionId,
          instanceId: admission.instanceId,
          scheduledAt: admission.scheduledAt,
          ...(admission.schedulerExecutionId ? { schedulerExecutionId: admission.schedulerExecutionId } : {}),
        })
        const claim = await claimOccurrence(options.sql, {
          occurrenceId: id,
          definitionId: admission.definitionId,
          instanceId: admission.instanceId,
          overlapKey: admission.overlapKey,
          overlap: admission.overlap,
          scheduledAt: admission.scheduledAt,
          attempt,
        })
        if (claim.state === 'busy') continue
        if (claim.state === 'complete' || claim.state === 'skipped') {
          await deleteMessage(options.sqs, options.configuration.queueUrl, receiptHandle)
          continue
        }
        const leaseHeartbeat = startOccurrenceLeaseHeartbeat({
          sql: options.sql,
          occurrenceId: id,
          leaseOwner: claim.leaseOwner,
          sqs: options.sqs,
          queueUrl: options.configuration.queueUrl,
          receiptHandle,
          signal: options.signal,
          ...(options.onError ? { onError: options.onError } : {}),
        })
        const result = await options.execute(admission, options.signal).finally(leaseHeartbeat.stop)
        if (result.state === 'succeeded' || result.state === 'skipped') {
          const completed = await completeOccurrence(options.sql, id, claim.leaseOwner, result)
          if (!completed) throw new Error(`Schedule occurrence ${id} lost its execution lease before completion.`)
          await deleteMessage(options.sqs, options.configuration.queueUrl, receiptHandle)
        } else {
          await releaseOccurrence(options.sql, id, claim.leaseOwner, result)
          await options.sqs.send(new ChangeMessageVisibilityCommand({
            QueueUrl: options.configuration.queueUrl,
            ReceiptHandle: receiptHandle,
            VisibilityTimeout: Math.min(300, 5 * 2 ** Math.min(attempt, 6)),
          }))
        }
      } catch (error) {
        options.onError?.(error)
        await options.sqs.send(new ChangeMessageVisibilityCommand({
          QueueUrl: options.configuration.queueUrl,
          ReceiptHandle: receiptHandle,
          VisibilityTimeout: Math.min(300, 5 * 2 ** Math.min(attempt, 6)),
        })).catch((visibilityError) => options.onError?.(visibilityError))
      }
    }
  }
}

async function ensureOccurrenceAuthority(sql: Sql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS applik8s_schedule_occurrences (
    occurrence_id text PRIMARY KEY,
    definition_id text NOT NULL,
    overlap_key text NOT NULL,
    state text NOT NULL CHECK (state IN ('running', 'succeeded', 'skipped')),
    lease_owner text,
    lease_until timestamptz,
    receipt jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`
  await sql`ALTER TABLE applik8s_schedule_occurrences ADD COLUMN IF NOT EXISTS definition_id text`
  await sql`ALTER TABLE applik8s_schedule_occurrences ADD COLUMN IF NOT EXISTS overlap_key text`
  await sql`UPDATE applik8s_schedule_occurrences SET definition_id = '__legacy__' WHERE definition_id IS NULL`
  await sql`UPDATE applik8s_schedule_occurrences SET overlap_key = occurrence_id WHERE overlap_key IS NULL`
  await sql`ALTER TABLE applik8s_schedule_occurrences ALTER COLUMN definition_id SET NOT NULL`
  await sql`ALTER TABLE applik8s_schedule_occurrences ALTER COLUMN overlap_key SET NOT NULL`
  await sql`CREATE INDEX IF NOT EXISTS applik8s_schedule_occurrences_overlap ON applik8s_schedule_occurrences (definition_id, overlap_key, state, lease_until)`
}

type OccurrenceClaim =
  | { readonly state: 'claimed'; readonly leaseOwner: string }
  | { readonly state: 'complete' }
  | { readonly state: 'skipped' }
  | { readonly state: 'busy' }

async function claimOccurrence(sql: Sql, options: {
  readonly occurrenceId: string
  readonly definitionId: string
  readonly instanceId: string
  readonly overlapKey: string
  readonly overlap: 'allow' | 'skip'
  readonly scheduledAt: string
  readonly attempt: number
}): Promise<OccurrenceClaim> {
  return sql.begin(async (transaction) => {
    await transaction.unsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [options.definitionId, options.overlapKey],
    )
    const prior = await transaction<{ state: string; lease_until: Date | null }[]>`
      SELECT state, lease_until FROM applik8s_schedule_occurrences
      WHERE occurrence_id = ${options.occurrenceId}
    `
    if (prior[0]?.state === 'succeeded' || prior[0]?.state === 'skipped') return { state: 'complete' }
    if (prior[0]?.state === 'running' && prior[0].lease_until && prior[0].lease_until.getTime() >= Date.now()) {
      return { state: 'busy' }
    }
    if (options.overlap === 'skip') {
      const active = await transaction<{ occurrence_id: string }[]>`
        SELECT occurrence_id FROM applik8s_schedule_occurrences
        WHERE definition_id = ${options.definitionId}
          AND overlap_key = ${options.overlapKey}
          AND state = 'running'
          AND lease_until >= now()
          AND occurrence_id <> ${options.occurrenceId}
        LIMIT 1
      `
      if (active.length > 0) {
        const receipt: AwsApplicationScheduleReceipt = {
          occurrenceId: options.occurrenceId,
          definitionId: options.definitionId,
          instanceId: options.instanceId,
          scheduledAt: options.scheduledAt,
          state: 'skipped',
          attempts: options.attempt,
        }
        await transaction`
          INSERT INTO applik8s_schedule_occurrences
            (occurrence_id, definition_id, overlap_key, state, receipt)
          VALUES
            (${options.occurrenceId}, ${options.definitionId}, ${options.overlapKey}, 'skipped', ${transaction.json(jsonValue(receipt))})
          ON CONFLICT (occurrence_id) DO NOTHING
        `
        return { state: 'skipped' }
      }
    }
    const owner = randomUUID()
    const rows = await transaction<{ state: string }[]>`
      INSERT INTO applik8s_schedule_occurrences
        (occurrence_id, definition_id, overlap_key, state, lease_owner, lease_until)
      VALUES
        (${options.occurrenceId}, ${options.definitionId}, ${options.overlapKey}, 'running', ${owner}, now() + interval '5 minutes')
      ON CONFLICT (occurrence_id) DO UPDATE SET
        definition_id = EXCLUDED.definition_id,
        overlap_key = EXCLUDED.overlap_key,
        lease_owner = EXCLUDED.lease_owner,
        lease_until = EXCLUDED.lease_until,
        updated_at = now()
      WHERE applik8s_schedule_occurrences.state = 'running'
        AND (applik8s_schedule_occurrences.lease_until IS NULL OR applik8s_schedule_occurrences.lease_until < now())
      RETURNING state
    `
    return rows.length > 0 ? { state: 'claimed', leaseOwner: owner } : { state: 'busy' }
  })
}

async function completeOccurrence(sql: Sql, id: string, owner: string, receipt: AwsApplicationScheduleReceipt): Promise<boolean> {
  const rows = await sql<{ occurrence_id: string }[]>`UPDATE applik8s_schedule_occurrences SET state = ${receipt.state}, receipt = ${sql.json(jsonValue(receipt))}, lease_owner = NULL, lease_until = NULL, updated_at = now() WHERE occurrence_id = ${id} AND state = 'running' AND lease_owner = ${owner} RETURNING occurrence_id`
  return rows.length === 1
}

async function releaseOccurrence(sql: Sql, id: string, owner: string, receipt: AwsApplicationScheduleReceipt): Promise<boolean> {
  const rows = await sql<{ occurrence_id: string }[]>`UPDATE applik8s_schedule_occurrences SET receipt = ${sql.json(jsonValue(receipt))}, lease_owner = NULL, lease_until = now(), updated_at = now() WHERE occurrence_id = ${id} AND state = 'running' AND lease_owner = ${owner} RETURNING occurrence_id`
  return rows.length === 1
}

function startOccurrenceLeaseHeartbeat(options: {
  readonly sql: Sql
  readonly occurrenceId: string
  readonly leaseOwner: string
  readonly sqs: SQSClient
  readonly queueUrl: string
  readonly receiptHandle: string
  readonly signal: AbortSignal
  readonly onError?: (error: unknown) => void
}): { readonly stop: () => Promise<void> } {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending = Promise.resolve()
  const tick = async (): Promise<void> => {
    if (stopped || options.signal.aborted) return
    const rows = await options.sql<{ occurrence_id: string }[]>`UPDATE applik8s_schedule_occurrences SET lease_until = now() + interval '5 minutes', updated_at = now() WHERE occurrence_id = ${options.occurrenceId} AND state = 'running' AND lease_owner = ${options.leaseOwner} RETURNING occurrence_id`
    if (rows.length !== 1) throw new Error(`Schedule occurrence ${options.occurrenceId} lost its execution lease.`)
    await options.sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: options.queueUrl, ReceiptHandle: options.receiptHandle, VisibilityTimeout: 300 }))
    if (!stopped && !options.signal.aborted) timer = setTimeout(() => { pending = tick().catch((error) => options.onError?.(error)) }, 60_000)
  }
  timer = setTimeout(() => { pending = tick().catch((error) => options.onError?.(error)) }, 60_000)
  return {
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      await pending
    },
  }
}

function parseAdmission(body: string, configuration: AwsApplicationScheduleRuntimeConfiguration, attempt: number): AwsApplicationScheduleAdmission {
  let value: unknown
  try { value = JSON.parse(body) } catch { throw new Error('AWS Scheduler admission body is not JSON.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AWS Scheduler admission body must be an object.')
  const read = (name: string): unknown => Reflect.get(value, name)
  if (read('schemaVersion') !== 'applik8s.scheduleAdmission/v1alpha1'
    || typeof read('definitionId') !== 'string'
    || typeof read('instanceId') !== 'string'
    || (read('overlap') !== 'allow' && read('overlap') !== 'skip')
    || typeof read('overlapKey') !== 'string'
    || !String(read('overlapKey')).trim()
    || typeof read('scheduledAt') !== 'string'
    || !Number.isFinite(Date.parse(String(read('scheduledAt'))))) {
    throw new Error('AWS Scheduler admission body does not match applik8s.scheduleAdmission/v1alpha1.')
  }
  const input = read('input')
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) {
    throw new Error('AWS Scheduler admission input must be an object.')
  }
  return {
    schemaVersion: 'applik8s.scheduleAdmission/v1alpha1',
    applicationId: configuration.applicationId,
    environmentId: configuration.environmentId,
    definitionId: String(read('definitionId')),
    instanceId: String(read('instanceId')),
    scheduledAt: new Date(String(read('scheduledAt'))).toISOString(),
    admittedAt: new Date().toISOString(),
    attempt,
    overlap: read('overlap') as 'allow' | 'skip',
    overlapKey: String(read('overlapKey')),
    ...(input ? { input: input as object } : {}),
    ...(typeof read('schedulerExecutionId') === 'string' ? { schedulerExecutionId: String(read('schedulerExecutionId')) } : {}),
  }
}

function scheduleOverlapKey(definition: ScheduleDefinition, instance: ScheduleInstance): string {
  const value = definition.overlapBy ? definition.overlapBy(instance.input) : instance.id
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Schedule ${definition.id}/${instance.id} produced an empty overlap key.`)
  }
  if (Buffer.byteLength(value, 'utf8') > 512) {
    throw new Error(`Schedule ${definition.id}/${instance.id} produced an overlap key larger than 512 bytes.`)
  }
  return value
}

function awsScheduleExpression(instance: ScheduleInstance, definition?: ScheduleDefinition): string {
  if (definition?.requirements?.precision === 'second') {
    throw new Error(`AWS Scheduler cannot satisfy second-precision schedule ${definition.id}.`)
  }
  const choices = [instance.cron, instance.every, instance.at].filter((value) => value !== undefined)
  if (choices.length !== 1) throw new Error(`Dynamic schedule ${instance.id} requires exactly one of cron, every, or at.`)
  if (instance.cron) return `cron(${instance.cron})`
  if (instance.every) {
    const match = /^(\d+)(s|m|h|d)$/u.exec(instance.every.trim())
    if (!match) throw new Error(`Dynamic schedule ${instance.id} has an invalid interval.`)
    const amount = Number(match[1])
    if (match[2] === 's' && amount % 60 !== 0) {
      throw new Error(`AWS Scheduler cannot preserve interval ${instance.every} for ${instance.id}; second intervals must be exact multiples of 60 seconds.`)
    }
    const unit = match[2] === 's' ? 'minute' : match[2] === 'm' ? 'minute' : match[2] === 'h' ? 'hour' : 'day'
    const normalizedAmount = match[2] === 's' ? amount / 60 : amount
    return `rate(${normalizedAmount} ${unit}${normalizedAmount === 1 ? '' : 's'})`
  }
  const date = new Date(instance.at!)
  if (!Number.isFinite(date.getTime())) throw new Error(`Dynamic schedule ${instance.id} has an invalid one-time timestamp.`)
  return `at(${date.toISOString().replace(/\.\d{3}Z$/u, '')})`
}

async function readSchedule(client: SchedulerClient, groupName: string, name: string) {
  try {
    return await client.send(new GetScheduleCommand({ GroupName: groupName, Name: name }))
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
}

function isNotFound(error: unknown): boolean {
  const metadata = error && typeof error === 'object' ? Reflect.get(error, '$metadata') : undefined
  return error instanceof ResourceNotFoundException
    || (error !== null && typeof error === 'object' && (Reflect.get(error, 'name') === 'ResourceNotFoundException'
      || (metadata !== null && typeof metadata === 'object' && Reflect.get(metadata, 'httpStatusCode') === 404)))
}

function jsonValue(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue
}

function dynamicScheduleName(configuration: AwsApplicationScheduleRuntimeConfiguration, definitionId: string, instanceId: string): string {
  const suffix = createHash('sha256').update(`${configuration.applicationId}\0${configuration.environmentId}\0${definitionId}\0${instanceId}`).digest('hex').slice(0, 24)
  return `applik8s-${safeName(definitionId, 20)}-${suffix}`.slice(0, 64)
}

function safeName(value: string, maximum: number): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, maximum) || 'schedule'
}

function scheduleDescription(revision: string, digest: string, management?: string): string {
  return `applik8s.schedule/v1:${base64Url(JSON.stringify({ revision, digest, ...(management ? { management } : {}) }))}`
}

function parseScheduleDescription(value: string | undefined): { readonly revision: string; readonly digest: string } | undefined {
  const prefix = 'applik8s.schedule/v1:'
  if (!value?.startsWith(prefix)) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value.slice(prefix.length), 'base64url').toString('utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const revision = Reflect.get(parsed, 'revision')
    const digest = Reflect.get(parsed, 'digest')
    return typeof revision === 'string' && revision.length > 0 && typeof digest === 'string' && /^[a-f0-9]{64}$/u.test(digest)
      ? { revision, digest }
      : undefined
  } catch {
    return undefined
  }
}

function awsScheduleMatches(live: unknown, desired: {
  readonly ScheduleExpression: string
  readonly ScheduleExpressionTimezone: string
  readonly FlexibleTimeWindow: unknown
  readonly State: string
  readonly Target: unknown
  readonly Description: string
  readonly ActionAfterCompletion?: string
}): boolean {
  const liveRecord = live as Readonly<Record<string, unknown>>
  const liveComparable = {
    ScheduleExpression: liveRecord.ScheduleExpression,
    ScheduleExpressionTimezone: liveRecord.ScheduleExpressionTimezone,
    FlexibleTimeWindow: liveRecord.FlexibleTimeWindow,
    State: liveRecord.State,
    Target: liveRecord.Target,
    Description: liveRecord.Description,
    ...(liveRecord.ActionAfterCompletion ? { ActionAfterCompletion: liveRecord.ActionAfterCompletion } : {}),
  }
  const desiredComparable = {
    ScheduleExpression: desired.ScheduleExpression,
    ScheduleExpressionTimezone: desired.ScheduleExpressionTimezone,
    FlexibleTimeWindow: desired.FlexibleTimeWindow,
    State: desired.State,
    Target: desired.Target,
    Description: desired.Description,
    ...(desired.ActionAfterCompletion ? { ActionAfterCompletion: desired.ActionAfterCompletion } : {}),
  }
  return canonicalJsonV1String(liveComparable, canonicalJsonCompatibleV1Policy)
    === canonicalJsonV1String(desiredComparable, canonicalJsonCompatibleV1Policy)
}

function scheduleClientToken(
  configuration: AwsApplicationScheduleRuntimeConfiguration,
  definitionId: string,
  instanceId: string,
  revision: string,
  digest: string,
): string {
  return createHash('sha256')
    .update(`${configuration.applicationId}\0${configuration.environmentId}\0${definitionId}\0${instanceId}\0${revision}\0${digest}`)
    .digest('hex')
}

function compareRevision(left: string, right: string): number {
  if (/^\d+$/u.test(left) && /^\d+$/u.test(right)) {
    return BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0
  }
  return left.localeCompare(right)
}

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function validateConfiguration(value: AwsApplicationScheduleRuntimeConfiguration): void {
  for (const [name, entry] of Object.entries(value)) {
    if (name === 'region') continue
    if (typeof entry !== 'string' || !entry.trim()) throw new Error(`AWS schedule runtime configuration ${name} is required.`)
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)))
}

async function deleteMessage(client: SQSClient, queueUrl: string, receiptHandle: string): Promise<void> {
  await client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }))
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

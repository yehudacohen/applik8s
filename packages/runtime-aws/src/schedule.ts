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
  readonly groupName: string
  readonly executionRoleArn: string
  readonly databaseUrl: string
}

interface ScheduleDefinition {
  readonly id: string
  readonly configuration: 'fixed' | 'dynamic'
  readonly timezone: string
  readonly retry: { readonly maxAttempts: number; readonly maximumAgeSeconds: number }
  readonly requirements?: { readonly precision?: 'minute' | 'second' }
}

interface ScheduleInstance {
  readonly id: string
  readonly revision: string
  readonly input: object
  readonly cron?: string
  readonly every?: string
  readonly at?: string | Date
  readonly timezone?: string
  readonly enabled?: boolean
  readonly deleteAfterCompletion?: boolean
}

interface ScheduleHandlerRequest {
  readonly definition: ScheduleDefinition
  readonly input: object
  readonly handler: (input: object, context: Record<string, unknown>) => unknown | Promise<unknown>
}

interface ScheduleReconcileRequest extends ScheduleHandlerRequest {
  readonly instance: ScheduleInstance
}

/**
 * AWS Scheduler runtime used by function-native `.schedule()` calls. Static
 * schedules are reconciled by CloudFormation; dynamic instances use the same
 * group, queue, role, admission envelope, and lifecycle identity.
 */
export function createAwsApplicationScheduleRuntime(
  configuration: AwsApplicationScheduleRuntimeConfiguration,
): {
  invoke(request: ScheduleHandlerRequest): Promise<unknown>
  reconcile(request: ScheduleReconcileRequest): Promise<{
    readonly definitionId: string
    readonly instanceId: string
    readonly revision: string
    readonly state: 'created' | 'updated' | 'unchanged'
  }>
  remove(definitionId: string, instanceId: string): Promise<{
    readonly definitionId: string
    readonly instanceId: string
    readonly revision: string
    readonly state: 'removed' | 'unchanged'
  }>
} {
  validateConfiguration(configuration)
  const scheduler = new SchedulerClient(configuration.region ? { region: configuration.region } : {})
  return {
    async invoke(request) {
      const now = new Date().toISOString()
      return request.handler(request.input, {
        definitionId: request.definition.id,
        instanceId: 'immediate',
        occurrenceId: occurrenceId(configuration, request.definition.id, 'immediate', now),
        scheduledAt: now,
        admittedAt: now,
        startedAt: now,
        attempt: 1,
        trigger: 'immediate',
        signal: new AbortController().signal,
      })
    },
    async reconcile(request) {
      if (request.definition.configuration !== 'dynamic') {
        throw new Error(`AWS Scheduler cannot reconcile a dynamic instance for fixed definition ${request.definition.id}.`)
      }
      const name = dynamicScheduleName(configuration, request.definition.id, request.instance.id)
      const existed = await scheduleExists(scheduler, configuration.groupName, name)
      const target = {
        Arn: configuration.queueArn,
        RoleArn: configuration.executionRoleArn,
        Input: JSON.stringify({
          schemaVersion: 'applik8s.scheduleAdmission/v1alpha1',
          definitionId: request.definition.id,
          instanceId: request.instance.id,
          input: request.instance.input,
          scheduledAt: '<aws.scheduler.scheduled-time>',
          schedulerExecutionId: '<aws.scheduler.execution-id>',
          schedulerAttempt: '<aws.scheduler.attempt-number>',
        }),
        RetryPolicy: {
          MaximumEventAgeInSeconds: clamp(request.definition.retry.maximumAgeSeconds, 60, 86_400),
          MaximumRetryAttempts: clamp(request.definition.retry.maxAttempts - 1, 0, 185),
        },
      }
      const common = {
        Name: name,
        GroupName: configuration.groupName,
        ScheduleExpression: awsScheduleExpression(request.instance, request.definition),
        ScheduleExpressionTimezone: request.instance.timezone ?? request.definition.timezone,
        FlexibleTimeWindow: { Mode: 'OFF' as const },
        State: request.instance.enabled === false ? 'DISABLED' as const : 'ENABLED' as const,
        Target: target,
        ...(request.instance.at && request.instance.deleteAfterCompletion
          ? { ActionAfterCompletion: 'DELETE' as const }
          : {}),
      }
      if (existed) {
        await scheduler.send(new UpdateScheduleCommand(common))
      } else {
        await scheduler.send(new CreateScheduleCommand({
          ...common,
          ClientToken: createHash('sha256')
            .update(`${configuration.applicationId}\0${configuration.environmentId}\0${request.definition.id}\0${request.instance.id}\0${request.instance.revision}`)
            .digest('hex'),
        }))
      }
      return {
        definitionId: request.definition.id,
        instanceId: request.instance.id,
        revision: request.instance.revision,
        state: existed ? 'updated' : 'created',
      }
    },
    async remove(definitionId, instanceId) {
      const name = dynamicScheduleName(configuration, definitionId, instanceId)
      try {
        await scheduler.send(new DeleteScheduleCommand({ Name: name, GroupName: configuration.groupName }))
        return { definitionId, instanceId, revision: 'deleted', state: 'removed' }
      } catch (error) {
        if (isNotFound(error)) return { definitionId, instanceId, revision: 'absent', state: 'unchanged' }
        throw error
      }
    },
  }
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
        const id = occurrenceId(options.configuration, admission.definitionId, admission.instanceId, admission.scheduledAt, admission.schedulerExecutionId)
        const claim = await claimOccurrence(options.sql, id)
        if (claim.state === 'busy') continue
        if (claim.state === 'complete') {
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
    state text NOT NULL CHECK (state IN ('running', 'succeeded', 'skipped')),
    lease_owner text,
    lease_until timestamptz,
    receipt jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`
}

type OccurrenceClaim =
  | { readonly state: 'claimed'; readonly leaseOwner: string }
  | { readonly state: 'complete' }
  | { readonly state: 'busy' }

async function claimOccurrence(sql: Sql, id: string): Promise<OccurrenceClaim> {
  const owner = randomUUID()
  const rows = await sql<{ state: string }[]>`
    INSERT INTO applik8s_schedule_occurrences (occurrence_id, state, lease_owner, lease_until)
    VALUES (${id}, 'running', ${owner}, now() + interval '5 minutes')
    ON CONFLICT (occurrence_id) DO UPDATE SET
      lease_owner = EXCLUDED.lease_owner,
      lease_until = EXCLUDED.lease_until,
      updated_at = now()
    WHERE applik8s_schedule_occurrences.state = 'running'
      AND (applik8s_schedule_occurrences.lease_until IS NULL OR applik8s_schedule_occurrences.lease_until < now())
    RETURNING state
  `
  if (rows.length > 0) return { state: 'claimed', leaseOwner: owner }
  const existing = await sql<{ state: string }[]>`SELECT state FROM applik8s_schedule_occurrences WHERE occurrence_id = ${id}`
  return existing[0]?.state === 'succeeded' || existing[0]?.state === 'skipped' ? { state: 'complete' } : { state: 'busy' }
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
    ...(input ? { input: input as object } : {}),
    ...(typeof read('schedulerExecutionId') === 'string' ? { schedulerExecutionId: String(read('schedulerExecutionId')) } : {}),
  }
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

async function scheduleExists(client: SchedulerClient, groupName: string, name: string): Promise<boolean> {
  try {
    await client.send(new GetScheduleCommand({ GroupName: groupName, Name: name }))
    return true
  } catch (error) {
    if (isNotFound(error)) return false
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

function occurrenceId(configuration: AwsApplicationScheduleRuntimeConfiguration, definitionId: string, instanceId: string, scheduledAt: string, schedulerExecutionId?: string): string {
  return `occ_${createHash('sha256').update(`${configuration.applicationId}\0${configuration.environmentId}\0${definitionId}\0${instanceId}\0${schedulerExecutionId?.trim() || scheduledAt}`).digest('hex')}`
}

function safeName(value: string, maximum: number): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, maximum) || 'schedule'
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

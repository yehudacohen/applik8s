CREATE TYPE "public"."applik8s_approval_state" AS ENUM('pending', 'approved', 'denied', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."applik8s_outcome_observation_state" AS ENUM('pending', 'satisfied', 'failed', 'unprovable');--> statement-breakpoint
CREATE TYPE "public"."applik8s_artifact_state" AS ENUM('pending', 'available', 'quarantined', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."applik8s_conversation_event_visibility" AS ENUM('browser', 'audit-only');--> statement-breakpoint
CREATE TYPE "public"."applik8s_conversation_message_state" AS ENUM('committed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."applik8s_conversation_role" AS ENUM('system', 'user', 'assistant', 'tool');--> statement-breakpoint
CREATE TYPE "public"."applik8s_conversation_run_state" AS ENUM('running', 'interrupted', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."applik8s_evaluation_run_state" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" text DEFAULT nullif(current_setting('applik8s.principal.id', true), '') NOT NULL,
	"operation" text NOT NULL,
	"target" text NOT NULL,
	"evidence" text NOT NULL,
	"intended_outcome" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"approved_by" text,
	"decision_receipt" text,
	"created_at" text DEFAULT '' NOT NULL,
	"decided_at" text,
	"revision" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_approval_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_request_id" text NOT NULL,
	"principal_scope" text NOT NULL,
	"requested_by_identity_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"target" jsonb NOT NULL,
	"requested_scope" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"intended_outcome_id" text,
	"status" "applik8s_approval_state" DEFAULT 'pending' NOT NULL,
	"reviewer_identity_id" text,
	"decision_reason" text,
	"authority_revision" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_outcome_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"outcome_id" text NOT NULL,
	"status" "applik8s_outcome_observation_state" DEFAULT 'pending' NOT NULL,
	"evidence" jsonb NOT NULL,
	"observed_by" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_scope" text NOT NULL,
	"kind" text NOT NULL,
	"media_type" text NOT NULL,
	"state" "applik8s_artifact_state" DEFAULT 'pending' NOT NULL,
	"store" text NOT NULL,
	"object_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size" bigint NOT NULL,
	"conversation_id" text,
	"protocol_run_id" text,
	"agent_run_id" text,
	"workflow_run_id" text,
	"invocation_id" text,
	"provenance" jsonb NOT NULL,
	"retention_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_conversation_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_scope" text NOT NULL,
	"conversation_id" text,
	"namespace" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"content" jsonb NOT NULL,
	"retention_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_conversation_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"role" "applik8s_conversation_role" NOT NULL,
	"content" jsonb NOT NULL,
	"state" "applik8s_conversation_message_state" DEFAULT 'committed' NOT NULL,
	"invocation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_conversation_run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"visibility" "applik8s_conversation_event_visibility" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_conversation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"principal_scope" text NOT NULL,
	"status" "applik8s_conversation_run_state" NOT NULL,
	"agent_run_id" text,
	"invocation_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terminal_reason" text
);
--> statement-breakpoint
CREATE TABLE "applik8s_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_scope" text NOT NULL,
	"title" text,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"retention_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "applik8s_evaluation_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"dataset_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"expected" jsonb NOT NULL,
	"tags" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_evaluation_datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"revision" text NOT NULL,
	"schema_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_evaluation_results" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"case_id" text NOT NULL,
	"score" real NOT NULL,
	"evidence" jsonb NOT NULL,
	"artifact_id" text,
	"invocation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_evaluation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"dataset_id" text NOT NULL,
	"scorer_id" text NOT NULL,
	"logical_model" text NOT NULL,
	"status" "applik8s_evaluation_run_state" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_evaluation_scorers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"revision" text NOT NULL,
	"implementation_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_scope" text NOT NULL,
	"capability" text NOT NULL,
	"limit" bigint,
	"period" text,
	"constraints" jsonb NOT NULL,
	"authority_revision" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "applik8s_usage_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_scope" text NOT NULL,
	"operation_id" text,
	"invocation_id" text,
	"attempt_id" text,
	"provider" text,
	"backend" text,
	"logical_model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cached_input_tokens" integer,
	"reasoning_tokens" integer,
	"cost_microunits" bigint,
	"pricing_revision" text,
	"confidence" text NOT NULL,
	"dimensions" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applik8s_outcome_observations" ADD CONSTRAINT "applik8s_outcome_observations_review_id_applik8s_approval_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."applik8s_approval_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applik8s_conversation_memory" ADD CONSTRAINT "applik8s_conversation_memory_conversation_id_applik8s_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."applik8s_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applik8s_conversation_messages" ADD CONSTRAINT "applik8s_conversation_messages_conversation_id_applik8s_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."applik8s_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applik8s_conversation_run_events" ADD CONSTRAINT "applik8s_conversation_run_events_run_id_applik8s_conversation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."applik8s_conversation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applik8s_conversation_runs" ADD CONSTRAINT "applik8s_conversation_runs_conversation_id_applik8s_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."applik8s_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applik8s_evaluation_cases" ADD CONSTRAINT "applik8s_evaluation_cases_dataset_id_applik8s_evaluation_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."applik8s_evaluation_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applik8s_evaluation_results" ADD CONSTRAINT "applik8s_evaluation_results_run_id_applik8s_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."applik8s_evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applik8s_evaluation_results" ADD CONSTRAINT "applik8s_evaluation_results_case_id_applik8s_evaluation_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."applik8s_evaluation_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applik8s_evaluation_runs" ADD CONSTRAINT "applik8s_evaluation_runs_dataset_id_applik8s_evaluation_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."applik8s_evaluation_datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applik8s_evaluation_runs" ADD CONSTRAINT "applik8s_evaluation_runs_scorer_id_applik8s_evaluation_scorers_id_fk" FOREIGN KEY ("scorer_id") REFERENCES "public"."applik8s_evaluation_scorers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_requests_state_created" ON "access_requests" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "access_requests_requester" ON "access_requests" USING btree ("requested_by","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_approval_reviews_request_uidx" ON "applik8s_approval_reviews" USING btree ("grant_request_id");--> statement-breakpoint
CREATE INDEX "applik8s_approval_reviews_queue_idx" ON "applik8s_approval_reviews" USING btree ("principal_scope","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_outcome_observations_grant_uidx" ON "applik8s_outcome_observations" USING btree ("grant_id","outcome_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_artifacts_object_uidx" ON "applik8s_artifacts" USING btree ("store","object_key","sha256");--> statement-breakpoint
CREATE INDEX "applik8s_artifacts_scope_created_idx" ON "applik8s_artifacts" USING btree ("principal_scope","created_at");--> statement-breakpoint
CREATE INDEX "applik8s_artifacts_run_idx" ON "applik8s_artifacts" USING btree ("protocol_run_id","created_at");--> statement-breakpoint
CREATE INDEX "applik8s_conversation_memory_scope_namespace_idx" ON "applik8s_conversation_memory" USING btree ("principal_scope","namespace","retention_until");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_conversation_messages_revision_uidx" ON "applik8s_conversation_messages" USING btree ("conversation_id","revision");--> statement-breakpoint
CREATE INDEX "applik8s_conversation_messages_created_idx" ON "applik8s_conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_conversation_run_events_sequence_uidx" ON "applik8s_conversation_run_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "applik8s_conversation_run_events_created_idx" ON "applik8s_conversation_run_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "applik8s_conversation_runs_scope_status_idx" ON "applik8s_conversation_runs" USING btree ("principal_scope","status","updated_at");--> statement-breakpoint
CREATE INDEX "applik8s_conversation_runs_conversation_idx" ON "applik8s_conversation_runs" USING btree ("conversation_id","updated_at");--> statement-breakpoint
CREATE INDEX "applik8s_conversations_scope_updated_idx" ON "applik8s_conversations" USING btree ("principal_scope","updated_at");--> statement-breakpoint
CREATE INDEX "applik8s_evaluation_cases_dataset_idx" ON "applik8s_evaluation_cases" USING btree ("dataset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_evaluation_datasets_revision_uidx" ON "applik8s_evaluation_datasets" USING btree ("name","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_evaluation_results_case_uidx" ON "applik8s_evaluation_results" USING btree ("run_id","case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_evaluation_scorers_revision_uidx" ON "applik8s_evaluation_scorers" USING btree ("name","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_entitlements_scope_capability_uidx" ON "applik8s_entitlements" USING btree ("principal_scope","capability","authority_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_usage_facts_attempt_uidx" ON "applik8s_usage_facts" USING btree ("attempt_id","pricing_revision");--> statement-breakpoint
CREATE INDEX "applik8s_usage_facts_scope_time_idx" ON "applik8s_usage_facts" USING btree ("principal_scope","occurred_at");
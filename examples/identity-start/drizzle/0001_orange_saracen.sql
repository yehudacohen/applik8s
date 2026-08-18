CREATE TYPE "public"."applik8s_billing_catalog_version_state" AS ENUM('draft', 'published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."applik8s_billing_model" AS ENUM('flat', 'per_seat', 'metered');--> statement-breakpoint
CREATE TYPE "public"."applik8s_billing_usage_delivery_state" AS ENUM('pending', 'delivering', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."applik8s_subscription_state" AS ENUM('trialing', 'active', 'past_due', 'paused', 'unpaid', 'cancelled', 'incomplete');--> statement-breakpoint
CREATE TABLE "applik8s_billing_catalog_entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_version_id" text NOT NULL,
	"capability" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"quantity_limit" bigint,
	"constraints" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_billing_catalog_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_version_id" text NOT NULL,
	"billing_model" "applik8s_billing_model" NOT NULL,
	"interval" text,
	"unit_amount_microunits" bigint NOT NULL,
	"included_quantity" bigint,
	"meter_key" text,
	"provider" text NOT NULL,
	"provider_product_id" text,
	"provider_price_id" text,
	"lookup_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_billing_catalog_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"version" integer NOT NULL,
	"state" "applik8s_billing_catalog_version_state" NOT NULL,
	"currency" text NOT NULL,
	"recommended" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_billing_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_scope" text NOT NULL,
	"provider" text NOT NULL,
	"provider_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_billing_meters" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"aggregation" text NOT NULL,
	"event_name" text NOT NULL,
	"provider" text NOT NULL,
	"provider_meter_id" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_billing_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"interval" text NOT NULL,
	"price_microunits" bigint NOT NULL,
	"currency" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_billing_subscription_items" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"catalog_price_id" text,
	"provider_subscription_item_id" text,
	"provider_price_id" text,
	"billing_model" "applik8s_billing_model" NOT NULL,
	"meter_key" text,
	"quantity" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_billing_usage_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"principal_scope" text NOT NULL,
	"subscription_item_id" text,
	"meter_key" text NOT NULL,
	"quantity" bigint NOT NULL,
	"billable_quantity" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"dimensions" jsonb NOT NULL,
	"delivery_state" "applik8s_billing_usage_delivery_state" NOT NULL,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"provider_event_id" text,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_payment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"principal_scope" text NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_scope" text NOT NULL,
	"plan_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_customer_id" text NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"status" "applik8s_subscription_state" NOT NULL,
	"catalog_version_id" text,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"scheduled_catalog_version_id" text,
	"scheduled_change_at" timestamp with time zone,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"provider_occurred_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applik8s_authority_audit" (
	"application" text NOT NULL,
	"id" text NOT NULL,
	"document" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "applik8s_authority_audit_application_id_pk" PRIMARY KEY("application","id")
);
--> statement-breakpoint
CREATE TABLE "applik8s_operational_observations" (
	"application" text NOT NULL,
	"id" text NOT NULL,
	"domain" text NOT NULL,
	"subject" text NOT NULL,
	"authority" text NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"source" text NOT NULL,
	"causal_id" text,
	"evidence" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "applik8s_operational_observations_application_id_pk" PRIMARY KEY("application","id")
);
--> statement-breakpoint
ALTER TABLE "applik8s_evaluation_runs" ADD COLUMN "principal_scope" text DEFAULT coalesce(nullif(current_setting('applik8s.principal.causal_id', true), ''), nullif(current_setting('applik8s.principal.id', true), '')) NOT NULL;--> statement-breakpoint
ALTER TABLE "applik8s_usage_facts" ADD COLUMN "protocol_run_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_billing_catalog_entitlements_uidx" ON "applik8s_billing_catalog_entitlements" USING btree ("catalog_version_id","capability");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_billing_catalog_prices_lookup_uidx" ON "applik8s_billing_catalog_prices" USING btree ("provider","lookup_key");--> statement-breakpoint
CREATE INDEX "applik8s_billing_catalog_prices_version_idx" ON "applik8s_billing_catalog_prices" USING btree ("catalog_version_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_billing_catalog_versions_number_uidx" ON "applik8s_billing_catalog_versions" USING btree ("plan_id","version");--> statement-breakpoint
CREATE INDEX "applik8s_billing_catalog_versions_state_idx" ON "applik8s_billing_catalog_versions" USING btree ("plan_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_billing_customers_scope_uidx" ON "applik8s_billing_customers" USING btree ("principal_scope","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_billing_customers_provider_uidx" ON "applik8s_billing_customers" USING btree ("provider","provider_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_billing_meters_key_uidx" ON "applik8s_billing_meters" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_billing_meters_event_uidx" ON "applik8s_billing_meters" USING btree ("provider","event_name");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_billing_subscription_items_provider_uidx" ON "applik8s_billing_subscription_items" USING btree ("provider_subscription_item_id");--> statement-breakpoint
CREATE INDEX "applik8s_billing_subscription_items_subscription_idx" ON "applik8s_billing_subscription_items" USING btree ("subscription_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_billing_usage_ledger_idempotency_uidx" ON "applik8s_billing_usage_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "applik8s_billing_usage_ledger_delivery_idx" ON "applik8s_billing_usage_ledger" USING btree ("delivery_state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "applik8s_billing_usage_ledger_scope_time_idx" ON "applik8s_billing_usage_ledger" USING btree ("principal_scope","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_payment_events_provider_uidx" ON "applik8s_payment_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "applik8s_payment_events_scope_time_idx" ON "applik8s_payment_events" USING btree ("principal_scope","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_subscriptions_scope_uidx" ON "applik8s_subscriptions" USING btree ("principal_scope");--> statement-breakpoint
CREATE UNIQUE INDEX "applik8s_subscriptions_provider_uidx" ON "applik8s_subscriptions" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE INDEX "applik8s_subscriptions_status_idx" ON "applik8s_subscriptions" USING btree ("status","period_end");--> statement-breakpoint
CREATE INDEX "applik8s_authority_audit_occurred_at_idx" ON "applik8s_authority_audit" USING btree ("application","occurred_at");--> statement-breakpoint
CREATE INDEX "applik8s_operational_observations_domain_state_idx" ON "applik8s_operational_observations" USING btree ("application","domain","state","observed_at");--> statement-breakpoint
CREATE INDEX "applik8s_operational_observations_subject_idx" ON "applik8s_operational_observations" USING btree ("application","subject","observed_at");--> statement-breakpoint
CREATE INDEX "applik8s_evaluation_runs_scope_created_idx" ON "applik8s_evaluation_runs" USING btree ("principal_scope","created_at");
-- migration-lint:allow=no-bare-create-index reason=indexes and FKs target brand-new empty MARLIN hotspot and AI tables; CONCURRENTLY cannot run inside the migration transaction
CREATE TABLE "marlin_ai_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"slot" text NOT NULL,
	"provider_id" text NOT NULL,
	"model" text NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"temperature" real DEFAULT 0.4 NOT NULL,
	"max_tokens" integer DEFAULT 4096 NOT NULL,
	"daily_budget_cents" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marlin_ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role_id" text NOT NULL,
	"project_id" text,
	"operation" text NOT NULL,
	"provider_id" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marlin_hotspot_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_id" text NOT NULL,
	"theme_id" text,
	"event_hash" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"summary" text,
	"published_at" timestamp with time zone,
	"score" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'inbox' NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marlin_hotspot_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"theme_id" text,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"format" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"daily_quota" integer DEFAULT 20 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "marlin_hotspot_themes" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"name" text NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"daily_quota" integer DEFAULT 20 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marlin_ai_usage" ADD CONSTRAINT "marlin_ai_usage_role_id_marlin_ai_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."marlin_ai_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marlin_ai_usage" ADD CONSTRAINT "marlin_ai_usage_project_id_marlin_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."marlin_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marlin_hotspot_candidates" ADD CONSTRAINT "marlin_hotspot_candidates_source_id_marlin_hotspot_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."marlin_hotspot_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marlin_hotspot_candidates" ADD CONSTRAINT "marlin_hotspot_candidates_theme_id_marlin_hotspot_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."marlin_hotspot_themes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marlin_hotspot_sources" ADD CONSTRAINT "marlin_hotspot_sources_theme_id_marlin_hotspot_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."marlin_hotspot_themes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marlin_ai_roles_slot_uniq" ON "marlin_ai_roles" USING btree ("slot");--> statement-breakpoint
CREATE INDEX "marlin_ai_usage_role_created_idx" ON "marlin_ai_usage" USING btree ("role_id","created_at");--> statement-breakpoint
CREATE INDEX "marlin_ai_usage_project_created_idx" ON "marlin_ai_usage" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marlin_hotspot_candidates_event_hash_uniq" ON "marlin_hotspot_candidates" USING btree ("event_hash");--> statement-breakpoint
CREATE INDEX "marlin_hotspot_candidates_status_created_idx" ON "marlin_hotspot_candidates" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "marlin_hotspot_candidates_theme_created_idx" ON "marlin_hotspot_candidates" USING btree ("theme_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marlin_hotspot_sources_url_uniq" ON "marlin_hotspot_sources" USING btree ("url");--> statement-breakpoint
CREATE INDEX "marlin_hotspot_sources_enabled_idx" ON "marlin_hotspot_sources" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "marlin_hotspot_themes_name_uniq" ON "marlin_hotspot_themes" USING btree ("name");

-- migration-lint:allow=no-bare-create-index reason=indexes and FKs target brand-new empty MARLIN workflow tables; CONCURRENTLY cannot run inside the migration transaction
CREATE TABLE "marlin_project_materials" (
	"project_id" text NOT NULL,
	"material_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marlin_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"title" text NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_revision_id" text,
	"approved_revision_id" text,
	"published_revision_id" text,
	"core_post_id" text
);
--> statement-breakpoint
CREATE TABLE "marlin_publications" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"core_post_id" text,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "marlin_review_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"idempotency_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marlin_review_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"passcode_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "marlin_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"content" text NOT NULL,
	"category_id" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"copyright" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marlin_project_materials" ADD CONSTRAINT "marlin_project_materials_project_id_marlin_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."marlin_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marlin_project_materials" ADD CONSTRAINT "marlin_project_materials_material_id_marlin_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."marlin_materials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marlin_publications" ADD CONSTRAINT "marlin_publications_project_id_marlin_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."marlin_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marlin_publications" ADD CONSTRAINT "marlin_publications_revision_id_marlin_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."marlin_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marlin_review_decisions" ADD CONSTRAINT "marlin_review_decisions_request_id_marlin_review_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."marlin_review_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marlin_review_decisions" ADD CONSTRAINT "marlin_review_decisions_revision_id_marlin_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."marlin_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marlin_review_requests" ADD CONSTRAINT "marlin_review_requests_project_id_marlin_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."marlin_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marlin_review_requests" ADD CONSTRAINT "marlin_review_requests_revision_id_marlin_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."marlin_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marlin_revisions" ADD CONSTRAINT "marlin_revisions_project_id_marlin_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."marlin_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marlin_project_materials_pk" ON "marlin_project_materials" USING btree ("project_id","material_id");--> statement-breakpoint
CREATE INDEX "marlin_project_materials_material_idx" ON "marlin_project_materials" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "marlin_projects_status_updated_idx" ON "marlin_projects" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "marlin_publications_project_created_idx" ON "marlin_publications" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "marlin_publications_status_scheduled_idx" ON "marlin_publications" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marlin_review_decisions_idempotency_uniq" ON "marlin_review_decisions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "marlin_review_decisions_request_uniq" ON "marlin_review_decisions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "marlin_review_requests_project_status_idx" ON "marlin_review_requests" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "marlin_review_requests_revision_idx" ON "marlin_review_requests" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marlin_revisions_project_version_uniq" ON "marlin_revisions" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "marlin_revisions_project_created_idx" ON "marlin_revisions" USING btree ("project_id","created_at");

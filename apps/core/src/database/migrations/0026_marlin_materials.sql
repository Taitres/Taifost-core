-- migration-lint:allow=no-bare-create-index reason=indexes and FK target brand-new empty MARLIN tables; CONCURRENTLY cannot run inside the migration transaction
CREATE TABLE "marlin_material_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"material_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text,
	"original_filename" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marlin_materials" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"mime_type" text DEFAULT 'text/plain' NOT NULL,
	"byte_size" integer NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"analysis" jsonb,
	"analyzed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "marlin_material_imports" ADD CONSTRAINT "marlin_material_imports_material_id_marlin_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."marlin_materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marlin_material_imports_material_created_idx" ON "marlin_material_imports" USING btree ("material_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marlin_materials_content_hash_uniq" ON "marlin_materials" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "marlin_materials_created_at_idx" ON "marlin_materials" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "marlin_materials_status_created_at_idx" ON "marlin_materials" USING btree ("status","created_at");

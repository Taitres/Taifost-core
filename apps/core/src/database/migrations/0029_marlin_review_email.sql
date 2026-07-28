ALTER TABLE "marlin_review_requests" ADD COLUMN "reviewer_email" text;--> statement-breakpoint
ALTER TABLE "marlin_review_requests" ADD COLUMN "email_status" text DEFAULT 'not_requested' NOT NULL;--> statement-breakpoint
ALTER TABLE "marlin_review_requests" ADD COLUMN "email_error" text;--> statement-breakpoint
ALTER TABLE "marlin_review_requests" ADD COLUMN "emailed_at" timestamp with time zone;
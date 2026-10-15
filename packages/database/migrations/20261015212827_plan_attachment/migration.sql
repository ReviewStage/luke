CREATE TABLE IF NOT EXISTS "plan_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"plan_id" uuid NOT NULL,
	"user_id" text,
	"content_type" text NOT NULL,
	"byte_count" integer NOT NULL,
	"bytes" bytea NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"saved_at" timestamp with time zone,
	CONSTRAINT "plan_attachment_bytes_bound" CHECK (octet_length("bytes") <= 1500000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_attachment_plan" ON "plan_attachment" ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_attachment_unsaved" ON "plan_attachment" ("created_at") WHERE "saved_at" is null;--> statement-breakpoint
ALTER TABLE "plan_attachment" DROP CONSTRAINT IF EXISTS "plan_attachment_plan_id_plan_id_fkey";--> statement-breakpoint
ALTER TABLE "plan_attachment" ADD CONSTRAINT "plan_attachment_plan_id_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plan_attachment" DROP CONSTRAINT IF EXISTS "plan_attachment_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "plan_attachment" ADD CONSTRAINT "plan_attachment_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;

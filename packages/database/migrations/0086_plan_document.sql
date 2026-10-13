ALTER TABLE "plan" ADD COLUMN "document" text;
--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "section_writers" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_revision" ADD COLUMN "document" text;
--> statement-breakpoint
ALTER TABLE "plan_revision" ALTER COLUMN "fields" DROP NOT NULL;

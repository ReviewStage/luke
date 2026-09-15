ALTER TABLE "workspace_file" ADD COLUMN IF NOT EXISTS "content" text;--> statement-breakpoint
DELETE FROM "workspace_file" WHERE "content" IS NULL;--> statement-breakpoint
ALTER TABLE "workspace_file" ALTER COLUMN "content" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_file" DROP COLUMN "sealed_content";

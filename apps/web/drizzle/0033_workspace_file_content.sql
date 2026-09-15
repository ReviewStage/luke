DELETE FROM "workspace_file";--> statement-breakpoint
ALTER TABLE "workspace_file" DROP COLUMN "sealed_content";--> statement-breakpoint
ALTER TABLE "workspace_file" ADD COLUMN "content" text NOT NULL;

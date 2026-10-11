ALTER TABLE "coding_agent" ALTER COLUMN "plan_snapshot" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "coding_agent" ADD COLUMN "task" text;

ALTER TABLE "account_preference" ADD COLUMN "coding_agent_model" text;--> statement-breakpoint
ALTER TABLE "account_preference" ADD COLUMN "coding_agent_effort" text;--> statement-breakpoint
ALTER TABLE "account_preference" ALTER COLUMN "updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "account_preference" ALTER COLUMN "updated_at" DROP DEFAULT;

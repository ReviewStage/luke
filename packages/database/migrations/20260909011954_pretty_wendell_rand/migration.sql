ALTER TABLE "hosted_usage" ADD COLUMN "calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "hosted_usage" SET "calls" = "voice_calls" + "attention_reviews";--> statement-breakpoint
ALTER TABLE "hosted_usage" DROP COLUMN "voice_calls";--> statement-breakpoint
ALTER TABLE "hosted_usage" DROP COLUMN "attention_reviews";

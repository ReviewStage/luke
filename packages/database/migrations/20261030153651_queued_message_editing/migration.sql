DROP INDEX "queued_message_agent_key";--> statement-breakpoint
ALTER TABLE "queued_message" ADD COLUMN "editing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "queued_message" DROP COLUMN "client_key";--> statement-breakpoint
ALTER TABLE "queued_message" DROP COLUMN "held_until";--> statement-breakpoint
ALTER TABLE "queued_message" ALTER COLUMN "id" DROP DEFAULT;
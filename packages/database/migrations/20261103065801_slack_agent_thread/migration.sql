CREATE TABLE "slack_agent_thread" (
	"organization_id" text,
	"channel_id" text,
	"thread_ts" text,
	"agent_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"posted_turn_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "slack_agent_thread_pkey" PRIMARY KEY("organization_id","channel_id","thread_ts")
);
--> statement-breakpoint
CREATE INDEX "slack_agent_thread_agent_id" ON "slack_agent_thread" ("agent_id");--> statement-breakpoint
ALTER TABLE "slack_agent_thread" ADD CONSTRAINT "slack_agent_thread_4whamlU1R9aX_fkey" FOREIGN KEY ("organization_id") REFERENCES "slack_installation"("organization_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "slack_agent_thread" ADD CONSTRAINT "slack_agent_thread_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "slack_agent_thread" ADD CONSTRAINT "slack_agent_thread_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
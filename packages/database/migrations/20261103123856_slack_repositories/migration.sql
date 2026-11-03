CREATE TABLE "slack_channel_repository" (
	"organization_id" text,
	"channel_id" text,
	"repository" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "slack_channel_repository_pkey" PRIMARY KEY("organization_id","channel_id")
);
--> statement-breakpoint
ALTER TABLE "slack_installation" ADD COLUMN "default_repository" text;--> statement-breakpoint
ALTER TABLE "slack_channel_repository" ADD CONSTRAINT "slack_channel_repository_qtOAlRh3Xt5r_fkey" FOREIGN KEY ("organization_id") REFERENCES "slack_installation"("organization_id") ON DELETE CASCADE;
CREATE TABLE "agent_state_upload" (
	"path" text PRIMARY KEY,
	"agent_id" uuid NOT NULL,
	"granted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_state_upload_granted" ON "agent_state_upload" ("granted_at");
CREATE TABLE "agent_repository" (
	"agent_id" uuid,
	"position" integer,
	"repository" text NOT NULL,
	"base_branch" text,
	"head_branch" text,
	"published" jsonb,
	"published_read" jsonb,
	CONSTRAINT "agent_repository_pkey" PRIMARY KEY("agent_id","position")
);
--> statement-breakpoint
ALTER TABLE "agent_repository" ADD CONSTRAINT "agent_repository_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;
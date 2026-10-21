CREATE TABLE IF NOT EXISTS "agent_section_entry" (
	"user_id" text,
	"coding_agent_id" uuid,
	"section_id" uuid NOT NULL,
	"position" text,
	"added_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_section_entry_pkey" PRIMARY KEY("user_id","coding_agent_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_section_entry_agent" ON "agent_section_entry" ("coding_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_section_entry_section" ON "agent_section_entry" ("section_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent_section_entry" ADD CONSTRAINT "agent_section_entry_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent_section_entry" ADD CONSTRAINT "agent_section_entry_coding_agent_id_coding_agent_id_fkey" FOREIGN KEY ("coding_agent_id") REFERENCES "coding_agent"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent_section_entry" ADD CONSTRAINT "agent_section_entry_section_id_task_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "task_section"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

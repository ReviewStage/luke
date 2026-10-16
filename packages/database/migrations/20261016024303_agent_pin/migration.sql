CREATE TABLE IF NOT EXISTS "agent_pin" (
	"user_id" text,
	"coding_agent_id" uuid,
	"pinned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_pin_pkey" PRIMARY KEY("user_id","coding_agent_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_pin_agent" ON "agent_pin" ("coding_agent_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent_pin" ADD CONSTRAINT "agent_pin_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent_pin" ADD CONSTRAINT "agent_pin_coding_agent_id_coding_agent_id_fkey" FOREIGN KEY ("coding_agent_id") REFERENCES "coding_agent"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

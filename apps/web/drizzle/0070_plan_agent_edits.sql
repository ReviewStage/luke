ALTER TABLE "plan" ADD COLUMN "agent_edits" jsonb DEFAULT '[]'::jsonb NOT NULL;

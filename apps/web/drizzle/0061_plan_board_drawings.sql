ALTER TABLE "plan_board" ADD COLUMN IF NOT EXISTS "drawings" jsonb DEFAULT '[]'::jsonb NOT NULL;

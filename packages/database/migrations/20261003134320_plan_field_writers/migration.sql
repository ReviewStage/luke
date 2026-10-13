ALTER TABLE "plan" ADD COLUMN "field_writers" jsonb DEFAULT '[]'::jsonb NOT NULL;

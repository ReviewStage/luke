DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'asks' AND column_name = 'question'
  ) THEN
    ALTER TABLE "asks" ALTER COLUMN "question" DROP NOT NULL;
  END IF;
END $$;

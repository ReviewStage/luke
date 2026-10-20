-- The primary key moves onto P04's unique index over (user_id, provider, kind) in one statement: nothing is rebuilt, and the table never stands without a key. Every deployment since #4205 upserts on those three columns.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.account_provider_key'::regclass
      AND conname = 'account_provider_key_user_id_provider_pk'
  ) THEN
    ALTER TABLE "account_provider_key"
      DROP CONSTRAINT "account_provider_key_user_id_provider_pk",
      ADD CONSTRAINT "account_provider_key_pkey" PRIMARY KEY USING INDEX "account_provider_key_user_provider_kind_idx";
  END IF;
END $$;

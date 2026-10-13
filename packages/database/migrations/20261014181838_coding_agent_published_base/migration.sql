UPDATE "coding_agent" SET "published" = NULL WHERE "published" IS NOT NULL AND NOT ("published" ? 'base');

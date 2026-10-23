-- Custom SQL migration file, put your code below! --
-- An agent goes by its title, which says what it works on, never a human name, so the names given before that are cleared.
UPDATE "coding_agent" SET "persona_name" = NULL WHERE "persona_name" IS NOT NULL;

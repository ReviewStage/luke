-- Custom SQL migration file, put your code below! --
-- A member's operator is Luke, never a teammate with a first name, so the names given before that are cleared.
UPDATE "coding_agent" SET "persona_name" = NULL WHERE "kind" = 'operator' AND "persona_name" IS NOT NULL;

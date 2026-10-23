-- Custom SQL migration file, put your code below! --
-- An agent goes by its title, which says what it works on, never a human name, so the names given before that are cleared.
-- Note that an archive an agent made names that agent as it stood, so one that named it by its human name is renamed to the title, or model, it goes by now first.
UPDATE "coding_agent" AS "archived" SET "archived_by" = jsonb_set("archived"."archived_by", '{agentName}', to_jsonb(coalesce("archiver"."title", "archiver"."model"))) FROM "coding_agent" AS "archiver" WHERE "archiver"."id"::text = "archived"."archived_by"->>'agentId' AND "archiver"."persona_name" IS NOT NULL AND "archived"."archived_by"->>'agentName' = "archiver"."persona_name";
--> statement-breakpoint
UPDATE "coding_agent" SET "persona_name" = NULL WHERE "persona_name" IS NOT NULL;

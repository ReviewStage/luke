-- Custom SQL migration file, put your code below! --
-- Contract step of dropping coding_agent.persona_name: no module has declared it since #4741 reached production, and nothing has read or written it since #4738.
ALTER TABLE "coding_agent" DROP COLUMN IF EXISTS "persona_name";

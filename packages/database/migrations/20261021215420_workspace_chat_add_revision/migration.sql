ALTER TABLE "workspace_chat" ADD COLUMN IF NOT EXISTS "revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- The workspace's chat revision moved on, its row made where the workspace has none yet. A row going with its workspace moves nothing, so a workspace deleted is not made again.
CREATE OR REPLACE FUNCTION "workspace_chat_revise"(organization text, going boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
	IF going THEN
		UPDATE "workspace_chat" SET "revision" = "revision" + 1 WHERE "organization_id" = organization;
	ELSE
		INSERT INTO "workspace_chat" ("organization_id", "revision") VALUES (organization, 1)
		ON CONFLICT ("organization_id") DO UPDATE SET "revision" = "workspace_chat"."revision" + 1;
	END IF;
END
$$;
--> statement-breakpoint
-- A member or a channel made, changed, or gone revises its workspace's chat, and both workspaces where it moved between them.
CREATE OR REPLACE FUNCTION "workspace_chat_revise_row"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP <> 'INSERT' THEN
		PERFORM "workspace_chat_revise"(OLD."organization_id", TG_OP = 'DELETE');
	END IF;
	IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW."organization_id" IS DISTINCT FROM OLD."organization_id") THEN
		PERFORM "workspace_chat_revise"(NEW."organization_id", false);
	END IF;
	RETURN NULL;
END
$$;
--> statement-breakpoint
-- An agent renamed or moved to another plan revises the chat of the workspace it is a member of.
CREATE OR REPLACE FUNCTION "workspace_chat_revise_agent"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	PERFORM "workspace_chat_revise"("organization_id", false) FROM "chat_member" WHERE "agent_id" = NEW."id";
	RETURN NULL;
END
$$;
--> statement-breakpoint
-- A person renamed revises the chat of every workspace they are a member of.
CREATE OR REPLACE FUNCTION "workspace_chat_revise_person"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	PERFORM "workspace_chat_revise"("organization_id", false) FROM "chat_member" WHERE "user_id" = NEW."id";
	RETURN NULL;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "workspace_chat_revise_member" ON "chat_member";
--> statement-breakpoint
-- Note that a member's cursors and notice are left out, since a read moves them and the roster reads none of them.
CREATE TRIGGER "workspace_chat_revise_member" AFTER INSERT OR DELETE OR UPDATE OF "organization_id", "kind", "user_id", "agent_id", "ordinal", "left_at" ON "chat_member" FOR EACH ROW EXECUTE FUNCTION "workspace_chat_revise_row"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "workspace_chat_revise_channel" ON "chat_channel";
--> statement-breakpoint
CREATE TRIGGER "workspace_chat_revise_channel" AFTER INSERT OR DELETE OR UPDATE ON "chat_channel" FOR EACH ROW EXECUTE FUNCTION "workspace_chat_revise_row"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "workspace_chat_revise_agent" ON "coding_agent";
--> statement-breakpoint
CREATE TRIGGER "workspace_chat_revise_agent" AFTER UPDATE OF "title", "persona_name", "model", "task_id" ON "coding_agent" FOR EACH ROW WHEN (NEW."title" IS DISTINCT FROM OLD."title" OR NEW."persona_name" IS DISTINCT FROM OLD."persona_name" OR NEW."model" IS DISTINCT FROM OLD."model" OR NEW."task_id" IS DISTINCT FROM OLD."task_id") EXECUTE FUNCTION "workspace_chat_revise_agent"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "workspace_chat_revise_person" ON "user";
--> statement-breakpoint
CREATE TRIGGER "workspace_chat_revise_person" AFTER UPDATE OF "name" ON "user" FOR EACH ROW WHEN (NEW."name" IS DISTINCT FROM OLD."name") EXECUTE FUNCTION "workspace_chat_revise_person"();

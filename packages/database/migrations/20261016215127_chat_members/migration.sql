-- Idempotent, so a preview database that ran this change under an earlier draft folder name runs it again as a no-op.
CREATE TABLE IF NOT EXISTS "chat_channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"plan_id" uuid,
	"dm_a_member_id" uuid,
	"dm_b_member_id" uuid,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "chat_channel_shape_of_kind" CHECK (("kind" = 'dm') = ("name" is null)
        and ("kind" = 'dm') = ("dm_a_member_id" is not null and "dm_b_member_id" is not null)
        and ("dm_a_member_id" is null or "dm_a_member_id" < "dm_b_member_id"))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"agent_id" uuid,
	"plan_id" uuid,
	"handle" text NOT NULL,
	"ordinal" integer NOT NULL,
	"read_seq" integer DEFAULT 0 NOT NULL,
	"notice_seq" integer,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "chat_member_id_of_kind" CHECK (("kind" = 'human') = ("user_id" is not null)
        and ("agent_id" is null or "kind" = 'agent')
        and ("plan_id" is null or "kind" = 'planner'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_channel_organization_name" ON "chat_channel" ("organization_id","name") WHERE "name" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_channel_organization_dm" ON "chat_channel" ("organization_id","dm_a_member_id","dm_b_member_id") WHERE "kind" = 'dm';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_channel_plan" ON "chat_channel" ("plan_id") WHERE "kind" = 'plan';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_channel_organization_created" ON "chat_channel" ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_member_organization_handle" ON "chat_member" ("organization_id","handle") WHERE "kind" <> 'planner';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_member_organization_kind_ordinal" ON "chat_member" ("organization_id","kind","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_member_organization_user" ON "chat_member" ("organization_id","user_id") WHERE "user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_member_agent" ON "chat_member" ("agent_id") WHERE "agent_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_member_plan" ON "chat_member" ("plan_id") WHERE "plan_id" is not null;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_channel" ADD CONSTRAINT "chat_channel_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_channel" ADD CONSTRAINT "chat_channel_plan_id_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_channel" ADD CONSTRAINT "chat_channel_dm_a_member_id_chat_member_id_fkey" FOREIGN KEY ("dm_a_member_id") REFERENCES "chat_member"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_channel" ADD CONSTRAINT "chat_channel_dm_b_member_id_chat_member_id_fkey" FOREIGN KEY ("dm_b_member_id") REFERENCES "chat_member"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_channel" ADD CONSTRAINT "chat_channel_created_by_member_id_chat_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "chat_member"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_member" ADD CONSTRAINT "chat_member_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_member" ADD CONSTRAINT "chat_member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_member" ADD CONSTRAINT "chat_member_agent_id_coding_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "coding_agent"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_member" ADD CONSTRAINT "chat_member_plan_id_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
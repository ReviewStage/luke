CREATE TABLE "channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"project" boolean NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "channel_name_slug" CHECK ("name" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "channel_general_open" CHECK ("name" <> 'general' or "archived_at" is null)
);
--> statement-breakpoint
CREATE TABLE "channel_look" (
	"user_id" text,
	"channel_id" uuid,
	"looked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "channel_look_pkey" PRIMARY KEY("user_id","channel_id")
);
--> statement-breakpoint
-- Added nullable, filled with each item's #general below, and only then held NOT NULL.
ALTER TABLE "inbox_item" ADD COLUMN "channel_id" uuid;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN "addressee_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_organization_name_open" ON "channel" ("organization_id","name") WHERE "archived_at" is null;--> statement-breakpoint
CREATE INDEX "inbox_item_channel_posted" ON "inbox_item" ("channel_id","posted_at");--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "channel_look" ADD CONSTRAINT "channel_look_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_look" ADD CONSTRAINT "channel_look_channel_id_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channel"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_channel_id_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channel"("id");--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_addressee_id_user_id_fkey" FOREIGN KEY ("addressee_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Every workspace standing gets its #general, so every item standing has one to go to.
INSERT INTO "channel" ("organization_id", "name", "purpose", "project", "created_at")
SELECT "id", 'general', 'Anything that belongs to no other channel.', false, now() FROM "organization";
--> statement-breakpoint
UPDATE "inbox_item" SET "channel_id" = "channel"."id"
FROM "channel"
WHERE "channel"."organization_id" = "inbox_item"."organization_id"
	AND "channel"."name" = 'general'
	AND "channel"."archived_at" IS NULL
	AND "inbox_item"."channel_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "inbox_item" ALTER COLUMN "channel_id" SET NOT NULL;
--> statement-breakpoint
-- An insert that names no channel, the deployment before this one's and any since that leaves it out, takes its workspace's #general, minted here where a workspace made since has none yet. A concurrent mint of the same #general wins the unique index and is read back.
CREATE FUNCTION "inbox_item_general_channel"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	SELECT "id" INTO NEW."channel_id" FROM "channel"
	WHERE "organization_id" = NEW."organization_id" AND "name" = 'general' AND "archived_at" IS NULL;
	IF NEW."channel_id" IS NULL THEN
		INSERT INTO "channel" ("organization_id", "name", "purpose", "project", "created_at")
		VALUES (NEW."organization_id", 'general', 'Anything that belongs to no other channel.', false, now())
		ON CONFLICT ("organization_id", "name") WHERE "archived_at" IS NULL DO NOTHING
		RETURNING "id" INTO NEW."channel_id";
	END IF;
	IF NEW."channel_id" IS NULL THEN
		SELECT "id" INTO NEW."channel_id" FROM "channel"
		WHERE "organization_id" = NEW."organization_id" AND "name" = 'general' AND "archived_at" IS NULL;
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "inbox_item_general_channel" BEFORE INSERT ON "inbox_item" FOR EACH ROW WHEN (NEW."channel_id" IS NULL) EXECUTE FUNCTION "inbox_item_general_channel"();

CREATE TABLE IF NOT EXISTS "mac_command" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"command" text NOT NULL,
	"timeout_seconds" integer NOT NULL,
	"queued_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mac_command_listener" (
	"user_id" text PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "mac_command" ADD CONSTRAINT "mac_command_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "mac_command_listener" ADD CONSTRAINT "mac_command_listener_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mac_command_waiting" ON "mac_command" USING btree ("user_id","claimed_at");

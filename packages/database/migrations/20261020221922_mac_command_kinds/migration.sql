-- Additive and online-safe: a column with a constant default is a catalog change in Postgres 11+ (no rewrite), so every row standing reads as a shell command; a nullable column and a dropped NOT NULL are catalog changes too. `mac_command` holds a row only while its call waits on it.
CREATE TABLE IF NOT EXISTS "mac_command_listener_kind" (
	"user_id" text,
	"kind" text,
	"seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mac_command_listener_kind_pkey" PRIMARY KEY("user_id","kind")
);
--> statement-breakpoint
ALTER TABLE "mac_command" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'shell' NOT NULL;
--> statement-breakpoint
ALTER TABLE "mac_command" ADD COLUMN IF NOT EXISTS "params" jsonb;
--> statement-breakpoint
ALTER TABLE "mac_command" ALTER COLUMN "command" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "mac_command_listener_kind" DROP CONSTRAINT IF EXISTS "mac_command_listener_kind_user_id_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "mac_command_listener_kind" ADD CONSTRAINT "mac_command_listener_kind_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;

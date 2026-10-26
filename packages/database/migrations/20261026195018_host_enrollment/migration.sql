CREATE TABLE "host_install_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "secret_hash" text;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "version" text;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "device" ALTER COLUMN "home" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "device" ALTER COLUMN "claude_executable" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "device_secret_hash" ON "device" ("secret_hash") WHERE "secret_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "host_install_token_hash" ON "host_install_token" ("token_hash");--> statement-breakpoint
CREATE INDEX "host_install_token_user" ON "host_install_token" ("user_id");--> statement-breakpoint
ALTER TABLE "host_install_token" ADD CONSTRAINT "host_install_token_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
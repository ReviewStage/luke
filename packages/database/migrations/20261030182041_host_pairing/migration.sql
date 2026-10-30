CREATE TABLE "host_pairing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"poll_secret_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"arch" text NOT NULL,
	"version" text NOT NULL,
	"ip" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"polled_at" timestamp with time zone,
	"user_id" text,
	"device_id" uuid
);
--> statement-breakpoint
CREATE TABLE "host_pairing_guess" (
	"user_id" text PRIMARY KEY,
	"misses" integer NOT NULL,
	"window_ends_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "host_pairing_poll_secret_hash" ON "host_pairing" ("poll_secret_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "host_pairing_user_code" ON "host_pairing" ("user_code");--> statement-breakpoint
CREATE INDEX "host_pairing_expires_at" ON "host_pairing" ("expires_at");--> statement-breakpoint
CREATE INDEX "host_pairing_device" ON "host_pairing" ("device_id");--> statement-breakpoint
ALTER TABLE "host_pairing" ADD CONSTRAINT "host_pairing_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "host_pairing" ADD CONSTRAINT "host_pairing_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "host_pairing_guess" ADD CONSTRAINT "host_pairing_guess_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
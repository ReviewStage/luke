CREATE TABLE "sandbox_firewall" (
	"sandbox_session_id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"version" uuid NOT NULL,
	"sealed_entries" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sandbox_firewall_updated" ON "sandbox_firewall" ("updated_at");--> statement-breakpoint
ALTER TABLE "sandbox_firewall" ADD CONSTRAINT "sandbox_firewall_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
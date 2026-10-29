CREATE TABLE "agent_state_generation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"agent_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"path" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"base_commit" text,
	"device_id" uuid,
	"saved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_state_generation_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "agent_state_key" (
	"agent_id" uuid PRIMARY KEY,
	"key_version" integer NOT NULL,
	"sealed_data_key" text NOT NULL,
	"sealed_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_state_generation_agent_generation" ON "agent_state_generation" ("agent_id","generation");--> statement-breakpoint
ALTER TABLE "agent_state_generation" ADD CONSTRAINT "agent_state_generation_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "agent_state_key" ADD CONSTRAINT "agent_state_key_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;
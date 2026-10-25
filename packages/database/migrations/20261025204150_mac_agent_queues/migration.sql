CREATE TABLE "mac_agent_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"agent_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"device_id" uuid NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "mac_agent_line_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sealed_secrets" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"exit_code" integer
);
--> statement-breakpoint
CREATE TABLE "mac_agent_request" (
	"id" uuid PRIMARY KEY,
	"agent_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"device_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"args" jsonb NOT NULL,
	"bytes" bytea,
	"exit_code" integer,
	"stdout" text,
	"stderr" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mac_device" (
	"id" uuid PRIMARY KEY,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coding_agent" ADD COLUMN "machine" text DEFAULT 'vercel' NOT NULL;--> statement-breakpoint
ALTER TABLE "coding_agent" ADD COLUMN "device_id" uuid;--> statement-breakpoint
CREATE INDEX "mac_agent_line_device_waiting" ON "mac_agent_line" ("device_id","seq") WHERE "claimed_at" is null;--> statement-breakpoint
CREATE INDEX "mac_agent_line_user_created" ON "mac_agent_line" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "mac_agent_request_device_waiting" ON "mac_agent_request" ("device_id","created_at") WHERE "claimed_at" is null;--> statement-breakpoint
CREATE INDEX "mac_agent_request_user_created" ON "mac_agent_request" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "mac_device_user_seen" ON "mac_device" ("user_id","last_seen_at");--> statement-breakpoint
ALTER TABLE "coding_agent" ADD CONSTRAINT "coding_agent_device_id_mac_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "mac_device"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mac_agent_line" ADD CONSTRAINT "mac_agent_line_agent_id_coding_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "coding_agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mac_agent_line" ADD CONSTRAINT "mac_agent_line_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mac_agent_line" ADD CONSTRAINT "mac_agent_line_device_id_mac_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "mac_device"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mac_agent_request" ADD CONSTRAINT "mac_agent_request_agent_id_coding_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "coding_agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mac_agent_request" ADD CONSTRAINT "mac_agent_request_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mac_agent_request" ADD CONSTRAINT "mac_agent_request_device_id_mac_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "mac_device"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mac_device" ADD CONSTRAINT "mac_device_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
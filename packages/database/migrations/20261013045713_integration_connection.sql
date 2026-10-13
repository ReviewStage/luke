CREATE TABLE "integration_connection" (
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"state" text,
	"state_issued_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connection_user_id_provider_pk" PRIMARY KEY("user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connection_state_idx" ON "integration_connection" USING btree ("state");--> statement-breakpoint
INSERT INTO "integration_connection" ("user_id", "provider", "status", "state", "state_issued_at", "connected_at", "updated_at")
SELECT "user_id", 'linear', "status", "state", "state_issued_at", "connected_at", "updated_at" FROM "linear_connection"
ON CONFLICT DO NOTHING;

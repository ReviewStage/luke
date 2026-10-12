CREATE TABLE "linear_connection" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"state" text,
	"state_issued_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "linear_connection" ADD CONSTRAINT "linear_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "linear_connection_state_idx" ON "linear_connection" USING btree ("state");

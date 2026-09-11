CREATE TABLE "asks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"origin" text NOT NULL,
	"question" text NOT NULL,
	"session_id" text,
	"delivery_id" text,
	"turn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancel_requested_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asks_conversation_client" ON "asks" USING btree ("conversation_id","client_id");--> statement-breakpoint
CREATE INDEX "asks_by_user" ON "asks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "asks_conversation_delivery" ON "asks" USING btree ("conversation_id","delivery_id");
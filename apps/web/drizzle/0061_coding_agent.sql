CREATE TABLE "coding_agent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"model" text NOT NULL,
	"effort" text NOT NULL,
	"plan_snapshot" text NOT NULL,
	"repository" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coding_agent" ADD CONSTRAINT "coding_agent_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coding_agent" ADD CONSTRAINT "coding_agent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coding_agent" ADD CONSTRAINT "coding_agent_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coding_agent_user_idempotency" ON "coding_agent" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "coding_agent_plan_created" ON "coding_agent" USING btree ("plan_id","created_at");

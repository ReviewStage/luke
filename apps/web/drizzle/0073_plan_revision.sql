CREATE TABLE "plan_revision" (
	"plan_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"actor" text NOT NULL,
	"agent_id" uuid,
	"live_session_id" text,
	"fields" jsonb NOT NULL,
	"assumptions" jsonb NOT NULL,
	"changes" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "plan_revision_plan_id_seq_pk" PRIMARY KEY("plan_id","seq")
);
--> statement-breakpoint
ALTER TABLE "plan_revision" ADD CONSTRAINT "plan_revision_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_revision" ADD CONSTRAINT "plan_revision_agent_id_coding_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."coding_agent"("id") ON DELETE set null ON UPDATE no action;

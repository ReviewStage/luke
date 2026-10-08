CREATE TABLE "plan_board" (
	"plan_id" uuid PRIMARY KEY NOT NULL,
	"elements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applied_drawing" integer DEFAULT 0 NOT NULL,
	"drawing" jsonb,
	"drawing_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_board" ADD CONSTRAINT "plan_board_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE cascade ON UPDATE no action;

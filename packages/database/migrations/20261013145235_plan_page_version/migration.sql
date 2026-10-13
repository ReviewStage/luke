CREATE TABLE IF NOT EXISTS "plan_page_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"html" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "plan_page_version_page_version" UNIQUE("page_id","version")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "plan_page_version" ADD CONSTRAINT "plan_page_version_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_page_version_plan" ON "plan_page_version" USING btree ("plan_id");

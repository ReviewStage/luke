CREATE TABLE "task_section" (
	"id" uuid PRIMARY KEY,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"icon" jsonb,
	"position" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_section_entry" (
	"user_id" text,
	"task_id" uuid,
	"section_id" uuid NOT NULL,
	"position" text,
	"added_at" timestamp with time zone NOT NULL,
	CONSTRAINT "task_section_entry_pkey" PRIMARY KEY("user_id","task_id")
);
--> statement-breakpoint
CREATE INDEX "task_section_user" ON "task_section" ("user_id");--> statement-breakpoint
CREATE INDEX "task_section_organization" ON "task_section" ("organization_id");--> statement-breakpoint
CREATE INDEX "task_section_entry_task" ON "task_section_entry" ("task_id");--> statement-breakpoint
CREATE INDEX "task_section_entry_section" ON "task_section_entry" ("section_id");--> statement-breakpoint
ALTER TABLE "task_section" ADD CONSTRAINT "task_section_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_section" ADD CONSTRAINT "task_section_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_section_entry" ADD CONSTRAINT "task_section_entry_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_section_entry" ADD CONSTRAINT "task_section_entry_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_section_entry" ADD CONSTRAINT "task_section_entry_section_id_task_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "task_section"("id") ON DELETE CASCADE;
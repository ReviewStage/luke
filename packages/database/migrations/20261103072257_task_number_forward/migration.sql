CREATE TABLE "task_number_forward" (
	"organization_id" text,
	"number" integer,
	"task_id" uuid NOT NULL,
	CONSTRAINT "task_number_forward_pkey" PRIMARY KEY("organization_id","number")
);
--> statement-breakpoint
CREATE INDEX "task_number_forward_task" ON "task_number_forward" ("task_id");--> statement-breakpoint
ALTER TABLE "task_number_forward" ADD CONSTRAINT "task_number_forward_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_number_forward" ADD CONSTRAINT "task_number_forward_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;
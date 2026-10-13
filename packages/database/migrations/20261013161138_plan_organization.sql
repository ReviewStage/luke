ALTER TABLE "plan" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_organization_created" ON "plan" USING btree ("organization_id","created_at");
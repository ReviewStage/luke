ALTER TABLE "plan" ADD COLUMN "organization_id" text;--> statement-breakpoint
-- Every plan standing moves into its starter's personal workspace, which the
-- migration before made for every account, so none is left without one.
UPDATE "plan" SET "organization_id" = "personal_workspace"."organization_id"
FROM "personal_workspace"
WHERE "personal_workspace"."user_id" = "plan"."user_id";--> statement-breakpoint
ALTER TABLE "plan" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_organization_created" ON "plan" USING btree ("organization_id","created_at");

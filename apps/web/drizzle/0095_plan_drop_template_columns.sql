ALTER TABLE "plan" ALTER COLUMN "document" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan" DROP COLUMN "body";
--> statement-breakpoint
ALTER TABLE "plan" DROP COLUMN "assumptions";
--> statement-breakpoint
ALTER TABLE "plan" DROP COLUMN "fields";
--> statement-breakpoint
ALTER TABLE "plan" DROP COLUMN "field_writers";
--> statement-breakpoint
ALTER TABLE "plan_revision" ALTER COLUMN "document" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_revision" DROP COLUMN "fields";
--> statement-breakpoint
ALTER TABLE "plan_revision" DROP COLUMN "assumptions";

ALTER TABLE "plan_board" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "plan_board" ADD COLUMN "image_drawing" integer DEFAULT 0 NOT NULL;

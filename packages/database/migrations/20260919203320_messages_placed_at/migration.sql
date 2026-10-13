ALTER TABLE "messages" ADD COLUMN "placed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "messages" SET "placed_at" = "created_at";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "placed_at" DROP DEFAULT;

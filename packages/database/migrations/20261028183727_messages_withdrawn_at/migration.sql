ALTER TABLE "messages" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "messages_withdrawn" ON "messages" ("withdrawn_at") WHERE "withdrawn_at" is not null;
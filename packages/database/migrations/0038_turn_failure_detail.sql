ALTER TABLE "turns" ADD COLUMN "failure_detail" text;--> statement-breakpoint
CREATE INDEX "turns_running_started" ON "turns" USING btree ("started_at", "id") WHERE "turns"."status" = 'running';

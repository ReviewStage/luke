-- Additive and online-safe: two nullable columns are a catalog change in Postgres, with no rewrite. A browser command's image waits in `result_image` beside its JSON result, never in `result`, and leaves with the row when its call reads it; `mac_command` holds a row only while its call waits on it.
ALTER TABLE "mac_command" ADD COLUMN IF NOT EXISTS "result_image" bytea;
--> statement-breakpoint
ALTER TABLE "mac_command" ADD COLUMN IF NOT EXISTS "result_image_type" text;

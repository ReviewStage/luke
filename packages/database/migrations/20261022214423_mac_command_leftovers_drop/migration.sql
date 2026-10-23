-- Contract step of the Mac Browser removal (#4417): nothing deployed since 2026-10-21 reads or writes these. `mac_command.kind` and `mac_command_listener` stay.
DROP TABLE IF EXISTS "mac_command_listener_kind";--> statement-breakpoint
ALTER TABLE "mac_command" DROP COLUMN IF EXISTS "params";--> statement-breakpoint
ALTER TABLE "mac_command" DROP COLUMN IF EXISTS "result_image";--> statement-breakpoint
ALTER TABLE "mac_command" DROP COLUMN IF EXISTS "result_image_type";

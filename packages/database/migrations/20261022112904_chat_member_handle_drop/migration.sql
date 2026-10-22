-- contract: nothing has read or written "handle" since #4333 reached production at 03:54 UTC on Oct 21, over 25 hours ago
DROP INDEX IF EXISTS "chat_member_organization_handle";--> statement-breakpoint
ALTER TABLE "chat_member" DROP COLUMN IF EXISTS "handle";

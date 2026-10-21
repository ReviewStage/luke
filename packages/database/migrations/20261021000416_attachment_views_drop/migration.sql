-- Custom SQL migration file, put your code below! --
-- contract: nothing has read or written "chat_attachment", "inbox_attachment", "plan_attachment", or "conversation_attachment" since #3968 reached production on Oct 19 at 22:19 UTC, over 25 hours ago: the four views over "attachment" that kept their names for runs on older deployments, and the three tables renamed out of the way when their rows moved, which nothing reads.
-- A view's drop locks the view alone. A table's drop locks every table its foreign keys name, against reads too, so production's moved tables had their foreign keys dropped by hand first, one key to a transaction, where each waits holding only its unread table; here they lock no table but their own. A database that never had them, or ran this before, runs it as a no-op.
DROP VIEW IF EXISTS "chat_attachment";--> statement-breakpoint
DROP VIEW IF EXISTS "inbox_attachment";--> statement-breakpoint
DROP VIEW IF EXISTS "plan_attachment";--> statement-breakpoint
DROP VIEW IF EXISTS "conversation_attachment";--> statement-breakpoint
DROP TABLE IF EXISTS "inbox_attachment_moved";--> statement-breakpoint
DROP TABLE IF EXISTS "plan_attachment_moved";--> statement-breakpoint
DROP TABLE IF EXISTS "conversation_attachment_moved";

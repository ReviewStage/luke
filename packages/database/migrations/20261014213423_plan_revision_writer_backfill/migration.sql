-- Custom SQL migration file, put your code below! --
-- The writer of each revision from before writers were kept, where the record
-- names them for certain. A revision the notetaker wrote on a call is the
-- call's member's. A developer's revision, or the notetaker's off any call, is
-- the plan's starter's where it last moved before plans could be shared
-- (#2133, merged 2026-10-14 03:20:08 UTC), when nobody else could reach a plan.
-- Membership is not read: a plan may have moved workspace since (#2573), so
-- who was in its workspace then cannot be told from who is in it now. Every
-- other revision stays null, which reads as nobody the service can name rather
-- than as anyone in particular. Each statement fills only nulls, so a rerun
-- changes nothing.
UPDATE "plan_revision" SET "user_id" = "voice_sessions"."user_id"
FROM "voice_sessions"
WHERE "plan_revision"."actor" = 'notetaker'
	AND "plan_revision"."user_id" IS NULL
	AND "voice_sessions"."live_session_id" = "plan_revision"."live_session_id";--> statement-breakpoint
UPDATE "plan_revision" SET "user_id" = "plan"."user_id"
FROM "plan"
WHERE "plan"."id" = "plan_revision"."plan_id"
	AND "plan_revision"."actor" IN ('developer', 'notetaker')
	AND "plan_revision"."live_session_id" IS NULL
	AND "plan_revision"."user_id" IS NULL
	AND "plan_revision"."at" < '2026-10-14 03:20:08+00';

-- Custom SQL migration file, put your code below! --
-- The member who answered each item from before answerers were kept, where
-- the record names them for certain: an item answered before plans and their
-- agents could be shared (#2133 and #2151, merged 2026-10-14 03:20 UTC) was
-- answered by its agent's starter, the one account that could reach it then.
-- Membership is not read, because a plan may have moved workspace since
-- (#2573). Every other answer stays unnamed, which reads as nobody the
-- service can name rather than as anyone in particular. Only nulls are
-- filled, so a rerun changes nothing.
UPDATE "inbox_item" SET "answered_by" = "user_id"
WHERE "status" = 'answered'
	AND "answered_by" IS NULL
	AND "updated_at" < '2026-10-14 03:20:08+00';

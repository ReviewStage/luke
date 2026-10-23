-- backfill: every inbox item from before version 5 is written as a version 5 thread, and so is every item the version 4 tool posted after the bump, whose blocks still hold its question and whose thread holds no ask, so no read falls back to the item's own blocks, response, and answer: the agent's message opening its thread carries its blocks as Markdown, its pictures as that message's files by their addresses, and the ask its response stands for, open, answered, or withdrawn as the item stands; a member's message carries the answer to that ask, or the words a nod carried, and the files the answer carried; an open ask is named on the item; and the item's blocks are emptied, since its message carries them. Each message's id is drawn from its item's, so a second run writes nothing twice, and every statement after the first reads only the items it opened a thread for whose blocks still stand, which the last one empties.
INSERT INTO "inbox_message" ("id", "item_id", "author", "user_id", "text", "ask", "answers", "client_key", "created_at")
SELECT
	md5("item"."id"::text || ':ask')::uuid,
	"item"."id",
	'agent',
	NULL,
	coalesce((
		SELECT string_agg(CASE "block"->>'type'
			WHEN 'markdown' THEN "block"->>'text'
			WHEN 'link' THEN '[' || regexp_replace("block"->>'label', '([\\\[\]])', '\\\1', 'g') || '](' || replace(replace("block"->>'url', '(', '%28'), ')', '%29') || ')'
			WHEN 'code' THEN 'https://github.com/' || ("block"->>'repo') || '/blob/' || ("block"->>'sha') || '/'
				|| replace(replace(replace(replace(replace(replace(replace("block"->>'path', '%', '%25'), ' ', '%20'), '#', '%23'), '?', '%3F'), '(', '%28'), ')', '%29'), '"', '%22')
				|| '#L' || ("block"->>'startLine')
				|| CASE WHEN ("block"->>'endLine') = ("block"->>'startLine') THEN '' ELSE '-L' || ("block"->>'endLine') END
			WHEN 'image' THEN '![' || regexp_replace(regexp_replace("block"->>'alt', '\s+', ' ', 'g'), '([\\\[\]])', '\\\1', 'g')
				|| '](https://tryluke.dev/' || coalesce("workspace"."slug", "item"."organization_id")
				|| CASE WHEN "item"."task_id" IS NULL THEN '/agent/' || "item"."agent_id" ELSE '/plan/' || "item"."task_id" END
				|| '/inbox/' || "item"."id" || '/files/' || ("block"->>'attachmentId') || ')'
		END, E'\n\n' ORDER BY "at")
		FROM jsonb_array_elements("item"."blocks") WITH ORDINALITY AS "listed"("block", "at")
	), ''),
	CASE WHEN "asked"."ask" IS NULL THEN NULL ELSE "asked"."ask" || CASE
		WHEN "asked"."taken" OR "item"."status" = 'answered' THEN '{"status":"answered"}'::jsonb
		WHEN "item"."status" = 'open' THEN '{"status":"open"}'::jsonb
		WHEN "item"."closed_reason" IS NULL THEN '{"status":"withdrawn"}'::jsonb
		ELSE jsonb_build_object('status', 'withdrawn', 'withdrawnReason', "item"."closed_reason")
	END END,
	NULL,
	NULL,
	"item"."posted_at"
FROM "inbox_item" AS "item"
LEFT JOIN "organization" AS "workspace" ON "workspace"."id" = "item"."organization_id"
CROSS JOIN LATERAL (
	SELECT
		CASE "item"."response"->>'type'
			WHEN 'choice' THEN jsonb_set("item"."response", '{type}', '"decide"')
			WHEN 'approval' THEN '{"type":"decide","options":[{"label":"Approve"},{"label":"Decline"}]}'::jsonb
			WHEN 'task' THEN '{"type":"do","steps":[]}'::jsonb
			WHEN 'form' THEN jsonb_build_object('type', 'answer', 'fields', "item"."response"->'fields')
			WHEN 'text' THEN '{"type":"answer"}'::jsonb
		END AS "ask",
		coalesce("item"."answer"->>'reply' <> 'acknowledged', false) AS "taken"
) AS "asked"
WHERE ("item"."version" < 5 OR "item"."blocks" <> '[]'::jsonb)
	AND NOT EXISTS (SELECT 1 FROM "inbox_message" AS "asking" WHERE "asking"."item_id" = "item"."id" AND "asking"."ask" IS NOT NULL)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "attachment" SET
	"kind" = 'message',
	"inbox_message_id" = md5("pictured"."item_id"::text || ':ask')::uuid,
	"name" = 'picture-' || "pictured"."at" || CASE "attachment"."content_type"
		WHEN 'image/png' THEN '.png'
		WHEN 'image/jpeg' THEN '.jpg'
		WHEN 'image/webp' THEN '.webp'
		ELSE ''
	END,
	"position" = "pictured"."at" - 1
FROM (
	SELECT "item"."id" AS "item_id", "block"->>'attachmentId' AS "attachment_id", row_number() OVER (PARTITION BY "item"."id" ORDER BY "at") AS "at"
	FROM "inbox_item" AS "item", jsonb_array_elements("item"."blocks") WITH ORDINALITY AS "listed"("block", "at")
	WHERE "block"->>'type' = 'image'
		AND EXISTS (SELECT 1 FROM "inbox_message" AS "opening" WHERE "opening"."id" = md5("item"."id"::text || ':ask')::uuid)
		AND ("item"."version" < 5 OR "item"."blocks" <> '[]'::jsonb)
) AS "pictured"
WHERE "attachment"."id"::text = "pictured"."attachment_id"
	AND "attachment"."inbox_item_id" = "pictured"."item_id"
	AND "attachment"."kind" = 'image';
--> statement-breakpoint
INSERT INTO "inbox_message" ("id", "item_id", "author", "user_id", "text", "ask", "answers", "client_key", "created_at")
SELECT
	md5("item"."id"::text || ':answer')::uuid,
	"item"."id",
	'member',
	"item"."answered_by",
	coalesce("item"."answer"->>'note', ''),
	NULL,
	CASE WHEN NOT "asked"."answers" THEN NULL ELSE CASE "item"."answer"->>'reply'
		WHEN 'approved' THEN jsonb_build_object('ask', "asked"."ask_id", 'reply', 'chose', 'choices', '["Approve"]'::jsonb)
		WHEN 'declined' THEN jsonb_build_object('ask', "asked"."ask_id", 'reply', 'chose', 'choices', '["Decline"]'::jsonb)
		WHEN 'done' THEN jsonb_build_object('ask', "asked"."ask_id", 'reply', 'done', 'steps', '[]'::jsonb)
		ELSE jsonb_strip_nulls(jsonb_build_object(
			'ask', "asked"."ask_id",
			'reply', "item"."answer"->>'reply',
			'choices', "item"."answer"->'choices',
			'values', "item"."answer"->'values'
		))
	END END,
	"item"."answer_key",
	coalesce("item"."settled_at", "item"."updated_at")
FROM "inbox_item" AS "item"
CROSS JOIN LATERAL (
	SELECT
		md5("item"."id"::text || ':ask')::uuid::text AS "ask_id",
		"item"."response"->>'type' IN ('choice', 'approval', 'task', 'form', 'text')
			AND "item"."answer"->>'reply' <> 'acknowledged' AS "answers"
) AS "asked"
WHERE EXISTS (SELECT 1 FROM "inbox_message" AS "opening" WHERE "opening"."id" = md5("item"."id"::text || ':ask')::uuid)
	AND ("item"."version" < 5 OR "item"."blocks" <> '[]'::jsonb)
	AND "item"."answer" IS NOT NULL
	AND (
		"asked"."answers"
		OR coalesce("item"."answer"->>'note', '') <> ''
		OR EXISTS (SELECT 1 FROM "attachment" AS "file" WHERE "file"."inbox_item_id" = "item"."id" AND "file"."kind" = 'answer')
	)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "attachment" SET "kind" = 'message', "inbox_message_id" = md5("attachment"."inbox_item_id"::text || ':answer')::uuid
WHERE "attachment"."kind" = 'answer'
	AND EXISTS (SELECT 1 FROM "inbox_message" AS "answering" WHERE "answering"."id" = md5("attachment"."inbox_item_id"::text || ':answer')::uuid);
--> statement-breakpoint
UPDATE "inbox_item" AS "item" SET "open_ask_message_id" = md5("item"."id"::text || ':ask')::uuid
WHERE EXISTS (SELECT 1 FROM "inbox_message" AS "opening" WHERE "opening"."id" = md5("item"."id"::text || ':ask')::uuid)
	AND ("item"."version" < 5 OR "item"."blocks" <> '[]'::jsonb)
	AND "item"."status" = 'open'
	AND "item"."response"->>'type' IN ('choice', 'approval', 'task', 'form', 'text');
--> statement-breakpoint
UPDATE "inbox_item" AS "item" SET "version" = 5, "blocks" = '[]'::jsonb
WHERE EXISTS (SELECT 1 FROM "inbox_message" AS "opening" WHERE "opening"."id" = md5("item"."id"::text || ':ask')::uuid)
	AND ("item"."version" < 5 OR "item"."blocks" <> '[]'::jsonb);

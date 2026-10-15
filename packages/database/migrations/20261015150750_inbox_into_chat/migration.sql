-- Custom SQL migration file, put your code below! --
-- Every inbox item is copied once into chat as the ask it now is: a message
-- of its agent's chat member in its plan's chat channel, or its workspace's
-- general channel for an agent with no plan, under the item's own
-- id, which is also its client key, so a desktop holding the item's id holds
-- the message's and running this again copies nothing twice. An item whose
-- agent already re-posted its key in chat is left, since the ask in chat is
-- the newer. Each item takes the next place in its workspace's chat sequence,
-- the least recently changed first, its posting and its last change as the
-- message's own, its answer the answering person's where the item names
-- them, through their chat member in the workspace. A picture is copied
-- under its own id beside the message it belongs to. The inbox tables stay
-- standing, unwritten, until they are dropped.

-- The chat member of every agent holding an item, minted as the chat mints
-- one: the next ordinal among its workspace's agents, as `agent-N`.
WITH "unminted" AS (
	SELECT "coding_agent"."id" AS "agent_id",
		coalesce("coding_agent"."organization_id", "plan"."organization_id") AS "organization_id",
		"coding_agent"."created_at"
	FROM "coding_agent"
	LEFT JOIN "plan" ON "plan"."id" = "coding_agent"."plan_id"
	WHERE EXISTS (SELECT 1 FROM "inbox_item" WHERE "inbox_item"."agent_id" = "coding_agent"."id")
		AND NOT EXISTS (SELECT 1 FROM "chat_member" WHERE "chat_member"."agent_id" = "coding_agent"."id")
),
"numbered" AS (
	SELECT "unminted".*,
		coalesce((
			SELECT max("chat_member"."ordinal") FROM "chat_member"
			WHERE "chat_member"."organization_id" = "unminted"."organization_id"
				AND "chat_member"."kind" = 'agent'
		), 0) + row_number() OVER (
			PARTITION BY "unminted"."organization_id"
			ORDER BY "unminted"."created_at", "unminted"."agent_id"
		) AS "ordinal"
	FROM "unminted"
)
INSERT INTO "chat_member" ("organization_id", "kind", "agent_id", "handle", "ordinal", "joined_at")
SELECT "organization_id", 'agent', "agent_id", 'agent-' || "ordinal", "ordinal", now()
FROM "numbered";
--> statement-breakpoint

-- The chat channel of every plan holding an item, named from the plan as a
-- slug, `plan` where its name spells none, and the slug with the plan's id
-- after it where another channel of the workspace holds the name, the general
-- channel's included. A name some channel holds already, however unlikely,
-- leaves the plan for the passes after, which name its channel `plan-` and
-- the plan's id, then with a suffix no channel holds, so no name stops the
-- copy and no plan's items are left behind.
WITH "unchanneled" AS (
	SELECT "plan"."id", "plan"."organization_id", "plan"."created_at",
		coalesce(
			nullif(trim(BOTH '-' FROM left(lower(regexp_replace("plan"."name", '[^a-zA-Z0-9]+', '-', 'g')), 43)), ''),
			'plan'
		) AS "stem"
	FROM "plan"
	WHERE EXISTS (SELECT 1 FROM "inbox_item" WHERE "inbox_item"."plan_id" = "plan"."id")
		AND NOT EXISTS (
			SELECT 1 FROM "chat_channel"
			WHERE "chat_channel"."plan_id" = "plan"."id" AND "chat_channel"."kind" = 'plan'
		)
),
"named" AS (
	SELECT "unchanneled".*, row_number() OVER (
		PARTITION BY "unchanneled"."organization_id", "unchanneled"."stem"
		ORDER BY "unchanneled"."created_at", "unchanneled"."id"
	) AS "place"
	FROM "unchanneled"
)
INSERT INTO "chat_channel" ("organization_id", "kind", "name", "plan_id", "created_at")
SELECT "named"."organization_id", 'plan',
	CASE
		WHEN "named"."place" = 1 AND "named"."stem" <> 'general' AND NOT EXISTS (
			SELECT 1 FROM "chat_channel"
			WHERE "chat_channel"."organization_id" = "named"."organization_id"
				AND "chat_channel"."name" = "named"."stem"
		) THEN "named"."stem"
		ELSE "named"."stem" || '-' || "named"."id"::text
	END,
	"named"."id", now()
FROM "named"
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "chat_channel" ("organization_id", "kind", "name", "plan_id", "created_at")
SELECT "plan"."organization_id", 'plan', 'plan-' || "plan"."id"::text, "plan"."id", now()
FROM "plan"
WHERE EXISTS (SELECT 1 FROM "inbox_item" WHERE "inbox_item"."plan_id" = "plan"."id")
	AND NOT EXISTS (
		SELECT 1 FROM "chat_channel"
		WHERE "chat_channel"."plan_id" = "plan"."id" AND "chat_channel"."kind" = 'plan'
	)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- A plan still without a channel, every name before held, takes the first
-- of `plan-` and its id with `-2`, `-3`, ... after it that no channel holds,
-- each name carrying its own plan's id, so no two plans reach for one.
INSERT INTO "chat_channel" ("organization_id", "kind", "name", "plan_id", "created_at")
SELECT "plan"."organization_id", 'plan',
	(
		SELECT 'plan-' || "plan"."id"::text || '-' || "suffix"
		FROM generate_series(2, 10000) AS "suffix"
		WHERE NOT EXISTS (
			SELECT 1 FROM "chat_channel"
			WHERE "chat_channel"."organization_id" = "plan"."organization_id"
				AND "chat_channel"."name" = 'plan-' || "plan"."id"::text || '-' || "suffix"
		)
		ORDER BY "suffix"
		LIMIT 1
	),
	"plan"."id", now()
FROM "plan"
WHERE EXISTS (SELECT 1 FROM "inbox_item" WHERE "inbox_item"."plan_id" = "plan"."id")
	AND NOT EXISTS (
		SELECT 1 FROM "chat_channel"
		WHERE "chat_channel"."plan_id" = "plan"."id" AND "chat_channel"."kind" = 'plan'
	);
--> statement-breakpoint

-- Every plan holding an item has its channel now, or the copy stops here
-- rather than leave that plan's items behind unsaid.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "inbox_item"
		WHERE "inbox_item"."plan_id" IS NOT NULL AND NOT EXISTS (
			SELECT 1 FROM "chat_channel"
			WHERE "chat_channel"."plan_id" = "inbox_item"."plan_id" AND "chat_channel"."kind" = 'plan'
		)
	) THEN
		RAISE EXCEPTION 'a plan holding inbox items has no chat channel';
	END IF;
END $$;
--> statement-breakpoint

-- The general channel of every workspace holding an item of an agent with no
-- plan, which keeps such items as its plan's channel keeps a plan's.
INSERT INTO "chat_channel" ("organization_id", "kind", "name", "created_at")
SELECT DISTINCT "inbox_item"."organization_id", 'general', 'general', now()
FROM "inbox_item"
WHERE "inbox_item"."plan_id" IS NULL AND "inbox_item"."organization_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- The sequence of every workspace holding an item.
INSERT INTO "workspace_chat" ("organization_id")
SELECT DISTINCT coalesce("inbox_item"."organization_id", "plan"."organization_id")
FROM "inbox_item"
LEFT JOIN "plan" ON "plan"."id" = "inbox_item"."plan_id"
WHERE coalesce("inbox_item"."organization_id", "plan"."organization_id") IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- The chat member of every person who answered an item, where the item
-- names them, minted as the chat mints one: a slug of their name opening on
-- a letter, `member` where it spells none, with `-2`, `-3`, ... after it
-- where the workspace holds it or it is spoken for, at the next ordinal
-- among the workspace's people, joined at the workspace's head.
DO $$
DECLARE
	_answerer record;
	_stem text;
	_handle text;
	_suffix integer;
BEGIN
	FOR _answerer IN
		SELECT DISTINCT coalesce("inbox_item"."organization_id", "plan"."organization_id") AS "organization_id",
			"inbox_item"."answered_by" AS "user_id", "user"."name"
		FROM "inbox_item"
		LEFT JOIN "plan" ON "plan"."id" = "inbox_item"."plan_id"
		JOIN "user" ON "user"."id" = "inbox_item"."answered_by"
		WHERE coalesce("inbox_item"."organization_id", "plan"."organization_id") IS NOT NULL
			AND NOT EXISTS (
				SELECT 1 FROM "chat_member"
				WHERE "chat_member"."organization_id" = coalesce("inbox_item"."organization_id", "plan"."organization_id")
					AND "chat_member"."user_id" = "inbox_item"."answered_by"
			)
		ORDER BY 1, 2
	LOOP
		_stem := regexp_replace(
			rtrim(left(trim(BOTH '-' FROM regexp_replace(lower(normalize(_answerer."name", NFKD)), '[^a-z0-9]+', '-', 'g')), 32), '-'),
			'^[^a-z]+', ''
		);
		IF _stem = '' THEN
			_stem := 'member';
		END IF;
		_handle := _stem;
		_suffix := 1;
		WHILE _handle ~ '^(luke|agent-[0-9]+)$' OR EXISTS (
			SELECT 1 FROM "chat_member"
			WHERE "chat_member"."organization_id" = _answerer."organization_id" AND "chat_member"."handle" = _handle
		) LOOP
			_suffix := _suffix + 1;
			_handle := _stem || '-' || _suffix;
		END LOOP;
		INSERT INTO "chat_member" ("organization_id", "kind", "user_id", "handle", "ordinal", "read_seq", "joined_at")
		VALUES (
			_answerer."organization_id", 'human', _answerer."user_id", _handle,
			coalesce((
				SELECT max("chat_member"."ordinal") FROM "chat_member"
				WHERE "chat_member"."organization_id" = _answerer."organization_id" AND "chat_member"."kind" = 'human'
			), 0) + 1,
			coalesce((
				SELECT "workspace_chat"."next_seq" - 1 FROM "workspace_chat"
				WHERE "workspace_chat"."organization_id" = _answerer."organization_id"
			), 0),
			now()
		);
	END LOOP;
END $$;
--> statement-breakpoint

-- Every item not copied yet, as its ask, at the next places of its
-- workspace's sequence, which moves past them.
WITH "uncopied" AS (
	SELECT "inbox_item".*,
		coalesce("inbox_item"."organization_id", "plan"."organization_id") AS "workspace_id",
		"chat_channel"."id" AS "channel_id",
		"chat_member"."id" AS "member_id",
		row_number() OVER (
			PARTITION BY coalesce("inbox_item"."organization_id", "plan"."organization_id")
			ORDER BY "inbox_item"."updated_at", "inbox_item"."id"
		) AS "place"
	FROM "inbox_item"
	LEFT JOIN "plan" ON "plan"."id" = "inbox_item"."plan_id"
	JOIN "chat_channel" ON (
		"inbox_item"."plan_id" IS NOT NULL
			AND "chat_channel"."plan_id" = "inbox_item"."plan_id" AND "chat_channel"."kind" = 'plan'
	) OR (
		"inbox_item"."plan_id" IS NULL
			AND "chat_channel"."organization_id" = "inbox_item"."organization_id"
			AND "chat_channel"."kind" = 'general'
	)
	JOIN "chat_member" ON "chat_member"."agent_id" = "inbox_item"."agent_id"
	WHERE NOT EXISTS (SELECT 1 FROM "chat_message" WHERE "chat_message"."id" = "inbox_item"."id")
		AND NOT EXISTS (
			SELECT 1 FROM "chat_message"
			WHERE "chat_message"."author_member_id" = "chat_member"."id"
				AND "chat_message"."ask_key" = "inbox_item"."key"
		)
),
"copied" AS (
	INSERT INTO "chat_message" (
		"id", "organization_id", "channel_id", "seq", "touched_seq", "author_member_id", "blocks",
		"mentions", "client_key", "created_at", "touched_at", "ask", "ask_key", "ask_revision",
		"ask_status", "answer", "answer_key", "answered_by_member_id", "closed_reason"
	)
	SELECT "uncopied"."id", "uncopied"."workspace_id", "uncopied"."channel_id",
		"workspace_chat"."next_seq" + "uncopied"."place" - 1,
		"workspace_chat"."next_seq" + "uncopied"."place" - 1,
		"uncopied"."member_id", "uncopied"."blocks", '{}', "uncopied"."id"::text,
		"uncopied"."posted_at", "uncopied"."updated_at",
		jsonb_build_object(
			'title', "uncopied"."title",
			'response', "uncopied"."response",
			'needsReply', "uncopied"."needs_reply"
		),
		"uncopied"."key", "uncopied"."revision", "uncopied"."status", "uncopied"."answer",
		"uncopied"."answer_key",
		(
			SELECT "answerer"."id" FROM "chat_member" AS "answerer"
			WHERE "answerer"."organization_id" = "uncopied"."workspace_id"
				AND "answerer"."user_id" = "uncopied"."answered_by"
		),
		"uncopied"."closed_reason"
	FROM "uncopied"
	JOIN "workspace_chat" ON "workspace_chat"."organization_id" = "uncopied"."workspace_id"
	RETURNING "organization_id"
)
UPDATE "workspace_chat" SET "next_seq" = "workspace_chat"."next_seq" + "counted"."copies"
FROM (SELECT "organization_id", count(*) AS "copies" FROM "copied" GROUP BY "organization_id") AS "counted"
WHERE "workspace_chat"."organization_id" = "counted"."organization_id";
--> statement-breakpoint

-- Every picture of a copied item, under its own id, beside the message.
INSERT INTO "chat_attachment" ("id", "organization_id", "message_id", "content_type", "byte_count", "bytes", "created_at")
SELECT "inbox_attachment"."id", "chat_message"."organization_id", "inbox_attachment"."item_id",
	"inbox_attachment"."content_type", "inbox_attachment"."byte_count", "inbox_attachment"."bytes",
	"inbox_attachment"."created_at"
FROM "inbox_attachment"
JOIN "chat_message" ON "chat_message"."id" = "inbox_attachment"."item_id"
WHERE NOT EXISTS (SELECT 1 FROM "chat_attachment" WHERE "chat_attachment"."id" = "inbox_attachment"."id");

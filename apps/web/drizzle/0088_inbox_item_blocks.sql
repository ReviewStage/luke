ALTER TABLE "inbox_item" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN "blocks" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN "response" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_item" ALTER COLUMN "kind" SET DEFAULT 'question';
--> statement-breakpoint
CREATE FUNCTION "inbox_item_0088_blocks"("details" text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE
		WHEN "details" IS NULL OR btrim("details") = '' THEN '[]'::jsonb
		ELSE jsonb_build_array(jsonb_build_object('type', 'markdown', 'text', "details"))
	END
$$;
--> statement-breakpoint
CREATE FUNCTION "inbox_item_0088_response"("kind" text, "options" jsonb, "recommended" text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE "kind"
		WHEN 'choice' THEN jsonb_strip_nulls(jsonb_build_object(
			'type', 'choice',
			'options', coalesce("options", '[]'::jsonb),
			'recommended', "recommended"
		))
		WHEN 'approval' THEN '{"type":"approval"}'::jsonb
		WHEN 'question' THEN '{"type":"text"}'::jsonb
		WHEN 'task' THEN '{"type":"task"}'::jsonb
		ELSE '{"type":"none"}'::jsonb
	END
$$;
--> statement-breakpoint
CREATE FUNCTION "inbox_item_0088_answer"("answer" jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE
		WHEN "answer" ? 'choice' THEN jsonb_set("answer" - 'choice', '{choices}', jsonb_build_array("answer"->'choice'))
		ELSE "answer"
	END
$$;
--> statement-breakpoint
UPDATE "inbox_item" SET
	"version" = 2,
	"blocks" = inbox_item_0088_blocks("details"),
	"response" = inbox_item_0088_response("kind", "options", "recommended"),
	"answer" = inbox_item_0088_answer("answer");
--> statement-breakpoint
CREATE FUNCTION "inbox_item_0088_kind"("response" jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE "response"->>'type'
		WHEN 'choice' THEN 'choice'
		WHEN 'approval' THEN 'approval'
		WHEN 'task' THEN 'task'
		ELSE 'question'
	END
$$;
--> statement-breakpoint
CREATE FUNCTION "inbox_item_0088_details"("blocks" jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
	SELECT string_agg(
		CASE "block"->>'type' WHEN 'markdown' THEN "block"->>'text' ELSE ("block"->>'label') || ': ' || ("block"->>'url') END,
		E'\n\n' ORDER BY "at"
	)
	FROM jsonb_array_elements("blocks") WITH ORDINALITY AS "listed"("block", "at")
	WHERE "block"->>'type' IN ('markdown', 'link')
$$;
--> statement-breakpoint
CREATE FUNCTION "inbox_item_0088_fill"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	"old_shape" boolean;
	"new_shape" boolean;
BEGIN
	NEW."answer" := inbox_item_0088_answer(NEW."answer");
	IF TG_OP = 'INSERT' THEN
		"new_shape" := NEW."response" <> '{}'::jsonb;
		"old_shape" := NOT "new_shape";
	ELSE
		"new_shape" := (NEW."blocks", NEW."response") IS DISTINCT FROM (OLD."blocks", OLD."response");
		"old_shape" := NOT "new_shape" AND (NEW."kind", NEW."details", NEW."options", NEW."recommended")
			IS DISTINCT FROM (OLD."kind", OLD."details", OLD."options", OLD."recommended");
	END IF;
	IF "new_shape" THEN
		NEW."kind" := inbox_item_0088_kind(NEW."response");
		NEW."details" := inbox_item_0088_details(NEW."blocks");
		NEW."options" := CASE WHEN NEW."kind" = 'choice' THEN NEW."response"->'options' END;
		NEW."recommended" := CASE WHEN NEW."kind" = 'choice' THEN NEW."response"->>'recommended' END;
	ELSIF "old_shape" THEN
		NEW."version" := 2;
		NEW."blocks" := inbox_item_0088_blocks(NEW."details");
		NEW."response" := inbox_item_0088_response(NEW."kind", NEW."options", NEW."recommended");
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "inbox_item_0088_fill" BEFORE INSERT OR UPDATE ON "inbox_item" FOR EACH ROW EXECUTE FUNCTION "inbox_item_0088_fill"();

CREATE FUNCTION "plan_0082_labelled"("label" text, "content" text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE WHEN "content" IS NULL THEN NULL ELSE '**' || "label" || '**' || E'\n\n' || "content" END
$$;
--> statement-breakpoint
CREATE FUNCTION "plan_0082_list"("value" jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE WHEN jsonb_typeof("value") = 'array' THEN "value" ELSE '[]'::jsonb END
$$;
--> statement-breakpoint
CREATE FUNCTION "plan_0082_rules"("rules" jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
	SELECT string_agg(
		'- ' || ("rule"->>'statement') || coalesce((
			SELECT string_agg(
				E'\n  - Given ' || coalesce("example"->>'given', '?') ||
				', when ' || coalesce("example"->>'when', '?') ||
				', then ' || coalesce("example"->>'then', '?'),
				'' ORDER BY "example_at"
			)
			FROM jsonb_array_elements(plan_0082_list("rule"->'examples')) WITH ORDINALITY AS "examples"("example", "example_at")
		), ''),
		E'\n' ORDER BY "rule_at"
	)
	FROM jsonb_array_elements(plan_0082_list("rules")) WITH ORDINALITY AS "listed"("rule", "rule_at")
$$;
--> statement-breakpoint
CREATE FUNCTION "plan_0082_fields"("f" jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
	SELECT jsonb_build_object(
		'context', "f" #>> '{goal,problem}',
		'goal', "f" #>> '{goal,outcome}',
		'approach', NULLIF(concat_ws(E'\n\n',
			plan_0082_labelled('Included', "f" #>> '{scope,included}'),
			plan_0082_labelled('Change map', "f" #>> '{implementation,changeMap}'),
			plan_0082_labelled('Patterns to follow', "f" #>> '{implementation,patterns}'),
			plan_0082_labelled('Decisions', "f"->>'decisions'),
			plan_0082_labelled('Left to the agent', "f"->>'leftToAgent')
		), ''),
		'interfaces', "f" #>> '{implementation,contracts}',
		'alternatives', NULL,
		'hardParts', NULLIF(concat_ws(E'\n\n',
			plan_0082_labelled('Constraints', "f" #>> '{scope,constraints}'),
			plan_0082_labelled('Rules', plan_0082_rules("f"->'rules'))
		), ''),
		'notDoing', "f" #>> '{scope,excluded}',
		'planOfAttack', NULLIF(concat_ws(E'\n\n',
			plan_0082_labelled('Order', "f" #>> '{implementation,order}'),
			plan_0082_labelled('Data and migration', "f"->>'dataAndMigration')
		), ''),
		'testing', "f"->>'verification',
		'openQuestions', plan_0082_list("f"->'openQuestions')
	)
$$;
--> statement-breakpoint
CREATE FUNCTION "plan_0082_field"("old" text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE "old"
		WHEN 'problem' THEN 'context'
		WHEN 'outcome' THEN 'goal'
		WHEN 'included' THEN 'approach'
		WHEN 'changeMap' THEN 'approach'
		WHEN 'patterns' THEN 'approach'
		WHEN 'decisions' THEN 'approach'
		WHEN 'leftToAgent' THEN 'approach'
		WHEN 'contracts' THEN 'interfaces'
		WHEN 'constraints' THEN 'hardParts'
		WHEN 'rules' THEN 'hardParts'
		WHEN 'excluded' THEN 'notDoing'
		WHEN 'order' THEN 'planOfAttack'
		WHEN 'dataAndMigration' THEN 'planOfAttack'
		WHEN 'verification' THEN 'testing'
		ELSE "old"
	END
$$;
--> statement-breakpoint
CREATE FUNCTION "plan_0082_writers"("writers" jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
	SELECT coalesce(jsonb_agg("writer" ORDER BY ("writer"->>'at')::numeric), '[]'::jsonb)
	FROM (
		SELECT DISTINCT ON (plan_0082_field("old"->>'field'))
			jsonb_set("old", '{field}', to_jsonb(plan_0082_field("old"->>'field'))) AS "writer"
		FROM jsonb_array_elements(plan_0082_list("writers")) AS "listed"("old")
		ORDER BY plan_0082_field("old"->>'field'), ("old"->>'at')::numeric DESC
	) AS "newest"
$$;
--> statement-breakpoint
UPDATE "plan" SET "fields" = plan_0082_fields("fields"), "field_writers" = plan_0082_writers("field_writers"), "body" = '' WHERE "fields" ? 'implementation';
--> statement-breakpoint
UPDATE "plan_revision" SET "fields" = plan_0082_fields("fields") WHERE "fields" ? 'implementation';
--> statement-breakpoint
DROP FUNCTION "plan_0082_writers"(jsonb);
--> statement-breakpoint
DROP FUNCTION "plan_0082_field"(text);
--> statement-breakpoint
DROP FUNCTION "plan_0082_fields"(jsonb);
--> statement-breakpoint
DROP FUNCTION "plan_0082_rules"(jsonb);
--> statement-breakpoint
DROP FUNCTION "plan_0082_list"(jsonb);
--> statement-breakpoint
DROP FUNCTION "plan_0082_labelled"(text, text);

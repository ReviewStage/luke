CREATE FUNCTION "plan_0074_labelled"("label" text, "content" text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE WHEN "content" IS NULL THEN NULL ELSE '**' || "label" || '**' || E'\n\n' || "content" END
$$;
--> statement-breakpoint
CREATE FUNCTION "plan_0074_list"("value" jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE WHEN jsonb_typeof("value") = 'array' THEN "value" ELSE '[]'::jsonb END
$$;
--> statement-breakpoint
CREATE FUNCTION "plan_0074_rules"("rules" jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
	SELECT string_agg(
		'- ' || ("rule"->>'statement') || coalesce((
			SELECT string_agg(
				E'\n  - Given ' || coalesce("example"->>'given', '?') ||
				', when ' || coalesce("example"->>'when', '?') ||
				', then ' || coalesce("example"->>'then', '?'),
				'' ORDER BY "example_at"
			)
			FROM jsonb_array_elements(plan_0074_list("rule"->'examples')) WITH ORDINALITY AS "examples"("example", "example_at")
		), ''),
		E'\n' ORDER BY "rule_at"
	)
	FROM jsonb_array_elements(plan_0074_list("rules")) WITH ORDINALITY AS "listed"("rule", "rule_at")
$$;
--> statement-breakpoint
CREATE FUNCTION "plan_0074_fields"("f" jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
	SELECT jsonb_build_object(
		'context', "f" #>> '{goal,problem}',
		'goal', "f" #>> '{goal,outcome}',
		'approach', NULLIF(concat_ws(E'\n\n',
			plan_0074_labelled('Included', "f" #>> '{scope,included}'),
			plan_0074_labelled('Change map', "f" #>> '{implementation,changeMap}'),
			plan_0074_labelled('Patterns to follow', "f" #>> '{implementation,patterns}'),
			plan_0074_labelled('Decisions', "f"->>'decisions'),
			plan_0074_labelled('Left to the agent', "f"->>'leftToAgent')
		), ''),
		'interfaces', "f" #>> '{implementation,contracts}',
		'alternatives', NULL,
		'hardParts', NULLIF(concat_ws(E'\n\n',
			plan_0074_labelled('Constraints', "f" #>> '{scope,constraints}'),
			plan_0074_labelled('Rules', plan_0074_rules("f"->'rules'))
		), ''),
		'notDoing', "f" #>> '{scope,excluded}',
		'planOfAttack', NULLIF(concat_ws(E'\n\n',
			plan_0074_labelled('Order', "f" #>> '{implementation,order}'),
			plan_0074_labelled('Data and migration', "f"->>'dataAndMigration')
		), ''),
		'testing', "f"->>'verification',
		'openQuestions', plan_0074_list("f"->'openQuestions')
	)
$$;
--> statement-breakpoint
UPDATE "plan" SET "fields" = plan_0074_fields("fields"), "body" = '' WHERE "fields" ? 'implementation';
--> statement-breakpoint
UPDATE "plan_revision" SET "fields" = plan_0074_fields("fields") WHERE "fields" ? 'implementation';
--> statement-breakpoint
DROP FUNCTION "plan_0074_fields"(jsonb);
--> statement-breakpoint
DROP FUNCTION "plan_0074_rules"(jsonb);
--> statement-breakpoint
DROP FUNCTION "plan_0074_list"(jsonb);
--> statement-breakpoint
DROP FUNCTION "plan_0074_labelled"(text, text);

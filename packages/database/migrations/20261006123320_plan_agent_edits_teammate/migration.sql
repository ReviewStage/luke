CREATE FUNCTION "plan_0084_field"("old" text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
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
CREATE FUNCTION "plan_0084_stale"("note" jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
	SELECT "note"->>'kind' = 'addExample' OR plan_0084_field("note"->>'field') IS DISTINCT FROM "note"->>'field'
$$;
--> statement-breakpoint
CREATE FUNCTION "plan_0084_note"("note" jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE
		WHEN "note"->>'kind' = 'addExample' THEN jsonb_build_object(
			'kind', 'add',
			'field', 'hardParts',
			'text', 'Rule ' || ("note"->>'rule') ||
				': Given ' || coalesce("note"->>'given', '?') ||
				', when ' || coalesce("note"->>'when', '?') ||
				', then ' || coalesce("note"->>'then', '?')
		)
		WHEN plan_0084_stale("note") THEN jsonb_set("note", '{field}', to_jsonb(plan_0084_field("note"->>'field')))
		ELSE "note"
	END
$$;
--> statement-breakpoint
CREATE FUNCTION "plan_0084_edits"("edits" jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
	SELECT coalesce(jsonb_agg(
		jsonb_set("edit", '{notes}', (
			SELECT coalesce(jsonb_agg(plan_0084_note("note") ORDER BY "note_at"), '[]'::jsonb)
			FROM jsonb_array_elements("edit"->'notes') WITH ORDINALITY AS "notes"("note", "note_at")
		))
		ORDER BY "edit_at"
	), '[]'::jsonb)
	FROM jsonb_array_elements("edits") WITH ORDINALITY AS "listed"("edit", "edit_at")
$$;
--> statement-breakpoint
UPDATE "plan" SET "agent_edits" = plan_0084_edits("agent_edits") WHERE EXISTS (
	SELECT 1
	FROM jsonb_array_elements("agent_edits") AS "listed"("edit"), jsonb_array_elements("edit"->'notes') AS "notes"("note")
	WHERE plan_0084_stale("note")
);
--> statement-breakpoint
DROP FUNCTION "plan_0084_edits"(jsonb);
--> statement-breakpoint
DROP FUNCTION "plan_0084_note"(jsonb);
--> statement-breakpoint
DROP FUNCTION "plan_0084_stale"(jsonb);
--> statement-breakpoint
DROP FUNCTION "plan_0084_field"(text);

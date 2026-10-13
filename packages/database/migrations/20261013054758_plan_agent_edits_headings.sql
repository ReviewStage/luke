CREATE OR REPLACE FUNCTION "plan_agent_edits_headings_heading"("field" text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE "field"
		WHEN 'context' THEN 'Context'
		WHEN 'goal' THEN 'Goal'
		WHEN 'approach' THEN 'Approach'
		WHEN 'interfaces' THEN 'Interfaces'
		WHEN 'alternatives' THEN 'Alternatives'
		WHEN 'hardParts' THEN 'Hard parts'
		WHEN 'notDoing' THEN 'Not doing'
		WHEN 'planOfAttack' THEN 'Plan of attack'
		WHEN 'testing' THEN 'Testing'
		WHEN 'openQuestions' THEN 'Open questions'
		WHEN 'assumptions' THEN 'Assumptions'
	END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "plan_agent_edits_headings_stale"("note" jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
	SELECT "note" ? 'field' AND plan_agent_edits_headings_heading("note"->>'field') IS NOT NULL
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "plan_agent_edits_headings_item"("text" text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
	SELECT '- ' || regexp_replace(
		regexp_replace(
			regexp_replace(regexp_replace("text", '^\s+|\s+$', '', 'g'), '^(([-*+]|[0-9]{1,9}[.)])[ \t]+)+', ''),
			'^\s+|\s+$', '', 'g'
		),
		E'\n(?=[^\n])', E'\n  ', 'g'
	)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "plan_agent_edits_headings_note"("note" jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE
		WHEN NOT plan_agent_edits_headings_stale("note") THEN "note"
		WHEN "note"->>'kind' = 'add' THEN jsonb_build_object(
			'kind', 'add',
			'section', plan_agent_edits_headings_heading("note"->>'field'),
			'text', CASE
				WHEN "note"->>'field' IN ('openQuestions', 'assumptions') THEN plan_agent_edits_headings_item("note"->>'text')
				ELSE "note"->>'text'
			END
		)
		ELSE "note" - 'field'
	END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "plan_agent_edits_headings_edits"("edits" jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
	SELECT coalesce(jsonb_agg(
		jsonb_set("edit", '{notes}', (
			SELECT coalesce(jsonb_agg(plan_agent_edits_headings_note("note") ORDER BY "note_at"), '[]'::jsonb)
			FROM jsonb_array_elements("edit"->'notes') WITH ORDINALITY AS "notes"("note", "note_at")
		))
		ORDER BY "edit_at"
	), '[]'::jsonb)
	FROM jsonb_array_elements("edits") WITH ORDINALITY AS "listed"("edit", "edit_at")
$$;
--> statement-breakpoint
UPDATE "plan" SET "agent_edits" = plan_agent_edits_headings_edits("agent_edits") WHERE EXISTS (
	SELECT 1
	FROM jsonb_array_elements("agent_edits") AS "listed"("edit"), jsonb_array_elements("edit"->'notes') AS "notes"("note")
	WHERE plan_agent_edits_headings_stale("note")
);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "plan_agent_edits_headings_edits"(jsonb);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "plan_agent_edits_headings_note"(jsonb);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "plan_agent_edits_headings_item"(text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "plan_agent_edits_headings_stale"(jsonb);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "plan_agent_edits_headings_heading"(text);

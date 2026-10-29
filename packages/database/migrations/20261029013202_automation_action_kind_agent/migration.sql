-- An automation's action kind is spelled `agent`, no longer `coding-agent`; a row already rewritten is left alone, so running it again changes nothing.
UPDATE "automation" SET "action" = jsonb_set("action", '{kind}', '"agent"') WHERE "action"->>'kind' = 'coding-agent';

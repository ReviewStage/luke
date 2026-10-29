-- The release serving beside the action kind's rewrite wrote a few automations as `coding-agent` while it drained; this repeats that rewrite, which leaves a row already spelled `agent` alone, so running it again changes nothing.
UPDATE "automation" SET "action" = jsonb_set("action", '{kind}', '"agent"') WHERE "action"->>'kind' = 'coding-agent';

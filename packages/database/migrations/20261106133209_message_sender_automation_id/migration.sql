ALTER TABLE "messages" ADD COLUMN "sender_automation_id" uuid;--> statement-breakpoint
-- An automation's line kept only its name until now; every one already kept names the automation its agent belongs to, by the id a reader opens it by: the automation whose run started the agent, under its name now or the one its run kept, or the automation that sends every run to the agent, under its name now. Note that a line whose automation is gone, or was renamed since and holds the agent only as its target, stays unnamed, as it reads already.
UPDATE "messages" SET "sender_automation_id" = "automation"."id"
FROM "agent", "automation"
WHERE "agent"."conversation_id" = "messages"."conversation_id"
  AND "messages"."sender" = 'automation'
  AND "messages"."sender_automation_id" IS NULL
  AND (
    ("automation"."id" = "agent"."automation_id"
      AND "messages"."sender_name" IN ("automation"."name", "agent"."automation_origin" ->> 'name'))
    OR ("automation"."target_agent_id" = "agent"."id"
      AND "messages"."sender_name" = "automation"."name")
  );

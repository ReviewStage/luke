-- A wakeup an agent set came back to it as a line of the app's ("luke", its channel "luke"), which read as Vespin's; the sweep now sends it as the agent's own (`native-wakeup-sweep.ts`), so every one already kept names the agent of its conversation the same way, by its name as `agentName` reads it, short of a model's label, and the model it runs on. Note that nothing else wrote that channel into an agent's conversation: the operator's own lines went with its conversations.
UPDATE "messages" SET
  "sender" = 'agent',
  "sender_agent_id" = "agent"."id",
  "sender_name" = coalesce("agent"."title", "agent"."automation_origin" ->> 'name', "agent"."model"),
  "sender_model" = "agent"."model"
FROM "agent"
WHERE "agent"."conversation_id" = "messages"."conversation_id"
  AND "messages"."sender" = 'luke'
  AND "messages"."metadata" ->> 'channel' = 'luke';

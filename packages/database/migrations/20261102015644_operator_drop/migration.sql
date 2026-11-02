-- An operator's heartbeat automations go first: their target only goes null when the agent goes, which would leave them standing aimed at nothing.
DELETE FROM "automation" WHERE "target_agent_id" IN (SELECT "id" FROM "agent" WHERE "kind" = 'operator');--> statement-breakpoint
-- Every operator goes with its conversation, which cascades to its row, its messages and turns, and its inbox items, so no row names a kind the store no longer reads.
DELETE FROM "conversations" WHERE "id" IN (SELECT "conversation_id" FROM "agent" WHERE "kind" = 'operator');--> statement-breakpoint
DROP TABLE "operator_notice";--> statement-breakpoint
DROP TABLE "operator_wake";--> statement-breakpoint
DROP INDEX "agent_member_operator";
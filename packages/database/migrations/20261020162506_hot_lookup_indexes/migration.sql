-- The migrator runs every folder inside one transaction, so CONCURRENTLY is unavailable here.
-- Measured on a copy of production taken 2026-10-20 15:14 UTC: member 43 rows, coding_agent 704,
-- inbox_item 552, conversations 1,581, so each build holds its table's write lock for
-- milliseconds and needs no online step before the deploy.
CREATE INDEX IF NOT EXISTS "member_userId_organizationId_idx" ON "member" ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coding_agent_org_taskless_created" ON "coding_agent" ("organization_id","created_at") WHERE "task_id" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_item_org_open_taskless_updated" ON "inbox_item" ("organization_id","updated_at") WHERE "status" = 'open' and "task_id" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_runtime_session" ON "conversations" ("runtime_session_id") WHERE "runtime_session_id" is not null;

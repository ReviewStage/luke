ALTER TABLE "agent_browser_tab" ADD COLUMN IF NOT EXISTS "cursor_x" double precision;--> statement-breakpoint
ALTER TABLE "agent_browser_tab" ADD COLUMN IF NOT EXISTS "cursor_y" double precision;--> statement-breakpoint
ALTER TABLE "agent_browser_tab" ADD COLUMN IF NOT EXISTS "cursor_kind" text;--> statement-breakpoint
ALTER TABLE "agent_browser_tab" ADD COLUMN IF NOT EXISTS "cursor_viewport_w" integer;--> statement-breakpoint
ALTER TABLE "agent_browser_tab" ADD COLUMN IF NOT EXISTS "cursor_viewport_h" integer;--> statement-breakpoint
ALTER TABLE "agent_browser_tab" ADD COLUMN IF NOT EXISTS "cursor_at" timestamp with time zone;
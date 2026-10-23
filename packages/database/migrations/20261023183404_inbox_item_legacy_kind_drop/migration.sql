-- contract: the fixed kinds an inbox item stood in before blocks and a response, "kind", "details", "options", and "recommended", have been declared no longer since 20261007104640_inbox_item_blocks, and only its trigger kept them in step for a desktop from before version 2, which no desktop still speaks; the trigger goes first, because it names them on every write
DROP TRIGGER IF EXISTS "inbox_item_0088_fill" ON "inbox_item";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "inbox_item_0088_fill"();
--> statement-breakpoint
DROP FUNCTION IF EXISTS "inbox_item_0088_kind"(jsonb);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "inbox_item_0088_details"(jsonb);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "inbox_item_0088_answer"(jsonb);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "inbox_item_0088_response"(text, jsonb, text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "inbox_item_0088_blocks"(text);
--> statement-breakpoint
ALTER TABLE "inbox_item" DROP COLUMN IF EXISTS "kind";
--> statement-breakpoint
ALTER TABLE "inbox_item" DROP COLUMN IF EXISTS "details";
--> statement-breakpoint
ALTER TABLE "inbox_item" DROP COLUMN IF EXISTS "options";
--> statement-breakpoint
ALTER TABLE "inbox_item" DROP COLUMN IF EXISTS "recommended";

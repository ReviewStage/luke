CREATE TABLE "sync_log" (
	"txid" bigint NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"table_name" text NOT NULL,
	"key" jsonb NOT NULL,
	"topics" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sync_log_txid" ON "sync_log" ("txid");
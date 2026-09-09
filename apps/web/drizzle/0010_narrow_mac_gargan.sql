CREATE TABLE "briefing" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_key" text NOT NULL,
	"run_id" text,
	"sealed_words" text NOT NULL,
	"decided_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"state" text NOT NULL,
	"claimed_by_device_id" text,
	"claimed_at" bigint,
	"settled_at" bigint
);
--> statement-breakpoint
CREATE TABLE "action_receipt" (
	"user_id" text NOT NULL,
	"run_id" text NOT NULL,
	"call_id" text NOT NULL,
	"session_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"name" text NOT NULL,
	"sealed_arguments" text NOT NULL,
	"started_at" bigint NOT NULL,
	"sealed_output" text,
	"settled_at" bigint,
	CONSTRAINT "action_receipt_user_id_run_id_call_id_pk" PRIMARY KEY("user_id","run_id","call_id")
);
--> statement-breakpoint
CREATE TABLE "compaction_boundary" (
	"user_id" text NOT NULL,
	"session_key" text NOT NULL,
	"transcript_sequence" bigint NOT NULL,
	"session_id" text,
	"source" text NOT NULL,
	"dropped" integer NOT NULL,
	"checkpoint_format" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "compaction_boundary_user_id_session_key_transcript_sequence_pk" PRIMARY KEY("user_id","session_key","transcript_sequence")
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"user_id" text NOT NULL,
	"session_key" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"created_at" bigint NOT NULL,
	"last_activity_at" bigint NOT NULL,
	"next_line_sequence" bigint DEFAULT 1 NOT NULL,
	"next_transcript_sequence" bigint DEFAULT 1 NOT NULL,
	"cleared_at" bigint,
	CONSTRAINT "conversation_user_id_session_key_pk" PRIMARY KEY("user_id","session_key")
);
--> statement-breakpoint
CREATE TABLE "conversation_line" (
	"user_id" text NOT NULL,
	"session_key" text NOT NULL,
	"sequence" bigint NOT NULL,
	"session_id" text,
	"event_key" text NOT NULL,
	"kind" text NOT NULL,
	"recorded_at" bigint NOT NULL,
	"request_id" text,
	"provider_id" text,
	"provider_session_id" text,
	"sealed_payload" text NOT NULL,
	CONSTRAINT "conversation_line_user_id_session_key_sequence_pk" PRIMARY KEY("user_id","session_key","sequence")
);
--> statement-breakpoint
CREATE TABLE "conversation_run" (
	"user_id" text NOT NULL,
	"run_id" text NOT NULL,
	"session_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"submission_id" text NOT NULL,
	"origin" text NOT NULL,
	"sealed_question" text NOT NULL,
	"status" text NOT NULL,
	"revision" integer NOT NULL,
	"accepted_at" bigint NOT NULL,
	"started_at" bigint,
	"settled_at" bigint,
	"sealed_text" text,
	"failure" text,
	"performed_actions" integer NOT NULL,
	"unknown_actions" integer NOT NULL,
	"ask_recorded_at" bigint,
	"conversation_recorded_at" bigint,
	"trigger" text,
	"run_origin" text,
	"ending" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"input_item_kinds" text[],
	"transcript_bytes" integer,
	"elapsed_ms" integer,
	"tool_names" text[],
	"compacted" boolean,
	CONSTRAINT "conversation_run_user_id_run_id_pk" PRIMARY KEY("user_id","run_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_session" (
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"session_key" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"reset_cleared_at" bigint,
	"reset_generation_id" text,
	"checkpoint_format" text,
	"compaction_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "conversation_session_user_id_session_id_pk" PRIMARY KEY("user_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "observation_capture_cursor" (
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"provider_session_id" text NOT NULL,
	"cursor" text NOT NULL,
	CONSTRAINT "observation_capture_cursor_user_id_session_id_provider_id_provider_session_id_pk" PRIMARY KEY("user_id","session_id","provider_id","provider_session_id")
);
--> statement-breakpoint
CREATE TABLE "observation_cursor" (
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"provider_session_id" text NOT NULL,
	"cursor" text NOT NULL,
	CONSTRAINT "observation_cursor_user_id_session_id_provider_id_provider_session_id_pk" PRIMARY KEY("user_id","session_id","provider_id","provider_session_id")
);
--> statement-breakpoint
CREATE TABLE "observation_inbox_entry" (
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"entry_id" text NOT NULL,
	"sealed_payload" text NOT NULL,
	CONSTRAINT "observation_inbox_entry_user_id_session_id_ordinal_pk" PRIMARY KEY("user_id","session_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "runtime_checkpoint" (
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"sealed_item" text NOT NULL,
	CONSTRAINT "runtime_checkpoint_user_id_session_id_sequence_pk" PRIMARY KEY("user_id","session_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "transcript_event" (
	"user_id" text NOT NULL,
	"session_key" text NOT NULL,
	"sequence" bigint NOT NULL,
	"session_id" text,
	"kind" text NOT NULL,
	"recorded_at" bigint NOT NULL,
	"sealed_payload" text NOT NULL,
	CONSTRAINT "transcript_event_user_id_session_key_sequence_pk" PRIMARY KEY("user_id","session_key","sequence")
);
--> statement-breakpoint
CREATE TABLE "roster_snapshot" (
	"user_id" text PRIMARY KEY NOT NULL,
	"sealed_body" text NOT NULL,
	"observed_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_fact" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"sealed_words" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "personal_fact_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "workspace_file" (
	"user_id" text NOT NULL,
	"path" text NOT NULL,
	"sealed_content" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "workspace_file_user_id_path_pk" PRIMARY KEY("user_id","path")
);
--> statement-breakpoint
ALTER TABLE "briefing" ADD CONSTRAINT "briefing_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_receipt" ADD CONSTRAINT "action_receipt_session_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."conversation_session"("user_id","session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compaction_boundary" ADD CONSTRAINT "compaction_boundary_conversation_fk" FOREIGN KEY ("user_id","session_key") REFERENCES "public"."conversation"("user_id","session_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_line" ADD CONSTRAINT "conversation_line_conversation_fk" FOREIGN KEY ("user_id","session_key") REFERENCES "public"."conversation"("user_id","session_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_run" ADD CONSTRAINT "conversation_run_session_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."conversation_session"("user_id","session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_session" ADD CONSTRAINT "conversation_session_conversation_fk" FOREIGN KEY ("user_id","session_key") REFERENCES "public"."conversation"("user_id","session_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_capture_cursor" ADD CONSTRAINT "observation_capture_cursor_session_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."conversation_session"("user_id","session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_cursor" ADD CONSTRAINT "observation_cursor_session_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."conversation_session"("user_id","session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_inbox_entry" ADD CONSTRAINT "observation_inbox_entry_session_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."conversation_session"("user_id","session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_checkpoint" ADD CONSTRAINT "runtime_checkpoint_session_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."conversation_session"("user_id","session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_event" ADD CONSTRAINT "transcript_event_conversation_fk" FOREIGN KEY ("user_id","session_key") REFERENCES "public"."conversation"("user_id","session_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_snapshot" ADD CONSTRAINT "roster_snapshot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_fact" ADD CONSTRAINT "personal_fact_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_file" ADD CONSTRAINT "workspace_file_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "briefing_by_user_state" ON "briefing" USING btree ("user_id","state","decided_at");--> statement-breakpoint
CREATE INDEX "action_receipt_by_session" ON "action_receipt" USING btree ("user_id","session_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_line_by_key" ON "conversation_line" USING btree ("user_id","session_key","event_key");--> statement-breakpoint
CREATE INDEX "conversation_line_by_time" ON "conversation_line" USING btree ("user_id","session_key","recorded_at","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_line_once_published" ON "conversation_line" USING btree ("user_id","session_key","request_id","kind") WHERE "conversation_line"."request_id" is not null;--> statement-breakpoint
CREATE INDEX "conversation_run_by_session" ON "conversation_run" USING btree ("user_id","session_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_session_one_standing" ON "conversation_session" USING btree ("user_id","session_key");
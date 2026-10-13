CREATE TABLE "inbox_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"byte_count" integer NOT NULL,
	"bytes" bytea NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbox_attachment_bytes_bound" CHECK (octet_length("bytes") <= 1500000)
);
--> statement-breakpoint
ALTER TABLE "inbox_attachment" ADD CONSTRAINT "inbox_attachment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_attachment" ADD CONSTRAINT "inbox_attachment_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_attachment" ADD CONSTRAINT "inbox_attachment_item_id_inbox_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inbox_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_attachment_item" ON "inbox_attachment" USING btree ("item_id");

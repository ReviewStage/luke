CREATE TABLE "write_receipt" (
	"user_id" text,
	"key" text,
	"written_at" timestamp with time zone NOT NULL,
	CONSTRAINT "write_receipt_pkey" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "write_receipt" ADD CONSTRAINT "write_receipt_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
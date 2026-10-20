CREATE TABLE IF NOT EXISTS "github_repository_read" (
	"user_id" text,
	"repository" text,
	"readable" boolean NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "github_repository_read_pkey" PRIMARY KEY("user_id","repository")
);
--> statement-breakpoint
ALTER TABLE "github_repository_read" DROP CONSTRAINT IF EXISTS "github_repository_read_user_id_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "github_repository_read" ADD CONSTRAINT "github_repository_read_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;

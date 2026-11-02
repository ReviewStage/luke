CREATE TABLE "github_repository" (
	"id" bigint PRIMARY KEY,
	"full_name" text NOT NULL,
	"github_updated_at" timestamp with time zone NOT NULL
);

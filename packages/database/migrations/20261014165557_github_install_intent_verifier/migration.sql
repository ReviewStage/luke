ALTER TABLE "github_install_intent" ADD COLUMN "installation_id" bigint;--> statement-breakpoint
ALTER TABLE "github_install_intent" ADD COLUMN "code_verifier" text;
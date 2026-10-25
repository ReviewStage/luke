CREATE TABLE "github_rate_hold" (
	"identity" text PRIMARY KEY,
	"held_until" timestamp with time zone NOT NULL,
	"strikes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

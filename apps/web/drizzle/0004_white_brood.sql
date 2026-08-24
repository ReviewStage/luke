CREATE TABLE "introduction_usage" (
	"caller" text NOT NULL,
	"day" text NOT NULL,
	"mints" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "introduction_usage_caller_day_pk" PRIMARY KEY("caller","day")
);

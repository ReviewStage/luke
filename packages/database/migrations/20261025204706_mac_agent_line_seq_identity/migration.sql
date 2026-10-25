DROP INDEX "mac_agent_line_agent_seq";--> statement-breakpoint
ALTER TABLE "mac_agent_line" ALTER COLUMN "seq" SET DATA TYPE bigint USING "seq"::bigint;--> statement-breakpoint
ALTER TABLE "mac_agent_line" ALTER COLUMN "seq" ADD GENERATED ALWAYS AS IDENTITY (sequence name "mac_agent_line_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);
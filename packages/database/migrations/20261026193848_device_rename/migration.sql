ALTER TABLE "mac_agent_line" RENAME TO "device_agent_line";--> statement-breakpoint
ALTER TABLE "mac_agent_request" RENAME TO "device_agent_request";--> statement-breakpoint
ALTER TABLE "mac_device" RENAME TO "device";--> statement-breakpoint
ALTER SEQUENCE "mac_agent_line_seq_seq" RENAME TO "device_agent_line_seq_seq";--> statement-breakpoint
ALTER INDEX "mac_agent_line_device_waiting" RENAME TO "device_agent_line_device_waiting";--> statement-breakpoint
ALTER INDEX "mac_agent_line_user_created" RENAME TO "device_agent_line_user_created";--> statement-breakpoint
ALTER INDEX "mac_agent_request_device_waiting" RENAME TO "device_agent_request_device_waiting";--> statement-breakpoint
ALTER INDEX "mac_agent_request_user_created" RENAME TO "device_agent_request_user_created";--> statement-breakpoint
ALTER INDEX "mac_device_user_seen" RENAME TO "device_user_seen";--> statement-breakpoint
ALTER TABLE "device" RENAME CONSTRAINT "mac_device_pkey" TO "device_pkey";--> statement-breakpoint
ALTER TABLE "device" RENAME CONSTRAINT "mac_device_user_id_user_id_fkey" TO "device_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "device_agent_line" RENAME CONSTRAINT "mac_agent_line_pkey" TO "device_agent_line_pkey";--> statement-breakpoint
ALTER TABLE "device_agent_line" RENAME CONSTRAINT "mac_agent_line_agent_id_coding_agent_id_fkey" TO "device_agent_line_agent_id_coding_agent_id_fkey";--> statement-breakpoint
ALTER TABLE "device_agent_line" RENAME CONSTRAINT "mac_agent_line_user_id_user_id_fkey" TO "device_agent_line_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "device_agent_line" RENAME CONSTRAINT "mac_agent_line_device_id_mac_device_id_fkey" TO "device_agent_line_device_id_device_id_fkey";--> statement-breakpoint
ALTER TABLE "device_agent_request" RENAME CONSTRAINT "mac_agent_request_pkey" TO "device_agent_request_pkey";--> statement-breakpoint
ALTER TABLE "device_agent_request" RENAME CONSTRAINT "mac_agent_request_agent_id_coding_agent_id_fkey" TO "device_agent_request_agent_id_coding_agent_id_fkey";--> statement-breakpoint
ALTER TABLE "device_agent_request" RENAME CONSTRAINT "mac_agent_request_user_id_user_id_fkey" TO "device_agent_request_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "device_agent_request" RENAME CONSTRAINT "mac_agent_request_device_id_mac_device_id_fkey" TO "device_agent_request_device_id_device_id_fkey";--> statement-breakpoint
ALTER TABLE "coding_agent" RENAME CONSTRAINT "coding_agent_device_id_mac_device_id_fkey" TO "coding_agent_device_id_device_id_fkey";--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "kind" text NOT NULL DEFAULT 'desktop';--> statement-breakpoint
ALTER TABLE "device" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "platform" text NOT NULL DEFAULT 'darwin';--> statement-breakpoint
ALTER TABLE "device" ALTER COLUMN "platform" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "arch" text NOT NULL DEFAULT 'arm64';--> statement-breakpoint
ALTER TABLE "device" ALTER COLUMN "arch" DROP DEFAULT;

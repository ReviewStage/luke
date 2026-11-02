-- Private memories go first: only the operator kept or recalled one, so none is read again, and the column cannot leave them standing as shared.
DELETE FROM "memory" WHERE "private_to" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "memory" DROP CONSTRAINT "memory_private_to_user_id_fkey";--> statement-breakpoint
ALTER TABLE "memory" DROP COLUMN "private_to";
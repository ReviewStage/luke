import { PICTURE_BOUNDS, type PictureType } from "@luke/features/picture-wire";
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { bytea, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { plan } from "./plan.js";

/**
 * plan-attachment.ts -- one picture of a plan's: the bytes a pasted or dropped image is, kept beside the plan its text names it in.
 *
 * A plan's text names a picture by its address (`@luke/features/plan-attachment-link`),
 * never by its bytes, so the plan's read and every revision carry a line,
 * and a reader fetches the bytes apart, as one of the plan's readers. The
 * bytes stand in the row itself, as an Inbox picture's do
 * (`inbox-attachment.ts`): this deployment keeps no blob store, and a
 * picture is at most `PICTURE_BOUNDS.MAX_BYTES`, a check on the
 * column. The media type is what the service sniffed the bytes to be, which
 * they are served under.
 *
 * A picture is the plan's, as the words around it are, so it goes with the
 * plan and stays when the member who uploaded it leaves or deletes their
 * account. Its bytes stand for as long as the plan does even once no text
 * names it, because every revision that named it can be restored. The one
 * waste is an upload no save ever named, pasted and undone, which
 * `saved_at` tells apart: a save stamps every picture its text names, and
 * the scheduled sweep deletes a picture a day old that no save stamped.
 */
export const planAttachment = pgTable(
  "plan_attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plan.id, { onDelete: "cascade" }),
    /** The member who uploaded it; null once their account is gone. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /** The media type the bytes were sniffed to be, which they are served under. */
    contentType: text("content_type").$type<PictureType>().notNull(),
    /** How many bytes the picture is, read off the row without the bytes. */
    byteCount: integer("byte_count").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: timestamptz("created_at").notNull(),
    /** The first save whose text named it; null while no save has. */
    savedAt: timestamptz("saved_at"),
  },
  (table) => [
    // A plan's pictures are read, counted, and stamped by the plan.
    index("plan_attachment_plan").on(table.planId),
    // The sweep reads the uploads no save named, oldest first.
    index("plan_attachment_unsaved").on(table.createdAt).where(sql`${table.savedAt} is null`),
    check(
      "plan_attachment_bytes_bound",
      sql`octet_length(${table.bytes}) <= ${PICTURE_BOUNDS.MAX_BYTES}`,
    ),
  ],
);

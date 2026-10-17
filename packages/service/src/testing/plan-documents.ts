import { Database } from "@luke/database/core/query";
import { task } from "@luke/database/schemas/task";
import { eq, sql } from "drizzle-orm";

/**
 * plan-documents.ts -- a stored plan's text and its revisions, as a test sets them.
 *
 * A plan starts as one document, a copy of its account's template
 * (`docs/TASKS.md`); a test that needs other words writes the text, or a
 * revision of the text, straight onto the rows.
 */

/** A synthetic document: a template's headings with an answer under each, and the assumptions as a section of the text. */
export const INVITATIONS_TEXT = [
  "## Context",
  "",
  "Only an admin can add someone to a workspace today.",
  "",
  "## Goal",
  "",
  "- Any member can invite a teammate by email.",
  "",
  "## Assumptions",
  "",
  "- An invite expires after 7 days.",
  "",
].join("\n");

/** Makes the plan one document holding `text`. */
export function makeDocumentTask(taskId: string, text: string) {
  return Database.use((db) => db.update(task).set({ document: text }).where(eq(task.id, taskId)));
}

/**
 * Makes the plan one document holding `text`, saved a minute after it
 * started and before its history began, so its first save records the text
 * as the revision it changed (`earlier`) and its sections read as no one's.
 */
export function makeSavedDocumentTask(taskId: string, text: string) {
  return Database.use((db) =>
    db
      .update(task)
      .set({ document: text, updatedAt: sql`${task.createdAt} + interval '1 minute'` })
      .where(eq(task.id, taskId)),
  );
}

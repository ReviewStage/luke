import { Database } from "@repo/database/core/query";
import { task } from "@repo/database/schemas/task";
import { eq, sql } from "drizzle-orm";

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

export function makeDocumentTask(taskId: string, text: string) {
  return Database.use((db) => db.update(task).set({ document: text }).where(eq(task.id, taskId)));
}

export function makeSavedDocumentTask(taskId: string, text: string) {
  return Database.use((db) =>
    db
      .update(task)
      .set({ document: text, updatedAt: sql`${task.createdAt} + interval '1 minute'` })
      .where(eq(task.id, taskId)),
  );
}

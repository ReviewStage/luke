import type { BoardElement, DrawingElement } from "@sidecar/hosted/board-wire";
import type { PlanSectionWriter } from "@sidecar/hosted/plan-document";
import type { PlanAgentEdit } from "@sidecar/hosted/plan-template";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./_helpers.js";
import { user } from "./auth.js";
import { conversations } from "./storage.js";

/**
 * plan.ts -- a named feature plan and its one current document.
 *
 * One row per plan, keyed by a UUID of the service's own and owned by the
 * account that started it: its name, whether it is pinned or archived, its
 * one document, a free Markdown text, who last changed each of its sections,
 * and the journal of the saves coding agents made on it. A save replaces the
 * text in one statement, so none is left half-written: a save that failed
 * left the row as it stood. What the text held before is kept beside it, in
 * `plan_revision` (`plan-revision.ts`). The text is stored as written,
 * like the conversation, readable by an operator and kept the developer's
 * own by the account it is keyed by.
 *
 * The conversation a plan resumes in is the one row it names, attached once
 * the planning model opens it, and a purged conversation leaves the plan
 * standing with none. The row cascades with its account, so deleting an
 * account is still one statement.
 */
export const plan = pgTable(
  "plan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The saves coding agents made on the document, oldest first, the last fifty kept; empty until an agent saves. */
    agentEdits: jsonb("agent_edits")
      .$type<readonly PlanAgentEdit[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The plan as one free Markdown document, its whole text: no title line, and its assumptions a section like any other (`@sidecar/hosted/plan-document`). */
    document: text("document").notNull(),
    /** Who last changed each section and when, by heading; empty until a save changes one. */
    sectionWriters: jsonb("section_writers")
      .$type<readonly PlanSectionWriter[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /**
     * The GitHub repository the plan is about, `owner/name` as GitHub spells
     * it, confirmed reachable through the Luke GitHub App by the account
     * before it was written; null until one is chosen, which is where every
     * plan from before repositories stands and is no error.
     */
    repository: text("repository"),
    /** When the plan was pinned, which the sidebar lists first, newest pin first; null while it is not. */
    pinnedAt: timestamptz("pinned_at"),
    /** When the plan was archived, which the list leaves out unless asked for it; null while it is not. */
    archivedAt: timestamptz("archived_at"),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    /** The last save of the document; the start, before any. */
    updatedAt: updatedAt(),
  },
  (table) => [
    // The plan list reads one account's plans, newest started first.
    index("plan_user_created").on(table.userId, table.createdAt),
  ],
);

/**
 * A plan's whiteboard: the Excalidraw scene the Plans tab shows, with the
 * number of Luke's drawing it holds, and Luke's latest drawing with its own
 * number. A plan has no row until its board is first drawn on, and reads as
 * an empty board until then. Beside them stands the scene as the Mac drew it,
 * a PNG, from the first save that held each new drawing of Luke's, which is
 * what the planning model looks at (`look_at_board`). The Mac writes the scene and Luke writes the
 * drawing, each whole and each the last write winning (`board-store.ts`).
 * The row goes with its plan.
 */
export const planBoard = pgTable("plan_board", {
  planId: uuid("plan_id")
    .primaryKey()
    .references(() => plan.id, { onDelete: "cascade" }),
  elements: jsonb("elements").$type<readonly BoardElement[]>().notNull().default(sql`'[]'::jsonb`),
  /** The number of Luke's drawing the scene holds; 0 before it holds any. */
  appliedDrawing: integer("applied_drawing").notNull().default(0),
  /** Luke's latest drawing; null before he drew. */
  drawing: jsonb("drawing").$type<readonly DrawingElement[]>(),
  /** The latest drawing's number, one more for each drawing; 0 before he drew. */
  drawingNumber: integer("drawing_number").notNull().default(0),
  /** The scene drawn as a PNG, base64, by the Mac's first save to hold drawing `applied_drawing`; null before one. */
  image: text("image"),
  updatedAt: updatedAt(),
});

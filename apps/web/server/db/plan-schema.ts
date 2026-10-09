import type { BoardElement, BoardLookResult, DrawingElement } from "@sidecar/hosted/board-wire";
import type { PlanFields } from "@sidecar/hosted/plan-template";
import type { PlanAssumption, PlanCommandResult } from "@sidecar/hosted/plan-wire";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";
import { instant } from "./instant.js";
import { conversations } from "./storage-schema.js";

/**
 * plan-schema.ts -- a named feature plan and its one current document.
 *
 * One row per plan, keyed by a UUID of the service's own and owned by the
 * account that started it: its name and the one
 * document the planning model saves, a Markdown body and the assumptions list
 * beside it, with the template's fields the body was formatted from. A save
 * replaces all three columns in one statement, so there is no
 * earlier document to fall back on and none half-written: a save that failed
 * left the row as it stood. The document is stored as written, like the
 * conversation, readable by an operator and kept the developer's own by the
 * account it is keyed by.
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
    /** The document's Markdown body; empty until the first save. */
    body: text("body").notNull().default(""),
    /** The document's assumptions, each its text. */
    assumptions: jsonb("assumptions")
      .$type<readonly PlanAssumption[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The template's fields the body was formatted from; null until the first save, an untouched template. */
    fields: jsonb("fields").$type<PlanFields>(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    createdAt: instant("created_at").notNull().defaultNow(),
    /** The last save of the document; the start, before any. */
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // The plan list reads one account's plans, newest started first.
    index("plan_user_created").on(table.userId, table.createdAt),
  ],
);

/**
 * One command the planning model asked to run in a plan's folder, which only
 * the developer's Mac knows. The tool inserts it, the Mac claims it
 * (`claimed_at`) and runs it, and posts the `result` the tool is waiting on.
 * Rows go with their plan.
 */
export const planCommand = pgTable("plan_command", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plan.id, { onDelete: "cascade" }),
  command: text("command").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
  claimedAt: instant("claimed_at"),
  /** What the Mac answered: the exit code, stdout, and stderr; null until it does. */
  result: jsonb("result").$type<PlanCommandResult>(),
});

/**
 * One look at a plan's whiteboard the planning model asked for, which only
 * the developer's Mac can draw. The tool inserts it, the Mac claims it
 * (`claimed_at`), draws the board, and posts the `result` the tool is waiting
 * on: the image, or why there is none. A table of its own rather than a kind
 * of `plan_command`, so a Mac that predates it never claims one and runs it
 * as a shell command. Rows go with their plan.
 */
export const planBoardLook = pgTable("plan_board_look", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plan.id, { onDelete: "cascade" }),
  createdAt: instant("created_at").notNull().defaultNow(),
  claimedAt: instant("claimed_at"),
  result: jsonb("result").$type<BoardLookResult>(),
});

/**
 * A plan's whiteboard: the Excalidraw scene the Plans tab shows, with the
 * number of Luke's drawing it holds, and Luke's latest drawing with its own
 * number. A plan has no row until its board is first drawn on, and reads as
 * an empty board until then. The Mac writes the scene and Luke writes the
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
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

import { Schema as EffectSchema } from "effect";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * account-inbox-wire.ts -- what waits on the developer across every plan: the account's open inbox items, in brief, read past a cursor.
 *
 * A plan's inbox is read while that plan is open (`inbox-wire.ts`); this is
 * the one read that stands whichever plan is open, or none, so the desktop
 * can say an item landed while the developer was elsewhere, badge the Dock
 * with what waits, and count each plan's open items in the sidebar. It
 * carries no item whole, only what those three draw: the item's id, plan,
 * agent, title, revision, and instants, and the agent as its row names it
 * now, its title or else its model, so an agent this Mac has never listed,
 * one started on another, is still named. An archived plan's items wait
 * nowhere, since the developer put the plan out of the way. The read is
 * held open while nothing changed past the cursor, as a plan's inbox read
 * is, and starts from the plan read's own start (`INBOX_CURSOR_START`).
 */

export const ACCOUNT_INBOX_BOUNDS = {
  /**
   * The most open items one read carries, the latest changed first: far
   * more than a person works through, since each agent keeps at most
   * `INBOX_BOUNDS.MAX_OPEN_PER_AGENT` open.
   */
  MAX_ITEMS: 500,
} as const;

/** One open item as the account's read carries it: where it waits, who posted it, and what it is called. */
export const accountInboxEntrySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  planId: wireUuidSchema,
  agentId: wireUuidSchema,
  /** The agent's title as its row holds it now; null until it has one. */
  agentTitle: EffectSchema.NullOr(EffectSchema.String),
  /** The model the agent runs on, which names it until it has a title. */
  agentModel: EffectSchema.String,
  title: EffectSchema.String,
  revision: countedNumber,
  /** When the agent first posted the item under its key. */
  postedAt: countedNumber,
  /** When the item last changed. */
  updatedAt: countedNumber,
});

export type AccountInboxEntry = typeof accountInboxEntrySchema.Type;

/**
 * Every item that waits on the developer across the account's plans, the
 * latest changed first, the cursor to read on from, and when the service
 * read them, by its own clock: an item that changed after one answer's
 * `readAt` is one that opened since, where one only now back in the answer,
 * its plan brought back from the archive, changed before it.
 */
export const accountInboxAnswerSchema = EffectSchema.Struct({
  items: EffectSchema.Array(accountInboxEntrySchema),
  cursor: EffectSchema.String,
  readAt: countedNumber,
});

export type AccountInboxAnswer = typeof accountInboxAnswerSchema.Type;

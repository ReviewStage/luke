import { Schema as EffectSchema } from "effect";
import { automationRunReasonSchema } from "./automation-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * account-inbox-wire.ts -- what waits on the developer across every plan: the account's open inbox items, in brief, read past a cursor.
 *
 * A plan's inbox is read while that plan is open (`inbox-wire.ts`); this is
 * the one read that stands whichever plan is open, or none, so the desktop
 * can say an item landed while the developer was elsewhere, badge the Dock
 * with what waits, count each plan's open items, and list every plan
 * holding an item, open or settled, in its Inbox. It
 * carries no item whole, only what those three draw: the item's id, plan,
 * agent, title, revision, and instants, the agent as its row names it
 * now, its title or else its model, and who started it, since an agent's
 * questions are its starter's to be told of, so an agent this Mac has never listed,
 * one started on another, is still named. It carries every open item,
 * however long ago it changed, as a plan's read carries every open one
 * apart from its bound: the open items an agent may hold at once keep them
 * few. An archived plan's items wait
 * nowhere, since the developer put the plan out of the way. The read is
 * held open while nothing changed past the cursor, as a plan's inbox read
 * is, and starts from the plan read's own start (`INBOX_CURSOR_START`).
 *
 * An item of an agent an automation started with no plan waits too, in
 * the workspace the agent belongs to, but under keys of its own beside the
 * plans' (`planless`, `automations`) rather than in `items` and `plans`,
 * which name a plan: a build that reads only those drops the keys it does
 * not know, as every service answer is read (`readServiceAnswer`), and
 * never meets an item it cannot place.
 *
 * A run of one of the account's own automations that failed to start rides
 * the same read, under `failedRuns`, and moves the same cursor, so its
 * owner hears of it whichever page is open. It is no item: nothing answers
 * it, and the Inbox lists none. Only the newest of each automation's in the
 * last week is carried, which is what its owner is told of and what marks
 * the automation until it is opened.
 */

/** One open item as the account's read carries it: where it waits, who posted it, and what it is called. */
export const accountInboxEntrySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  planId: wireUuidSchema,
  agentId: wireUuidSchema,
  /** The agent's title as its row holds it now; null until it has one. */
  agentTitle: EffectSchema.NullOr(EffectSchema.String),
  /** The model the agent runs on, which names it until it has a title. */
  agentModel: EffectSchema.String,
  /**
   * The account that started the agent, the one it asks and the one the
   * desktop badges and tells; absent from a service that does not say,
   * which the desktop reads as the reader's own, as it told everyone before.
   */
  startedBy: EffectSchema.optionalKey(EffectSchema.String),
  title: EffectSchema.String,
  revision: countedNumber,
  /** When the agent first posted the item under its key. */
  postedAt: countedNumber,
  /** When the item last changed. */
  updatedAt: countedNumber,
});

export type AccountInboxEntry = typeof accountInboxEntrySchema.Type;

/** One plan the account's read lists as holding inbox items: the plan, how many it holds, open and settled alike, and when the latest of them changed. */
export const accountInboxPlanSchema = EffectSchema.Struct({
  planId: wireUuidSchema,
  items: countedNumber,
  updatedAt: countedNumber,
});

export type AccountInboxPlan = typeof accountInboxPlanSchema.Type;

/**
 * One open item of an agent with no plan, as the account's read carries it:
 * where a plan's item names its plan, this names the automation whose run
 * started the agent and the repository it works in, which together stand
 * in the plan's place. The automation, and its name with it, is null for
 * an agent no automation started, once that automation is deleted, and for
 * a reader the automation's own rule does not let read it, such as a
 * member beside another's personal automation, whose runs every member
 * reads.
 */
export const accountPlanlessEntrySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  agentId: wireUuidSchema,
  agentTitle: EffectSchema.NullOr(EffectSchema.String),
  agentModel: EffectSchema.String,
  /** The account that started the agent, as an item of a plan's agent says it, and on the same terms. */
  startedBy: EffectSchema.optionalKey(EffectSchema.String),
  automationId: EffectSchema.NullOr(wireUuidSchema),
  automationName: EffectSchema.NullOr(EffectSchema.String),
  repository: EffectSchema.String,
  /** The workspace the agent belongs to, whose list its items stand in; absent from a service before it. */
  workspaceId: EffectSchema.optionalKey(EffectSchema.String),
  title: EffectSchema.String,
  revision: countedNumber,
  postedAt: countedNumber,
  updatedAt: countedNumber,
});

export type AccountPlanlessEntry = typeof accountPlanlessEntrySchema.Type;

/** One automation the account's read lists as holding items of its runs' agents with no plan, as a plan is listed for its own: how many, open and settled alike, and when the latest changed; null groups the agents no standing automation the reader may read names. */
export const accountInboxAutomationSchema = EffectSchema.Struct({
  automationId: EffectSchema.NullOr(wireUuidSchema),
  items: countedNumber,
  updatedAt: countedNumber,
});

export type AccountInboxAutomation = typeof accountInboxAutomationSchema.Type;

/** A run of one of the account's own automations that failed to start: the run, its automation by id and name, the workspace it stands in, why, and when. */
export const accountFailedRunSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  automationId: wireUuidSchema,
  automationName: EffectSchema.String,
  workspaceId: EffectSchema.String,
  reason: EffectSchema.NullOr(automationRunReasonSchema),
  /** Epoch milliseconds the run failed. */
  failedAt: countedNumber,
});

export type AccountFailedRun = typeof accountFailedRunSchema.Type;

/**
 * Every item that waits on the developer across the account's plans, the
 * latest changed first, the cursor to read on from, and when the service
 * read them, by its own clock: an item that changed after one answer's
 * `readAt` is one that opened since, where one only now back in the answer,
 * its plan brought back from the archive, changed before it. Beside them,
 * every plan holding any item, waiting or settled, the plan whose item
 * changed latest first, which the desktop's Inbox lists: a plan whose
 * items were all answered holds no open one, so only this names it. The
 * items of agents with no plan wait in `planless`, listed by automation in
 * `automations`, on the same terms; a service that predates them sends
 * neither. The newest failed run of each of the account's own automations
 * rides beside them in `failedRuns`; a service before it sends none.
 */
export const accountInboxAnswerSchema = EffectSchema.Struct({
  items: EffectSchema.Array(accountInboxEntrySchema),
  plans: EffectSchema.Array(accountInboxPlanSchema),
  planless: EffectSchema.optionalKey(EffectSchema.Array(accountPlanlessEntrySchema)),
  automations: EffectSchema.optionalKey(EffectSchema.Array(accountInboxAutomationSchema)),
  failedRuns: EffectSchema.optionalKey(EffectSchema.Array(accountFailedRunSchema)),
  cursor: EffectSchema.String,
  readAt: countedNumber,
});

export type AccountInboxAnswer = typeof accountInboxAnswerSchema.Type;

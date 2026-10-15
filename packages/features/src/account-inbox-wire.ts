import { Schema as EffectSchema } from "effect";
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
 * agent, title, revision, and instants, and the agent as its row names it
 * now, its title or else its model, so an agent this Mac has never listed,
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
 * What waits on the developer in the workspaces' chat rides beside them
 * under a key of its own (`chat`), on the same terms: every open ask
 * someone else posted, and the one direct message or mention their member
 * was last told of and has not read past. Each says only enough to be
 * announced and opened, who posted it by handle and the plan of the
 * channel it stands in, and none of its words, which the window reads
 * from the chat itself. A build that predates it reads none.
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
  automationId: EffectSchema.NullOr(wireUuidSchema),
  automationName: EffectSchema.NullOr(EffectSchema.String),
  repository: EffectSchema.String,
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

/** Why a chat message waits on the developer. */
export const ACCOUNT_CHAT_REASON = {
  /** An ask someone else posted, still open. */
  ASK: "ask",
  /** A direct message to the developer they have not read past. */
  DIRECT: "direct",
  /** A message mentioning the developer, or replying in a thread of theirs, they have not read past. */
  MENTION: "mention",
} as const;

/**
 * One chat message that waits on the developer, as the account's read
 * carries it: the message by its id and its place in its workspace's chat,
 * the workspace, why it waits, who posted it by handle, the plan of the
 * channel it stands in where it stands in a plan's, the place it last
 * changed at, which an ask posted again moves, and when it last changed.
 */
export const accountChatEntrySchema = EffectSchema.Struct({
  messageId: wireUuidSchema,
  seq: countedNumber,
  workspaceId: EffectSchema.String,
  reason: EffectSchema.Literals(Object.values(ACCOUNT_CHAT_REASON)),
  from: EffectSchema.String,
  planId: EffectSchema.NullOr(wireUuidSchema),
  touchedSeq: countedNumber,
  updatedAt: countedNumber,
});

export type AccountChatEntry = typeof accountChatEntrySchema.Type;

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
 * neither. What waits in chat rides in `chat`, the latest changed first.
 */
export const accountInboxAnswerSchema = EffectSchema.Struct({
  items: EffectSchema.Array(accountInboxEntrySchema),
  plans: EffectSchema.Array(accountInboxPlanSchema),
  planless: EffectSchema.optionalKey(EffectSchema.Array(accountPlanlessEntrySchema)),
  automations: EffectSchema.optionalKey(EffectSchema.Array(accountInboxAutomationSchema)),
  chat: EffectSchema.optionalKey(EffectSchema.Array(accountChatEntrySchema)),
  cursor: EffectSchema.String,
  readAt: countedNumber,
});

export type AccountInboxAnswer = typeof accountInboxAnswerSchema.Type;

import { createHash } from "node:crypto";
import type { AccountInboxAnswer } from "@luke/features/account-inbox-wire";
import type { InboxAnswer } from "@luke/features/inbox-wire";
import { Clock, type Duration, Effect, Schedule } from "effect";
import {
  accountInboxAutomations,
  accountInboxPlans,
  accountPlanlessItems,
  accountWaitingItems,
  accountWaitingStamps,
  type InboxStamp,
  type InboxStoreEffect,
  memberAgentInboxItems,
  memberAgentInboxStamps,
  planInboxItems,
  planInboxStamps,
} from "../../inbox/inbox-store.js";
import { CODER } from "./bounds.js";

/**
 * inbox-page.ts -- a plan's inbox as the desktop reads it, and what waits across the account: each held open while nothing changed since the reader's cursor.
 *
 * The cursor is a digest of where every item stands, so a post, a close,
 * an answer, and a new item each move it, and a reader that holds it hears
 * the next change once. A read whose cursor is
 * still the inbox's is held, looked at again every `MESSAGES_POLL`, each
 * look reading where the items stand and none of their words, and let
 * go at `MESSAGES_HOLD` as a transcript read is (`transcript.ts`), so the
 * Inbox tab hears an item the moment it lands without asking on a clock of
 * its own; a read past the hold answers the inbox unchanged, and the reader
 * asks again.
 *
 * The account's read is the same hold over the account's open items, the
 * desktop's one read that stands whichever plan is open: it is what says an
 * item landed while the developer was elsewhere. It names every plan holding
 * an item too, settled ones included, read once per answer rather than on
 * each look: a plan's list moves with its open items, since every item
 * opens before it settles, and what moves it alone, such as an archive, is
 * answered at the hold's end at the latest. Note that it looks every
 * `ACCOUNT_INBOX_POLL` rather than `MESSAGES_POLL`, because a desktop holds
 * it for as long as it is signed in rather than while a tab is on screen.
 * The open items of agents with no plan, and the automations holding them,
 * ride beside the plans' under keys of their own, and move the same cursor.
 */

/** How many characters of the digest a cursor carries: far more than any two inboxes of a plan could share by chance. */
const CURSOR_CHARS = 32;

/**
 * Where the inbox stands for a reader: a digest of every item's id,
 * revision, status, and instant, taken in the items' id order so the same
 * items read in another order are the same cursor, and any change to any
 * item moves it, two within one millisecond included. Note that an empty
 * inbox digests to a cursor of its own rather than the start, so a first
 * read answers at once.
 */
function cursorOf(
  stamps: readonly Pick<InboxStamp, "id" | "revision" | "status" | "updatedAt">[],
): string {
  const standing = stamps
    .map((stamp) => [stamp.id, stamp.revision, stamp.status, stamp.updatedAt] as const)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(standing)).digest("hex").slice(0, CURSOR_CHARS);
}

/**
 * Waits until the stamps move past the reader's cursor, or the hold ends:
 * each look reads where the items stand and none of their words, and the
 * caller reads them whole once this returns.
 */
function heldUntilMoved(
  stamps: InboxStoreEffect<readonly InboxStamp[]>,
  after: string,
  poll: Duration.Duration,
): InboxStoreEffect<void> {
  const moved = Effect.map(stamps, (standing) => cursorOf(standing) !== after);
  return moved.pipe(
    Effect.repeat({ schedule: Schedule.spaced(poll), until: (changed) => changed }),
    Effect.timeoutOption(CODER.MESSAGES_HOLD),
    Effect.asVoid,
  );
}

/** One agent's inbox as any member of its workspace reads it, held while its cursor is still the reader's: what an agent's page answers from. */
export function agentInboxPast(
  userId: string,
  agentId: string,
  after: string,
): InboxStoreEffect<InboxAnswer> {
  return heldUntilMoved(memberAgentInboxStamps(userId, agentId), after, CODER.MESSAGES_POLL).pipe(
    Effect.andThen(memberAgentInboxItems(userId, agentId)),
    Effect.map((items) => ({ items, cursor: cursorOf(items) })),
  );
}

/** The plan's inbox as it stands, held while its cursor is still the reader's. */
export function planInboxPast(
  userId: string,
  planId: string,
  after: string,
): InboxStoreEffect<InboxAnswer> {
  return heldUntilMoved(planInboxStamps(userId, planId), after, CODER.MESSAGES_POLL).pipe(
    Effect.andThen(planInboxItems(userId, planId)),
    Effect.map((items) => ({ items, cursor: cursorOf(items) })),
  );
}

/**
 * What waits on the developer across the account, held while its cursor is
 * still the reader's, and when it was read. Note that the instant is taken
 * before the items are, because an item written between the two would
 * otherwise read as changed before an answer that does not hold it.
 */
export function accountInboxPast(
  userId: string,
  after: string,
): InboxStoreEffect<AccountInboxAnswer> {
  const read = Effect.gen(function* () {
    const readAt = yield* Clock.currentTimeMillis;
    const rows = yield* accountWaitingItems(userId);
    const plans = yield* accountInboxPlans(userId);
    const planlessRows = yield* accountPlanlessItems(userId);
    const automations = yield* accountInboxAutomations(userId);
    const items = rows.map(({ status: _status, ...entry }) => entry);
    const planless = planlessRows.map(({ status: _status, ...entry }) => entry);
    const cursor = cursorOf([...rows, ...planlessRows]);
    return { items, plans, planless, automations, cursor, readAt };
  });
  return heldUntilMoved(accountWaitingStamps(userId), after, CODER.ACCOUNT_INBOX_POLL).pipe(
    Effect.andThen(read),
  );
}

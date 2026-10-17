import { ownFailedAutomationRuns } from "@luke/database/models/automation-store";
import type { AccountFailedRun, AccountInboxAnswer } from "@luke/features/account-inbox-wire";
import { AUTOMATION_RUN_STATUS } from "@luke/features/automation-wire";
import type { InboxAnswer } from "@luke/features/inbox-wire";
import { Clock, Duration, Effect } from "effect";
import { cursorOf, heldUntilMoved as heldOpen } from "../../http/held-read.js";
import {
  accountInboxAutomations,
  accountInboxTasks,
  accountTasklessItems,
  accountWaitingItems,
  accountWaitingStamps,
  type InboxStamp,
  type InboxStoreEffect,
  memberAgentInboxItems,
  memberAgentInboxStamps,
  taskInboxItems,
  taskInboxStamps,
} from "../../inbox/inbox-store.js";
import { CODER } from "./bounds.js";

/**
 * inbox-page.ts -- a task's inbox as the desktop reads it, and what waits across the account: each held open while nothing changed since the reader's cursor.
 *
 * The cursor is a digest of where every item stands (`http/held-read.ts`),
 * so a post, a close, an answer, and a new item each move it, and a reader
 * that holds it hears the next change once. A read whose cursor is
 * still the inbox's is held, looked at again every `MESSAGES_POLL`, each
 * look reading where the items stand and none of their words, and let
 * go at `MESSAGES_HOLD` as a transcript read is (`transcript.ts`), so the
 * Inbox tab hears an item the moment it lands without asking on a clock of
 * its own; a read past the hold answers the inbox unchanged, and the reader
 * asks again.
 *
 * The account's read is the same hold over the account's open items, the
 * desktop's one read that stands whichever task is open: it is what says an
 * item landed while the developer was elsewhere. It names every task holding
 * an item too, settled ones included, read once per answer rather than on
 * each look: a task's list moves with its open items, since every item
 * opens before it settles, and what moves it alone, such as an archive, is
 * answered at the hold's end at the latest. Note that it looks every
 * `ACCOUNT_INBOX_POLL` rather than `MESSAGES_POLL`, because a desktop holds
 * it for as long as it is signed in rather than while a tab is on screen.
 * The open items of agents with no task, and the automations holding them,
 * ride beside the tasks' under keys of their own, and move the same cursor.
 * So does the newest run of each of the account's own automations that
 * failed to start in the last `FAILED_RUN_WINDOW`, which is no item, but
 * is what its owner is told of whichever plan is open.
 */

/** How far back a run that failed to start is still carried to its automation's owner. */
const FAILED_RUN_WINDOW = Duration.days(7);

/** What a cursor digests of one thing it covers, an item or a failed run. */
type InboxCursorStamp = Pick<InboxStamp, "id" | "revision" | "updatedAt"> & {
  readonly status: string;
};

/** Waits until the inbox moves past the reader's cursor, or a transcript read's hold ends. */
function heldUntilMoved(
  stamps: InboxStoreEffect<readonly InboxCursorStamp[]>,
  after: string,
  poll: Duration.Duration,
): InboxStoreEffect<void> {
  return heldOpen(stamps, after, poll, CODER.MESSAGES_HOLD);
}

/** The newest run of each of the account's own automations that failed to start in the window, as its owner is told of it. */
function failedRunsOf(userId: string): InboxStoreEffect<readonly AccountFailedRun[]> {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const since = new Date(now - Duration.toMillis(FAILED_RUN_WINDOW));
    const runs = yield* ownFailedAutomationRuns(userId, since);
    return runs.map((run) => ({ ...run, failedAt: run.failedAt.getTime() }));
  });
}

/** Where each failed run stands, as the cursor digests it beside the items: a run settles once, so its id and instant are all of it. */
function failedRunStamps(runs: readonly AccountFailedRun[]): readonly InboxCursorStamp[] {
  return runs.map((run) => ({
    id: run.id,
    revision: 0,
    status: AUTOMATION_RUN_STATUS.FAILED,
    updatedAt: run.failedAt,
  }));
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

/** The task's inbox as it stands, held while its cursor is still the reader's. */
export function taskInboxPast(
  userId: string,
  taskId: string,
  after: string,
): InboxStoreEffect<InboxAnswer> {
  return heldUntilMoved(taskInboxStamps(userId, taskId), after, CODER.MESSAGES_POLL).pipe(
    Effect.andThen(taskInboxItems(userId, taskId)),
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
    const tasks = yield* accountInboxTasks(userId);
    const tasklessRows = yield* accountTasklessItems(userId);
    const automations = yield* accountInboxAutomations(userId);
    const failedRuns = yield* failedRunsOf(userId);
    const items = rows.map(({ status: _status, ...entry }) => entry);
    const planless = tasklessRows.map(({ status: _status, ...entry }) => entry);
    const cursor = cursorOf([...rows, ...tasklessRows, ...failedRunStamps(failedRuns)]);
    return { items, plans: tasks, planless, automations, failedRuns, cursor, readAt };
  });
  const stamps = Effect.zipWith(
    accountWaitingStamps(userId),
    Effect.map(failedRunsOf(userId), failedRunStamps),
    (items, runs) => [...items, ...runs],
  );
  return heldUntilMoved(stamps, after, CODER.ACCOUNT_INBOX_POLL).pipe(Effect.andThen(read));
}

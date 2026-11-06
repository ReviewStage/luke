import { ownFailedAutomationRuns } from "@repo/database/models/automation-store";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import type { AccountFailedRun, AccountInboxAnswer } from "@repo/features/account-inbox-wire";
import { AUTOMATION_RUN_STATUS } from "@repo/features/automation-wire";
import type { InboxAnswer } from "@repo/features/inbox-wire";
import { FAILED_RUN_WINDOW_MILLIS } from "@repo/features/live-wire";
import { Clock, Duration, Effect } from "effect";
import { cursorOf, heldUntilMoved as heldOpen } from "../../http/held-read.js";
import {
  accountInboxAgents,
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

const FAILED_RUN_WINDOW = Duration.millis(FAILED_RUN_WINDOW_MILLIS);

type InboxCursorStamp = Pick<InboxStamp, "id" | "revision" | "updatedAt"> & {
  readonly status: string;
  readonly unread?: boolean;
  readonly waitsOn?: string;
};

function itemStamps(items: InboxAnswer["items"]): readonly InboxCursorStamp[] {
  return items.map(({ waitsOn, ...item }) => ({
    ...item,
    ...(waitsOn === undefined ? undefined : { waitsOn: waitsOn.userId }),
  }));
}

function heldUntilMoved(
  stamps: InboxStoreEffect<readonly InboxCursorStamp[]>,
  after: string,
  topics: readonly SyncTopic[],
  poll: Duration.Duration,
): InboxStoreEffect<void> {
  return heldOpen(stamps, after, topics, poll, CODER.MESSAGES_HOLD);
}

function failedRunsOf(userId: string): InboxStoreEffect<readonly AccountFailedRun[]> {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const since = new Date(now - Duration.toMillis(FAILED_RUN_WINDOW));
    const runs = yield* ownFailedAutomationRuns(userId, since);
    return runs.map((run) => ({ ...run, failedAt: run.failedAt.getTime() }));
  });
}

function failedRunStamps(runs: readonly AccountFailedRun[]): readonly InboxCursorStamp[] {
  return runs.map((run) => ({
    id: run.id,
    revision: 0,
    status: AUTOMATION_RUN_STATUS.FAILED,
    updatedAt: run.failedAt,
  }));
}

export function agentInboxPast(
  userId: string,
  agentId: string,
  after: string,
): InboxStoreEffect<InboxAnswer> {
  return heldUntilMoved(
    memberAgentInboxStamps(userId, agentId),
    after,
    [[TOPIC.AGENT, agentId]],
    CODER.MESSAGES_POLL,
  ).pipe(
    Effect.andThen(memberAgentInboxItems(userId, agentId)),
    Effect.map((items) => ({ items, cursor: cursorOf(itemStamps(items)) })),
  );
}

export function taskInboxPast(
  userId: string,
  taskId: string,
  after: string,
): InboxStoreEffect<InboxAnswer> {
  return heldUntilMoved(
    taskInboxStamps(userId, taskId),
    after,
    [[TOPIC.TASK, taskId]],
    CODER.MESSAGES_POLL,
  ).pipe(
    Effect.andThen(taskInboxItems(userId, taskId)),
    Effect.map((items) => ({ items, cursor: cursorOf(itemStamps(items)) })),
  );
}

function accountStamps(userId: string): InboxStoreEffect<readonly InboxCursorStamp[]> {
  return Effect.gen(function* () {
    const items = yield* accountWaitingStamps(userId);
    const runs = failedRunStamps(yield* failedRunsOf(userId));
    return [...items, ...runs];
  });
}

export function accountInboxPast(
  userId: string,
  after: string,
  repositoryless = false,
): InboxStoreEffect<AccountInboxAnswer> {
  const read = Effect.gen(function* () {
    const readAt = yield* Clock.currentTimeMillis;
    const cursor = cursorOf(yield* accountStamps(userId));
    const rows = yield* accountWaitingItems(userId);
    const tasks = yield* accountInboxTasks(userId);
    const tasklessRows = yield* accountTasklessItems(userId, repositoryless);
    const automations = yield* accountInboxAutomations(userId);
    const agents = yield* accountInboxAgents(userId, repositoryless);
    const failedRuns = yield* failedRunsOf(userId);
    const items = rows.map(({ status: _status, ...entry }) => entry);
    const taskless = tasklessRows.map(({ status: _status, ...entry }) => entry);
    return {
      items,
      plans: tasks,
      planless: taskless,
      automations,
      agents,
      failedRuns,
      cursor,
      readAt,
    };
  });
  return heldUntilMoved(
    accountStamps(userId),
    after,
    [[TOPIC.ACCOUNT, userId]],
    CODER.ACCOUNT_INBOX_POLL,
  ).pipe(Effect.andThen(read));
}

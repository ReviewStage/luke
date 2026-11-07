/**
 * scope-inbox.ts -- one plan's inbox and one agent's bound (`TASK_INBOX_READ`, `AGENT_INBOX_READ`): their statements, the tables they read, the topics that wake them, and who they admit.
 *
 * Their statements are the inbox store's own (`taskInboxLiveStatements`,
 * `memberAgentInboxLiveStatements`), beside the held reads they mirror and
 * the SQL those share.
 */

import type { StoreFailure } from "@repo/database/core/query";
import { readVisibleAgent } from "@repo/database/models/agent-store";
import { readTaskHeader } from "@repo/database/models/task-store";
import { TOPIC } from "@repo/database/sync/notification";
import {
  agentSync,
  attachmentSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  inboxItemReadSync,
  inboxItemSync,
  inboxMessageSync,
  memberSync,
  taskSync,
  userSync,
} from "@repo/database/sync/tables";
import { AGENT_INBOX_READ, TASK_INBOX_READ } from "@repo/features/inbox-live";
import { Effect, Option } from "effect";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import {
  memberAgentInboxLiveStatements,
  taskInboxLiveStatements,
} from "../../inbox/inbox-store.js";
import { bindLiveRead } from "../live-read-binding.js";

/** What reaches an inbox item: its workspace's membership and, for one of an agent on a member's own token, that member's GitHub access. */
export const ITEM_GATES = [memberSync, githubPersonalTokenSync, githubRepositoryReadSync] as const;

/** What a task's or an agent's inbox reads: its items, their threads and files, the reader's marks, and who each names. */
export const SCOPE_INBOX_READS = [
  inboxItemSync,
  inboxMessageSync,
  inboxItemReadSync,
  attachmentSync,
  taskSync,
  agentSync,
  userSync,
  ...ITEM_GATES,
] as const;

/** The account's read of a row: refused as not found where it reaches none. */
function found<A, R>(read: Effect.Effect<Option.Option<A>, StoreFailure, R>) {
  return Effect.flatMap(hostedStoreOrUnavailable(read), (row) =>
    Option.isNone(row) ? Effect.fail(HOSTED_REFUSAL.NOT_FOUND) : Effect.void,
  );
}

/**
 * One task's inbox, woken by a write to its items, their threads, files,
 * and read marks, or to the task and its agents, all of which name the
 * task, after the task is read as the account, so one it does not reach is
 * not found, as its held read answers. Note that it takes no account's
 * topic, because an item written anywhere in the account's workspaces names
 * the account, and a window follows one of these for every task its Inbox
 * lists: what moves the reader's reach, or a name it shows, shows at the
 * hold's end, and the reader's reach is checked again on every request.
 */
export const taskInboxRead = bindLiveRead(TASK_INBOX_READ, {
  reads: SCOPE_INBOX_READS,
  topics: ({ id }) => [[TOPIC.TASK, id]],
  statements: ({ userId, id }) => taskInboxLiveStatements(userId, id),
  admit: ({ userId, id }) => found(readTaskHeader(userId, id)),
});

/** One agent's inbox, as any member of its workspace reads it, woken as a task's is, on the agent's topic, and admitted as a task's is, the agent read as the account. */
export const agentInboxRead = bindLiveRead(AGENT_INBOX_READ, {
  reads: SCOPE_INBOX_READS,
  topics: ({ id }) => [[TOPIC.AGENT, id]],
  statements: ({ userId, id }) => memberAgentInboxLiveStatements(userId, id),
  admit: ({ userId, id }) => found(readVisibleAgent(userId, id)),
});

/**
 * live-queries.ts -- every live read Luke Sync wakes, by its name, as one registry the registry test reads.
 *
 * A read is moved onto Luke Sync by defining it (`defineLiveQuery`), adding
 * it here, and answering its procedure from the definition
 * (`liveQueryParts`). Each view's own change defines its read, and a read
 * with no definition is looked at on its clock.
 */
import { ownFailedRunsLiveStatement } from "@luke/database/models/automation-store";
import { macCommandsLiveStatement } from "@luke/database/models/mac-command-store";
import { repositoryPinsLiveStatement } from "@luke/database/models/repository-pin-store";
import { taskSectionsLiveStatements } from "@luke/database/models/task-section-store";
import { TOPIC } from "@luke/database/sync/notification";
import {
  agentSectionEntrySync,
  attachmentSync,
  automationRunSync,
  automationSync,
  channelSync,
  codingAgentSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  inboxItemReadSync,
  inboxItemSync,
  inboxMessageSync,
  macCommandSync,
  memberSync,
  repositoryPinSync,
  taskSectionEntrySync,
  taskSectionSync,
  taskSync,
  userSync,
} from "@luke/database/sync/tables";
import { macCommandKindsRead } from "@luke/features/mac-command-wire";
import { Option } from "effect";
import {
  accountInboxLiveStatements,
  channelsLiveStatements,
  memberAgentInboxLiveStatements,
  taskInboxLiveStatements,
} from "../inbox/inbox-store.js";
import { defineLiveQuery, LIVE_MODE, liveQueryRegistry } from "./live-query.js";

/**
 * The account's sidebar: its sections, the tasks and agents it keeps in
 * them, and its pinned repositories, woken by a write to any of them or to
 * what admits the account to a workspace or a repository, all of which name
 * the account. Note that a task or an agent written itself wakes no
 * sidebar, because a plan's save rewrites its task every few seconds and
 * every member keeping it would read again for nothing: a task moved or
 * deleted leaves its sections by its entries' own delete, and the rare
 * change that hides an entry without one shows at the hold's end.
 */
export const sidebarLive = defineLiveQuery({
  name: "sidebar",
  params: ["userId"],
  reads: [
    taskSectionSync,
    taskSectionEntrySync,
    agentSectionEntrySync,
    repositoryPinSync,
    taskSync,
    codingAgentSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId }) =>
    Option.zipWith(
      taskSectionsLiveStatements(userId),
      repositoryPinsLiveStatement(userId),
      (sections, pins) => ({ ...sections, pins }),
    ),
  mode: LIVE_MODE.SNAPSHOT,
});

/**
 * The commands of the kinds a Mac runs that no Mac of the account has
 * claimed yet, woken by a command queued, claimed, settled, or taken back,
 * each of which names the account. The kinds are the read's query as the
 * Mac spelled them, read here as its held read always read them.
 */
export const macCommandsLive = defineLiveQuery({
  name: "macCommands",
  params: ["userId", "kinds"],
  reads: [macCommandSync],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId, kinds }) =>
    Option.map(macCommandsLiveStatement(userId, macCommandKindsRead(kinds)), (commands) => ({
      commands,
    })),
  mode: LIVE_MODE.SNAPSHOT,
});

/** What reaches an inbox item: its workspace's membership and, for one of an agent on a member's own token, that member's GitHub access. */
const ITEM_GATES = [memberSync, githubPersonalTokenSync, githubRepositoryReadSync] as const;

/**
 * What waits on the account across its workspaces, its tasks and
 * automations holding items, and its own automations' failed runs, woken
 * by an item written in any of its workspaces, which names every member
 * (`inboxItemSync`), by its own read marks, by its own automations and
 * their runs, and by what admits it to a workspace or a repository, all of
 * which name the account. Note that a task or an agent written itself
 * wakes no account's inbox, because a plan's save rewrites its task every
 * few seconds and every member would read again for nothing: the rare
 * change the inbox shows of either, a task's assignee or an agent's title,
 * shows at the hold's end.
 */
export const inboxLive = defineLiveQuery({
  name: "inbox",
  params: ["userId"],
  reads: [
    inboxItemSync,
    inboxItemReadSync,
    taskSync,
    codingAgentSync,
    automationSync,
    automationRunSync,
    ...ITEM_GATES,
  ],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId }) =>
    Option.zipWith(
      accountInboxLiveStatements(userId),
      ownFailedRunsLiveStatement(userId),
      (parts, failedRuns) => ({ ...parts, failedRuns }),
    ),
  mode: LIVE_MODE.SNAPSHOT,
});

/** What a task's or an agent's inbox reads: its items, their threads and files, the reader's marks, and who each names. */
const SCOPE_INBOX_READS = [
  inboxItemSync,
  inboxMessageSync,
  inboxItemReadSync,
  attachmentSync,
  taskSync,
  codingAgentSync,
  userSync,
  ...ITEM_GATES,
] as const;

/**
 * One task's inbox, woken by a write to its items, their threads, files,
 * and read marks, or to the task and its agents, all of which name the
 * task. Note that it takes no account's topic, because an item written
 * anywhere in the account's workspaces names the account, and a window
 * follows one of these for every task its Inbox lists: what moves the
 * reader's reach, or a name it shows, shows at the hold's end, and the
 * procedure checks the reader's reach again on every request.
 */
export const taskInboxLive = defineLiveQuery({
  name: "taskInbox",
  params: ["userId", "taskId"],
  reads: SCOPE_INBOX_READS,
  topics: ({ taskId }) => [[TOPIC.TASK, taskId]],
  statements: ({ userId, taskId }) => taskInboxLiveStatements(userId, taskId),
  mode: LIVE_MODE.SNAPSHOT,
});

/** One agent's inbox, as any member of its workspace reads it, woken as a task's is, on the agent's topic. */
export const agentInboxLive = defineLiveQuery({
  name: "agentInbox",
  params: ["userId", "agentId"],
  reads: SCOPE_INBOX_READS,
  topics: ({ agentId }) => [[TOPIC.AGENT, agentId]],
  statements: ({ userId, agentId }) => memberAgentInboxLiveStatements(userId, agentId),
  mode: LIVE_MODE.SNAPSHOT,
});

/**
 * One workspace's channels and where each one's threads stand, woken by a
 * channel or an item written in any of the account's workspaces, both of
 * which name every member (`channelSync`, `inboxItemSync`), and by what
 * admits the account to a workspace or a repository. Note that an agent
 * written itself wakes none, because the read only asks whether the reader
 * sees each thread's agent, which the agent's GitHub reach decides.
 */
export const channelsLive = defineLiveQuery({
  name: "channels",
  params: ["userId", "workspaceId"],
  reads: [channelSync, inboxItemSync, codingAgentSync, ...ITEM_GATES],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId, workspaceId }) => channelsLiveStatements(userId, workspaceId),
  mode: LIVE_MODE.SNAPSHOT,
});

export const LIVE_QUERIES = liveQueryRegistry([
  sidebarLive,
  macCommandsLive,
  inboxLive,
  taskInboxLive,
  agentInboxLive,
  channelsLive,
]);

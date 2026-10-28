/**
 * live-queries.ts -- every live read Luke Sync wakes, by its name, as one registry the registry test reads.
 *
 * A read is moved onto Luke Sync by defining it (`defineLiveQuery`), adding
 * it here, and answering its procedure from the definition
 * (`liveQueryParts`). Each view's own change defines its read, and a read
 * with no definition is looked at on its clock.
 */
import { browserTabsLiveStatement } from "@luke/database/models/agent-browser-tabs";
import { ownFailedRunsLiveStatement } from "@luke/database/models/automation-store";
import { macCommandsLiveStatement } from "@luke/database/models/mac-command-store";
import { messageStandingNow } from "@luke/database/models/message-reads";
import { repositoryPinsLiveStatement } from "@luke/database/models/repository-pin-store";
import { taskSectionsLiveStatements } from "@luke/database/models/task-section-store";
import {
  memberWorkspaceIds,
  workspacesLiveStatements,
} from "@luke/database/models/workspace-store";
import { type SyncTopic, TOPIC } from "@luke/database/sync/notification";
import {
  agentBrowserTabSync,
  agentPinSync,
  agentSectionEntrySync,
  attachmentSync,
  automationRunSync,
  automationSync,
  channelSync,
  codingAgentDelegationSync,
  codingAgentSync,
  conversationsSync,
  githubInstallationSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  inboxItemReadSync,
  inboxItemSync,
  inboxMessageSync,
  invitationSync,
  macCommandSync,
  memberSync,
  messagesSync,
  organizationSync,
  personalWorkspaceSync,
  planPageVersionSync,
  planRevisionSync,
  repositoryPinSync,
  taskPinSync,
  taskSectionEntrySync,
  taskSectionSync,
  taskSync,
  turnsSync,
  userSync,
} from "@luke/database/sync/tables";
import { ACCOUNT_INBOX_REPOSITORYLESS } from "@luke/features/account-inbox-wire";
import { macCommandKindsRead } from "@luke/features/mac-command-wire";
import { Effect, Option } from "effect";
import { workspaceInvitationsLiveStatement } from "../accounts/workspace-invitations.js";
import { workspaceMembersLiveStatements } from "../accounts/workspace-members.js";
import { cursorOfWire, cursorToWire } from "../agents/coder-host/transcript.js";
import { agentFollowedBy, transcriptLiveStatements } from "../agents/coder-host/transcript-live.js";
import {
  automationRunsLiveStatements,
  automationsLiveStatements,
  automationWorkspaceRunsLiveStatements,
} from "../automations/automation-live.js";
import {
  accountInboxLiveStatements,
  channelsLiveStatements,
  memberAgentInboxLiveStatements,
  taskInboxLiveStatements,
} from "../inbox/inbox-store.js";
import { taskHistoryLiveStatements } from "../tasks/task-history-live.js";
import { taskListLiveStatements } from "../tasks/task-list-live.js";
import { agentPagesLiveStatements, taskPagesLiveStatements } from "../tasks/task-pages-live.js";
import { taskRecordLiveStatements } from "../tasks/task-record-live.js";
import { defineLiveQuery, LIVE_MODE, liveQueryRegistry } from "./live-query.js";

/**
 * The reader's topic for each workspace it is a member of, looked up as a
 * read is asked for. Note that a membership made or ended moves the rows of
 * a read that takes these and notifies the reader's own topic, which such a
 * read takes too, so the read it wakes answers, and the next request looks
 * the memberships up again.
 */
function readerWorkspaceTopics(userId: string) {
  return Effect.map(memberWorkspaceIds(userId), (workspaceIds) =>
    workspaceIds.map((workspaceId): SyncTopic => [TOPIC.WORKSPACE, workspaceId]),
  );
}

/** The reader's own topic and its workspaces', which a read of what the account reaches across its workspaces is woken on. */
function readerAndWorkspaceTopics(userId: string) {
  return Effect.map(readerWorkspaceTopics(userId), (workspaces): readonly SyncTopic[] => [
    [TOPIC.ACCOUNT, userId],
    ...workspaces,
  ]);
}

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
 * The account's task list: the tasks it reaches and every agent of them and
 * with no task, each with the account's pin, the names it shows, and what
 * its status is read from, woken on the account's topic and on each of its
 * workspaces'. A task, an agent, a member's name, or a turn starting or
 * settling names the workspace; the account's pins, its memberships, and
 * what admits it to a repository name the account. Note that a message
 * wakes no task list, because a streamed step rewrites one every moment and
 * names only its conversation: an awaiting line or an operator's quiet reply
 * that moves with no turn starting or settling shows at the hold's end, as
 * does the rename of someone the list names who has left every workspace.
 */
export const tasksLive = defineLiveQuery({
  name: "tasks",
  params: ["userId"],
  reads: [
    taskSync,
    taskPinSync,
    codingAgentSync,
    agentPinSync,
    userSync,
    turnsSync,
    messagesSync,
    conversationsSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId }) => readerAndWorkspaceTopics(userId),
  statements: ({ userId }) => taskListLiveStatements(userId),
  mode: LIVE_MODE.SNAPSHOT,
});

/**
 * The account's workspaces and the GitHub installations connected to them,
 * woken on the account's topic and on each of its workspaces'. A
 * workspace's name and photo, its members, its installations, and the name
 * of the account it was made for name the workspace; the account's
 * memberships, its first workspace, and its own picture name the account.
 */
export const workspacesLive = defineLiveQuery({
  name: "workspaces",
  params: ["userId"],
  reads: [memberSync, organizationSync, personalWorkspaceSync, userSync, githubInstallationSync],
  topics: ({ userId }) => readerAndWorkspaceTopics(userId),
  statements: ({ userId }) => workspacesLiveStatements(userId),
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
  params: ["userId", "repositoryless"],
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
  // Note that an agent with no repository is carried only to a reader that asks (`ACCOUNT_INBOX_REPOSITORYLESS`), since a build before it fails its whole read on one null.
  statements: ({ userId, repositoryless }) =>
    Option.zipWith(
      accountInboxLiveStatements(userId, repositoryless === ACCOUNT_INBOX_REPOSITORYLESS.INCLUDE),
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

/**
 * A workspace's people, its members and who its work names but left, woken
 * on the workspace's topic by a membership, a member's account, and the work
 * that names a former member. Note that a plan revision wakes nothing here,
 * since it only decides who counts as a former member and the change that
 * moves that, its task deleted, wakes the workspace through the task; nor
 * does a former member renaming themselves, who is in no membership the
 * account's write looks up: both show at the hold's end.
 */
export const workspaceMembersLive = defineLiveQuery({
  name: "workspaceMembers",
  params: ["userId", "workspaceId"],
  reads: [
    memberSync,
    userSync,
    taskSync,
    codingAgentSync,
    automationSync,
    planRevisionSync,
    inboxItemSync,
  ],
  topics: ({ workspaceId }) => [[TOPIC.WORKSPACE, workspaceId]],
  statements: ({ userId, workspaceId }) => workspaceMembersLiveStatements(userId, workspaceId),
  mode: LIVE_MODE.SNAPSHOT,
});

/** A workspace's pending invitations, to an owner or an admin of it, woken on the workspace's topic by an invitation or a membership. */
export const workspaceInvitationsLive = defineLiveQuery({
  name: "workspaceInvitations",
  params: ["userId", "workspaceId"],
  reads: [invitationSync, memberSync],
  topics: ({ workspaceId }) => [[TOPIC.WORKSPACE, workspaceId]],
  statements: ({ userId, workspaceId }) =>
    Option.map(workspaceInvitationsLiveStatement(userId, workspaceId), (invitations) => ({
      invitations,
    })),
  mode: LIVE_MODE.SNAPSHOT,
});

/**
 * What an automation's reads read (`automation-live.ts`): the automations
 * and their runs, the agent each run started and what its status is read
 * from (`agent-standing.ts`), its newest turn and the newest line awaiting
 * one, and the membership that admits the reader to the workspace.
 */
const AUTOMATION_READS = [
  automationSync,
  automationRunSync,
  codingAgentSync,
  turnsSync,
  messagesSync,
  conversationsSync,
  memberSync,
] as const;

/**
 * A workspace's automations, each with its newest run and that run's
 * agent, woken on the workspace's topic by an automation made, changed, or
 * deleted, a run fired, started, or settled, the run's agent renamed or its
 * turn queued, started, or settled, and a membership of the workspace
 * moved, all of which name it. Note that a line awaiting the agent's next
 * turn is written on its conversation's topic alone (`messagesSync`),
 * because every streamed step rewrites a journal and waking the workspace
 * on each would re-run every workspace-keyed read for nothing: the mark
 * that line moves shows with the next turn, or at the hold's end.
 */
export const automationsLive = defineLiveQuery({
  name: "automations",
  params: ["userId", "workspaceId"],
  reads: AUTOMATION_READS,
  topics: ({ workspaceId }) => [[TOPIC.WORKSPACE, workspaceId]],
  statements: ({ userId, workspaceId }) => automationsLiveStatements(userId, workspaceId),
  mode: LIVE_MODE.SNAPSHOT,
});

/** The newest runs of a workspace's automations, each with its automation and its agent, woken as the automations are. */
export const automationWorkspaceRunsLive = defineLiveQuery({
  name: "automationWorkspaceRuns",
  params: ["userId", "workspaceId"],
  reads: AUTOMATION_READS,
  topics: ({ workspaceId }) => [[TOPIC.WORKSPACE, workspaceId]],
  statements: ({ userId, workspaceId }) =>
    automationWorkspaceRunsLiveStatements(userId, workspaceId),
  mode: LIVE_MODE.SNAPSHOT,
});

/**
 * One automation's newest runs, each with its agent, woken as the
 * automations are, on the topic of the workspace the automation stands in,
 * which its procedure reads it by before it binds the read
 * (`automationId`, `workspaceId`): a run names no topic of its automation.
 */
export const automationRunsLive = defineLiveQuery({
  name: "automationRuns",
  params: ["userId", "automationId", "workspaceId"],
  reads: AUTOMATION_READS,
  topics: ({ workspaceId }) => [[TOPIC.WORKSPACE, workspaceId]],
  statements: ({ userId, automationId }) => automationRunsLiveStatements(userId, automationId),
  mode: LIVE_MODE.SNAPSHOT,
});

/**
 * An open task's record: when its plan was last saved and each page's
 * newest version, woken by a save of the task and a page shown on it, both
 * of which name the task. Its calls and code answer no rows.
 */
export const taskRecordLive = defineLiveQuery({
  name: "taskRecord",
  params: ["userId", "taskId"],
  reads: [
    taskSync,
    planPageVersionSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, taskId }) => [
    [TOPIC.TASK, taskId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, taskId }) => taskRecordLiveStatements(userId, taskId),
  mode: LIVE_MODE.SNAPSHOT,
});

/** One task's pages, each at its newest version, woken by a page shown on the task. */
export const taskPagesLive = defineLiveQuery({
  name: "taskPages",
  params: ["userId", "taskId"],
  reads: [
    taskSync,
    planPageVersionSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, taskId }) => [
    [TOPIC.TASK, taskId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, taskId }) => taskPagesLiveStatements(userId, taskId),
  mode: LIVE_MODE.SNAPSHOT,
});

/** One coding agent's own pages on no task, woken by a page it shows and by the agent's own row, both of which name the agent. */
export const agentPagesLive = defineLiveQuery({
  name: "agentPages",
  params: ["userId", "agentId"],
  reads: [
    codingAgentSync,
    planPageVersionSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, agentId }) => [
    [TOPIC.AGENT, agentId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, agentId }) => agentPagesLiveStatements(userId, agentId),
  mode: LIVE_MODE.SNAPSHOT,
});

/**
 * One task's newest page of plan history, woken by a revision written or
 * moved on, and by the task and its agents, all of which name the task.
 * Note that an editor's own name, read beside each revision, wakes no
 * history, because an account's row names only it and its workspaces, and
 * waking every open history in a workspace on each of its writes is not
 * worth a rename: one shows at the hold's end.
 */
export const taskHistoryLive = defineLiveQuery({
  name: "taskHistory",
  params: ["userId", "taskId"],
  reads: [
    planRevisionSync,
    taskSync,
    codingAgentSync,
    userSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, taskId }) => [
    [TOPIC.TASK, taskId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, taskId }) => taskHistoryLiveStatements(userId, taskId),
  mode: LIVE_MODE.SNAPSHOT,
});

/**
 * One task's Browser tabs, every one of its agents', the agent's pointer on
 * each among them, woken by a tab opened, moved, pointed at, taken over, or
 * closed under the task, and by the agents on the task, all of which name
 * the task.
 */
export const taskBrowserTabsLive = defineLiveQuery({
  name: "taskBrowserTabs",
  params: ["userId", "taskId"],
  reads: [
    agentBrowserTabSync,
    codingAgentSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, taskId }) => [
    [TOPIC.TASK, taskId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, taskId }) =>
    Option.map(browserTabsLiveStatement(userId, { taskId }), (tabs) => ({ tabs })),
  mode: LIVE_MODE.SNAPSHOT,
});

/**
 * One coding agent's Browser tabs, on a task or on none, woken by the
 * agent's own row. Note that a tab names no agent's topic, its own row
 * holding only its agent's conversation, so a tab's move reaches a reader
 * on the watched look rather than by a wake.
 */
export const agentBrowserTabsLive = defineLiveQuery({
  name: "agentBrowserTabs",
  params: ["userId", "agentId"],
  reads: [
    agentBrowserTabSync,
    codingAgentSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, agentId }) => [
    [TOPIC.AGENT, agentId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, agentId }) =>
    Option.map(browserTabsLiveStatement(userId, { agentId }), (tabs) => ({ tabs })),
  mode: LIVE_MODE.SNAPSHOT,
});

/**
 * A coding agent's transcript, or one of its workers' (`conversationId`,
 * under the agent's own `parentConversationId`), started by `ownerId` and
 * read by `readerId` while it is a member of the agent's workspace
 * (`transcript-live.ts`). It is woken by a write to the transcript's
 * messages, turns, or conversation, to a worker's conversation or
 * delegation under the agent's, to the agent itself, and to what admits the
 * reader to its workspace or repository.
 *
 * Its newest messages (`window`, `windowParts`) are followed by cursor:
 * where the reader holds them, the highest sequence it has and the journal
 * revision it read at, as a page past a cursor reads them
 * (`listMessagesPast`). Every write to a message locks its conversation and
 * takes its sequence or revision from the conversation's counters, so they
 * move in commit order, and a reader past a cursor read before its rows
 * misses none. A rewind moves the conversation's rewound revision, and a
 * reader whose cursor is older is answered the window whole.
 *
 * Note that a line's sender's name, and a sending agent's task, are read
 * beside the line rather than written on it, so a change to either wakes no
 * transcript and moves no line past the cursor: a cursor reader sees it the
 * next time it reads the window whole, and a reader that names no cursor at
 * the hold's end, within 25 s. A turn settling moves its journal's revision
 * (`writer.ts`'s `reviseJournal`), so what the settled turn says of it is
 * answered past the cursor.
 */
export const agentTranscriptLive = defineLiveQuery({
  name: "agentTranscript",
  params: ["ownerId", "conversationId", "parentConversationId", "agentId", "readerId"],
  reads: [
    messagesSync,
    conversationsSync,
    turnsSync,
    codingAgentDelegationSync,
    userSync,
    codingAgentSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ conversationId, parentConversationId, agentId, readerId }) => {
    const parent: readonly SyncTopic[] =
      parentConversationId === conversationId ? [] : [[TOPIC.CONVERSATION, parentConversationId]];
    return [
      [TOPIC.CONVERSATION, conversationId],
      ...parent,
      [TOPIC.AGENT, agentId],
      [TOPIC.ACCOUNT, readerId],
    ];
  },
  statements: ({ ownerId, conversationId, parentConversationId, readerId }, past) =>
    transcriptLiveStatements(
      { userId: ownerId, conversationId },
      parentConversationId,
      agentFollowedBy(ownerId, parentConversationId, readerId),
      past === undefined ? undefined : cursorOfWire(past),
    ),
  mode: LIVE_MODE.CURSOR,
  cursor: {
    parts: ["window", "windowParts"],
    standing: ({ ownerId, conversationId }) =>
      Effect.map(messageStandingNow(ownerId, conversationId), ({ cursor, rewound }) => ({
        next: cursorToWire(cursor),
        stands: (asked) =>
          Option.match(rewound, {
            onNone: () => true,
            onSome: (at) => cursorOfWire(asked).revision >= at,
          }),
      })),
  },
});

export const LIVE_QUERIES = liveQueryRegistry([
  sidebarLive,
  tasksLive,
  workspacesLive,
  macCommandsLive,
  inboxLive,
  taskInboxLive,
  agentInboxLive,
  channelsLive,
  workspaceMembersLive,
  workspaceInvitationsLive,
  automationsLive,
  automationWorkspaceRunsLive,
  automationRunsLive,
  taskRecordLive,
  taskPagesLive,
  agentPagesLive,
  taskHistoryLive,
  taskBrowserTabsLive,
  agentBrowserTabsLive,
  agentTranscriptLive,
]);

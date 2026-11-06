/**
 * live-queries.ts -- every live read Sync wakes, by its name, as one registry the registry test reads.
 *
 * A read is moved onto Sync by defining it (`defineLiveQuery`), adding
 * it here, and answering its procedure from the definition
 * (`liveQueryParts`). A read declared once (`@repo/features/live-read`) is
 * bound instead (`../live/live-read-binding.ts`, one file under
 * `../live/reads/` each), and its binding stands here beside the
 * definitions. Each view's own change defines its read, and a read with no
 * definition is looked at on its clock.
 */
import { browserTabsLiveStatement } from "@repo/database/models/agent-browser-tabs";
import { ownFailedRunsLiveStatement } from "@repo/database/models/automation-store";
import { macCommandsLiveStatement } from "@repo/database/models/mac-command-store";
import { messageStandingNow } from "@repo/database/models/message-reads";
import { pullRequestChaptersLiveStatement } from "@repo/database/models/pull-request-chapters-store";
import { agentTable } from "@repo/database/schemas/agent";
import { inboxItem } from "@repo/database/schemas/inbox";
import { task } from "@repo/database/schemas/task";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import {
  agentBrowserTabSync,
  agentDelegationSync,
  agentPinSync,
  agentQueueSync,
  agentReadSync,
  agentSync,
  attachmentSync,
  automationRunSync,
  automationSync,
  conversationsSync,
  descriptionCommentSync,
  descriptionCommentThreadSync,
  descriptionRevisionSync,
  deviceAgentLineSync,
  deviceSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  inboxItemReadSync,
  inboxItemSync,
  inboxMessageSync,
  integrationConnectionSync,
  macCommandSync,
  memberSync,
  messagesSync,
  pullRequestChaptersSync,
  taskBlockSync,
  taskPageVersionSync,
  taskPinSync,
  taskReadSync,
  taskSync,
  turnsSync,
  userSync,
} from "@repo/database/sync/tables";
import { ACCOUNT_INBOX_REPOSITORYLESS } from "@repo/features/account-inbox-wire";
import { LIVE_MODE } from "@repo/features/live-read";
import { LIVE_READ } from "@repo/features/live-wire";
import { macCommandKindsRead } from "@repo/features/mac-command-wire";
import { Effect, Option } from "effect";
import { agentOriginLiveStatements } from "../agents/agent-origin-live.js";
import { cursorOfWire, cursorToWire } from "../agents/coder-host/transcript.js";
import { agentFollowedBy, transcriptLiveStatements } from "../agents/coder-host/transcript-live.js";
import {
  automationRunsLiveStatements,
  automationsLiveStatements,
  automationWorkspaceRunsLiveStatements,
} from "../automations/automation-live.js";
import {
  accountInboxLiveStatements,
  accountItemsDeltaStatements,
  accountItemsLiveStatements,
  memberAgentInboxLiveStatements,
  taskInboxLiveStatements,
} from "../inbox/inbox-store.js";
import { integrationStatusesLiveStatement } from "../integrations/integration-store.js";
import type { AnyBoundRead } from "../live/live-read-binding.js";
import { accountPreferencesRead } from "../live/reads/account-preferences.js";
import { hostsRead } from "../live/reads/hosts.js";
import { installedSkillsRead } from "../live/reads/installed-skills.js";
import { sidebarRead } from "../live/reads/sidebar.js";
import { workspaceIntegrationsRead } from "../live/reads/workspace-integrations.js";
import { workspaceInvitationsRead } from "../live/reads/workspace-invitations.js";
import { workspaceMembersRead } from "../live/reads/workspace-members.js";
import { workspaceMemoriesRead } from "../live/reads/workspace-memories.js";
import { workspacesRead } from "../live/reads/workspaces.js";
import { taskCommentsLiveStatements } from "../tasks/description-comments-live.js";
import { taskHistoryLiveStatements } from "../tasks/task-history-live.js";
import { taskListDeltaStatements, taskListLiveStatements } from "../tasks/task-list-live.js";
import { agentPagesLiveStatements, taskPagesLiveStatements } from "../tasks/task-pages-live.js";
import { taskRecordLiveStatements } from "../tasks/task-record-live.js";
import { defineLiveQuery, liveQueryRegistry } from "./live-query.js";
import { readerAndWorkspaceTopics } from "./reader-topics.js";

/**
 * The account's task list: the tasks it reaches and every agent of them and
 * with no task, each with the account's pin, the names it shows, and what
 * its status is read from, woken on the account's topic and on each of its
 * workspaces'. A task, a block between two tasks, an agent, a member's name, a Mac's name, or a turn
 * starting or settling names the workspace; the account's pins and read
 * marks, its memberships, and what admits it to a repository name the account. Note
 * that a message wakes no task list, because a streamed step rewrites one
 * every moment and names only its conversation: an awaiting line that moves
 * with no turn starting or settling shows
 * at the hold's end, as do the rename of someone the list names who has left
 * every workspace and a Mac's last beat, which wakes nothing.
 *
 * A reader past a sync id is answered what moved alone
 * (`taskListDeltaStatements`); a message or a conversation names only its
 * conversation, so its rows are taken whatever they name, and narrow the
 * agents to the one of that conversation the reader reaches. Its plans and
 * its agents are each part's own rows, and a write to its account's
 * membership or GitHub access answers it whole.
 */
export const tasksLive = defineLiveQuery({
  name: "tasks",
  params: ["userId"],
  reads: [
    taskSync,
    taskBlockSync,
    taskPinSync,
    taskReadSync,
    agentSync,
    agentPinSync,
    agentReadSync,
    automationSync,
    automationRunSync,
    userSync,
    turnsSync,
    messagesSync,
    conversationsSync,
    deviceSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId }) => readerAndWorkspaceTopics(userId),
  statements: ({ userId }) => taskListLiveStatements(userId),
  mode: LIVE_MODE.SNAPSHOT,
  delta: {
    whole: [memberSync, githubPersonalTokenSync, githubRepositoryReadSync],
    anyTopic: [messagesSync, conversationsSync],
    own: {
      plans: { table: taskSync, key: task.id },
      agents: { table: agentSync, key: agentTable.id },
    },
    statements: ({ userId }, moved) => taskListDeltaStatements(userId, moved),
  },
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

/**
 * Every integration row the account holds, where each stands as stored,
 * woken on the account's integrations topic alone, which a sign-in begun,
 * completed, or ended, a label, an expiry, and a disconnect each name. Note
 * that a sign-in counts as under way while it began at `issuedSince` or
 * later, which its procedure binds from the clock, since a live statement
 * reads none; one that lapses with no write turns not pending only as the
 * read is looked at again. Which providers the account is offered, and
 * which take several accounts, come from the deployment and the account's
 * email, which no statement reads, so the procedure answers them beside the
 * rows on every poll.
 */
export const integrationStatusesLive = defineLiveQuery({
  name: LIVE_READ.INTEGRATIONS,
  params: ["userId", "issuedSince"],
  reads: [integrationConnectionSync],
  topics: ({ userId }) => [[TOPIC.ACCOUNT_INTEGRATIONS, userId]],
  statements: ({ userId, issuedSince }) =>
    Option.map(
      integrationStatusesLiveStatement(userId, instantParam(issuedSince)),
      (connections) => ({
        connections,
      }),
    ),
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
 * wakes no account's inbox, because a description's save rewrites its task every
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
    agentSync,
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
  agentSync,
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

/** An instant a read's param binds as epoch milliseconds, as its procedure wrote it; the epoch where it names none. */
function instantParam(param: string): Date {
  const millis = Number(param);
  return new Date(Number.isSafeInteger(millis) && millis > 0 ? millis : 0);
}

/**
 * Every inbox item the account reaches, where each stands and those
 * changed since the reader's instant whole, woken on the account's topic,
 * which an item written in any of its workspaces names for every member
 * (`inboxItemSync`), as do its own read marks and what admits it to a
 * workspace or a repository. Note that a message withdrawn names only its
 * item's task and agent, and a task or an agent written itself no account,
 * as for the account's inbox: either shows at the hold's end. The settled
 * items it carries are those changed since `settledSince`, which its
 * procedure binds from the clock, since a live statement reads none, and
 * those the reader set a reminder on and has not read since.
 *
 * A reader past a sync id is answered the items that moved alone, each
 * whole (`accountItemsDeltaStatements`), taking the moved rows its
 * workspaces' topics reach, since a task, an agent, or a member names
 * those rather than the account; a message or a file names only its item's
 * task and agent, so its rows are taken whatever they name. An item that
 * leaves by the clock, past thirty days settled, logs nothing, and the
 * reader drops it itself.
 */
export const inboxItemsLive = defineLiveQuery({
  name: LIVE_READ.INBOX_ITEMS,
  params: ["userId", "since", "settledSince"],
  reads: SCOPE_INBOX_READS,
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId, since, settledSince }) =>
    accountItemsLiveStatements(userId, instantParam(since), instantParam(settledSince)),
  mode: LIVE_MODE.SNAPSHOT,
  delta: {
    whole: ITEM_GATES,
    anyTopic: [inboxMessageSync, attachmentSync],
    reach: ({ userId }) => readerAndWorkspaceTopics(userId),
    own: {
      stamps: { table: inboxItemSync, key: inboxItem.id },
      items: { table: inboxItemSync, key: inboxItem.id },
    },
    statements: ({ userId, settledSince }, moved) =>
      accountItemsDeltaStatements(userId, instantParam(settledSince), moved),
  },
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
 * What an automation's reads read (`automation-live.ts`): the automations
 * and their runs, the agent each run started and what its status is read
 * from (`agent-standing.ts`), its newest turn and the newest line awaiting
 * one, and the membership that admits the reader to the workspace.
 */
const AUTOMATION_READS = [
  automationSync,
  automationRunSync,
  agentSync,
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
 * An open task's record: when its description was last saved and each page's
 * newest version, woken by a save of the task and a page shown on it, both
 * of which name the task. Its calls and code answer no rows.
 */
export const taskRecordLive = defineLiveQuery({
  name: "taskRecord",
  params: ["userId", "taskId"],
  reads: [
    taskSync,
    taskPageVersionSync,
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
    taskPageVersionSync,
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
    agentSync,
    taskSync,
    taskPageVersionSync,
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
 * The run of an automation that started one coding agent, with the name of
 * the member who asked for it where one did, woken by the agent's own row,
 * which nothing moves the run on once the agent is made, and by what admits
 * the reader to it. Note that a runner's own name wakes no origin, as the
 * history's editor's wakes no history: a rename shows at the hold's end.
 */
export const agentOriginLive = defineLiveQuery({
  name: "agentOrigin",
  params: ["userId", "agentId"],
  reads: [
    agentSync,
    userSync,
    taskSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, agentId }) => [
    [TOPIC.AGENT, agentId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, agentId }) => agentOriginLiveStatements(userId, agentId),
  mode: LIVE_MODE.SNAPSHOT,
});

/**
 * One task's newest page of description history, woken by a revision written or
 * moved on, and by the task and its agents, all of which name the task.
 * Note that an editor's own name, read beside each revision, wakes no
 * history, because an account's row names only it and its workspaces, and
 * waking every open history in a workspace on each of its writes is not
 * worth a rename: one shows at the hold's end.
 */
export const taskHistoryLive = defineLiveQuery({
  name: LIVE_READ.HISTORY,
  params: ["userId", "taskId"],
  reads: [
    descriptionRevisionSync,
    taskSync,
    agentSync,
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

/** The page a comments read's param names where it names none: the description's own threads (`taskCommentsLive`). */
export const DESCRIPTION_THREADS = "";

/**
 * One subject of a task's comments, its description's own threads where it names
 * no page (`DESCRIPTION_THREADS`) or one page's on every version, woken by a
 * thread or an entry written, a file kept on a comment, and the task
 * itself, all of which name the task. Note that a writer's own name, read
 * beside each entry, wakes no comments, as the history's editor's wakes no
 * history: one shows at the hold's end.
 */
export const taskCommentsLive = defineLiveQuery({
  name: LIVE_READ.DESCRIPTION_COMMENTS,
  params: ["userId", "taskId", "pageId"],
  reads: [
    descriptionCommentThreadSync,
    descriptionCommentSync,
    attachmentSync,
    userSync,
    taskSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, taskId }) => [
    [TOPIC.TASK, taskId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, taskId, pageId }) =>
    taskCommentsLiveStatements(
      userId,
      pageId === DESCRIPTION_THREADS ? { taskId } : { taskId, pageId },
    ),
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
    agentSync,
    taskSync,
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
 * One coding agent's Browser tabs, on a task or on none, its task read
 * too where it is on one, woken by the agent's own row. Note that a tab names no agent's topic, its own row
 * holding only its agent's conversation, so a tab's move reaches a reader
 * on the watched look rather than by a wake.
 */
export const agentBrowserTabsLive = defineLiveQuery({
  name: "agentBrowserTabs",
  params: ["userId", "agentId"],
  reads: [
    agentBrowserTabSync,
    agentSync,
    taskSync,
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

/** A pull request's number a read's param binds, as its procedure wrote it; zero, which numbers no pull request, where it names none. */
function pullRequestNumberParam(param: string): number {
  const number = Number(param);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

/**
 * One coding agent's pull request's newest chapters, by the number the
 * reader names, as the agent's read answers them, woken by a claim, finish,
 * or failure in the agent's workspace (`workspaceId`, which the procedure
 * binds from the agent's own row), all of which name its chapters topic, by
 * the agent's own row, and by what admits the reader to its workspace or
 * repository. The agent's task is read for the reader's reach of it
 * (`agentVisibleTo`) and wakes nothing, as a task's reach moves with what
 * admits the reader. Note that whether the reader can generate them comes
 * from their own keys, which no statement reads, so the procedure answers it
 * beside the rows on every poll, and a key saved while the read is held
 * shows on the next.
 */
export const pullRequestChaptersLive = defineLiveQuery({
  name: LIVE_READ.PULL_REQUEST_CHAPTERS,
  params: ["userId", "agentId", "number", "workspaceId"],
  reads: [
    pullRequestChaptersSync,
    agentSync,
    taskSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, agentId, workspaceId }) => [
    [TOPIC.WORKSPACE_CHAPTERS, workspaceId],
    [TOPIC.AGENT, agentId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, agentId, number }) =>
    Option.map(
      pullRequestChaptersLiveStatement(userId, agentId, pullRequestNumberParam(number)),
      (chapters) => ({ chapters }),
    ),
  mode: LIVE_MODE.SNAPSHOT,
});

/**
 * A coding agent's transcript, or one of its workers' (`conversationId`,
 * under the agent's own `parentConversationId`), started by `ownerId` and
 * read by `readerId` while it is a member of the agent's workspace
 * (`transcript-live.ts`). It is woken by a write to the transcript's
 * messages, turns, or conversation, to a worker's conversation or
 * delegation under the agent's, to the agent itself, its queue, or a line
 * queued for its device, and to what admits the
 * reader to its workspace or repository; the agent's task is read for the
 * reader's reach of it (`agentVisibleTo`) and wakes nothing, as a task's
 * reach moves with what admits the reader.
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
    agentDelegationSync,
    userSync,
    agentSync,
    taskSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
    agentQueueSync,
    deviceAgentLineSync,
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

/** Every read declared once and bound (`../live/live-read-binding.ts`), each a live read Sync wakes beside the definitions. */
export const BOUND_READS: readonly AnyBoundRead[] = [
  sidebarRead,

  workspaceIntegrationsRead,

  workspaceInvitationsRead,

  workspaceMembersRead,

  workspacesRead,

  installedSkillsRead,

  hostsRead,
  accountPreferencesRead,
  workspaceMemoriesRead,
];

export const LIVE_QUERIES = liveQueryRegistry([
  tasksLive,
  macCommandsLive,
  integrationStatusesLive,
  inboxLive,
  inboxItemsLive,
  taskInboxLive,
  agentInboxLive,
  automationsLive,
  automationWorkspaceRunsLive,
  automationRunsLive,
  taskRecordLive,
  taskPagesLive,
  agentPagesLive,
  agentOriginLive,
  taskHistoryLive,
  taskCommentsLive,
  taskBrowserTabsLive,
  agentBrowserTabsLive,
  pullRequestChaptersLive,
  agentTranscriptLive,
  ...BOUND_READS,
]);

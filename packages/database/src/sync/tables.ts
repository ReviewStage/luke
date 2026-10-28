/**
 * tables.ts -- every table Luke Sync captures, as one list the drift check and the migration writer read.
 *
 * A table is synced by declaring it here (`defineSyncTable`) and writing
 * its capture into a migration (`pnpm --filter @luke/database sync:render`);
 * the drift check (`__tests__/capture.test.ts`) then fails until the migrated
 * database carries exactly what these declarations render. Each table is
 * declared once, for every view that reads it: a view's live read names
 * these declarations in its `reads`, so a table one view synced first is
 * the same capture the next view reads.
 *
 * Beside the tables a view draws from stand the ones every read of a task
 * or an agent is gated on (`workspace-store.ts`): the account's membership
 * of the workspace, and, for one reached on a member's own GitHub token,
 * that member's token and what GitHub last answered it of a repository. A
 * write to them notifies the account it moves, so a read the account loses
 * is woken and answers without it.
 */

import { agentDelegationTable, agentTable } from "../schemas/agent.js";
import { agentBrowserTab } from "../schemas/agent-browser-tab.js";
import { agentPin } from "../schemas/agent-pin.js";
import { attachment } from "../schemas/attachment.js";
import { invitation, member, organization, user } from "../schemas/auth.js";
import { automation, automationRun } from "../schemas/automation.js";
import { channel } from "../schemas/channel.js";
import { deviceAgentLine, deviceAgentRequest } from "../schemas/device-agent.js";
import { githubInstallation } from "../schemas/github-installation.js";
import { githubPersonalToken } from "../schemas/github-personal-token.js";
import { githubRepositoryRead } from "../schemas/github-repository-read.js";
import { inboxItem } from "../schemas/inbox.js";
import { inboxItemRead } from "../schemas/inbox-item-read.js";
import { inboxMessage } from "../schemas/inbox-message.js";
import { macCommand } from "../schemas/mac-command.js";
import { personalWorkspace } from "../schemas/personal-workspace.js";
import { planComment, planCommentThread } from "../schemas/plan-comment.js";
import { planPageVersion } from "../schemas/plan-page.js";
import { planRevision } from "../schemas/plan-revision.js";
import { repositoryPin } from "../schemas/repository-pin.js";
import { runnerLine } from "../schemas/runner-line.js";
import { asks, conversations, messages, turns } from "../schemas/storage.js";
import { task } from "../schemas/task.js";
import { taskPin } from "../schemas/task-pin.js";
import { agentSectionEntry, taskSection, taskSectionEntry } from "../schemas/task-section.js";
import { TOPIC } from "./notification.js";
import { defineSyncTable, type SyncTable } from "./sync-table.js";

/**
 * A task, on its own topic and its workspace's. Note that the plan's text
 * and the agents' journal of saves are ignored, because every save rewrites
 * both and no view reads them live: a save moves `updated_at` beside them,
 * which the task list and the task's record read, so a save still notifies.
 */
export const taskSync = defineSyncTable(task, {
  topics: [
    { kind: TOPIC.TASK, column: task.id },
    { kind: TOPIC.WORKSPACE, column: task.organizationId },
  ],
  ignore: [task.document, task.agentEdits],
});

/**
 * A coding agent, on its own topic, its task's, and its workspace's. Note
 * that its last step is ignored, because every model step rewrites it, and
 * so is when its pull request was last read, because every read of the pull
 * request rewrites that; no view reads either live.
 */
export const agentSync = defineSyncTable(agentTable, {
  topics: [
    { kind: TOPIC.AGENT, column: agentTable.id },
    { kind: TOPIC.TASK, column: agentTable.taskId },
    { kind: TOPIC.WORKSPACE, column: agentTable.organizationId },
  ],
  ignore: [agentTable.lastStep, agentTable.publishedRead],
});

/** An account's membership of a workspace, on the workspace's topic and the account's. */
export const memberSync = defineSyncTable(member, {
  topics: [
    { kind: TOPIC.WORKSPACE, column: member.organizationId },
    { kind: TOPIC.ACCOUNT, column: member.userId },
  ],
});

/**
 * An account, on its own topic and, through its memberships, every
 * workspace it is in, so a teammate's new name or picture reaches the
 * workspace's reads. Note that when it last moved and how it last signed in
 * are ignored, because every sign-in rewrites both and no view reads them.
 */
export const userSync = defineSyncTable(user, {
  topics: [
    { kind: TOPIC.ACCOUNT, column: user.id },
    {
      through: member,
      key: member.userId,
      by: user.id,
      topics: [{ kind: TOPIC.WORKSPACE, column: member.organizationId }],
    },
  ],
  ignore: [user.updatedAt, user.lastLoginMethod],
});

/** An invitation to a workspace, pending or settled, on the workspace's topic. */
export const invitationSync = defineSyncTable(invitation, {
  topics: [{ kind: TOPIC.WORKSPACE, column: invitation.organizationId }],
});

/** A workspace, on its own topic, so its name, slug, and photo reach every member. */
export const organizationSync = defineSyncTable(organization, {
  topics: [{ kind: TOPIC.WORKSPACE, column: organization.id }],
});

/** The workspace made for an account first, on the workspace's topic and the account's. */
export const personalWorkspaceSync = defineSyncTable(personalWorkspace, {
  topics: [
    { kind: TOPIC.WORKSPACE, column: personalWorkspace.organizationId },
    { kind: TOPIC.ACCOUNT, column: personalWorkspace.userId },
  ],
});

/** A GitHub App installation connected to a workspace, on the workspace's topic. */
export const githubInstallationSync = defineSyncTable(githubInstallation, {
  topics: [{ kind: TOPIC.WORKSPACE, column: githubInstallation.organizationId }],
});

/** A member's own GitHub token, on the member's topic. */
export const githubPersonalTokenSync = defineSyncTable(githubPersonalToken, {
  topics: [{ kind: TOPIC.ACCOUNT, column: githubPersonalToken.userId }],
});

/**
 * What GitHub last answered a member's token of a repository, on the
 * member's topic. Note that when it was asked is ignored, because the
 * hourly ask rewrites it (`github/repository-reads.ts`) while the answer
 * mostly stands, and no read gates on it.
 */
export const githubRepositoryReadSync = defineSyncTable(githubRepositoryRead, {
  topics: [{ kind: TOPIC.ACCOUNT, column: githubRepositoryRead.userId }],
  ignore: [githubRepositoryRead.checkedAt],
});

/** One of an account's sidebar sections, on the account's topic. */
export const taskSectionSync = defineSyncTable(taskSection, {
  topics: [{ kind: TOPIC.ACCOUNT, column: taskSection.userId }],
});

/** A task an account keeps in one of its sections, on the account's topic. */
export const taskSectionEntrySync = defineSyncTable(taskSectionEntry, {
  topics: [{ kind: TOPIC.ACCOUNT, column: taskSectionEntry.userId }],
});

/** An agent with no task an account keeps in one of its sections, on the account's topic. */
export const agentSectionEntrySync = defineSyncTable(agentSectionEntry, {
  topics: [{ kind: TOPIC.ACCOUNT, column: agentSectionEntry.userId }],
});

/** A repository an account pinned to its sidebar, on the account's topic. */
export const repositoryPinSync = defineSyncTable(repositoryPin, {
  topics: [{ kind: TOPIC.ACCOUNT, column: repositoryPin.userId }],
});

/** A task an account pinned, on the account's topic. */
export const taskPinSync = defineSyncTable(taskPin, {
  topics: [{ kind: TOPIC.ACCOUNT, column: taskPin.userId }],
});

/** An agent with no task an account pinned, on the account's topic. */
export const agentPinSync = defineSyncTable(agentPin, {
  topics: [{ kind: TOPIC.ACCOUNT, column: agentPin.userId }],
});

/**
 * A command an agent queued for the account's Mac, on the account's topic,
 * which the Mac's read of the commands it may claim is woken on. Note that
 * the account's listener row (`mac_command_listener`), which every such read
 * rewrites, is not captured: no read waits on it.
 */
export const macCommandSync = defineSyncTable(macCommand, {
  topics: [{ kind: TOPIC.ACCOUNT, column: macCommand.userId }],
});

/**
 * A line queued for a cloud agent's runner, on the agent's topic, which the
 * runner's held read waits on (`@luke/service`'s `runner-lines-app.ts`).
 * Note that its acceptance is ignored, because the runner's read waits on
 * new lines alone, and every message the runner takes stamps one.
 */
const runnerLineSync = defineSyncTable(runnerLine, {
  topics: [{ kind: TOPIC.AGENT, column: runnerLine.agentId }],
  ignore: [runnerLine.acceptedAt],
});

/**
 * A line queued for a local agent's runner, on its account's topic, which
 * the account's Macs' held read of their lines and a wait for a runner's
 * exit are woken on. Note that what the line says is ignored, because it is
 * written once as the line is queued and never changed, and an update
 * comparing it would weigh a files line's every file at its claim and its
 * settle.
 */
const deviceAgentLineSync = defineSyncTable(deviceAgentLine, {
  topics: [{ kind: TOPIC.ACCOUNT, column: deviceAgentLine.userId }],
  ignore: [deviceAgentLine.payload],
});

/**
 * A request of a local agent's tool to its Mac, on its account's topic,
 * which the Macs' held read of their requests and the tool's wait for the
 * answer are woken on. Note that the file an answer carries is ignored,
 * because an update comparing it would weigh the file, and the answer moves
 * `settled_at` beside it, so it still notifies.
 */
const deviceAgentRequestSync = defineSyncTable(deviceAgentRequest, {
  topics: [{ kind: TOPIC.ACCOUNT, column: deviceAgentRequest.userId }],
  ignore: [deviceAgentRequest.bytes],
});

/** A comment thread on a task's plan, on the task's topic. */
export const planCommentThreadSync = defineSyncTable(planCommentThread, {
  topics: [{ kind: TOPIC.TASK, column: planCommentThread.taskId }],
});

/**
 * An entry of a plan's comment thread, on the task's topic. Note that an
 * entry's write moves its thread's revision in the same transaction, so the
 * two notify one topic under one txid, which Postgres sends once.
 */
export const planCommentSync = defineSyncTable(planComment, {
  topics: [{ kind: TOPIC.TASK, column: planComment.taskId }],
});

/**
 * An inbox item, on its task's topic, its agent's, and its workspace's, and,
 * through the workspace's memberships, on the account of every member of
 * it. Note that the accounts are named here, because the account's inbox and
 * a workspace's channels are read per account, and a read's topics come
 * from its params alone: waking them on the workspace's topic instead would
 * re-run them on every plan save in it.
 */
export const inboxItemSync = defineSyncTable(inboxItem, {
  topics: [
    { kind: TOPIC.TASK, column: inboxItem.taskId },
    { kind: TOPIC.AGENT, column: inboxItem.agentId },
    { kind: TOPIC.WORKSPACE, column: inboxItem.organizationId },
    {
      through: member,
      key: member.organizationId,
      by: inboxItem.organizationId,
      topics: [{ kind: TOPIC.ACCOUNT, column: member.userId }],
    },
  ],
});

/** A message on an inbox item's thread, on its item's task and agent, which it names only by the item. */
export const inboxMessageSync = defineSyncTable(inboxMessage, {
  topics: [
    {
      through: inboxItem,
      key: inboxItem.id,
      by: inboxMessage.itemId,
      topics: [
        { kind: TOPIC.TASK, column: inboxItem.taskId },
        { kind: TOPIC.AGENT, column: inboxItem.agentId },
      ],
    },
  ],
});

/** Where a member read an inbox item through, or marked it unread, on the member's topic and on the item's task and agent. */
export const inboxItemReadSync = defineSyncTable(inboxItemRead, {
  topics: [
    { kind: TOPIC.ACCOUNT, column: inboxItemRead.userId },
    {
      through: inboxItem,
      key: inboxItem.id,
      by: inboxItemRead.itemId,
      topics: [
        { kind: TOPIC.TASK, column: inboxItem.taskId },
        { kind: TOPIC.AGENT, column: inboxItem.agentId },
      ],
    },
  ],
});

/**
 * A file or a picture, on its task's topic and, for an inbox item's, the
 * item's agent's. Note that its bytes are ignored, because only what the
 * row says of them is read live, and an update comparing them would weigh
 * every row's bytes.
 */
export const attachmentSync = defineSyncTable(attachment, {
  topics: [
    { kind: TOPIC.TASK, column: attachment.taskId },
    {
      through: inboxItem,
      key: inboxItem.id,
      by: attachment.inboxItemId,
      topics: [{ kind: TOPIC.AGENT, column: inboxItem.agentId }],
    },
  ],
  ignore: [attachment.bytes],
});

/** A workspace's channel, on the workspace's topic and, as an inbox item names them, the account of every member of it. */
export const channelSync = defineSyncTable(channel, {
  topics: [
    { kind: TOPIC.WORKSPACE, column: channel.organizationId },
    {
      through: member,
      key: member.organizationId,
      by: channel.organizationId,
      topics: [{ kind: TOPIC.ACCOUNT, column: member.userId }],
    },
  ],
});

/** An automation, on its workspace's topic and its creator's. */
export const automationSync = defineSyncTable(automation, {
  topics: [
    { kind: TOPIC.WORKSPACE, column: automation.organizationId },
    { kind: TOPIC.ACCOUNT, column: automation.userId },
  ],
});

/** One run of an automation, on its account's topic and, through the automation, its workspace's. */
export const automationRunSync = defineSyncTable(automationRun, {
  topics: [
    { kind: TOPIC.ACCOUNT, column: automationRun.userId },
    {
      through: automation,
      key: automation.id,
      by: automationRun.automationId,
      topics: [{ kind: TOPIC.WORKSPACE, column: automation.organizationId }],
    },
  ],
});

/**
 * A revision of a task's plan, on the task's topic. Note that its text is
 * ignored, because every save folded into a revision rewrites it, and the
 * same save moves `at` and `changes` beside it, which the history reads, so
 * a save still notifies.
 */
export const planRevisionSync = defineSyncTable(planRevision, {
  topics: [{ kind: TOPIC.TASK, column: planRevision.taskId }],
  ignore: [planRevision.document],
});

/**
 * A version of a page an agent showed, on its task's topic, or, for a page
 * on no task, its agent's. A version is written once and never changed, so
 * no column of it is hot.
 */
export const planPageVersionSync = defineSyncTable(planPageVersion, {
  topics: [
    { kind: TOPIC.TASK, column: planPageVersion.taskId },
    { kind: TOPIC.AGENT, column: planPageVersion.agentId },
  ],
});

/**
 * A tab open in an agent's browser, on its task's topic. Every column is
 * watched, the agent's pointer among them, because the task's Browser tab
 * draws the pointer moving; the agent writes it once before each click,
 * keystroke, or wheel.
 */
export const agentBrowserTabSync = defineSyncTable(agentBrowserTab, {
  topics: [{ kind: TOPIC.TASK, column: agentBrowserTab.taskId }],
});

/**
 * A transcript's message, on its conversation's topic alone. Note that no
 * column is ignored and no wider topic is taken, because a journal is
 * rewritten in place on every streamed step: each write transaction
 * notifies the one topic once, its rows' notifications folding into one,
 * and only the transcript's own readers wake on it.
 */
export const messagesSync = defineSyncTable(messages, {
  topics: [{ kind: TOPIC.CONVERSATION, column: messages.conversationId }],
});

/**
 * A conversation, on its own topic and its parent's, so a worker's title
 * landing, or a worker opened or cleared, reaches the agent's transcript,
 * which lists its workers. Note that the next message sequence, the native
 * harness's projection and its event count, the last activity, and the
 * dispatch claim are ignored, because each is rewritten by every message or
 * hand-over and no view reads them; a message written beside them notifies
 * the conversation's topic itself.
 */
export const conversationsSync = defineSyncTable(conversations, {
  topics: [
    { kind: TOPIC.CONVERSATION, column: conversations.id },
    { kind: TOPIC.CONVERSATION, column: conversations.parentConversationId },
  ],
  ignore: [
    conversations.nextMessageSeq,
    conversations.nativeSequence,
    conversations.nativeProjection,
    conversations.lastActivityAt,
    conversations.dispatchClaim,
    conversations.dispatchClaimedAt,
    conversations.dispatchLine,
  ],
});

/**
 * A turn, on its conversation's topic and, through the coding agent whose
 * conversation it runs in, the agent's own, its task's, and its
 * workspace's, so a turn starting, settling, or stopped reaches every view
 * of the agent's status. Note that the count of plan notes it has taken is
 * ignored, because every note a turn takes rewrites it and no view reads it,
 * so a turn notifies about once as it starts and once as it settles.
 */
export const turnsSync = defineSyncTable(turns, {
  topics: [
    { kind: TOPIC.CONVERSATION, column: turns.conversationId },
    {
      through: agentTable,
      key: agentTable.conversationId,
      by: turns.conversationId,
      topics: [
        { kind: TOPIC.AGENT, column: agentTable.id },
        { kind: TOPIC.TASK, column: agentTable.taskId },
        { kind: TOPIC.WORKSPACE, column: agentTable.organizationId },
      ],
    },
  ],
  ignore: [turns.planNotesTaken],
});

/**
 * An ask, on its conversation's topic. Note that its dispatch claim is
 * ignored, because every hand-over writes and clears it, and so are the
 * voice session it was delegated in, its place in that session, and how far
 * its turn was told to the voice, which no view reads.
 */
export const asksSync = defineSyncTable(asks, {
  topics: [{ kind: TOPIC.CONVERSATION, column: asks.conversationId }],
  ignore: [asks.dispatchClaim, asks.voiceSessionId, asks.askRevision, asks.toldSeq, asks.endToldAt],
});

/**
 * A worker's delegation as it was recorded, on its parent conversation's
 * topic, looked up through the worker's own conversation, so the agent's
 * transcript hears the call that opened the worker.
 */
export const agentDelegationSync = defineSyncTable(agentDelegationTable, {
  topics: [
    {
      through: conversations,
      key: conversations.id,
      by: agentDelegationTable.childConversationId,
      topics: [{ kind: TOPIC.CONVERSATION, column: conversations.parentConversationId }],
    },
  ],
});

export const SYNC_TABLES: readonly SyncTable[] = [
  taskSync,
  agentSync,
  memberSync,
  userSync,
  invitationSync,
  organizationSync,
  personalWorkspaceSync,
  githubInstallationSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  taskSectionSync,
  taskSectionEntrySync,
  agentSectionEntrySync,
  repositoryPinSync,
  taskPinSync,
  agentPinSync,
  macCommandSync,
  runnerLineSync,
  deviceAgentLineSync,
  deviceAgentRequestSync,
  planCommentThreadSync,
  planCommentSync,
  inboxItemSync,
  inboxMessageSync,
  inboxItemReadSync,
  attachmentSync,
  channelSync,
  automationSync,
  automationRunSync,
  planRevisionSync,
  planPageVersionSync,
  agentBrowserTabSync,
  messagesSync,
  conversationsSync,
  turnsSync,
  asksSync,
  agentDelegationSync,
];

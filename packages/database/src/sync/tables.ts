/**
 * tables.ts -- every table Sync captures, as one list the drift check and the migration writer read.
 *
 * A table is synced by declaring it here (`defineSyncTable`) and writing
 * its capture into a migration (`pnpm --filter @repo/database sync:render`);
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
 *
 * A table a delta read reads is logged too (`log`), its every write, or,
 * for one rewritten in place more often than any delta read reads it, its
 * rows' arrival and removal alone (`LOG.ROWS`): the task list's tables and
 * the inbox items' (`@repo/service`'s `tasksLive`, `inboxItemsLive`), each
 * declared logged once for every read that follows it by deltas.
 */

import { agentDelegationTable, agentTable } from "../schemas/agent.js";
import { agentBrowserTab } from "../schemas/agent-browser-tab.js";
import { agentPin } from "../schemas/agent-pin.js";
import { agentQueue } from "../schemas/agent-queue.js";
import { attachment } from "../schemas/attachment.js";
import { invitation, member, organization, user } from "../schemas/auth.js";
import { automation, automationRun } from "../schemas/automation.js";
import { device } from "../schemas/device.js";
import { deviceAgentLine, deviceAgentRequest } from "../schemas/device-agent.js";
import { githubInstallation } from "../schemas/github-installation.js";
import { githubPersonalToken } from "../schemas/github-personal-token.js";
import { githubRepositoryRead } from "../schemas/github-repository-read.js";
import { inboxItem } from "../schemas/inbox.js";
import { inboxItemRead } from "../schemas/inbox-item-read.js";
import { inboxMessage } from "../schemas/inbox-message.js";
import { installedSkill } from "../schemas/installed-skill.js";
import { integrationConnection } from "../schemas/integration.js";
import { integrationInstallation } from "../schemas/integration-installation.js";
import { macCommand } from "../schemas/mac-command.js";
import { memory } from "../schemas/memory.js";
import { personalWorkspace } from "../schemas/personal-workspace.js";
import { planComment, planCommentThread } from "../schemas/plan-comment.js";
import { planPageVersion } from "../schemas/plan-page.js";
import { planRevision } from "../schemas/plan-revision.js";
import { accountPreference } from "../schemas/preferences.js";
import { pullRequestChapters } from "../schemas/pull-request-chapters.js";
import { repositoryPin } from "../schemas/repository-pin.js";
import { runnerLine } from "../schemas/runner-line.js";
import { slackChannelRepository, slackInstallation } from "../schemas/slack-installation.js";
import { conversations, messages, turns } from "../schemas/storage.js";
import { task } from "../schemas/task.js";
import { taskBlock } from "../schemas/task-block.js";
import { taskPin } from "../schemas/task-pin.js";
import { agentSectionEntry, taskSection, taskSectionEntry } from "../schemas/task-section.js";
import { workspaceFormerSlug } from "../schemas/workspace-former-slug.js";
import { TOPIC } from "./notification.js";
import { defineSyncTable, LOG, type SyncTable } from "./sync-table.js";

/**
 * A task, on its own topic and its workspace's. Note that the plan's text
 * and the agents' journal of saves are ignored, because every save rewrites
 * both and no view reads them live: a save moves `updated_at` beside them,
 * which the task list and the task's record read, so a save still notifies.
 * Who moved it to Done is ignored too, since no view reads it and it moves
 * only with the status, which notifies.
 */
export const taskSync = defineSyncTable(task, {
  topics: [
    { kind: TOPIC.TASK, column: task.id },
    { kind: TOPIC.WORKSPACE, column: task.organizationId },
  ],
  ignore: [task.document, task.agentEdits, task.doneBy],
  log: LOG.EVERY,
});

/**
 * One task blocking another, on each task's topic and, through each task,
 * its workspace's, so the open task on either side and the workspace's task
 * list hear a block added or taken away. A row is written once and never
 * changed, so no column of it is hot.
 */
export const taskBlockSync = defineSyncTable(taskBlock, {
  topics: [
    { kind: TOPIC.TASK, column: taskBlock.blockerTaskId },
    { kind: TOPIC.TASK, column: taskBlock.blockedTaskId },
    {
      through: task,
      key: task.id,
      by: taskBlock.blockerTaskId,
      topics: [{ kind: TOPIC.WORKSPACE, column: task.organizationId }],
    },
    {
      through: task,
      key: task.id,
      by: taskBlock.blockedTaskId,
      topics: [{ kind: TOPIC.WORKSPACE, column: task.organizationId }],
    },
  ],
  log: LOG.EVERY,
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
  log: LOG.EVERY,
});

/** An account's membership of a workspace, on the workspace's topic and the account's. */
export const memberSync = defineSyncTable(member, {
  topics: [
    { kind: TOPIC.WORKSPACE, column: member.organizationId },
    { kind: TOPIC.ACCOUNT, column: member.userId },
  ],
  log: LOG.EVERY,
});

/**
 * An account, on its own topic and, through its memberships, every
 * workspace it is in, so a teammate's new name or picture reaches the
 * workspace's reads. Note that when it last moved and how it last signed in
 * are ignored, because every sign-in rewrites both and no view reads them.
 * The admin plugin's ban columns stay watched, since nothing of ours writes
 * them, so watching them costs nothing.
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
  log: LOG.EVERY,
});

/**
 * A member's device, on its account's topic and, through its memberships,
 * every workspace it is in, so a Mac's new name reaches the task lists that
 * name the local agents on it, and a host's platform, machine, model, and
 * update reach Settings › Hosts (`hostsLive`), as do its enrolling, which
 * writes its version, and its removal. Note that every other column is
 * ignored, because the device beats and registers again often, rewriting
 * when it was last seen and what it runs, and no view the capture wakes
 * reads them: a window judges a device by its own presence read.
 */
export const deviceSync = defineSyncTable(device, {
  topics: [
    { kind: TOPIC.ACCOUNT, column: device.userId },
    {
      through: member,
      key: member.userId,
      by: device.userId,
      topics: [{ kind: TOPIC.WORKSPACE, column: member.organizationId }],
    },
  ],
  ignore: [
    device.arch,
    device.home,
    device.agentsFolder,
    device.claudeExecutable,
    device.codexExecutable,
    device.capabilities,
    device.setup,
    device.setupFailure,
    device.updateFailure,
    device.secretHash,
    device.createdAt,
    device.lastSeenAt,
  ],
  log: LOG.EVERY,
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

/** A slug a workspace stood under before, on the workspace's topic, so its members' list names it. */
export const workspaceFormerSlugSync = defineSyncTable(workspaceFormerSlug, {
  topics: [{ kind: TOPIC.WORKSPACE, column: workspaceFormerSlug.organizationId }],
});

/** A GitHub App installation connected to a workspace, on the workspace's topic. */
export const githubInstallationSync = defineSyncTable(githubInstallation, {
  topics: [{ kind: TOPIC.WORKSPACE, column: githubInstallation.organizationId }],
});

/** A member's own GitHub token, on the member's topic. */
export const githubPersonalTokenSync = defineSyncTable(githubPersonalToken, {
  topics: [{ kind: TOPIC.ACCOUNT, column: githubPersonalToken.userId }],
  log: LOG.EVERY,
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
  log: LOG.EVERY,
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
  log: LOG.EVERY,
});

/** An agent with no task an account pinned, on the account's topic. */
export const agentPinSync = defineSyncTable(agentPin, {
  topics: [{ kind: TOPIC.ACCOUNT, column: agentPin.userId }],
  log: LOG.EVERY,
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
 * The account's preferences row, on the account's topic, which the
 * account's read of its default agent, chapters model, and Slack
 * notifications is woken on. Note that where the account last chose to run
 * a task is ignored, because a Start with Runs on, an enroll, and a
 * register each rewrite it and only an agent's start reads it, and so is
 * the row's own instant, which every settings push moves whether or not a
 * column a view reads changed.
 */
export const accountPreferenceSync = defineSyncTable(accountPreference, {
  topics: [{ kind: TOPIC.ACCOUNT, column: accountPreference.userId }],
  ignore: [
    accountPreference.runsOnMachine,
    accountPreference.runsOnDeviceId,
    accountPreference.updatedAt,
  ],
});

/**
 * One account's connection to an account at an integration, on the
 * account's integrations topic, which only its open integration reads are
 * woken on: the account's own topic would wake its task list and its inbox
 * on every sign-in. Note that a sign-in's one-time state, the retired
 * verifier, and the subject Connect holds the grant under are ignored,
 * since no view reads them and a sign-in begun or ended moves its issue
 * instant beside the state; and so are the tools a launch lists and their
 * instant, which every native agent's start rewrites, and the row's own
 * instant, which moves only beside a watched column.
 */
export const integrationConnectionSync = defineSyncTable(integrationConnection, {
  topics: [{ kind: TOPIC.ACCOUNT_INTEGRATIONS, column: integrationConnection.userId }],
  ignore: [
    integrationConnection.state,
    integrationConnection.connectVerifier,
    integrationConnection.connectSubject,
    integrationConnection.tools,
    integrationConnection.toolsListedAt,
    integrationConnection.updatedAt,
  ],
});

/**
 * A line queued for a cloud agent's runner, on the agent's topic, which the
 * runner's held read waits on (`@repo/service`'s `runner-lines-app.ts`).
 * Note that its acceptance is ignored, because the runner's read waits on
 * new lines alone, and every message the runner takes stamps one.
 */
const runnerLineSync = defineSyncTable(runnerLine, {
  topics: [{ kind: TOPIC.AGENT, column: runnerLine.agentId }],
  ignore: [runnerLine.acceptedAt],
});

/** Where an agent's queue stands, moved on by every write to it (`agent-queue-store.ts`), on the agent's topic, which its transcript's held read is woken on. */
export const agentQueueSync = defineSyncTable(agentQueue, {
  topics: [{ kind: TOPIC.AGENT, column: agentQueue.agentId }],
});

/**
 * A line queued for a local agent's runner, on its account's topic, which
 * the account's Macs' held read of their lines and a wait for a runner's
 * exit are woken on, and on its agent's, which the agent's transcript is
 * woken on as its launch is claimed, steps, and settles. Note that what the
 * line says is ignored, because it is written once as the line is queued
 * and never changed, and an update comparing it would weigh a files line's
 * every file at its claim and its settle.
 */
export const deviceAgentLineSync = defineSyncTable(deviceAgentLine, {
  topics: [
    { kind: TOPIC.ACCOUNT, column: deviceAgentLine.userId },
    { kind: TOPIC.AGENT, column: deviceAgentLine.agentId },
  ],
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
 * it. Note that the accounts are named here, because the account's inbox is
 * read per account, and a read's topics come from its params alone: waking them on the workspace's topic instead would
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
  log: LOG.EVERY,
});

/** A message on an inbox item's thread, on its item's task and agent, which it names only by the item; its Slack DM is no reader's, so it is hot. */
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
  ignore: [inboxMessage.slackDm],
  log: LOG.EVERY,
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
  log: LOG.EVERY,
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
  log: LOG.EVERY,
});

/**
 * An automation, on its workspace's topic and its creator's. Its rows'
 * arrival and removal alone are logged, since the task list reads only
 * whether a run's automation starts a new agent each run (`run-tasks.ts`).
 */
export const automationSync = defineSyncTable(automation, {
  topics: [
    { kind: TOPIC.WORKSPACE, column: automation.organizationId },
    { kind: TOPIC.ACCOUNT, column: automation.userId },
  ],
  log: LOG.ROWS,
});

/**
 * One run of an automation, on its account's topic and, through the
 * automation, its workspace's. Its rows' arrival and removal alone are
 * logged, since the task list reads only which automation a run is of,
 * which never changes, and which task a run made, which the run names in
 * the transaction that inserts the task, so the task's own row moving
 * reads it.
 */
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
  log: LOG.ROWS,
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
 * A pull request's chapters for one head commit, on its workspace's
 * chapters topic, which only the open chapter reads of the workspace are
 * woken on: the workspace's own topic would wake every member's task list
 * on each claim, finish, and failure. Note that who pressed Generate is
 * ignored, because no view reads it and it moves only with a claim, which
 * moves the status beside it, or with its account deleted, which no reader
 * needs to hear.
 */
export const pullRequestChaptersSync = defineSyncTable(pullRequestChapters, {
  topics: [{ kind: TOPIC.WORKSPACE_CHAPTERS, column: pullRequestChapters.organizationId }],
  ignore: [pullRequestChapters.requestedBy],
});

/**
 * A workspace's memory, on its workspace's memory topic, which only the open
 * memory reads of the workspace are woken on: the workspace's own topic
 * would wake every member's task list on each agent's `save_memory`. No
 * column is ignored, since the page reads every one, and a keep, a
 * correction, and a forget each move a column it reads or the row itself.
 */
export const memorySync = defineSyncTable(memory, {
  topics: [{ kind: TOPIC.MEMORY, column: memory.organizationId }],
});

/**
 * A workspace's installation of an integration's own app, on the
 * workspace's integrations topic, which only the open integration reads of
 * the workspace are woken on. No column is ignored: Settings reads the
 * status and the account's name, and an install, a disconnect, and the
 * provider's uninstall each move one of them; a link moving the row to
 * another workspace notifies both.
 */
export const integrationInstallationSync = defineSyncTable(integrationInstallation, {
  topics: [{ kind: TOPIC.WORKSPACE_INTEGRATIONS, column: integrationInstallation.organizationId }],
});

/**
 * A workspace's Slack bot, on the workspace's integrations topic: a connect,
 * a disconnect, and a default repository named each move the row Settings
 * reads. No column is ignored.
 */
export const slackInstallationSync = defineSyncTable(slackInstallation, {
  topics: [{ kind: TOPIC.WORKSPACE_INTEGRATIONS, column: slackInstallation.organizationId }],
});

/**
 * One Slack channel's repository, on its workspace's integrations topic: a
 * repository named, cleared, or forgotten as the bot leaves, and every one
 * gone with a disconnect. No column is ignored.
 */
export const slackChannelRepositorySync = defineSyncTable(slackChannelRepository, {
  topics: [{ kind: TOPIC.WORKSPACE_INTEGRATIONS, column: slackChannelRepository.organizationId }],
});

/**
 * An installed skill, on its workspace's skills topic where it is a
 * workspace's and on its owner's where it is personal, which only the open
 * skills reads are woken on; each row names one, since the other's id is
 * null, and a share, which moves a personal skill into a workspace, names
 * both through the row before and after. No column is ignored, since every
 * write moves one the page reads, its instant among them. Note that a
 * skill's files are not captured: the list reads none of them,
 * and an update rewrites them beside the skill's own row in one transaction.
 */
export const installedSkillSync = defineSyncTable(installedSkill, {
  topics: [
    { kind: TOPIC.WORKSPACE_SKILLS, column: installedSkill.organizationId },
    { kind: TOPIC.ACCOUNT_SKILLS, column: installedSkill.ownerUserId },
  ],
});

/**
 * A transcript's message, on its conversation's topic alone. Note that no
 * column is ignored and no wider topic is taken, because a journal is
 * rewritten in place on every streamed step: each write transaction
 * notifies the one topic once, its rows' notifications folding into one,
 * and only the transcript's own readers wake on it. Its rows' arrival and
 * removal are logged, and an update only where a turn took the line or its
 * hand-over withdrew it, for the same reason: the task list reads when a
 * line awaiting its turn arrived and whether it still waits, never a
 * rewrite.
 */
export const messagesSync = defineSyncTable(messages, {
  topics: [{ kind: TOPIC.CONVERSATION, column: messages.conversationId }],
  log: LOG.ROWS,
  logUpdatesOf: [messages.turnId, messages.withdrawnAt],
});

/**
 * A conversation, on its own topic and its parent's, so a worker's title
 * landing, or a worker opened or cleared, reaches the agent's transcript,
 * which lists its workers. Note that the next message sequence, the native
 * harness's projection and its event count, the last activity, and the
 * dispatch claim are ignored, because each is rewritten by every message or
 * hand-over and no view reads them; a message written beside them notifies
 * the conversation's topic itself. Its rows' arrival and removal alone are
 * logged, because every streamed step moves its journal's revision, and the
 * task list reads only the harness it opened on.
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
  log: LOG.ROWS,
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
  log: LOG.EVERY,
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
  taskBlockSync,
  agentSync,
  memberSync,
  userSync,
  deviceSync,
  invitationSync,
  organizationSync,
  personalWorkspaceSync,
  workspaceFormerSlugSync,
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
  accountPreferenceSync,
  integrationConnectionSync,
  runnerLineSync,
  agentQueueSync,
  deviceAgentLineSync,
  deviceAgentRequestSync,
  planCommentThreadSync,
  planCommentSync,
  inboxItemSync,
  inboxMessageSync,
  inboxItemReadSync,
  attachmentSync,
  automationSync,
  automationRunSync,
  planRevisionSync,
  planPageVersionSync,
  agentBrowserTabSync,
  pullRequestChaptersSync,
  memorySync,
  installedSkillSync,
  integrationInstallationSync,
  slackInstallationSync,
  slackChannelRepositorySync,
  messagesSync,
  conversationsSync,
  turnsSync,
  agentDelegationSync,
];

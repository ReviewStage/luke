import { agentDelegationTable, agentTable } from "../schemas/agent.js";
import { agentBrowserTab } from "../schemas/agent-browser-tab.js";
import { agentPin } from "../schemas/agent-pin.js";
import { agentQueue } from "../schemas/agent-queue.js";
import { agentRead } from "../schemas/agent-read.js";
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
import { descriptionComment, descriptionCommentThread } from "../schemas/description-comment.js";
import { taskPageVersion } from "../schemas/task-page.js";
import { descriptionRevision } from "../schemas/description-revision.js";
import { accountPreference } from "../schemas/preferences.js";
import { pullRequestChapters } from "../schemas/pull-request-chapters.js";
import { repositoryPin } from "../schemas/repository-pin.js";
import { runnerLine } from "../schemas/runner-line.js";
import { slackChannelRepository, slackInstallation } from "../schemas/slack-installation.js";
import { conversations, messages, turns } from "../schemas/storage.js";
import { task } from "../schemas/task.js";
import { taskBlock } from "../schemas/task-block.js";
import { taskPin } from "../schemas/task-pin.js";
import { taskRead } from "../schemas/task-read.js";
import { agentSectionEntry, taskSection, taskSectionEntry } from "../schemas/task-section.js";
import { workspaceFormerSlug } from "../schemas/workspace-former-slug.js";
import { TOPIC } from "./notification.js";
import { defineSyncTable, LOG, type SyncTable } from "./sync-table.js";

export const taskSync = defineSyncTable(task, {
  topics: [
    { kind: TOPIC.TASK, column: task.id },
    { kind: TOPIC.WORKSPACE, column: task.organizationId },
  ],
  ignore: [task.document, task.agentEdits, task.doneBy],
  log: LOG.EVERY,
});

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

export const agentSync = defineSyncTable(agentTable, {
  topics: [
    { kind: TOPIC.AGENT, column: agentTable.id },
    { kind: TOPIC.TASK, column: agentTable.taskId },
    { kind: TOPIC.WORKSPACE, column: agentTable.organizationId },
  ],
  ignore: [agentTable.lastStep, agentTable.publishedRead],
  log: LOG.EVERY,
});

export const memberSync = defineSyncTable(member, {
  topics: [
    { kind: TOPIC.WORKSPACE, column: member.organizationId },
    { kind: TOPIC.ACCOUNT, column: member.userId },
  ],
  log: LOG.EVERY,
});

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

export const invitationSync = defineSyncTable(invitation, {
  topics: [{ kind: TOPIC.WORKSPACE, column: invitation.organizationId }],
});

export const organizationSync = defineSyncTable(organization, {
  topics: [{ kind: TOPIC.WORKSPACE, column: organization.id }],
});

export const personalWorkspaceSync = defineSyncTable(personalWorkspace, {
  topics: [
    { kind: TOPIC.WORKSPACE, column: personalWorkspace.organizationId },
    { kind: TOPIC.ACCOUNT, column: personalWorkspace.userId },
  ],
});

export const workspaceFormerSlugSync = defineSyncTable(workspaceFormerSlug, {
  topics: [{ kind: TOPIC.WORKSPACE, column: workspaceFormerSlug.organizationId }],
});

export const githubInstallationSync = defineSyncTable(githubInstallation, {
  topics: [{ kind: TOPIC.WORKSPACE, column: githubInstallation.organizationId }],
});

export const githubPersonalTokenSync = defineSyncTable(githubPersonalToken, {
  topics: [{ kind: TOPIC.ACCOUNT, column: githubPersonalToken.userId }],
  log: LOG.EVERY,
});

export const githubRepositoryReadSync = defineSyncTable(githubRepositoryRead, {
  topics: [{ kind: TOPIC.ACCOUNT, column: githubRepositoryRead.userId }],
  ignore: [githubRepositoryRead.checkedAt],
  log: LOG.EVERY,
});

export const taskSectionSync = defineSyncTable(taskSection, {
  topics: [{ kind: TOPIC.ACCOUNT, column: taskSection.userId }],
});

export const taskSectionEntrySync = defineSyncTable(taskSectionEntry, {
  topics: [{ kind: TOPIC.ACCOUNT, column: taskSectionEntry.userId }],
});

export const agentSectionEntrySync = defineSyncTable(agentSectionEntry, {
  topics: [{ kind: TOPIC.ACCOUNT, column: agentSectionEntry.userId }],
});

export const repositoryPinSync = defineSyncTable(repositoryPin, {
  topics: [{ kind: TOPIC.ACCOUNT, column: repositoryPin.userId }],
});

export const taskPinSync = defineSyncTable(taskPin, {
  topics: [{ kind: TOPIC.ACCOUNT, column: taskPin.userId }],
  log: LOG.EVERY,
});

export const agentPinSync = defineSyncTable(agentPin, {
  topics: [{ kind: TOPIC.ACCOUNT, column: agentPin.userId }],
  log: LOG.EVERY,
});

export const taskReadSync = defineSyncTable(taskRead, {
  topics: [{ kind: TOPIC.ACCOUNT, column: taskRead.userId }],
  log: LOG.EVERY,
});

export const agentReadSync = defineSyncTable(agentRead, {
  topics: [{ kind: TOPIC.ACCOUNT, column: agentRead.userId }],
  log: LOG.EVERY,
});

export const macCommandSync = defineSyncTable(macCommand, {
  topics: [{ kind: TOPIC.ACCOUNT, column: macCommand.userId }],
});

export const accountPreferenceSync = defineSyncTable(accountPreference, {
  topics: [{ kind: TOPIC.ACCOUNT, column: accountPreference.userId }],
  ignore: [
    accountPreference.runsOnMachine,
    accountPreference.runsOnDeviceId,
    accountPreference.updatedAt,
  ],
});

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

const runnerLineSync = defineSyncTable(runnerLine, {
  topics: [{ kind: TOPIC.AGENT, column: runnerLine.agentId }],
  ignore: [runnerLine.acceptedAt],
});

export const agentQueueSync = defineSyncTable(agentQueue, {
  topics: [{ kind: TOPIC.AGENT, column: agentQueue.agentId }],
});

export const deviceAgentLineSync = defineSyncTable(deviceAgentLine, {
  topics: [
    { kind: TOPIC.ACCOUNT, column: deviceAgentLine.userId },
    { kind: TOPIC.AGENT, column: deviceAgentLine.agentId },
  ],
  ignore: [deviceAgentLine.payload],
});

const deviceAgentRequestSync = defineSyncTable(deviceAgentRequest, {
  topics: [{ kind: TOPIC.ACCOUNT, column: deviceAgentRequest.userId }],
  ignore: [deviceAgentRequest.bytes],
});

export const descriptionCommentThreadSync = defineSyncTable(descriptionCommentThread, {
  topics: [{ kind: TOPIC.TASK, column: descriptionCommentThread.taskId }],
});

export const descriptionCommentSync = defineSyncTable(descriptionComment, {
  topics: [{ kind: TOPIC.TASK, column: descriptionComment.taskId }],
});

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

export const automationSync = defineSyncTable(automation, {
  topics: [
    { kind: TOPIC.WORKSPACE, column: automation.organizationId },
    { kind: TOPIC.ACCOUNT, column: automation.userId },
  ],
  log: LOG.ROWS,
});

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

export const descriptionRevisionSync = defineSyncTable(descriptionRevision, {
  topics: [{ kind: TOPIC.TASK, column: descriptionRevision.taskId }],
  ignore: [descriptionRevision.document],
});

export const taskPageVersionSync = defineSyncTable(taskPageVersion, {
  topics: [
    { kind: TOPIC.TASK, column: taskPageVersion.taskId },
    { kind: TOPIC.AGENT, column: taskPageVersion.agentId },
  ],
});

export const agentBrowserTabSync = defineSyncTable(agentBrowserTab, {
  topics: [{ kind: TOPIC.TASK, column: agentBrowserTab.taskId }],
});

export const pullRequestChaptersSync = defineSyncTable(pullRequestChapters, {
  topics: [{ kind: TOPIC.WORKSPACE_CHAPTERS, column: pullRequestChapters.organizationId }],
  ignore: [pullRequestChapters.requestedBy],
});

export const memorySync = defineSyncTable(memory, {
  topics: [{ kind: TOPIC.MEMORY, column: memory.organizationId }],
});

export const integrationInstallationSync = defineSyncTable(integrationInstallation, {
  topics: [{ kind: TOPIC.WORKSPACE_INTEGRATIONS, column: integrationInstallation.organizationId }],
});

export const slackInstallationSync = defineSyncTable(slackInstallation, {
  topics: [{ kind: TOPIC.WORKSPACE_INTEGRATIONS, column: slackInstallation.organizationId }],
});

export const slackChannelRepositorySync = defineSyncTable(slackChannelRepository, {
  topics: [{ kind: TOPIC.WORKSPACE_INTEGRATIONS, column: slackChannelRepository.organizationId }],
});

export const installedSkillSync = defineSyncTable(installedSkill, {
  topics: [
    { kind: TOPIC.WORKSPACE_SKILLS, column: installedSkill.organizationId },
    { kind: TOPIC.ACCOUNT_SKILLS, column: installedSkill.ownerUserId },
  ],
});

export const messagesSync = defineSyncTable(messages, {
  topics: [{ kind: TOPIC.CONVERSATION, column: messages.conversationId }],
  log: LOG.ROWS,
  logUpdatesOf: [messages.turnId, messages.withdrawnAt],
});

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
  ignore: [turns.descriptionNotesTaken],
  log: LOG.EVERY,
});

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
  taskReadSync,
  agentReadSync,
  macCommandSync,
  accountPreferenceSync,
  integrationConnectionSync,
  runnerLineSync,
  agentQueueSync,
  deviceAgentLineSync,
  deviceAgentRequestSync,
  descriptionCommentThreadSync,
  descriptionCommentSync,
  inboxItemSync,
  inboxMessageSync,
  inboxItemReadSync,
  attachmentSync,
  automationSync,
  automationRunSync,
  descriptionRevisionSync,
  taskPageVersionSync,
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

import { accountPreferencesLiveStatement } from "@repo/database/models/account-store";
import { browserTabsLiveStatement } from "@repo/database/models/agent-browser-tabs";
import { ownFailedRunsLiveStatement } from "@repo/database/models/automation-store";
import { hostsLiveStatement } from "@repo/database/models/host-store";
import { installedSkillsLiveStatement } from "@repo/database/models/installed-skill-store";
import { sentryInstallationsLiveStatement } from "@repo/database/models/integration-installation-store";
import { macCommandsLiveStatement } from "@repo/database/models/mac-command-store";
import { workspaceMemoriesLiveStatement } from "@repo/database/models/memory-store";
import { messageStandingNow } from "@repo/database/models/message-reads";
import { pullRequestChaptersLiveStatement } from "@repo/database/models/pull-request-chapters-store";
import { repositoryPinsLiveStatement } from "@repo/database/models/repository-pin-store";
import {
  slackChannelRepositoriesLiveStatement,
  slackInstallationLiveStatement,
} from "@repo/database/models/slack-installation-store";
import { taskSectionsLiveStatements } from "@repo/database/models/task-section-store";
import {
  memberWorkspaceIds,
  workspacesLiveStatements,
} from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { inboxItem } from "@repo/database/schemas/inbox";
import { task } from "@repo/database/schemas/task";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import {
  accountPreferenceSync,
  agentBrowserTabSync,
  agentDelegationSync,
  agentPinSync,
  agentQueueSync,
  agentReadSync,
  agentSectionEntrySync,
  agentSync,
  attachmentSync,
  automationRunSync,
  automationSync,
  conversationsSync,
  deviceAgentLineSync,
  deviceSync,
  githubInstallationSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  inboxItemReadSync,
  inboxItemSync,
  inboxMessageSync,
  installedSkillSync,
  integrationConnectionSync,
  integrationInstallationSync,
  invitationSync,
  macCommandSync,
  memberSync,
  memorySync,
  messagesSync,
  organizationSync,
  personalWorkspaceSync,
  descriptionCommentSync,
  descriptionCommentThreadSync,
  taskPageVersionSync,
  descriptionRevisionSync,
  pullRequestChaptersSync,
  repositoryPinSync,
  slackChannelRepositorySync,
  slackInstallationSync,
  taskBlockSync,
  taskPinSync,
  taskReadSync,
  taskSectionEntrySync,
  taskSectionSync,
  taskSync,
  turnsSync,
  userSync,
  workspaceFormerSlugSync,
} from "@repo/database/sync/tables";
import { ACCOUNT_INBOX_REPOSITORYLESS } from "@repo/features/account-inbox-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { macCommandKindsRead } from "@repo/features/mac-command-wire";
import { Effect, Option } from "effect";
import { workspaceInvitationsLiveStatement } from "../accounts/workspace-invitations.js";
import { workspaceMembersLiveStatements } from "../accounts/workspace-members.js";
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
import { taskCommentsLiveStatements } from "../tasks/description-comments-live.js";
import { taskHistoryLiveStatements } from "../tasks/task-history-live.js";
import { taskListDeltaStatements, taskListLiveStatements } from "../tasks/task-list-live.js";
import { agentPagesLiveStatements, taskPagesLiveStatements } from "../tasks/task-pages-live.js";
import { taskRecordLiveStatements } from "../tasks/task-record-live.js";
import { defineLiveQuery, LIVE_MODE, liveQueryRegistry } from "./live-query.js";

function readerWorkspaceTopics(userId: string) {
  return Effect.map(memberWorkspaceIds(userId), (workspaceIds) =>
    workspaceIds.map((workspaceId): SyncTopic => [TOPIC.WORKSPACE, workspaceId]),
  );
}

function readerAndWorkspaceTopics(userId: string) {
  return Effect.map(readerWorkspaceTopics(userId), (workspaces): readonly SyncTopic[] => [
    [TOPIC.ACCOUNT, userId],
    ...workspaces,
  ]);
}

export const sidebarLive = defineLiveQuery({
  name: "sidebar",
  params: ["userId"],
  reads: [
    taskSectionSync,
    taskSectionEntrySync,
    agentSectionEntrySync,
    repositoryPinSync,
    taskSync,
    agentSync,
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

export const workspacesLive = defineLiveQuery({
  name: "workspaces",
  params: ["userId"],
  reads: [
    memberSync,
    organizationSync,
    personalWorkspaceSync,
    userSync,
    githubInstallationSync,
    workspaceFormerSlugSync,
  ],
  topics: ({ userId }) => readerAndWorkspaceTopics(userId),
  statements: ({ userId }) => workspacesLiveStatements(userId),
  mode: LIVE_MODE.SNAPSHOT,
});

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

export const accountPreferencesLive = defineLiveQuery({
  name: LIVE_READ.ACCOUNT_PREFERENCES,
  params: ["userId"],
  reads: [accountPreferenceSync],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId }) =>
    Option.map(accountPreferencesLiveStatement(userId), (preferences) => ({ preferences })),
  mode: LIVE_MODE.SNAPSHOT,
});

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

const ITEM_GATES = [memberSync, githubPersonalTokenSync, githubRepositoryReadSync] as const;

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
  statements: ({ userId, repositoryless }) =>
    Option.zipWith(
      accountInboxLiveStatements(userId, repositoryless === ACCOUNT_INBOX_REPOSITORYLESS.INCLUDE),
      ownFailedRunsLiveStatement(userId),
      (parts, failedRuns) => ({ ...parts, failedRuns }),
    ),
  mode: LIVE_MODE.SNAPSHOT,
});

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

export const taskInboxLive = defineLiveQuery({
  name: "taskInbox",
  params: ["userId", "taskId"],
  reads: SCOPE_INBOX_READS,
  topics: ({ taskId }) => [[TOPIC.TASK, taskId]],
  statements: ({ userId, taskId }) => taskInboxLiveStatements(userId, taskId),
  mode: LIVE_MODE.SNAPSHOT,
});

function instantParam(param: string): Date {
  const millis = Number(param);
  return new Date(Number.isSafeInteger(millis) && millis > 0 ? millis : 0);
}

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

export const agentInboxLive = defineLiveQuery({
  name: "agentInbox",
  params: ["userId", "agentId"],
  reads: SCOPE_INBOX_READS,
  topics: ({ agentId }) => [[TOPIC.AGENT, agentId]],
  statements: ({ userId, agentId }) => memberAgentInboxLiveStatements(userId, agentId),
  mode: LIVE_MODE.SNAPSHOT,
});

export const workspaceMembersLive = defineLiveQuery({
  name: "workspaceMembers",
  params: ["userId", "workspaceId"],
  reads: [
    memberSync,
    userSync,
    taskSync,
    agentSync,
    automationSync,
    descriptionRevisionSync,
    inboxItemSync,
  ],
  topics: ({ workspaceId }) => [[TOPIC.WORKSPACE, workspaceId]],
  statements: ({ userId, workspaceId }) => workspaceMembersLiveStatements(userId, workspaceId),
  mode: LIVE_MODE.SNAPSHOT,
});

export const hostsLive = defineLiveQuery({
  name: LIVE_READ.HOSTS,
  params: ["userId"],
  reads: [deviceSync],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId }) => Option.map(hostsLiveStatement(userId), (hosts) => ({ hosts })),
  mode: LIVE_MODE.SNAPSHOT,
});

export const workspaceMemoriesLive = defineLiveQuery({
  name: LIVE_READ.MEMORIES,
  params: ["userId", "workspaceId"],
  reads: [memorySync, memberSync, userSync],
  topics: ({ userId, workspaceId }) => [
    [TOPIC.MEMORY, workspaceId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, workspaceId }) =>
    Option.map(workspaceMemoriesLiveStatement(userId, workspaceId), (memories) => ({ memories })),
  mode: LIVE_MODE.SNAPSHOT,
});

export const installedSkillsLive = defineLiveQuery({
  name: LIVE_READ.INSTALLED_SKILLS,
  params: ["userId", "workspaceId"],
  reads: [installedSkillSync, memberSync],
  topics: ({ userId, workspaceId }) => [
    [TOPIC.WORKSPACE_SKILLS, workspaceId],
    [TOPIC.ACCOUNT_SKILLS, userId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, workspaceId }) =>
    Option.map(installedSkillsLiveStatement(userId, workspaceId), (skills) => ({ skills })),
  mode: LIVE_MODE.SNAPSHOT,
});

export const workspaceIntegrationsLive = defineLiveQuery({
  name: LIVE_READ.WORKSPACE_INTEGRATIONS,
  params: ["userId", "workspaceId"],
  reads: [
    integrationInstallationSync,
    slackInstallationSync,
    slackChannelRepositorySync,
    memberSync,
  ],
  topics: ({ userId, workspaceId }) => [
    [TOPIC.WORKSPACE_INTEGRATIONS, workspaceId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, workspaceId }) =>
    Option.all({
      sentryInstallations: sentryInstallationsLiveStatement(userId, workspaceId),
      slackInstallation: slackInstallationLiveStatement(userId, workspaceId),
      slackChannelRepositories: slackChannelRepositoriesLiveStatement(userId, workspaceId),
    }),
  mode: LIVE_MODE.SNAPSHOT,
});

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

const AUTOMATION_READS = [
  automationSync,
  automationRunSync,
  agentSync,
  turnsSync,
  messagesSync,
  conversationsSync,
  memberSync,
] as const;

export const automationsLive = defineLiveQuery({
  name: "automations",
  params: ["userId", "workspaceId"],
  reads: AUTOMATION_READS,
  topics: ({ workspaceId }) => [[TOPIC.WORKSPACE, workspaceId]],
  statements: ({ userId, workspaceId }) => automationsLiveStatements(userId, workspaceId),
  mode: LIVE_MODE.SNAPSHOT,
});

export const automationWorkspaceRunsLive = defineLiveQuery({
  name: "automationWorkspaceRuns",
  params: ["userId", "workspaceId"],
  reads: AUTOMATION_READS,
  topics: ({ workspaceId }) => [[TOPIC.WORKSPACE, workspaceId]],
  statements: ({ userId, workspaceId }) =>
    automationWorkspaceRunsLiveStatements(userId, workspaceId),
  mode: LIVE_MODE.SNAPSHOT,
});

export const automationRunsLive = defineLiveQuery({
  name: "automationRuns",
  params: ["userId", "automationId", "workspaceId"],
  reads: AUTOMATION_READS,
  topics: ({ workspaceId }) => [[TOPIC.WORKSPACE, workspaceId]],
  statements: ({ userId, automationId }) => automationRunsLiveStatements(userId, automationId),
  mode: LIVE_MODE.SNAPSHOT,
});

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

export const DESCRIPTION_THREADS = "";

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

function pullRequestNumberParam(param: string): number {
  const number = Number(param);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

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

export const LIVE_QUERIES = liveQueryRegistry([
  sidebarLive,
  tasksLive,
  workspacesLive,
  macCommandsLive,
  accountPreferencesLive,
  integrationStatusesLive,
  inboxLive,
  inboxItemsLive,
  taskInboxLive,
  agentInboxLive,
  workspaceMembersLive,
  workspaceInvitationsLive,
  workspaceMemoriesLive,
  installedSkillsLive,
  workspaceIntegrationsLive,
  hostsLive,
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
]);

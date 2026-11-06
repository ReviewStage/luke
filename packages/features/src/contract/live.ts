import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { ACCOUNT_INBOX_REPOSITORYLESS } from "../account-inbox-wire.js";
import { accountPreferencesLiveAnswerSchema } from "../account-preferences-live.js";
import { agentOriginLiveAnswerSchema } from "../agent-origin-live.js";
import {
  automationRunsLiveAnswerSchema,
  automationsLiveAnswerSchema,
  automationWorkspaceRunsLiveAnswerSchema,
} from "../automation-live.js";
import { hostsLiveAnswerSchema } from "../host-live.js";
import { installedSkillsLiveAnswerSchema } from "../installed-skill-live.js";
import { integrationStatusesLiveAnswerSchema } from "../integration-live.js";
import {
  ACCOUNT_INBOX_ITEMS,
  accountInboxItemsLiveAnswerSchema,
  accountInboxLiveAnswerSchema,
  agentTranscriptLiveAnswerSchema,
  LIVE_POLL,
  LIVE_USER_QUERY,
  macCommandsLiveAnswerSchema,
  scopeInboxLiveAnswerSchema,
  taskBrowserTabsLiveAnswerSchema,
  taskHistoryLiveAnswerSchema,
  taskPagesLiveAnswerSchema,
  taskRecordLiveAnswerSchema,
} from "../live-wire.js";
import { workspaceMemoriesLiveAnswerSchema } from "../memory-live.js";
import { taskCommentsLiveAnswerSchema } from "../description-comment-live.js";
import { pullRequestChaptersLiveAnswerSchema } from "../pull-request-chapters-live.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { sidebarLiveAnswerSchema } from "../sidebar-live.js";
import { taskListLiveAnswerSchema } from "../task-list-live.js";
import { workspaceIntegrationsLiveAnswerSchema } from "../workspace-integrations-live.js";
import {
  workspaceInvitationsLiveAnswerSchema,
  workspaceMembersLiveAnswerSchema,
  workspacesLiveAnswerSchema,
} from "../workspace-live.js";
import { hostedProcedure } from "./base.js";

const pollField = EffectSchema.optionalKey(EffectSchema.Literal(LIVE_POLL.ON));

const afterField = EffectSchema.optionalKey(EffectSchema.String);

const syncField = EffectSchema.optionalKey(EffectSchema.String);

const userField = EffectSchema.optionalKey(EffectSchema.String);

const liveReadSchema = EffectSchema.Struct({
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

const liveTasksSchema = EffectSchema.Struct({
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_POLL.SYNC]: syncField,
  [LIVE_USER_QUERY]: userField,
});

const liveAccountInboxSchema = EffectSchema.Struct({
  [ACCOUNT_INBOX_REPOSITORYLESS.QUERY]: EffectSchema.optionalKey(
    EffectSchema.Literal(ACCOUNT_INBOX_REPOSITORYLESS.INCLUDE),
  ),
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

const liveAccountInboxItemsSchema = EffectSchema.Struct({
  [ACCOUNT_INBOX_ITEMS.SINCE]: EffectSchema.optionalKey(EffectSchema.String),
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_POLL.SYNC]: syncField,
  [LIVE_USER_QUERY]: userField,
});

const liveTaskSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

const liveTaskCommentsSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  page: EffectSchema.optionalKey(EffectSchema.String),
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

const liveScopeSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

const liveTranscriptSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  call: EffectSchema.optionalKey(EffectSchema.String),
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_POLL.CURSOR]: EffectSchema.optionalKey(EffectSchema.String),
  [LIVE_USER_QUERY]: userField,
});

const liveMacCommandsSchema = EffectSchema.Struct({
  kinds: EffectSchema.optionalKey(EffectSchema.String),
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

const livePullRequestChaptersSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  number: EffectSchema.String,
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

const liveWorkspaceSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.String,
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

export const liveContract = {
  inbox: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_INBOX }))
    .input(liveAccountInboxSchema)
    .output(EffectSchema.flip(accountInboxLiveAnswerSchema)),
  inboxItems: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_INBOX_ITEMS }))
    .input(liveAccountInboxItemsSchema)
    .output(EffectSchema.flip(accountInboxItemsLiveAnswerSchema)),
  taskRecord: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_TASK_RECORD }))
    .input(liveTaskSchema)
    .output(EffectSchema.flip(taskRecordLiveAnswerSchema)),
  taskPages: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_TASK_PAGES }))
    .input(liveTaskSchema)
    .output(EffectSchema.flip(taskPagesLiveAnswerSchema)),
  agentPages: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_AGENT_PAGES }))
    .input(liveTaskSchema)
    .output(EffectSchema.flip(taskPagesLiveAnswerSchema)),
  agentOrigin: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_AGENT_ORIGIN }))
    .input(liveTaskSchema)
    .output(EffectSchema.flip(agentOriginLiveAnswerSchema)),
  taskHistory: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_TASK_HISTORY }))
    .input(liveTaskSchema)
    .output(EffectSchema.flip(taskHistoryLiveAnswerSchema)),
  taskComments: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_TASK_COMMENTS }))
    .input(liveTaskCommentsSchema)
    .output(EffectSchema.flip(taskCommentsLiveAnswerSchema)),
  taskBrowserTabs: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_TASK_BROWSER_TABS }))
    .input(liveTaskSchema)
    .output(EffectSchema.flip(taskBrowserTabsLiveAnswerSchema)),
  agentBrowserTabs: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_AGENT_BROWSER_TABS }))
    .input(liveTaskSchema)
    .output(EffectSchema.flip(taskBrowserTabsLiveAnswerSchema)),
  tasks: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_TASKS }))
    .input(liveTasksSchema)
    .output(EffectSchema.flip(taskListLiveAnswerSchema)),
  automations: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_AUTOMATIONS }))
    .input(
      EffectSchema.Struct({
        workspaceId: EffectSchema.String,
        [LIVE_POLL.QUERY]: pollField,
        [LIVE_POLL.AFTER]: afterField,
        [LIVE_USER_QUERY]: userField,
      }),
    )
    .output(EffectSchema.flip(automationsLiveAnswerSchema)),
  automationWorkspaceRuns: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: HOSTED_SERVICE_PATH.LIVE_AUTOMATION_WORKSPACE_RUNS,
      }),
    )
    .input(liveWorkspaceSchema)
    .output(EffectSchema.flip(automationWorkspaceRunsLiveAnswerSchema)),
  automationRuns: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_AUTOMATION_RUNS }))
    .input(liveTaskSchema)
    .output(EffectSchema.flip(automationRunsLiveAnswerSchema)),
  agentTranscript: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_AGENT_TRANSCRIPT }))
    .input(liveTranscriptSchema)
    .output(EffectSchema.flip(agentTranscriptLiveAnswerSchema)),
  macCommands: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_MAC_COMMANDS }))
    .input(liveMacCommandsSchema)
    .output(EffectSchema.flip(macCommandsLiveAnswerSchema)),
  taskInbox: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_TASK_INBOX }))
    .input(liveScopeSchema)
    .output(EffectSchema.flip(scopeInboxLiveAnswerSchema)),
  agentInbox: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_AGENT_INBOX }))
    .input(liveScopeSchema)
    .output(EffectSchema.flip(scopeInboxLiveAnswerSchema)),
  sidebar: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_SIDEBAR }))
    .input(liveReadSchema)
    .output(EffectSchema.flip(sidebarLiveAnswerSchema)),
  workspaces: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_WORKSPACES }))
    .input(liveReadSchema)
    .output(EffectSchema.flip(workspacesLiveAnswerSchema)),
  workspaceMembers: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_WORKSPACE_MEMBERS }))
    .input(liveWorkspaceSchema)
    .output(EffectSchema.flip(workspaceMembersLiveAnswerSchema)),
  workspaceInvitations: hostedProcedure
    .meta(
      openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_WORKSPACE_INVITATIONS }),
    )
    .input(liveWorkspaceSchema)
    .output(EffectSchema.flip(workspaceInvitationsLiveAnswerSchema)),
  hosts: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_HOSTS }))
    .input(liveReadSchema)
    .output(EffectSchema.flip(hostsLiveAnswerSchema)),
  workspaceMemories: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_WORKSPACE_MEMORIES }))
    .input(liveWorkspaceSchema)
    .output(EffectSchema.flip(workspaceMemoriesLiveAnswerSchema)),
  installedSkills: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_INSTALLED_SKILLS }))
    .input(liveWorkspaceSchema)
    .output(EffectSchema.flip(installedSkillsLiveAnswerSchema)),
  workspaceIntegrations: hostedProcedure
    .meta(
      openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_WORKSPACE_INTEGRATIONS }),
    )
    .input(liveWorkspaceSchema)
    .output(EffectSchema.flip(workspaceIntegrationsLiveAnswerSchema)),
  pullRequestChapters: hostedProcedure
    .meta(
      openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_PULL_REQUEST_CHAPTERS }),
    )
    .input(livePullRequestChaptersSchema)
    .output(EffectSchema.flip(pullRequestChaptersLiveAnswerSchema)),
  integrationStatuses: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_INTEGRATION_STATUSES }))
    .input(liveReadSchema)
    .output(EffectSchema.flip(integrationStatusesLiveAnswerSchema)),
  accountPreferences: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_ACCOUNT_PREFERENCES }))
    .input(liveReadSchema)
    .output(EffectSchema.flip(accountPreferencesLiveAnswerSchema)),
};

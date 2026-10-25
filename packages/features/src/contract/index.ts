/**
 * index.ts -- the hosted service's oRPC contract, one key per resource.
 *
 * A subpath door of its own (`@luke/features/contract`), so a bundle that
 * reads the contract resolves no service code behind it.
 */

import { accountContract } from "./account.js";
import { adminContract } from "./admin.js";
import { agentBrowserTabsContract } from "./agent-browser-tabs.js";
import { agentPagesContract } from "./agent-pages.js";
import { agentPullRequestsContract } from "./agent-pull-requests.js";
import { agentsContract } from "./agents.js";
import { automationsContract } from "./automations.js";
import { channelsContract } from "./channels.js";
import { dictationContract } from "./dictation.js";
import { eventsContract } from "./events.js";
import { githubContract } from "./github.js";
import { githubTokenContract } from "./github-token.js";
import { inboxContract } from "./inbox.js";
import { installedSkillsContract } from "./installed-skills.js";
import { integrationsContract } from "./integrations.js";
import { liveContract } from "./live.js";
import { macCommandsContract } from "./mac-commands.js";
import { messagesContract } from "./messages.js";
import { modelsContract } from "./models.js";
import { planCommentsContract } from "./plan-comments.js";
import { pullRequestChaptersContract } from "./pull-request-chapters.js";
import { repositoryPinsContract } from "./repository-pins.js";
import { taskFilesContract } from "./task-files.js";
import { taskSectionsContract } from "./task-sections.js";
import { tasksContract } from "./tasks.js";
import { workspaceGithubContract } from "./workspace-github.js";
import { workspaceInvitationsContract } from "./workspace-invitations.js";
import { workspaceLinearContract } from "./workspace-linear.js";
import { workspaceSentryContract } from "./workspace-sentry.js";
import { workspacesContract } from "./workspaces.js";

export { AGENT_START_STATUS } from "./agents.js";
export { bodyCap, getBodyCap } from "./base.js";
export { HOSTED_ERRORS } from "./errors.js";
export { EVENTS_MAXIMUM_BODY_BYTES } from "./events.js";
export { integrationStatusesReadSchema } from "./integrations.js";
export { TASK_START_STATUS } from "./tasks.js";

/** Every resource's procedures, one line each, in alphabetical order. */
export const hostedContract = {
  account: accountContract,
  admin: adminContract,
  agentBrowserTabs: agentBrowserTabsContract,
  agentPages: agentPagesContract,
  agentPullRequests: agentPullRequestsContract,
  agents: agentsContract,
  automations: automationsContract,
  channels: channelsContract,
  dictation: dictationContract,
  events: eventsContract,
  github: githubContract,
  githubToken: githubTokenContract,
  inbox: inboxContract,
  installedSkills: installedSkillsContract,
  integrations: integrationsContract,
  live: liveContract,
  macCommands: macCommandsContract,
  messages: messagesContract,
  models: modelsContract,
  planComments: planCommentsContract,
  plans: tasksContract,
  pullRequestChapters: pullRequestChaptersContract,
  repositoryPins: repositoryPinsContract,
  taskFiles: taskFilesContract,
  taskSections: taskSectionsContract,
  workspaceGithub: workspaceGithubContract,
  workspaceInvitations: workspaceInvitationsContract,
  workspaceLinear: workspaceLinearContract,
  workspaceSentry: workspaceSentryContract,
  workspaces: workspacesContract,
};

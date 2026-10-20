/**
 * router.ts -- every implemented hosted resource, merged into the one router the web route serves.
 *
 * The seams are the deployment's: the resolvers a caller middleware reads,
 * handed in by the route so a test can hand in its own.
 */

import { type AccountProcedureSeams, accountProcedures } from "../accounts/account-procedures.js";
import { type ModelsProcedureSeams, modelsProcedures } from "../accounts/models-procedures.js";
import {
  type WorkspaceGithubProcedureSeams,
  workspaceGithubProcedures,
} from "../accounts/workspace-github-procedures.js";
import {
  type WorkspaceInvitationsProcedureSeams,
  workspaceInvitationsProcedures,
} from "../accounts/workspace-invitations-procedures.js";
import {
  type WorkspacesProcedureSeams,
  workspacesProcedures,
} from "../accounts/workspaces-procedures.js";
import {
  type AgentPullRequestProcedureSeams,
  agentPullRequestProcedures,
} from "../agents/agent-pull-request-procedures.js";
import { type AgentsProcedureSeams, agentsProcedures } from "../agents/agents-procedures.js";
import { instancePublishedCache } from "../agents/coder-host/published.js";
import { type MessagesProcedureSeams, messagesProcedures } from "../agents/messages-procedures.js";
import {
  type AutomationsProcedureSeams,
  automationsProcedures,
} from "../automations/automations-procedures.js";
import {
  type DictationProcedureSeams,
  dictationProcedures,
} from "../dictation/dictation-procedures.js";
import {
  type FactoryProcedureSeams,
  factoryProcedures,
} from "../factory/factory-world-procedures.js";
import { type GitHubProcedureSeams, githubProcedures } from "../github/github-procedures.js";
import {
  type RepositoryPinsProcedureSeams,
  repositoryPinsProcedures,
} from "../github/repository-pins-procedures.js";
import { type InboxProcedureSeams, inboxProcedures } from "../inbox/inbox-procedures.js";
import {
  type IntegrationsProcedureSeams,
  integrationsProcedures,
} from "../integrations/integrations-procedures.js";
import {
  type WorkspaceLinearProcedureSeams,
  workspaceLinearProcedures,
} from "../integrations/workspace-linear-procedures.js";
import { type IssuesProcedureSeams, issuesProcedures } from "../issues/issues-procedures.js";
import {
  type PlanCommentsProcedureSeams,
  planCommentsProcedures,
} from "../tasks/plan-comments-procedures.js";
import {
  type TaskFilesProcedureSeams,
  taskFilesProcedures,
} from "../tasks/task-files-procedures.js";
import {
  type TaskSectionsProcedureSeams,
  taskSectionsProcedures,
} from "../tasks/task-sections-procedures.js";
import { type TasksProcedureSeams, tasksProcedures } from "../tasks/tasks-procedures.js";
import { hosted } from "./base.js";

/** What the resources ask of the deployment: one line per resource, in alphabetical order. */
export type HostedRouterSeams = AccountProcedureSeams &
  AgentPullRequestProcedureSeams &
  AgentsProcedureSeams &
  AutomationsProcedureSeams &
  DictationProcedureSeams &
  FactoryProcedureSeams &
  GitHubProcedureSeams &
  InboxProcedureSeams &
  IntegrationsProcedureSeams &
  IssuesProcedureSeams &
  MessagesProcedureSeams &
  ModelsProcedureSeams &
  PlanCommentsProcedureSeams &
  RepositoryPinsProcedureSeams &
  TaskFilesProcedureSeams &
  TaskSectionsProcedureSeams &
  TasksProcedureSeams &
  WorkspaceGithubProcedureSeams &
  WorkspaceInvitationsProcedureSeams &
  WorkspaceLinearProcedureSeams &
  WorkspacesProcedureSeams;

/** The hosted router: one line per resource, in alphabetical order. */
export function hostedRouter(seams: HostedRouterSeams) {
  // One cache of the kept published answers for every resource that reads them or lets them go.
  const published = { ...seams, published: instancePublishedCache() };
  return hosted.router({
    account: accountProcedures(seams),
    agentPullRequests: agentPullRequestProcedures(published),
    agents: agentsProcedures(published),
    automations: automationsProcedures(seams),
    dictation: dictationProcedures(seams),
    factory: factoryProcedures(seams),
    github: githubProcedures(seams),
    inbox: inboxProcedures(seams),
    integrations: integrationsProcedures(seams),
    issues: issuesProcedures(seams),
    messages: messagesProcedures(seams),
    models: modelsProcedures(seams),
    planComments: planCommentsProcedures(seams),
    plans: tasksProcedures(seams),
    repositoryPins: repositoryPinsProcedures(seams),
    taskFiles: taskFilesProcedures(seams),
    taskSections: taskSectionsProcedures(seams),
    workspaceGithub: workspaceGithubProcedures(seams),
    workspaceInvitations: workspaceInvitationsProcedures(seams),
    workspaceLinear: workspaceLinearProcedures(seams),
    workspaces: workspacesProcedures(seams),
  });
}

/**
 * index.ts -- the hosted service's oRPC contract, one key per resource.
 *
 * A subpath door of its own (`@luke/features/contract`), so a bundle that
 * reads the contract resolves no service code behind it.
 */

import { accountContract } from "./account.js";
import { automationsContract } from "./automations.js";
import { dictationContract } from "./dictation.js";
import { factoryContract } from "./factory.js";
import { githubContract } from "./github.js";
import { integrationsContract } from "./integrations.js";
import { issuesContract } from "./issues.js";
import { messagesContract } from "./messages.js";
import { modelsContract } from "./models.js";
import { repositoryPinsContract } from "./repository-pins.js";
import { taskSectionsContract } from "./task-sections.js";
import { tasksContract } from "./tasks.js";
import { workspaceGithubContract } from "./workspace-github.js";
import { workspaceInvitationsContract } from "./workspace-invitations.js";
import { workspaceLinearContract } from "./workspace-linear.js";
import { workspacesContract } from "./workspaces.js";

export { HOSTED_ERRORS } from "./errors.js";
export { integrationStatusesReadSchema } from "./integrations.js";
export { ISSUE_ARCHIVED_QUERY } from "./issues.js";
export { TASK_START_STATUS } from "./tasks.js";

/** Every resource's procedures, one line each, in alphabetical order. */
export const hostedContract = {
  account: accountContract,
  automations: automationsContract,
  dictation: dictationContract,
  factory: factoryContract,
  github: githubContract,
  integrations: integrationsContract,
  issues: issuesContract,
  messages: messagesContract,
  models: modelsContract,
  plans: tasksContract,
  repositoryPins: repositoryPinsContract,
  taskSections: taskSectionsContract,
  workspaceGithub: workspaceGithubContract,
  workspaceInvitations: workspaceInvitationsContract,
  workspaceLinear: workspaceLinearContract,
  workspaces: workspacesContract,
};

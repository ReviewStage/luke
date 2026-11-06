import { githubContract } from "./contract/github.js";
import { workspaceGithubContract } from "./contract/workspace-github.js";
import { workspaceInvitationsContract } from "./contract/workspace-invitations.js";
import { workspaceSentryContract } from "./contract/workspace-sentry.js";
import { workspaceSlackBotContract } from "./contract/workspace-slack-bot.js";
import { workspacesContract } from "./contract/workspaces.js";
import { failureSetOf } from "./hosted-failure.js";
import { HOSTED_API_ERROR } from "./service-wire.js";
import type { TaskCallResult } from "./task-client.js";

/**
 * workspace-call.ts -- why a workspace call did not happen, and the result a call answers.
 *
 * Its own module, apart from the client, so the tasks view, which the
 * window reads, takes the words without taking the client and the account
 * call behind it into the window's bundle. The words are derived from the
 * refusals the workspace procedures declare (`hosted-failure.ts`), each
 * spelled as its slug but the slug's, which shipped without their
 * `workspace-` prefix.
 */

/** The failures a workspace call shipped under a spelling other than its refusal's slug. */
export const WORKSPACE_RENAMES = {
  [HOSTED_API_ERROR.WORKSPACE_SLUG_MALFORMED]: "slug-malformed",
  [HOSTED_API_ERROR.WORKSPACE_SLUG_RESERVED]: "slug-reserved",
  [HOSTED_API_ERROR.WORKSPACE_SLUG_TAKEN]: "slug-taken",
} as const;

/** The procedures a workspace call asks: every workspace group's, and the GitHub group's two over a workspace's token repositories. */
export const WORKSPACE_CALLS = {
  workspaces: workspacesContract,
  workspaceInvitations: workspaceInvitationsContract,
  workspaceGithub: workspaceGithubContract,
  workspaceSentry: workspaceSentryContract,
  workspaceSlackBot: workspaceSlackBotContract,
  tokenRepositories: githubContract.tokenRepositories,
  setTokenRepository: githubContract.setTokenRepository,
};

/** Why a workspace call did not happen: a refusal one of its procedures declares, or no answer (`unanswered`). */
export const WORKSPACE_CALL_FAILURE = failureSetOf(WORKSPACE_CALLS, { as: WORKSPACE_RENAMES });

export type WorkspaceCallFailure =
  (typeof WORKSPACE_CALL_FAILURE)[keyof typeof WORKSPACE_CALL_FAILURE];

/** One workspace call's answer, or why there is none. */
export type WorkspaceCallResult<Answer> = TaskCallResult<Answer, WorkspaceCallFailure>;

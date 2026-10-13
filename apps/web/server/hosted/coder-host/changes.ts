import type { CodingAgent } from "@sidecar/database/models/coding-agent-store";
import {
  CHANGES_UNAVAILABLE,
  type CodingAgentChangesAnswer,
  type CodingAgentPullRequestAnswer,
} from "@sidecar/hosted/coding-agent-wire";
import { Effect } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import { GitHubApp, type GitHubUserReadFailure } from "../../github/github-app.js";
import { pullRequestFiles } from "../../github/pull-requests.js";

/**
 * changes.ts -- a coding agent's changes, as a changes tab reads them: the files of the pull request it published, as GitHub lists them now.
 *
 * Which pull request is the agent's is what its published answer says
 * (`published.ts`), which the route reads through its kept answers; an
 * agent with none has no changes to read yet, which the answer says rather
 * than reading as a pull request that changed nothing. The files are read
 * on the developer's own token (`github/pull-requests.ts`), every read
 * afresh, since a tab asks for them when it is shown and when the
 * developer asks again, not beside every page of a held transcript.
 *
 * The agent's sandbox is no source here: nothing outside its own session
 * reaches it, it is stopped between turns, and its diff is not kept in the
 * store, so it waits on a way to read the sandbox live.
 */

/**
 * The pull request's changes as GitHub lists them now, read at `readAt`,
 * for the pull request the agent's published answer names, or why there
 * are none where it names none.
 */
export const pullRequestChanges = /* @__PURE__ */ Effect.fn("web/pullRequestChanges")(function* (
  userId: string,
  agent: CodingAgent,
  published: CodingAgentPullRequestAnswer,
  readAt: number,
): Effect.fn.Return<
  CodingAgentChangesAnswer,
  GitHubUserReadFailure,
  SqlClient.SqlClient | HttpClient.HttpClient | GitHubApp
> {
  const pullRequest = published.pullRequest;
  if (pullRequest === null) return { unavailable: CHANGES_UNAVAILABLE.NO_PULL_REQUEST };
  const app = yield* GitHubApp;
  const token = yield* app.userToken(userId);
  const listed = yield* pullRequestFiles(token, agent.repository, pullRequest);
  return { changes: { files: listed.files, truncated: listed.truncated, readAt } };
});

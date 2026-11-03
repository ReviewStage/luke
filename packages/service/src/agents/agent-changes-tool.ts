/**
 * agent-changes-tool.ts -- `read_agent_changes`: what an agent of the caller's workspace published, its pull request and the files it changes, as the agent's Pull request and Changes tabs read them.
 *
 * The agent is found as `read_agent` finds it (`workspaceAgentOf`), on the
 * caller's member's standing now, so an agent of another workspace, even one
 * the member is also in, is none. What it published is the branch and pull
 * request its row holds as GitHub holds them now (`agentPublished`), its
 * state and checks among it, which the Pull request tab reads
 * (`GET /api/agents/{id}/pull-request`); its files, reviewers, and reviews
 * that said something are read afresh on a token minted for its repository
 * (`pullRequestChangesRead`), as the Changes tab reads them
 * (`GET /api/agents/{id}/changes`). Each file is named with what became of
 * it and the lines it adds and removes, without its patch, since a pull
 * request's patches together may run to millions of characters; one file the
 * call names by its path is answered with its patch beside, cut on a line
 * to a bound. A GitHub that did not answer, or a repository the workspace's
 * installation no longer reaches, is refused in the model's words, never
 * answered as no pull request.
 */

import { hasRepository } from "@repo/database/models/agent-store";
import { describeWire } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import {
  ACTION_RESULT_STATUS,
  HOSTED_API_ERROR,
  type UnparsedWireValue,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import {
  AGENT_TOOL_REFUSAL,
  type AgentReadCall,
  type AgentToolServices,
  agentToolRejected,
  callerUserId,
  cutOnLine,
  orStoreRefusal,
  workspaceAgentOf,
} from "./agent-tools.js";
import { pullRequestChangesRead } from "./agents-procedures.js";
import { githubReadRefusal } from "./asked-pull-request.js";
import { agentPublished, agentPullRequestReach } from "./coder-host/published.js";

/** The name the tool is offered under. */
export const READ_AGENT_CHANGES = "read_agent_changes";

/** The most characters of one file's patch a read answers, about ten thousand tokens: the rest is counted, never sent. */
const PATCH_READ_CHARS = 40_000;

/** Why a read answered nothing, in words the model can act on. */
const READ_AGENT_CHANGES_REFUSAL = {
  UNREADABLE:
    `Not read: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered, and a path, if ` +
    "any, as files names it.",
  NO_FILE:
    "Not read: that agent's pull request changes no file at that path; leave path out to list " +
    "the files it changes.",
  NOT_REACHABLE:
    "Not read: the GitHub installation connected to the workspace no longer reaches that " +
    "agent's repository.",
  UNANSWERED:
    "Not read: GitHub could not be asked about that agent's pull request just now. The call " +
    "may be made again.",
} as const;

/** A read names the agent and, at most, one file whose patch to answer beside the list. */
export const READ_AGENT_CHANGES_INPUT = Schema.Struct({
  agentId: describeWire(
    wireUuidSchema,
    `The agent's id, as ${AGENT_TOOL.LIST_AGENTS} answered it.`,
  ),
  path: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(4_096)),
      "One file the pull request changes, by its path from the repository's root as files " +
        "names it, to read its patch as well; leave it out to list the files alone.",
    ),
  ),
});

const readChangesAsked = Schema.decodeUnknownResult(READ_AGENT_CHANGES_INPUT);

/** A read of GitHub that did not land, in the model's words: the repository out of the installation's reach, or GitHub or the store not answering. */
function unreadWords(error: string): string {
  return error === HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE
    ? READ_AGENT_CHANGES_REFUSAL.NOT_REACHABLE
    : READ_AGENT_CHANGES_REFUSAL.UNANSWERED;
}

/** One call of `read_agent_changes`: the agent's published branch and pull request, the files it changes, and the patch of the one file named, or why there is none. */
export function runReadAgentChanges(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readChangesAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(READ_AGENT_CHANGES_REFUSAL.UNREADABLE));
  }
  const { agentId, path } = asked.success;
  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(call.caller, agentId);
      if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
      const { agent } = found.value;
      const userId = callerUserId(call.caller);
      const published = yield* Effect.result(githubReadRefusal(agentPublished(userId, agent)));
      if (Result.isFailure(published)) {
        return agentToolRejected(unreadWords(published.failure.error));
      }
      const { repository, branch, pullRequest } = published.success;
      if (pullRequest === null || !hasRepository(agent)) {
        return { status: ACTION_RESULT_STATUS.ACCEPTED, repository, branch, pullRequest: null };
      }
      const read = yield* Effect.result(
        githubReadRefusal(
          Effect.gen(function* () {
            const { token } = yield* agentPullRequestReach(userId, agent);
            return yield* pullRequestChangesRead(token, agent, pullRequest);
          }),
        ),
      );
      if (Result.isFailure(read)) return agentToolRejected(unreadWords(read.failure.error));
      const { files, truncated, reviewers, comments, writtenAs } = read.success;
      const named = path === undefined ? undefined : files.find((file) => file.path === path);
      if (path !== undefined && named === undefined) {
        return agentToolRejected(READ_AGENT_CHANGES_REFUSAL.NO_FILE);
      }
      const patch = named?.patch == null ? undefined : cutOnLine(named.patch, PATCH_READ_CHARS);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        repository,
        branch,
        pullRequest: {
          ...pullRequest,
          ...(writtenAs === undefined ? undefined : { writtenAs }),
          files: files.map((file) => ({
            path: file.path,
            previousPath: file.previousPath,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
          })),
          truncated,
          ...(reviewers === undefined
            ? undefined
            : {
                reviewers: reviewers.map((reviewer) => ({ ...reviewer, by: { ...reviewer.by } })),
              }),
          ...(comments === undefined
            ? undefined
            : { comments: comments.map((comment) => ({ ...comment, by: { ...comment.by } })) }),
        },
        // The file named, with its patch cut to the bound, or why GitHub carried none.
        ...(named === undefined
          ? undefined
          : {
              file: {
                path: named.path,
                patch: patch?.text ?? null,
                omitted: named.omitted,
                leftOutChars: patch?.leftOutChars ?? 0,
              },
            }),
      };
    }),
  );
}

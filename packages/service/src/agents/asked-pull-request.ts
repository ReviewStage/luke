import { type Agent, forgetAgentPublishedRead } from "@repo/database/models/agent-store";
import { AGENT_STATUS, type AgentAuthor, type AgentPullRequest } from "@repo/features/agent-wire";
import { githubPullRequestNumberSchema } from "@repo/features/github-repositories-wire";
import { readEither } from "@repo/wire/effect";
import { Cache, Effect, Result } from "effect";
import { unparsedWire } from "../core.js";
import type { GitHubWorkspaceReadFailure } from "../github/github-app.js";
import { githubReadOrRefusal } from "../github/github-refusal.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import {
  agentPullRequestOfNumber,
  type PublishedCache,
  PublishedKey,
} from "./coder-host/published.js";
import { statusOf } from "./coder-host/stop.js";

export interface PullRequestSubject {
  readonly organizationId: string;
  readonly repository: string;
  readonly author: AgentAuthor | null;
}

type GitHubAskFailure = GitHubWorkspaceReadFailure | { readonly _tag: "RepositoryNotReachable" };

export function githubReadRefusal<A, R>(
  effect: Effect.Effect<A, GitHubAskFailure, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return Effect.catch(effect, (failure) => {
    switch (failure._tag) {
      case "RepositoryNotReachable":
        return Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
      case "SqlError":
      case "EffectDrizzleQueryError":
      case "SchemaError":
        return hostedStoreOrUnavailable(Effect.fail(failure));
      default:
        return githubReadOrRefusal(Effect.fail(failure));
    }
  });
}

const keptPublished = /* @__PURE__ */ Effect.fnUntraced(function* (
  published: PublishedCache,
  userId: string,
  agent: Agent,
) {
  const status = yield* statusOf(agent);
  const ended = status !== AGENT_STATUS.STARTING && status !== AGENT_STATUS.RUNNING;
  return yield* Cache.get(published, new PublishedKey({ userId, agentId: agent.id, ended })).pipe(
    Effect.catch((failure) =>
      failure._tag === "NoSuchAgent"
        ? Effect.fail(HOSTED_REFUSAL.NOT_FOUND)
        : githubReadRefusal(Effect.fail(failure)),
    ),
  );
});

export const pullRequestNumberOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  named: readonly string[],
): Effect.fn.Return<number | undefined, HostedRefusal> {
  if (named.length === 0) return undefined;
  const read =
    named.length === 1
      ? readEither(githubPullRequestNumberSchema)(unparsedWire(Number(named[0])))
      : undefined;
  if (read === undefined || Result.isFailure(read)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return read.success;
});

export const askedPublished = /* @__PURE__ */ Effect.fnUntraced(function* (
  published: PublishedCache,
  userId: string,
  agent: Agent,
  number: number | undefined,
) {
  if (number === undefined) return yield* keptPublished(published, userId, agent);
  return yield* agentPullRequestOfNumber(userId, agent, number).pipe(githubReadRefusal);
});

export const askedPullRequest = (
  published: PublishedCache,
  userId: string,
  agent: Agent,
  number: number | undefined,
) =>
  Effect.map(
    askedPublished(published, userId, agent, number),
    (answer): AgentPullRequest | null => answer.pullRequest,
  );

export const forgetPublished = (published: PublishedCache, userId: string, agentId: string) =>
  Effect.flatMap(Cache.keys(published), (keys) =>
    Effect.forEach(
      [...keys].filter((key) => key.agentId === agentId),
      (key) => Cache.invalidate(published, key),
      { discard: true },
    ),
  ).pipe(
    Effect.andThen(forgetAgentPublishedRead(userId, agentId).pipe(Effect.catch(logStoreFailure))),
  );

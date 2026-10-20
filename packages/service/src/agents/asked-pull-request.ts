/**
 * asked-pull-request.ts -- which pull request a read or a change of an agent's Pull request tab is about.
 *
 * The agent's own, from the instance's kept published answers, or the pull
 * request of its repository the request names by its number, read afresh,
 * as a tab showing a pull request other than the agent's own asks. Shared
 * by the route group's changes read (`coding-agents-app.ts`) and the tab's
 * procedures (`agent-pull-request-procedures.ts`), each failure answered as
 * the refusal a route answers.
 */

import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import { CODING_AGENT_STATUS, type CodingAgentPullRequest } from "@luke/features/coding-agent-wire";
import { githubPullRequestNumberSchema } from "@luke/features/github-repositories-wire";
import { readEither } from "@luke/wire/effect";
import { Cache, Effect, Result } from "effect";
import { unparsedWire } from "../core.js";
import { githubReadOrRefusal } from "../github/github-refusal.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import {
  agentPullRequestOfNumber,
  type PublishedCache,
  PublishedKey,
} from "./coder-host/published.js";
import { statusOf } from "./coder-host/stop.js";

/** What the agent published, from the instance's kept answers, its failures as the refusals a route answers. */
const keptPublished = /* @__PURE__ */ Effect.fnUntraced(function* (
  published: PublishedCache,
  userId: string,
  agent: CodingAgent,
) {
  // Whether the agent has ended is part of the key, so the first ask after its turn ends reads GitHub afresh.
  const status = yield* statusOf(agent);
  const ended = status !== CODING_AGENT_STATUS.STARTING && status !== CODING_AGENT_STATUS.RUNNING;
  return yield* Cache.get(published, new PublishedKey({ userId, agentId: agent.id, ended })).pipe(
    Effect.catch((failure) => {
      switch (failure._tag) {
        // The row stood a statement ago; an agent gone between the two is not found, as it would be on the next ask.
        case "NoSuchAgent":
          return Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
        case "RepositoryNotReachable":
          return Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
        case "SqlError":
        case "EffectDrizzleQueryError":
        case "SchemaError":
          return hostedStoreOrUnavailable(Effect.fail(failure));
        default:
          return githubReadOrRefusal(Effect.fail(failure));
      }
    }),
  );
});

/** The pull request number a request names under `number`, each value as the query spelled it: none where it names none; refused where it names one off the wire's shape or more than one. */
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

/**
 * What a read of the agent's Pull request tab is about: the pull request of
 * the agent's repository the request names by its number, read afresh, as a
 * tab showing a pull request other than the agent's own asks; else what the
 * agent published, from the instance's kept answers.
 */
export const askedPublished = /* @__PURE__ */ Effect.fnUntraced(function* (
  published: PublishedCache,
  userId: string,
  agent: CodingAgent,
  number: number | undefined,
) {
  if (number === undefined) return yield* keptPublished(published, userId, agent);
  return yield* agentPullRequestOfNumber(userId, agent, number).pipe(
    Effect.catch((failure) => {
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
    }),
  );
});

/** The pull request a read or a change of the agent's Pull request tab is about (`askedPublished`), null where there is none. */
export const askedPullRequest = (
  published: PublishedCache,
  userId: string,
  agent: CodingAgent,
  number: number | undefined,
) =>
  Effect.map(
    askedPublished(published, userId, agent, number),
    (answer): CodingAgentPullRequest | null => answer.pullRequest,
  );

/**
 * The instance's kept answers for the agent let go, every member's and on
 * either side of its end, so the next ask on this instance reads GitHub
 * afresh whoever asks. Note that another instance keeps its own for at most
 * `CODER.PUBLISHED_TTL`, as it keeps one past a change made on GitHub itself.
 */
export const forgetPublished = (published: PublishedCache, agentId: string) =>
  Effect.flatMap(Cache.keys(published), (keys) =>
    Effect.forEach(
      [...keys].filter((key) => key.agentId === agentId),
      (key) => Cache.invalidate(published, key),
      { discard: true },
    ),
  );

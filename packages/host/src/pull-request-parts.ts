/**
 * pull-request-parts.ts -- the parts of each agent's pull request the windows' Pull request tabs hold, fetched while held and asked again together as the pull request moves.
 *
 * A Pull request tab holds four reads of its pull request: the pull request
 * itself, its checks, its conversation, and what the agent published, each
 * by the agent and then the pull request's number, or `OWN_PULL_REQUEST`
 * for the agent's own, which the service resolves from the agent's branch.
 * Each is a fetch the host holds (`heldFetch`), asked as a window first
 * holds it, as a window comes forward, and on its own Try again. Every part
 * a window holds of one pull request is asked again together as its agent's
 * status moves, which is how its end is heard, or as the task list's line
 * for it moves: its state, checks, merge queue, or head commit, which a
 * push moves. Note that the line is found by the pull request's address,
 * from the pull request part's own answer, or from the agent's listed pull
 * request for its own, so a pull request no agent of the list published,
 * or one not answered yet, is asked again on nothing but focus and Try
 * again. A part whose ask fails after one answered keeps that answer, as a
 * fetch the host holds does; one that fails before any answered holds the
 * failure, so its tab says why.
 */

import {
  type AgentOverviewChecksAnswerView,
  type AgentOverviewConversationAnswerView,
  type AgentOverviewPullRequestAnswerView,
  type AgentPullRequestAnswerView,
  PULL_REQUEST_PART,
  type PullRequestPart,
  type PullRequestPartParams,
} from "@repo/features/agent-view";
import type { AgentPullRequest, AgentStatus } from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import type { ListedPullRequest } from "@repo/features/task-wire";
import { Data, Effect, FiberMap, MutableHashMap, Option, type Scope, Stream } from "effect";
import { type AppPullRequestParts, NO_KEYS_HELD, OWN_PULL_REQUEST } from "./app-state.js";
import { type HeldFetch, heldFetch } from "./held-fetch.js";
import type { WindowFocus } from "./window-focus.js";

/** Whose part: one agent's pull request, by the agent's id and the number its tab names, none for the agent's own. */
export class PullRequestKey extends Data.Class<{
  readonly agentId: string;
  readonly number: number | undefined;
}> {}

/** The task list as the parts read it: each agent's status, and each pull request it names, by the agent that published it. */
export interface PullRequestListing {
  readonly statuses: ReadonlyMap<string, AgentStatus>;
  readonly pullRequests: readonly ListedPullRequest[];
}

export interface PullRequestPartsDependencies {
  /** Whether the account gate stands open, so a part may be asked. */
  readonly gate: () => boolean;
  readonly focus: WindowFocus;
  /** One ask of each part of `key`'s pull request: what the service answered, or why there is none. */
  readonly ask: {
    readonly pullRequest: (
      key: PullRequestKey,
    ) => Effect.Effect<AgentOverviewPullRequestAnswerView>;
    readonly checks: (key: PullRequestKey) => Effect.Effect<AgentOverviewChecksAnswerView>;
    readonly conversation: (
      key: PullRequestKey,
    ) => Effect.Effect<AgentOverviewConversationAnswerView>;
    readonly published: (key: PullRequestKey) => Effect.Effect<AgentPullRequestAnswerView>;
  };
  /** The task list each time it is drawn, from the caller's listening on. */
  readonly listings: Effect.Effect<Stream.Stream<PullRequestListing>, never, Scope.Scope>;
  readonly tell: (held: Partial<AppPullRequestParts>) => void;
}

/** The parts the windows hold, and what the host does for them. */
export interface PullRequestParts {
  /** Holds one part for the windows until let go, asking it where no window held it; holding it again holds nothing anew. */
  readonly follow: (params: PullRequestPartParams) => Effect.Effect<void>;
  /** Lets one part go, kept a while among those let go lately. */
  readonly unfollow: (params: PullRequestPartParams) => Effect.Effect<void>;
  /** Asks one held part again at once, as Try again asks; answers once that ask has landed. */
  readonly retry: (params: PullRequestPartParams) => Effect.Effect<void>;
  /** Follows every held part anew, as the account gate opening asks. */
  readonly open: Effect.Effect<void>;
  /** Lets every part go and tells none held: the session ended. */
  readonly end: Effect.Effect<void>;
}

/** One part's fetch as the windows' holds, Try again, and the list's moves reach it, whatever it holds. */
type PartFetch = Omit<HeldFetch<PullRequestKey, unknown>, "answered">;

/** Where a key's part stands on its slice: under the agent, then the pull request's number, or the agent's own. */
function pathOf(key: PullRequestKey): readonly [string, string] {
  return [key.agentId, key.number === undefined ? OWN_PULL_REQUEST : String(key.number)];
}

function keyOf(params: PullRequestPartParams): PullRequestKey {
  return new PullRequestKey({ agentId: params.agentId, number: params.number });
}

/** What a part holds after an ask: the answer, but where it failed over an answer the part already held, nothing, so that answer stands. */
function keptOver<Answer extends object>(
  answer: Answer,
  held: Answer | undefined,
): Option.Option<Answer> {
  if (!("failure" in answer)) return Option.some(answer);
  return held !== undefined && !("failure" in held) ? Option.none() : Option.some(answer);
}

/** Whether the list says a pull request moved: its state, checks, merge queue, or head. */
function lineMoved(before: AgentPullRequest, after: AgentPullRequest | undefined): boolean {
  return (
    after === undefined ||
    after.state !== before.state ||
    after.checks !== before.checks ||
    after.queued !== before.queued ||
    after.headSha !== before.headSha
  );
}

/** Each pull request the list names, by its address, the first line naming it where several do. */
function linesOf(listing: PullRequestListing): ReadonlyMap<string, AgentPullRequest> {
  const lines = new Map<string, AgentPullRequest>();
  for (const { pullRequest } of listing.pullRequests) {
    if (!lines.has(pullRequest.url)) lines.set(pullRequest.url, pullRequest);
  }
  return lines;
}

/** What moved from one drawing of the list to the next: the agents whose status moved, and the addresses of the pull requests whose line moved or left. */
function movedOf(
  before: PullRequestListing,
  after: PullRequestListing,
): { readonly agents: ReadonlySet<string>; readonly urls: ReadonlySet<string> } {
  const agents = new Set<string>();
  for (const [agentId, status] of before.statuses) {
    if (after.statuses.get(agentId) !== status) agents.add(agentId);
  }
  const urls = new Set<string>();
  const afterLines = linesOf(after);
  for (const [url, line] of linesOf(before)) {
    if (lineMoved(line, afterLines.get(url))) urls.add(url);
  }
  return { agents, urls };
}

/** The parts of the pull requests the windows hold, for as long as the scope that made them stands. */
export function pullRequestParts(
  dependencies: PullRequestPartsDependencies,
): Effect.Effect<PullRequestParts, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { gate, focus, ask, tell } = dependencies;
    /** Each held pull request's address, as its pull request part last answered it. */
    const urls = MutableHashMap.empty<PullRequestKey, string>();
    const pullRequest = yield* heldFetch<typeof LIVE_READ.PULL_REQUEST, PullRequestKey>({
      empty: NO_KEYS_HELD,
      path: pathOf,
      gate,
      focus,
      fetch: (key, held) =>
        Effect.map(ask.pullRequest(key), (answer) => {
          if (!("failure" in answer) && answer.pullRequest !== null) {
            MutableHashMap.set(urls, key, answer.pullRequest.url);
          }
          return keptOver(answer, held);
        }),
      tell: (held) => tell({ [LIVE_READ.PULL_REQUEST]: held }),
    });
    const checks = yield* heldFetch<typeof LIVE_READ.PULL_REQUEST_CHECKS, PullRequestKey>({
      empty: NO_KEYS_HELD,
      path: pathOf,
      gate,
      focus,
      fetch: (key, held) => Effect.map(ask.checks(key), (answer) => keptOver(answer, held)),
      tell: (held) => tell({ [LIVE_READ.PULL_REQUEST_CHECKS]: held }),
    });
    const conversation = yield* heldFetch<
      typeof LIVE_READ.PULL_REQUEST_CONVERSATION,
      PullRequestKey
    >({
      empty: NO_KEYS_HELD,
      path: pathOf,
      gate,
      focus,
      fetch: (key, held) => Effect.map(ask.conversation(key), (answer) => keptOver(answer, held)),
      tell: (held) => tell({ [LIVE_READ.PULL_REQUEST_CONVERSATION]: held }),
    });
    const published = yield* heldFetch<typeof LIVE_READ.PULL_REQUEST_PUBLISHED, PullRequestKey>({
      empty: NO_KEYS_HELD,
      path: pathOf,
      gate,
      focus,
      fetch: (key, held) => Effect.map(ask.published(key), (answer) => keptOver(answer, held)),
      tell: (held) => tell({ [LIVE_READ.PULL_REQUEST_PUBLISHED]: held }),
    });
    const fetches: { readonly [Part in PullRequestPart]: PartFetch } = {
      [PULL_REQUEST_PART.PULL_REQUEST]: pullRequest,
      [PULL_REQUEST_PART.CHECKS]: checks,
      [PULL_REQUEST_PART.CONVERSATION]: conversation,
      [PULL_REQUEST_PART.PUBLISHED]: published,
    };
    const holds: { readonly [Part in PullRequestPart]: FiberMap.FiberMap<PullRequestKey> } = {
      [PULL_REQUEST_PART.PULL_REQUEST]: yield* FiberMap.make<PullRequestKey>(),
      [PULL_REQUEST_PART.CHECKS]: yield* FiberMap.make<PullRequestKey>(),
      [PULL_REQUEST_PART.CONVERSATION]: yield* FiberMap.make<PullRequestKey>(),
      [PULL_REQUEST_PART.PUBLISHED]: yield* FiberMap.make<PullRequestKey>(),
    };
    const every = Object.values(fetches);

    /** The address a key's pull request is listed by: its pull request part's answer, or for the agent's own, the pull request the list says it published. */
    const urlOf = (key: PullRequestKey, listing: PullRequestListing): string | undefined =>
      Option.getOrUndefined(MutableHashMap.get(urls, key)) ??
      (key.number === undefined
        ? listing.pullRequests.find((listed) => listed.agentId === key.agentId)?.pullRequest.url
        : undefined);

    // Note that the first drawing asks nothing, since nothing moved yet that a part was read before.
    let before: PullRequestListing | undefined;
    const heard = (listing: PullRequestListing) =>
      Effect.suspend(() => {
        const was = before;
        before = listing;
        if (was === undefined) return Effect.void;
        const moved = movedOf(was, listing);
        if (moved.agents.size === 0 && moved.urls.size === 0) return Effect.void;
        const named = (key: PullRequestKey) => {
          if (moved.agents.has(key.agentId)) return true;
          const url = urlOf(key, was);
          return url !== undefined && moved.urls.has(url);
        };
        return Effect.forEach(every, (fetch) => fetch.wake(named), { discard: true });
      });
    yield* Effect.forkScoped(Stream.runForEach(yield* dependencies.listings, heard));

    return {
      follow: (params) =>
        Effect.asVoid(
          FiberMap.run(
            holds[params.part],
            keyOf(params),
            Effect.scoped(Effect.andThen(fetches[params.part].hold(keyOf(params)), Effect.never)),
            { onlyIfMissing: true },
          ),
        ),
      unfollow: (params) => FiberMap.remove(holds[params.part], keyOf(params)),
      retry: (params) => fetches[params.part].retry(keyOf(params)),
      open: Effect.forEach(every, (fetch) => fetch.open, { discard: true }),
      end: Effect.forEach(every, (fetch) => fetch.end, { discard: true }),
    };
  });
}

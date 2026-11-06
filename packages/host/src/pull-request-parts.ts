import {
  type AgentOverviewChecksAnswerView,
  type AgentOverviewConversationAnswerView,
  type AgentOverviewPullRequestAnswerView,
  type AgentPullRequestAnswerView,
  type AgentPullRequestViewedAnswerView,
  type AgentReviewOptionsAnswerView,
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

export class PullRequestKey extends Data.Class<{
  readonly agentId: string;
  readonly number: number | undefined;
}> {}

export interface PullRequestListing {
  readonly statuses: ReadonlyMap<string, AgentStatus>;
  readonly pullRequests: readonly ListedPullRequest[];
}

export interface PullRequestPartsDependencies {
  readonly gate: () => boolean;
  readonly focus: WindowFocus;
  readonly ask: {
    readonly pullRequest: (
      key: PullRequestKey,
    ) => Effect.Effect<AgentOverviewPullRequestAnswerView>;
    readonly checks: (key: PullRequestKey) => Effect.Effect<AgentOverviewChecksAnswerView>;
    readonly conversation: (
      key: PullRequestKey,
    ) => Effect.Effect<AgentOverviewConversationAnswerView>;
    readonly published: (key: PullRequestKey) => Effect.Effect<AgentPullRequestAnswerView>;
    readonly reviewOptions: (key: PullRequestKey) => Effect.Effect<AgentReviewOptionsAnswerView>;
    readonly viewed: (key: PullRequestKey) => Effect.Effect<AgentPullRequestViewedAnswerView>;
  };
  readonly listings: Effect.Effect<Stream.Stream<PullRequestListing>, never, Scope.Scope>;
  readonly tell: (held: Partial<AppPullRequestParts>) => void;
}

export interface PullRequestParts {
  readonly follow: (params: PullRequestPartParams) => Effect.Effect<void>;
  readonly unfollow: (params: PullRequestPartParams) => Effect.Effect<void>;
  readonly retry: (params: PullRequestPartParams) => Effect.Effect<void>;
  readonly open: Effect.Effect<void>;
  readonly end: Effect.Effect<void>;
}

type PartFetch = Omit<HeldFetch<PullRequestKey, unknown>, "answered">;

function pathOf(key: PullRequestKey): readonly [string, string] {
  return [key.agentId, key.number === undefined ? OWN_PULL_REQUEST : String(key.number)];
}

function keyOf(params: PullRequestPartParams): PullRequestKey {
  return new PullRequestKey({ agentId: params.agentId, number: params.number });
}

function keptOver<Answer extends object>(
  answer: Answer,
  held: Answer | undefined,
): Option.Option<Answer> {
  if (!("failure" in answer)) return Option.some(answer);
  return held !== undefined && !("failure" in held) ? Option.none() : Option.some(answer);
}

function lineMoved(before: AgentPullRequest, after: AgentPullRequest | undefined): boolean {
  return (
    after === undefined ||
    after.state !== before.state ||
    after.checks !== before.checks ||
    after.queued !== before.queued ||
    after.headSha !== before.headSha
  );
}

function linesOf(listing: PullRequestListing): ReadonlyMap<string, AgentPullRequest> {
  const lines = new Map<string, AgentPullRequest>();
  for (const { pullRequest } of listing.pullRequests) {
    if (!lines.has(pullRequest.url)) lines.set(pullRequest.url, pullRequest);
  }
  return lines;
}

function movedOf(
  before: PullRequestListing,
  after: PullRequestListing,
): {
  readonly agents: ReadonlySet<string>;
  readonly opened: ReadonlySet<string>;
  readonly urls: ReadonlySet<string>;
  readonly heads: ReadonlySet<string>;
} {
  const agents = new Set<string>();
  for (const [agentId, status] of before.statuses) {
    if (after.statuses.get(agentId) !== status) agents.add(agentId);
  }
  const opened = new Set<string>();
  for (const { agentId, pullRequest } of after.pullRequests) {
    const was = before.pullRequests.find((listed) => listed.agentId === agentId);
    if (was?.pullRequest.url !== pullRequest.url) opened.add(agentId);
  }
  const urls = new Set<string>();
  const heads = new Set<string>();
  const afterLines = linesOf(after);
  for (const [url, line] of linesOf(before)) {
    const now = afterLines.get(url);
    if (lineMoved(line, now)) urls.add(url);
    if (now?.headSha !== line.headSha) heads.add(url);
  }
  return { agents, opened, urls, heads };
}

export function pullRequestParts(
  dependencies: PullRequestPartsDependencies,
): Effect.Effect<PullRequestParts, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { gate, focus, ask, tell } = dependencies;
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
      fetch: (key, held) =>
        Effect.map(ask.published(key), (answer) => {
          if (!("failure" in answer) && answer.pullRequest !== null) {
            MutableHashMap.set(urls, key, answer.pullRequest.url);
          }
          return keptOver(answer, held);
        }),
      tell: (held) => tell({ [LIVE_READ.PULL_REQUEST_PUBLISHED]: held }),
    });
    const reviewOptions = yield* heldFetch<typeof LIVE_READ.REVIEW_OPTIONS, PullRequestKey>({
      empty: NO_KEYS_HELD,
      path: pathOf,
      gate,
      focus,
      fetch: (key, held) => Effect.map(ask.reviewOptions(key), (answer) => keptOver(answer, held)),
      tell: (held) => tell({ [LIVE_READ.REVIEW_OPTIONS]: held }),
    });
    const viewed = yield* heldFetch<typeof LIVE_READ.PULL_REQUEST_VIEWED, PullRequestKey>({
      empty: NO_KEYS_HELD,
      path: pathOf,
      gate,
      focus,
      fetch: (key) => Effect.map(ask.viewed(key), Option.some),
      tell: (held) => tell({ [LIVE_READ.PULL_REQUEST_VIEWED]: held }),
    });
    const fetches: { readonly [Part in PullRequestPart]: PartFetch } = {
      [PULL_REQUEST_PART.PULL_REQUEST]: pullRequest,
      [PULL_REQUEST_PART.CHECKS]: checks,
      [PULL_REQUEST_PART.CONVERSATION]: conversation,
      [PULL_REQUEST_PART.PUBLISHED]: published,
      [PULL_REQUEST_PART.REVIEW_OPTIONS]: reviewOptions,
      [PULL_REQUEST_PART.VIEWED]: viewed,
    };
    const holds: { readonly [Part in PullRequestPart]: FiberMap.FiberMap<PullRequestKey> } = {
      [PULL_REQUEST_PART.PULL_REQUEST]: yield* FiberMap.make<PullRequestKey>(),
      [PULL_REQUEST_PART.CHECKS]: yield* FiberMap.make<PullRequestKey>(),
      [PULL_REQUEST_PART.CONVERSATION]: yield* FiberMap.make<PullRequestKey>(),
      [PULL_REQUEST_PART.PUBLISHED]: yield* FiberMap.make<PullRequestKey>(),
      [PULL_REQUEST_PART.REVIEW_OPTIONS]: yield* FiberMap.make<PullRequestKey>(),
      [PULL_REQUEST_PART.VIEWED]: yield* FiberMap.make<PullRequestKey>(),
    };
    const every = Object.values(fetches);
    const moving: readonly PartFetch[] = [pullRequest, checks, conversation, published];

    const urlOf = (key: PullRequestKey, listing: PullRequestListing): string | undefined =>
      Option.getOrUndefined(MutableHashMap.get(urls, key)) ??
      (key.number === undefined
        ? listing.pullRequests.find((listed) => listed.agentId === key.agentId)?.pullRequest.url
        : undefined);

    let before: PullRequestListing | undefined;
    const heard = (listing: PullRequestListing) =>
      Effect.suspend(() => {
        const was = before;
        before = listing;
        if (was === undefined) return Effect.void;
        const moved = movedOf(was, listing);
        if (moved.agents.size === 0 && moved.opened.size === 0 && moved.urls.size === 0) {
          return Effect.void;
        }
        const named = (key: PullRequestKey) => {
          if (moved.agents.has(key.agentId)) return true;
          if (key.number === undefined && moved.opened.has(key.agentId)) return true;
          const url = urlOf(key, was);
          return url !== undefined && moved.urls.has(url);
        };
        const pushed = (key: PullRequestKey) => {
          const url = urlOf(key, was);
          return url !== undefined && moved.heads.has(url);
        };
        return Effect.andThen(
          Effect.forEach(moving, (fetch) => fetch.wake(named), { discard: true }),
          viewed.wake(pushed),
        );
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

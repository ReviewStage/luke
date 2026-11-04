import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  type PullRequestChaptersLiveAnswer,
  pullRequestChaptersOfLive,
} from "@repo/features/pull-request-chapters-live";
import type { PullRequestChaptersAnswer } from "@repo/features/pull-request-chapters-wire";
import { Data, Effect, Option, type Scope } from "effect";
import { type AppChapters, NO_CHAPTERS } from "./app-state.js";
import { type HeldAnswers, type HeldSlice, heldSlice } from "./live-collection.js";
import { pushLive } from "./live-push.js";

/**
 * chapters-follow.ts -- each agent's pull request's chapters the windows hold, followed over the service's held poll and told whole on their app-state slice.
 *
 * A Pull request tab holds its pull request's chapters by the agent and the
 * number its own read of the pull request found, and the host follows them
 * while any window holds them and a while after (`heldSlice`), so another
 * member's claim, finish, or failure draws on every open view within the
 * service's coalesce window, with no Refresh. The service answers whether
 * the reader can generate chapters beside the rows on every answer, since
 * it comes from the reader's own keys, which no statement reads, so the
 * follow draws it anew from each answer rather than only the first.
 */

/** Whose chapters: one agent's pull request, by the agent's id and the pull request's number. */
export class ChaptersKey extends Data.Class<{
  readonly agentId: string;
  readonly number: number;
}> {}

/** A read the service did not answer, as the client and the gate tell it. */
interface ChaptersUnanswered {
  readonly failure: string;
}

export interface ChaptersFollowDependencies {
  /** The read of `key` sealed for `userId`, its rows inline at the poll address where it polls, held past `after` where it names one. */
  readonly seal: (
    key: ChaptersKey,
    poll: boolean,
    userId: string,
    after?: string,
  ) => Effect.Effect<PullRequestChaptersLiveAnswer | ChaptersUnanswered>;
  /** The account signed in, which every seal names; none while nobody is. */
  readonly accountId: () => string | undefined;
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  readonly tell: (held: AppChapters) => void;
}

/** A refusal that names nothing the account reaches, after which the read is followed no longer. */
function goneAfter(failure: string): boolean {
  return failure === AGENT_CALL_FAILURE.NOT_FOUND || failure === LIVE_SIGNED_OUT.failure;
}

/**
 * Follows `key`'s chapters live until let go, each change told through
 * `answers`: the newest claim as the agent's read answers it, with whether
 * the reader can generate them as the latest answer says. Note that an
 * answer whose rows stand carries no rows, so a change to whether the
 * reader can generate is drawn as the answer is sealed, over the rows last
 * taken.
 */
function followChapters(
  dependencies: ChaptersFollowDependencies,
  key: ChaptersKey,
  answers: HeldAnswers<PullRequestChaptersAnswer>,
): Effect.Effect<void> {
  // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
  const userId = dependencies.accountId();
  let rows: readonly unknown[] | undefined;
  let generatable: boolean | undefined;
  const draw = () => {
    if (rows === undefined || generatable === undefined) return;
    const drawn = pullRequestChaptersOfLive(rows, key.number, generatable);
    if ("failure" in drawn) answers.unanswered();
    else answers.answered(drawn);
  };
  return pushLive({
    seal: (poll, after) =>
      dependencies.gate() && userId !== undefined
        ? Effect.map(dependencies.seal(key, poll, userId, after), (sealed) => {
            if ("failure" in sealed) {
              return { failure: sealed.failure, gone: goneAfter(sealed.failure) };
            }
            if (sealed.generatable !== generatable) {
              generatable = sealed.generatable;
              draw();
            }
            return sealed;
          })
        : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
    decode: (parts) => Option.some(parts.chapters),
    publish: (chapters) => {
      if (chapters === undefined) return answers.unanswered();
      rows = chapters;
      draw();
    },
  });
}

/**
 * The held lifetime over every agent's pull request's chapters the windows
 * hold (`heldSlice`), told whole on their slice: each key's read as its
 * follow last told it, kept where a later read does not answer, and failed
 * where it never answered; one the service refused for good, an agent the
 * account does not reach, is told failed and followed no longer until every
 * window lets it go and one holds it anew.
 */
export function heldChapters(
  dependencies: ChaptersFollowDependencies,
): Effect.Effect<HeldSlice<ChaptersKey>, never, Scope.Scope> {
  return heldSlice<typeof LIVE_READ.PULL_REQUEST_CHAPTERS, ChaptersKey>({
    empty: NO_CHAPTERS,
    path: (key) => [key.agentId, String(key.number)],
    gate: dependencies.gate,
    follow: (key, answers) => followChapters(dependencies, key, answers),
    tell: dependencies.tell,
  });
}

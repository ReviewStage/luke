import type { PullRequestChaptersReadParams } from "@repo/features/pull-request-chapters-view";
import { Effect, MutableHashMap, Stream } from "effect";
import { CHAPTERS_ACT_KIND } from "../contract/index.js";
import { actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

/**
 * chapters-procedures.ts -- a coding agent's Pull request tab's hold on a pull request's chapters, followed and read again.
 *
 * The one check these procedures make is who asked: only a panel draws the
 * Pull request tab, so the takeover and any other window are refused
 * in each one's own sentence. A pull request's chapters are held followed
 * while a panel holds their stream open: the host holds them on the first
 * stream and lets them go with the last, and what it holds reaches every
 * panel on app state, never down the stream, which carries nothing. How many
 * streams stand open of each is all that is held here. A Generate is
 * declared (`contract/chapters.ts`) and answered by the agents' composer.
 */
export interface ChaptersProceduresDependencies {
  host: {
    /** A pull request's chapters held followed at the host while any stream of them stands; what it holds reaches the panel on app state. */
    chaptersFollow(params: PullRequestChaptersReadParams): Effect.Effect<void>;
    chaptersUnfollow(params: PullRequestChaptersReadParams): Effect.Effect<void>;
    /** A pull request's held chapters read again at once, as Try again asks. */
    chaptersRetry(params: PullRequestChaptersReadParams): Effect.Effect<void>;
  };
}

export function chaptersProcedures(dependencies: ChaptersProceduresDependencies) {
  const { host } = dependencies;
  /** Every pull request's chapters a window holds a stream open of, so the host lets them go only with the last. */
  const openChapters: OpenFollows<PullRequestChaptersReadParams> = MutableHashMap.empty();
  return {
    [CHAPTERS_ACT_KIND.CHAPTERS_FOLLOW]: actPort[CHAPTERS_ACT_KIND.CHAPTERS_FOLLOW].effect(
      function* ({ input, context, errors }) {
        if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
        const hold = followedStream(
          {
            keyOf: (params: PullRequestChaptersReadParams) => ({
              agentId: params.agentId,
              number: params.number,
            }),
            follow: host.chaptersFollow,
            unfollow: host.chaptersUnfollow,
          },
          openChapters,
          input,
        );
        return streamed(yield* Stream.toAsyncIterableEffect(hold));
      },
    ),
    [CHAPTERS_ACT_KIND.CHAPTERS_RETRY]: actPort[CHAPTERS_ACT_KIND.CHAPTERS_RETRY].effect(
      function* ({ input, context, errors }) {
        if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
        yield* host.chaptersRetry(input);
      },
    ),
  };
}

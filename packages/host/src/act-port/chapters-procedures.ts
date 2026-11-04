import type {
  ChaptersModelAnswerView,
  ChaptersModelWriteParams,
  PullRequestChaptersAnswerView,
  PullRequestChaptersParams,
  PullRequestChaptersReadParams,
} from "@repo/features/pull-request-chapters-view";
import { Effect, MutableHashMap, Option, Stream } from "effect";
import { CHAPTERS_ACT_KIND } from "../contract/index.js";
import { actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

/**
 * chapters-procedures.ts -- a coding agent's Pull request tab's asks of the host about a pull request's chapters: hold them, read them again, or generate them; and Settings' read and write of the model the member's Generate runs on.
 *
 * The one check these procedures make is who asked: only a panel draws the
 * Pull request tab and Settings, so the takeover and any other window are refused
 * in each one's own sentence. A pull request's chapters are held followed
 * while a panel holds their stream open: the host holds them on the first
 * stream and lets them go with the last, and what it holds reaches every
 * panel on app state, never down the stream, which carries nothing. How many
 * streams stand open of each is all that is held here. What the service
 * answers a Generate comes back as the panel's own answer, or why there is
 * none.
 */
export interface ChaptersProceduresDependencies {
  host: {
    /** A pull request's chapters held followed at the host while any stream of them stands; what it holds reaches the panel on app state. */
    chaptersFollow(params: PullRequestChaptersReadParams): Effect.Effect<void>;
    chaptersUnfollow(params: PullRequestChaptersReadParams): Effect.Effect<void>;
    /** A pull request's held chapters read again at once, as Try again asks. */
    chaptersRetry(params: PullRequestChaptersReadParams): Effect.Effect<void>;
    pullRequestChaptersGenerate(
      params: PullRequestChaptersParams,
    ): Effect.Effect<PullRequestChaptersAnswerView>;
    chaptersModelWrite(params: ChaptersModelWriteParams): Effect.Effect<ChaptersModelAnswerView>;
  };
}

export function chaptersProcedures(dependencies: ChaptersProceduresDependencies) {
  const { host } = dependencies;
  /** Every pull request's chapters a window holds a stream open of, so the host lets them go only with the last. */
  const openChapters: OpenFollows<never, PullRequestChaptersReadParams> = MutableHashMap.empty();
  return {
    [CHAPTERS_ACT_KIND.CHAPTERS_FOLLOW]: actPort[CHAPTERS_ACT_KIND.CHAPTERS_FOLLOW].effect(
      function* ({ input, context, errors }) {
        if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
        // Note that nothing is heard down the hold, since the held chapters reach the panel on app state.
        const hold = followedStream(
          {
            keyOf: (params: PullRequestChaptersReadParams) => ({
              agentId: params.agentId,
              number: params.number,
            }),
            follow: host.chaptersFollow,
            unfollow: host.chaptersUnfollow,
            onChanged: () => () => undefined,
            valueOf: () => Option.none<never>(),
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
    [CHAPTERS_ACT_KIND.CHAPTERS_GENERATE]: actPort[CHAPTERS_ACT_KIND.CHAPTERS_GENERATE].effect(
      function* ({ input, context, errors }) {
        if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
        return yield* host.pullRequestChaptersGenerate(input);
      },
    ),
    [CHAPTERS_ACT_KIND.CHAPTERS_MODEL_WRITE]: actPort[
      CHAPTERS_ACT_KIND.CHAPTERS_MODEL_WRITE
    ].effect(function* ({ input, context, errors }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.chaptersModelWrite(input);
    }),
  };
}

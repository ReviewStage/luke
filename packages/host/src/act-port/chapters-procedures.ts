import type {
  PullRequestChaptersAnswerView,
  PullRequestChaptersParams,
  PullRequestChaptersReadParams,
} from "@repo/features/pull-request-chapters-view";
import { Effect, MutableHashMap, Option, Stream } from "effect";
import { CHAPTERS_ACT_KIND } from "../contract/index.js";
import { actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

export interface ChaptersProceduresDependencies {
  host: {
    chaptersFollow(params: PullRequestChaptersReadParams): Effect.Effect<void>;
    chaptersUnfollow(params: PullRequestChaptersReadParams): Effect.Effect<void>;
    chaptersRetry(params: PullRequestChaptersReadParams): Effect.Effect<void>;
    pullRequestChaptersGenerate(
      params: PullRequestChaptersParams,
    ): Effect.Effect<PullRequestChaptersAnswerView>;
  };
}

export function chaptersProcedures(dependencies: ChaptersProceduresDependencies) {
  const { host } = dependencies;
  const openChapters: OpenFollows<never, PullRequestChaptersReadParams> = MutableHashMap.empty();
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
  };
}

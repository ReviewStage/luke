import type {
  PullRequestChaptersAnswerView,
  PullRequestChaptersParams,
} from "@luke/features/pull-request-chapters-view";
import { Effect } from "effect";
import { CHAPTERS_ACT_KIND } from "../contract/index.js";
import { actPort } from "./base.js";

/**
 * chapters-procedures.ts -- a coding agent's Pull request tab's asks of the host about a pull request's chapters: read them, or generate them.
 *
 * The one check these procedures make is who asked: only a panel draws the
 * Pull request tab, so the takeover and the hidden voice window are refused
 * in each one's own sentence. What the service answers comes back as the
 * panel's own answer, or why there is none. Nothing is held here.
 */
export interface ChaptersProceduresDependencies {
  host: {
    pullRequestChapters(
      params: PullRequestChaptersParams,
    ): Effect.Effect<PullRequestChaptersAnswerView>;
    pullRequestChaptersGenerate(
      params: PullRequestChaptersParams,
    ): Effect.Effect<PullRequestChaptersAnswerView>;
  };
}

export function chaptersProcedures(dependencies: ChaptersProceduresDependencies) {
  const { host } = dependencies;
  return {
    [CHAPTERS_ACT_KIND.CHAPTERS_READ]: actPort[CHAPTERS_ACT_KIND.CHAPTERS_READ].effect(function* ({
      input,
      context,
      errors,
    }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.pullRequestChapters(input);
    }),
    [CHAPTERS_ACT_KIND.CHAPTERS_GENERATE]: actPort[CHAPTERS_ACT_KIND.CHAPTERS_GENERATE].effect(
      function* ({ input, context, errors }) {
        if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
        return yield* host.pullRequestChaptersGenerate(input);
      },
    ),
  };
}

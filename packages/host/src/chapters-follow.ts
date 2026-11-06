import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  type ChaptersGenerator,
  type PullRequestChaptersLiveAnswer,
  pullRequestChaptersOfLive,
  sameGenerator,
} from "@repo/features/pull-request-chapters-live";
import type { PullRequestChaptersAnswer } from "@repo/features/pull-request-chapters-wire";
import { Data, Effect, Option, type Scope } from "effect";
import { type AppChapters, NO_CHAPTERS } from "./app-state.js";
import { type HeldAnswers, type HeldSlice, heldSlice } from "./live-collection.js";
import { pushLive } from "./live-push.js";

export class ChaptersKey extends Data.Class<{
  readonly agentId: string;
  readonly number: number;
}> {}

interface ChaptersUnanswered {
  readonly failure: string;
}

export interface ChaptersFollowDependencies {
  readonly seal: (
    key: ChaptersKey,
    poll: boolean,
    userId: string,
    after?: string,
  ) => Effect.Effect<PullRequestChaptersLiveAnswer | ChaptersUnanswered>;
  readonly accountId: () => string | undefined;
  readonly gate: () => boolean;
  readonly tell: (held: AppChapters) => void;
}

function goneAfter(failure: string): boolean {
  return failure === AGENT_CALL_FAILURE.NOT_FOUND || failure === LIVE_SIGNED_OUT.failure;
}

function followChapters(
  dependencies: ChaptersFollowDependencies,
  key: ChaptersKey,
  answers: HeldAnswers<PullRequestChaptersAnswer>,
): Effect.Effect<void> {
  const userId = dependencies.accountId();
  let rows: readonly unknown[] | undefined;
  let generator: ChaptersGenerator | undefined;
  const draw = () => {
    if (rows === undefined || generator === undefined) return;
    const drawn = pullRequestChaptersOfLive(rows, key.number, generator);
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
            if (generator === undefined || !sameGenerator(sealed, generator)) {
              generator = sealed;
              draw();
            }
            return sealed;
          })
        : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
    decode: (parts) => Option.some(parts.chapters),
    publish: (chapters) =>
      Effect.sync(() => {
        if (chapters === undefined) return answers.unanswered();
        rows = chapters;
        draw();
      }),
  });
}

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

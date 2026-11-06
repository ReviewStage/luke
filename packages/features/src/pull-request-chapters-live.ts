import { Schema as EffectSchema, Option } from "effect";
import { sealedLiveQuerySchema } from "./live-wire.js";
import { chapterSchema } from "./pull-request-chapters.js";
import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
} from "./pull-request-chapters-view.js";
import {
  chaptersRunsOnSchema,
  PULL_REQUEST_CHAPTERS_FAILURE_KIND,
  PULL_REQUEST_CHAPTERS_STATE,
  type PullRequestChaptersAnswer,
  type PullRequestChaptersState,
} from "./pull-request-chapters-wire.js";
import { countedNumber } from "./service-wire.js";

export const pullRequestChaptersLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ chapters: sealedLiveQuerySchema }),
  generatable: EffectSchema.Boolean,
  runsOn: EffectSchema.optionalKey(chaptersRunsOnSchema),
});

export type PullRequestChaptersLiveAnswer = typeof pullRequestChaptersLiveAnswerSchema.Type;

export type ChaptersGenerator = Pick<
  NonNullable<PullRequestChaptersAnswer["pullRequest"]>,
  "generatable" | "runsOn"
>;

export function sameGenerator(a: ChaptersGenerator, b: ChaptersGenerator): boolean {
  return (
    a.generatable === b.generatable &&
    a.runsOn?.provider === b.runsOn?.provider &&
    a.runsOn?.model === b.runsOn?.model
  );
}

const commitSchema = EffectSchema.NonEmptyString;

const chaptersLiveRowSchema = EffectSchema.Union([
  EffectSchema.Struct({
    status: EffectSchema.Literal(PULL_REQUEST_CHAPTERS_STATE.GENERATING),
    headSha: commitSchema,
    baseSha: commitSchema,
    startedAt: countedNumber,
  }),
  EffectSchema.Struct({
    status: EffectSchema.Literal(PULL_REQUEST_CHAPTERS_STATE.FAILED),
    headSha: commitSchema,
    baseSha: commitSchema,
    failureKind: EffectSchema.NullOr(
      EffectSchema.Literals(Object.values(PULL_REQUEST_CHAPTERS_FAILURE_KIND)),
    ),
  }),
  EffectSchema.Struct({
    status: EffectSchema.Literal(PULL_REQUEST_CHAPTERS_STATE.READY),
    headSha: commitSchema,
    baseSha: commitSchema,
    model: EffectSchema.NullOr(EffectSchema.String),
    chapters: EffectSchema.Array(chapterSchema),
  }),
]);

type ChaptersLiveRow = typeof chaptersLiveRowSchema.Type;

const readRows = EffectSchema.decodeUnknownOption(EffectSchema.Array(chaptersLiveRowSchema));

const UNAVAILABLE: PullRequestChaptersAnswerView = {
  failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNAVAILABLE,
};

function stateOf(row: ChaptersLiveRow | undefined): PullRequestChaptersState | undefined {
  if (row === undefined) return { status: PULL_REQUEST_CHAPTERS_STATE.NONE };
  const { headSha, baseSha } = row;
  switch (row.status) {
    case PULL_REQUEST_CHAPTERS_STATE.GENERATING:
      return { status: row.status, headSha, baseSha, startedAt: row.startedAt };
    case PULL_REQUEST_CHAPTERS_STATE.FAILED:
      return {
        status: row.status,
        headSha,
        baseSha,
        failureKind: row.failureKind ?? PULL_REQUEST_CHAPTERS_FAILURE_KIND.UNEXPECTED,
      };
    case PULL_REQUEST_CHAPTERS_STATE.READY:
      if (row.model === null || row.model === "") return undefined;
      return { status: row.status, headSha, baseSha, model: row.model, chapters: row.chapters };
  }
}

export function pullRequestChaptersOfLive(
  rows: readonly unknown[],
  number: number,
  generator: ChaptersGenerator,
): PullRequestChaptersAnswerView {
  const read = readRows(rows);
  if (Option.isNone(read)) return UNAVAILABLE;
  const chapters = stateOf(read.value[0]);
  if (chapters === undefined) return UNAVAILABLE;
  const { generatable, runsOn } = generator;
  return {
    pullRequest: { number, generatable, ...(runsOn === undefined ? {} : { runsOn }), chapters },
  };
}

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

/**
 * pull-request-chapters-live.ts -- a pull request's chapters as the host follows them over the service's held poll: the statement the service answers, and the answer its row makes.
 *
 * The service answers one statement, the workspace's newest claim of the
 * pull request an agent's Pull request tab names, as one row or none, with
 * whether the reader can generate chapters at all, and on what, beside it,
 * which no statement can carry since it comes from the reader's own keys. The row is
 * drawn into the same answer the agent's read gives
 * (`pullRequestChaptersAnswerSchema`), its stored chapters decoded with
 * their wire schema, so a row off its own shape is drawn as unavailable,
 * as the read answers one.
 */

/**
 * A pull request's chapters sealed for following: the address, the one
 * statement of its newest claim, and whether the reader can generate them
 * on a key of their own, and on which model and whose key, absent from a
 * service older than it. Asked to poll, the service answers the
 * statement's rows inline instead (`LIVE_POLL`).
 */
export const pullRequestChaptersLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ chapters: sealedLiveQuerySchema }),
  generatable: EffectSchema.Boolean,
  runsOn: EffectSchema.optionalKey(chaptersRunsOnSchema),
});

export type PullRequestChaptersLiveAnswer = typeof pullRequestChaptersLiveAnswerSchema.Type;

/** What the reader's Generate stands on, as a sealed answer carries it beside its statement. */
export type ChaptersGenerator = Pick<
  NonNullable<PullRequestChaptersAnswer["pullRequest"]>,
  "generatable" | "runsOn"
>;

/** Whether two answers' readers stand on the same Generate, so a change between them is drawn. */
export function sameGenerator(a: ChaptersGenerator, b: ChaptersGenerator): boolean {
  return (
    a.generatable === b.generatable &&
    a.runsOn?.provider === b.runsOn?.provider &&
    a.runsOn?.model === b.runsOn?.model
  );
}

/** A git commit's name, as GitHub spells it. */
const commitSchema = EffectSchema.NonEmptyString;

/**
 * The newest claim as its row delivers it, by where its generation stands,
 * each reading only the columns its state draws. Note that a ready row's
 * model may be null here, which the answer refuses rather than the decode,
 * as the read does.
 */
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

/** What the answer is where the row is off its own shape, as the read answers one. */
const UNAVAILABLE: PullRequestChaptersAnswerView = {
  failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNAVAILABLE,
};

/** The newest claim as the wire's state of the chapters; none for a ready row without its model, which the store never writes. */
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

/**
 * The pull request numbered as the reader named it, with its newest
 * chapters as the live statement's rows stand and whether the reader can
 * generate them, and on what, as the agent's read answers it; unavailable
 * where a row is off its own shape.
 */
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

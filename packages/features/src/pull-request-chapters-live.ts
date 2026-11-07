import { Schema as EffectSchema, Option } from "effect";
import { refuses } from "./contract/base.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  type LiveRowOf,
  liveRead,
  liveRows,
  ORDER,
} from "./live-read.js";
import { LIVE_READ, LIVE_USER_QUERY } from "./live-wire.js";
import { chapterSchema } from "./pull-request-chapters.js";
import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
} from "./pull-request-chapters-view.js";
import {
  type ChaptersRunsOn,
  chaptersRunsOnSchema,
  PULL_REQUEST_CHAPTERS_FAILURE_KIND,
  PULL_REQUEST_CHAPTERS_STATE,
  type PullRequestChaptersAnswer,
  type PullRequestChaptersState,
} from "./pull-request-chapters-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber, HOSTED_API_ERROR } from "./service-wire.js";

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

/** A git commit's name, as GitHub spells it. */
const commitSchema = EffectSchema.NonEmptyString;

/**
 * The newest claim as its row delivers it: where its generation stands, and
 * every column a state draws, each null where its state keeps none. Note
 * that a ready row's model or chapters may be null here, which the answer
 * refuses rather than the decode, as the read does.
 */
const chaptersLiveRowSchema = EffectSchema.Struct({
  status: EffectSchema.Literals([
    PULL_REQUEST_CHAPTERS_STATE.GENERATING,
    PULL_REQUEST_CHAPTERS_STATE.FAILED,
    PULL_REQUEST_CHAPTERS_STATE.READY,
  ]),
  headSha: commitSchema,
  baseSha: commitSchema,
  failureKind: EffectSchema.NullOr(
    EffectSchema.Literals(Object.values(PULL_REQUEST_CHAPTERS_FAILURE_KIND)),
  ),
  model: EffectSchema.NullOr(EffectSchema.String),
  chapters: EffectSchema.NullOr(EffectSchema.Array(chapterSchema)),
  startedAt: countedNumber,
});

/**
 * One coding agent's pull request's chapters as its Pull request tab
 * follows them: one part, the workspace's newest claim of the pull request
 * the agent under `?id=` names, numbered under `&number=`, as one row or
 * none, and whether the reader can generate them on a key of their own,
 * and on which model and whose key, beside it, absent from a service older
 * than it. The service refuses a number of no shape as `invalid-request`,
 * and answers `not-found` for an agent the account does not reach. Asked to
 * poll, it answers the statement's rows inline instead (`LIVE_POLL`).
 */
export const PULL_REQUEST_CHAPTERS_READ = liveRead({
  name: LIVE_READ.PULL_REQUEST_CHAPTERS,
  path: HOSTED_SERVICE_PATH.LIVE_PULL_REQUEST_CHAPTERS,
  params: {
    id: LIVE_PARAM.ID,
    number: LIVE_PARAM.TEXT,
    workspaceId: LIVE_PARAM.SERVED,
    [LIVE_USER_QUERY]: LIVE_PARAM.USER,
  },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    chapters: liveRows({
      row: chaptersLiveRowSchema,
      key: "headSha",
      order: [["startedAt", ORDER.DESC]],
    }),
  },
  beside: {
    generatable: EffectSchema.Boolean,
    runsOn: EffectSchema.optionalKey(chaptersRunsOnSchema),
    runsOnChoices: EffectSchema.optionalKey(EffectSchema.Array(chaptersRunsOnSchema)),
  },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE),
});

export type PullRequestChaptersLiveAnswer = LiveReadAnswer<typeof PULL_REQUEST_CHAPTERS_READ>;

/** What the reader's Generate stands on, as a sealed answer carries it beside its statement. */
export type ChaptersGenerator = Pick<
  NonNullable<PullRequestChaptersAnswer["pullRequest"]>,
  "generatable" | "runsOn" | "runsOnChoices"
>;

/** Two models a Generate may run on as the same, by their provider and id. */
function sameRunsOn(a: ChaptersRunsOn | undefined, b: ChaptersRunsOn | undefined): boolean {
  return a?.provider === b?.provider && a?.model === b?.model;
}

/** Whether two answers' readers stand on the same Generate, so a change between them is drawn. */
export function sameGenerator(a: ChaptersGenerator, b: ChaptersGenerator): boolean {
  const choices = a.runsOnChoices ?? [];
  const others = b.runsOnChoices ?? [];
  return (
    a.generatable === b.generatable &&
    sameRunsOn(a.runsOn, b.runsOn) &&
    choices.length === others.length &&
    choices.every((choice, at) => sameRunsOn(choice, others[at]))
  );
}

type ChaptersLiveRow = LiveRowOf<typeof PULL_REQUEST_CHAPTERS_READ.parts.chapters>;

const readRows = EffectSchema.decodeUnknownOption(PULL_REQUEST_CHAPTERS_READ.rows.fields.chapters);

/** What the answer is where the row is off its own shape, as the read answers one. */
const UNAVAILABLE: PullRequestChaptersAnswerView = {
  failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNAVAILABLE,
};

/** The newest claim as the wire's state of the chapters; none for a ready row without its model or its chapters, which the store never writes. */
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
      if (row.model === null || row.model === "" || row.chapters === null) return undefined;
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
  const { generatable, runsOn, runsOnChoices } = generator;
  return {
    pullRequest: {
      number,
      generatable,
      ...(runsOn === undefined ? {} : { runsOn }),
      ...(runsOnChoices === undefined ? {} : { runsOnChoices }),
      chapters,
    },
  };
}

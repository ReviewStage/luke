/**
 * pull-request-chapters-store.ts -- a pull request's generated chapters, read by its workspace and made one generation at a time.
 *
 * A workspace keeps one row per head commit of a pull request
 * (`schemas/pull-request-chapters.ts`). The panel reads the newest claim of
 * the pull request whatever its head, so chapters made for an older head
 * still show, as stale, beside a Regenerate. A Generate claims the row for
 * its head in one statement: it inserts a `generating` row, or takes over the
 * one standing where it is `ready` or `failed` (a regenerate), or where it is
 * `generating` but was claimed longer ago than `CHAPTER_GENERATION_STALE_MS`
 * (a request that died); a row being generated within the bound answers
 * `busy`, so two Generates at once make one generation between them. Every
 * claim stamps a fresh `claim` on the row, and a finish or a failure lands
 * only on the row still holding the claim it names, so a writer whose
 * generation was taken over leaves the newer one standing. Every statement
 * names its workspace, and a row of another reads as none; whether the
 * reader may reach that workspace is the caller's to settle. Nothing here
 * reads a word of the chapters: they pass through as JSON, and the endpoint
 * decodes them with their wire schema.
 */

import { and, desc, eq, lt, ne, or, sql } from "drizzle-orm";
import { Effect, type Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import {
  PULL_REQUEST_CHAPTERS_FAILURE,
  PULL_REQUEST_CHAPTERS_STATUS,
  type PullRequestChaptersFailure,
  type PullRequestChaptersStatus,
} from "../pull-request-chapters-vocabulary.js";
import { pullRequestChapters } from "../schemas/pull-request-chapters.js";
import { InstantColumnSchema } from "./columns.js";

/**
 * How long a generation may stand `generating` before another Generate takes
 * it over as one whose request died: well past the generator's own deadline,
 * so a generation still running is never taken over, and short enough that a
 * member pressing Generate again after a crash waits minutes, not a day.
 */
export const CHAPTER_GENERATION_STALE_MS = 5 * 60_000;

/** What a Generate's claim answers: the row is this request's to generate, or another request is generating it now. */
export const CHAPTER_CLAIM_OUTCOME = {
  CLAIMED: "claimed",
  BUSY: "busy",
} as const;

/** The generation a claim took: the row, and the claim it holds, which its finish or failure names. */
export interface ChapterClaim {
  readonly id: string;
  readonly claim: string;
}

export type ChapterClaimAnswer =
  | { readonly outcome: typeof CHAPTER_CLAIM_OUTCOME.CLAIMED; readonly claim: ChapterClaim }
  | { readonly outcome: typeof CHAPTER_CLAIM_OUTCOME.BUSY };

/** A Generate pressed for one head commit of a pull request in a workspace. */
export interface ChapterGenerationRequest {
  readonly organizationId: string;
  /** The repository as `owner/name`. */
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  /** The member who pressed Generate. */
  readonly requestedBy: string;
  readonly now: Date;
}

/** A pull request's chapters as the store keeps them for one head commit. */
export interface PullRequestChapters {
  readonly id: string;
  readonly organizationId: string;
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly status: PullRequestChaptersStatus;
  /** Null unless `status` is `failed`. */
  readonly failureKind: PullRequestChaptersFailure | null;
  /** Null unless `status` is `ready`. */
  readonly model: string | null;
  /** The chapters as JSON, for the endpoint to decode with their wire schema; null unless `status` is `ready`. */
  readonly chapters: unknown;
  /** Null once the member's account is gone. */
  readonly requestedBy: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What a chapters store operation answers: an effect over the ambient client, composed into whatever called it. */
export type PullRequestChaptersEffect<A> = Effect.Effect<
  A,
  QueryError | Schema.SchemaError,
  DatabaseServices
>;

const ChaptersRowSchema = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  repository: Schema.String,
  pullRequestNumber: Schema.Number,
  baseSha: Schema.String,
  headSha: Schema.String,
  status: Schema.Literals(Object.values(PULL_REQUEST_CHAPTERS_STATUS)),
  failureKind: Schema.NullOr(Schema.Literals(Object.values(PULL_REQUEST_CHAPTERS_FAILURE))),
  model: Schema.NullOr(Schema.String),
  chapters: Schema.Unknown,
  requestedBy: Schema.NullOr(Schema.String),
  startedAt: InstantColumnSchema,
  finishedAt: Schema.NullOr(InstantColumnSchema),
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

const CHAPTERS_COLUMNS = {
  id: pullRequestChapters.id,
  organizationId: pullRequestChapters.organizationId,
  repository: pullRequestChapters.repository,
  pullRequestNumber: pullRequestChapters.pullRequestNumber,
  baseSha: pullRequestChapters.baseSha,
  headSha: pullRequestChapters.headSha,
  status: pullRequestChapters.status,
  failureKind: pullRequestChapters.failureKind,
  model: pullRequestChapters.model,
  chapters: pullRequestChapters.chapters,
  requestedBy: pullRequestChapters.requestedBy,
  startedAt: pullRequestChapters.startedAt,
  finishedAt: pullRequestChapters.finishedAt,
  createdAt: pullRequestChapters.createdAt,
  updatedAt: pullRequestChapters.updatedAt,
};

const ClaimRowSchema = Schema.Struct({ id: Schema.String, claim: Schema.String });

const findLatest = SqlSchema.findOneOption({
  Request: Schema.Struct({
    organizationId: Schema.String,
    repository: Schema.String,
    pullRequestNumber: Schema.Number,
  }),
  Result: ChaptersRowSchema,
  execute: ({ organizationId, repository, pullRequestNumber }) =>
    Database.use((db) =>
      db
        .select(CHAPTERS_COLUMNS)
        .from(pullRequestChapters)
        .where(
          and(
            eq(pullRequestChapters.organizationId, organizationId),
            eq(pullRequestChapters.repository, repository),
            eq(pullRequestChapters.pullRequestNumber, pullRequestNumber),
          ),
        )
        .orderBy(desc(pullRequestChapters.startedAt), desc(pullRequestChapters.createdAt))
        .limit(1),
    ),
});

const upsertClaim = SqlSchema.findAll({
  Request: Schema.Struct({
    organizationId: Schema.String,
    repository: Schema.String,
    pullRequestNumber: Schema.Number,
    baseSha: Schema.String,
    headSha: Schema.String,
    requestedBy: Schema.String,
    now: Schema.Date,
    staleBefore: Schema.Date,
  }),
  Result: ClaimRowSchema,
  execute: ({ staleBefore, now, ...request }) =>
    Database.use((db) =>
      db
        .insert(pullRequestChapters)
        .values({
          ...request,
          status: PULL_REQUEST_CHAPTERS_STATUS.GENERATING,
          startedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            pullRequestChapters.organizationId,
            pullRequestChapters.repository,
            pullRequestChapters.pullRequestNumber,
            pullRequestChapters.headSha,
          ],
          // A fresh claim and a clean slate: chapters, model, and failure stand only for the generation that wrote them.
          set: {
            baseSha: request.baseSha,
            status: PULL_REQUEST_CHAPTERS_STATUS.GENERATING,
            failureKind: null,
            model: null,
            chapters: null,
            claim: sql`excluded.claim`,
            requestedBy: request.requestedBy,
            startedAt: now,
            finishedAt: null,
            updatedAt: now,
          },
          // Note that a conflicting claim waits on the row's lock and reads it again after, so of two at once the second sees the first's fresh claim.
          setWhere: or(
            ne(pullRequestChapters.status, PULL_REQUEST_CHAPTERS_STATUS.GENERATING),
            lt(pullRequestChapters.startedAt, staleBefore),
          ),
        })
        .returning({ id: pullRequestChapters.id, claim: pullRequestChapters.claim }),
    ),
});

/** The row is still being generated under the claim named, which no later claim took over. */
function heldBy(id: string, claim: string) {
  return and(
    eq(pullRequestChapters.id, id),
    eq(pullRequestChapters.claim, claim),
    eq(pullRequestChapters.status, PULL_REQUEST_CHAPTERS_STATUS.GENERATING),
  );
}

/** The fields a generation's end writes, beside its status. */
const SettleSchema = Schema.Struct({
  id: Schema.String,
  claim: Schema.String,
  now: Schema.Date,
});

const settleReady = SqlSchema.findAll({
  Request: Schema.Struct({
    ...SettleSchema.fields,
    model: Schema.String,
    chapters: Schema.Unknown,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ id, claim, now, model, chapters }) =>
    Database.use((db) =>
      db
        .update(pullRequestChapters)
        .set({
          status: PULL_REQUEST_CHAPTERS_STATUS.READY,
          model,
          chapters,
          failureKind: null,
          finishedAt: now,
          updatedAt: now,
        })
        .where(heldBy(id, claim))
        .returning({ id: pullRequestChapters.id }),
    ),
});

const settleFailed = SqlSchema.findAll({
  Request: Schema.Struct({
    ...SettleSchema.fields,
    failureKind: Schema.Literals(Object.values(PULL_REQUEST_CHAPTERS_FAILURE)),
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ id, claim, now, failureKind }) =>
    Database.use((db) =>
      db
        .update(pullRequestChapters)
        .set({
          status: PULL_REQUEST_CHAPTERS_STATUS.FAILED,
          failureKind,
          model: null,
          chapters: null,
          finishedAt: now,
          updatedAt: now,
        })
        .where(heldBy(id, claim))
        .returning({ id: pullRequestChapters.id }),
    ),
});

/** The newest claim of the pull request in the workspace, whatever its head commit and status; none where it was never generated there. */
export function latestPullRequestChapters(
  organizationId: string,
  repository: string,
  pullRequestNumber: number,
): PullRequestChaptersEffect<Option.Option<PullRequestChapters>> {
  return findLatest({ organizationId, repository, pullRequestNumber });
}

/**
 * Claims the generation of the pull request's chapters for its head commit:
 * `claimed` with the claim to finish or fail it under, or `busy` where
 * another request claimed it less than `CHAPTER_GENERATION_STALE_MS` ago and
 * has not ended. Of any number of claims at once for one head, one is
 * `claimed`.
 */
export function claimChapterGeneration(
  request: ChapterGenerationRequest,
): PullRequestChaptersEffect<ChapterClaimAnswer> {
  const staleBefore = new Date(request.now.getTime() - CHAPTER_GENERATION_STALE_MS);
  return Effect.map(
    upsertClaim({ ...request, staleBefore }),
    ([claimed]): ChapterClaimAnswer =>
      claimed === undefined
        ? { outcome: CHAPTER_CLAIM_OUTCOME.BUSY }
        : { outcome: CHAPTER_CLAIM_OUTCOME.CLAIMED, claim: claimed },
  );
}

/** Lands a generation's chapters, answering whether its claim still held the row; a generation taken over writes nothing. */
export function finishChapterGeneration(
  claim: ChapterClaim,
  made: { readonly model: string; readonly chapters: unknown; readonly now: Date },
): PullRequestChaptersEffect<boolean> {
  return Effect.map(settleReady({ ...claim, ...made }), (rows) => rows.length > 0);
}

/** Records why a generation failed, answering whether its claim still held the row; a generation taken over writes nothing. */
export function failChapterGeneration(
  claim: ChapterClaim,
  failureKind: PullRequestChaptersFailure,
  now: Date,
): PullRequestChaptersEffect<boolean> {
  return Effect.map(settleFailed({ ...claim, failureKind, now }), (rows) => rows.length > 0);
}

import { and, desc, eq, sql } from "drizzle-orm";
import { Effect, type Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, type DatabaseServices, type QueryError, queryBuilder } from "../core/query.js";
import {
  PULL_REQUEST_CHAPTERS_FAILURE,
  PULL_REQUEST_CHAPTERS_STATUS,
  type PullRequestChaptersFailure,
  type PullRequestChaptersStatus,
} from "../pull-request-chapters-vocabulary.js";
import { agentTable } from "../schemas/agent.js";
import { pullRequestChapters } from "../schemas/pull-request-chapters.js";
import { InstantColumnSchema } from "./columns.js";
import { agentVisibleTo } from "./workspace-store.js";

export const CHAPTER_GENERATION_STALE_MS = 5 * 60_000;

export const CHAPTER_CLAIM_OUTCOME = {
  CLAIMED: "claimed",
  BUSY: "busy",
} as const;

export interface ChapterClaim {
  readonly id: string;
  readonly claim: string;
}

export type ChapterClaimAnswer =
  | { readonly outcome: typeof CHAPTER_CLAIM_OUTCOME.CLAIMED; readonly claim: ChapterClaim }
  | { readonly outcome: typeof CHAPTER_CLAIM_OUTCOME.BUSY };

export interface ChapterGenerationRequest {
  readonly organizationId: string;
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly requestedBy: string;
  readonly now: Date;
}

export interface PullRequestChapters {
  readonly id: string;
  readonly organizationId: string;
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly status: PullRequestChaptersStatus;
  readonly failureKind: PullRequestChaptersFailure | null;
  readonly model: string | null;
  readonly chapters: unknown;
  readonly requestedBy: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

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

const NEWEST_CLAIM = [
  desc(pullRequestChapters.startedAt),
  desc(pullRequestChapters.createdAt),
  desc(pullRequestChapters.id),
] as const;

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
        .orderBy(...NEWEST_CLAIM)
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
          setWhere: sql`${pullRequestChapters.status} <> ${PULL_REQUEST_CHAPTERS_STATUS.GENERATING} or ${pullRequestChapters.startedAt} < ${staleBefore}`,
        })
        .returning({ id: pullRequestChapters.id, claim: pullRequestChapters.claim }),
    ),
});

function heldBy(id: string, claim: string) {
  return and(
    eq(pullRequestChapters.id, id),
    eq(pullRequestChapters.claim, claim),
    eq(pullRequestChapters.status, PULL_REQUEST_CHAPTERS_STATUS.GENERATING),
  );
}

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

export function latestPullRequestChapters(
  organizationId: string,
  repository: string,
  pullRequestNumber: number,
): PullRequestChaptersEffect<Option.Option<PullRequestChapters>> {
  return findLatest({ organizationId, repository, pullRequestNumber });
}

export function pullRequestChaptersLiveStatement(
  userId: string,
  agentId: string,
  pullRequestNumber: number,
): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection(
          {
            status: pullRequestChapters.status,
            headSha: pullRequestChapters.headSha,
            baseSha: pullRequestChapters.baseSha,
            failureKind: pullRequestChapters.failureKind,
            model: pullRequestChapters.model,
            chapters: pullRequestChapters.chapters,
          },
          { startedAt: pullRequestChapters.startedAt },
        ),
      )
      .from(pullRequestChapters)
      .innerJoin(
        agentTable,
        and(
          eq(agentTable.organizationId, pullRequestChapters.organizationId),
          eq(agentTable.repository, pullRequestChapters.repository),
        ),
      )
      .where(
        and(
          eq(agentTable.id, agentId),
          agentVisibleTo(userId),
          eq(pullRequestChapters.pullRequestNumber, pullRequestNumber),
        ),
      )
      .orderBy(...NEWEST_CLAIM)
      .limit(1),
  );
}

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

export function finishChapterGeneration(
  claim: ChapterClaim,
  made: { readonly model: string; readonly chapters: unknown; readonly now: Date },
): PullRequestChaptersEffect<boolean> {
  return Effect.map(settleReady({ ...claim, ...made }), (rows) => rows.length > 0);
}

export function failChapterGeneration(
  claim: ChapterClaim,
  failureKind: PullRequestChaptersFailure,
  now: Date,
): PullRequestChaptersEffect<boolean> {
  return Effect.map(settleFailed({ ...claim, failureKind, now }), (rows) => rows.length > 0);
}

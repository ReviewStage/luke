import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import {
  PULL_REQUEST_CHAPTERS_FAILURE,
  PULL_REQUEST_CHAPTERS_STATUS,
} from "../../pull-request-chapters-vocabulary.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import {
  CHAPTER_CLAIM_OUTCOME,
  CHAPTER_GENERATION_STALE_MS,
  type ChapterClaim,
  type ChapterClaimAnswer,
  type ChapterGenerationRequest,
  claimChapterGeneration,
  failChapterGeneration,
  finishChapterGeneration,
  latestPullRequestChapters,
} from "../pull-request-chapters-store.js";

/**
 * A pull request's chapters over a real dialect: the newest claim reads
 * whatever its head; a claim inserts, takes over a finished or failed row,
 * or one generating past the bound, and answers busy within it; of claims at
 * once exactly one is claimed; a finish or a failure lands only under the
 * claim still holding the row; and a workspace reads none of another's.
 *
 * Synthetic accounts, workspaces, commits, and chapters throughout.
 */

const AT = Date.UTC(2026, 9, 19, 12);
const at = (minutes: number) => new Date(AT + minutes * 60_000);

const REPOSITORY = "acme/widgets";
const NUMBER = 42;
const BASE = "b".repeat(40);
const HEAD = "1".repeat(40);
const NEWER_HEAD = "2".repeat(40);
const MODEL = "test-model";
const CHAPTERS = { chapters: [{ title: "Synthetic chapter" }] };

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** A member and the workspace they own, with a Generate for the pull request's head at the instant given. */
const openPullRequest = Effect.gen(function* () {
  const requestedBy = yield* openAccount;
  const organizationId = yield* openWorkspace(requestedBy);
  const generate = (now: Date, headSha: string = HEAD): ChapterGenerationRequest => ({
    organizationId,
    repository: REPOSITORY,
    pullRequestNumber: NUMBER,
    baseSha: BASE,
    headSha,
    requestedBy,
    now,
  });
  return { organizationId, requestedBy, generate };
});

const claimedOf = (answer: ChapterClaimAnswer): ChapterClaim => {
  assert.equal(answer.outcome, CHAPTER_CLAIM_OUTCOME.CLAIMED);
  assert.ok(answer.outcome === CHAPTER_CLAIM_OUTCOME.CLAIMED);
  return answer.claim;
};

const latestOf = (organizationId: string) =>
  Effect.map(latestPullRequestChapters(organizationId, REPOSITORY, NUMBER), Option.getOrThrow);

it.layer(getTestDB())("the pull request chapters store", (it) => {
  it.effect("a pull request never generated reads as none", () =>
    Effect.gen(function* () {
      const { organizationId } = yield* openPullRequest;

      const latest = yield* latestPullRequestChapters(organizationId, REPOSITORY, NUMBER);

      assert.ok(Option.isNone(latest));
    }),
  );

  it.effect("a claim generates, and its finish lands the chapters with the model", () =>
    Effect.gen(function* () {
      const { organizationId, requestedBy, generate } = yield* openPullRequest;

      const claim = claimedOf(yield* claimChapterGeneration(generate(at(0))));
      const generating = yield* latestOf(organizationId);
      const landed = yield* finishChapterGeneration(claim, {
        model: MODEL,
        chapters: CHAPTERS,
        now: at(1),
      });
      const ready = yield* latestOf(organizationId);

      assert.deepEqual(
        [generating.id, generating.status, generating.chapters, generating.model],
        [claim.id, PULL_REQUEST_CHAPTERS_STATUS.GENERATING, null, null],
      );
      assert.equal(landed, true);
      assert.deepEqual(
        {
          status: ready.status,
          model: ready.model,
          chapters: ready.chapters,
          headSha: ready.headSha,
          baseSha: ready.baseSha,
          requestedBy: ready.requestedBy,
          startedAt: ready.startedAt,
          finishedAt: ready.finishedAt,
        },
        {
          status: PULL_REQUEST_CHAPTERS_STATUS.READY,
          model: MODEL,
          chapters: CHAPTERS,
          headSha: HEAD,
          baseSha: BASE,
          requestedBy,
          startedAt: at(0),
          finishedAt: at(1),
        },
      );
    }),
  );

  it.effect("a failure records its kind and nothing of chapters", () =>
    Effect.gen(function* () {
      const { organizationId, generate } = yield* openPullRequest;

      const claim = claimedOf(yield* claimChapterGeneration(generate(at(0))));
      const landed = yield* failChapterGeneration(
        claim,
        PULL_REQUEST_CHAPTERS_FAILURE.TOO_LARGE,
        at(1),
      );
      const failed = yield* latestOf(organizationId);

      assert.equal(landed, true);
      assert.deepEqual(
        [failed.status, failed.failureKind, failed.chapters, failed.finishedAt],
        [PULL_REQUEST_CHAPTERS_STATUS.FAILED, PULL_REQUEST_CHAPTERS_FAILURE.TOO_LARGE, null, at(1)],
      );
    }),
  );

  it.effect(
    "the newest claim reads whatever its head, so a newer head's generation stands over older chapters",
    () =>
      Effect.gen(function* () {
        const { organizationId, generate } = yield* openPullRequest;
        const older = claimedOf(yield* claimChapterGeneration(generate(at(0))));
        yield* finishChapterGeneration(older, { model: MODEL, chapters: CHAPTERS, now: at(1) });

        const stale = yield* latestOf(organizationId);
        const newer = claimedOf(yield* claimChapterGeneration(generate(at(10), NEWER_HEAD)));
        const latest = yield* latestOf(organizationId);

        assert.deepEqual([stale.headSha, stale.status], [HEAD, PULL_REQUEST_CHAPTERS_STATUS.READY]);
        assert.notEqual(newer.id, older.id, "a newer head is a row of its own");
        assert.deepEqual(
          [latest.id, latest.headSha, latest.status],
          [newer.id, NEWER_HEAD, PULL_REQUEST_CHAPTERS_STATUS.GENERATING],
        );
      }),
  );

  it.effect(
    "a claim while another generates within the bound is busy, and takes it over past the bound",
    () =>
      Effect.gen(function* () {
        const { generate } = yield* openPullRequest;
        const boundMinutes = CHAPTER_GENERATION_STALE_MS / 60_000;

        const first = claimedOf(yield* claimChapterGeneration(generate(at(0))));
        const within = yield* claimChapterGeneration(generate(at(boundMinutes - 1)));
        const past = claimedOf(yield* claimChapterGeneration(generate(at(boundMinutes + 1))));

        assert.deepEqual(within, { outcome: CHAPTER_CLAIM_OUTCOME.BUSY });
        assert.equal(past.id, first.id, "the head's one row is taken over");
        assert.notEqual(past.claim, first.claim, "under a fresh claim");
      }),
  );

  it.effect(
    "a crashed generation's late writer lands nothing over the claim that took it over",
    () =>
      Effect.gen(function* () {
        const { organizationId, generate } = yield* openPullRequest;
        const boundMinutes = CHAPTER_GENERATION_STALE_MS / 60_000;
        const crashed = claimedOf(yield* claimChapterGeneration(generate(at(0))));
        const takeover = claimedOf(yield* claimChapterGeneration(generate(at(boundMinutes + 1))));

        const lateFinish = yield* finishChapterGeneration(crashed, {
          model: MODEL,
          chapters: CHAPTERS,
          now: at(boundMinutes + 2),
        });
        const lateFailure = yield* failChapterGeneration(
          crashed,
          PULL_REQUEST_CHAPTERS_FAILURE.TIMEOUT,
          at(boundMinutes + 2),
        );
        const standing = yield* latestOf(organizationId);
        const landed = yield* finishChapterGeneration(takeover, {
          model: MODEL,
          chapters: CHAPTERS,
          now: at(boundMinutes + 3),
        });

        assert.deepEqual([lateFinish, lateFailure], [false, false]);
        assert.deepEqual(
          [standing.status, standing.chapters, standing.startedAt],
          [PULL_REQUEST_CHAPTERS_STATUS.GENERATING, null, at(boundMinutes + 1)],
        );
        assert.equal(landed, true);
      }),
  );

  it.effect(
    "a regenerate takes over ready or failed chapters at once, and the old claim lands nothing after",
    () =>
      Effect.gen(function* () {
        const { organizationId, generate } = yield* openPullRequest;
        const first = claimedOf(yield* claimChapterGeneration(generate(at(0))));
        yield* finishChapterGeneration(first, { model: MODEL, chapters: CHAPTERS, now: at(1) });

        const second = claimedOf(yield* claimChapterGeneration(generate(at(2))));
        const regenerating = yield* latestOf(organizationId);
        const replay = yield* finishChapterGeneration(first, {
          model: MODEL,
          chapters: CHAPTERS,
          now: at(3),
        });
        yield* failChapterGeneration(second, PULL_REQUEST_CHAPTERS_FAILURE.MODEL_REFUSED, at(3));
        const third = yield* claimChapterGeneration(generate(at(4)));

        assert.equal(second.id, first.id);
        assert.deepEqual(
          [regenerating.status, regenerating.chapters, regenerating.model, regenerating.finishedAt],
          [PULL_REQUEST_CHAPTERS_STATUS.GENERATING, null, null, null],
        );
        assert.equal(replay, false, "a finished claim cannot land again");
        assert.equal(
          third.outcome,
          CHAPTER_CLAIM_OUTCOME.CLAIMED,
          "a failed row is claimed at once",
        );
      }),
  );

  it.effect("of claims at once for one head, exactly one is claimed", () =>
    Effect.gen(function* () {
      const { generate } = yield* openPullRequest;

      const answers = yield* Effect.all(
        Array.from({ length: 5 }, () => claimChapterGeneration(generate(at(0)))),
        { concurrency: "unbounded" },
      );

      assert.deepEqual(answers.map((answer) => answer.outcome).toSorted(), [
        CHAPTER_CLAIM_OUTCOME.BUSY,
        CHAPTER_CLAIM_OUTCOME.BUSY,
        CHAPTER_CLAIM_OUTCOME.BUSY,
        CHAPTER_CLAIM_OUTCOME.BUSY,
        CHAPTER_CLAIM_OUTCOME.CLAIMED,
      ]);
    }),
  );

  it.effect("a workspace reads none of another's chapters, and its claim is its own", () =>
    Effect.gen(function* () {
      const one = yield* openPullRequest;
      const other = yield* openPullRequest;
      const claim = claimedOf(yield* claimChapterGeneration(one.generate(at(0))));
      yield* finishChapterGeneration(claim, { model: MODEL, chapters: CHAPTERS, now: at(1) });

      const read = yield* latestPullRequestChapters(other.organizationId, REPOSITORY, NUMBER);
      const ownClaim = yield* claimChapterGeneration(other.generate(at(1)));
      const kept = yield* latestOf(one.organizationId);

      assert.ok(Option.isNone(read), "another workspace's chapters read as none");
      assert.equal(ownClaim.outcome, CHAPTER_CLAIM_OUTCOME.CLAIMED);
      assert.notEqual(claimedOf(ownClaim).id, claim.id, "each workspace keeps a row of its own");
      assert.deepEqual(
        [kept.status, kept.chapters],
        [PULL_REQUEST_CHAPTERS_STATUS.READY, CHAPTERS],
      );
    }),
  );
});

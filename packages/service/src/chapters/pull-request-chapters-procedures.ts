/**
 * pull-request-chapters-procedures.ts -- a pull request's chapters as its Pull request tab reads and generates them, as the hosted oRPC router answers them.
 *
 * Both procedures resolve the caller first, then the agent its path names,
 * one of a workspace the caller's account is a member of: an agent of any
 * other workspace answers exactly as one that names nothing. Each is about
 * the pull request a Files changed read of the same tab is about: the one
 * the agent published, from the instance's kept answers, or the one of its
 * repository the `number` query names (`askedPullRequest`). GitHub is then
 * read on a token minted for the agent's repository on its workspace's
 * installation, which confirms the workspace still reaches it, and the
 * chapters are those its workspace keeps for that repository and number
 * (`pull-request-chapters-store.ts`), which checks the workspace alone:
 * these two reads are what hold a reader to a pull request they may see.
 *
 * The read (`GET /api/agents/{id}/chapters`) answers the pull request's head
 * as GitHub holds it now beside the workspace's newest chapters for it,
 * whatever head they were made for, so the panel draws chapters of an older
 * head as stale. The Generate (`POST /api/agents/{id}/chapters`) reads the
 * pull request's files, title, description, and commit messages, claims the
 * generation for its head, and tells the chapters in one model call on
 * Luke's own key (`chapters-generator.ts`), on the Claude model the member
 * who pressed it chose in Settings (Haiku where they never chose, or where
 * what they stored is no model this build offers), then answers as the read
 * does. A claim another request holds answers as generating, without reading the
 * diff or asking the model; a head pushed while the diff is read is answered
 * as it now stands rather than told under the head it no longer is, since
 * GitHub serves a pull request's files by its number, not its head; a generation that fails lands its kind on the row, and any other
 * failure while it runs lands as unexpected and is answered as the error it
 * was. The diff and the chapters travel only to the model, the store, and
 * the caller: a log line and the counted event carry kinds and counts alone.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { readAccountPreferences } from "@luke/database/models/account-store";
import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import {
  CHAPTER_CLAIM_OUTCOME,
  CHAPTER_GENERATION_STALE_MS,
  type ChapterClaim,
  claimChapterGeneration,
  failChapterGeneration,
  finishChapterGeneration,
  latestPullRequestChapters,
  type PullRequestChapters,
  type PullRequestChaptersEffect,
} from "@luke/database/models/pull-request-chapters-store";
import {
  PULL_REQUEST_CHAPTERS_FAILURE,
  PULL_REQUEST_CHAPTERS_STATUS,
  type PullRequestChaptersFailure,
} from "@luke/database/pull-request-chapters-vocabulary";
import { CHAPTERS_MODEL_DEFAULT, type ChaptersModelId } from "@luke/features/chapters-model-choice";
import { chapterSchema } from "@luke/features/pull-request-chapters";
import {
  PULL_REQUEST_CHAPTERS_STATE,
  type PullRequestChaptersAnswer,
  type PullRequestChaptersState,
} from "@luke/features/pull-request-chapters-wire";
import { Cause, Clock, Effect, Option, type Redacted, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { reachedAgentById } from "../agents/agent-reach.js";
import { askedPullRequest, pullRequestNumberOf } from "../agents/asked-pull-request.js";
import {
  agentPullRequestReach,
  instancePublishedCache,
  type PublishedCache,
  type PublishedReach,
} from "../agents/coder-host/published.js";
import { HostedEnvironment } from "../environment.js";
import {
  recordServerEvent,
  SERVER_CHAPTERS_OUTCOME,
  SERVER_EVENT,
} from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import { githubReadOrRefusal } from "../github/github-refusal.js";
import {
  type GitHubPullRequest,
  pullRequestByNumber,
  pullRequestCommitMessages,
  pullRequestFiles,
} from "../github/pull-requests.js";
import { agentWorkspace } from "../github/workspace-repository.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import {
  type ChaptersModel,
  chaptersModelOf,
  type GeneratedChapters,
  generateChapters,
} from "./chapters-generator.js";

export interface PullRequestChaptersProcedureSeams extends PublishedReach {
  resolveUserId: UserIdResolver;
  /** The model chapters are told on, the one named, from the deployment's own Anthropic key; none where it holds none. A test hands in a scripted one. */
  chaptersModel?: (
    anthropicKey: Redacted.Redacted | undefined,
    modelId: ChaptersModelId,
  ) => ChaptersModel | undefined;
}

/** The stored chapters as their wire schema decodes them. */
const decodeChapters = Schema.decodeUnknownEffect(Schema.Array(chapterSchema));

type ChaptersServices =
  | DatabaseServices
  | HostedEnvironment
  | ModelCatalog
  | GitHubApp
  | HttpClient.HttpClient;

/** The agent the path names, where the account is a member of its workspace; not found otherwise, and for an id that is no UUID. */
const reachedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (userId: string, id: string) {
  const { agent } = yield* reachedAgentById(userId, id);
  return agent;
});

/** A read of GitHub or the store on the agent's behalf, its failures as the refusals the tab's other reads answer. */
function refusedAsRead<A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return Effect.catch(effect, (failure) => {
    switch (failure._tag) {
      case "RepositoryNotReachable":
        return Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
      case "SqlError":
      case "EffectDrizzleQueryError":
      case "SchemaError":
        // SAFETY: the three tags above are the store's own failures.
        return hostedStoreOrUnavailable(Effect.fail(failure as never));
      default:
        // SAFETY: every other failure here is a read of GitHub or the App.
        return githubReadOrRefusal(Effect.fail(failure as never));
    }
  });
}

/** What both procedures stand on: the pull request as GitHub holds it now, the token it was read on, and the workspace its chapters are kept under; none where there is no pull request. */
interface ChaptersSubject {
  readonly agent: CodingAgent;
  readonly organizationId: string;
  readonly token: Redacted.Redacted;
  readonly pullRequest: GitHubPullRequest;
}

/** The pull request the tab asks about, read afresh on the agent's repository token, with the workspace its chapters are kept under. */
const subjectOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  published: Effect.Effect<PublishedCache>,
  userId: string,
  agent: CodingAgent,
  named: string | undefined,
): Effect.fn.Return<Option.Option<ChaptersSubject>, HostedRefusal, ChaptersServices> {
  // The number as the query spelled it, read by the rule every read of the tab reads it by.
  const number = yield* pullRequestNumberOf(named === undefined ? [] : [named]);
  const asked = yield* askedPullRequest(yield* published, userId, agent, number);
  if (asked === null) return Option.none();
  const { token, workspace, found } = yield* refusedAsRead(
    Effect.gen(function* () {
      const { token } = yield* agentPullRequestReach(userId, agent);
      const workspace = yield* agentWorkspace(userId, agent);
      const found = yield* pullRequestByNumber(token, agent.repository, asked.number);
      return { token, workspace, found };
    }),
  );
  // The token was just minted through this workspace, so none here is a workspace left between two reads.
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  return Option.map(found, (pullRequest) => ({
    agent,
    organizationId: workspace.value,
    token,
    pullRequest,
  }));
});

/** The stored row as the wire's state of the chapters. */
const stateOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  row: Option.Option<PullRequestChapters>,
): Effect.fn.Return<PullRequestChaptersState, HostedRefusal> {
  if (Option.isNone(row)) return { status: PULL_REQUEST_CHAPTERS_STATE.NONE };
  const { status, headSha, baseSha } = row.value;
  switch (status) {
    case PULL_REQUEST_CHAPTERS_STATUS.GENERATING:
      return {
        status: PULL_REQUEST_CHAPTERS_STATE.GENERATING,
        headSha,
        baseSha,
        startedAt: row.value.startedAt.getTime(),
      };
    case PULL_REQUEST_CHAPTERS_STATUS.FAILED:
      return {
        status: PULL_REQUEST_CHAPTERS_STATE.FAILED,
        headSha,
        baseSha,
        failureKind: row.value.failureKind ?? PULL_REQUEST_CHAPTERS_FAILURE.UNEXPECTED,
      };
    case PULL_REQUEST_CHAPTERS_STATUS.READY: {
      const chapters = yield* hostedStoreOrUnavailable(decodeChapters(row.value.chapters));
      const model = row.value.model;
      // The store writes a model with every ready row, so one without is a row off its own shape.
      if (model === null || model === "") {
        yield* Effect.logWarning("ready chapters stood without their model");
        return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      }
      return { status: PULL_REQUEST_CHAPTERS_STATE.READY, headSha, baseSha, model, chapters };
    }
  }
});

/** The answer both procedures give: the pull request's head now, whether this deployment generates chapters, and the workspace's newest chapters for it. */
const answerOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  subject: ChaptersSubject,
  generatable: boolean,
): Effect.fn.Return<PullRequestChaptersAnswer, HostedRefusal, DatabaseServices> {
  const { organizationId, agent, pullRequest } = subject;
  const row = yield* hostedStoreOrUnavailable(
    latestPullRequestChapters(organizationId, agent.repository, pullRequest.number),
  );
  return {
    pullRequest: {
      number: pullRequest.number,
      headSha: pullRequest.headSha,
      generatable,
      chapters: yield* stateOf(row),
    },
  };
});

/**
 * Whether another request is generating the pull request's chapters for its
 * head now: the newest claim stands `generating` on this head, claimed within
 * the store's stale bound, past which a Generate takes it over.
 */
const generatingNow = /* @__PURE__ */ Effect.fnUntraced(function* (subject: ChaptersSubject) {
  const { organizationId, agent, pullRequest } = subject;
  const row = yield* hostedStoreOrUnavailable(
    latestPullRequestChapters(organizationId, agent.repository, pullRequest.number),
  );
  if (Option.isNone(row)) return false;
  const now = yield* Clock.currentTimeMillis;
  const { status, headSha, startedAt } = row.value;
  return (
    status === PULL_REQUEST_CHAPTERS_STATUS.GENERATING &&
    headSha === pullRequest.headSha &&
    now - startedAt.getTime() < CHAPTER_GENERATION_STALE_MS
  );
});

/** The model named, as this deployment tells chapters on it, or none where it holds no key for one. */
const modelOf = (seams: PullRequestChaptersProcedureSeams, modelId: ChaptersModelId) =>
  Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    return (seams.chaptersModel ?? chaptersModelOf)(environment.anthropicKey, modelId);
  });

/** The model the member chose in Settings, Haiku where they never chose (the store reads one no build offers as Haiku too). */
const chosenModelOf = (userId: string) =>
  Effect.map(
    hostedStoreOrUnavailable(readAccountPreferences(userId)),
    (row) => row?.chaptersModel ?? CHAPTERS_MODEL_DEFAULT,
  );

/** What a generation's counted event carries but its length: how it came out, and how many chapters and hunks it told. */
interface GenerationCounts {
  readonly outcome: (typeof SERVER_CHAPTERS_OUTCOME)[keyof typeof SERVER_CHAPTERS_OUTCOME];
  readonly chapters: number;
  readonly hunks: number;
}

/** How many hunks the chapters hold between them. */
function hunksOf(generated: GeneratedChapters): number {
  return generated.chapters.reduce((sum, chapter) => sum + chapter.hunkRefs.length, 0);
}

/**
 * One generation under the claim taken: the chapters told and landed, or
 * the kind it failed with landed. Note that a failure that is not the
 * generation's own, a defect or an interruption, still lands on the row as
 * unexpected before it goes on as it was, so the row never stands
 * `generating` past a request that ended; a request killed outright is
 * taken over once the claim goes stale.
 */
const generated = /* @__PURE__ */ Effect.fnUntraced(function* (
  claim: ChapterClaim,
  model: ChaptersModel,
  userId: string,
  read: {
    readonly title: string;
    readonly body: string | null;
    readonly truncated: boolean;
  } & Pick<Parameters<typeof generateChapters>[1], "files" | "commitMessages">,
) {
  const started = yield* Clock.currentTimeMillis;
  const settle = (outcome: PullRequestChaptersEffect<boolean>, counted: GenerationCounts) =>
    Effect.gen(function* () {
      yield* hostedStoreOrUnavailable(outcome);
      const duration = (yield* Clock.currentTimeMillis) - started;
      yield* recordServerEvent(SERVER_EVENT.PULL_REQUEST_CHAPTERS_GENERATE, userId, {
        ...counted,
        duration_ms: duration,
      });
    });
  const failed = (kind: PullRequestChaptersFailure) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      settle(failChapterGeneration(claim, kind, new Date(now)), {
        outcome: kind,
        chapters: 0,
        hunks: 0,
      }),
    );
  // A listing cut short at the files bound would be told as the whole, so it is refused as too large before any call.
  if (read.truncated) return yield* failed(PULL_REQUEST_CHAPTERS_FAILURE.TOO_LARGE);
  const told = generateChapters(model, read).pipe(
    Effect.matchEffect({
      onFailure: (failure) => failed(failure.kind),
      onSuccess: (made) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          settle(
            finishChapterGeneration(claim, {
              model: made.model,
              chapters: made.chapters,
              now: new Date(now),
            }),
            {
              outcome: SERVER_CHAPTERS_OUTCOME.READY,
              chapters: made.chapters.length,
              hunks: hunksOf(made),
            },
          ),
        ),
    }),
  );
  return yield* told.pipe(
    Effect.onError((cause) =>
      Cause.hasFails(cause)
        ? Effect.void
        : Effect.ignore(failed(PULL_REQUEST_CHAPTERS_FAILURE.UNEXPECTED)),
    ),
  );
});

/** The pull request's files, words, and commit messages, as a generation reads them. */
const generationInput = (subject: ChaptersSubject) => {
  const { token, agent, pullRequest } = subject;
  return refusedAsRead(
    Effect.all(
      [
        pullRequestFiles(token, agent.repository, pullRequest),
        // Note that the messages only help the story along, so a read of them that fails tells it without them.
        Effect.orElseSucceed(
          pullRequestCommitMessages(token, agent.repository, pullRequest.number),
          (): readonly string[] => [],
        ),
      ],
      { concurrency: "unbounded" },
    ),
  ).pipe(
    Effect.map(([files, commitMessages]) => ({
      files: files.files,
      truncated: files.truncated,
      title: pullRequest.title,
      body: pullRequest.body ?? null,
      commitMessages,
    })),
  );
};

/** The chapters resource: the read and the Generate, each to a signed-in caller. */
export function pullRequestChaptersProcedures(seams: PullRequestChaptersProcedureSeams) {
  const signedIn = hosted.pullRequestChapters.use(accountMiddleware(seams.resolveUserId));
  const published = seams.published ?? instancePublishedCache();
  return {
    read: signedIn.read.effect(function* ({ input, context }) {
      const agent = yield* reachedAgent(context.userId, input.id);
      const subject = yield* subjectOf(published, context.userId, agent, input.number);
      if (Option.isNone(subject)) return { pullRequest: null };
      // Whether the deployment can generate at all, which no member's choice changes.
      const model = yield* modelOf(seams, CHAPTERS_MODEL_DEFAULT);
      return yield* answerOf(subject.value, model !== undefined);
    }),

    generate: signedIn.generate.effect(function* ({ input, context }) {
      const agent = yield* reachedAgent(context.userId, input.params.id);
      // The model is the presser's own choice, while the chapters it tells are the workspace's.
      const model = yield* modelOf(seams, yield* chosenModelOf(context.userId));
      if (model === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      const subject = yield* subjectOf(published, context.userId, agent, input.query?.number);
      if (Option.isNone(subject)) return { pullRequest: null };
      const { organizationId, pullRequest } = subject.value;
      // Note that GitHub names the base on every read of one pull request; one that does not is a GitHub off its shape.
      if (pullRequest.baseSha === undefined) {
        return yield* Effect.fail(HOSTED_REFUSAL.GITHUB_UNANSWERED);
      }
      // A generation another request holds for this head answers as it stands, before GitHub is asked for a diff this request will not use.
      if (yield* generatingNow(subject.value)) return yield* answerOf(subject.value, true);
      const read = yield* generationInput(subject.value);
      // The files are read by the pull request's number, so a push between the two reads would tell another head's diff under this one: the head is read again, and a moved one is answered as it now stands, to be generated on its own.
      const after = yield* refusedAsRead(
        pullRequestByNumber(subject.value.token, agent.repository, pullRequest.number),
      );
      if (Option.isNone(after)) return { pullRequest: null };
      if (after.value.headSha !== pullRequest.headSha) {
        return yield* answerOf({ ...subject.value, pullRequest: after.value }, true);
      }
      const now = yield* Clock.currentTimeMillis;
      const claimed = yield* hostedStoreOrUnavailable(
        claimChapterGeneration({
          organizationId,
          repository: agent.repository,
          pullRequestNumber: pullRequest.number,
          baseSha: pullRequest.baseSha,
          headSha: pullRequest.headSha,
          requestedBy: context.userId,
          now: new Date(now),
        }),
      );
      if (claimed.outcome === CHAPTER_CLAIM_OUTCOME.CLAIMED) {
        yield* generated(claimed.claim, model, context.userId, read);
      }
      return yield* answerOf(subject.value, true);
    }),
  };
}

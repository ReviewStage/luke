/**
 * pull-request-chapters-procedures.ts -- a pull request's chapters as its Pull request tab reads and generates them, as the hosted oRPC router answers them.
 *
 * Both procedures resolve the caller first, then the agent its path names,
 * one of a workspace the caller's account is a member of: an agent of any
 * other workspace answers exactly as one that names nothing. A token minted
 * for the agent's repository on its workspace's installation confirms the
 * workspace still reaches it, and the chapters are those its workspace keeps
 * for that repository and number (`pull-request-chapters-store.ts`), which
 * checks the workspace alone: these two are what hold a reader to a pull
 * request they may see.
 *
 * The read (`GET /api/agents/{id}/chapters`) names the number the tab's own
 * read of the pull request found and answers the workspace's newest chapters
 * for it, whatever head they were made for, asking GitHub for nothing but
 * that token, which the instance keeps; the panel holds their head against
 * its own to draw them stale. A number the repository holds no pull request
 * at answers as one with no chapters. The Generate
 * (`POST /api/agents/{id}/chapters`) is about the pull request a Files
 * changed read of the same tab is about: the one the agent published, from
 * the instance's kept answers, or the one of its repository the `number`
 * query names (`askedPullRequest`). It reads the pull request's files,
 * title, description, and commit messages, claims the
 * generation for its head, and tells the chapters in one model call on
 * the API key the member who pressed it saved, never Luke's
 * (`chapters-generator.ts`), on the Claude model they chose in Settings
 * (Haiku where they never chose, or where what they stored is no model this
 * build offers), or OpenAI's of its tier where they saved only an OpenAI
 * key, then answers as the read does. A member who saved no API key, as one
 * on a subscription alone, is answered `generatable: false` and their
 * Generate is refused as unavailable. A claim another request holds answers as generating, without reading the
 * diff or asking the model; a head pushed while the diff is read is answered
 * as it now stands rather than told under the head it no longer is, since
 * GitHub serves a pull request's files by its number, not its head; a generation that fails lands its kind on the row, and any other
 * failure while it runs lands as unexpected and is answered as the error it
 * was. The diff and the chapters travel only to the model, the store, and
 * the caller: a log line and the counted event carry kinds and counts alone.
 *
 * The other two (`GET` and `POST /api/pull-requests/chapters`) name the pull
 * request by its workspace, repository, and number in the query, for one no
 * agent opened, and reach it as its other reads by repository do
 * (`github/repository-pull-request-procedures.ts`): a workspace the account
 * is no member of is not found. The read confirms the repository in reach
 * on a minted token and answers as the agent's read does, asking GitHub for
 * nothing more and starting no model call. The Generate reads the pull
 * request by its number, not found where the repository holds none under
 * it, and is then the agent's Generate, on the presser's own key and choice
 * of model. Neither runs but on the caller's ask: no read of a pull request
 * by its repository, nor its opening, generates chapters.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { readAccountPreferences } from "@luke/database/models/account-store";
import { type Agent, hasRepository } from "@luke/database/models/agent-store";
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
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { chapterSchema } from "@luke/features/pull-request-chapters";
import {
  PULL_REQUEST_CHAPTERS_STATE,
  type PullRequestChaptersAnswer,
  type PullRequestChaptersState,
} from "@luke/features/pull-request-chapters-wire";
import { Cause, Clock, Effect, Option, type Redacted, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { reachedAgentById } from "../agents/agent-reach.js";
import {
  askedPullRequest,
  githubReadRefusal,
  pullRequestNumberOf,
} from "../agents/asked-pull-request.js";
import { ownKeyOf } from "../agents/coder-host/account-keys.js";
import type { OwnKey } from "../agents/coder-host/model.js";
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
import {
  type GitHubPullRequest,
  pullRequestByNumber,
  pullRequestCommitMessages,
  pullRequestFiles,
} from "../github/pull-requests.js";
import {
  reachedByNumber,
  reachedRepository,
} from "../github/repository-pull-request-procedures.js";
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
  /** The model chapters are told on, the one named, on the member's own key. A test hands in a scripted one. */
  chaptersModel?: (own: OwnKey, modelId: ChaptersModelId) => ChaptersModel;
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

/** What a pull request's chapters are kept under: its repository, and the workspace that reaches it. */
interface ChaptersOf {
  readonly repository: string;
  readonly organizationId: string;
}

/** What a Generate stands on: where the chapters are kept, the pull request as GitHub holds it now, and the token it was read on. */
interface ChaptersSubject extends ChaptersOf {
  readonly token: Redacted.Redacted;
  readonly pullRequest: GitHubPullRequest;
}

/** The pull request the tab asks about, read afresh on the agent's repository token, with the workspace its chapters are kept under. */
const subjectOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  published: Effect.Effect<PublishedCache>,
  userId: string,
  agent: Agent,
  named: string | undefined,
): Effect.fn.Return<Option.Option<ChaptersSubject>, HostedRefusal, ChaptersServices> {
  // The number as the query spelled it, read by the rule every read of the tab reads it by.
  const number = yield* pullRequestNumberOf(named === undefined ? [] : [named]);
  const asked = yield* askedPullRequest(yield* published, userId, agent, number);
  if (asked === null || !hasRepository(agent)) return Option.none();
  const { token, workspace, found } = yield* githubReadRefusal(
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
    repository: agent.repository,
    organizationId: workspace.value,
    token,
    pullRequest,
  }));
});

/** The workspace the agent's chapters are kept under, once a token minted for its repository confirms the workspace still reaches it; none for an agent with no repository. */
const keptUnder = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: Agent,
): Effect.fn.Return<Option.Option<ChaptersOf>, HostedRefusal, ChaptersServices> {
  if (!hasRepository(agent)) return Option.none();
  const workspace = yield* githubReadRefusal(
    Effect.andThen(agentPullRequestReach(userId, agent), agentWorkspace(userId, agent)),
  );
  // The token was just minted through this workspace, so none here is a workspace left between two reads.
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  return Option.some({ repository: agent.repository, organizationId: workspace.value });
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

/** The answer both procedures give: whether this deployment generates chapters, and the workspace's newest chapters for the pull request. */
const answerOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  of: ChaptersOf,
  number: number,
  generatable: boolean,
): Effect.fn.Return<PullRequestChaptersAnswer, HostedRefusal, DatabaseServices> {
  const row = yield* hostedStoreOrUnavailable(
    latestPullRequestChapters(of.organizationId, of.repository, number),
  );
  return {
    pullRequest: {
      number,
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
  const { organizationId, repository, pullRequest } = subject;
  const row = yield* hostedStoreOrUnavailable(
    latestPullRequestChapters(organizationId, repository, pullRequest.number),
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

/** The model named, on the member's own API key, Anthropic's first, or none where they saved none. */
const modelOf = (
  seams: PullRequestChaptersProcedureSeams,
  userId: string,
  modelId: ChaptersModelId,
) =>
  Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    const own = yield* hostedStoreOrUnavailable(
      ownKeyOf(userId, MODEL_PROVIDER.ANTHROPIC, environment.providerKeyEncryptionKeys),
    );
    return own === undefined ? undefined : (seams.chaptersModel ?? chaptersModelOf)(own, modelId);
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
  const { token, repository, pullRequest } = subject;
  return githubReadRefusal(
    Effect.all(
      [
        pullRequestFiles(token, repository, pullRequest),
        // Note that the messages only help the story along, so a read of them that fails tells it without them.
        Effect.orElseSucceed(
          pullRequestCommitMessages(token, repository, pullRequest.number),
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

/**
 * One Generate of the pull request's chapters, once the caller reached it
 * and the presser's model is had: answered as it stands where another
 * request generates them for this head or the head moved under the read,
 * else claimed, told, and landed, then answered as the read answers.
 */
const generatedFor = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  model: ChaptersModel,
  subject: ChaptersSubject,
) {
  const { organizationId, repository, token, pullRequest } = subject;
  // Note that GitHub names the base on every read of one pull request; one that does not is a GitHub off its shape.
  if (pullRequest.baseSha === undefined) {
    return yield* Effect.fail(HOSTED_REFUSAL.GITHUB_UNANSWERED);
  }
  // A generation another request holds for this head answers as it stands, before GitHub is asked for a diff this request will not use.
  if (yield* generatingNow(subject)) {
    return yield* answerOf(subject, pullRequest.number, true);
  }
  const read = yield* generationInput(subject);
  // The files are read by the pull request's number, so a push between the two reads would tell another head's diff under this one: the head is read again, and a moved one is answered as it now stands, to be generated on its own.
  const after = yield* githubReadRefusal(
    pullRequestByNumber(token, repository, pullRequest.number),
  );
  if (Option.isNone(after)) return { pullRequest: null };
  if (after.value.headSha !== pullRequest.headSha) {
    return yield* answerOf(subject, pullRequest.number, true);
  }
  const now = yield* Clock.currentTimeMillis;
  const claimed = yield* hostedStoreOrUnavailable(
    claimChapterGeneration({
      organizationId,
      repository,
      pullRequestNumber: pullRequest.number,
      baseSha: pullRequest.baseSha,
      headSha: pullRequest.headSha,
      requestedBy: userId,
      now: new Date(now),
    }),
  );
  if (claimed.outcome === CHAPTER_CLAIM_OUTCOME.CLAIMED) {
    yield* generated(claimed.claim, model, userId, read);
  }
  return yield* answerOf(subject, pullRequest.number, true);
});

/** The chapters resource: the read and the Generate through an agent and by the repository and number, each to a signed-in caller. */
export function pullRequestChaptersProcedures(seams: PullRequestChaptersProcedureSeams) {
  const signedIn = hosted.pullRequestChapters.use(accountMiddleware(seams.resolveUserId));
  const published = seams.published ?? instancePublishedCache();
  return {
    read: signedIn.read.effect(function* ({ input, context }) {
      const agent = yield* reachedAgent(context.userId, input.id);
      const number = yield* pullRequestNumberOf([input.number]);
      // One number named always reads as one or is refused.
      if (number === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      // Whether the reader can generate at all, on a key of their own, which their choice of model never changes.
      const [kept, model] = yield* Effect.all(
        [keptUnder(context.userId, agent), modelOf(seams, context.userId, CHAPTERS_MODEL_DEFAULT)],
        { concurrency: "unbounded" },
      );
      if (Option.isNone(kept)) return { pullRequest: null };
      return yield* answerOf(kept.value, number, model !== undefined);
    }),

    generate: signedIn.generate.effect(function* ({ input, context }) {
      const agent = yield* reachedAgent(context.userId, input.params.id);
      // The model is the presser's own choice, while the chapters it tells are the workspace's.
      const model = yield* modelOf(seams, context.userId, yield* chosenModelOf(context.userId));
      if (model === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      const subject = yield* subjectOf(published, context.userId, agent, input.query?.number);
      if (Option.isNone(subject)) return { pullRequest: null };
      return yield* generatedFor(context.userId, model, subject.value);
    }),

    repositoryRead: signedIn.repositoryRead.effect(function* ({ input, context }) {
      const { subject } = yield* reachedRepository(context.userId, input);
      // Whether the reader can generate at all, as the agent's read asks it.
      const model = yield* modelOf(seams, context.userId, CHAPTERS_MODEL_DEFAULT);
      return yield* answerOf(subject, input.number, model !== undefined);
    }),

    repositoryGenerate: signedIn.repositoryGenerate.effect(function* ({ input, context }) {
      // The pull request is reached before the presser's key is asked about, so a non-member is refused alike whatever key they saved.
      const { token, subject, found } = yield* reachedByNumber(
        context.userId,
        input.query,
        pullRequestByNumber,
      );
      const model = yield* modelOf(seams, context.userId, yield* chosenModelOf(context.userId));
      if (model === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* generatedFor(context.userId, model, {
        repository: subject.repository,
        organizationId: subject.organizationId,
        token,
        pullRequest: found,
      });
    }),
  };
}

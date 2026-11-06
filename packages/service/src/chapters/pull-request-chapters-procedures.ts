import type { DatabaseServices } from "@repo/database/core/query";
import { type Agent, hasRepository } from "@repo/database/models/agent-store";
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
} from "@repo/database/models/pull-request-chapters-store";
import {
  PULL_REQUEST_CHAPTERS_FAILURE,
  PULL_REQUEST_CHAPTERS_STATUS,
  type PullRequestChaptersFailure,
} from "@repo/database/pull-request-chapters-vocabulary";
import {
  CHAPTERS_MODEL,
  type ChaptersModelId,
  chaptersModelOn,
} from "@repo/features/chapters-model-choice";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { chapterSchema } from "@repo/features/pull-request-chapters";
import {
  type ChaptersRunsOn,
  PULL_REQUEST_CHAPTERS_STATE,
  type PullRequestChaptersAnswer,
  type PullRequestChaptersState,
} from "@repo/features/pull-request-chapters-wire";
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
  type ServerEventActor,
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
  chaptersModel?: (own: OwnKey, modelId: ChaptersModelId) => ChaptersModel;
}

const decodeChapters = Schema.decodeUnknownEffect(Schema.Array(chapterSchema));

type ChaptersServices =
  | DatabaseServices
  | HostedEnvironment
  | ModelCatalog
  | GitHubApp
  | HttpClient.HttpClient;

const reachedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (userId: string, id: string) {
  const { agent } = yield* reachedAgentById(userId, id);
  return agent;
});

interface ChaptersOf {
  readonly repository: string;
  readonly organizationId: string;
}

interface ChaptersSubject extends ChaptersOf {
  readonly token: Redacted.Redacted;
  readonly pullRequest: GitHubPullRequest;
}

const subjectOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  published: Effect.Effect<PublishedCache>,
  userId: string,
  agent: Agent,
  named: string | undefined,
): Effect.fn.Return<Option.Option<ChaptersSubject>, HostedRefusal, ChaptersServices> {
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
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  return Option.map(found, (pullRequest) => ({
    repository: agent.repository,
    organizationId: workspace.value,
    token,
    pullRequest,
  }));
});

const keptUnder = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: Agent,
): Effect.fn.Return<Option.Option<ChaptersOf>, HostedRefusal, ChaptersServices> {
  if (!hasRepository(agent)) return Option.none();
  const workspace = yield* githubReadRefusal(
    Effect.andThen(agentPullRequestReach(userId, agent), agentWorkspace(userId, agent)),
  );
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  return Option.some({ repository: agent.repository, organizationId: workspace.value });
});

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
      if (model === null || model === "") {
        yield* Effect.logWarning("ready chapters stood without their model");
        return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      }
      return { status: PULL_REQUEST_CHAPTERS_STATE.READY, headSha, baseSha, model, chapters };
    }
  }
});

const answerOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  of: ChaptersOf,
  number: number,
  runsOn: ChaptersRunsOn | undefined,
): Effect.fn.Return<PullRequestChaptersAnswer, HostedRefusal, DatabaseServices> {
  const row = yield* hostedStoreOrUnavailable(
    latestPullRequestChapters(of.organizationId, of.repository, number),
  );
  return {
    pullRequest: {
      number,
      generatable: runsOn !== undefined,
      ...(runsOn === undefined ? {} : { runsOn }),
      chapters: yield* stateOf(row),
    },
  };
});

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

const ownKeyFor = (userId: string) =>
  Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    return yield* hostedStoreOrUnavailable(
      ownKeyOf(userId, MODEL_PROVIDER.ANTHROPIC, environment.providerKeyEncryptionKeys),
    );
  });

const runsOnOf = (own: OwnKey): ChaptersRunsOn => ({
  provider: own.provider,
  model: chaptersModelOn(own.provider, CHAPTERS_MODEL.HAIKU),
});

const runsOnFor = (userId: string) =>
  Effect.map(ownKeyFor(userId), (own) => (own === undefined ? undefined : runsOnOf(own)));

interface GenerateOn {
  readonly model: ChaptersModel;
  readonly runsOn: ChaptersRunsOn;
}

const modelOf = (seams: PullRequestChaptersProcedureSeams, userId: string) =>
  Effect.map(ownKeyFor(userId), (own): GenerateOn | undefined =>
    own === undefined
      ? undefined
      : {
          model: (seams.chaptersModel ?? chaptersModelOf)(own, CHAPTERS_MODEL.HAIKU),
          runsOn: runsOnOf(own),
        },
  );

export const agentChaptersAdmission = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: Agent,
) {
  const [kept, runsOn] = yield* Effect.all([keptUnder(userId, agent), runsOnFor(userId)], {
    concurrency: "unbounded",
  });
  return { kept, runsOn };
});

interface GenerationCounts {
  readonly outcome: (typeof SERVER_CHAPTERS_OUTCOME)[keyof typeof SERVER_CHAPTERS_OUTCOME];
  readonly chapters: number;
  readonly hunks: number;
}

function hunksOf(generated: GeneratedChapters): number {
  return generated.chapters.reduce((sum, chapter) => sum + chapter.hunkRefs.length, 0);
}

const generated = /* @__PURE__ */ Effect.fnUntraced(function* (
  claim: ChapterClaim,
  model: ChaptersModel,
  actor: ServerEventActor<typeof SERVER_EVENT.PULL_REQUEST_CHAPTERS_GENERATE>,
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
      yield* recordServerEvent(SERVER_EVENT.PULL_REQUEST_CHAPTERS_GENERATE, actor, {
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

const generationInput = (subject: ChaptersSubject) => {
  const { token, repository, pullRequest } = subject;
  return githubReadRefusal(
    Effect.all(
      [
        pullRequestFiles(token, repository, pullRequest),
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

const generatedFor = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  on: GenerateOn,
  subject: ChaptersSubject,
) {
  const { organizationId, repository, token, pullRequest } = subject;
  const { model, runsOn } = on;
  if (pullRequest.baseSha === undefined) {
    return yield* Effect.fail(HOSTED_REFUSAL.GITHUB_UNANSWERED);
  }
  if (yield* generatingNow(subject)) {
    return yield* answerOf(subject, pullRequest.number, runsOn);
  }
  const read = yield* generationInput(subject);
  const after = yield* githubReadRefusal(
    pullRequestByNumber(token, repository, pullRequest.number),
  );
  if (Option.isNone(after)) return { pullRequest: null };
  if (after.value.headSha !== pullRequest.headSha) {
    return yield* answerOf(subject, pullRequest.number, runsOn);
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
    yield* generated(claimed.claim, model, { userId, workspaceId: organizationId }, read);
  }
  return yield* answerOf(subject, pullRequest.number, runsOn);
});

export function pullRequestChaptersProcedures(seams: PullRequestChaptersProcedureSeams) {
  const signedIn = hosted.pullRequestChapters.use(accountMiddleware(seams.resolveUserId));
  const published = seams.published ?? instancePublishedCache();
  return {
    read: signedIn.read.effect(function* ({ input, context }) {
      const agent = yield* reachedAgent(context.userId, input.id);
      const number = yield* pullRequestNumberOf([input.number]);
      if (number === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      const { kept, runsOn } = yield* agentChaptersAdmission(context.userId, agent);
      if (Option.isNone(kept)) return { pullRequest: null };
      return yield* answerOf(kept.value, number, runsOn);
    }),

    generate: signedIn.generate.effect(function* ({ input, context }) {
      const agent = yield* reachedAgent(context.userId, input.params.id);
      const on = yield* modelOf(seams, context.userId);
      if (on === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      const subject = yield* subjectOf(published, context.userId, agent, input.query?.number);
      if (Option.isNone(subject)) return { pullRequest: null };
      return yield* generatedFor(context.userId, on, subject.value);
    }),

    repositoryRead: signedIn.repositoryRead.effect(function* ({ input, context }) {
      const { subject } = yield* reachedRepository(context.userId, input);
      return yield* answerOf(subject, input.number, yield* runsOnFor(context.userId));
    }),

    repositoryGenerate: signedIn.repositoryGenerate.effect(function* ({ input, context }) {
      const { token, subject, found } = yield* reachedByNumber(
        context.userId,
        input.query,
        pullRequestByNumber,
      );
      const on = yield* modelOf(seams, context.userId);
      if (on === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* generatedFor(context.userId, on, {
        repository: subject.repository,
        organizationId: subject.organizationId,
        token,
        pullRequest: found,
      });
    }),
  };
}

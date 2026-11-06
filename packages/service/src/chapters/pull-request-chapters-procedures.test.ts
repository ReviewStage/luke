import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { writeAccountPreferences } from "@repo/database/models/account-store";
import { createAgent, updateAgentBranch } from "@repo/database/models/agent-store";
import {
  CHAPTER_CLAIM_OUTCOME,
  claimChapterGeneration,
} from "@repo/database/models/pull-request-chapters-store";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace, startTask } from "@repo/database/testing";
import { HOSTED_API_ERROR } from "@repo/features";
import { CHAPTERS_MODEL } from "@repo/features/chapters-model-choice";
import { AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@repo/features/models-wire";
import { PROVIDER_KEY_PROVIDER, type ProviderKeyProvider } from "@repo/features/provider-key-wire";
import { CHAPTER_KIND, CHAPTER_RISK } from "@repo/features/pull-request-chapters";
import {
  PULL_REQUEST_CHAPTERS_FAILURE_KIND,
  PULL_REQUEST_CHAPTERS_STATE,
  type PullRequestChaptersAnswer,
  pullRequestChaptersAnswerSchema,
} from "@repo/features/pull-request-chapters-wire";
import { unparsedWire, type WireBoundaryInput } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { MockLanguageModelV4 } from "ai/test";
import { Clock, type Context, Effect, Layer, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import { requestUserId } from "../auth/bearer.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { recordingProductAnalytics, SERVER_EVENT } from "../events/server-events.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import { modelCatalogOf, type OfferedModel } from "../providers/model-catalog.js";
import type { WebServices } from "../runtime.js";
import { AGENT_KEY_RING, connectAgentApiKeys } from "../testing/agent-credentials.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
  type RepositoryScript,
} from "../testing/github-app-fake.js";
import { type ChaptersModel, chaptersModelOf } from "./chapters-generator.js";
import { pullRequestChaptersProcedures } from "./pull-request-chapters-procedures.js";

/**
 * pull-request-chapters-procedures.test.ts -- a pull request's chapters read and generated through the hosted oRPC router, over a real dialect.
 *
 * The caller is resolved before anything is read; an agent of a workspace
 * the caller is not in is not found, and GitHub is never asked; a read
 * answers the workspace's newest chapters for the number it names, asking
 * GitHub for no pull request; a Generate claims the head, tells the chapters on a scripted
 * model, lands them or the kind they failed with, and counts the outcome by
 * counts alone, on Haiku whatever model an earlier build stored for the
 * member who pressed it; a claim another request holds answers as generating without
 * asking the model; and a deployment with no model key answers unavailable.
 * GitHub is a script, the model a mock, the store PGlite. Synthetic
 * accounts, repositories, and words throughout.
 */

const ORIGIN = "https://app.test";
const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
const BRANCH = "luke/expire-invitations";
const NUMBER = 7;
const HEAD = "c0ffee1";
const BASE = "ba5e000";

/** One installation per test's workspace, since one installation connects to one workspace and the tests share a database. */
const INSTALLATIONS: readonly InstallationFixture[] = Array.from({ length: 20 }, (_, index) => ({
  id: 9_000 + index,
  login: RELAY.owner,
  accountId: 90_000 + index,
  repositories: [RELAY],
}));
let installationsConnected = 0;

const CATALOG: readonly OfferedModel[] = [
  {
    id: AGENT_DEFAULT_CHOICE.model,
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
  },
];

const ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: AGENT_KEY_RING,
  titleAnthropicApiKey: undefined,
  previewApiKeys: {},
};

/** The one file the pull request changes, one hunk starting at old line 1. */
const FILE = {
  filename: "src/invitations.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  changes: 2,
  patch: "@@ -1 +1 @@\n-const days = 0;\n+const days = 7;",
  sha: "b".repeat(40),
};

/** The one chapter the scripted model tells, holding the one hunk. */
const TOLD = {
  chapters: [
    {
      title: "Expire invitations after a week",
      summary: "Invitations now expire.",
      hunkRefs: [{ path: FILE.filename, oldStart: 1 }],
      keyChanges: [],
      risk: CHAPTER_RISK.LOW,
      riskReasons: ["One constant."],
    },
  ],
};

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** A model that answers the chapters above, or refuses, and counts how often it was asked. */
function scriptedModel(refuses = false) {
  let asked = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      asked += 1;
      return {
        content: refuses ? [] : [{ type: "text" as const, text: JSON.stringify(TOLD) }],
        finishReason: refuses
          ? { unified: "content-filter" as const, raw: "refusal" }
          : { unified: "stop" as const, raw: "end_turn" },
        usage: USAGE,
        warnings: [],
      };
    },
  });
  const chaptersModel: ChaptersModel = { id: "scripted", model };
  return { chaptersModel, asked: () => asked };
}

/** The repository answering the pull request's reads, its head the one `head` names now. */
const pullRequestOf =
  (head: () => string, filesRead: () => void = () => undefined): RepositoryScript =>
  (sent) => {
    const repository = `/repos/${RELAY_FULL_NAME}`;
    const pull = `${repository}/pulls/${NUMBER}`;
    const path = new URL(sent.url).pathname;
    if (path === `${repository}/pulls`) return Response.json([{ number: NUMBER }]);
    if (path === pull) {
      return Response.json({
        number: NUMBER,
        title: "Expire teammate invitations",
        html_url: `https://github.com/${RELAY_FULL_NAME}/pull/${NUMBER}`,
        state: "open",
        draft: false,
        merged: false,
        merged_at: null,
        additions: 1,
        deletions: 1,
        changed_files: 1,
        body: "Invitations expire.",
        base: { ref: "main", sha: BASE },
        head: { ref: BRANCH, sha: head() },
        user: null,
      });
    }
    if (path === `${pull}/files`) {
      filesRead();
      return Response.json([FILE]);
    }
    if (path === `${pull}/commits`) {
      return Response.json([{ sha: "1".repeat(40), commit: { message: "Expire invitations" } }]);
    }
    if (path.endsWith("/check-runs")) return Response.json({ check_runs: [] });
    if (path.endsWith("/status")) return Response.json({ statuses: [] });
    return undefined;
  };

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/**
 * An owner's agent on a task of the repository, a teammate in its workspace
 * and a stranger outside it, and the chapters procedures over the test's own
 * database, GitHub, and model, the owner and the teammate each holding API
 * keys of their own, Anthropic's and OpenAI's unless told which, or none.
 */
const standing = (
  options: {
    readonly refuses?: boolean;
    /** The providers the owner and the teammate saved an API key for; both where none are named, and none at all for an account on a subscription alone. */
    readonly keys?: readonly ProviderKeyProvider[];
    /** A head pushed while the files are read, as a developer pushing mid-Generate would. */
    readonly pushedDuringFiles?: string;
  } = {},
) =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    const teammate = yield* openGithubUser();
    const stranger = yield* openGithubUser();
    const task = yield* startTask(owner, { name: "Invitations", repository: RELAY_FULL_NAME });
    yield* joinWorkspace(task.workspaceId, teammate);
    for (const member of [owner, teammate]) {
      yield* connectAgentApiKeys(
        member,
        options.keys === undefined ? {} : { providers: options.keys },
      );
    }
    const installation = INSTALLATIONS[installationsConnected++];
    assert.ok(installation !== undefined, "the suite ran out of installations");
    yield* connectWorkspaceGitHub(task.workspaceId, installation);
    const agent = Option.getOrThrow(
      yield* createAgent(owner, {
        taskId: task.id,
        descriptionSnapshot: "# Invitations",
        prompt: null,
        idempotencyKey: randomUUID(),
        model: AGENT_DEFAULT_CHOICE.model,
        effort: "low",
        repository: RELAY_FULL_NAME,
        runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
      }),
    ).agent;
    yield* updateAgentBranch(owner, agent.id, BRANCH);
    let head = HEAD;
    const github = githubReaching(
      [installation],
      undefined,
      undefined,
      pullRequestOf(
        () => head,
        () => {
          head = options.pushedDuringFiles ?? head;
        },
      ),
    );
    const model = scriptedModel(options.refuses);
    const analytics = recordingProductAnalytics();
    const services = yield* Effect.context<never>().pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
          Layer.succeed(Database, yield* Database),
          Layer.succeed(Clock.Clock, yield* Clock.Clock),
          Layer.succeed(HostedEnvironment, ENVIRONMENT),
          github.layer,
          modelCatalogOf(CATALOG),
          analytics.layer,
        ),
      ),
    );
    // SAFETY: the chapters procedures yield the database, the clock, the environment, GitHub, its HTTP client, the catalog, and the analytics alone, which is all a test provides of the web runtime's services.
    const webServices = services as Context.Context<WebServices>;
    const bearers = new Map([owner, teammate, stranger].map((id) => [`Bearer ${id}`, id]));
    const handle = hostedFetch({
      pullRequestChapters: pullRequestChaptersProcedures({
        resolveUserId: (incoming: Request) =>
          requestUserId(
            incoming,
            (input) => {
              const sub = bearers.get(input.headers.get("authorization") ?? "");
              return Effect.succeed(sub === undefined ? undefined : { sub });
            },
            () => Effect.succeed(Option.none()),
          ),
        // The scripted model answers under the provider's id production would reach on the member's key, as the store then names it.
        chaptersModel: (own, modelId) => ({
          ...model.chaptersModel,
          id: chaptersModelOf(own, modelId).id,
        }),
      }),
    });
    const ask = (
      as: string | undefined,
      init: {
        readonly method?: string;
        readonly number?: number;
        /** Each `number` the query names, repeated as a client might send them. */
        readonly numbers?: readonly string[];
        readonly body?: string;
      } = {},
    ) =>
      Effect.gen(function* () {
        const url = new URL(`/api/agents/${agent.id}/chapters`, ORIGIN);
        if (init.number !== undefined) url.searchParams.set("number", String(init.number));
        for (const more of init.numbers ?? []) url.searchParams.append("number", more);
        const headers = new Headers({ "content-type": "application/json" });
        if (as !== undefined) headers.set("authorization", `Bearer ${as}`);
        const response = yield* Effect.promise(() =>
          handle(
            new Request(url, {
              method: init.method ?? "GET",
              headers,
              ...(init.body === undefined ? undefined : { body: init.body }),
            }),
            webServices,
          ),
        );
        const text = yield* Effect.promise(() => response.text());
        // SAFETY: the router answers JSON; the test reads it as the wire value it is.
        const body = (text.length === 0 ? text : JSON.parse(text)) as WireBoundaryInput;
        return { status: response.status, body } satisfies Answer;
      });
    return {
      owner,
      teammate,
      stranger,
      organizationId: task.workspaceId,
      github,
      model,
      analytics,
      ask,
      moveHead: (to: string) => {
        head = to;
      },
    };
  });

/** The answer read through the wire schema, failing the test where the status or the body is not one. */
function chaptersOf(answer: Answer): PullRequestChaptersAnswer {
  assert.equal(answer.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(answer.body));
  const read = readEither(pullRequestChaptersAnswerSchema)(unparsedWire(answer.body));
  if (Result.isFailure(read)) assert.fail(`not the answer: ${JSON.stringify(answer.body)}`);
  return read.success;
}

const refused = (status: number, error: string) => ({ status, body: { error } });

/** What a member who saved both keys may generate on, Anthropic's first as the providers' own order puts it. */
const BOTH_CHOICES = [
  { provider: MODEL_PROVIDER.ANTHROPIC, model: CHAPTERS_MODEL.HAIKU },
  { provider: MODEL_PROVIDER.OPENAI, model: "gpt-6-luna" },
];

it.layer(getTestDB())("a pull request's chapters", (it) => {
  it.effect(
    "an unsigned caller is refused as unauthenticated on both procedures, before the agent or a body is read",
    () =>
      Effect.gen(function* () {
        const { ask } = yield* standing();
        const unauthenticated = refused(
          HOSTED_HTTP_STATUS.UNAUTHORIZED,
          HOSTED_API_ERROR.INVALID_TOKEN,
        );
        assert.deepEqual(yield* ask(undefined), unauthenticated);
        assert.deepEqual(
          yield* ask(undefined, { method: "POST", body: '{"chapters":1}' }),
          unauthenticated,
        );
      }),
  );

  it.effect(
    "an account outside the agent's workspace is answered not found, and nothing is asked of GitHub",
    () =>
      Effect.gen(function* () {
        const { stranger, github, model, ask } = yield* standing();
        const notFound = refused(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
        assert.deepEqual(yield* ask(stranger, { number: NUMBER }), notFound);
        assert.deepEqual(yield* ask(stranger, { method: "POST", number: NUMBER }), notFound);
        assert.equal(github.sent.length, 0);
        assert.equal(model.asked(), 0);
      }),
  );

  it.effect(
    "a read before any Generate answers no chapters, and what the reader's Generate would run on, Haiku on their Anthropic key where they saved both with both offered, asking GitHub for no pull request: nothing where they saved no API key, since Vespin's own key tells no chapters",
    () =>
      Effect.gen(function* () {
        const { owner, github, ask } = yield* standing();
        assert.deepEqual(chaptersOf(yield* ask(owner, { number: NUMBER })), {
          pullRequest: {
            number: NUMBER,
            generatable: true,
            runsOn: { provider: MODEL_PROVIDER.ANTHROPIC, model: CHAPTERS_MODEL.HAIKU },
            runsOnChoices: BOTH_CHOICES,
            chapters: { status: PULL_REQUEST_CHAPTERS_STATE.NONE },
          },
        });
        assert.ok(!github.sent.some((sent) => new URL(sent.url).pathname.includes("/pulls")));
        const keyless = yield* standing({ keys: [] });
        const read = chaptersOf(yield* keyless.ask(keyless.owner, { number: NUMBER }));
        assert.equal(read.pullRequest?.generatable, false);
        assert.equal(read.pullRequest?.runsOn, undefined);
      }),
  );

  it.effect(
    "a Generate tells the chapters for the head, every member of the workspace reads them, and a read once the head moves answers them made for the head they were",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, organizationId, analytics, ask, moveHead } = yield* standing();
        const generated = chaptersOf(yield* ask(owner, { method: "POST", number: NUMBER }));
        const ready = {
          status: PULL_REQUEST_CHAPTERS_STATE.READY,
          headSha: HEAD,
          baseSha: BASE,
          model: CHAPTERS_MODEL.HAIKU,
          chapters: [{ kind: CHAPTER_KIND.STORY, ...TOLD.chapters[0] }],
        };
        assert.deepEqual(generated, {
          pullRequest: {
            number: NUMBER,
            generatable: true,
            runsOn: { provider: MODEL_PROVIDER.ANTHROPIC, model: CHAPTERS_MODEL.HAIKU },
            runsOnChoices: BOTH_CHOICES,
            chapters: ready,
          },
        });
        assert.deepEqual(chaptersOf(yield* ask(teammate, { number: NUMBER })), generated);
        assert.deepEqual(
          analytics.recorded.filter(
            (event) => event.name === SERVER_EVENT.PULL_REQUEST_CHAPTERS_GENERATE,
          ),
          [
            {
              name: SERVER_EVENT.PULL_REQUEST_CHAPTERS_GENERATE,
              userId: owner,
              workspaceId: organizationId,
              properties: { outcome: "ready", chapters: 1, hunks: 1, duration_ms: 0 },
            },
          ],
        );

        moveHead("d00d000");
        const stale = chaptersOf(yield* ask(teammate, { number: NUMBER }));
        assert.deepEqual(stale.pullRequest?.chapters, ready);
      }),
  );

  it.effect(
    "a generation the model refuses lands as failed by its kind, counted with no chapters",
    () =>
      Effect.gen(function* () {
        const { owner, analytics, ask } = yield* standing({ refuses: true });
        const answer = chaptersOf(yield* ask(owner, { method: "POST", number: NUMBER }));
        assert.deepEqual(answer.pullRequest?.chapters, {
          status: PULL_REQUEST_CHAPTERS_STATE.FAILED,
          headSha: HEAD,
          baseSha: BASE,
          failureKind: PULL_REQUEST_CHAPTERS_FAILURE_KIND.MODEL_REFUSED,
        });
        assert.deepEqual(
          analytics.recorded.map((event) => event.properties),
          [{ outcome: "model_refused", chapters: 0, hunks: 0, duration_ms: 0 }],
        );
      }),
  );

  it.effect(
    "a Generate while another request holds the head's claim answers as generating, and neither the diff nor the model is asked for",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, organizationId, model, github, ask } = yield* standing();
        const now = new Date(yield* Clock.currentTimeMillis);
        const held = yield* claimChapterGeneration({
          organizationId,
          repository: RELAY_FULL_NAME,
          pullRequestNumber: NUMBER,
          baseSha: BASE,
          headSha: HEAD,
          requestedBy: teammate,
          now,
        });
        assert.equal(held.outcome, CHAPTER_CLAIM_OUTCOME.CLAIMED);
        const answer = chaptersOf(yield* ask(owner, { method: "POST", number: NUMBER }));
        assert.deepEqual(answer.pullRequest?.chapters, {
          status: PULL_REQUEST_CHAPTERS_STATE.GENERATING,
          headSha: HEAD,
          baseSha: BASE,
          startedAt: now.getTime(),
        });
        assert.equal(model.asked(), 0);
        assert.equal(
          github.sent.some((sent) => new URL(sent.url).pathname.endsWith("/files")),
          false,
        );
      }),
  );

  it.effect(
    "a head pushed while a Generate reads the diff is answered as it now stands, nothing generated under the head the diff no longer is",
    () =>
      Effect.gen(function* () {
        const { owner, model, analytics, ask } = yield* standing({ pushedDuringFiles: "d00d000" });
        assert.deepEqual(chaptersOf(yield* ask(owner, { method: "POST", number: NUMBER })), {
          pullRequest: {
            number: NUMBER,
            generatable: true,
            runsOn: { provider: MODEL_PROVIDER.ANTHROPIC, model: CHAPTERS_MODEL.HAIKU },
            runsOnChoices: BOTH_CHOICES,
            chapters: { status: PULL_REQUEST_CHAPTERS_STATE.NONE },
          },
        });
        assert.equal(model.asked(), 0);
        assert.deepEqual(analytics.recorded, []);
      }),
  );

  it.effect(
    "a Generate by a member who saved no API key is refused as unavailable, and a body that names a key is refused as invalid",
    () =>
      Effect.gen(function* () {
        const keyless = yield* standing({ keys: [] });
        assert.deepEqual(
          yield* keyless.ask(keyless.owner, { method: "POST", number: NUMBER }),
          refused(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
        );
        assert.equal(keyless.model.asked(), 0);
        const { owner, ask } = yield* standing();
        assert.deepEqual(
          yield* ask(owner, { method: "POST", number: NUMBER, body: '{"head":"x"}' }),
          refused(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
      }),
  );

  it.effect(
    "a query naming the number twice, or naming no number, is refused as invalid on both procedures, and nothing is read or generated",
    () =>
      Effect.gen(function* () {
        const { owner, github, model, ask } = yield* standing();
        const invalid = refused(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        for (const method of ["GET", "POST"]) {
          assert.deepEqual(yield* ask(owner, { method, numbers: ["7", "8"] }), invalid, method);
          assert.deepEqual(yield* ask(owner, { method, numbers: ["seven"] }), invalid, method);
        }
        assert.equal(
          github.sent.some((sent) => new URL(sent.url).pathname.includes("/pulls")),
          false,
        );
        assert.equal(model.asked(), 0);
      }),
  );

  it.effect(
    "a Generate runs on Haiku, even for a member whose earlier build stored another model, and the chapters stay the workspace's",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, ask } = yield* standing();
        yield* writeAccountPreferences(teammate, { chaptersModel: CHAPTERS_MODEL.OPUS });
        const answer = chaptersOf(yield* ask(teammate, { method: "POST", number: NUMBER }));
        const chapters = answer.pullRequest?.chapters;
        assert.equal(chapters?.status, PULL_REQUEST_CHAPTERS_STATE.READY);
        assert.equal("model" in chapters ? chapters.model : undefined, CHAPTERS_MODEL.HAIKU);
        assert.deepEqual(chaptersOf(yield* ask(owner, { number: NUMBER })), answer);
      }),
  );

  it.effect(
    "a member who saved both keys and last picked OpenAI's is offered both and told their Generate runs on OpenAI's model, and it does, while one who picked OpenAI's but saved only an Anthropic key runs on Anthropic's with nothing to pick",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* standing();
        yield* writeAccountPreferences(owner, { chaptersModel: "gpt-6-luna" });
        const read = chaptersOf(yield* ask(owner, { number: NUMBER }));
        assert.deepEqual(read.pullRequest?.runsOn, {
          provider: MODEL_PROVIDER.OPENAI,
          model: "gpt-6-luna",
        });
        assert.deepEqual(read.pullRequest?.runsOnChoices, BOTH_CHOICES);
        const answer = chaptersOf(yield* ask(owner, { method: "POST", number: NUMBER }));
        const chapters = answer.pullRequest?.chapters;
        assert.equal(chapters?.status, PULL_REQUEST_CHAPTERS_STATE.READY);
        assert.equal("model" in chapters ? chapters.model : undefined, "gpt-6-luna");

        const anthropicOnly = yield* standing({ keys: [PROVIDER_KEY_PROVIDER.ANTHROPIC] });
        yield* writeAccountPreferences(anthropicOnly.owner, { chaptersModel: "gpt-6-luna" });
        const fallen = chaptersOf(
          yield* anthropicOnly.ask(anthropicOnly.owner, { number: NUMBER }),
        );
        assert.deepEqual(fallen.pullRequest?.runsOn, {
          provider: MODEL_PROVIDER.ANTHROPIC,
          model: CHAPTERS_MODEL.HAIKU,
        });
        assert.equal(fallen.pullRequest?.runsOnChoices, undefined, "one key offers no choice");
      }),
  );

  it.effect(
    "a member who saved only an OpenAI key is told their Generate runs on OpenAI's model of Haiku's tier on that key, it does, and the chapters name it",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* standing({ keys: [PROVIDER_KEY_PROVIDER.OPENAI] });
        const read = chaptersOf(yield* ask(owner, { number: NUMBER }));
        assert.equal(read.pullRequest?.generatable, true);
        assert.deepEqual(read.pullRequest?.runsOn, {
          provider: MODEL_PROVIDER.OPENAI,
          model: "gpt-6-luna",
        });
        const answer = chaptersOf(yield* ask(owner, { method: "POST", number: NUMBER }));
        const chapters = answer.pullRequest?.chapters;
        assert.equal(chapters?.status, PULL_REQUEST_CHAPTERS_STATE.READY);
        assert.equal("model" in chapters ? chapters.model : undefined, "gpt-6-luna");
      }),
  );
});

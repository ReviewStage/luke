import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "@repo/database/core/query";
import { writeAccountPreferences } from "@repo/database/models/account-store";
import { readAgent } from "@repo/database/models/agent-store";
import { claimRuntimeSession } from "@repo/database/models/recorded-session";
import { saveDescriptionText } from "@repo/database/models/task-store";
import { storeWriter } from "@repo/database/models/writer";
import { user } from "@repo/database/schemas/auth";
import { conversations, messages } from "@repo/database/schemas/storage";
import { fakeWorkspaceSeams, startTask } from "@repo/database/testing";
import { firstMessageParts } from "@repo/features/agent-replay";
import {
  type AgentTranscriptMessage,
  agentAnswerSchema,
  agentMessageAnswerSchema,
  agentMessagesAnswerSchema,
} from "@repo/features/agent-wire";
import { INBOX_ASK_STATUS, INBOX_IMAGE_TYPE, type InboxItem } from "@repo/features/inbox-wire";
import { AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@repo/features/models-wire";
import { EXPERIMENT } from "@repo/settings";
import { unparsedWire, type WireBoundaryInput } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import {
  Clock,
  type Context,
  Duration,
  Effect,
  Fiber,
  Latch,
  Layer,
  Option,
  Redacted,
  Result,
  type Schema,
} from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { agentPullRequestProcedures } from "../agents/agent-pull-request-procedures.js";
import { agentsApp } from "../agents/agents-app.js";
import { agentsProcedures } from "../agents/agents-procedures.js";
import type { MessageReceivedPart } from "../agents/attached-files.js";
import { CODER } from "../agents/coder-host/bounds.js";
import { NATIVE_SESSION_PREFIX } from "../agents/coder-host/native-runtime.js";
import { instancePublishedCache } from "../agents/coder-host/published.js";
import type { SummaryModelOf } from "../agents/coder-host/replay-summary.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import {
  type AgentSessions,
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  EveUnreachable,
} from "../agents/eve-host/eve-sessions.js";
import { messagesProcedures } from "../agents/messages-procedures.js";
import { type SandboxStopReach, sessionSandboxesLayer } from "../agents/session-sandboxes.js";
import { AgentSandbox } from "../agents/terminal/agent-sandbox.js";
import { requestUserId } from "../auth/bearer.js";
import {
  isRecord,
  isWireString,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  sessionKey,
  TURN_ORIGIN,
  TURN_TRIGGER,
  userMetadataOf,
} from "../core.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { recordingProductAnalytics } from "../events/server-events.js";
import { LINK_OUTCOME } from "../github/github-installations.js";
import { PULL_REQUEST_QUEUED_OPERATION } from "../github/pull-request-merging.js";
import type { AfterResponse } from "../http/after-response.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { type InboxTitleModelOf, inboxProcedures } from "../inbox/inbox-procedures.js";
import type { postInboxThread } from "../inbox/inbox-store.js";
import { type MemberMcpAuth, memberMcpApp } from "../member-mcp/app.js";
import { hostedFetch } from "../orpc/handler.js";
import { modelCatalogOf, type OfferedModel } from "../providers/model-catalog.js";
import type { WebServices } from "../runtime.js";
import { tasksProcedures } from "../tasks/tasks-procedures.js";
import { AGENT_KEY_RING, connectAgentApiKeys } from "../testing/agent-credentials.js";
import {
  connectWorkspaceGitHub,
  type FakeGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
  type RepositoryScript,
  type SentToGitHub,
  standingGithubRow,
} from "../testing/github-app-fake.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import { harnessFor, scriptedHarnessLayer } from "../testing/native-harness-fake.js";
import { keepAwakeDetached } from "../testing/session-sandboxes-fake.js";
import { sandboxFetchOver } from "../testing/vercel-sandbox-fake.js";
import { SentryApp, sentryAppService } from "../triggers/sentry/sentry-app-config.js";

export const ORIGIN = "https://app.test";
export const TASK_AGENTS = "/api/plans/agents";
export const AGENT_MESSAGES = "/api/agents/messages";
export const SUBAGENT_MESSAGES = "/api/agents/subagent-messages";
export const AGENT_NEWEST = "/api/agents/messages-newest";
export const SUBAGENT_NEWEST = "/api/agents/subagent-messages-newest";
export const AGENT_STARTS = "/api/agents/agents";
export const AGENT = "/api/agents/agent";
export const AGENT_INBOX = "/api/agents/{id}/inbox";
export const AGENT_WORKSPACE_TOOLS = "/api/agents/workspace-tools";
export const WORKSPACE_AGENTS = "/api/agents";
export const AGENT_OVERVIEW = [
  "/api/agents/overview-pull-request",
  "/api/agents/overview-checks",
  "/api/agents/overview-conversation",
] as const;
const INBOX_PROCEDURE_PATH = /^\/api\/(?:inbox(?:\/.*)?|(?:plans|agents)\/[^/]+\/inbox)$/u;
export const TASKS = "/api/plans";
export const TASK = (taskId: string) => `${TASKS}/${taskId}`;
const TASK_PATH =
  /^\/api\/plans\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/stop|\/messages)?$/u;
const TRANSCRIPT_PART_PATH =
  /^\/api\/agents\/[^/]+\/(?:subagents\/[^/]+\/)?messages\/[^/]+\/parts\/[^/]+$/u;

export const RELAY = { owner: "Acme", name: "Relay" } as const;
export const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;

export const AGENT_GITHUB_IMAGE = "/api/agents/github-image";

export const SCRIPTED_SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/plans")</script></svg>',
);

let installationsConnected = 0;

export function freshInstallation(
  repositories: InstallationFixture["repositories"] = [RELAY],
): InstallationFixture {
  installationsConnected += 1;
  return { id: 7 + installationsConnected, login: RELAY.owner, repositories };
}

export const SAVED =
  "## Goal\n\nInvite a teammate by email.\n\n## Assumptions\n\n- Invites expire after 7 days.\n";

export const SNAPSHOT = `# Teammate invitations\n\n${SAVED}`;

export const SOL = "openai/gpt-6.1-sol";

const GPT_LONG = "openai/gpt-5.5";

export const LONG_TURNS = 30;

export const SMALL_WINDOW = { model: "anthropic/claude-sonnet-4.9", tokens: 60_000 } as const;

const CATALOG: readonly OfferedModel[] = [
  {
    id: SMALL_WINDOW.model,
    name: "Claude Sonnet 4.9",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
    contextWindow: SMALL_WINDOW.tokens,
  },
  {
    id: AGENT_DEFAULT_CHOICE.model,
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
    pricing: { inputUsd: 0.000004, outputUsd: 0.00002, cachedInputUsd: 0.0000002 },
  },
  {
    id: SOL,
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
    pricing: { inputUsd: 0.000002, outputUsd: 0.00001, cachedInputUsd: 0.000001 },
  },
  {
    id: GPT_LONG,
    name: "GPT-5.5",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
    contextWindow: 1_050_000,
    contextWindows: { standardTokens: 272_000, longTokens: 1_050_000 },
  },
];

export interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

interface Opened {
  readonly authorization: string;
  readonly message: EveMessage;
  readonly sessionId: string;
}

interface Sent {
  readonly authorization: string;
  readonly sessionId: string;
  readonly message: EveMessage;
}

export type SendAnswer =
  | typeof EVE_SEND_OUTCOME.ACCEPTED
  | typeof EVE_SEND_OUTCOME.NOT_READY
  | typeof EVE_SEND_OUTCOME.RETIRED
  | typeof EVE_SEND_OUTCOME.FAILED;

export function sessionCookieOf(userId: string): string {
  return `better-auth.session_token=${userId}`;
}

export function deploymentFor(account: string): string {
  return `deployment for ${account}`;
}

export function fakeEve(
  options: {
    readonly reachable?: boolean;
    readonly cancels?: boolean;
    readonly sends?: SendAnswer;
    readonly cancelsTogether?: number;
    readonly resetSees?: Effect.Effect<boolean>;
    readonly canceling?: Effect.Effect<void>;
  } = {},
) {
  const together = Latch.makeUnsafe(options.cancelsTogether === undefined);
  const opened: Opened[] = [];
  const sent: Sent[] = [];
  const canceled: (readonly [string, string])[] = [];
  const canceledAs: string[] = [];
  const reset: string[] = [];
  const resetAs: string[] = [];
  const resetSaw: boolean[] = [];
  let sessions = 0;
  let deliveries = 0;
  const eve = (authorization: string): AgentSessions => ({
    open: (message) =>
      Effect.suspend(() => {
        if (options.reachable === false) {
          return Effect.fail(
            new EveUnreachable({
              cause: {
                _tag: "RequestError",
                reason: { _tag: "TransportError" },
                message: "refused",
              } as never,
            }),
          );
        }
        sessions += 1;
        const sessionId = `${NATIVE_SESSION_PREFIX.claude_code}${String(sessions).padStart(22, "0")}`;
        opened.push({ authorization, message, sessionId });
        return Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId });
      }),
    send: (sessionId, message) =>
      Effect.sync(() => {
        sent.push({ authorization, sessionId, message });
        switch (options.sends ?? EVE_SEND_OUTCOME.ACCEPTED) {
          case EVE_SEND_OUTCOME.ACCEPTED:
            deliveries += 1;
            return {
              outcome: EVE_SEND_OUTCOME.ACCEPTED,
              sessionId,
              deliveryId: `delivery-${deliveries}`,
            };
          case EVE_SEND_OUTCOME.NOT_READY:
            return { outcome: EVE_SEND_OUTCOME.NOT_READY };
          case EVE_SEND_OUTCOME.RETIRED:
            return { outcome: EVE_SEND_OUTCOME.RETIRED };
          case EVE_SEND_OUTCOME.FAILED:
            return { outcome: EVE_SEND_OUTCOME.FAILED, status: 500 };
        }
      }),
    cancel: (sessionId, eveTurnId) =>
      Effect.suspend(() => {
        canceled.push([sessionId, eveTurnId]);
        canceledAs.push(authorization);
        if (canceled.length >= (options.cancelsTogether ?? 0)) together.openUnsafe();
        return Effect.as(
          Effect.andThen(together.await, options.canceling ?? Effect.void),
          options.cancels === false
            ? { outcome: EVE_CANCEL_OUTCOME.FAILED, status: 403 }
            : { outcome: EVE_CANCEL_OUTCOME.ACCEPTED },
        );
      }),
    reset: (sessionId) =>
      Effect.flatMap(options.resetSees ?? Effect.succeed(true), (saw) =>
        Effect.sync(() => {
          reset.push(sessionId);
          resetAs.push(authorization);
          resetSaw.push(saw);
          return { outcome: EVE_RESET_OUTCOME.RESET };
        }),
      ),
  });
  return { eve, opened, sent, canceled, canceledAs, reset, resetAs, resetSaw };
}

const NO_KEYS: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: AGENT_KEY_RING,
  titleAnthropicApiKey: undefined,
};

const ANALYTICS = recordingProductAnalytics();

export const countedFor = (userId: string, name: string) => countedWith(userId, name).length;

export const countedWith = (userId: string, name: string) =>
  ANALYTICS.recorded
    .filter((event) => event.userId === userId && event.name === name)
    .map((event) => event.properties);

export const countedProperties = (userId: string, name: string) =>
  ANALYTICS.recorded
    .filter((event) => event.userId === userId && event.name === name)
    .map((event) => event.properties);

const ORPC_PUBLIC_PATH: ReadonlyMap<string, (id: string) => string> = new Map([
  ["/api/plans/agents", (id: string) => `/api/plans/${id}/agents`],
  ["/api/agents/agent", (id: string) => `/api/agents/${id}`],
  ["/api/agents/calls", (id: string) => `/api/agents/${id}/calls`],
  ["/api/agents/stop", (id: string) => `/api/agents/${id}/stop`],
  ["/api/agents/queue", (id: string) => `/api/agents/${id}/queue`],
  ["/api/agents/agents", (id: string) => `/api/agents/${id}/agents`],
  ["/api/agents/messages-newest", (id: string) => `/api/agents/${id}/messages/newest`],
  ["/api/agents/changes", (id: string) => `/api/agents/${id}/changes`],
  ["/api/agents/review-options", (id: string) => `/api/agents/${id}/review-options`],
  ["/api/agents/workspace-tools", (id: string) => `/api/agents/${id}/workspace-tools`],
  ["/api/agents/pull-request", (id: string) => `/api/agents/${id}/pull-request`],
  ["/api/agents/pull-request-action", (id: string) => `/api/agents/${id}/pull-request/action`],
  ["/api/agents/pull-request-viewed", (id: string) => `/api/agents/${id}/pull-request/viewed`],
  ["/api/agents/overview-pull-request", (id: string) => `/api/agents/${id}/overview/pull-request`],
  ["/api/agents/overview-checks", (id: string) => `/api/agents/${id}/overview/checks`],
  ["/api/agents/overview-conversation", (id: string) => `/api/agents/${id}/overview/conversation`],
]);

function publicRequest(request: Request): Request | undefined {
  const url = new URL(request.url);
  const publicPath = ORPC_PUBLIC_PATH.get(url.pathname);
  if (publicPath === undefined) return undefined;
  url.pathname = publicPath(encodeURIComponent(url.searchParams.get("id") ?? ""));
  return new Request(url, request);
}

export const standing = (
  bearers: ReadonlyMap<string, string>,
  github: FakeGitHub,
  eve: ReturnType<typeof fakeEve>,
  summaryModel: SummaryModelOf = () => Effect.succeed(undefined),
  sessionSandboxes: SandboxStopReach["sessionSandboxes"] = sessionSandboxesLayer,
  titleModel: InboxTitleModelOf = () => Effect.succeed(undefined),
  afterResponse: Layer.Layer<AfterResponse> | Layer.Layer<never> = Layer.empty,
) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const services = Layer.mergeAll(
      afterResponse,
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, NO_KEYS),
      scriptedHarnessLayer((account) => eve.eve(harnessFor(account))),
      github.layer,
      sandboxFetchOver(github.respond),
      modelCatalogOf(CATALOG),
      integrationConnectOf(() => CONNECTOR_ASKED_NOTHING),
      Layer.succeed(SentryApp, sentryAppService(undefined, [])),
      ANALYTICS.layer,
    );
    const sessions = new Map(
      [...bearers.values()].map((userId) => [sessionCookieOf(userId), userId]),
    );
    const seams = {
      resolveUserId: (incoming: Request) =>
        requestUserId(
          incoming,
          (input) => {
            const sub = bearers.get(input.headers.get("authorization") ?? "");
            return Effect.succeed(sub === undefined ? undefined : { sub });
          },
          (input) =>
            Effect.succeed(Option.fromNullishOr(sessions.get(input.headers.get("cookie") ?? ""))),
        ),
      eve: (authorization: Redacted.Redacted) => eve.eve(Redacted.value(authorization)),
      eveAs: (account: string) => eve.eve(deploymentFor(account)),
      workspaces: yield* fakeWorkspaceSeams,
      summaryModel,
      sessionSandboxes,
      titleModel,
      keepAwake: keepAwakeDetached,
    };
    const agents = HttpRouter.toWebHandler(
      agentsApp(seams).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const webServices = (yield* Effect.context<never>().pipe(
      Effect.provide(services),
    )) as Context.Context<WebServices>;
    const shared = { ...seams, published: instancePublishedCache() };
    const routed = hostedFetch({
      agentPullRequests: agentPullRequestProcedures(shared),
      agents: agentsProcedures({
        ...shared,
        sandbox: Layer.effect(AgentSandbox, Effect.die("the agents routes reach no sandbox")),
      }),
      inbox: inboxProcedures(seams),
      messages: messagesProcedures(seams),
      plans: tasksProcedures(seams),
    });
    yield* Effect.addFinalizer(() => Effect.promise(() => agents.dispose()));
    const memberMcp = HttpRouter.toWebHandler(
      memberMcpApp(memberMcpBearers(bearers)).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => memberMcp.dispose()));
    const fetch = (request: Request) =>
      Effect.promise(() => {
        const procedure = publicRequest(request);
        if (procedure !== undefined) return routed(procedure, webServices);
        const url = new URL(request.url);
        const { pathname } = url;
        if (pathname !== INBOX_ATTACHMENT && INBOX_PROCEDURE_PATH.test(pathname)) {
          return routed(request, webServices);
        }
        const id = url.searchParams.get("id");
        if (pathname === AGENT_MESSAGES && id !== null) {
          url.pathname = `/api/agents/${encodeURIComponent(id)}/messages`;
          return routed(new Request(url, request), webServices);
        }
        const call = url.searchParams.get("call");
        if (pathname === SUBAGENT_MESSAGES && id !== null && call !== null) {
          url.pathname = `/api/agents/${encodeURIComponent(id)}/subagents/${encodeURIComponent(call)}/messages`;
          return routed(new Request(url, request), webServices);
        }
        if (pathname === SUBAGENT_NEWEST && id !== null && call !== null) {
          url.pathname = `/api/agents/${encodeURIComponent(id)}/subagents/${encodeURIComponent(call)}/messages/newest`;
          return routed(new Request(url, request), webServices);
        }
        if (pathname === WORKSPACE_AGENTS || TRANSCRIPT_PART_PATH.test(pathname)) {
          return routed(request, webServices);
        }
        return pathname === TASKS || TASK_PATH.test(pathname)
          ? routed(request, webServices)
          : agents.handler(request);
      });
    const ask = (request: Request) =>
      Effect.gen(function* () {
        const response = yield* fetch(request);
        const text = yield* Effect.promise(() => response.text());
        const body = (text.length === 0 ? text : JSON.parse(text)) as WireBoundaryInput;
        return { status: response.status, body } satisfies Answer;
      });
    const mcpFetch = (input: string | URL | Request, init?: RequestInit) =>
      memberMcp.handler(new Request(input, init));
    return { ask, fetch, mcpFetch };
  });

const MEMBER_MCP_CLIENT_ID = "member-mcp-test";

function memberMcpBearers(bearers: ReadonlyMap<string, string>): MemberMcpAuth {
  return {
    verify: (incoming) => {
      const sub = bearers.get(incoming.headers.get("authorization") ?? "");
      return sub === undefined
        ? Promise.reject(new Error("the member MCP server's test admits no such bearer"))
        : Promise.resolve({ sub, client_id: MEMBER_MCP_CLIENT_ID });
    },
    metadata: () => Promise.resolve({}),
  };
}

const ID_SEGMENT = "{id}";

export function request(
  path: string,
  bearer: string | undefined,
  init: {
    method?: string;
    body?: WireBoundaryInput;
    id?: string;
    after?: string;
    call?: string;
    wait?: string;
    before?: string;
    parts?: string;
    archived?: string | undefined;
    attachment?: string;
    picture?: string;
    src?: string;
    number?: string;
    cookie?: string;
  } = {},
): Request {
  const named = path.includes(ID_SEGMENT);
  const url = new URL(
    named && init.id !== undefined ? path.replace(ID_SEGMENT, encodeURIComponent(init.id)) : path,
    ORIGIN,
  );
  if (init.id !== undefined && !named) url.searchParams.set("id", init.id);
  if (init.archived !== undefined) url.searchParams.set("archived", init.archived);
  if (init.after !== undefined) url.searchParams.set("after", init.after);
  if (init.call !== undefined) url.searchParams.set("call", init.call);
  if (init.wait !== undefined) url.searchParams.set("wait", init.wait);
  if (init.before !== undefined) url.searchParams.set("before", init.before);
  if (init.parts !== undefined) url.searchParams.set("parts", init.parts);
  if (init.attachment !== undefined) url.searchParams.set("attachment", init.attachment);
  if (init.picture !== undefined) url.searchParams.set("picture", init.picture);
  if (init.src !== undefined) url.searchParams.set("src", init.src);
  if (init.number !== undefined) url.searchParams.set("number", init.number);
  const headers = new Headers();
  if (bearer !== undefined) headers.set("authorization", `Bearer ${bearer}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.cookie !== undefined) headers.set("cookie", init.cookie);
  return new Request(url, {
    method: init.method ?? "GET",
    headers,
    ...(init.body === undefined ? undefined : { body: JSON.stringify(init.body) }),
  });
}

export function readAnswer<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  status: number,
  answered: Answer,
): S["Type"] {
  assert.equal(answered.status, status, JSON.stringify(answered.body));
  const read = readEither(schema)(unparsedWire(answered.body));
  if (Result.isFailure(read))
    return assert.fail(`the answer is not the wire's: ${read.failure.refusal}`);
  return read.success;
}

export const refusal = (status: number, error: string): Answer => ({ status, body: { error } });

const STARTING_READ_STEPS =
  Math.floor(
    (Duration.toMillis(CODER.STARTING_GRACE) - Duration.toMillis(CODER.MESSAGES_HOLD)) /
      Duration.toMillis(CODER.MESSAGES_POLL),
  ) - 1;

export const drivenWhileStarting = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < STARTING_READ_STEPS; attempt += 1) {
      if (fiber.pollUnsafe() !== undefined) return yield* Fiber.join(fiber);
      yield* Effect.orDie(
        Database.use((db) => db.select({ id: conversations.id }).from(conversations).limit(1)),
      );
      yield* TestClock.adjust(CODER.MESSAGES_POLL);
      yield* Effect.yieldNow;
    }
    return yield* Fiber.join(fiber);
  });

export const openTask = (
  options: {
    readonly repository?: string | null;
    readonly eve?: ReturnType<typeof fakeEve>;
    readonly github?: RepositoryScript;
    readonly otherToken?: string | null;
    readonly summaryModel?: SummaryModelOf;
    readonly sessionSandboxes?: SandboxStopReach["sessionSandboxes"];
    readonly titleModel?: InboxTitleModelOf;
    readonly afterResponse?: Layer.Layer<AfterResponse>;
  } = {},
) =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    const other = yield* otherAccount(options.otherToken);
    yield* connectAgentApiKeys(owner);
    yield* connectAgentApiKeys(other);
    const task = yield* startTask(owner, {
      name: "Teammate invitations",
      repository: options.repository === undefined ? RELAY_FULL_NAME : options.repository,
    });
    yield* saveDescriptionText(owner, task.id, SAVED);
    for (const account of [owner, other]) {
      yield* writeAccountPreferences(account, { experiments: { [EXPERIMENT.DESCRIPTIONS]: true } });
    }
    const installation = freshInstallation();
    assert.equal(
      yield* connectWorkspaceGitHub(task.workspaceId, installation),
      LINK_OUTCOME.LINKED,
    );
    const bearers = new Map([
      [`Bearer ${owner}`, owner],
      [`Bearer ${other}`, other],
    ]);
    const github = githubReaching([installation], undefined, undefined, options.github);
    const eve = options.eve ?? fakeEve();
    const { ask, fetch, mcpFetch } = yield* standing(
      bearers,
      github,
      eve,
      options.summaryModel,
      options.sessionSandboxes,
      options.titleModel,
      options.afterResponse,
    );
    return { owner, other, task, installation, eve, github, ask, fetch, mcpFetch };
  });

const otherAccount = (token: string | null | undefined) =>
  Effect.gen(function* () {
    if (token === undefined) return yield* openGithubUser();
    if (token !== null) {
      return yield* openGithubUser({
        ...standingGithubRow(yield* Clock.currentTimeMillis),
        accessToken: token,
      });
    }
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
    return userId;
  });

export const PUBLISHED = {
  branch: "luke/teammate-invitations",
  number: 12,
  headSha: "c0ffee1",
} as const;

export const publishedPullRequestDrafted =
  (draft: () => boolean, headSha: string = PUBLISHED.headSha): RepositoryScript =>
  (sent) => {
    const repository = `/repos/${RELAY.owner}/${RELAY.name}`;
    const pull = `${repository}/pulls/${PUBLISHED.number}`;
    const commit = `${repository}/commits/${PUBLISHED.headSha}`;
    const head = `${repository}/commits/refs%2Fpull%2F${PUBLISHED.number}%2Fhead`;
    switch (new URL(sent.url).pathname) {
      case `${repository}/pulls`:
        return Response.json([{ number: PUBLISHED.number }]);
      case pull:
        return Response.json({
          number: PUBLISHED.number,
          title: "Expire teammate invitations",
          html_url: `https://github.com/${RELAY_FULL_NAME}/pull/${PUBLISHED.number}`,
          state: "open",
          draft: draft(),
          merged: false,
          merged_at: null,
          additions: 4,
          deletions: 1,
          changed_files: 1,
          body: "Invitations expire.",
          body_html: "<p>Invitations expire.</p>",
          base: { ref: "main" },
          head: { ref: PUBLISHED.branch, sha: headSha },
          created_at: "2026-10-15T09:00:00Z",
          mergeable_state: "clean",
          user: null,
          requested_reviewers: [],
        });
      case `${commit}/check-runs`:
      case `${head}/check-runs`:
        return Response.json({ check_runs: [] });
      case `${commit}/status`:
      case `${head}/status`:
        return Response.json({ statuses: [] });
      case `${repository}/issues/${PUBLISHED.number}/comments`:
      case `${pull}/reviews`:
        return Response.json([]);
      default:
        return undefined;
    }
  };

export const publishedPullRequest = publishedPullRequestDrafted(() => false);

export function reachRequests(sent: readonly SentToGitHub[], installationId: number) {
  const app = `https://api.github.com/app/installations/${installationId}`;
  const mints = sent.filter((one) => one.url === `${app}/access_tokens`);
  const forRepository = (one: SentToGitHub) => "repositories" in JSON.parse(one.body);
  return {
    installationReads: sent.filter((one) => one.url === app).length,
    listings: sent.filter((one) => new URL(one.url).pathname === "/installation/repositories")
      .length,
    listingMints: mints.filter((one) => !forRepository(one)).length,
    repositoryMints: mints.filter(forRepository).length,
  };
}

export const AGENT_PULL_REQUEST_ACTION = "/api/agents/pull-request-action";
export const AGENT_PULL_REQUEST_VIEWED = "/api/agents/pull-request-viewed";
export const AGENT_PULL_REQUEST = "/api/agents/pull-request";
export const AGENT_CHANGES = "/api/agents/changes";
export const AGENT_OVERVIEW_PULL_REQUEST = AGENT_OVERVIEW[0];

export const PULL_REQUEST_NODE_ID = "PR_kwDOfixture12";

export interface GraphqlCall {
  readonly authorization: string | null;
  readonly query: string;
  readonly variables: Readonly<Record<string, string | number>>;
}

export function graphqlAnswering(
  calls: GraphqlCall[],
  answer: (call: GraphqlCall) => Response = (call) =>
    Response.json({
      data: call.query.includes("mutation")
        ? {}
        : { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } },
    }),
  repository: RepositoryScript = publishedPullRequest,
): RepositoryScript {
  return (sent) => {
    if (new URL(sent.url).pathname !== "/graphql") return repository(sent);
    const { query, variables } = JSON.parse(sent.body);
    if (query.includes(PULL_REQUEST_QUEUED_OPERATION)) {
      return Response.json({ data: { repository: { pullRequest: { mergeQueueEntry: null } } } });
    }
    const call = { authorization: sent.headers.get("authorization"), query, variables };
    calls.push(call);
    return answer(call);
  };
}

export function mutationOf(call: GraphqlCall): string | undefined {
  return /mutation[^{]*\{\s*(\w+)/u.exec(call.query)?.[1];
}

export function messageAs(
  bearer: string | undefined,
  agentId: string,
  body: WireBoundaryInput,
): Request {
  return request(AGENT_MESSAGES, bearer, { method: "POST", id: agentId, body });
}

export function userTexts(page: {
  readonly messages: readonly AgentTranscriptMessage[];
}): readonly (string | undefined)[] {
  return page.messages
    .filter((message) => message.role === MESSAGE_ROLE.USER)
    .map((message) => {
      const part = message.parts.find((each) => isRecord(each) && each.type === "text");
      return isRecord(part) && isWireString(part.text) ? part.text : undefined;
    });
}

export const startedAgent = (
  owner: string,
  taskId: string,
  ask: (request: Request) => Effect.Effect<Answer>,
) =>
  Effect.gen(function* () {
    const agent = readAnswer(
      agentAnswerSchema,
      HOSTED_HTTP_STATUS.CREATED,
      yield* ask(startAs(owner, taskId, { idempotencyKey: randomUUID() })),
    ).agent;
    const stored = yield* readAgent(owner, agent.id);
    assert.ok(Option.isSome(stored));
    return { agent, target: { userId: owner, conversationId: stored.value.conversationId } };
  });

export const startedAgentOf = startedAgent;

export function startAs(
  bearer: string | undefined,
  taskId: string,
  body: WireBoundaryInput,
): Request {
  return request(TASK_AGENTS, bearer, { method: "POST", id: taskId, body });
}

export const TASK_INBOX = "/api/plans/{id}/inbox";
export const INBOX_ITEM = "/api/inbox/{id}";
export const ACCOUNT_INBOX = "/api/inbox";
export const INBOX_ATTACHMENT = "/api/inbox/attachment";
export const INBOX_MESSAGES = "/api/inbox/{id}/messages";
export const INBOX_ITEM_READ = "/api/inbox/{id}/read";
export const INBOX_CLOSE = "/api/inbox/{id}/close";
export const INBOX_READ = "/api/inbox/read";

export type ThreadPost = Parameters<typeof postInboxThread>[1];

export const openAskOf = (item: InboxItem): string => {
  const asking = item.thread?.find((each) => each.ask?.status === INBOX_ASK_STATUS.OPEN);
  assert.ok(asking, "the item holds an ask open");
  return asking.id;
};

export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

export const SIZED_PNG = Uint8Array.from([
  ...PNG,
  ...[0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1, 8, 6, 0, 0, 0],
]);

export const AGENT_PICTURE = "/api/agents/picture";

export const picture = (mark: number) => ({
  bytes: Uint8Array.from([...PNG, mark]),
  contentType: INBOX_IMAGE_TYPE.PNG,
  width: 1200,
  height: 720,
});

export const transcriptRow = (
  agent: { readonly userId: string; readonly conversationId: string },
  seq: number,
  role: typeof MESSAGE_ROLE.USER | typeof MESSAGE_ROLE.ASSISTANT,
  parts: WireBoundaryInput,
) =>
  Effect.map(
    Database.use((db) =>
      db
        .insert(messages)
        .values({
          userId: agent.userId,
          conversationId: agent.conversationId,
          seq,
          clientId: randomUUID(),
          role,
          parts: parts as never,
          metadata:
            role === MESSAGE_ROLE.USER
              ? userMetadataOf(TURN_TRIGGER.ASK)
              : { author: MESSAGE_AUTHOR.MODEL },
          placedAt: new Date(),
        })
        .returning({ id: messages.id }),
    ),
    ([row]) => row?.id ?? assert.fail("the row was not written"),
  );

export const text = (words: string) => ({ type: "text", text: words });

export function receiptOf(handed: EveMessage["message"] | undefined): MessageReceivedPart[] {
  assert.ok(Array.isArray(handed), "the message carried parts");
  return handed.flatMap((part): MessageReceivedPart[] => {
    if (part.type === "text") return [{ type: "text", text: part.text }];
    if (part.type !== "file") return [];
    const name = part.filename === undefined ? undefined : { filename: part.filename };
    return [{ type: "file", mediaType: part.mediaType, ...name }];
  });
}

export function openedParts(eve: ReturnType<typeof fakeEve>) {
  const message = eve.opened.at(-1)?.message.message;
  if (message === undefined || Array.isArray(message)) {
    return assert.fail("the session opened on words alone");
  }
  return { text: message, parts: firstMessageParts(message) };
}

export const messagedAgent = (
  eve: ReturnType<typeof fakeEve>,
  turn: { readonly running: boolean } | undefined,
  sessionSandboxes?: SandboxStopReach["sessionSandboxes"],
  afterResponse?: Layer.Layer<AfterResponse>,
) =>
  Effect.flatMap(
    openTask({
      eve,
      ...(sessionSandboxes === undefined ? undefined : { sessionSandboxes }),
      ...(afterResponse === undefined ? undefined : { afterResponse }),
    }),
    (opened) => agentStartedOn(opened, eve, turn),
  );

export const agentStartedOn = (
  opened: Effect.Success<ReturnType<typeof openTask>>,
  eve: ReturnType<typeof fakeEve>,
  turn: { readonly running: boolean } | undefined,
) =>
  Effect.gen(function* () {
    const agent = readAnswer(
      agentAnswerSchema,
      HOSTED_HTTP_STATUS.CREATED,
      yield* opened.ask(startAs(opened.owner, opened.task.id, { idempotencyKey: randomUUID() })),
    ).agent;
    const stored = yield* readAgent(opened.owner, agent.id);
    assert.ok(Option.isSome(stored));
    const target = { userId: opened.owner, conversationId: stored.value.conversationId };
    const sessionId = eve.opened.at(-1)?.sessionId ?? "";
    assert.equal(yield* claimRuntimeSession(target, sessionId, new Date()), true);
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const turnId = randomUUID();
    if (turn !== undefined) {
      yield* writer.enqueueTurn(target, {
        turnId,
        origin: TURN_ORIGIN.TYPED,
        eveTurnId: "turn_0",
      });
      yield* writer.consume(target, {
        kind: RUN_EVENT.TURN_STARTED,
        conversationId: sessionKey(target.conversationId),
        turnId,
        sequence: 1,
        origin: RUN_TURN_ORIGIN.TYPED,
        trigger: TURN_TRIGGER.ASK,
        at: 0,
      });
      const taken = yield* writer.takeAwaitingLine(target, { text: SNAPSHOT, turnId });
      assert.equal(Result.getOrUndefined(taken)?.length, 1);
      if (!turn.running) {
        yield* writer.consume(target, {
          kind: RUN_EVENT.TURN_ENDED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 2,
          status: RUN_STATUS.SUCCEEDED,
          responseIds: [],
          at: 0,
        });
      }
    }
    const transcript = () =>
      Effect.map(
        opened.ask(request(AGENT_MESSAGES, opened.owner, { id: agent.id })),
        (answered) => {
          const page = readAnswer(agentMessagesAnswerSchema, HOSTED_HTTP_STATUS.OK, answered);
          return { lines: userTexts(page), status: page.status };
        },
      );
    const sent = (text: string, clientKey = randomUUID()) =>
      Effect.map(opened.ask(messageAs(opened.owner, agent.id, { text, clientKey })), (answered) =>
        readAnswer(agentMessageAnswerSchema, HOSTED_HTTP_STATUS.ACCEPTED, answered),
      );
    return { ...opened, agent, target, sessionId, writer, turnId, transcript, sent };
  });

export const AGENT_STOP = "/api/agents/stop";

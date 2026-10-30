/**
 * agents-app-support.ts -- the fixtures and helpers the `agents-app*.test.ts` files share: the routes' paths, the scripted eve, GitHub and catalog, and the request and answer builders.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "@luke/database/core/query";
import { readAgent } from "@luke/database/models/agent-store";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { savePlanText } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { conversations, messages } from "@luke/database/schemas/storage";
import { fakeWorkspaceSeams, startTask } from "@luke/database/testing";
import { firstMessageParts } from "@luke/features/agent-replay";
import {
  type AgentTranscriptMessage,
  agentAnswerSchema,
  agentMessageAnswerSchema,
  agentMessagesAnswerSchema,
} from "@luke/features/agent-wire";
import { INBOX_ASK_STATUS, INBOX_IMAGE_TYPE, type InboxItem } from "@luke/features/inbox-wire";
import { AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@luke/features/models-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
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
import type { MessageReceivedPart } from "eve/client";
import { agentPullRequestProcedures } from "../agents/agent-pull-request-procedures.js";
import { agentsApp } from "../agents/agents-app.js";
import { agentsProcedures } from "../agents/agents-procedures.js";
import { CODER } from "../agents/coder-host/bounds.js";
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
import type { AfterResponse } from "../http/after-response.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { type InboxTitleModelOf, inboxProcedures } from "../inbox/inbox-procedures.js";
import type { postInboxThread } from "../inbox/inbox-store.js";
import { hostedFetch } from "../orpc/handler.js";
import { modelCatalogOf, type OfferedModel } from "../providers/model-catalog.js";
import type { WebServices } from "../runtime.js";
import { tasksProcedures } from "../tasks/tasks-procedures.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
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
import { keepAwakeDetached } from "../testing/session-sandboxes-fake.js";

export const ORIGIN = "https://luke.test";
export const TASK_AGENTS = "/api/plans/agents";
export const AGENT_MESSAGES = "/api/agents/messages";
export const SUBAGENT_MESSAGES = "/api/agents/subagent-messages";
export const AGENT_NEWEST = "/api/agents/messages-newest";
export const SUBAGENT_NEWEST = "/api/agents/subagent-messages-newest";
export const AGENT_STARTS = "/api/agents/agents";
/** A Start in a workspace with no task, by the workspace's id. */
export const WORKSPACE_STARTS = "/api/workspaces/agents";
export const AGENT = "/api/agents/agent";
export const AGENT_INBOX = "/api/agents/{id}/inbox";
/** Luke's own tools an agent is offered and where its `run_on_mac` stands, as its MCP popover reads them. */
export const AGENT_LUKE_TOOLS = "/api/agents/luke-tools";
export const WORKSPACE_AGENTS = "/api/agents";
/** The overview's three reads, each its own route. */
export const AGENT_OVERVIEW = [
  "/api/agents/overview-pull-request",
  "/api/agents/overview-checks",
  "/api/agents/overview-conversation",
] as const;
/** The public paths the inbox's procedures answer on the hosted oRPC router, its attachment's bytes aside. */
const INBOX_PROCEDURE_PATH = /^\/api\/(?:inbox(?:\/.*)?|(?:plans|agents)\/[^/]+\/inbox)$/u;
/** The account's tasks, served by the hosted oRPC router, each naming its agents in brief. */
export const TASKS = "/api/plans";
/** One task, served by the hosted oRPC router, whose delete stops the task's agents through the same Stop. */
export const TASK = (taskId: string) => `${TASKS}/${taskId}`;
/** Luke's Stop on a task, served by the hosted oRPC router, which reaches the brain's eve as the request's caller. */
/** Luke's own transcript of a task, served by the hosted oRPC router. */
/** A task's own path, its Stop, or its transcript, by the task's id, which the router serves where the old groups serve flattened keys. */
const TASK_PATH =
  /^\/api\/plans\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/stop|\/messages)?$/u;
/** One part of a message of an agent's or a worker's transcript, whole, at its public path on the hosted oRPC router. */
const TRANSCRIPT_PART_PATH =
  /^\/api\/agents\/[^/]+\/(?:subagents\/[^/]+\/)?messages\/[^/]+\/parts\/[^/]+$/u;

export const RELAY = { owner: "Acme", name: "Relay" } as const;
export const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;

/** Where the group serves an image an agent's pull request's overview names. */
export const AGENT_GITHUB_IMAGE = "/api/agents/github-image";

/** An SVG a repository might hold, with a script in it that must never run as a page of the service. */
export const SCRIPTED_SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/plans")</script></svg>',
);

/** The installation ids handed out so far: one installation stands for one workspace, so each task's workspace connects its own. */
let installationsConnected = 0;

/** A fresh installation reaching the repository, on an account of its own. */
export function freshInstallation(
  repositories: InstallationFixture["repositories"] = [RELAY],
): InstallationFixture {
  installationsConnected += 1;
  return { id: 7 + installationsConnected, login: RELAY.owner, repositories };
}

export const SAVED =
  "## Goal\n\nInvite a teammate by email.\n\n## Assumptions\n\n- Invites expire after 7 days.\n";

/** The saved plan as Copy writes it, its name as a title over its text, which is what an agent started on the task is handed. */
export const SNAPSHOT = `# Teammate invitations\n\n${SAVED}`;

export const SOL = "openai/gpt-6.1-sol";

/** A model offering two context windows, as OpenAI prices its long context apart. */
const GPT_LONG = "openai/gpt-5.5";

/** How many long turns a long source's transcript holds past its brief. */
export const LONG_TURNS = 30;

/** A model with a small window, which a long replay does not fit whole. */
export const SMALL_WINDOW = { model: "anthropic/claude-sonnet-4.9", tokens: 60_000 } as const;

/** The models offered, each with its prices in dollars per token, one with two windows. */
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

/** One session opened, as the fake eve saw it. */
interface Opened {
  readonly authorization: string;
  readonly message: EveMessage;
  readonly sessionId: string;
}

/** One follow-up handed to a session, as the fake eve saw it. */
interface Sent {
  readonly authorization: string;
  readonly sessionId: string;
  readonly message: EveMessage;
}

/** How the fake eve answers a follow-up: accepted with a delivery of its own, or one of the refusals the client reads. */
export type SendAnswer =
  | typeof EVE_SEND_OUTCOME.ACCEPTED
  | typeof EVE_SEND_OUTCOME.NOT_READY
  | typeof EVE_SEND_OUTCOME.RETIRED
  | typeof EVE_SEND_OUTCOME.FAILED;

/** The cookie a browser signed in to the account sends, as the faked auth service reads it. */
export function sessionCookieOf(userId: string): string {
  return `better-auth.session_token=${userId}`;
}

/** How the fake eve writes down the deployment acting for an account, apart from any bearer a request carried. */
export function deploymentFor(account: string): string {
  return `deployment for ${account}`;
}

/** eve as the group reaches it, answering from a script and writing down every open, send, cancel, and retire, with who asked it. */
export function fakeEve(
  options: {
    readonly reachable?: boolean;
    readonly cancels?: boolean;
    /** Whether eve answers every cancel that the turn it names had already ended. */
    readonly turnEnded?: boolean;
    readonly sends?: SendAnswer;
    /** How many cancels eve holds every cancel's answer for, so a caller asking them one at a time never hears back. */
    readonly cancelsTogether?: number;
    /** What eve looks at as it is asked to retire a session, written down beside the retire. */
    readonly resetSees?: Effect.Effect<boolean>;
    /** What happens while a cancel is out, before eve answers it, as a turn's end racing the Stop does. */
    readonly cancelling?: Effect.Effect<void>;
  } = {},
) {
  const together = Latch.makeUnsafe(options.cancelsTogether === undefined);
  const opened: Opened[] = [];
  const sent: Sent[] = [];
  const cancelled: (readonly [string, string])[] = [];
  /** Who asked each cancel, in order: the request's bearer, or the deployment acting for an account. */
  const cancelledAs: string[] = [];
  /** Every session eve was asked to retire, in order. */
  const reset: string[] = [];
  /** Who asked each retire, in order, as `cancelledAs` writes it. */
  const resetAs: string[] = [];
  /** What `resetSees` saw at each retire, in order. */
  const resetSaw: boolean[] = [];
  let sessions = 0;
  let deliveries = 0;
  const eve = (authorization: string): AgentSessions => ({
    open: (message) =>
      Effect.suspend(() => {
        if (options.reachable === false) {
          return Effect.fail(
            new EveUnreachable({
              // SAFETY: the client's own error shape, built by the fake at the transport it stands for.
              cause: {
                _tag: "RequestError",
                reason: { _tag: "TransportError" },
                message: "refused",
              } as never,
            }),
          );
        }
        sessions += 1;
        const sessionId = `wrun_01M${String(sessions).padStart(22, "0")}`;
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
        cancelled.push([sessionId, eveTurnId]);
        cancelledAs.push(authorization);
        if (cancelled.length >= (options.cancelsTogether ?? 0)) together.openUnsafe();
        return Effect.as(
          Effect.andThen(together.await, options.cancelling ?? Effect.void),
          options.cancels === false
            ? { outcome: EVE_CANCEL_OUTCOME.FAILED, status: 403 }
            : options.turnEnded === true
              ? { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN }
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
  return { eve, opened, sent, cancelled, cancelledAs, reset, resetAs, resetSaw };
}

/** The deployment's environment with no key of its own, which a test gives the one it reads. */
const NO_KEYS: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  eveDeploymentSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
};

/** What the endpoints counted, across the file; a test reads its own account's. */
const ANALYTICS = recordingProductAnalytics();

/** How many of one event the account was counted for. */
export const countedFor = (userId: string, name: string) => countedWith(userId, name).length;

/** The properties of each of one event the account was counted for, in order. */
export const countedWith = (userId: string, name: string) =>
  ANALYTICS.recorded
    .filter((event) => event.userId === userId && event.name === name)
    .map((event) => event.properties);

/**
 * The public path of each route the hosted oRPC router answers, by the
 * flattened key a test names it with: the rewrite carries this path to the
 * router in `route-path`, and keeps the agent's id in the `id` query beside
 * it, as a request here does.
 */
const ORPC_PUBLIC_PATH: ReadonlyMap<string, (id: string) => string> = new Map([
  ["/api/plans/agents", (id: string) => `/api/plans/${id}/agents`],
  ["/api/agents/agent", (id: string) => `/api/agents/${id}`],
  ["/api/agents/calls", (id: string) => `/api/agents/${id}/calls`],
  ["/api/agents/stop", (id: string) => `/api/agents/${id}/stop`],
  ["/api/agents/queue", (id: string) => `/api/agents/${id}/queue`],
  ["/api/agents/agents", (id: string) => `/api/agents/${id}/agents`],
  ["/api/workspaces/agents", (id: string) => `/api/workspaces/${id}/agents`],
  ["/api/agents/messages-newest", (id: string) => `/api/agents/${id}/messages/newest`],
  ["/api/agents/changes", (id: string) => `/api/agents/${id}/changes`],
  ["/api/agents/review-options", (id: string) => `/api/agents/${id}/review-options`],
  ["/api/agents/luke-tools", (id: string) => `/api/agents/${id}/luke-tools`],
  ["/api/agents/pull-request", (id: string) => `/api/agents/${id}/pull-request`],
  ["/api/agents/pull-request-action", (id: string) => `/api/agents/${id}/pull-request/action`],
  ["/api/agents/pull-request-viewed", (id: string) => `/api/agents/${id}/pull-request/viewed`],
  ["/api/agents/overview-pull-request", (id: string) => `/api/agents/${id}/overview/pull-request`],
  ["/api/agents/overview-checks", (id: string) => `/api/agents/${id}/overview/checks`],
  ["/api/agents/overview-conversation", (id: string) => `/api/agents/${id}/overview/conversation`],
]);

/** The request at its public path, for a route the hosted oRPC router answers; none for any other route. */
function publicRequest(request: Request): Request | undefined {
  const url = new URL(request.url);
  const publicPath = ORPC_PUBLIC_PATH.get(url.pathname);
  if (publicPath === undefined) return undefined;
  url.pathname = publicPath(encodeURIComponent(url.searchParams.get("id") ?? ""));
  return new Request(url, request);
}

/**
 * The group over the test's own database, GitHub, and eve, stood once and
 * answering every request of the test, so what it keeps between two
 * requests, the published answers, is kept as one function instance keeps
 * it; let go with the test's scope.
 */
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
      github.layer,
      modelCatalogOf(CATALOG),
      integrationConnectOf(() => CONNECTOR_ASKED_NOTHING),
      ANALYTICS.layer,
    );
    // Every account behind a bearer is signed in on a browser of its own too, whose cookie names it.
    const sessions = new Map(
      [...bearers.values()].map((userId) => [sessionCookieOf(userId), userId]),
    );
    const seams = {
      // The account read as `resolveHostedUserId` reads it: the bearer where one is carried, else the session cookie.
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
      eveOrigin: () => ORIGIN,
      eve: (authorization: Redacted.Redacted) => eve.eve(Redacted.value(authorization)),
      // The deployment acting for an account, an agent's starter for another agent's message or the
      // account a cookie named, which the fake writes down apart from any bearer.
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
    // SAFETY: the plans and messages procedures yield the services above alone, which is all a test provides of the web runtime's services.
    const webServices = (yield* Effect.context<never>().pipe(
      Effect.provide(services),
    )) as Context.Context<WebServices>;
    // One cache of the kept published answers for both resources that read them, as the hosted router hands it.
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
    /** The response as the function answers it, for the one route that answers bytes; a task's own path, the list, Luke's Stop, an agent's transcript, its Pull request tab, and the inbox land on the hosted oRPC router. */
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
        // SAFETY: the group answers JSON; the test compares it as the wire value it is, and an answer
        // with no body is compared as its text so a failure names what came back.
        const body = (text.length === 0 ? text : JSON.parse(text)) as WireBoundaryInput;
        return { status: response.status, body } satisfies Answer;
      });
    return { ask, fetch };
  });

/** Where a path the hosted oRPC router answers names its id. */
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
    /** A browser's session cookie, sent beside the bearer or, with no account named, in its place. */
    cookie?: string;
  } = {},
): Request {
  // A path the hosted oRPC router answers names its id as a segment; an old group's reads it from the query.
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
  // Every client of the service names its JSON body so, which the hosted oRPC router reads a body by.
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.cookie !== undefined) headers.set("cookie", init.cookie);
  return new Request(url, {
    method: init.method ?? "GET",
    headers,
    ...(init.body === undefined ? undefined : { body: JSON.stringify(init.body) }),
  });
}

/** An answer read as the wire declares it, failing the test where it is not one. */
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

/** The steps a read held while its agent starts is driven by: past its hold, and under the grace an agent with no turn reads as starting within. */
const STARTING_READ_STEPS =
  Math.floor(
    (Duration.toMillis(CODER.STARTING_GRACE) - Duration.toMillis(CODER.MESSAGES_HOLD)) /
      Duration.toMillis(CODER.MESSAGES_POLL),
  ) - 1;

/**
 * A held read of a starting agent driven to its answer, each step taken
 * only after a round trip to the test's database. Note that the steps are
 * paced by the database rather than by the loop, because the read reaches
 * its hold only after queries of its own: steps the loop races ahead with
 * either pass the hold before the read waits on it, leaving its join
 * waiting on a clock nothing moves, or, unbounded, carry the clock past the
 * grace so the page reads the agent failed. A round trip queued behind the
 * read's own keeps the two in step, and the bound keeps the clock inside
 * the grace whatever the database's pace.
 */
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

/**
 * An owner who holds one task on the repository, its workspace connected to
 * an installation reaching it, another account beside them, and the group
 * over that GitHub and the eve given.
 */
export const openTask = (
  options: {
    readonly repository?: string | null;
    readonly eve?: ReturnType<typeof fakeEve>;
    /** What the repository answers on its own paths, for a test of what an agent published. */
    readonly github?: RepositoryScript;
    /** The other account's GitHub token, or none where it holds no GitHub sign-in at all; the standing row's when unsaid. */
    readonly otherToken?: string | null;
    /** The model a replay's summary is written on; none unless a test names one. */
    readonly summaryModel?: SummaryModelOf;
    /** The sandboxes an archive stops; Vercel's own, which a test with no token in its environment finds unavailable, unless a test scripts them. */
    readonly sessionSandboxes?: SandboxStopReach["sessionSandboxes"];
    /** The model an untitled inbox thread's title is generated on; none unless a test names one. */
    readonly titleModel?: InboxTitleModelOf;
    /** Where a request's after-response work goes; run inline, before the answer is read, unless a test keeps it (`keptAfterResponse`). */
    readonly afterResponse?: Layer.Layer<AfterResponse>;
  } = {},
) =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    const other = yield* otherAccount(options.otherToken);
    // Luke's key pays for no coding agent, so both accounts start and message theirs on their own keys.
    yield* connectAgentApiKeys(owner);
    yield* connectAgentApiKeys(other);
    const task = yield* startTask(owner, {
      name: "Teammate invitations",
      repository: options.repository === undefined ? RELAY_FULL_NAME : options.repository,
    });
    yield* savePlanText(owner, task.id, SAVED);
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
    const { ask, fetch } = yield* standing(
      bearers,
      github,
      eve,
      options.summaryModel,
      options.sessionSandboxes,
      options.titleModel,
      options.afterResponse,
    );
    return { owner, other, task, installation, eve, github, ask, fetch };
  });

/** An account beside the owner: signed in with GitHub on the token given, the standing row's when unsaid, or with no GitHub sign-in at all. */
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
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    return userId;
  });

/** The pull request an agent published from its branch, as GitHub holds it. */
export const PUBLISHED = {
  branch: "luke/teammate-invitations",
  number: 12,
  headSha: "c0ffee1",
} as const;

/** The repository answering the published pull request's reads, its overview's among them: no checks, no comments, no reviews. */
/** The same, the pull request a draft while `draft` says it is, its head the commit given, GitHub's short fixture one unless told. */
export const publishedPullRequestDrafted =
  (draft: () => boolean, headSha: string = PUBLISHED.headSha): RepositoryScript =>
  (sent) => {
    const repository = `/repos/${RELAY.owner}/${RELAY.name}`;
    const pull = `${repository}/pulls/${PUBLISHED.number}`;
    const commit = `${repository}/commits/${PUBLISHED.headSha}`;
    // The overview's checks name the head by the ref GitHub keeps on the pull request.
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

/** What GitHub was asked on the way to a repository token: the installation read, its listing and the token minted for it, and the repository's own token. */
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
/** The agent's changes, the files Files changed draws. */
export const AGENT_CHANGES = "/api/agents/changes";
export const AGENT_OVERVIEW_PULL_REQUEST = AGENT_OVERVIEW[0];

/** The GraphQL id GitHub gives the published pull request. */
export const PULL_REQUEST_NODE_ID = "PR_kwDOfixture12";

/** A message to the agent as the bearer given, with the body given. */
export function messageAs(
  bearer: string | undefined,
  agentId: string,
  body: WireBoundaryInput,
): Request {
  return request(AGENT_MESSAGES, bearer, { method: "POST", id: agentId, body });
}

/** The words of each user row of a transcript page, in order. */
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

/** An agent started on the task, with its conversation as the writer targets it. */
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

/** The same, under a name a suite with a `startedAgent` of its own still reaches. */
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

/** A post as the agent's inbox tool hands the store one. */
export type ThreadPost = Parameters<typeof postInboxThread>[1];

/** The id of the message whose ask the item's thread holds open, which an answer names. */
export const openAskOf = (item: InboxItem): string => {
  const asking = item.thread?.find((each) => each.ask?.status === INBOX_ASK_STATUS.OPEN);
  assert.ok(asking, "the item holds an ask open");
  return asking.id;
};

/** The first bytes of a PNG, as a screenshot's file starts. */
export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** A PNG whose header states its size, 2 by 1, as a conversation keeps a picture. */
export const SIZED_PNG = Uint8Array.from([
  ...PNG,
  ...[0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1, 8, 6, 0, 0, 0],
]);

export const AGENT_PICTURE = "/api/agents/picture";

/** A picture a tool answered: its bytes, the type they were sniffed to be, and its size; synthetic, as the store keeps what it is handed. */
export const picture = (mark: number) => ({
  bytes: Uint8Array.from([...PNG, mark]),
  contentType: INBOX_IMAGE_TYPE.PNG,
  width: 1200,
  height: 720,
});

/** A row of an agent's transcript as the relay leaves it, written straight to the store at the sequence given, answering its id. */
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
          // SAFETY: the parts are the stored vocabulary's, spelled as the relay writes them.
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

/** A message as eve's receipt lists it: each text part as it was handed, and each file staged, by its name and type with no bytes. */
export function receiptOf(handed: EveMessage["message"] | undefined): MessageReceivedPart[] {
  assert.ok(Array.isArray(handed), "the message carried parts");
  return handed.flatMap((part): MessageReceivedPart[] => {
    if (part.type === "text") return [{ type: "text", text: part.text }];
    if (part.type !== "file") return [];
    const name = part.filename === undefined ? undefined : { filename: part.filename };
    return [{ type: "file", mediaType: part.mediaType, ...name }];
  });
}

/** The first message the newest session opened on, read back into its brief, its replay, and its note. */
export function openedParts(eve: ReturnType<typeof fakeEve>) {
  const message = eve.opened.at(-1)?.message.message;
  if (message === undefined || Array.isArray(message)) {
    return assert.fail("the session opened on words alone");
  }
  return { text: message, parts: firstMessageParts(message) };
}

/** An agent started on the owner's task, its session claimed, and its first turn where asked. */
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

/** Another agent the owner starts on the task opened, its turn running or ended as `turn` says, as `messagedAgent` starts the first. */
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
      // eve's receipt of the Start's first message takes the line the Start wrote into the turn, as the relay does.
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
    /** The transcript as the owner reads it now: the developer's lines, and the status. */
    const transcript = () =>
      Effect.map(
        opened.ask(request(AGENT_MESSAGES, opened.owner, { id: agent.id })),
        (answered) => {
          const page = readAnswer(agentMessagesAnswerSchema, HOSTED_HTTP_STATUS.OK, answered);
          return { lines: userTexts(page), status: page.status };
        },
      );
    /** A message of the owner's under the key given, or one minted, answered as the wire declares a message taken. */
    const sent = (text: string, clientKey = randomUUID()) =>
      Effect.map(opened.ask(messageAs(opened.owner, agent.id, { text, clientKey })), (answered) =>
        readAnswer(agentMessageAnswerSchema, HOSTED_HTTP_STATUS.ACCEPTED, answered),
      );
    return { ...opened, agent, target, sessionId, writer, turnId, transcript, sent };
  });

/** Where an agent's Stop lands. */
export const AGENT_STOP = "/api/agents/stop";

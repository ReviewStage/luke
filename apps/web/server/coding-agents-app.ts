import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_CURSOR_START,
  type CodingAgentSummary,
  codingAgentCursorSchema,
  codingAgentMessageRequestSchema,
  codingAgentStartRequestSchema,
} from "@sidecar/hosted/coding-agent-wire";
import type { ModelChoice } from "@sidecar/hosted/models-wire";
import { planMarkdown } from "@sidecar/hosted/plan-markdown";
import { readEither } from "@sidecar/wire/effect";
import { Cache, Clock, DateTime, Effect, Layer, Option, Redacted, Result } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import {
  isRecord,
  isWireString,
  type UnparsedWireValue,
  unparsedWire,
  wireUuidSchema,
} from "./core.js";
import { GitHubApp } from "./github/github-app.js";
import { githubUserReadOrRefusal } from "./github/github-refusal.js";
import { readAccountPreferences, writeAccountPreferences } from "./hosted/account-store.js";
import { BRAIN_HOST_TURN } from "./hosted/brain-host/bounds.js";
import {
  describeUnreachable,
  EVE_CANCEL_OUTCOME,
  EVE_MOUNT,
  EVE_SEND_OUTCOME,
  type EveSessions,
  eveSessions,
} from "./hosted/brain-host/eve-sessions.js";
import { recordedRuntimeSession } from "./hosted/brain-host/recorded-session.js";
import {
  type PublishedCache,
  PublishedKey,
  withPublishedCache,
} from "./hosted/coder-host/published.js";
import { type AgentTurnStanding, codingAgentSummary } from "./hosted/coder-host/status.js";
import { CODER_TOOL_SET } from "./hosted/coder-host/tool-set.js";
import { cursorOfWire, cursorToWire, transcriptPast } from "./hosted/coder-host/transcript.js";
import {
  awaitingLinesOf,
  type CodingAgent,
  type CodingAgentLatestTurn,
  createCodingAgent,
  discardCodingAgent,
  latestTurnsOf,
  listCodingAgents,
  RUNNING_TURN_STATUSES,
  readCodingAgent,
} from "./hosted/coding-agent-store.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import {
  acceptedModelChoice,
  CODING_AGENT_DEFAULT_CHOICE,
  type ModelCatalog,
} from "./hosted/model-catalog.js";
import { readPlan } from "./hosted/plan-store.js";
import { type ConversationTarget, type StoreWriter, storeWriter } from "./hosted/store/index.js";
import { STORE_WRITE_REFUSAL } from "./hosted/store/writer.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * coding-agents-app.ts -- a plan's coding agents: start one, list them, read one's transcript, message one, and stop one.
 *
 * Every endpoint resolves the bearer before it touches a row, and every row
 * it touches is one the bearer's account owns: a plan or an agent another
 * account owns answers exactly as one that names nothing. A Start
 * (`POST /api/plans/{id}/agents`) checks the model and effort against the
 * catalog, the account's default where the request names none, confirms the
 * plan names a repository the account still reaches through the Luke GitHub
 * App, snapshots the plan's document as the Markdown Copy would put on the
 * clipboard, makes the agent and its conversation, and opens its eve session
 * with the snapshot as the first message, under the developer's own bearer
 * so eve's door admits it as the developer. A retry carrying the same key is
 * the same agent, and opens nothing again. A Start that named a model makes
 * it the account's default, so the menu's last choice and the default stay
 * one value. The list (`GET /api/plans/{id}/agents`) reads each agent's
 * status from its newest turn. The transcript
 * (`GET /api/agents/{id}/messages?after=`) is the conversation's rows past a
 * cursor, held open while the agent runs (`hosted/coder-host/transcript.ts`).
 * A message (`POST /api/agents/{id}/messages`) is the developer's words
 * handed to the session the agent runs in, under the developer's own bearer,
 * naming how they reach a turn under way: a steer joins it and a queue
 * waits for it to end, and an idle agent opens a new turn on either. The
 * words are written as a user row awaiting its turn, under the
 * conversation's lock around eve's acceptance, so the transcript shows the
 * line at once with its delivery on it and the agent reads as running until
 * the turn that receives the line takes it (`brain-host/relay.ts`). The
 * route confirms the developer still reaches the repository first, so a
 * sign-in that lapsed is refused here rather than failing the turn's
 * checkout; the session's own step hook renews the credential at the
 * firewall where the standing one is old. eve answering that the session is
 * still coming up is a conflict the desktop tries again; eve no longer
 * running the session is one it does not, since the agent's sandbox lives
 * with the session. A Stop (`POST /api/agents/{id}/stop`) is eve's cancel
 * of the turn under way, named by eve's own id for it, and the row's stamp;
 * the service's hook stops the sandbox as the cancelled turn ends, and
 * anything the agent pushed stays.
 * What the agent published (`GET /api/agents/{id}/pull-request`) is the
 * branch and pull request its own transcript names, as GitHub holds them
 * now (`hosted/coder-host/published.ts`), kept per agent for a short while
 * so a tab asking beside every held page does not ask GitHub as often.
 */

const AGENTS_PATH = {
  /** GET lists the plan's agents, POST starts one; the rewrite moves the path's plan id into the `id` query. */
  OF_PLAN: "/api/plans/agents",
  /** GET reads the agent's transcript past `after`, POST sends the agent a message; the rewrite moves the path's agent id into the `id` query. */
  MESSAGES: "/api/agents/messages",
  /** POST stops the agent; the rewrite moves the path's agent id into the `id` query. */
  STOP: "/api/agents/stop",
  /** GET reads what the agent published; the rewrite moves the path's agent id into the `id` query. */
  PULL_REQUEST: "/api/agents/pull-request",
} as const;

const HTTP_METHOD = { GET: "GET", POST: "POST" } as const;

const QUERY = { ID: "id", AFTER: "after" } as const;

/** A Start names a key and a choice at most, so a body past this is no Start. */
const MAXIMUM_START_BODY_BYTES = 4_096;

/** A message is its words and a delivery: the bound's characters at JSON's widest escape, and room for the keys around them. */
const MAXIMUM_MESSAGE_BODY_BYTES = 6 * CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS + 1_024;

export interface CodingAgentsAppSeams {
  resolveUserId: UserIdResolver;
  /** The origin eve answers on; nothing where the deployment names none, which refuses every Start and Stop as unavailable. */
  eveOrigin: () => string | undefined;
  /** eve as the developer reaches it, over the request's own authorization; a test hands a fake, and the deployment composes eve's client over the ambient `HttpClient`. */
  eve?: (authorization: Redacted.Redacted) => EveSessions;
}

/** What the routes may require of the function that stands them. */
export type CodingAgentsAppServices =
  | SqlClient.SqlClient
  | GitHubApp
  | HttpClient.HttpClient
  | ModelCatalog;

type AgentsServices = CodingAgentsAppServices | HttpServerRequest.HttpServerRequest;

/** The bearer's account, or the invalid-token refusal. */
const resolvedUserId = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: CodingAgentsAppSeams,
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/** The one id the path named under `query`; two is refused, and one that is no UUID names no row. */
const idOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const ids = new URL(request.url).searchParams.getAll(QUERY.ID);
  const [id] = ids;
  if (id === undefined || ids.length !== 1) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/** eve as the developer reaches it, or unavailable where the deployment names no origin for eve. */
const eveFor = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: CodingAgentsAppSeams,
  request: Request,
): Effect.fn.Return<EveSessions, HostedRefusal, HttpClient.HttpClient> {
  const authorization = Redacted.make(request.headers.get("authorization") ?? "");
  if (seams.eve !== undefined) return seams.eve(authorization);
  const origin = seams.eveOrigin();
  if (origin === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  return yield* eveSessions({ origin, caller: { authorization }, mount: EVE_MOUNT.CODER });
});

/** Where each of the account's conversations named stands now: its newest turn, and whether a line of the developer's awaits one. */
const standingsOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  conversationIds: readonly string[],
): Effect.fn.Return<
  (conversationId: string) => AgentTurnStanding,
  HostedRefusal,
  SqlClient.SqlClient
> {
  const turns = yield* hostedStoreOrUnavailable(latestTurnsOf(userId, conversationIds));
  const awaiting = yield* hostedStoreOrUnavailable(awaitingLinesOf(userId, conversationIds));
  return (conversationId) => ({
    turn: turns.get(conversationId),
    lineAwaits: awaiting.has(conversationId),
  });
});

/** The agent's summary with its status read now. */
const summaryOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: CodingAgent,
): Effect.fn.Return<CodingAgentSummary, HostedRefusal, SqlClient.SqlClient> {
  const standing = yield* standingsOf(userId, [agent.conversationId]);
  return codingAgentSummary(agent, standing(agent.conversationId), yield* Clock.currentTimeMillis);
});

/**
 * The choice a Start runs on: the request's own where it names one, the
 * account's default otherwise, either checked against the catalog, which
 * also refuses a stored default that has since left the catalog.
 */
const acceptedChoice = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  named: ModelChoice | undefined,
): Effect.fn.Return<ModelChoice, HostedRefusal, SqlClient.SqlClient | ModelCatalog> {
  const choice =
    named ??
    (yield* hostedStoreOrUnavailable(readAccountPreferences(userId)))?.codingAgent ??
    CODING_AGENT_DEFAULT_CHOICE;
  return yield* acceptedModelChoice(choice).pipe(
    Effect.catchTag("ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)),
    Effect.catchTag("ModelCatalogUnavailable", (unavailable) =>
      Effect.logWarning("the model catalog could not be read", unavailable.cause).pipe(
        Effect.andThen(Effect.fail(HOSTED_REFUSAL.UNAVAILABLE)),
      ),
    ),
  );
});

/** POST: an agent started on the plan, or the one a retry under the same key already started. */
const startEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: CodingAgentsAppSeams,
  request: Request,
  userId: string,
  planId: string,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const body = yield* readJsonBodyEffect(MAXIMUM_START_BODY_BYTES);
  const asked = readEither(codingAgentStartRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { idempotencyKey, model, effort } = asked.success;
  // A choice is one thing: a model without its effort, or the reverse, names nothing to run on.
  if ((model === undefined) !== (effort === undefined)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const named = model !== undefined && effort !== undefined ? { model, effort } : undefined;
  const choice = yield* acceptedChoice(userId, named);
  const plan = yield* hostedStoreOrUnavailable(readPlan(userId, planId));
  if (Option.isNone(plan)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const repository = plan.value.plan.repository;
  if (repository === null) return yield* Effect.fail(HOSTED_REFUSAL.NO_REPOSITORY);
  const app = yield* GitHubApp;
  const reached = yield* githubUserReadOrRefusal(app.userRepository(userId, repository));
  if (Option.isNone(reached)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  const planSnapshot = planMarkdown(plan.value.plan.document);
  const started = yield* hostedStoreOrUnavailable(
    createCodingAgent(userId, {
      planId,
      idempotencyKey,
      model: choice.model,
      effort: choice.effort,
      planSnapshot,
      repository,
    }),
  );
  if (Option.isNone(started)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { agent, created } = started.value;
  if (!created) {
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { agent: yield* summaryOf(userId, agent) });
  }
  // The session opens as the developer, with the plan as its first message; an eve that did not
  // take it leaves no agent behind, so the retry under the same key starts afresh.
  const eve = yield* eveFor(seams, request);
  const opened = yield* eve
    .open({
      conversationId: agent.conversationId,
      turn: BRAIN_HOST_TURN.TYPED,
      message: planSnapshot,
    })
    .pipe(
      Effect.catchTag("EveUnreachable", (failure) =>
        Effect.as(
          Effect.logWarning(
            `eve could not be reached to start a coding agent: ${describeUnreachable(failure)}`,
          ),
          undefined,
        ),
      ),
    );
  if (opened === undefined || opened.outcome !== EVE_SEND_OUTCOME.ACCEPTED) {
    yield* hostedStoreOrUnavailable(discardCodingAgent(userId, agent.id));
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  if (named !== undefined) {
    yield* hostedStoreOrUnavailable(writeAccountPreferences(userId, { codingAgent: choice }));
  }
  return hostedJsonResponse(HOSTED_HTTP_STATUS.CREATED, {
    agent: codingAgentSummary(
      agent,
      { turn: undefined, lineAwaits: false },
      yield* Clock.currentTimeMillis,
    ),
  });
});

/** GET lists the plan's agents with their status; POST starts one. */
const planAgentsEndpoint = /* @__PURE__ */ Effect.fn("web/planAgentsEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const planId = yield* idOf(request);
  const userId = yield* resolvedUserId(seams, request);
  if (incoming.method === HTTP_METHOD.POST) {
    return yield* startEndpoint(seams, request, userId, planId);
  }
  const plan = yield* hostedStoreOrUnavailable(readPlan(userId, planId));
  if (Option.isNone(plan)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const agents = yield* hostedStoreOrUnavailable(listCodingAgents(userId, planId));
  const standing = yield* standingsOf(
    userId,
    agents.map((agent) => agent.conversationId),
  );
  const now = yield* Clock.currentTimeMillis;
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    agents: agents.map((agent) => codingAgentSummary(agent, standing(agent.conversationId), now)),
  });
});

/** The account's agent the path names, or not found. */
const ownedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: CodingAgentsAppSeams,
  request: Request,
): Effect.fn.Return<
  { readonly userId: string; readonly agent: CodingAgent; readonly target: ConversationTarget },
  HostedRefusal,
  SqlClient.SqlClient
> {
  const agentId = yield* idOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, agentId));
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return {
    userId,
    agent: agent.value,
    target: { userId, conversationId: agent.value.conversationId },
  };
});

/** Why a message body was not read as one: its words run past the bound, or it is not a message at all. */
function messageRefusal(body: UnparsedWireValue): HostedRefusal {
  if (isRecord(body) && isWireString(body.text)) {
    if (body.text.trim().length > CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS) {
      return HOSTED_REFUSAL.MESSAGE_TOO_LONG;
    }
  }
  return HOSTED_REFUSAL.INVALID_REQUEST;
}

/** eve's answer to a message it did not take, in the route's words: a session still coming up is tried again, one eve no longer runs is gone for good, and anything else is an outage. */
const REFUSAL_OF_SEND_OUTCOME = {
  [EVE_SEND_OUTCOME.NOT_READY]: HOSTED_REFUSAL.AGENT_NOT_READY,
  [EVE_SEND_OUTCOME.RETIRED]: HOSTED_REFUSAL.AGENT_RETIRED,
  [EVE_SEND_OUTCOME.FAILED]: HOSTED_REFUSAL.UNAVAILABLE,
} as const;

/**
 * POST sends the agent a message: the developer's words handed to the
 * session the agent runs in with the delivery named, written as a line
 * awaiting its turn once eve has taken them. The hand-over runs inside the
 * conversation's lock, so the turn eve opens on the line finds the row
 * standing when its own first write takes the lock, and an eve that did not
 * take the message leaves no row behind; the writer fences the write
 * against the request going away between the two. A row the store failed
 * to write after eve took the message is the one gap left, and the relay
 * still writes the line when the turn receives it, without its marker.
 */
const sendMessageEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: CodingAgentsAppSeams,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const { userId, agent, target } = yield* ownedAgent(seams, request);
  const body = yield* readJsonBodyEffect(MAXIMUM_MESSAGE_BODY_BYTES);
  const asked = readEither(codingAgentMessageRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(messageRefusal(body));
  const { text, delivery } = asked.success;
  // The turn's checkout and its credential renewals run on the developer's standing with GitHub,
  // so a sign-in that lapsed is the route's refusal rather than a turn failed at its first step.
  const app = yield* GitHubApp;
  const reached = yield* githubUserReadOrRefusal(app.userRepository(userId, agent.repository));
  if (Option.isNone(reached)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));
  if (sessionId === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  const eve = yield* eveFor(seams, request);
  // eve's refusal is kept beside the dispatch, since the write answers only whether a row landed.
  let refused: HostedRefusal | undefined;
  const dispatch = eve
    .send(sessionId, {
      conversationId: agent.conversationId,
      turn: BRAIN_HOST_TURN.TYPED,
      message: text,
      delivery,
    })
    .pipe(
      Effect.catchTag("EveUnreachable", (failure) =>
        Effect.as(
          Effect.logWarning(
            `eve could not be reached to message a coding agent: ${describeUnreachable(failure)}`,
          ),
          { outcome: EVE_SEND_OUTCOME.FAILED, status: HOSTED_HTTP_STATUS.BAD_GATEWAY } as const,
        ),
      ),
      Effect.map((sent) => {
        if (sent.outcome === EVE_SEND_OUTCOME.ACCEPTED) return Option.some(sent.deliveryId);
        refused = REFUSAL_OF_SEND_OUTCOME[sent.outcome];
        return Option.none();
      }),
    );
  const written = yield* hostedStoreOrUnavailable(
    Effect.flatMap(writer, (write) =>
      write.writeAwaitingLine(target, { text, delivery }, dispatch),
    ),
  );
  if (Result.isFailure(written)) {
    return yield* Effect.fail(
      written.failure.refusal === STORE_WRITE_REFUSAL.NO_CONVERSATION
        ? HOSTED_REFUSAL.NOT_FOUND
        : HOSTED_REFUSAL.INVALID_REQUEST,
    );
  }
  if (Option.isNone(written.success)) {
    return yield* Effect.fail(refused ?? HOSTED_REFUSAL.UNAVAILABLE);
  }
  return hostedJsonResponse(HOSTED_HTTP_STATUS.ACCEPTED, {
    agent: yield* summaryOf(userId, agent),
  });
});

/** GET reads the agent's transcript past the cursor, held open while the agent is starting or runs, with the agent's status as the page was read; POST sends the agent a message. */
const messagesEndpoint = /* @__PURE__ */ Effect.fn("web/agentMessagesEndpoint")(function* (
  seams: CodingAgentsAppSeams,
  writer: Effect.Effect<StoreWriter>,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  if (incoming.method === HTTP_METHOD.POST) {
    return yield* sendMessageEndpoint(seams, writer, request);
  }
  const after = readEither(codingAgentCursorSchema)(
    unparsedWire(new URL(request.url).searchParams.get(QUERY.AFTER) ?? CODING_AGENT_CURSOR_START),
  );
  if (Result.isFailure(after)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { agent, target } = yield* ownedAgent(seams, request);
  const page = yield* hostedStoreOrUnavailable(
    transcriptPast(target, CODER_TOOL_SET, cursorOfWire(after.success), agent),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    messages: page.messages,
    cursor: cursorToWire(page.cursor),
    status: page.status,
  });
});

/** Whether the turn is one a Stop has something to stop: still running, with eve's id to name, and no Stop on it yet. */
function stoppable(turn: CodingAgentLatestTurn | undefined): turn is CodingAgentLatestTurn & {
  readonly eveTurnId: string;
} {
  return (
    turn !== undefined &&
    RUNNING_TURN_STATUSES.has(turn.status) &&
    turn.eveTurnId !== null &&
    turn.cancelRequestedAt === null
  );
}

/** POST stops the agent: eve's cancel of the turn under way, then the row's stamp; an agent with no turn running is answered as it stands. */
const stopEndpoint = /* @__PURE__ */ Effect.fn("web/agentStopEndpoint")(function* (
  seams: CodingAgentsAppSeams,
  writer: Effect.Effect<StoreWriter>,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const { userId, agent, target } = yield* ownedAgent(seams, request);
  const standing = (yield* standingsOf(userId, [agent.conversationId]))(agent.conversationId);
  const turn = standing.turn;
  const now = yield* Clock.currentTimeMillis;
  if (!stoppable(turn)) {
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      agent: codingAgentSummary(agent, standing, now),
    });
  }
  const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));
  if (sessionId === undefined) {
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      agent: codingAgentSummary(agent, standing, now),
    });
  }
  // The cancel names the turn the row was written for, never the session's turn under way, so a
  // turn that ended between the read above and eve's answer is answered `no_active_turn` and
  // nothing newer is stopped in its place.
  const eve = yield* eveFor(seams, request);
  const cancelled = yield* eve
    .cancel(sessionId, turn.eveTurnId)
    .pipe(
      Effect.catchTag("EveUnreachable", (failure) =>
        Effect.as(
          Effect.logWarning(
            `eve could not be reached to stop a coding agent: ${describeUnreachable(failure)}`,
          ),
          { outcome: EVE_CANCEL_OUTCOME.FAILED, status: HOSTED_HTTP_STATUS.BAD_GATEWAY } as const,
        ),
      ),
    );
  if (cancelled.outcome === EVE_CANCEL_OUTCOME.FAILED) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  const at = yield* DateTime.nowAsDate;
  const stamped = yield* hostedStoreOrUnavailable(
    Effect.flatMap(writer, (write) => write.requestTurnCancel(target, { turnId: turn.id, at })),
  );
  if (Result.isFailure(stamped)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const summary = yield* summaryOf(userId, agent);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { agent: summary });
});

/** GET reads what the agent published: its branch and pull request as GitHub holds them, from the instance's kept answers. */
const pullRequestEndpoint = /* @__PURE__ */ Effect.fn("web/agentPullRequestEndpoint")(function* (
  seams: CodingAgentsAppSeams,
  published: PublishedCache,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const { userId, agent } = yield* ownedAgent(seams, request);
  const answer = yield* Cache.get(published, new PublishedKey({ userId, agentId: agent.id })).pipe(
    Effect.catch((failure) => {
      switch (failure._tag) {
        // The row stood a statement ago; an agent gone between the two is not found, as it would be on the next ask.
        case "NoSuchAgent":
          return Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
        case "SqlError":
        case "SchemaError":
          return hostedStoreOrUnavailable(Effect.fail(failure));
        default:
          return githubUserReadOrRefusal(Effect.fail(failure));
      }
    }),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, answer);
});

/** The group: the four paths, and the hosted vocabulary's own refusal for any other. */
export function codingAgentsApp(seams: CodingAgentsAppSeams): WebRoutes<CodingAgentsAppServices> {
  const writer = storeWriter({ tools: CODER_TOOL_SET });
  return Layer.unwrap(
    withPublishedCache((published) =>
      Layer.mergeAll(
        HttpRouter.add(ANY_METHOD, AGENTS_PATH.OF_PLAN, hostedRefusing(planAgentsEndpoint(seams))),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.MESSAGES,
          hostedRefusing(messagesEndpoint(seams, writer)),
        ),
        HttpRouter.add(ANY_METHOD, AGENTS_PATH.STOP, hostedRefusing(stopEndpoint(seams, writer))),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.PULL_REQUEST,
          hostedRefusing(pullRequestEndpoint(seams, published)),
        ),
        hostedNotFoundRoute,
      ),
    ),
  );
}

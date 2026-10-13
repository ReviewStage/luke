import {
  base64Chars,
  CODING_AGENT_BOUNDS,
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_LIST_ARCHIVED,
  CODING_AGENT_LIST_QUERY,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
  codingAgentArchiveRequestSchema,
  codingAgentCallIdSchema,
  codingAgentCursorSchema,
  codingAgentMessageRequestSchema,
  codingAgentRenameRequestSchema,
  codingAgentStartRequestSchema,
} from "@sidecar/hosted/coding-agent-wire";
import {
  INBOX_BOUNDS,
  INBOX_CURSOR_START,
  INBOX_STATUS,
  type InboxItem,
  type InboxReply,
  inboxAnswerMessage,
  inboxAnswerRequestSchema,
  inboxCursorSchema,
  inboxReplyRefusal,
} from "@sidecar/hosted/inbox-wire";
import { modelChoiceSchema } from "@sidecar/hosted/models-wire";
import { readEither } from "@sidecar/wire/effect";
import { Cache, Clock, DateTime, Effect, Layer, Option, Redacted, Result } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import {
  isRecord,
  isWireString,
  type UnparsedWireValue,
  unparsedWire,
  wireUuidSchema,
} from "./core.js";
import type { GitHubApp } from "./github/github-app.js";
import { githubUserReadOrRefusal } from "./github/github-refusal.js";
import {
  describeUnreachable,
  EVE_CANCEL_OUTCOME,
  EVE_MOUNT,
  type EveSessions,
  eveSessions,
} from "./hosted/brain-host/eve-sessions.js";
import { childConversationId } from "./hosted/brain-host/ids.js";
import { recordedRuntimeSession } from "./hosted/brain-host/recorded-session.js";
import { childTitlesOf } from "./hosted/child-titles.js";
import { accountInboxPast, planInboxPast } from "./hosted/coder-host/inbox-page.js";
import {
  type PublishedCache,
  PublishedKey,
  withPublishedCache,
} from "./hosted/coder-host/published.js";
import { acceptedAgentChoice, startCodingAgent } from "./hosted/coder-host/start.js";
import { type AgentTurnStanding, codingAgentSummary } from "./hosted/coder-host/status.js";
import { steerCodingAgent } from "./hosted/coder-host/steer.js";
import { CODER_TOOL_SET } from "./hosted/coder-host/tool-set.js";
import {
  cursorOfWire,
  cursorToWire,
  delegationPast,
  NO_TITLE_AWAITED,
  type TitleAwaited,
  type TranscriptPage,
  titleMayLand,
  transcriptPast,
} from "./hosted/coder-host/transcript.js";
import {
  archiveCodingAgent,
  awaitingLinesOfReached,
  type CodingAgent,
  type CodingAgentLatestTurn,
  latestTurnsOfReached,
  listCodingAgents,
  RUNNING_TURN_STATUSES,
  readCodingAgent,
  renameCodingAgent,
  updateCodingAgentChoice,
} from "./hosted/coding-agent-store.js";
import { HostedEnvironment } from "./hosted/environment.js";
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
  answerInboxItem,
  readInboxAttachment,
  readInboxItem,
  type StoredInboxItem,
  withdrawInboxAnswer,
} from "./hosted/inbox-store.js";
import type { ModelCatalog, ModelChoiceRefused } from "./hosted/model-catalog.js";
import { readPlan } from "./hosted/plan-store.js";
import { type ConversationTarget, type StoreWriter, storeWriter } from "./hosted/store/index.js";
import { logStoreFailure } from "./hosted/store-failure.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * coding-agents-app.ts -- a plan's coding agents: start one, list them, read one's transcript and its workers', message one, change one's model, and stop one.
 *
 * Every endpoint resolves the bearer before it touches a row, and every row
 * it touches is one of a workspace the bearer's account is a member of: a
 * plan or an agent of any other workspace answers exactly as one that names
 * nothing. A member reads, messages, renames, re-chooses, and stops an agent
 * a teammate started, its conversation read and written under that teammate,
 * whose conversation it is. A Start
 * (`POST /api/plans/{id}/agents`) takes the one path a start takes
 * (`hosted/coder-host/start.ts`), which the voice brain's tool shares: the
 * model and effort checked against the catalog, the account's default where
 * the request names none, the plan's repository confirmed reachable through
 * the Luke GitHub App, the agent and its conversation made, and its eve
 * session opened with the plan's document, or the task the request named in
 * its place, as the first message, here under the developer's own bearer so
 * eve's door admits it as the developer. A retry carrying the same key is
 * the same agent, and opens nothing again. The list (`GET /api/plans/{id}/agents`) reads each agent's
 * status from its newest turn. The transcript
 * (`GET /api/agents/{id}/messages?after=`) is the conversation's rows past a
 * cursor, held open while the agent runs (`hosted/coder-host/transcript.ts`).
 * A message (`POST /api/agents/{id}/messages`) is the developer's words
 * handed to the session the agent runs in, under the developer's own
 * bearer, with the client's own key for the send, through the one steer
 * path the voice brain's tool shares (`hosted/coder-host/steer.ts`): the
 * words steer the turn under way, or open a turn where none runs, and are
 * written as a user row awaiting its turn, so the transcript shows the
 * line at once and the agent reads as running until the turn that receives
 * the line takes it (`brain-host/relay.ts`). eve answering that the
 * session is still coming up is a conflict the desktop tries again; eve no
 * longer running the session is one it does not, since the agent's sandbox
 * lives with the session. A change of model (`PATCH /api/agents/{id}`) writes the
 * choice on the agent's row, checked against the catalog as a Start checks
 * its own; the row is read at every step, so the change is the next step's
 * whether a turn runs or the next one is yet to open, and the account's
 * default stands as it was. The same PATCH carrying a title instead renames
 * the agent, the one write of the title that covers whatever stands, and an
 * empty title clears it so the tab falls back to the model's name; the
 * title generated from the agent's first exchange as a turn of its ends
 * lands only where none stands, so a rename is never undone. The same PATCH
 * carrying `archived` archives the agent or brings it back: an archive
 * stops a turn still running first, as a Stop does, and refuses where that
 * Stop could not reach eve, or where the agent works on with no turn a Stop
 * can name yet, still starting or with a line awaiting its turn, which the
 * desktop tries again; an archived agent takes no message; the list leaves an archived agent out unless
 * `archived=include` asks for it, while its transcript and what it
 * published still read by its id. A Stop
 * (`POST /api/agents/{id}/stop`) is eve's cancel
 * of the turn under way, named by eve's own id for it, and the row's stamp;
 * the service's hook stops the sandbox as the cancelled turn ends, and
 * anything the agent pushed stays.
 * What the agent published (`GET /api/agents/{id}/pull-request`) is the
 * branch and pull request its own transcript names, as GitHub holds them
 * now (`hosted/coder-host/published.ts`), kept per agent for a short while
 * so a tab asking beside every held page does not ask GitHub as often.
 * A worker's transcript (`GET /api/agents/{id}/subagents/{callId}/messages`)
 * is read as the agent's own is, under the agent and eve's id for the
 * delegation call that started the worker, which its tool part in the
 * agent's transcript carries: the child conversation is a function of the
 * two (`brain-host/ids.ts`), and only a delegation recorded under an
 * agent the account reaches answers, so a call of any other agent reads as
 * none. Each worker's title, generated from its task as it starts, is
 * carried on its own page and, for every worker titled so far, on the
 * agent's; a read of an ended agent, or worker, with nothing new waits for a
 * title still due, the agent's own or a worker's, since each can land after
 * the turn ended and a reader stops at that read.
 */

const AGENTS_PATH = {
  /** GET lists the plan's agents, the archived ones too where `archived=include` asks; POST starts one; the rewrite moves the path's plan id into the `id` query. */
  OF_PLAN: "/api/plans/agents",
  /** GET reads the agent's transcript past `after`, POST sends the agent a message; the rewrite moves the path's agent id into the `id` query. */
  MESSAGES: "/api/agents/messages",
  /** PATCH changes the agent's model, effort, and context window, renames it, or archives it; the rewrite moves the path's agent id into the `id` query. */
  AGENT: "/api/agents/agent",
  /** POST stops the agent; the rewrite moves the path's agent id into the `id` query. */
  STOP: "/api/agents/stop",
  /** GET reads what the agent published; the rewrite moves the path's agent id into the `id` query. */
  PULL_REQUEST: "/api/agents/pull-request",
  /** GET reads a worker's transcript past `after`; the rewrite moves the path's agent id into the `id` query and the delegation call's id into `call`. */
  SUBAGENT_MESSAGES: "/api/agents/subagent-messages",
  /** GET reads the plan's inbox past `after`; the rewrite moves the path's plan id into the `id` query. */
  INBOX_OF_PLAN: "/api/plans/inbox",
  /** POST answers one inbox item; the rewrite moves the path's item id into the `id` query. */
  INBOX_ITEM: "/api/inbox/item",
  /** GET reads what waits on the developer across the account's plans past `after`. */
  INBOX: "/api/inbox",
  /** GET serves one attachment of an inbox item, an image block's picture; the rewrite moves the item id into the `id` query and the attachment id into `attachment`. */
  INBOX_ATTACHMENT: "/api/inbox/attachment",
} as const;

const HTTP_METHOD = { GET: "GET", POST: "POST", PATCH: "PATCH" } as const;

const QUERY = { ID: "id", AFTER: "after", CALL: "call", ATTACHMENT: "attachment" } as const;

/**
 * The headers an attachment's bytes are served under beside their type: the
 * browser is told not to sniff them for another type, since the type is
 * what the service sniffed them to be as they were kept, and nothing on the
 * way may keep a copy, since the bytes are one account's.
 */
const ATTACHMENT_HEADERS = {
  "x-content-type-options": "nosniff",
  "cache-control": "private, no-store",
} as const;

/** The files one message or Start may carry: their base64 together, and each one's name at JSON's widest escape with room for the keys around it. */
const MAXIMUM_ATTACHMENTS_BODY_BYTES =
  base64Chars(CODING_AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES) +
  CODING_AGENT_BOUNDS.MAX_ATTACHMENTS * (6 * CODING_AGENT_BOUNDS.MAX_ATTACHMENT_NAME_CHARS + 128);

/** A Start names a key, a choice, and a task with its files at most: the task's bound at JSON's widest escape, the files, and room for the rest. */
const MAXIMUM_START_BODY_BYTES =
  6 * CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS + MAXIMUM_ATTACHMENTS_BODY_BYTES + 4_096;

/** An answer is a note and a few short fields: the note's bound at JSON's widest escape, and room for the rest. */
const MAXIMUM_INBOX_ANSWER_BODY_BYTES =
  6 *
    (INBOX_BOUNDS.MAX_NOTE_CHARS +
      INBOX_BOUNDS.MAX_FIELDS *
        (INBOX_BOUNDS.MAX_LABEL_CHARS + INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS) +
      INBOX_BOUNDS.MAX_OPTIONS * INBOX_BOUNDS.MAX_LABEL_CHARS) +
  2_048;

/** A change names a model, an effort, and a window, a title, or an archive, at most, so a body past this is no change. */
const MAXIMUM_CHOICE_BODY_BYTES = 4_096;

/** A message is its words, its files, and a key: the bound's characters at JSON's widest escape, the files, and room for the keys around them. */
const MAXIMUM_MESSAGE_BODY_BYTES =
  6 * CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS + MAXIMUM_ATTACHMENTS_BODY_BYTES + 1_024;

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
  | ModelCatalog
  | HostedEnvironment;

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

/** The one id the path put under the query name; two is refused, and one that is no UUID names no row. */
const uuidOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
  name: string,
): Effect.fn.Return<string, HostedRefusal> {
  const ids = new URL(request.url).searchParams.getAll(name);
  const [id] = ids;
  if (id === undefined || ids.length !== 1) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/** The one id the path named under `id`. */
const idOf = (request: Request) => uuidOf(request, QUERY.ID);

/** The one attachment the path named under `attachment`. */
const attachmentIdOf = (request: Request) => uuidOf(request, QUERY.ATTACHMENT);

/** The delegation call the path named under `query`, or not found for one that is no call id. */
const callIdOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const call = new URL(request.url).searchParams.get(QUERY.CALL) ?? "";
  const read = readEither(codingAgentCallIdSchema)(unparsedWire(call));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/** The cursor the request reads past, or the start where it names none; refused where it names something else. */
const cursorOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const after = readEither(codingAgentCursorSchema)(
    unparsedWire(new URL(request.url).searchParams.get(QUERY.AFTER) ?? CODING_AGENT_CURSOR_START),
  );
  if (Result.isFailure(after)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return after.success;
});

/**
 * What a read of an ended agent, or of its worker, waits on for a title:
 * the worker named, or the agent's own or any of its workers' where none
 * is; nothing on a deployment that generates no titles, which is one
 * without Luke's Anthropic key, the title model's (`coder-host/model.ts`).
 */
const titleAwaitedOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  parent: ConversationTarget,
  childConversationId?: string,
): Effect.fn.Return<TitleAwaited, never, HostedEnvironment> {
  const environment = yield* HostedEnvironment;
  return environment.anthropicKey === undefined
    ? NO_TITLE_AWAITED
    : titleMayLand(parent, childConversationId);
});

/** A page of a transcript as the wire answers it. */
function transcriptResponse(
  page: TranscriptPage,
  title: string | null,
): HttpServerResponse.HttpServerResponse {
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    messages: page.messages,
    cursor: cursorToWire(page.cursor),
    status: page.status,
    ...(page.runStartedAt === undefined ? undefined : { runStartedAt: page.runStartedAt }),
    ...(page.delegations === undefined ? undefined : { delegations: page.delegations }),
    ...(page.subagentTitles === undefined ? undefined : { subagentTitles: page.subagentTitles }),
    title,
    ...(page.failureReason === undefined ? undefined : { failureReason: page.failureReason }),
    ...(page.usage === undefined ? undefined : { usage: page.usage }),
    ...(page.turnUsage === undefined ? undefined : { turnUsage: page.turnUsage }),
    ...(page.context === undefined ? undefined : { context: page.context }),
  });
}

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

/** Where each of the agents' conversations named stands now, read by id since the agents passed the plan's gate: its newest turn, and whether a line of the developer's awaits one. */
const standingsOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  conversationIds: readonly string[],
): Effect.fn.Return<
  (conversationId: string) => AgentTurnStanding,
  HostedRefusal,
  SqlClient.SqlClient
> {
  const turns = yield* hostedStoreOrUnavailable(latestTurnsOfReached(conversationIds));
  const awaiting = yield* hostedStoreOrUnavailable(awaitingLinesOfReached(conversationIds));
  return (conversationId) => ({
    turn: turns.get(conversationId),
    lineAwaits: awaiting.has(conversationId),
  });
});

/** The agent's summary with its status read now. */
const summaryOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: CodingAgent,
): Effect.fn.Return<CodingAgentSummary, HostedRefusal, SqlClient.SqlClient> {
  const standing = yield* standingsOf([agent.conversationId]);
  return codingAgentSummary(agent, standing(agent.conversationId), yield* Clock.currentTimeMillis);
});

/** A choice the catalog refused is an invalid request, on the wire. */
const choiceOrInvalid = <A, E, R>(
  effect: Effect.Effect<A, E | ModelChoiceRefused, R>,
): Effect.Effect<A, E | HostedRefusal, R> =>
  Effect.catchTag(effect, "ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST));

/**
 * POST: an agent started on the plan, or the one a retry under the same key
 * already started, on the one start path (`hosted/coder-host/start.ts`),
 * reaching eve as the developer.
 */
const startEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: CodingAgentsAppSeams,
  request: Request,
  userId: string,
  planId: string,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const body = yield* readJsonBodyEffect(MAXIMUM_START_BODY_BYTES);
  const asked = readEither(codingAgentStartRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { idempotencyKey, model, effort, contextWindow, task, attachments } = asked.success;
  // A choice is one thing: a model without its effort, or the reverse, names nothing to run on,
  // and a window without them is a window of no model.
  if (
    (model === undefined) !== (effort === undefined) ||
    (contextWindow !== undefined && model === undefined)
  ) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const choice =
    model !== undefined && effort !== undefined
      ? { model, effort, ...(contextWindow === undefined ? undefined : { contextWindow }) }
      : undefined;
  const { agent, created } = yield* choiceOrInvalid(
    startCodingAgent(eveFor(seams, request), userId, {
      planId,
      idempotencyKey,
      choice,
      task,
      attachments,
    }),
  );
  if (!created) {
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { agent: yield* summaryOf(agent) });
  }
  return hostedJsonResponse(HOSTED_HTTP_STATUS.CREATED, {
    agent: codingAgentSummary(
      agent,
      { turn: undefined, lineAwaits: false },
      yield* Clock.currentTimeMillis,
    ),
  });
});

/** Whether a list read asks for the archived agents too; a build from before archiving never does. */
function listsArchived(request: Request): boolean {
  const asked = new URL(request.url).searchParams.get(CODING_AGENT_LIST_QUERY.ARCHIVED);
  return asked === CODING_AGENT_LIST_ARCHIVED.INCLUDE;
}

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
  const agents = yield* hostedStoreOrUnavailable(
    listCodingAgents(userId, planId, { includeArchived: listsArchived(request) }),
  );
  const standing = yield* standingsOf(agents.map((agent) => agent.conversationId));
  const now = yield* Clock.currentTimeMillis;
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    agents: agents.map((agent) => codingAgentSummary(agent, standing(agent.conversationId), now)),
  });
});

/**
 * The agent the path names, where the account is a member of its plan's
 * workspace, or not found; its conversation is targeted under the member
 * who started it, which is whom the conversation belongs to.
 */
const reachedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
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
    target: { userId: agent.value.userId, conversationId: agent.value.conversationId },
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

/**
 * POST sends the agent a message: the developer's words handed to the
 * session the agent runs in under the developer's own bearer, through the
 * one steer path the voice brain's tool shares (`coder-host/steer.ts`),
 * with the client's own key for the send.
 */
const sendMessageEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: CodingAgentsAppSeams,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const { userId, agent } = yield* reachedAgent(seams, request);
  const body = yield* readJsonBodyEffect(MAXIMUM_MESSAGE_BODY_BYTES);
  const asked = readEither(codingAgentMessageRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(messageRefusal(body));
  const eve = yield* eveFor(seams, request);
  yield* steerCodingAgent(eve, writer, userId, agent, asked.success);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.ACCEPTED, {
    agent: yield* summaryOf(agent),
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
  const after = yield* cursorOf(request);
  const { userId, agent, target } = yield* reachedAgent(seams, request);
  const titleAwaited = yield* titleAwaitedOf(target);
  const page = yield* hostedStoreOrUnavailable(
    transcriptPast(target, CODER_TOOL_SET, cursorOfWire(after), agent, agent, titleAwaited),
  );
  // The title is read after the page, since it lands after a turn ends, which a held read may span.
  const titled = yield* hostedStoreOrUnavailable(readCodingAgent(userId, agent.id));
  return transcriptResponse(
    page,
    Option.match(titled, { onNone: () => agent.title, onSome: (now) => now.title }),
  );
});

/** GET reads a worker's transcript past the cursor, held open while the worker runs as the agent's own is: the child conversation of the delegation call named, where the account's agent recorded one, with the worker's title once one landed. A call recorded nowhere yet while the agent runs is waited for (`delegationPast`), and past the wait answers the empty page of a worker still starting, so a tab opened the moment the call was requested keeps reading. */
const subagentMessagesEndpoint = /* @__PURE__ */ Effect.fn("web/agentSubagentMessagesEndpoint")(
  function* (
    seams: CodingAgentsAppSeams,
  ): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method !== HTTP_METHOD.GET) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const after = yield* cursorOf(request);
    const callId = yield* callIdOf(request);
    const { agent, target } = yield* reachedAgent(seams, request);
    const conversationId = childConversationId(agent.conversationId, callId);
    const read = yield* hostedStoreOrUnavailable(delegationPast(target, conversationId, agent));
    if (read.delegation === undefined) {
      if (!read.agentRuns) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return transcriptResponse(
        { messages: [], cursor: cursorOfWire(after), status: CODING_AGENT_STATUS.STARTING },
        null,
      );
    }
    const titleAwaited = yield* titleAwaitedOf(target, conversationId);
    const page = yield* hostedStoreOrUnavailable(
      transcriptPast(
        { userId: agent.userId, conversationId },
        CODER_TOOL_SET,
        cursorOfWire(after),
        { createdAt: read.delegation.createdAt },
        undefined,
        titleAwaited,
      ),
    );
    // The title is read after the page, since it lands beside the worker's start, which a held read may span.
    const titles = yield* hostedStoreOrUnavailable(childTitlesOf(target, [conversationId]));
    return transcriptResponse(page, titles.get(conversationId) ?? null);
  },
);

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

/** eve's cancel of the agent's turn under way, then the row's stamp; nothing where no turn runs that a Stop has to stop. */
const stoppedTurn = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: CodingAgentsAppSeams,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  agent: CodingAgent,
  target: ConversationTarget,
): Effect.fn.Return<void, HostedRefusal, AgentsServices> {
  const turn = (yield* standingsOf([agent.conversationId]))(agent.conversationId).turn;
  if (!stoppable(turn)) return;
  const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));
  if (sessionId === undefined) return;
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
});

/**
 * PATCH changes the agent for what follows, and answers it as it then
 * stands. A body naming a title renames it: the title written whole on the
 * row, or cleared where the title is empty, so the tab falls back to the
 * model's name. A body naming a model and effort, and the standard context
 * window where it is chosen, changes what its next step runs on, a body
 * naming no window putting the agent back on the model's whole one: the choice checked
 * against the catalog as a Start checks its own,
 * written on the row the steps read; the account's default is untouched.
 * A body naming `archived` archives the agent, stopping a turn still
 * running first as a Stop does, or brings it back.
 */
const changeEndpoint = /* @__PURE__ */ Effect.fn("web/agentChangeEndpoint")(function* (
  seams: CodingAgentsAppSeams,
  writer: Effect.Effect<StoreWriter>,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.PATCH) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const { userId, agent, target } = yield* reachedAgent(seams, request);
  const body = yield* readJsonBodyEffect(MAXIMUM_CHOICE_BODY_BYTES);
  const rename = readEither(codingAgentRenameRequestSchema)(body);
  if (Result.isSuccess(rename)) {
    const { title } = rename.success;
    const renamed = yield* hostedStoreOrUnavailable(
      renameCodingAgent(userId, agent.id, title.length === 0 ? null : title),
    );
    if (Option.isNone(renamed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      agent: yield* summaryOf(renamed.value),
    });
  }
  const archive = readEither(codingAgentArchiveRequestSchema)(body);
  if (Result.isSuccess(archive)) {
    const { archived } = archive.success;
    if (archived) {
      // An archived agent works on unseen, so a turn still running is stopped before the stamp.
      yield* stoppedTurn(seams, writer, request, agent, target);
      // A session still coming up, or a line awaiting the turn it opens, has no turn a Stop can
      // name yet, so nothing is archived until there is one to stop or it has ended.
      const { status } = yield* summaryOf(agent);
      if (status === CODING_AGENT_STATUS.STARTING || status === CODING_AGENT_STATUS.RUNNING) {
        return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
      }
    }
    const changed = yield* hostedStoreOrUnavailable(archiveCodingAgent(userId, agent.id, archived));
    if (Option.isNone(changed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      agent: yield* summaryOf(changed.value),
    });
  }
  const asked = readEither(modelChoiceSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const choice = yield* choiceOrInvalid(acceptedAgentChoice(userId, asked.success));
  const changed = yield* hostedStoreOrUnavailable(
    updateCodingAgentChoice(userId, agent.id, choice),
  );
  if (Option.isNone(changed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    agent: yield* summaryOf(changed.value),
  });
});

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
  const { agent, target } = yield* reachedAgent(seams, request);
  yield* stoppedTurn(seams, writer, request, agent, target);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { agent: yield* summaryOf(agent) });
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
  const { userId, agent } = yield* reachedAgent(seams, request);
  // Whether the agent has ended is part of the key, so the first ask after its turn ends reads GitHub afresh.
  const { status } = yield* summaryOf(agent);
  const ended = status !== CODING_AGENT_STATUS.STARTING && status !== CODING_AGENT_STATUS.RUNNING;
  const answer = yield* Cache.get(
    published,
    new PublishedKey({ userId, agentId: agent.id, ended }),
  ).pipe(
    Effect.catch((failure) => {
      switch (failure._tag) {
        // The row stood a statement ago; an agent gone between the two is not found, as it would be on the next ask.
        case "NoSuchAgent":
          return Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
        case "RepositoryNotReachable":
          return Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
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

/** The inbox cursor the request reads past, or the start where it names none; refused where it names something else. */
const inboxCursorOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const after = readEither(inboxCursorSchema)(
    unparsedWire(new URL(request.url).searchParams.get(QUERY.AFTER) ?? INBOX_CURSOR_START),
  );
  if (Result.isFailure(after)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return after.success;
});

/** GET reads the plan's inbox past the cursor: every item its agents posted, held open while nothing changed. */
const planInboxEndpoint = /* @__PURE__ */ Effect.fn("web/planInboxEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const after = yield* inboxCursorOf(request);
  const planId = yield* idOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const plan = yield* hostedStoreOrUnavailable(readPlan(userId, planId));
  if (Option.isNone(plan)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const page = yield* hostedStoreOrUnavailable(planInboxPast(userId, planId, after));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, page);
});

/** GET reads what waits on the developer across the account's plans past the cursor: every open item, held open while nothing changed. */
const accountInboxEndpoint = /* @__PURE__ */ Effect.fn("web/accountInboxEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const after = yield* inboxCursorOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const page = yield* hostedStoreOrUnavailable(accountInboxPast(userId, after));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, page);
});

/**
 * GET serves one attachment of an inbox item, an image block's picture, as
 * its bytes under the media type the service sniffed them to be as they
 * were kept, to the item's account alone: an attachment of another
 * account's, or of another item's, is not found, as an item is.
 */
const inboxAttachmentEndpoint = /* @__PURE__ */ Effect.fn("web/inboxAttachmentEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const itemId = yield* idOf(request);
  const attachmentId = yield* attachmentIdOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const found = yield* hostedStoreOrUnavailable(readInboxAttachment(userId, itemId, attachmentId));
  if (Option.isNone(found)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return HttpServerResponse.uint8Array(found.value.bytes, {
    status: HOSTED_HTTP_STATUS.OK,
    contentType: found.value.contentType,
    headers: ATTACHMENT_HEADERS,
  });
});

/** An item as an answer comes back with it, and whether the answer was taken. */
function inboxAnswered(item: InboxItem, taken: boolean): HttpServerResponse.HttpServerResponse {
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { item, taken });
}

/** Whether a hand-off was refused because the agent's session has ended for good, so no message will ever reach it. */
function retiredRefusal(refusal: HostedRefusal): boolean {
  return refusal.error === HOSTED_REFUSAL.AGENT_RETIRED.error;
}

/**
 * POST answers one item of a plan of the account's workspaces, whichever
 * member started its agent. An answer naming a
 * revision the agent has since moved on from, or an item no longer open,
 * is answered with the item as it stands and not taken. Otherwise the
 * answer is taken first, at the revision it names, and only then, where
 * the item asks to be heard back, handed to the agent as one of the
 * developer's messages under the answer's own key through the one steer
 * path (`coder-host/steer.ts`), so an answer the item no longer takes
 * never reaches the agent. A hand-off that fails, is interrupted, or dies
 * takes the answer back, so an item never reads answered while the agent
 * was not told; and an answer sent again under the key it was taken by is
 * handed off again, which the steer's own key makes reach the agent once,
 * so a hand-off cut short by the function's own end is finished by the
 * retry rather than reported done. An agent whose session has ended for
 * good can hear nothing again, so its item keeps the answer rather than
 * waiting on the developer for ever.
 */
const inboxAnswerEndpoint = /* @__PURE__ */ Effect.fn("web/inboxAnswerEndpoint")(function* (
  seams: CodingAgentsAppSeams,
  writer: Effect.Effect<StoreWriter>,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const itemId = yield* idOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const stored = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
  if (Option.isNone(stored)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const body = yield* readJsonBodyEffect(MAXIMUM_INBOX_ANSWER_BODY_BYTES);
  const asked = readEither(inboxAnswerRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { revision, clientKey, ...reply } = asked.success;
  const taken = yield* takenAnswer(userId, stored.value, { revision, clientKey, reply });
  if (taken === undefined) {
    // Not taken: the item moved on, or another answer settled it; it is answered as it now stands.
    const now = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
    if (Option.isNone(now)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return inboxAnswered(now.value.item, now.value.answerKey === clientKey);
  }
  if (!taken.needsReply || taken.answer === undefined) return inboxAnswered(taken, true);
  const answer = taken.answer;
  const handedOver = Effect.gen(function* () {
    const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, taken.agentId));
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* eveFor(seams, request);
    yield* steerCodingAgent(eve, writer, userId, agent.value, {
      text: inboxAnswerMessage(taken, answer),
      clientKey,
    });
  });
  yield* handedOver.pipe(
    Effect.catchIf(retiredRefusal, () => Effect.void),
    Effect.onError(() =>
      withdrawInboxAnswer(userId, itemId, clientKey).pipe(
        Effect.tapError(logStoreFailure),
        Effect.ignore,
      ),
    ),
  );
  return inboxAnswered(taken, true);
});

/**
 * The item with the answer standing on it under the request's key: taken
 * now where the item is open at the revision named and takes the answer,
 * or as an earlier send under the same key took it; nothing where it was
 * not taken. Refused where the answer does not fit the item.
 */
const takenAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  stored: StoredInboxItem,
  asked: { readonly revision: number; readonly clientKey: string; readonly reply: InboxReply },
): Effect.fn.Return<InboxItem | undefined, HostedRefusal, SqlClient.SqlClient> {
  const { item, answerKey } = stored;
  if (answerKey === asked.clientKey) return item;
  if (item.status !== INBOX_STATUS.OPEN || item.revision !== asked.revision) return undefined;
  if (inboxReplyRefusal(item, asked.reply) !== undefined) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const answered = yield* hostedStoreOrUnavailable(
    answerInboxItem(userId, item.id, asked.revision, asked.reply, asked.clientKey),
  );
  return Option.getOrUndefined(answered);
});

/** The group: the nine paths, and the hosted vocabulary's own refusal for any other. */
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
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.AGENT,
          hostedRefusing(changeEndpoint(seams, writer)),
        ),
        HttpRouter.add(ANY_METHOD, AGENTS_PATH.STOP, hostedRefusing(stopEndpoint(seams, writer))),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.PULL_REQUEST,
          hostedRefusing(pullRequestEndpoint(seams, published)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.SUBAGENT_MESSAGES,
          hostedRefusing(subagentMessagesEndpoint(seams)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.INBOX_OF_PLAN,
          hostedRefusing(planInboxEndpoint(seams)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.INBOX_ITEM,
          hostedRefusing(inboxAnswerEndpoint(seams, writer)),
        ),
        HttpRouter.add(ANY_METHOD, AGENTS_PATH.INBOX, hostedRefusing(accountInboxEndpoint(seams))),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.INBOX_ATTACHMENT,
          hostedRefusing(inboxAttachmentEndpoint(seams)),
        ),
        hostedNotFoundRoute,
      ),
    ),
  );
}

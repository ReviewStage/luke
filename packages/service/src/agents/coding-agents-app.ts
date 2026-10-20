import type { DatabaseServices } from "@luke/database/core/query";
import { readCodingAgent } from "@luke/database/models/coding-agent-store";
import { readConversationPicture } from "@luke/database/models/conversation-pictures";
import { childConversationId } from "@luke/database/models/ids";
import { readTask } from "@luke/database/models/task-store";
import { type StoreWriter, storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { ACCOUNT_INBOX_ARCHIVED, ACCOUNT_INBOX_QUERY } from "@luke/features/account-inbox-wire";
import {
  type CodingAgentAttachment,
  codingAgentCallIdSchema,
} from "@luke/features/coding-agent-wire";
import { githubImageOf } from "@luke/features/github-image";
import {
  INBOX_BOUNDS,
  INBOX_CURSOR_START,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxItem,
  type InboxReply,
  inboxAnswerHeard,
  inboxAnswerMessage,
  inboxAnswerRequestSchema,
  inboxAnswersReply,
  inboxClosedMessage,
  inboxCloseRequestSchema,
  inboxCursorSchema,
  inboxMessageRequestSchema,
  inboxReadAllRequestSchema,
  inboxReplyRefusal,
  inboxThreadMessage,
} from "@luke/features/inbox-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { unparsedWire } from "../core.js";
import type { HostedEnvironment } from "../environment.js";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import { githubImage } from "../github/github-images.js";
import { githubReadOrRefusal } from "../github/github-refusal.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_BYTES_HEADERS,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import {
  answerInboxAsk,
  answerInboxItem,
  closeInboxItemAsMember,
  INBOX_ASK_ANSWER,
  INBOX_MESSAGE_OUTCOME,
  inboxItemArchived,
  markInboxItemRead,
  markInboxItemUnread,
  markInboxRead,
  postInboxMessage,
  readInboxAttachment,
  readInboxItem,
  type StoredInboxItem,
  withdrawInboxAnswer,
  withdrawInboxClose,
  withdrawInboxMessage,
} from "../inbox/inbox-store.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { reachedAgent, resolvedUserId, uuidOf } from "./agent-reach.js";
import { accountInboxPast, agentInboxPast, taskInboxPast } from "./coder-host/inbox-page.js";
import { agentPullRequestReach } from "./coder-host/published.js";
import type { SummaryModelOf } from "./coder-host/replay-summary.js";
import { MAXIMUM_ATTACHMENTS_BODY_BYTES } from "./coder-host/start.js";
import { steerCodingAgent } from "./coder-host/steer.js";
import { type EveReach, eveFor } from "./coder-host/stop.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";

/**
 * coding-agents-app.ts -- a task's coding agents: start one, list them, read one's transcript and its workers', message one, change one's model, and stop one.
 *
 * The Start, both lists, an agent's own page and the PATCH that changes
 * it, a Stop, its changes, and its review options now answer through the
 * hosted oRPC router (`agents-procedures.ts`), on the terms said of them
 * here.
 *
 * Every endpoint resolves the bearer before it touches a row, and every row
 * it touches is one of a workspace the bearer's account is a member of: a
 * task or an agent of any other workspace answers exactly as one that names
 * nothing. A member reads, messages, renames, re-chooses, and stops an agent
 * a teammate started, its conversation read and written under that teammate,
 * whose conversation it is. A Start
 * (`POST /api/plans/{id}/agents`) takes the one path a start takes
 * (`packages/service/src/agents/coder-host/start.ts`), which the voice brain's tool shares: the
 * model and effort checked against the catalog, the account's default where
 * the request names none, the task's repository confirmed reachable through
 * the Luke GitHub App, the agent and its conversation made, and its eve
 * session opened with the task's document, or the prompt the request named in
 * its place, as the first message, here as the request's own caller so eve's
 * door admits it as the developer: over the developer's bearer, or, for a
 * browser's session cookie, as the deployment acting for the account the
 * cookie named (`coder-host/stop.ts`'s `eveFor`), which the coder channel
 * mints as the developer's own principal. A retry carrying the same key is
 * the same agent, and opens nothing again. The list (`GET /api/plans/{id}/agents`) reads each agent's
 * status from its newest turn. The transcript and a message to the agent
 * (`/api/agents/{id}/messages`), and a worker's transcript, are the hosted
 * oRPC router's (`messages-procedures.ts`). A change of model (`PATCH /api/agents/{id}`) writes the
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
 * published still read by its id. The same PATCH carrying `pinned` pins
 * the agent for the asking member alone, or unpins it, as a plan's pin is
 * its reader's own (`agent-pin.ts`). A Stop
 * (`POST /api/agents/{id}/stop`) is eve's cancel
 * of the turn under way, named by eve's own id for it, and the row's stamp;
 * the service's hook stops the sandbox as the cancelled turn ends, and
 * anything the agent pushed stays.
 * What the agent published, its Pull request tab's overview, a change to
 * its pull request, and which files the member marked viewed are the hosted
 * oRPC router's (`agent-pull-request-procedures.ts`), and the pull request
 * those reads are about is decided once for both (`asked-pull-request.ts`).
 * The agent's changes (`GET /api/agents/{id}/changes`) are the files of
 * that pull request, read from GitHub afresh on each ask
 * (`github/pull-requests.ts`), each with its patch, or none where the
 * agent has opened none yet. What the
 * reviewer and label pickers offer (`GET /api/agents/{id}/review-options`),
 * the repository's labels, collaborators, and teams, is read on a token for
 * the agent's repository, as the overview is. An image the overview's
 * words name (`GET /api/agents/{id}/github-image`) is
 * read on a token for the agent's repository too, an upload re-signed by its
 * asset's id (`github/github-images.ts`), and answered as bytes.
 */

const AGENTS_PATH = {
  /** GET reads one image its pull request's overview names, by its address in the `src` query; the rewrite moves the path's agent id into the `id` query. */
  GITHUB_IMAGE: "/api/agents/github-image",
  /** GET reads the task's inbox past `after`; the rewrite moves the path's task id into the `id` query. */
  INBOX_OF_TASK: "/api/plans/inbox",
  /** GET reads one agent's inbox past `after`, an agent with no task as much as one on a task; the rewrite moves the path's agent id into the `id` query. */
  INBOX_OF_AGENT: "/api/agents/inbox",
  /** POST answers one inbox item; the rewrite moves the path's item id into the `id` query. */
  INBOX_ITEM: "/api/inbox/item",
  /** POST closes one open inbox item without an answer, as a member; the rewrite moves the path's item id into the `id` query. */
  INBOX_CLOSE: "/api/inbox/close",
  /** POST writes a member's message on one inbox item's thread; the rewrite moves the path's item id into the `id` query. */
  INBOX_MESSAGES: "/api/inbox/messages",
  /** PUT marks one inbox item read for the asking member and DELETE marks it unread, where the rewrite moves the path's item id into the `id` query; PUT with no `id` marks every item their Inbox lists read. */
  INBOX_READ: "/api/inbox/read",
  /** GET reads what waits on the developer across the account's tasks past `after`. */
  INBOX: "/api/inbox",
  /** GET serves one attachment of an inbox item, an image block's picture; the rewrite moves the item id into the `id` query and the attachment id into `attachment`. */
  INBOX_ATTACHMENT: "/api/inbox/attachment",
  /** GET serves one picture a tool answered the agent, or one of its workers where the query names the delegation call; the rewrite moves the agent id into the `id` query, the call into `call`, and the picture into `picture`. */
  PICTURE: "/api/agents/picture",
} as const;

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
  PATCH: "PATCH",
  PUT: "PUT",
  DELETE: "DELETE",
} as const;

const QUERY = {
  ID: "id",
  AFTER: "after",
  CALL: "call",
  ATTACHMENT: "attachment",
  PICTURE: "picture",
  SRC: "src",
  NUMBER: "number",
} as const;

/** An answer is a note, a few short fields, and the files a message may carry: the note's bound at JSON's widest escape, the files, and room for the rest. */
const MAXIMUM_INBOX_ANSWER_BODY_BYTES =
  6 *
    (INBOX_BOUNDS.MAX_NOTE_CHARS +
      INBOX_BOUNDS.MAX_FIELDS *
        (INBOX_BOUNDS.MAX_LABEL_CHARS + INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS) +
      INBOX_BOUNDS.MAX_OPTIONS * INBOX_BOUNDS.MAX_LABEL_CHARS) +
  MAXIMUM_ATTACHMENTS_BODY_BYTES +
  2_048;

export interface CodingAgentsAppSeams extends EveReach {
  resolveUserId: UserIdResolver;
  /** The model a Start from another agent summarizes the steps it cannot keep on; the deployment's own (`coder-host/replay-summary.ts`) where none is named. */
  summaryModel?: SummaryModelOf;
}

/** What the routes may require of the function that stands them. */
export type CodingAgentsAppServices =
  | DatabaseServices
  | GitHubApp
  | HttpClient.HttpClient
  | ModelCatalog
  | HostedEnvironment;

type AgentsServices = CodingAgentsAppServices | HttpServerRequest.HttpServerRequest;

/** The one id the path named under `id`. */
const idOf = (request: Request) => uuidOf(request, QUERY.ID);

/** The one attachment the path named under `attachment`. */
const attachmentIdOf = (request: Request) => uuidOf(request, QUERY.ATTACHMENT);

/** The one picture the path named under `picture`. */
const pictureIdOf = (request: Request) => uuidOf(request, QUERY.PICTURE);

/** The delegation call the path named under `query`, or not found for one that is no call id. */
const callIdOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const call = new URL(request.url).searchParams.get(QUERY.CALL) ?? "";
  const read = readEither(codingAgentCallIdSchema)(unparsedWire(call));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/**
 * GET reads one image the agent's pull request's overview names, by the
 * address GitHub's rendering spelled (`src`): an upload re-signed on a token
 * minted for the agent's repository, a file of that repository read through
 * its contents on the same token, or a public image on GitHub's image proxy
 * (`github/github-images.ts`); refused as invalid for any address that is
 * none of them, and not found where GitHub answers no image the window
 * draws, a file of any other repository among them.
 */
const githubImageEndpoint = /* @__PURE__ */ Effect.fn("web/agentGitHubImageEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const image = githubImageOf(new URL(request.url).searchParams.get(QUERY.SRC) ?? "");
  if (image === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { userId, agent } = yield* reachedAgent(seams, request);
  const read = yield* Effect.gen(function* () {
    const { token } = yield* agentPullRequestReach(userId, agent);
    return yield* githubImage(token, agent.repository, image);
  }).pipe(
    Effect.catch((failure) => {
      switch (failure._tag) {
        case "RepositoryNotReachable":
          return Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
        case "SqlError":
        case "EffectDrizzleQueryError":
        case "SchemaError":
          return hostedStoreOrUnavailable(Effect.fail(failure));
        default:
          return githubReadOrRefusal(Effect.fail(failure));
      }
    }),
  );
  if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return HttpServerResponse.uint8Array(read.value.bytes, {
    status: HOSTED_HTTP_STATUS.OK,
    contentType: read.value.contentType,
    headers: HOSTED_BYTES_HEADERS,
  });
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

/** GET reads the task's inbox past the cursor: every item its agents posted, held open while nothing changed. */
const taskInboxEndpoint = /* @__PURE__ */ Effect.fn("web/taskInboxEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const after = yield* inboxCursorOf(request);
  const taskId = yield* idOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const task = yield* hostedStoreOrUnavailable(readTask(userId, taskId));
  if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const page = yield* hostedStoreOrUnavailable(taskInboxPast(userId, taskId, after));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, page);
});

/** GET reads one agent's inbox past the cursor: every item it posted, held open while nothing changed, for any member of its workspace. */
const agentInboxEndpoint = /* @__PURE__ */ Effect.fn("web/agentInboxEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const after = yield* inboxCursorOf(request);
  const { userId, agent } = yield* reachedAgent(seams, request);
  const page = yield* hostedStoreOrUnavailable(agentInboxPast(userId, agent.id, after));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, page);
});

/** GET reads what waits on the developer across the account's tasks past the cursor: every open item, held open while nothing changed, the archived tasks holding items listed too where `archived=include` asks. */
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
  const archived =
    new URL(request.url).searchParams.get(ACCOUNT_INBOX_QUERY.ARCHIVED) ===
    ACCOUNT_INBOX_ARCHIVED.INCLUDE;
  const page = yield* hostedStoreOrUnavailable(accountInboxPast(userId, after, { archived }));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, page);
});

/**
 * GET serves one attachment of an inbox item, an image block's picture or a
 * file the developer's answer carried, as its bytes under the media type
 * the service sniffed a picture to be or a file travelled as, to the
 * members of the item's workspace alone: an attachment of another
 * workspace's, or of another item's, is not found, as an item is.
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
    headers: HOSTED_BYTES_HEADERS,
  });
});

/**
 * GET serves one picture a tool answered an agent, kept beside its
 * transcript (`brain-host/relay-pictures.ts`), as its bytes under the media
 * type the service sniffed them to be, to whoever may read the agent; one of
 * its workers' where the path names the delegation call, read from that
 * worker's own transcript. A picture of another agent's transcript, or of
 * another worker's, is not found, as an agent the account cannot reach is.
 */
const pictureEndpoint = /* @__PURE__ */ Effect.fn("web/agentPictureEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const pictureId = yield* pictureIdOf(request);
  const worker = new URL(request.url).searchParams.has(QUERY.CALL);
  const callId = worker ? yield* callIdOf(request) : undefined;
  const { agent } = yield* reachedAgent(seams, request);
  const conversationId =
    callId === undefined ? agent.conversationId : childConversationId(agent.conversationId, callId);
  const found = yield* hostedStoreOrUnavailable(readConversationPicture(conversationId, pictureId));
  if (Option.isNone(found)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return HttpServerResponse.uint8Array(found.value.bytes, {
    status: HOSTED_HTTP_STATUS.OK,
    contentType: found.value.contentType,
    headers: HOSTED_BYTES_HEADERS,
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
 * POST answers one item of a task of the account's workspaces, whichever
 * member started its agent. An answer naming a
 * revision the agent has since moved on from, or an item no longer open,
 * is answered with the item as it stands and not taken. Otherwise the
 * answer is taken first, at the revision it names, with the files it
 * carries kept as the item's, and only then, where the item asks to be
 * heard back or the developer typed a note or attached a file, handed to
 * the agent as one of the developer's messages, its files with it, under
 * the answer's own key through the one steer
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
  // An item put away with its task is read but not answered, whether or not its agent would hear it, until the task is back.
  if (yield* hostedStoreOrUnavailable(inboxItemArchived(userId, itemId))) {
    return yield* Effect.fail(HOSTED_REFUSAL.TASK_ARCHIVED);
  }
  const body = yield* readJsonBodyEffect(MAXIMUM_INBOX_ANSWER_BODY_BYTES);
  const asked = readEither(inboxAnswerRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { revision, clientKey, attachments = [], ...reply } = asked.success;
  // An answer sent again under the key it was taken under is the same answer, counted once.
  const counted =
    stored.value.answerKey === clientKey
      ? Effect.void
      : recordServerEvent(SERVER_EVENT.INBOX_ANSWER_SEND, userId, {});
  const taken = yield* takenAnswer(userId, stored.value, {
    revision,
    clientKey,
    reply,
    attachments,
  });
  if (taken === undefined) {
    // Not taken: the item moved on, or another answer settled it; it is answered as it now stands.
    const now = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
    if (Option.isNone(now)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return inboxAnswered(now.value.item, now.value.answerKey === clientKey);
  }
  if (taken.answer === undefined || !inboxAnswerHeard(taken, taken.answer, taken.answerFiles)) {
    yield* counted;
    return inboxAnswered(taken, true);
  }
  const answer = taken.answer;
  const handedOver = Effect.gen(function* () {
    const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, taken.agentId));
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* eveFor(seams, request, userId);
    yield* steerCodingAgent(eve, writer, userId, agent.value, {
      text: inboxAnswerMessage(taken, answer),
      attachments,
      clientKey,
      sender: { kind: MESSAGE_SENDER.MEMBER, userId },
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
  // Counted only once the hand-off stands, since a failed one withdraws the answer above.
  yield* counted;
  return inboxAnswered(taken, true);
});

/** A close is a revision and a key, so a few hundred bytes hold it. */
const MAXIMUM_INBOX_CLOSE_BODY_BYTES = 1_024;

/**
 * POST closes one open item of a task of the account's workspaces without
 * an answer, whichever member started its agent, at the revision the member
 * was shown, and answers as an answer does: the item as it then stands, and
 * whether the close was taken, which it is not where the agent changed the
 * item first or it was settled already. A close taken is handed to the
 * agent, under its own lead, only where the item asks to be heard back, so
 * an agent waiting on it is not left waiting; otherwise the agent reads it
 * the next time it reads its inbox. A hand-off that fails, is interrupted,
 * or dies opens the item again, so it never reads closed while an agent
 * waiting on it was not told; a close sent again under the key it was taken
 * by is handed off again, which the steer's own key makes reach the agent
 * once. An agent whose session has ended for good can hear nothing again,
 * so its item stays closed.
 */
const inboxCloseEndpoint = /* @__PURE__ */ Effect.fn("web/inboxCloseEndpoint")(function* (
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
  // An item put away with its task is read but not closed, as it is not answered, until the task is back.
  if (yield* hostedStoreOrUnavailable(inboxItemArchived(userId, itemId))) {
    return yield* Effect.fail(HOSTED_REFUSAL.TASK_ARCHIVED);
  }
  const body = yield* readJsonBodyEffect(MAXIMUM_INBOX_CLOSE_BODY_BYTES);
  const asked = readEither(inboxCloseRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { revision, clientKey } = asked.success;
  const { item, answerKey } = stored.value;
  // A close sent again is the one taken only while the item still stands as that close left it, never once its agent moved it on.
  const retried =
    answerKey === clientKey &&
    item.status === INBOX_STATUS.CLOSED &&
    item.closedReason === undefined &&
    item.revision === revision;
  const taken = retried
    ? item
    : item.status !== INBOX_STATUS.OPEN || item.revision !== revision
      ? undefined
      : Option.getOrUndefined(
          yield* hostedStoreOrUnavailable(
            closeInboxItemAsMember(userId, itemId, revision, clientKey),
          ),
        );
  if (taken === undefined) {
    // Not taken: the item moved on, or an answer or a close settled it; it is answered as it now stands.
    const now = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
    if (Option.isNone(now)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return inboxAnswered(now.value.item, false);
  }
  if (!taken.needsReply) return inboxAnswered(taken, true);
  const handedOver = Effect.gen(function* () {
    const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, taken.agentId));
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* eveFor(seams, request, userId);
    yield* steerCodingAgent(eve, writer, userId, agent.value, {
      text: inboxClosedMessage(taken),
      attachments: [],
      clientKey,
      sender: { kind: MESSAGE_SENDER.MEMBER, userId },
    });
  });
  yield* handedOver.pipe(
    Effect.catchIf(retiredRefusal, () => Effect.void),
    Effect.onError(() =>
      withdrawInboxClose(userId, itemId, clientKey).pipe(
        Effect.tapError(logStoreFailure),
        Effect.ignore,
      ),
    ),
  );
  return inboxAnswered(taken, true);
});

/** A message is its words, the files a message may carry, and the answer it may carry: the words' and the answer's picks and values at JSON's widest escape, the files, and room for the key, the ask, and the steps. */
const MAXIMUM_INBOX_MESSAGE_BODY_BYTES =
  6 *
    (INBOX_BOUNDS.MAX_MESSAGE_CHARS +
      INBOX_BOUNDS.MAX_FIELDS *
        (INBOX_BOUNDS.MAX_LABEL_CHARS + INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS) +
      INBOX_BOUNDS.MAX_OPTIONS * INBOX_BOUNDS.MAX_LABEL_CHARS) +
  MAXIMUM_ATTACHMENTS_BODY_BYTES +
  2_048;

/**
 * POST writes a member's message on the thread of one item of the account's
 * workspaces, open or settled, whichever member started its agent, and
 * answers with the item as it then stands. The message is written first,
 * with its files, moving the item's last change and nothing else of it,
 * and then handed to the agent as one of the developer's messages, under
 * its own lead and its files with it, through the one steer path
 * (`coder-host/steer.ts`), which opens a turn for an agent that stopped as
 * a message typed in its tab does. A hand-off that fails, is interrupted,
 * or dies takes the message back off the thread, so the thread never shows
 * a message the agent was not told, where this send wrote it; a message sent again under its key is the one already
 * written and handed off again, which the steer's own key makes reach the
 * agent once, and another message under a key already taken, by another
 * member or with other words or files, is refused. An agent whose session has ended for good can
 * hear nothing again, so its item keeps the message. A message that carries
 * the answer to the thread's open ask is the reply that answers it, as
 * `inboxAnswerByReply` takes one; one without is a plain reply, which never
 * answers, even while an ask stands open.
 */
const inboxMessageEndpoint = /* @__PURE__ */ Effect.fn("web/inboxMessageEndpoint")(function* (
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
  const body = yield* readJsonBodyEffect(MAXIMUM_INBOX_MESSAGE_BODY_BYTES);
  const asked = readEither(inboxMessageRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { text, clientKey, attachments = [], answers } = asked.success;
  if (answers !== undefined) {
    return yield* inboxAnswerByReply(seams, writer, request, userId, itemId, {
      text,
      clientKey,
      attachments,
      answers,
    });
  }
  const posted = yield* hostedStoreOrUnavailable(
    postInboxMessage(userId, itemId, { text, clientKey, files: attachments }),
  );
  if (Option.isNone(posted)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { item, outcome } = posted.value;
  if (outcome === INBOX_MESSAGE_OUTCOME.KEY_REUSED) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  // Note that a repeat leaves the message standing on failure, because the write that wrote it decides whether it stays.
  const unheard =
    outcome === INBOX_MESSAGE_OUTCOME.WRITTEN
      ? withdrawInboxMessage(userId, itemId, clientKey)
      : Effect.void;
  const handedOver = Effect.gen(function* () {
    const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, item.agentId));
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* eveFor(seams, request, userId);
    yield* steerCodingAgent(eve, writer, userId, agent.value, {
      text: inboxThreadMessage(item, text),
      attachments,
      clientKey,
      sender: { kind: MESSAGE_SENDER.MEMBER, userId },
    });
  });
  yield* handedOver.pipe(
    Effect.catchIf(retiredRefusal, () => Effect.void),
    Effect.onError(() => unheard.pipe(Effect.tapError(logStoreFailure), Effect.ignore)),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { item });
});

/**
 * A member's reply that answers the thread's open ask, as the window sends
 * one from version 5: the answer taken first, with the reply's words and
 * files, as the member's message that carries it (`answerInboxAsk`), and
 * then, by the rule an answer by revision follows (`inboxAnswerHeard`),
 * handed to the agent under the answer's own lead, its files with it, under
 * the reply's key through the one steer path; otherwise kept for the agent
 * to read in its own time. An item put away with its task is not answered.
 * An answer to an ask the thread no longer holds open, to another message,
 * or one the ask does not take is refused, as a message's request is. A
 * hand-off that fails, is interrupted, or dies takes the answer back, as
 * one by revision does, so the thread never reads answered while the agent
 * was not told; an answer sent again under the key it was taken by is
 * handed off again, which the steer's own key makes reach the agent once.
 * An agent whose session has ended for good can hear nothing again, so its
 * item keeps the answer. It answers as a plain reply does: the item as it
 * then stands.
 */
const inboxAnswerByReply = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: CodingAgentsAppSeams,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  userId: string,
  itemId: string,
  sent: {
    readonly text: string;
    readonly clientKey: string;
    readonly attachments: readonly CodingAgentAttachment[];
    readonly answers: InboxAnswers;
  },
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const { text, clientKey, attachments, answers } = sent;
  // An item put away with its task is read but not answered, as an answer by revision is not, until the task is back.
  if (yield* hostedStoreOrUnavailable(inboxItemArchived(userId, itemId))) {
    return yield* Effect.fail(HOSTED_REFUSAL.TASK_ARCHIVED);
  }
  const answered = yield* hostedStoreOrUnavailable(
    answerInboxAsk(userId, itemId, { answers, text, clientKey, files: attachments }),
  );
  if (Option.isNone(answered)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { item, outcome } = answered.value;
  if (outcome === INBOX_ASK_ANSWER.NOT_OPEN || outcome === INBOX_ASK_ANSWER.REFUSED) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const messaged = hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { item });
  // An answer sent again under the key it was taken under is the same answer, counted once.
  const counted =
    outcome === INBOX_ASK_ANSWER.TAKEN
      ? recordServerEvent(SERVER_EVENT.INBOX_ANSWER_SEND, userId, {})
      : Effect.void;
  const reply = inboxAnswersReply(answers, text);
  if (!inboxAnswerHeard(item, reply, attachments)) {
    yield* counted;
    return messaged;
  }
  const handedOver = Effect.gen(function* () {
    const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, item.agentId));
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* eveFor(seams, request, userId);
    yield* steerCodingAgent(eve, writer, userId, agent.value, {
      text: inboxAnswerMessage(item, reply),
      attachments,
      clientKey,
      sender: { kind: MESSAGE_SENDER.MEMBER, userId },
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
  // Counted only once the hand-off stands, since a failed one withdraws the answer above.
  yield* counted;
  return messaged;
});

/** A request to mark every item read names at most a workspace, so a few hundred bytes hold it. */
const MAXIMUM_INBOX_READ_ALL_BODY_BYTES = 1_024;

/**
 * The member's own read state on the Inbox, which no other member's moves.
 * Where the path names an item, PUT marks it read, which is what opening
 * it does and writes nothing where it stands read already, and DELETE
 * marks it unread until they read it again; each answers the item's id and
 * its read state, and an item of a workspace the account is not in is not
 * found. Where the path names none, PUT marks every item their Inbox lists
 * read, in the workspace the body names or in all of theirs, and answers
 * how many were unread.
 */
const inboxReadEndpoint = /* @__PURE__ */ Effect.fn("web/inboxReadEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const named = new URL(request.url).searchParams.has(QUERY.ID);
  const method = incoming.method;
  if (method !== HTTP_METHOD.PUT && !(named && method === HTTP_METHOD.DELETE)) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  if (!named) {
    const body = yield* readJsonBodyEffect(MAXIMUM_INBOX_READ_ALL_BODY_BYTES);
    const asked = readEither(inboxReadAllRequestSchema)(body);
    if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const userId = yield* resolvedUserId(seams, request);
    const marked = yield* hostedStoreOrUnavailable(
      markInboxRead(userId, asked.success.workspaceId),
    );
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { marked });
  }
  const itemId = yield* idOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const unread = method === HTTP_METHOD.DELETE;
  const found = yield* hostedStoreOrUnavailable(
    unread ? markInboxItemUnread(userId, itemId) : markInboxItemRead(userId, itemId),
  );
  if (!found) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { id: itemId, unread });
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
  asked: {
    readonly revision: number;
    readonly clientKey: string;
    readonly reply: InboxReply;
    readonly attachments: readonly CodingAgentAttachment[];
  },
): Effect.fn.Return<InboxItem | undefined, HostedRefusal, DatabaseServices> {
  const { item, answerKey } = stored;
  if (answerKey === asked.clientKey) return item;
  if (item.status !== INBOX_STATUS.OPEN || item.revision !== asked.revision) return undefined;
  if (inboxReplyRefusal(item, asked.reply, asked.attachments) !== undefined) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const answered = yield* hostedStoreOrUnavailable(
    answerInboxItem(
      userId,
      item.id,
      asked.revision,
      asked.reply,
      asked.clientKey,
      asked.attachments,
    ),
  );
  return Option.getOrUndefined(answered);
});

/** The group: its paths, and the hosted vocabulary's own refusal for any other. */
export function codingAgentsApp(seams: CodingAgentsAppSeams): WebRoutes<CodingAgentsAppServices> {
  const writer = storeWriter({ tools: CODER_TOOL_SET });
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      AGENTS_PATH.GITHUB_IMAGE,
      hostedRefusing(githubImageEndpoint(seams)),
    ),
    HttpRouter.add(ANY_METHOD, AGENTS_PATH.INBOX_OF_TASK, hostedRefusing(taskInboxEndpoint(seams))),
    HttpRouter.add(
      ANY_METHOD,
      AGENTS_PATH.INBOX_OF_AGENT,
      hostedRefusing(agentInboxEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      AGENTS_PATH.INBOX_ITEM,
      hostedRefusing(inboxAnswerEndpoint(seams, writer)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      AGENTS_PATH.INBOX_CLOSE,
      hostedRefusing(inboxCloseEndpoint(seams, writer)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      AGENTS_PATH.INBOX_MESSAGES,
      hostedRefusing(inboxMessageEndpoint(seams, writer)),
    ),
    HttpRouter.add(ANY_METHOD, AGENTS_PATH.INBOX_READ, hostedRefusing(inboxReadEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, AGENTS_PATH.INBOX, hostedRefusing(accountInboxEndpoint(seams))),
    HttpRouter.add(
      ANY_METHOD,
      AGENTS_PATH.INBOX_ATTACHMENT,
      hostedRefusing(inboxAttachmentEndpoint(seams)),
    ),
    HttpRouter.add(ANY_METHOD, AGENTS_PATH.PICTURE, hostedRefusing(pictureEndpoint(seams))),
    hostedNotFoundRoute,
  );
}

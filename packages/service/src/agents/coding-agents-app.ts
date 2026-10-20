import type { DatabaseServices } from "@luke/database/core/query";
import { readConversationPicture } from "@luke/database/models/conversation-pictures";
import { childConversationId } from "@luke/database/models/ids";
import { codingAgentCallIdSchema } from "@luke/features/coding-agent-wire";
import { githubImageOf } from "@luke/features/github-image";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { unparsedWire } from "../core.js";
import type { HostedEnvironment } from "../environment.js";
import type { GitHubApp } from "../github/github-app.js";
import { githubImage } from "../github/github-images.js";
import { githubReadOrRefusal } from "../github/github-refusal.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_BYTES_HEADERS,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { readInboxAttachment } from "../inbox/inbox-store.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { reachedAgent, resolvedUserId, uuidOf } from "./agent-reach.js";
import { agentPullRequestReach } from "./coder-host/published.js";
import type { SummaryModelOf } from "./coder-host/replay-summary.js";
import type { EveReach } from "./coder-host/stop.js";

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
  /** GET serves one attachment of an inbox item, an image block's picture; the rewrite moves the item id into the `id` query and the attachment id into `attachment`. */
  INBOX_ATTACHMENT: "/api/inbox/attachment",
  /** GET serves one picture a tool answered the agent, or one of its workers where the query names the delegation call; the rewrite moves the agent id into the `id` query, the call into `call`, and the picture into `picture`. */
  PICTURE: "/api/agents/picture",
} as const;

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
  PATCH: "PATCH",
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

/** The group: its paths, and the hosted vocabulary's own refusal for any other. */
export function codingAgentsApp(seams: CodingAgentsAppSeams): WebRoutes<CodingAgentsAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      AGENTS_PATH.GITHUB_IMAGE,
      hostedRefusing(githubImageEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      AGENTS_PATH.INBOX_ATTACHMENT,
      hostedRefusing(inboxAttachmentEndpoint(seams)),
    ),
    HttpRouter.add(ANY_METHOD, AGENTS_PATH.PICTURE, hostedRefusing(pictureEndpoint(seams))),
    hostedNotFoundRoute,
  );
}

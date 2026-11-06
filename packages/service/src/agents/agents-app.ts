import type { DatabaseServices } from "@repo/database/core/query";
import { readQueuedFile } from "@repo/database/models/agent-queue-store";
import { hasRepository } from "@repo/database/models/agent-store";
import { readConversationPicture } from "@repo/database/models/conversation-pictures";
import { childConversationId } from "@repo/database/models/ids";
import { agentCallIdSchema } from "@repo/features/agent-wire";
import { githubImageOf } from "@repo/features/github-image";
import { HTTP_METHOD } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Layer, Option, Result, type Scope } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { unparsedWire } from "../core.js";
import type { HostedEnvironment } from "../environment.js";
import type { GitHubApp } from "../github/github-app.js";
import { githubImage } from "../github/github-images.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_BYTES_HEADERS,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  resolvedUserId,
  type UserIdResolver,
  uuidOf,
} from "../http/http-effect.js";
import { readInboxAttachment } from "../inbox/inbox-store.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { reachedAgent } from "./agent-reach.js";
import { githubReadRefusal } from "./asked-pull-request.js";
import { agentPullRequestReach } from "./coder-host/published.js";

const AGENTS_PATH = {
  GITHUB_IMAGE: "/api/agents/github-image",
  INBOX_ATTACHMENT: "/api/inbox/attachment",
  PICTURE: "/api/agents/picture",
} as const;

const QUERY = {
  ID: "id",
  CALL: "call",
  ATTACHMENT: "attachment",
  PICTURE: "picture",
  SRC: "src",
} as const;

export interface AgentsAppSeams {
  resolveUserId: UserIdResolver;
}

export type AgentsAppServices =
  | DatabaseServices
  | GitHubApp
  | HttpClient.HttpClient
  | ModelCatalog
  | HostedEnvironment;

type AgentsServices = AgentsAppServices | HttpServerRequest.HttpServerRequest | Scope.Scope;

const idOf = (request: Request) => uuidOf(request, QUERY.ID);

const attachmentIdOf = (request: Request) => uuidOf(request, QUERY.ATTACHMENT);

const pictureIdOf = (request: Request) => uuidOf(request, QUERY.PICTURE);

const callIdOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const call = new URL(request.url).searchParams.get(QUERY.CALL) ?? "";
  const read = readEither(agentCallIdSchema)(unparsedWire(call));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

const githubImageEndpoint = /* @__PURE__ */ Effect.fn("web/agentGitHubImageEndpoint")(function* (
  seams: AgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const image = githubImageOf(new URL(request.url).searchParams.get(QUERY.SRC) ?? "");
  if (image === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { userId, agent } = yield* reachedAgent(seams, request);
  if (!hasRepository(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const read = yield* Effect.gen(function* () {
    const { token } = yield* agentPullRequestReach(userId, agent);
    return yield* githubImage(token, agent.repository, image);
  }).pipe(githubReadRefusal);
  if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return HttpServerResponse.uint8Array(read.value.bytes, {
    status: HOSTED_HTTP_STATUS.OK,
    contentType: read.value.contentType,
    headers: HOSTED_BYTES_HEADERS,
  });
});

const inboxAttachmentEndpoint = /* @__PURE__ */ Effect.fn("web/inboxAttachmentEndpoint")(function* (
  seams: AgentsAppSeams,
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

const pictureEndpoint = /* @__PURE__ */ Effect.fn("web/agentPictureEndpoint")(function* (
  seams: AgentsAppSeams,
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
  if (Option.isNone(found)) {
    const queued =
      callId === undefined
        ? yield* hostedStoreOrUnavailable(readQueuedFile(agent.id, pictureId))
        : Option.none();
    if (Option.isNone(queued)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return HttpServerResponse.uint8Array(Buffer.from(queued.value.data, "base64"), {
      status: HOSTED_HTTP_STATUS.OK,
      contentType: queued.value.mediaType,
      headers: HOSTED_BYTES_HEADERS,
    });
  }
  return HttpServerResponse.uint8Array(found.value.bytes, {
    status: HOSTED_HTTP_STATUS.OK,
    contentType: found.value.contentType,
    headers: HOSTED_BYTES_HEADERS,
  });
});

export function agentsApp(seams: AgentsAppSeams): WebRoutes<AgentsAppServices> {
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

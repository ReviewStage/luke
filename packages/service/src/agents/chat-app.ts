import type { DatabaseServices } from "@luke/database/core/query";
import {
  answerAsk,
  type ChatMemberRow,
  type ChatPost,
  channelNamed,
  ensureGeneral,
  ensureMember,
  findOrMakeDm,
  memberNamed,
  messageAt,
  readTo,
  resolveAsk,
} from "@luke/database/models/chat-store";
import { storeWriter } from "@luke/database/models/writer";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import {
  CHAT_BLOCK,
  CHAT_BOUNDS,
  CHAT_CURSOR_START,
  CHAT_QUERY,
  CHAT_TARGET_SIGIL,
  type ChatBlock,
  type ChatReply,
  chatCursorSchema,
  chatWriteRequestSchema,
  MEMBER_KIND,
  mentionedHandles,
  replyRefusal,
} from "@luke/features/chat-wire";
import { workspaceIdSchema } from "@luke/features/plan-wire";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result, Schema } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import type { GitHubApp } from "../github/github-app.js";
import {
  type ChatTelling,
  HELD_DOORS,
  HOSTED_OF_CHAT_REFUSAL,
  postChat,
  tellMessage,
} from "./coder-host/chat-notify.js";
import { messageOnWire, workspaceChatPast } from "./coder-host/chat-page.js";
import { type EveReach, eveFor } from "./coder-host/stop.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";

/**
 * chat-app.ts -- a workspace's chat as the window reads it and writes to it.
 *
 * `GET /api/workspaces/chat?workspaceId=&after=` answers what a person in
 * the workspace sees of its chat past the cursor, held open while nothing
 * moved (`hosted/coder-host/chat-page.ts`): the roster, the channels, the
 * messages posted or changed past the cursor, and the cursor to read on
 * from. `POST` to the same path writes as the account's own member of the
 * workspace, one of four things: a post, to a channel by `#name`, a
 * member's DM by `@handle`, `#general` where unsaid, or a thread by the
 * place of the message it replies to, told to the members it addresses
 * through the one door a coding agent's post goes through too
 * (`hosted/coder-host/chat-notify.ts`); an answer to an ask, at the
 * revision the window drew, posted as the person's reply in its thread and
 * told to the ask's poster where it asked to hear back; a resolve of an
 * ask of the person's own; and how far the person has read. The workspace
 * is named in the query as the members read names it. The bearer is
 * resolved before any row is touched, a workspace the account is not in
 * answers as one that names nothing, and eve is reached under the
 * person's own bearer, as a message to an agent is.
 */

const HTTP_METHOD = { GET: "GET", POST: "POST" } as const;

/** A cursor as the window hands it back: the next place in the workspace's sequence it has yet to read, in decimal. */
const seqCursorSchema = chatCursorSchema.check(Schema.isPattern(/^(0|[1-9][0-9]{0,14})$/u));

/** A write is at most a post's blocks at JSON's widest escape, and room for the keys around them. */
const MAXIMUM_WRITE_BODY_BYTES =
  6 * CHAT_BOUNDS.MAX_BLOCKS * CHAT_BOUNDS.MAX_MARKDOWN_CHARS + 4_096;

export interface ChatAppSeams extends EveReach {
  resolveUserId: UserIdResolver;
}

/** What the routes may require of the function that stands them. */
export type ChatAppServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

type ChatServices = ChatAppServices | HttpServerRequest.HttpServerRequest;

/** Who writes, where: the account, the workspace, and the account's own member of it. */
interface Writer {
  readonly userId: string;
  readonly organizationId: string;
  readonly self: ChatMemberRow;
}

/** The one value the query names under the name; none or two is refused. */
const queryOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
  name: string,
  absent?: string,
): Effect.fn.Return<string, HostedRefusal> {
  const named = new URL(request.url).searchParams.getAll(name);
  if (named.length === 0 && absent !== undefined) return absent;
  const [value] = named;
  if (value === undefined || named.length !== 1) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return value;
});

/** The workspace the query names, refused where it names none or one that is no workspace's id. */
const workspaceOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const workspace = readEither(workspaceIdSchema)(
    unparsedWire(yield* queryOf(request, CHAT_QUERY.WORKSPACE_ID)),
  );
  if (Result.isFailure(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return workspace.success;
});

/** The bearer's account, or the invalid-token refusal. */
const accountOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: ChatAppSeams,
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/** GET reads the workspace's chat past the cursor, held open while nothing moved. */
const readChat = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: ChatAppSeams,
  request: Request,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, ChatServices> {
  const workspace = yield* workspaceOf(request);
  const after = readEither(seqCursorSchema)(
    unparsedWire(yield* queryOf(request, CHAT_QUERY.AFTER, CHAT_CURSOR_START)),
  );
  if (Result.isFailure(after)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const userId = yield* accountOf(seams, request);
  const page = yield* hostedStoreOrUnavailable(
    workspaceChatPast(userId, workspace, Number(after.success)),
  );
  if (Option.isNone(page)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, page.value);
});

/** What a door needs to tell the members a person's message addresses, eve reached under the person's own bearer. */
const tellingOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: ChatAppSeams,
  request: Request,
  writer: Writer,
): Effect.fn.Return<ChatTelling, HostedRefusal, HttpClient.HttpClient> {
  return {
    eve: yield* eveFor(seams, request),
    writer: storeWriter({ tools: CODER_TOOL_SET }),
    userId: writer.userId,
    organizationId: writer.organizationId,
    doors: HELD_DOORS,
  };
});

/** Where a person's post goes: the message it replies to, a channel by `#name`, a member's DM by `@handle`, or `#general`. */
const placeOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Writer,
  to: string | undefined,
  replyTo: number | undefined,
): Effect.fn.Return<ChatPost["to"], HostedRefusal, DatabaseServices> {
  const { userId, organizationId } = writer;
  if (replyTo !== undefined) return { replyTo };
  const channel =
    to === undefined
      ? yield* hostedStoreOrUnavailable(ensureGeneral(userId, organizationId))
      : to.startsWith(CHAT_TARGET_SIGIL.CHANNEL)
        ? yield* hostedStoreOrUnavailable(channelNamed(userId, organizationId, to.slice(1)))
        : yield* dmWith(writer, to.slice(1));
  if (Option.isNone(channel)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return { channelId: channel.value.id };
});

/** The person's DM with the member a handle names; nothing where it names none, or the person. */
const dmWith = /* @__PURE__ */ Effect.fnUntraced(function* (writer: Writer, handle: string) {
  const { userId, organizationId, self } = writer;
  const other = yield* hostedStoreOrUnavailable(memberNamed(userId, organizationId, handle));
  if (Option.isNone(other)) return Option.none();
  return yield* hostedStoreOrUnavailable(
    findOrMakeDm(userId, organizationId, self.id, other.value.id),
  );
});

/** The handles a post's words mention, read off its Markdown. */
function mentionsOf(blocks: readonly ChatBlock[]): readonly string[] {
  const words = blocks.flatMap((block) => (block.type === CHAT_BLOCK.MARKDOWN ? [block.text] : []));
  return mentionedHandles(words.join("\n"));
}

/** A person's post, told to the members it addresses: the message as the window reads it, and who it came to. */
const postAsPerson = /* @__PURE__ */ Effect.fnUntraced(function* (
  telling: Effect.Effect<ChatTelling, HostedRefusal, HttpClient.HttpClient>,
  writer: Writer,
  post: {
    readonly text?: string;
    readonly blocks?: readonly ChatBlock[];
    readonly to?: string;
    readonly replyTo?: number;
    readonly clientKey: string;
  },
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, ChatServices> {
  const blocks =
    post.blocks ??
    (post.text === undefined ? [] : [{ type: CHAT_BLOCK.MARKDOWN, text: post.text }]);
  const to = yield* placeOf(writer, post.to, post.replyTo);
  const told = yield* postChat(yield* telling, {
    authorMemberId: writer.self.id,
    to,
    blocks,
    mentions: mentionsOf(blocks),
    clientKey: post.clientKey,
  });
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    posted: messageOnWire(told.message),
    receipt: told.receipt,
  });
});

/**
 * A person's answer to an ask at the revision the window drew, taken as
 * `answerAsk` takes one, and its reply told to the ask's poster and the
 * thread's earlier repliers where the ask asked to hear back. An answer
 * the ask no longer takes, at a revision its poster moved past or on an
 * ask no longer open, is answered with the ask as it stands, not taken.
 */
const answerAsPerson = /* @__PURE__ */ Effect.fnUntraced(function* (
  telling: Effect.Effect<ChatTelling, HostedRefusal, HttpClient.HttpClient>,
  writer: Writer,
  asked: {
    readonly answer: { readonly seq: number; readonly revision: number; readonly reply: ChatReply };
    readonly clientKey: string;
  },
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, ChatServices> {
  const { userId, organizationId, self } = writer;
  const { seq, revision, reply } = asked.answer;
  const message = yield* hostedStoreOrUnavailable(messageAt(userId, organizationId, self.id, seq));
  const ask = Option.flatMap(message, (row) => Option.fromNullishOr(row.ask));
  if (Option.isNone(ask)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  if (replyRefusal(ask.value.response, reply) !== undefined) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const answered = yield* hostedStoreOrUnavailable(
    answerAsk(userId, organizationId, {
      answererMemberId: self.id,
      seq,
      revision,
      reply,
      clientKey: asked.clientKey,
    }),
  );
  if (Result.isFailure(answered)) {
    return yield* Effect.fail(HOSTED_OF_CHAT_REFUSAL[answered.failure]);
  }
  const { ask: now, reply: posted, taken } = answered.success;
  if (taken && Option.isSome(posted) && ask.value.needsReply !== false) {
    yield* tellMessage(yield* telling, posted.value, []);
  }
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { ask: messageOnWire(now), taken });
});

/** A person's own ask resolved with why; not found where the place holds no ask of theirs. */
const resolveAsPerson = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Writer,
  seq: number,
  reason: string,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, DatabaseServices> {
  const { userId, organizationId, self } = writer;
  const message = yield* hostedStoreOrUnavailable(messageAt(userId, organizationId, self.id, seq));
  const key = Option.flatMap(
    Option.filter(message, (row) => row.authorMemberId === self.id),
    (row) => Option.fromNullishOr(row.askKey),
  );
  if (Option.isNone(key)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const resolved = yield* hostedStoreOrUnavailable(
    resolveAsk(userId, organizationId, self.id, key.value, reason),
  );
  if (Option.isNone(resolved)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { resolved: messageOnWire(resolved.value) });
});

/** How far the person has read, moved on to the place given, never back. */
const readToAsPerson = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Writer,
  seq: number,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, DatabaseServices> {
  const { userId, organizationId, self } = writer;
  const moved = yield* hostedStoreOrUnavailable(readTo(userId, organizationId, self.id, seq));
  if (Option.isNone(moved)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { readSeq: moved.value });
});

/** POST writes to the workspace's chat as the account's own member of it: a post, an answer, a resolve, or a read. */
const writeChat = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: ChatAppSeams,
  request: Request,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, ChatServices> {
  const organizationId = yield* workspaceOf(request);
  const userId = yield* accountOf(seams, request);
  const body = yield* readJsonBodyEffect(MAXIMUM_WRITE_BODY_BYTES);
  const asked = readEither(chatWriteRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const self = yield* hostedStoreOrUnavailable(
    ensureMember(userId, organizationId, { kind: MEMBER_KIND.HUMAN, userId }),
  );
  if (Option.isNone(self)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const writer = { userId, organizationId, self: self.value };
  const telling = tellingOf(seams, request, writer);
  const write = asked.success;
  if ("readTo" in write) return yield* readToAsPerson(writer, write.readTo);
  if ("resolve" in write) {
    return yield* resolveAsPerson(writer, write.resolve.seq, write.resolve.reason);
  }
  if ("answer" in write) return yield* answerAsPerson(telling, writer, write);
  return yield* postAsPerson(telling, writer, write);
});

/** The chat's one path: GET reads it, POST writes to it. */
const chatEndpoint = /* @__PURE__ */ Effect.fn("web/chatEndpoint")(function* (
  seams: ChatAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, ChatServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  if (incoming.method === HTTP_METHOD.POST) return yield* writeChat(seams, request);
  return yield* readChat(seams, request);
});

/** The group: the chat's path, and the hosted vocabulary's own refusal for any other. */
export function chatApp(seams: ChatAppSeams): WebRoutes<ChatAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.WORKSPACES_CHAT,
      hostedRefusing(chatEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}

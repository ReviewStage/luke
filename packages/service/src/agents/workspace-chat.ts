import type { DatabaseServices } from "@luke/database/core/query";
import { chatEnabledFor } from "@luke/database/models/account-store";
import {
  answerAsk,
  type ChatImageWrite,
  type ChatMemberRow,
  type ChatPost,
  channelNamed,
  editTopicChannel,
  ensureGeneral,
  ensureMember,
  findOrMakeDm,
  memberOfSubject,
  messageAt,
  openTopicChannel,
  readAllTo,
  readTo,
  resolveAsk,
} from "@luke/database/models/chat-store";
import { chatAttachmentId } from "@luke/database/models/ids";
import { storeWriter } from "@luke/database/models/writer";
import { chatTargetMember } from "@luke/features/chat-mentions";
import {
  CHAT_BLOCK,
  CHAT_BOUNDS,
  CHAT_CURSOR_START,
  CHAT_TARGET_SIGIL,
  type ChatAnswer,
  type ChatBlock,
  type ChatReply,
  type ChatWriteAnswer,
  type ChatWriteRequest,
  chatCursorSchema,
  MEMBER_KIND,
  replyRefusal,
} from "@luke/features/chat-wire";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import { sniffImageType } from "@luke/features/image-signature";
import { workspaceIdSchema } from "@luke/features/task-wire";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";
import type { HttpClient } from "effect/http";
import { HostedEnvironment } from "../environment.js";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { EVE_MOUNT, type EveSessions, eveSessionsComposer } from "./brain-host/eve-sessions.js";
import { type ChatNamed, namedIn, subjectOf } from "./coder-host/chat-ask.js";
import {
  CHAT_DOORS,
  type ChatTelling,
  HOSTED_OF_CHAT_REFUSAL,
  postChat,
  tellMessage,
} from "./coder-host/chat-notify.js";
import {
  channelOnWire,
  messageOnWire,
  readsOf,
  workspaceChatPast,
} from "./coder-host/chat-page.js";
import { MAXIMUM_ATTACHMENTS_BODY_BYTES } from "./coder-host/start.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";

/**
 * workspace-chat.ts -- a workspace's chat as the window reads it and writes to it.
 *
 * `GET /api/workspaces/chat?workspaceId=&after=` answers what a person in
 * the workspace sees of its chat past the cursor, held open while nothing
 * moved (`hosted/coder-host/chat-page.ts`): the roster, the channels, the
 * messages posted or changed past the cursor, and the cursor to read on
 * from. `POST` to the same path writes as the account's own member of the
 * workspace, one of four things: a post, to the channel the window shows
 * by its id, a channel by `#name`, a member's DM by the member's mention
 * link, `#general` where unsaid, or a thread by the
 * place of the message it replies to, told to the members it addresses
 * through the one door a coding agent's post goes through too
 * (`hosted/coder-host/chat-notify.ts`); an answer to an ask, at the
 * revision the window drew, posted as the person's reply in its thread and
 * told to the ask's poster where it asked to hear back; a resolve of an
 * ask of the person's own; and how far the person has read. A post may
 * carry pictures, each sniffed as the image its bytes are, kept under an
 * id of the post's key and its place, and named by an image block after
 * the words (`chat-attachment-app.ts` serves one back). The workspace
 * is named in the query as the members read names it. The bearer is
 * resolved before any row is touched, a workspace the account is not in
 * answers as one that names nothing, as does every workspace for an
 * account that has not turned on the Chat experiment (`EXPERIMENT.CHAT`), and a notice reaches an agent through
 * eve as the deployment acting for whoever started the agent, as the
 * planner's message to an agent does, since a person may tell an agent a
 * teammate started.
 */

/** A cursor as the window hands it back: the next place in the workspace's sequence it has yet to read, in decimal. */
const seqCursorSchema = chatCursorSchema.check(Schema.isPattern(/^(0|[1-9][0-9]{0,14})$/u));

/** A write is at most a post's blocks at JSON's widest escape, its pictures as a message to an agent carries files, and room for the keys around them. */
export const MAXIMUM_CHAT_WRITE_BODY_BYTES =
  6 * CHAT_BOUNDS.MAX_BLOCKS * CHAT_BOUNDS.MAX_MARKDOWN_CHARS +
  MAXIMUM_ATTACHMENTS_BODY_BYTES +
  4_096;

export interface ChatSeams {
  /** The origin eve answers on; nothing where the deployment names none, which refuses every post and answer as unavailable. */
  eveOrigin: () => string | undefined;
  /** eve as the deployment reaches it for the account an agent was started by; a test hands a fake, and the deployment composes eve's client under its own secret. */
  eveAs?: (starterUserId: string) => EveSessions;
}

/** What a read or a write of the chat may require. */
type ChatServices = DatabaseServices | HttpClient.HttpClient | GitHubApp | HostedEnvironment;

/** Who writes, where: the account, the workspace, and the account's own member of it. */
interface Writer {
  readonly userId: string;
  readonly organizationId: string;
  readonly self: ChatMemberRow;
}

/** The workspace a query names, refused where it names none or one that is no workspace's id. */
export const workspaceOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  named: string | undefined,
): Effect.fn.Return<string, HostedRefusal> {
  const workspace = readEither(workspaceIdSchema)(unparsedWire(named ?? ""));
  if (Result.isFailure(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return workspace.success;
});

/**
 * The account, refused as one in no workspace where it has not turned on
 * the Chat experiment, because Chat is off for it.
 */
export const chatAccount = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
): Effect.fn.Return<string, HostedRefusal, DatabaseServices> {
  if (!(yield* hostedStoreOrUnavailable(chatEnabledFor(userId)))) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  return userId;
});

/** The workspace's chat past the cursor as the account reads it, held open while nothing moved. */
export const readWorkspaceChat = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  query: { readonly workspaceId?: string; readonly after?: string },
): Effect.fn.Return<ChatAnswer, HostedRefusal, ChatServices> {
  const workspace = yield* workspaceOf(query.workspaceId);
  const after = readEither(seqCursorSchema)(unparsedWire(query.after ?? CHAT_CURSOR_START));
  if (Result.isFailure(after)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const reader = yield* chatAccount(userId);
  const page = yield* hostedStoreOrUnavailable(
    workspaceChatPast(reader, workspace, Number(after.success)),
  );
  if (Option.isNone(page)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return page.value;
});

/**
 * eve as the deployment acting for the account an agent was started by,
 * under the deployment's own secret, since a notice steers the agent's turn
 * as its starter whoever posted and the request carries only the poster's
 * bearer; unavailable where the deployment names no secret or no origin.
 */
const eveAsStarter = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: ChatSeams,
): Effect.fn.Return<
  (starterUserId: string) => EveSessions,
  HostedRefusal,
  HttpClient.HttpClient | HostedEnvironment
> {
  if (seams.eveAs !== undefined) return seams.eveAs;
  const secret = (yield* HostedEnvironment).cronSecret;
  const origin = seams.eveOrigin();
  if (secret === undefined || origin === undefined) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  const compose = yield* eveSessionsComposer;
  return (account) => compose({ origin, caller: { secret, account }, mount: EVE_MOUNT.CODER });
});

/** What a door needs to tell the members a person's message addresses. */
const tellingOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: ChatSeams,
  writer: Writer,
): Effect.fn.Return<ChatTelling, HostedRefusal, HttpClient.HttpClient | HostedEnvironment> {
  return {
    eveFor: yield* eveAsStarter(seams),
    writer: storeWriter({ tools: CODER_TOOL_SET }),
    userId: writer.userId,
    organizationId: writer.organizationId,
    doors: CHAT_DOORS,
  };
});

/** Where a person's post says it goes: a `to`, the channel shown, or the message it replies to, one at most. */
interface PostPlace {
  readonly to?: string;
  readonly channelId?: string;
  readonly replyTo?: number;
}

/** Where a person's post goes: the message it replies to, the channel the window shows by its id, which the store holds the person to, a channel by `#name`, a member's DM by the member's mention link, or `#general`. */
const placeOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Writer,
  post: PostPlace,
): Effect.fn.Return<ChatPost["to"], HostedRefusal, DatabaseServices> {
  const { userId, organizationId } = writer;
  const { to, channelId, replyTo } = post;
  if (replyTo !== undefined) return { replyTo };
  if (channelId !== undefined) return { channelId };
  const channel =
    to === undefined
      ? yield* hostedStoreOrUnavailable(ensureGeneral(userId, organizationId))
      : to.startsWith(CHAT_TARGET_SIGIL.CHANNEL)
        ? yield* hostedStoreOrUnavailable(channelNamed(userId, organizationId, to.slice(1)))
        : yield* dmWith(writer, to);
  if (Option.isNone(channel)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return { channelId: channel.value.id };
});

/** The person's DM with the member a mention link names, written whole or as its address; nothing where it names none, or the person. */
const dmWith = /* @__PURE__ */ Effect.fnUntraced(function* (writer: Writer, target: string) {
  const { userId, organizationId, self } = writer;
  const mention = chatTargetMember(target);
  if (mention === undefined) return Option.none();
  const other = yield* hostedStoreOrUnavailable(
    memberOfSubject(userId, organizationId, subjectOf(mention)),
  );
  if (Option.isNone(other) || other.value.id === self.id) return Option.none();
  return yield* hostedStoreOrUnavailable(
    findOrMakeDm(userId, organizationId, self.id, other.value.id),
  );
});

/** Whom a post's words name, read off its Markdown: the members its mention links write. */
function mentionsOf(blocks: readonly ChatBlock[]): ChatNamed {
  const words = blocks.flatMap((block) => (block.type === CHAT_BLOCK.MARKDOWN ? [block.text] : []));
  return namedIn(words.join("\n"));
}

/** One picture a person's post keeps: its bytes under the type they were sniffed to be, its id, and its file's name, which its block says. */
interface PostedPicture extends ChatImageWrite {
  readonly name: string;
}

/**
 * A post's files as the pictures it keeps, in order, each under an id of
 * the post's key and its place among them, so a post sent again keeps the
 * pictures it kept; nothing where one is not a PNG, a JPEG, or a WebP of
 * the type it was sent as, since a picture is served as what it is.
 */
function picturesOf(
  clientKey: string,
  files: readonly CodingAgentAttachment[],
): readonly PostedPicture[] | undefined {
  const pictures: PostedPicture[] = [];
  for (const [place, file] of files.entries()) {
    const bytes = Base64.decode(file.data);
    if (Result.isFailure(bytes)) return undefined;
    const contentType = sniffImageType(bytes.success);
    if (contentType === undefined || contentType !== file.mediaType) return undefined;
    // Note that a person's file has no path in a sandbox, so its place among the post's stands for one.
    const id = chatAttachmentId(clientKey, String(place));
    pictures.push({ id, contentType, bytes: bytes.success, name: file.name });
  }
  return pictures;
}

/** A person's post, told to the members it addresses: the message as the window reads it, and who it came to. */
const postAsPerson = /* @__PURE__ */ Effect.fnUntraced(function* (
  telling: Effect.Effect<ChatTelling, HostedRefusal, HttpClient.HttpClient | HostedEnvironment>,
  writer: Writer,
  post: PostPlace & {
    readonly text?: string;
    readonly blocks?: readonly ChatBlock[];
    readonly attachments?: readonly CodingAgentAttachment[];
    readonly clientKey: string;
  },
): Effect.fn.Return<ChatWriteAnswer, HostedRefusal, ChatServices> {
  const pictures = picturesOf(post.clientKey, post.attachments ?? []);
  if (pictures === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const words =
    post.blocks ??
    (post.text === undefined ? [] : [{ type: CHAT_BLOCK.MARKDOWN, text: post.text }]);
  const blocks: readonly ChatBlock[] = [
    ...words,
    ...pictures.map(({ id, name }) => ({ type: CHAT_BLOCK.IMAGE, attachmentId: id, alt: name })),
  ];
  const to = yield* placeOf(writer, post);
  const teller = yield* telling;
  const told = yield* postChat(
    teller,
    {
      authorMemberId: writer.self.id,
      to,
      blocks,
      ...mentionsOf(blocks),
      clientKey: post.clientKey,
    },
    pictures.map(({ id, contentType, bytes }) => ({ id, contentType, bytes })),
  );
  if (!told.repeated) {
    yield* recordServerEvent(SERVER_EVENT.CHAT_MESSAGE_SEND, teller.userId, {
      is_reply: post.replyTo !== undefined,
    });
  }
  return { posted: messageOnWire(told.message), receipt: told.receipt };
});

/**
 * A person's answer to an ask at the revision the window drew, taken as
 * `answerAsk` takes one, and its reply told to the ask's poster and the
 * thread's earlier repliers where the ask asked to hear back. An answer
 * the ask no longer takes, at a revision its poster moved past or on an
 * ask no longer open, is answered with the ask as it stands, not taken.
 */
const answerAsPerson = /* @__PURE__ */ Effect.fnUntraced(function* (
  telling: Effect.Effect<ChatTelling, HostedRefusal, HttpClient.HttpClient | HostedEnvironment>,
  writer: Writer,
  asked: {
    readonly answer: { readonly seq: number; readonly revision: number; readonly reply: ChatReply };
    readonly clientKey: string;
  },
): Effect.fn.Return<ChatWriteAnswer, HostedRefusal, ChatServices> {
  const { userId, organizationId, self } = writer;
  const { seq, revision, reply } = asked.answer;
  const message = yield* hostedStoreOrUnavailable(messageAt(userId, organizationId, self.id, seq));
  const ask = Option.flatMap(message, (row) => Option.fromNullishOr(row.ask));
  if (Option.isNone(message) || Option.isNone(ask)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  // Note that the answer is held to the ask only at the revision it names, because one drawn
  // from an earlier revision is not taken, and the revision moves on whenever what it asks does.
  const drawn = message.value.askRevision === revision;
  if (drawn && replyRefusal(ask.value.response, reply) !== undefined) {
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
  // The answer's reply is a member's message in the ask's thread; one sent again under its key is not new.
  if (taken && Option.isSome(posted) && message.value.answerKey !== asked.clientKey) {
    yield* recordServerEvent(SERVER_EVENT.CHAT_MESSAGE_SEND, userId, { is_reply: true });
  }
  if (taken && Option.isSome(posted) && ask.value.needsReply !== false) {
    yield* tellMessage(yield* telling, posted.value, []);
  }
  return { ask: messageOnWire(now), taken };
});

/** A person's own ask resolved with why; not found where the place holds no ask of theirs. */
const resolveAsPerson = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Writer,
  seq: number,
  reason: string,
): Effect.fn.Return<ChatWriteAnswer, HostedRefusal, DatabaseServices> {
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
  return { resolved: messageOnWire(resolved.value) };
});

/**
 * How far the person has read, moved on to the place given, never back: in
 * the channel named, or every channel where none is. Answers where the
 * cursor stands everywhere, and each channel's own cursor past it.
 */
const readToAsPerson = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Writer,
  seq: number,
  channelId: string | undefined,
): Effect.fn.Return<ChatWriteAnswer, HostedRefusal, DatabaseServices> {
  const { userId, organizationId, self } = writer;
  if (channelId === undefined) {
    const moved = yield* hostedStoreOrUnavailable(readAllTo(userId, organizationId, self.id, seq));
    if (Option.isNone(moved)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  } else {
    const read = yield* hostedStoreOrUnavailable(
      readTo(userId, organizationId, self.id, channelId, seq),
    );
    if (!read) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  const read = yield* hostedStoreOrUnavailable(readsOf(userId, organizationId, self.id));
  return read;
});

/**
 * A topic channel opened by a person under a name of their own, with what
 * it is for, or one already open under the name answered as it stands;
 * refused where the name is another channel's or the workspace keeps as
 * many topics as it may.
 */
const openAsPerson = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Writer,
  open: { readonly name: string; readonly purpose?: string },
): Effect.fn.Return<ChatWriteAnswer, HostedRefusal, DatabaseServices> {
  const { userId, organizationId, self } = writer;
  const opened = yield* hostedStoreOrUnavailable(
    openTopicChannel(userId, organizationId, open.name, self.id, open.purpose ?? null),
  );
  if (Result.isFailure(opened)) return yield* Effect.fail(HOSTED_OF_CHAT_REFUSAL[opened.failure]);
  return { channel: channelOnWire(opened.success) };
});

/** A topic channel renamed, its purpose said or cleared, or archived or brought back by a person, as the store takes the edit. */
const editAsPerson = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Writer,
  edit: {
    readonly channelId: string;
    readonly name?: string;
    readonly purpose?: string | null;
    readonly archived?: boolean;
  },
): Effect.fn.Return<ChatWriteAnswer, HostedRefusal, DatabaseServices> {
  const { userId, organizationId, self } = writer;
  const { channelId, ...change } = edit;
  const edited = yield* hostedStoreOrUnavailable(
    editTopicChannel(userId, organizationId, self.id, channelId, change),
  );
  if (Result.isFailure(edited)) return yield* Effect.fail(HOSTED_OF_CHAT_REFUSAL[edited.failure]);
  return { channel: channelOnWire(edited.success) };
});

/** One write to the workspace's chat as the account's own member of it: a post, an answer, a resolve, a read, or a topic channel opened or edited. */
export const writeWorkspaceChat = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: ChatSeams,
  userId: string,
  workspaceId: string,
  write: ChatWriteRequest,
): Effect.fn.Return<ChatWriteAnswer, HostedRefusal, ChatServices> {
  const organizationId = workspaceId;
  const writerId = yield* chatAccount(userId);
  const self = yield* hostedStoreOrUnavailable(
    ensureMember(writerId, organizationId, { kind: MEMBER_KIND.HUMAN, userId: writerId }),
  );
  if (Option.isNone(self)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const writer = { userId: writerId, organizationId, self: self.value };
  const telling = tellingOf(seams, writer);
  if ("readTo" in write) return yield* readToAsPerson(writer, write.readTo, write.channelId);
  if ("resolve" in write) {
    return yield* resolveAsPerson(writer, write.resolve.seq, write.resolve.reason);
  }
  if ("answer" in write) return yield* answerAsPerson(telling, writer, write);
  if ("open" in write) return yield* openAsPerson(writer, write.open);
  if ("edit" in write) return yield* editAsPerson(writer, write.edit);
  return yield* postAsPerson(telling, writer, write);
});

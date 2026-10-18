import type { DatabaseServices } from "@luke/database/core/query";
import { chatEnabledFor } from "@luke/database/models/account-store";
import {
  agentWorkspace,
  attachMessageImages,
  CHAT_REFUSAL,
  type ChatChannelRow,
  type ChatMemberRow,
  type ChatMemberSubject,
  type ChatMessageRow,
  type ChatPost,
  type ChatPosted,
  type ChatRefusal,
  type ChatStoreEffect,
  channelNamed,
  channelsOf,
  chatPast,
  ensureGeneral,
  ensureMember,
  ensureTaskChannel,
  findOrMakeDm,
  history,
  memberNamed,
  openAsksOf,
  openTopicChannel,
  peekUnread,
  postAsk,
  postMessage,
  readThrough,
  resolveAsk,
  roster,
  seqsOf,
  unreadFor,
} from "@luke/database/models/chat-store";
import { type CodingAgent, listCodingAgents } from "@luke/database/models/coding-agent-store";
import { readTask } from "@luke/database/models/task-store";
import {
  ASK_STATUS,
  CHANNEL_KIND,
  CHAT_BOUNDS,
  CHAT_TARGET_SIGIL,
  CHAT_TOOL,
  type ChannelKind,
  chatAskSchema,
  chatPostBlocksSchema,
  GENERAL_CHANNEL,
  MEMBER_KIND,
  type MemberKind,
  postChatAskInputSchema,
  postChatInputSchema,
  readChatInputSchema,
  resolveAskInputSchema,
} from "@luke/features/chat-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { SqlClient } from "effect/sql";
import { ACTION_RESULT_STATUS, EXCESS_KEYS, type UnparsedWireValue } from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { logStoreFailure, type StoreFailure } from "../../http/store-failure.js";
import {
  ASK_REFUSAL,
  type AskLine,
  askLineOf,
  askPostRefusal,
  type PostPictures,
  postMentions,
  postPictures,
} from "./chat-ask.js";
import { blockWords, type ChatReceipt, type ChatTelling, tellMessage } from "./chat-notify.js";
import type { InboxSandboxDoor } from "./inbox-image.js";

/**
 * chat.ts -- the chat tools of a coding agent and of its plan's Luke: post a message in the workspace's chat, and read it.
 *
 * A coding agent is a member of its plan's workspace's chat, `@agent-N`,
 * minted the first time it posts or reads (`chat-store.ts`), and talks
 * there with the other agents, the plan's Luke, and the people of the
 * workspace. The plan's Luke, `@luke`, runs the same tools as the agent of
 * this module's words, bound in the planner's own host
 * (`../brain-host/chat.ts`). A post goes to the agent's plan channel, or a
 * planless agent's to its workspace's general channel, unless it names a
 * channel by `#name`, which a name no channel holds opens as a topic
 * channel, a member's DM by `@handle`, or a message to answer in its
 * thread; it is told to the members it addresses through the one door a
 * person's post goes through too (`chat-notify.ts`), and the call answers
 * the receipt, so the agent knows who heard it now, who reads it next,
 * who has left, and which handles named no one. A read answers who is in
 * the chat, the channels the agent sees with what it has not read in each,
 * and then the messages: what it has not read, which the read marks read,
 * or a channel's, a thread's, or what came before a place, which marks
 * nothing. Every message is named by its place in the workspace's
 * sequence, which is what a reply and a read name it by. A post may carry
 * an ask under a key of the agent's (`chat-ask.ts`), which the agent
 * resolves by the key once it no longer needs it, and every read, ask, and
 * resolve answers the agent's asks as they stand. Each turn opens with
 * what the agent has not read, bounded, as the turn's own instruction,
 * which reads it: the message a notice steered into the turn is left out,
 * since the notice carries it. A post is the
 * service's words on the agent's behalf, so a turn posts at most
 * `MAX_POSTS_PER_TURN` times, counted in the session's own state as
 * `edit_plan` counts its notes (`plan-edit.ts`); a repeat of one call is
 * the one post it made. A worker gets none of these tools, because the
 * agent it works for is the member. Chat is an experiment: an agent whose
 * starter has not turned it on is offered none of these tools, and a call
 * that reaches the host anyway is refused (`host.ts`).
 */

/** The tools as the model is shown them (`coder/tools/`): each one's name, words, and input. */
export const CHAT_TOOLS = {
  POST: {
    name: CHAT_TOOL.POST,
    description:
      "Post a message in your workspace's chat, where the other coding agents, Luke, and the developer's team talk. " +
      `text is Markdown, at most ${CHAT_BOUNDS.MAX_TEXT_CHARS} characters. ` +
      "to is where it goes: #name for a channel, where a name no channel holds opens a topic channel under it, or @handle " +
      "for a direct message to one member; leave it out to post in your task's own channel, where its agents post by default. " +
      "replyTo is a message's number to answer it in its thread, in that message's channel, with no to. " +
      "A direct message, an @handle in the words, and a reply in a thread each tell the members they address, " +
      `at most ${CHAT_BOUNDS.MAX_STEERS_PER_POST}; a plain post tells nobody, and is read when they next read the chat. ` +
      "The call answers with the message's number, who was told now, who reads it when they next read, who has left, " +
      "and any @handle that named no member. Post what another agent or person must know or decide, never a running log " +
      `of your work: you may post at most ${CHAT_BOUNDS.MAX_POSTS_PER_TURN} times a turn. ` +
      "blocks go under the words: link blocks naming a page, such as the GitHub settings page a task is done on; code " +
      "blocks pointing at the exact lines a decision is about, where repo is your repository as owner/name, path is from " +
      `its root, startLine to endLine spans at most ${CHAT_BOUNDS.MAX_CODE_LINES} lines, and sha is the full 40-character ` +
      "commit you read them at, one already on GitHub; and image blocks showing a picture, such as a screenshot of a UI you " +
      "rendered, where path is the file in your sandbox, relative to the checkout or absolute, a PNG, JPEG, or WebP of at " +
      `most ${(CHAT_BOUNDS.MAX_IMAGE_BYTES / 1_000_000).toFixed(1)} MB, and alt says in a sentence what it shows. ` +
      "ask makes the message something you need answered; an ask needs a key, your own short lowercase slug for it, such as " +
      "branch-protection: posting under a key you used before updates that ask where it was first posted and opens it " +
      "again, so keep an ask current under its key and never ask it twice. ask.response is what you ask: choice (two to " +
      "six options, each a short label and an optional detail; name the label you recommend; multiple lets them pick " +
      "several), approval (a yes or no on one step you propose), text (an open answer in their words), task (something " +
      "only a person can do by hand, such as changing a GitHub setting or adding a secret: say exactly what to do), form " +
      "(one to eight typed fields, text, number, select with its options, or boolean, each named by its label and " +
      "required where it must be filled; never ask for a credential or a secret in a form, since the answer reaches your " +
      "transcript: that is a task done by hand), or none (something the room should know; it is acknowledged). " +
      "ask.title is a one-line heading where your words are not one. ask.needsReply is whether you need to hear the " +
      "answer; set it false for a task you only need done or an ask that asks nothing. Any member may answer, as a reply " +
      "in the ask's thread, which tells you; the call answers with your asks as they stand.",
    inputSchema: postChatAskInputSchema,
  },
  READ: {
    name: CHAT_TOOL.READ,
    description:
      "Read your workspace's chat: who is in it, the channels you see with how many messages you have not read in each, " +
      "then the messages. With nothing named, the messages are the ones you have not read, oldest first, and reading them " +
      "marks them read. channel (#name, or @handle for your direct messages with that member) reads its latest messages, " +
      "thread (a message's number) reads that message's whole thread, and before (a message's number) reads back from " +
      "there; these mark nothing read. Each message names its number, where it was said, who said it, and the thread it " +
      "replies in.",
    inputSchema: readChatInputSchema,
  },
  RESOLVE: {
    name: CHAT_TOOL.RESOLVE,
    description:
      "Resolve an ask of yours by its key, with why: you no longer need it, you found the answer yourself, or you " +
      "checked that the task is done. The call answers with your asks as they stand.",
    inputSchema: resolveAskInputSchema,
  },
} as const;

/** Why a call did nothing, in the words the model reads. */
export const CHAT_TOOL_REFUSAL = {
  UNREADABLE_POST:
    `Not posted: the post does not read. text is Markdown of at most ${CHAT_BOUNDS.MAX_TEXT_CHARS} characters; ` +
    "to is #name for a channel or @handle for a member, lowercase; replyTo is a message's number; blocks are link, code, " +
    "or image, a code block's sha the full 40-character lowercase commit, an image naming its path and alt; an ask " +
    "needs a key, a lowercase slug of letters, digits, dots, dashes, and underscores, and its response, one of choice, " +
    `approval, text, task, form, or none; a choice and a select field offer between two and ${CHAT_BOUNDS.MAX_OPTIONS} options.`,
  UNREADABLE_RESOLVE: "Not resolved: name the ask's key and why you resolve it.",
  UNREADABLE_READ:
    "Not read: channel is #name or @handle, lowercase, and thread and before are messages' numbers.",
  REPLY_AND_TO:
    "Not posted: a reply goes in the thread of the message it answers, in that message's channel; name replyTo or to, not both.",
  TOO_MANY_POSTS: `Not posted: you have posted ${CHAT_BOUNDS.MAX_POSTS_PER_TURN} times this turn already. Say the rest in one message next turn.`,
  NO_MEMBER:
    "Not done: no member of the chat answers to that handle. read_chat lists every member.",
  TO_SELF: "Not posted: that handle is your own.",
  NO_CHANNEL: "Not read: you see no channel under that name. read_chat lists the channels you see.",
  NO_MESSAGE:
    "Not posted: replyTo names no message you can see, or one in a channel you cannot post in.",
  NAME_TAKEN:
    "Not posted: that name is held by a channel you cannot open as a topic. Pick another name.",
  TOO_MANY_TOPICS: `Not posted: the workspace keeps ${CHAT_BOUNDS.MAX_TOPIC_CHANNELS} topic channels open already. Post in an open channel instead.`,
  CHANNEL_ARCHIVED: "Not posted: that channel is archived and takes no post.",
  LEFT: "Not posted: you have left the chat, as an archived agent does.",
  NO_AGENT: "Not done: this conversation is no coding agent's, or its task is no longer reachable.",
  UNAVAILABLE: "Not done: the service could not reach the chat.",
  OFF: "Not done: Chat is not turned on for the account that started you.",
} as const;

/** A member as a read lists it: its handle, its kind, and whether it has left. */
type MemberLine = {
  readonly handle: string;
  readonly kind: MemberKind;
  readonly left?: true;
};

/** A channel as a read lists it: how a post names it, its kind, and what the reader has not read in it. */
type ChannelLine = {
  readonly name: string;
  readonly kind: ChannelKind;
  readonly unread: number;
};

/** A message as the agent reads it: its place, where it was said, who said it, the thread it replies in by its root's place, and its words. */
export type MessageLine = {
  readonly seq: number;
  readonly in: string;
  readonly from: string;
  readonly thread?: number;
  readonly text: string;
};

/**
 * What a post answers: its place, where it was said or the root of the
 * thread it replies in, and the receipt, every member named by its
 * `@handle`; `untold` where the post stands but telling the members it
 * addresses failed, who read it when they next read; and the agent's asks
 * where it asked.
 */
type PostedLine = ChatReceipt & {
  readonly seq: number;
  readonly in?: string;
  readonly thread?: number;
  readonly untold?: true;
  readonly asks?: readonly AskLine[];
};

/** What a call answers, as the model reads it: the post's receipt, the chat as read, or why the call did nothing. */
export type ChatToolResult =
  | ({ readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED } & PostedLine)
  | {
      readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED;
      readonly you: string;
      readonly members: readonly MemberLine[];
      readonly channels: readonly ChannelLine[];
      readonly messages: readonly MessageLine[];
      readonly more?: true;
      readonly asks: readonly AskLine[];
    }
  | { readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED; readonly asks: readonly AskLine[] }
  | { readonly status: typeof ACTION_RESULT_STATUS.REJECTED; readonly reason: string };

/** Who a call speaks as: a coding agent, or the plan's Luke. */
type ChatSelf = Exclude<ChatMemberSubject, { readonly kind: typeof MEMBER_KIND.HUMAN }>;

/** The agent a read is made for: the account whose standing reaches the chat, the plan the agent is on, none for a planless agent, and the member it speaks as. */
export interface ChatReader {
  readonly userId: string;
  readonly planId: string | null;
  readonly self: ChatSelf;
}

/** The agent a post is made for: its repository as `owner/name`, which its code blocks must name, nothing where it has none, and how its posts are told. */
export interface ChatAgent extends ChatReader {
  readonly repository: string | null;
  readonly telling: Omit<ChatTelling, "userId" | "organizationId">;
}

/** Where the agent sits in the chat: its workspace, its plan's channel, and its own member. */
interface ChatSeat {
  readonly organizationId: string;
  readonly home: ChatChannelRow;
  readonly self: ChatMemberRow;
}

/** Where a post goes, as the store takes it, and how the answer names it. */
interface PostPlace {
  readonly to: ChatPost["to"];
  readonly named: { readonly in: string } | { readonly thread: number };
}

/** What the store's refusal of a topic channel reads as to the model. */
const TOPIC_REFUSAL = {
  [CHAT_REFUSAL.NOT_FOUND]: CHAT_TOOL_REFUSAL.NO_AGENT,
  [CHAT_REFUSAL.NAME_TAKEN]: CHAT_TOOL_REFUSAL.NAME_TAKEN,
  [CHAT_REFUSAL.TOO_MANY_TOPICS]: CHAT_TOOL_REFUSAL.TOO_MANY_TOPICS,
  [CHAT_REFUSAL.AUTHOR_LEFT]: CHAT_TOOL_REFUSAL.LEFT,
  [CHAT_REFUSAL.CHANNEL_ARCHIVED]: CHAT_TOOL_REFUSAL.CHANNEL_ARCHIVED,
  [CHAT_REFUSAL.KEY_TAKEN]: CHAT_TOOL_REFUSAL.UNAVAILABLE,
  [CHAT_REFUSAL.ASK_ELSEWHERE]: CHAT_TOOL_REFUSAL.UNAVAILABLE,
} as const satisfies Record<ChatRefusal, string>;

/** What the store's refusal of a post reads as to the model. Note that a key another message holds is never the agent's to mend, since the key is its call's own id. */
const POST_REFUSAL = {
  [CHAT_REFUSAL.NOT_FOUND]: CHAT_TOOL_REFUSAL.NO_MESSAGE,
  [CHAT_REFUSAL.NAME_TAKEN]: CHAT_TOOL_REFUSAL.NAME_TAKEN,
  [CHAT_REFUSAL.TOO_MANY_TOPICS]: CHAT_TOOL_REFUSAL.TOO_MANY_TOPICS,
  [CHAT_REFUSAL.AUTHOR_LEFT]: CHAT_TOOL_REFUSAL.LEFT,
  [CHAT_REFUSAL.CHANNEL_ARCHIVED]: CHAT_TOOL_REFUSAL.CHANNEL_ARCHIVED,
  [CHAT_REFUSAL.KEY_TAKEN]: CHAT_TOOL_REFUSAL.UNAVAILABLE,
  [CHAT_REFUSAL.ASK_ELSEWHERE]: ASK_REFUSAL.ELSEWHERE,
} as const satisfies Record<ChatRefusal, string>;

/** The most settled asks a call answers beside the open ones: the latest, enough to see what came of what the agent asked last. */
const SETTLED_ASKS_SHOWN = 5;

/** The most messages a turn's digest carries; the rest wait for a read. */
const DIGEST_MESSAGES = 20;

/** The most characters of one message a turn's digest carries; a longer one is read whole by its channel or thread. */
const DIGEST_MESSAGE_CHARS = 600;

/** The line a turn's digest opens with. */
export const CHAT_DIGEST_HEADING = "[chat since you last read]";

/** A receipt that told no one, as a post whose telling failed answers. */
const NO_RECEIPT: ChatReceipt = { told: [], held: [], left: [], unresolved: [] };

const readPost = readEither(postChatAskInputSchema, { excess: EXCESS_KEYS.DROP });

/** What a post names of where it goes, read apart so one naming both a reply and a target is refused in words the model can mend by. */
const readPlaces = readEither(
  Schema.Struct({
    to: Schema.optionalKey(Schema.Unknown),
    replyTo: Schema.optionalKey(Schema.Unknown),
  }),
  { excess: EXCESS_KEYS.DROP },
);

/** Whether a post names both a reply and a target, which the input's schema refuses without saying why. */
function replyAndTarget(input: UnparsedWireValue): boolean {
  const read = readPlaces(input);
  return (
    Result.isSuccess(read) && read.success.to !== undefined && read.success.replyTo !== undefined
  );
}

/**
 * A post with an ask as it reads without its key: every field of the post
 * held to its own shape, the ask whole among them, and no key, so only a
 * post the key alone would mend reads.
 */
const readAskWithoutKey = readEither(
  Schema.Struct({
    ...postChatInputSchema.fields,
    ask: chatAskSchema,
    blocks: Schema.optionalKey(chatPostBlocksSchema),
  }),
  { excess: EXCESS_KEYS.DROP },
);

/**
 * Whether a post fails for want of its ask's key alone, which the input's
 * JSON Schema cannot say it refuses; a post whose ask or other fields do not
 * read is refused as unreadable, since a key would not mend it.
 */
function askWithoutKey(input: UnparsedWireValue): boolean {
  return Result.isSuccess(readAskWithoutKey(input));
}

/** Why a post that does not read was refused: naming both a reply and a target, an ask with no key, or otherwise not the post's shape. */
function unreadPostRefusal(input: UnparsedWireValue): string {
  if (replyAndTarget(input)) return CHAT_TOOL_REFUSAL.REPLY_AND_TO;
  if (askWithoutKey(input)) return ASK_REFUSAL.NEEDS_KEY;
  return CHAT_TOOL_REFUSAL.UNREADABLE_POST;
}
const readRead = readEither(readChatInputSchema, { excess: EXCESS_KEYS.DROP });
const readResolve = readEither(resolveAskInputSchema, { excess: EXCESS_KEYS.DROP });

export function chatRejected(reason: string): ChatToolResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** The effect run in one transaction on the ambient client, a statement of its own a savepoint inside it. */
function inTransaction<A, E, R>(
  body: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | StoreFailure, R | DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(body));
}

/** A handle as a post or a read names a member. */
function atHandle(handle: string): string {
  return `${CHAT_TARGET_SIGIL.MEMBER}${handle}`;
}

/**
 * Where the agent posts unless it names a place: its plan's channel, made
 * where none stands yet, which names the workspace; or for a planless
 * agent the general channel of the workspace its row names.
 */
function homeOf(agent: ChatReader): ChatStoreEffect<Option.Option<ChatChannelRow>> {
  return Effect.gen(function* () {
    if (agent.planId !== null) return yield* ensureTaskChannel(agent.userId, agent.planId);
    // Only a coding agent is planless; a plan's Luke always stands on its plan.
    if (agent.self.kind !== MEMBER_KIND.AGENT) return Option.none();
    const workspace = yield* agentWorkspace(agent.userId, agent.self.agentId);
    if (Option.isNone(workspace)) return Option.none();
    return yield* ensureGeneral(agent.userId, workspace.value);
  });
}

/**
 * The agent's seat: where it posts by default (`homeOf`), its workspace,
 * and its member. Note that every agent on its plan not yet a member, whose
 * starter turned Chat on, is minted first, in the order they were started, because an agent that has
 * never posted or read must still answer to its handle when another on its
 * plan writes to it.
 */
function seatOf(
  agent: ChatReader,
): Effect.Effect<Option.Option<ChatSeat>, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const { userId, planId: taskId } = agent;
    const home = yield* homeOf(agent);
    if (Option.isNone(home)) return Option.none();
    const { organizationId } = home.value;
    const members = new Set((yield* roster(userId, organizationId)).map((row) => row.agentId));
    const onTask = taskId === null ? [] : yield* listCodingAgents(userId, taskId);
    // An agent whose starter has not turned Chat on is seated only once that starter does.
    const unminted = yield* Effect.filter(
      onTask.filter((each) => !members.has(each.id)),
      (each) => chatEnabledFor(each.userId),
    );
    yield* Effect.forEach(unminted, (each) =>
      ensureMember(userId, organizationId, { kind: MEMBER_KIND.AGENT, agentId: each.id }),
    );
    const self = yield* ensureMember(userId, organizationId, agent.self);
    return Option.map(self, (member) => ({ organizationId, home: home.value, self: member }));
  });
}

/** How a post names a channel: `#name`, or for a DM the other member's `@handle`. */
function channelName(
  channel: ChatChannelRow,
  self: ChatMemberRow,
  members: ReadonlyMap<string, ChatMemberRow>,
): string {
  if (channel.kind !== CHANNEL_KIND.DM) return `${CHAT_TARGET_SIGIL.CHANNEL}${channel.name ?? ""}`;
  const other = channel.dmAMemberId === self.id ? channel.dmBMemberId : channel.dmAMemberId;
  return atHandle(members.get(other ?? "")?.handle ?? "");
}

/** The order a read lists channels in by kind, after the agent's own plan channel: the general one, other plans', topics, then DMs. */
const CHANNEL_ORDER = {
  [CHANNEL_KIND.GENERAL]: 0,
  [CHANNEL_KIND.PLAN]: 1,
  [CHANNEL_KIND.TOPIC]: 2,
  [CHANNEL_KIND.DM]: 3,
} as const satisfies Record<ChannelKind, number>;

/** Whether the agent sees the channel in its list: any open channel but a DM, and a DM it is one of. */
function seenBy(channel: ChatChannelRow, self: ChatMemberRow): boolean {
  if (channel.archivedAt !== null) return false;
  if (channel.kind !== CHANNEL_KIND.DM) return true;
  return channel.dmAMemberId === self.id || channel.dmBMemberId === self.id;
}

/**
 * The channel a `#name` names for a post: the general channel, made where
 * it is not yet, one standing under the name, or a topic channel opened
 * under it; refused where the name is held by one that takes no post.
 */
function channelForPost(
  agent: ChatReader,
  seat: ChatSeat,
  name: string,
): ChatStoreEffect<Result.Result<ChatChannelRow, string>> {
  return Effect.gen(function* () {
    const { userId } = agent;
    const standing =
      name === GENERAL_CHANNEL
        ? yield* ensureGeneral(userId, seat.organizationId)
        : yield* channelNamed(userId, seat.organizationId, name);
    if (Option.isSome(standing)) {
      return standing.value.archivedAt === null
        ? Result.succeed(standing.value)
        : Result.fail(CHAT_TOOL_REFUSAL.CHANNEL_ARCHIVED);
    }
    const opened = yield* openTopicChannel(userId, seat.organizationId, name, seat.self.id);
    return Result.mapError(opened, (refusal) => TOPIC_REFUSAL[refusal]);
  });
}

/** The DM between the agent and the member a handle names, made where it is not yet; refused where no member answers to it or it is the agent's own. */
function dmWith(
  agent: ChatReader,
  seat: ChatSeat,
  handle: string,
): ChatStoreEffect<Result.Result<ChatChannelRow, string>> {
  return Effect.gen(function* () {
    const { userId } = agent;
    const named = yield* memberNamed(
      userId,
      seat.organizationId,
      handle,
      agent.planId ?? undefined,
    );
    if (Option.isNone(named)) return Result.fail(CHAT_TOOL_REFUSAL.NO_MEMBER);
    if (named.value.id === seat.self.id) return Result.fail(CHAT_TOOL_REFUSAL.TO_SELF);
    const dm = yield* findOrMakeDm(userId, seat.organizationId, seat.self.id, named.value.id);
    return Option.match(dm, {
      onNone: () => Result.fail(CHAT_TOOL_REFUSAL.NO_MEMBER),
      onSome: (channel) => Result.succeed(channel),
    });
  });
}

/** Where a post goes: the thread of the message it replies to, the channel or DM its `to` names, or the agent's plan channel. */
function placeOf(
  agent: ChatReader,
  seat: ChatSeat,
  post: typeof postChatAskInputSchema.Type,
): ChatStoreEffect<Result.Result<PostPlace, string>> {
  if (post.replyTo !== undefined) {
    return Effect.succeed(
      Result.succeed({ to: { replyTo: post.replyTo }, named: { thread: post.replyTo } }),
    );
  }
  const to = post.to;
  if (to === undefined) {
    const name = `${CHAT_TARGET_SIGIL.CHANNEL}${seat.home.name ?? ""}`;
    return Effect.succeed(Result.succeed({ to: { channelId: seat.home.id }, named: { in: name } }));
  }
  const name = to.slice(1);
  const channel = to.startsWith(CHAT_TARGET_SIGIL.CHANNEL)
    ? channelForPost(agent, seat, name)
    : dmWith(agent, seat, name);
  return Effect.map(channel, (found) =>
    Result.map(found, (row) => ({ to: { channelId: row.id }, named: { in: to } })),
  );
}

/**
 * The post written as the agent at its place, an ask under its key or a
 * message, and its pictures kept once it stands. Note that an ask posted
 * again keeps exactly the pictures it now names, none among them, so one it
 * dropped is dropped from the store; a repeat of one call, which writes
 * nothing, keeps them again only where it names some.
 */
function writePost(
  agent: ChatReader,
  seat: ChatSeat,
  post: typeof postChatAskInputSchema.Type,
  written: {
    readonly to: ChatPost["to"];
    readonly clientKey: string;
    readonly pictures: PostPictures;
  },
): ChatStoreEffect<Result.Result<ChatPosted, ChatRefusal>> {
  return Effect.gen(function* () {
    const { userId } = agent;
    const message = {
      authorMemberId: seat.self.id,
      to: written.to,
      blocks: written.pictures.blocks,
      mentions: postMentions(post),
      clientKey: written.clientKey,
    };
    const asked =
      post.ask === undefined || post.key === undefined
        ? undefined
        : yield* postAsk(userId, seat.organizationId, { ...message, key: post.key, ask: post.ask });
    const posted = asked ?? (yield* postMessage(userId, seat.organizationId, message));
    const { images } = written.pictures;
    if (Result.isFailure(posted)) return posted;
    const revised =
      asked !== undefined &&
      Result.isSuccess(asked) &&
      !asked.success.created &&
      !asked.success.repeated;
    if (images.length === 0 && !revised) return posted;
    const { id } = posted.success.message;
    yield* attachMessageImages(userId, seat.organizationId, seat.self.id, id, images);
    return posted;
  });
}

/**
 * What a post the store took answers: its place, where it was said or the
 * root of the thread it replies in, and the receipt of telling the members
 * it addresses. A post repeated under its key is told again, which the
 * notice's key and the one outstanding notice keep from telling anyone
 * twice, so a repeat finishes a telling the first call never made. Note
 * that a post whose telling failed is answered as posted and untold,
 * because it stands in the chat and a second post would say it twice.
 */
function postedLine(
  agent: ChatAgent,
  seat: ChatSeat,
  posted: ChatPosted,
  named: PostPlace["named"],
): Effect.Effect<PostedLine, StoreFailure, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  return Effect.gen(function* () {
    const { message, unresolved } = posted;
    const telling = { ...agent.telling, userId: agent.userId, organizationId: seat.organizationId };
    const told = yield* Effect.result(tellMessage(telling, message, unresolved));
    const receipt = Result.getOrElse(told, () => NO_RECEIPT);
    const parent = message.parentId === null ? [] : [message.parentId];
    // A root that could not be read is logged and named by nothing, since the post stands either way.
    const roots = yield* seqsOf(agent.userId, seat.organizationId, parent).pipe(
      Effect.tapError(logStoreFailure),
      Effect.orElseSucceed((): ReadonlyMap<string, number> => new Map()),
    );
    const thread = parent.flatMap((id) => Option.toArray(Option.fromNullishOr(roots.get(id))));
    return {
      seq: message.seq,
      // A reply whose root could not be read names no thread, since the place it was asked for may be a reply's.
      ...(thread[0] !== undefined ? { thread: thread[0] } : message.parentId === null ? named : {}),
      told: receipt.told.map(atHandle),
      held: receipt.held.map(atHandle),
      left: receipt.left.map(atHandle),
      unresolved: receipt.unresolved.map(atHandle),
      ...(Result.isFailure(told) ? { untold: true as const } : undefined),
    };
  });
}

/**
 * Whether the agent is away from the chat: archived itself, or on a task
 * that is archived or that its starter no longer reaches. A post from one
 * is refused, since it speaks for work no one is doing; its member is not
 * stamped as having left, because an archive can be undone. Note that an
 * agent gone for good never posts here: deleting its task deletes it, and
 * a session eve retired is refused before its tools run, while telling one
 * stamps it (`chat-notify.ts`).
 */
export function agentAway(
  userId: string,
  agent: Pick<CodingAgent, "archivedAt" | "taskId">,
): Effect.Effect<boolean, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    if (agent.archivedAt !== null) return true;
    if (agent.taskId === null) return false;
    const task = yield* readTask(userId, agent.taskId);
    return Option.match(task, {
      onNone: () => true,
      onSome: (held) => held.task.archivedAt !== undefined,
    });
  });
}

/**
 * Runs one post: its shape held to what a message carries, its place
 * found, its pictures read from the sandbox, the message or the ask
 * written as the agent and told to the members it addresses, and the
 * receipt answered, with the agent's asks where it asked, or why not. A
 * turn that has posted its bound already posts nothing; the call's own id
 * is the post's key, so a call replayed answers the message it made and
 * tells no one again.
 */
export function postAsAgent(
  agent: ChatAgent,
  input: UnparsedWireValue,
  call: {
    readonly clientKey: string;
    readonly postsInTurn: number;
    readonly sandbox: InboxSandboxDoor;
  },
): Effect.Effect<ChatToolResult, never, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  if (call.postsInTurn >= CHAT_BOUNDS.MAX_POSTS_PER_TURN) {
    return Effect.succeed(chatRejected(CHAT_TOOL_REFUSAL.TOO_MANY_POSTS));
  }
  const read = readPost(input);
  if (Result.isFailure(read)) {
    return Effect.succeed(chatRejected(unreadPostRefusal(input)));
  }
  const post = read.success;
  const refused = askPostRefusal(post, agent.repository);
  if (refused !== undefined) return Effect.succeed(chatRejected(refused));
  return Effect.gen(function* () {
    const seat = yield* seatOf(agent);
    if (Option.isNone(seat)) return chatRejected(CHAT_TOOL_REFUSAL.NO_AGENT);
    const place = yield* placeOf(agent, seat.value, post);
    if (Result.isFailure(place)) return chatRejected(place.failure);
    const pictures = yield* postPictures(post, call.clientKey, call.sandbox);
    if (Result.isFailure(pictures)) return chatRejected(pictures.failure);
    const posted = yield* writePost(agent, seat.value, post, {
      to: place.success.to,
      clientKey: call.clientKey,
      pictures: pictures.success,
    });
    if (Result.isFailure(posted)) return chatRejected(POST_REFUSAL[posted.failure]);
    const line = yield* postedLine(agent, seat.value, posted.success, place.success.named);
    const asks = post.ask === undefined ? undefined : yield* asksOf(agent, seat.value);
    return {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      ...line,
      ...(asks === undefined ? undefined : { asks }),
    } satisfies ChatToolResult;
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(chatRejected(CHAT_TOOL_REFUSAL.UNAVAILABLE))),
  );
}

/** Runs one resolve: the agent's ask under the key resolved with why, and its asks answered as they stand, or why not. */
export function resolveAsAgent(
  agent: ChatReader,
  input: UnparsedWireValue,
): Effect.Effect<ChatToolResult, never, DatabaseServices> {
  const read = readResolve(input);
  if (Result.isFailure(read)) {
    return Effect.succeed(chatRejected(CHAT_TOOL_REFUSAL.UNREADABLE_RESOLVE));
  }
  const { key, reason } = read.success;
  return Effect.gen(function* () {
    const seat = yield* seatOf(agent);
    if (Option.isNone(seat)) return chatRejected(CHAT_TOOL_REFUSAL.NO_AGENT);
    const { organizationId, self } = seat.value;
    const resolved = yield* resolveAsk(agent.userId, organizationId, self.id, key, reason);
    if (Option.isNone(resolved)) return chatRejected(ASK_REFUSAL.NO_ASK);
    const asks = yield* asksOf(agent, seat.value);
    return { status: ACTION_RESULT_STATUS.ACCEPTED, asks } satisfies ChatToolResult;
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(chatRejected(CHAT_TOOL_REFUSAL.UNAVAILABLE))),
  );
}

/** How a post names each channel, by the channel's id. */
function channelNames(
  channels: readonly ChatChannelRow[],
  self: ChatMemberRow,
  members: ReadonlyMap<string, ChatMemberRow>,
): ReadonlyMap<string, string> {
  return new Map(channels.map((channel) => [channel.id, channelName(channel, self, members)]));
}

/** The agent's asks as it reads them, named where each was asked and who answered it. */
function askLines(
  rows: readonly ChatMessageRow[],
  names: ReadonlyMap<string, string>,
  members: ReadonlyMap<string, ChatMemberRow>,
): readonly AskLine[] {
  const handleOf = (memberId: string) => atHandle(members.get(memberId)?.handle ?? "");
  return rows.flatMap((row) => askLineOf(row, names.get(row.channelId) ?? "", handleOf) ?? []);
}

/** The asks of the agent's member, every open one, then the latest settled, as `askLines` reads them. */
function asksOf(agent: ChatReader, seat: ChatSeat): ChatStoreEffect<readonly AskLine[]> {
  return Effect.gen(function* () {
    const { userId } = agent;
    const { organizationId, self } = seat;
    const scope = { authorMemberId: self.id };
    const rows = yield* openAsksOf(userId, organizationId, scope, SETTLED_ASKS_SHOWN);
    const members = new Map((yield* roster(userId, organizationId)).map((row) => [row.id, row]));
    const names = channelNames(yield* channelsOf(userId, organizationId), self, members);
    return askLines(rows, names, members);
  });
}

/** The channel a read's `channel` names among the ones the agent sees: by `#name`, or the DM with the member an `@handle` names. */
function channelForRead(
  target: string,
  seen: readonly ChatChannelRow[],
  self: ChatMemberRow,
  members: ReadonlyMap<string, ChatMemberRow>,
): ChatChannelRow | undefined {
  return seen.find((channel) => channelName(channel, self, members) === target);
}

/** The channels as a read lists them: the agent's plan channel first, then by kind as `CHANNEL_ORDER` has it, and by name within a kind. */
function listed(
  seen: readonly ChatChannelRow[],
  home: ChatChannelRow,
  names: ReadonlyMap<string, string>,
): readonly ChatChannelRow[] {
  const rank = (channel: ChatChannelRow) =>
    channel.id === home.id ? -1 : CHANNEL_ORDER[channel.kind];
  return seen.toSorted(
    (a, b) => rank(a) - rank(b) || (names.get(a.id) ?? "").localeCompare(names.get(b.id) ?? ""),
  );
}

/** The messages a read answers: what the agent has not read, which moves its cursor, or the history its input names, which moves nothing. */
function messagesOf(
  agent: ChatReader,
  seat: ChatSeat,
  query: typeof readChatInputSchema.Type,
  channelId: string | undefined,
): ChatStoreEffect<{ readonly messages: readonly ChatMessageRow[]; readonly more: boolean }> {
  const { userId } = agent;
  const unread =
    query.channel === undefined && query.thread === undefined && query.before === undefined;
  if (unread) {
    return Effect.map(unreadFor(userId, seat.organizationId, seat.self.id), (read) =>
      Option.getOrElse(read, () => ({ messages: [], more: false })),
    );
  }
  return Effect.map(
    history(userId, seat.organizationId, seat.self.id, {
      channelId,
      thread: query.thread,
      before: query.before,
    }),
    (read) => ({ messages: Option.getOrElse(read, () => []), more: false }),
  );
}

/** What a read names messages by: each channel's name, each member, and each thread root's place, by id. */
interface ReadNames {
  readonly names: ReadonlyMap<string, string>;
  readonly members: ReadonlyMap<string, ChatMemberRow>;
  readonly roots: ReadonlyMap<string, number>;
}

/** A message as the agent reads it: its words, every block read as words, where it was said, and by whom. */
function lineOf(message: ChatMessageRow, named: ReadNames): MessageLine {
  const thread = message.parentId === null ? undefined : named.roots.get(message.parentId);
  return {
    seq: message.seq,
    in: named.names.get(message.channelId) ?? "",
    from: atHandle(named.members.get(message.authorMemberId)?.handle ?? ""),
    ...(thread === undefined ? undefined : { thread }),
    text: message.blocks
      .map(blockWords)
      .filter((part) => part !== "")
      .join("\n\n"),
  };
}

/** How many of the messages past the reader's cursor others wrote in each channel, by the channel's id. */
function unreadByChannel(
  past: readonly ChatMessageRow[],
  self: ChatMemberRow,
): ReadonlyMap<string, number> {
  const unread = new Map<string, number>();
  for (const message of past) {
    if (message.authorMemberId === self.id) continue;
    unread.set(message.channelId, (unread.get(message.channelId) ?? 0) + 1);
  }
  return unread;
}

/**
 * Runs one read: the messages first, since reading what is unread moves
 * the cursor the counts are read past, then the roster, the channels the
 * agent sees with what it has not read in each, the messages as lines, and
 * the agent's asks. The read is one transaction, so a read that fails
 * moves no cursor and the agent reads the same messages again. The counts
 * are read from one page past the cursor, so a backlog past it counts as
 * the page does.
 */
export function readAsAgent(
  agent: ChatReader,
  input: UnparsedWireValue,
): Effect.Effect<ChatToolResult, never, DatabaseServices> {
  const read = readRead(input);
  if (Result.isFailure(read))
    return Effect.succeed(chatRejected(CHAT_TOOL_REFUSAL.UNREADABLE_READ));
  const query = read.success;
  return inTransaction(
    Effect.gen(function* () {
      const { userId } = agent;
      const found = yield* seatOf(agent);
      if (Option.isNone(found)) return chatRejected(CHAT_TOOL_REFUSAL.NO_AGENT);
      const seat = found.value;
      const before = new Map(
        (yield* roster(userId, seat.organizationId)).map((row) => [row.id, row]),
      );
      const channels = yield* channelsOf(userId, seat.organizationId);
      const seen = channels.filter((channel) => seenBy(channel, seat.self));
      const named =
        query.channel === undefined
          ? undefined
          : channelForRead(query.channel, seen, seat.self, before);
      if (query.channel !== undefined && named === undefined) {
        return chatRejected(CHAT_TOOL_REFUSAL.NO_CHANNEL);
      }
      const { messages, more } = yield* messagesOf(agent, seat, query, named?.id);
      const members = yield* roster(userId, seat.organizationId);
      const byId = new Map(members.map((row) => [row.id, row]));
      const self = byId.get(seat.self.id) ?? seat.self;
      const past = yield* chatPast(userId, seat.organizationId, self.id, self.readSeq);
      const unread = unreadByChannel(
        Option.match(past, { onNone: () => [], onSome: (page) => page.messages }),
        self,
      );
      const roots = yield* seqsOf(
        userId,
        seat.organizationId,
        messages.flatMap((message) => (message.parentId === null ? [] : [message.parentId])),
      );
      const names = channelNames(channels, self, byId);
      const asks = yield* openAsksOf(
        userId,
        seat.organizationId,
        { authorMemberId: self.id },
        SETTLED_ASKS_SHOWN,
      );
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        you: atHandle(self.handle),
        members: members.map((row) => ({
          handle: atHandle(row.handle),
          kind: row.kind,
          ...(row.leftAt === null ? undefined : { left: true as const }),
        })),
        channels: listed(seen, seat.home, names).map((channel) => ({
          name: names.get(channel.id) ?? "",
          kind: channel.kind,
          unread: unread.get(channel.id) ?? 0,
        })),
        messages: messages.map((message) => lineOf(message, { names, members: byId, roots })),
        ...(more ? { more: true as const } : undefined),
        asks: askLines(asks, names, byId),
      } satisfies ChatToolResult;
    }),
  ).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(chatRejected(CHAT_TOOL_REFUSAL.UNAVAILABLE))),
  );
}

/**
 * What the agent has not read, as lines, marking nothing: at most the
 * bound, oldest change first, whether more wait past them, and the place
 * `readThroughAsAgent` moves its cursor to once they are taken in. What a
 * turn opens with, where its tools would read the same; nothing where the
 * agent has no seat.
 */
export function peekAsAgent(
  agent: ChatReader,
  limit: number,
): ChatStoreEffect<
  Option.Option<{
    readonly messages: readonly MessageLine[];
    readonly more: boolean;
    readonly through: number;
  }>
> {
  return Effect.gen(function* () {
    const { userId } = agent;
    const found = yield* seatOf(agent);
    if (Option.isNone(found)) return Option.none();
    const { organizationId, self } = found.value;
    const unread = yield* peekUnread(userId, organizationId, self.id, limit);
    if (Option.isNone(unread)) return Option.none();
    const { messages, more, through } = unread.value;
    const members = new Map((yield* roster(userId, organizationId)).map((row) => [row.id, row]));
    const names = channelNames(yield* channelsOf(userId, organizationId), self, members);
    const roots = yield* seqsOf(
      userId,
      organizationId,
      messages.flatMap((message) => (message.parentId === null ? [] : [message.parentId])),
    );
    const named = { names, members, roots };
    const lines = messages.map((message) => lineOf(message, named));
    return Option.some({ messages: lines, more, through });
  });
}

/** Marks what the agent has not read as read through the place a peek named, never back; nothing where the agent has no seat. */
export function readThroughAsAgent(agent: ChatReader, through: number): ChatStoreEffect<void> {
  return Effect.gen(function* () {
    const found = yield* seatOf(agent);
    if (Option.isNone(found)) return;
    const { organizationId, self } = found.value;
    yield* readThrough(agent.userId, organizationId, self.id, through);
  });
}

/** One message as a turn's digest carries it: its place, who said it where, the thread it replies in, what it asks, and its words, bounded. */
function digestLine(message: ChatMessageRow, line: MessageLine): string {
  const thread = line.thread === undefined ? "" : ` (thread m ${line.thread})`;
  const asks =
    message.ask === null || message.askStatus !== ASK_STATUS.OPEN
      ? ""
      : ` asks (${message.ask.response.type})`;
  // A message cut short says how to read it whole, since the digest marks it read: its thread, of which it is the root or a reply.
  const words =
    line.text.length > DIGEST_MESSAGE_CHARS
      ? `${line.text.slice(0, DIGEST_MESSAGE_CHARS)}… (${CHAT_TOOLS.READ.name}({ thread: ${line.thread ?? line.seq} }) reads the rest)`
      : line.text;
  return `m ${line.seq} · ${line.from} in ${line.in}${thread}${asks}: ${words}`;
}

/**
 * What a turn opens with: the messages the agent has not read, oldest
 * change first, at most `DIGEST_MESSAGES`, under the digest's heading, and
 * a line saying more wait where they do; nothing where nothing waits. The
 * digest is a read, so the next turn carries none of it again, and a
 * message cut short names the read that carries it whole; a turn that
 * fails after its digest leaves what it carried to the chat's history,
 * where a read of its channel finds it, as the planning brain's standing
 * context leaves a turn's edits. Note that
 * the message an outstanding notice told is left out, because the notice is
 * already a line of the agent's conversation. Nothing where the store
 * cannot be reached, since the turn runs as well without it.
 */
export function chatDigest(
  agent: ChatReader,
): Effect.Effect<string | undefined, never, DatabaseServices> {
  return inTransaction(
    Effect.gen(function* () {
      const { userId } = agent;
      const found = yield* seatOf(agent);
      if (Option.isNone(found)) return undefined;
      const { organizationId, self } = found.value;
      const noticed =
        self.noticeSeq !== null && self.noticeSeq > self.readSeq ? self.noticeSeq : undefined;
      const read = yield* unreadFor(userId, organizationId, self.id, { limit: DIGEST_MESSAGES });
      const { messages: unread, more } = Option.getOrElse(read, () => ({
        messages: [],
        more: false,
      }));
      const messages = unread.filter((message) => message.touchedSeq !== noticed);
      if (messages.length === 0 && !more) return undefined;
      const members = new Map((yield* roster(userId, organizationId)).map((row) => [row.id, row]));
      const names = channelNames(yield* channelsOf(userId, organizationId), self, members);
      const parents = messages.flatMap((message) =>
        message.parentId === null ? [] : [message.parentId],
      );
      const roots = yield* seqsOf(userId, organizationId, parents);
      const lines = messages.map((message) =>
        digestLine(message, lineOf(message, { names, members, roots })),
      );
      const rest = more ? [`More waits: ${CHAT_TOOLS.READ.name} reads it.`] : [];
      return [CHAT_DIGEST_HEADING, ...lines, ...rest].join("\n");
    }),
  ).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(undefined)),
  );
}

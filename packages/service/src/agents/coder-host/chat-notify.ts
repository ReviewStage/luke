import type { DatabaseServices } from "@luke/database/core/query";
import {
  CHAT_REFUSAL,
  type ChatChannelRow,
  type ChatMemberRow,
  type ChatMessageRow,
  type ChatPost,
  type ChatRefusal,
  channelOf,
  leave,
  markNoticed,
  postMessage,
  releaseNotice,
  roster,
  threadAuthors,
} from "@luke/database/models/chat-store";
import { readCodingAgent } from "@luke/database/models/coding-agent-store";
import { chatNoticeKey } from "@luke/database/models/ids";
import { isWorkspaceMember } from "@luke/database/models/workspace-store";
import type { LineSender, StoreWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import {
  CHANNEL_KIND,
  CHAT_BLOCK,
  CHAT_BOUNDS,
  CHAT_NOTICE_LEAD,
  CHAT_TOOL,
  type ChatReadBlock,
  MEMBER_KIND,
} from "@luke/features/chat-wire";
import { CODING_AGENT_BOUNDS } from "@luke/features/coding-agent-wire";
import { Effect, Option, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL } from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import type { EveSessions } from "../brain-host/eve-sessions.js";
import { steerCodingAgent } from "./steer.js";

/**
 * chat-notify.ts -- a chat message told to the members it addresses: the one door a coding agent's post and a person's post both go through.
 *
 * A message tells only the members it addresses: the other member of a
 * DM, and no one else, since no one else may read it; in any other channel
 * each member its words mention, and the root's author and every earlier
 * replier of the thread it replies in; never its own author and at most
 * `MAX_STEERS_PER_POST` of them. A plain post in a channel tells
 * nobody; the members read it when they next read the chat. A coding agent
 * is told by a notice steered into its session as one of its starter's
 * lines, marked as chat (`MESSAGE_CHANNEL.CHAT`), under a key named for the
 * message, the revision of what it asks, and the member, so a notice
 * handed over twice lands once, an ask posted again is told again, and an
 * ask only answered or resolved since is not. Note
 * that the notice is minted for the receiving agent's starter, whoever
 * posted, because eve steers a running turn only with a message whose
 * principal is that turn's own (`coder-host/channel.ts`), and an agent's
 * turn runs as the member who started it. An agent
 * holds one notice at a time: another while it has not read past the first
 * is held, since the agent reads it with the rest when it next reads the
 * chat. An agent archived, on an archived plan, or whose starter has left
 * the workspace, is said to have left and is steered nothing, though
 * nothing is stamped, since each can be undone: its session and transcript
 * are its starter's, and workspace chat reaches no one outside it; one whose session eve no longer runs has left for good and
 * is stamped so, and hears nothing more. A notice that could not be handed
 * over is let go, so the next one is told; one the deployment reaches no eve
 * for is held for the agent's next read. A post sent again under its key
 * is told again: the notice's key and the one outstanding notice keep that
 * from steering anyone twice, and it finishes a telling the first send did
 * not. A plan's planner and a person are handed to doors of
 * their own, which hold the message until Luke's report turn and the
 * window's announcement fill them. What each member came to is the
 * receipt the poster reads: told, held, left, and the handles that named no
 * one. A name marked `@public` is what the coder's tools, Luke's planner,
 * the window's route, and its announcements read as they land.
 */

/**
 * What telling one member came to.
 * @public
 */
export const NOTICE_OUTCOME = {
  /** The notice was handed to the member now. */
  TOLD: "told",
  /** The member reads it when it next reads the chat: a notice already outstanding, or a door that holds it. */
  HELD: "held",
  /** The member has left: an archived agent or plan, or a session eve no longer runs. */
  LEFT: "left",
} as const;

/** @public */
export type NoticeOutcome = (typeof NOTICE_OUTCOME)[keyof typeof NOTICE_OUTCOME];

/**
 * What a post's poster reads back: the handles told now, held, and left, and the handles mentioned that name no member.
 * @public
 */
export type ChatReceipt = {
  readonly told: readonly string[];
  readonly held: readonly string[];
  readonly left: readonly string[];
  readonly unresolved: readonly string[];
};

/**
 * A message as a door tells it: the message, the line that tells it, and who posted it.
 * @public
 */
export interface ChatNotice {
  readonly message: ChatMessageRow;
  readonly text: string;
  readonly from: ChatMemberRow;
}

/** One door: a member told of a notice under the telling that posted it, answering what that came to. */
export type ChatNoticeDoor = (
  member: ChatMemberRow,
  notice: ChatNotice,
  telling: ChatTelling,
) => Effect.Effect<NoticeOutcome, never, DatabaseServices>;

/** How a planner and a person are told, each a door its own chain fills. */
export interface ChatNoticeDoors {
  readonly planner: ChatNoticeDoor;
  readonly human: ChatNoticeDoor;
}

/** The doors before Luke's report turn and the window's announcement fill them: each holds the message for the member's next read. */
export const HELD_DOORS: ChatNoticeDoors = {
  planner: () => Effect.succeed(NOTICE_OUTCOME.HELD),
  human: () => Effect.succeed(NOTICE_OUTCOME.HELD),
};

/**
 * What a door's caller needs to steer a coding agent: eve as the account an
 * agent was started by, which each notice is minted for, or nothing where
 * the deployment reaches no eve, the writer, and the account posting.
 */
export interface ChatTelling {
  readonly eveFor: (starterUserId: string) => EveSessions | undefined;
  readonly writer: Effect.Effect<StoreWriter>;
  readonly userId: string;
  readonly organizationId: string;
  readonly doors: ChatNoticeDoors;
}

/** What a post came to: the message, the receipt, and whether it already stood under its key, which tells no one again. */
export interface ChatPostTold {
  readonly message: ChatMessageRow;
  readonly repeated: boolean;
  readonly receipt: ChatReceipt;
}

/** What a message's addressing reads: its author, its mentions, its channel's kind and DM pair, and the thread it replies in. */
interface ChatAddress {
  readonly authorMemberId: string;
  readonly mentions: readonly string[];
  readonly channel: Pick<ChatChannelRow, "kind" | "dmAMemberId" | "dmBMemberId">;
  readonly threadAuthors: readonly string[];
}

/** The refusals of a steer that mean the agent is away for now: archived, or on an archived plan, either of which can be undone. */
const GONE_REFUSALS: ReadonlySet<string> = new Set([
  HOSTED_REFUSAL.NOT_FOUND.error,
  HOSTED_REFUSAL.TASK_ARCHIVED.error,
]);

/** The message author each kind of member speaks as, on the notice's row. */
const AUTHOR_OF_KIND = {
  [MEMBER_KIND.AGENT]: MESSAGE_AUTHOR.AGENT,
  [MEMBER_KIND.PLANNER]: MESSAGE_AUTHOR.PLANNER,
  [MEMBER_KIND.HUMAN]: MESSAGE_AUTHOR.HUMAN,
} as const;

/** What the row says sent a notice's line: the poster, as the agent, Luke, or the member they are. */
export function senderOf(from: ChatMemberRow): LineSender {
  if (from.kind === MEMBER_KIND.PLANNER) return { kind: MESSAGE_SENDER.LUKE };
  if (from.kind === MEMBER_KIND.HUMAN && from.userId !== null) {
    return { kind: MESSAGE_SENDER.MEMBER, userId: from.userId };
  }
  return { kind: MESSAGE_SENDER.AGENT, name: from.handle };
}

/**
 * Who a notice's row says wrote it: the poster, by the kind of member it is
 * and its handle, from the chat at the message's place.
 * @public
 */
export function noticeMetadata(notice: ChatNotice) {
  return {
    author: AUTHOR_OF_KIND[notice.from.kind],
    channel: MESSAGE_CHANNEL.CHAT,
    chat_seq: notice.message.seq,
    from: notice.from.handle,
  } as const;
}

/** One block as a notice's line reads it, and a read of the chat: words as written, anything else named by what it is. */
export function blockWords(block: ChatReadBlock): string {
  switch (block.type) {
    case CHAT_BLOCK.MARKDOWN:
      return "text" in block ? block.text : "";
    case CHAT_BLOCK.LINK:
      return "url" in block ? `${block.label} (${block.url})` : "";
    case CHAT_BLOCK.CODE:
      return "repo" in block
        ? `[code: ${block.repo} ${block.path}:${block.startLine}-${block.endLine} at ${block.sha}]`
        : "";
    case CHAT_BLOCK.IMAGE:
      return "alt" in block ? `[image: ${block.alt}]` : "";
    default:
      return `[${block.type}]`;
  }
}

/** Where a message was said, as a notice names it. */
function whereSaid(channel: ChatChannelRow, message: ChatMessageRow): string {
  const room = channel.kind === CHANNEL_KIND.DM ? "to you" : `in #${channel.name ?? ""}`;
  return message.parentId === null ? room : `${room}, in a thread`;
}

/**
 * The line a notice is: who said it where and at what place, the words,
 * what it asks where it asks, and how to answer. Bounded to a message's
 * own bound.
 */
function noticeText(from: ChatMemberRow, channel: ChatChannelRow, message: ChatMessageRow): string {
  const header = `${CHAT_NOTICE_LEAD} · @${from.handle} ${whereSaid(channel, message)} (m ${message.seq}):`;
  const words = message.blocks
    .map(blockWords)
    .filter((part) => part !== "")
    .join("\n\n");
  const asks =
    message.ask === null
      ? ""
      : `It asks you (${message.ask.response.type}): answer it in its thread.`;
  const reply = `Reply with ${CHAT_TOOL.POST}({ replyTo: ${message.seq}, text }).`;
  const text = [header, words, asks, reply].filter((part) => part !== "").join("\n\n");
  return text.slice(0, CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS);
}

/**
 * The members a message tells, in the order they are told: the other of a
 * DM alone; elsewhere each member mentioned, then the thread's root author
 * and earlier repliers; each once, never the author, at most the bound.
 */
function toldBy(address: ChatAddress): readonly string[] {
  const { channel } = address;
  const addressed =
    channel.kind === CHANNEL_KIND.DM
      ? [channel.dmAMemberId, channel.dmBMemberId].flatMap((id) => (id === null ? [] : [id]))
      : [...address.mentions, ...address.threadAuthors];
  const told = [...new Set(addressed)].filter((id) => id !== address.authorMemberId);
  return told.slice(0, CHAT_BOUNDS.MAX_STEERS_PER_POST);
}

/**
 * A coding agent told of a message, as the module's header says: held
 * where a notice is outstanding, left where it is archived, on an archived
 * plan, its starter gone from the workspace, or retired, the last stamped
 * for good, otherwise steered.
 */
function tellAgent(
  telling: ChatTelling,
  member: ChatMemberRow,
  notice: ChatNotice,
): Effect.Effect<
  NoticeOutcome,
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  return Effect.gen(function* () {
    const { userId, organizationId } = telling;
    const place = notice.message.touchedSeq;
    if (member.leftAt !== null) return NOTICE_OUTCOME.LEFT;
    const agent =
      member.agentId === null
        ? Option.none()
        : yield* hostedStoreOrUnavailable(readCodingAgent(userId, member.agentId));
    if (Option.isNone(agent) || agent.value.archivedAt !== null) return NOTICE_OUTCOME.LEFT;
    // An agent runs as its starter, so one whose starter left the workspace hears nothing of its chat.
    const starterStays = yield* hostedStoreOrUnavailable(
      isWorkspaceMember(agent.value.userId, organizationId),
    );
    if (!starterStays) return NOTICE_OUTCOME.LEFT;
    // A deployment that reaches no eve steers nothing, so the agent reads the message when it next reads.
    const eve = telling.eveFor(agent.value.userId);
    if (eve === undefined) return NOTICE_OUTCOME.HELD;
    const claimed = yield* hostedStoreOrUnavailable(
      markNoticed(userId, organizationId, member.id, notice.message.channelId, place),
    );
    if (!claimed) return NOTICE_OUTCOME.HELD;
    // Note that eve is the starter's, whose turn it steers, while the plan is read as the poster's, who may stay when the starter leaves.
    const steered = yield* steerCodingAgent(eve, telling.writer, userId, agent.value, {
      text: notice.text,
      clientKey: chatNoticeKey(notice.message.id, notice.message.askRevision ?? 0, member.id),
      sender: senderOf(notice.from),
      metadata: noticeMetadata(notice),
    }).pipe(Effect.result);
    if (Result.isSuccess(steered)) return NOTICE_OUTCOME.TOLD;
    yield* hostedStoreOrUnavailable(releaseNotice(userId, organizationId, member.id, place));
    if (steered.failure.error === HOSTED_REFUSAL.AGENT_RETIRED.error) {
      return yield* Effect.as(
        hostedStoreOrUnavailable(leave(userId, organizationId, member.id)),
        NOTICE_OUTCOME.LEFT,
      );
    }
    return GONE_REFUSALS.has(steered.failure.error) ? NOTICE_OUTCOME.LEFT : NOTICE_OUTCOME.HELD;
  });
}

/**
 * Tells a message just posted to the members it addresses, each through
 * the way its kind is told, and answers the receipt: what `postChat` does
 * after a post, and what an ask's post or an answer's reply calls itself.
 * The handles that named no one when it was posted are the caller's to
 * pass on.
 * @public
 */
export function tellMessage(
  telling: ChatTelling,
  message: ChatMessageRow,
  unresolved: readonly string[],
): Effect.Effect<ChatReceipt, HostedRefusal, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  return Effect.gen(function* () {
    const { userId, organizationId } = telling;
    const channel = yield* hostedStoreOrUnavailable(
      channelOf(userId, organizationId, message.channelId),
    );
    if (Option.isNone(channel)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    const authors =
      message.parentId === null
        ? []
        : yield* hostedStoreOrUnavailable(
            threadAuthors(userId, organizationId, message.parentId, message.seq),
          );
    const members = new Map(
      (yield* hostedStoreOrUnavailable(roster(userId, organizationId))).map((row) => [row.id, row]),
    );
    const from = members.get(message.authorMemberId);
    if (from === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    const notice = { message, text: noticeText(from, channel.value, message), from };
    const told = toldBy({
      authorMemberId: message.authorMemberId,
      mentions: message.mentions,
      channel: channel.value,
      threadAuthors: authors,
    }).flatMap((id) => Option.toArray(Option.fromNullishOr(members.get(id))));
    const outcomes = yield* Effect.forEach(told, (member) => {
      switch (member.kind) {
        case MEMBER_KIND.AGENT:
          return Effect.map(tellAgent(telling, member, notice), (outcome) => ({ member, outcome }));
        case MEMBER_KIND.PLANNER:
          return Effect.map(telling.doors.planner(member, notice, telling), (outcome) => ({
            member,
            outcome,
          }));
        case MEMBER_KIND.HUMAN:
          return Effect.map(telling.doors.human(member, notice, telling), (outcome) => ({
            member,
            outcome,
          }));
      }
    });
    const handles = (outcome: NoticeOutcome) =>
      outcomes.filter((each) => each.outcome === outcome).map((each) => each.member.handle);
    return {
      told: handles(NOTICE_OUTCOME.TOLD),
      held: handles(NOTICE_OUTCOME.HELD),
      left: handles(NOTICE_OUTCOME.LEFT),
      unresolved,
    };
  });
}

/** The refusal a chat store's post answers, in the route's words. */
const HOSTED_OF_CHAT_REFUSAL = {
  [CHAT_REFUSAL.NOT_FOUND]: HOSTED_REFUSAL.NOT_FOUND,
  [CHAT_REFUSAL.NAME_TAKEN]: HOSTED_REFUSAL.INVALID_REQUEST,
  [CHAT_REFUSAL.TOO_MANY_TOPICS]: HOSTED_REFUSAL.INVALID_REQUEST,
  [CHAT_REFUSAL.AUTHOR_LEFT]: HOSTED_REFUSAL.AGENT_RETIRED,
  [CHAT_REFUSAL.CHANNEL_ARCHIVED]: HOSTED_REFUSAL.TASK_ARCHIVED,
  [CHAT_REFUSAL.KEY_TAKEN]: HOSTED_REFUSAL.INVALID_REQUEST,
  [CHAT_REFUSAL.ASK_ELSEWHERE]: HOSTED_REFUSAL.INVALID_REQUEST,
} as const satisfies Record<ChatRefusal, HostedRefusal>;

/**
 * Posts a message and tells the members it addresses: the one door a
 * coding agent's `post_chat` and the window's post both call. A post
 * repeated under its key answers the message it made, and is told again,
 * which steers no one twice. Refused as the store refuses the post, in the
 * route's words.
 */
export function postChat(
  telling: ChatTelling,
  post: ChatPost,
): Effect.Effect<
  ChatPostTold,
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  return Effect.gen(function* () {
    const posted = yield* hostedStoreOrUnavailable(
      postMessage(telling.userId, telling.organizationId, post),
    );
    if (Result.isFailure(posted)) return yield* Effect.fail(HOSTED_OF_CHAT_REFUSAL[posted.failure]);
    const { message, repeated, unresolved } = posted.success;
    const receipt = yield* tellMessage(telling, message, unresolved);
    return { message, repeated, receipt };
  });
}

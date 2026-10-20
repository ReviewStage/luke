import type { DatabaseServices } from "@luke/database/core/query";
import { chatEnabledFor } from "@luke/database/models/account-store";
import {
  attachMessageImages,
  CHAT_REFUSAL,
  type ChatChannelRow,
  type ChatImageWrite,
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
  CHAT_MEMBER_LABEL,
  CHAT_NOTICE_LEAD,
  type ChatReadBlock,
  chatNoticeAsksLine,
  chatNoticeReplyLine,
  MEMBER_KIND,
  type MemberKind,
} from "@luke/features/chat-wire";
import { CODING_AGENT_BOUNDS } from "@luke/features/coding-agent-wire";
import { mentionLinksIn } from "@luke/features/mention-link";
import { CHAT_NOTICE_FROM_CHARS } from "@luke/wire";
import { Effect, Option, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { SqlClient } from "effect/sql";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL } from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import type { EveSessions } from "../brain-host/eve-sessions.js";
import { type ChatNames, chatNamesOf } from "./chat-names.js";
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
 * their own: a person is told through their window's account-wide read
 * (`tellPerson`), and the planner's holds the message until Luke's report
 * turn fills it. A notice names who said it by their mention link, and
 * hands the words as they were written, every link in them whole
 * (`chat-names.ts`). What each member came to is the
 * receipt the poster reads, each member by its mention link: told, held,
 * left, and the labels of the links that named no one. A name marked
 * `@public` is what the coder's tools, Luke's planner, the window's route,
 * and its announcements read as they land.
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
 * What a post's poster reads back: the members told now, held, and left, each by its mention link or a plain label where none can be written, and the labels of the mention links that name no member.
 * @public
 */
export type ChatReceipt = {
  readonly told: readonly string[];
  readonly held: readonly string[];
  readonly left: readonly string[];
  readonly unresolved: readonly string[];
};

/**
 * A message as a door tells it: the message, the line that tells it, who posted it, and what they are called.
 * @public
 */
export interface ChatNotice {
  readonly message: ChatMessageRow;
  readonly text: string;
  readonly from: ChatMemberRow;
  readonly fromName: string;
}

/** How Luke and a person are told, each a door its own chain fills. */
export interface ChatNoticeDoors {
  readonly luke: (
    member: ChatMemberRow,
    notice: ChatNotice,
  ) => Effect.Effect<NoticeOutcome, never, DatabaseServices>;
  readonly human: (
    member: ChatMemberRow,
    notice: ChatNotice,
  ) => Effect.Effect<NoticeOutcome, never, DatabaseServices>;
}

/** A door that holds the message for the member's next read. */
const hold = () => Effect.succeed(NOTICE_OUTCOME.HELD);

/** The doors before Luke's report turn and the window's announcement fill them: each holds the message for the member's next read. */
export const HELD_DOORS: ChatNoticeDoors = { luke: hold, human: hold };

/**
 * How a person is told: their member stamped with the message's place, one
 * at a time as an agent's notice is, which the account's held read carries
 * to every window they are signed in to and each announces once
 * (`chat-waiting.ts`); held where a notice already stands unread, which
 * they read with the rest, and where the stamp could not be made.
 */
function tellPerson(
  member: ChatMemberRow,
  notice: ChatNotice,
): Effect.Effect<NoticeOutcome, never, DatabaseServices> {
  if (member.userId === null || member.leftAt !== null) return Effect.succeed(NOTICE_OUTCOME.HELD);
  return markNoticed(
    member.userId,
    member.organizationId,
    member.id,
    notice.message.channelId,
    notice.message.seq,
  ).pipe(
    Effect.map((stamped) => (stamped ? NOTICE_OUTCOME.TOLD : NOTICE_OUTCOME.HELD)),
    Effect.orElseSucceed(() => NOTICE_OUTCOME.HELD),
  );
}

/** The doors a post is told through until Luke's report turn fills Luke's: a person told through their window, Luke held for his next read. */
export const CHAT_DOORS: ChatNoticeDoors = { luke: hold, human: tellPerson };

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

/**
 * What sent a notice, as the row keeps it: a person by their account, Luke
 * for a planner, and an agent by its name, its title or else its model's id
 * as `message_agent` names one, and, where the member still names one the
 * poster reaches, its agent and the model it runs on as it posts, which its
 * line's mark is drawn by for good.
 */
function senderOf(userId: string, from: ChatMemberRow, name: string) {
  return Effect.gen(function* () {
    if (from.kind === MEMBER_KIND.HUMAN && from.userId !== null) {
      return { kind: MESSAGE_SENDER.MEMBER, userId: from.userId } satisfies LineSender;
    }
    if (from.kind === MEMBER_KIND.LUKE) {
      return { kind: MESSAGE_SENDER.LUKE } satisfies LineSender;
    }
    const agent =
      from.agentId === null
        ? Option.none()
        : yield* hostedStoreOrUnavailable(readCodingAgent(userId, from.agentId));
    const sender: LineSender = {
      kind: MESSAGE_SENDER.AGENT,
      name,
      ...(Option.isNone(agent) ? undefined : { agentId: agent.value.id, model: agent.value.model }),
    };
    return sender;
  });
}

/** The message author each kind of member speaks as, on the notice's row. */
const AUTHOR_OF_KIND = {
  [MEMBER_KIND.AGENT]: MESSAGE_AUTHOR.AGENT,
  [MEMBER_KIND.LUKE]: MESSAGE_AUTHOR.LUKE,
  [MEMBER_KIND.HUMAN]: MESSAGE_AUTHOR.HUMAN,
} as const;

/** One block as a notice's line reads it, and a read of the chat: words as written, every mention link in them whole, anything else named by what it is. */
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

/** What a paragraph break between a notice's parts takes of its bound. */
const PARAGRAPH_BREAK = "\n\n";

/** What a sender is called where their name holds nothing to call them by, by their kind. */
const BLANK_NAME = {
  [MEMBER_KIND.LUKE]: CHAT_MEMBER_LABEL.LUKE,
  [MEMBER_KIND.AGENT]: CHAT_MEMBER_LABEL.FORMER_AGENT,
  [MEMBER_KIND.HUMAN]: CHAT_MEMBER_LABEL.FORMER_PERSON,
} as const satisfies Record<MemberKind, string>;

/**
 * What a notice's row names its sender by: their name within the metadata's
 * bound, cut between two characters so no emoji is split, or their kind's
 * plain label where nothing of the name is left.
 */
function noticeFrom(name: string, kind: MemberKind): string {
  let kept = "";
  for (const character of name.trim()) {
    if (kept.length + character.length > CHAT_NOTICE_FROM_CHARS) break;
    kept += character;
  }
  const trimmed = kept.trim();
  return trimmed === "" ? BLANK_NAME[kind] : trimmed;
}

/**
 * The line a notice is: who said it, by their mention link, where and at what place, the words, cut outside any link,
 * what it asks where it asks, and how to answer. Bounded to a message's own
 * bound by the words alone, so the head and the closing lines always stand
 * whole: the agent always reads how to answer, and a window reading the
 * notice back always finds its closing lines in their whole shape
 * (`chatNoticeWords`).
 */
function noticeText(from: string, channel: ChatChannelRow, message: ChatMessageRow): string {
  const header = `${CHAT_NOTICE_LEAD} · ${from} ${whereSaid(channel, message)} (m ${message.seq}):`;
  const closings = [
    ...(message.ask === null ? [] : [chatNoticeAsksLine(message.ask.response.type)]),
    chatNoticeReplyLine(message.seq),
  ];
  const kept = [header, ...closings].join(PARAGRAPH_BREAK);
  const room = CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS - kept.length - PARAGRAPH_BREAK.length;
  const words = message.blocks
    .map((block) => blockWords(block))
    .filter((part) => part !== "")
    .join(PARAGRAPH_BREAK);
  const cut = words.slice(0, wholeLinksEnd(words, Math.max(room, 0)));
  return [header, cut, ...closings].filter((part) => part !== "").join(PARAGRAPH_BREAK);
}

/**
 * Where words cut at the bound end, never inside a mention link: a link the
 * bound falls inside is left out whole, so every link a notice carries is
 * one the agent can copy to address its member.
 */
function wholeLinksEnd(words: string, bound: number): number {
  if (words.length <= bound) return words.length;
  const straddling = mentionLinksIn(words).find((link) => link.start < bound && link.end > bound);
  return straddling?.start ?? bound;
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
    // An agent whose starter has not turned Chat on has no chat tools to answer with, so it is steered nothing.
    const chatOn = yield* hostedStoreOrUnavailable(chatEnabledFor(agent.value.userId));
    if (!chatOn) return NOTICE_OUTCOME.HELD;
    // A deployment that reaches no eve steers nothing, so the agent reads the message when it next reads.
    const eve = telling.eveFor(agent.value.userId);
    if (eve === undefined) return NOTICE_OUTCOME.HELD;
    // Note that who sent it is read before the notice is claimed, because a read that fails after the claim would hold the notice with nothing to release it.
    const sender = yield* senderOf(userId, notice.from, notice.fromName);
    const claimed = yield* hostedStoreOrUnavailable(
      markNoticed(userId, organizationId, member.id, notice.message.channelId, place),
    );
    if (!claimed) return NOTICE_OUTCOME.HELD;
    // Note that eve is the starter's, whose turn it steers, while the plan is read as the poster's, who may stay when the starter leaves.
    const steered = yield* steerCodingAgent(eve, telling.writer, userId, agent.value, {
      text: notice.text,
      clientKey: chatNoticeKey(notice.message.id, notice.message.askRevision ?? 0, member.id),
      sender,
      metadata: {
        author: AUTHOR_OF_KIND[notice.from.kind],
        channel: MESSAGE_CHANNEL.CHAT,
        chat_seq: notice.message.seq,
        from: noticeFrom(notice.fromName, notice.from.kind),
      },
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
 * Every member is named by its mention link as the poster's account reads
 * the workspace; the labels of the links that named no one when it was
 * posted are the caller's to pass on.
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
    const names: ChatNames = yield* hostedStoreOrUnavailable(
      chatNamesOf(userId, organizationId, members.values()),
    );
    const notice = {
      message,
      text: noticeText(names.mention(from), channel.value, message),
      from,
      fromName: names.name(from),
    };
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
        case MEMBER_KIND.LUKE:
          return Effect.map(telling.doors.luke(member, notice), (outcome) => ({
            member,
            outcome,
          }));
        case MEMBER_KIND.HUMAN:
          return Effect.map(telling.doors.human(member, notice), (outcome) => ({
            member,
            outcome,
          }));
      }
    });
    const named = (outcome: NoticeOutcome) =>
      outcomes.filter((each) => each.outcome === outcome).map((each) => names.mention(each.member));
    return {
      told: named(NOTICE_OUTCOME.TOLD),
      held: named(NOTICE_OUTCOME.HELD),
      left: named(NOTICE_OUTCOME.LEFT),
      unresolved,
    };
  });
}

/** The refusal a chat store's post answers, in the route's words. */
export const HOSTED_OF_CHAT_REFUSAL = {
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
 * coding agent's `post_chat` and the window's post both call. The pictures
 * handed in are kept under the ids its image blocks name in the same
 * transaction as the message, so no reader sees the message before its
 * pictures stand, and before anyone is told. A post repeated under its key
 * answers the message it made, and is told again, which steers no one
 * twice. Refused as the store refuses the post, in the route's words.
 */
export function postChat(
  telling: ChatTelling,
  post: ChatPost,
  images: readonly ChatImageWrite[] = [],
): Effect.Effect<
  ChatPostTold,
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  return Effect.gen(function* () {
    const { userId, organizationId } = telling;
    const written = Effect.gen(function* () {
      const posted = yield* postMessage(userId, organizationId, post);
      if (Result.isFailure(posted) || images.length === 0) return posted;
      const { id } = posted.success.message;
      yield* attachMessageImages(userId, organizationId, post.authorMemberId, id, images);
      return posted;
    });
    const posted = yield* hostedStoreOrUnavailable(
      Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(written)),
    );
    if (Result.isFailure(posted)) return yield* Effect.fail(HOSTED_OF_CHAT_REFUSAL[posted.failure]);
    const { message, repeated, unresolved } = posted.success;
    const receipt = yield* tellMessage(telling, message, unresolved);
    return { message, repeated, receipt };
  });
}

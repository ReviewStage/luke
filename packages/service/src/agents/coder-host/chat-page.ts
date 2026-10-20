import {
  type AgentMessage,
  agentMessagesOf,
  type MessagingAgent,
} from "@luke/database/models/agent-message-store";
import {
  agentMembersOf,
  type ChatAgentMember,
  type ChatChannelRow,
  type ChatMemberRow,
  type ChatMessageRow,
  type ChatStoreEffect,
  channelReads,
  channelsOf,
  chatHead,
  chatPast,
  ensureGeneral,
  ensureMember,
  roster,
} from "@luke/database/models/chat-store";
import { readAccountNames } from "@luke/database/models/workspace-store";
import {
  CHANNEL_KIND,
  type ChatAgentMessage,
  type ChatAnswer,
  type ChatChannel,
  type ChatMember,
  type ChatMessage,
  type ChatMessagingAgent,
  MEMBER_KIND,
} from "@luke/features/chat-wire";
import { Effect, Option, Schedule } from "effect";
import { agentLineWords } from "../agent-line.js";
import { CODER } from "./bounds.js";

/**
 * chat-page.ts -- a workspace's chat as the window reads it: everything a person sees of it past their cursor, held open while nothing moved.
 *
 * The reader is the account's own member of the workspace, minted on its
 * first read, which makes the workspace's `#general` too, so a window
 * opening an empty chat has a place to post. A person sees every channel,
 * and the chat keeps no direct messages for now, so where the chat stands
 * for them is the workspace's head:
 * the last place its sequence handed out, which every post and every
 * change to a message takes. A read whose cursor is past the head is held,
 * looked at again every `MESSAGES_POLL`, each look reading the one number
 * and none of the chat's words, and let go at `MESSAGES_HOLD` as a
 * transcript read is (`transcript.ts`), so the Chat pane hears a message
 * the moment it lands without asking on a clock of its own; a read past the
 * hold answers the chat unchanged, and the reader asks again. Every answer
 * carries the roster and the channels whole, since a channel made or a
 * member who left moves no place, and the messages past the cursor. It
 * carries too, whole, the newest lines the workspace's coding agents sent
 * one another directly (`agent-message-store.ts`), each as the sender's
 * words alone; such a line moves no place in the chat, so a held read
 * shows one at the latest when its hold ends.
 */

/**
 * The cursor a read hands back, past the place it read to: the next place
 * the reader has yet to read, in decimal. Note that it is one past the
 * place rather than the place, because the start, `0`, must name no place
 * an answer could hand back: a first read answers at once, and a read of
 * an empty chat hands back `1`, which is held.
 */
function chatCursorOf(seq: number): string {
  return String(seq + 1);
}

/** A member as the window reads one: a person by their account's name where `people` holds it, an agent by the name its tab shows and on the plan it works on where `agents` names them, and a Luke on his plan. */
function memberOnWire(
  row: ChatMemberRow,
  agents: ReadonlyMap<string, ChatAgentMember>,
  people: ReadonlyMap<string, string>,
): ChatMember {
  const agent = row.agentId === null ? undefined : agents.get(row.agentId);
  const planId = row.taskId ?? agent?.taskId;
  const name = row.userId === null ? agent?.name : people.get(row.userId);
  return {
    id: row.id,
    kind: row.kind,
    handle: row.handle,
    ...(name === undefined ? undefined : { name }),
    ...(row.userId === null ? undefined : { userId: row.userId }),
    ...(row.agentId === null ? undefined : { agentId: row.agentId }),
    ...(planId === undefined ? undefined : { planId }),
    left: row.leftAt !== null,
  };
}

export function channelOnWire(row: ChatChannelRow): ChatChannel {
  const pair =
    row.kind === CHANNEL_KIND.DM && row.dmAMemberId !== null && row.dmBMemberId !== null
      ? { members: [row.dmAMemberId, row.dmBMemberId] }
      : undefined;
  return {
    id: row.id,
    kind: row.kind,
    ...(row.name === null ? undefined : { name: row.name }),
    ...(row.taskId === null ? undefined : { planId: row.taskId }),
    ...pair,
    archived: row.archivedAt !== null,
    ...(row.purpose === null ? undefined : { purpose: row.purpose }),
  };
}

/** The ask a message carries, as the window reads it; nothing where it carries none. */
function askOnWire(row: ChatMessageRow): Pick<ChatMessage, "ask"> | undefined {
  const { ask, askKey, askRevision, askStatus } = row;
  if (ask === null || askKey === null || askRevision === null || askStatus === null) {
    return undefined;
  }
  return {
    ask: {
      key: askKey,
      revision: askRevision,
      status: askStatus,
      ...(ask.title === undefined ? undefined : { title: ask.title }),
      response: ask.response,
      needsReply: ask.needsReply ?? true,
      ...(row.answer === null ? undefined : { answer: row.answer }),
      ...(row.answeredByMemberId === null ? undefined : { answeredBy: row.answeredByMemberId }),
      ...(row.closedReason === null ? undefined : { closedReason: row.closedReason }),
    },
  };
}

/** A message as the window reads one. */
export function messageOnWire(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    seq: row.seq,
    touchedSeq: row.touchedSeq,
    channelId: row.channelId,
    ...(row.parentId === null ? undefined : { parentId: row.parentId }),
    authorId: row.authorMemberId,
    blocks: row.blocks,
    mentions: row.mentions,
    postedAt: row.createdAt.getTime(),
    ...askOnWire(row),
  };
}

function messagingAgentOnWire(agent: MessagingAgent): ChatMessagingAgent {
  return {
    agentId: agent.agentId,
    name: agent.name,
    model: agent.model,
    ...(agent.taskId === undefined ? undefined : { planId: agent.taskId }),
  };
}

/** A line one agent sent another, as the window reads it: the sender's words without the lead the recipient was handed them under. */
function agentMessageOnWire(message: AgentMessage): ChatAgentMessage {
  return {
    id: message.id,
    from: messagingAgentOnWire(message.from),
    to: messagingAgentOnWire(message.to),
    text: agentLineWords(message.text),
    sentAt: message.sentAt.getTime(),
  };
}

/**
 * Waits until the workspace's head moves past the reader's cursor, or the
 * hold ends: each look reads the head alone, and the caller reads the chat
 * whole once this returns.
 */
function heldUntilMoved(
  userId: string,
  organizationId: string,
  after: number,
): ChatStoreEffect<void> {
  const moved = Effect.map(chatHead(userId, organizationId), (head) =>
    Option.match(head, { onNone: () => true, onSome: (seq) => seq > after }),
  );
  return moved.pipe(
    Effect.repeat({ schedule: Schedule.spaced(CODER.MESSAGES_POLL), until: (changed) => changed }),
    Effect.timeoutOption(CODER.MESSAGES_HOLD),
    Effect.asVoid,
  );
}

/** Each channel's own cursor past the floor, left out where none is. */
function readsPast(
  floor: number,
  reads: readonly { readonly channelId: string; readonly readSeq: number }[],
): Pick<ChatAnswer, "reads"> | undefined {
  const past = reads.filter((each) => each.readSeq > floor);
  return past.length === 0 ? undefined : { reads: past };
}

/**
 * How far a member has read: its cursor everywhere, and each channel it has
 * read further on that channel's own cursor.
 */
export function readsOf(
  userId: string,
  organizationId: string,
  memberId: string,
): ChatStoreEffect<Pick<ChatAnswer, "readSeq" | "reads">> {
  return Effect.gen(function* () {
    const members = yield* roster(userId, organizationId);
    const floor = members.find((member) => member.id === memberId)?.readSeq ?? 0;
    const reads = yield* channelReads(userId, organizationId, memberId);
    return { readSeq: floor, ...readsPast(floor, reads) };
  });
}

/**
 * The workspace's chat as the account's person reads it from the cursor,
 * the next place it has yet to read, held while nothing moved past it;
 * nothing where the account is not in the workspace.
 */
export function workspaceChatPast(
  userId: string,
  organizationId: string,
  cursor: number,
): ChatStoreEffect<Option.Option<ChatAnswer>> {
  return Effect.gen(function* () {
    const after = cursor - 1;
    const self = yield* ensureMember(userId, organizationId, { kind: MEMBER_KIND.HUMAN, userId });
    if (Option.isNone(self)) return Option.none();
    yield* ensureGeneral(userId, organizationId);
    yield* heldUntilMoved(userId, organizationId, after);
    const past = yield* chatPast(userId, organizationId, self.value.id, after);
    if (Option.isNone(past)) return Option.none();
    const members = yield* roster(userId, organizationId);
    const agents = yield* agentMembersOf(userId, organizationId);
    const people = yield* readAccountNames(
      members.flatMap((member) => (member.userId === null ? [] : [member.userId])),
    );
    // Note that the chat holds no direct messages for now, so a DM made before, and what was said in it, is read by no one.
    const shown = (yield* channelsOf(userId, organizationId)).filter(
      (channel) => channel.kind !== CHANNEL_KIND.DM,
    );
    const shownIds = new Set(shown.map((channel) => channel.id));
    const reader = members.find((member) => member.id === self.value.id) ?? self.value;
    const reads = yield* channelReads(userId, organizationId, reader.id);
    const agentMessages = yield* agentMessagesOf(userId, organizationId);
    return Option.some({
      self: reader.id,
      readSeq: reader.readSeq,
      ...readsPast(reader.readSeq, reads),
      members: members.map((member) => memberOnWire(member, agents, people)),
      channels: shown.map(channelOnWire),
      messages: past.value.messages
        .filter((message) => shownIds.has(message.channelId))
        .map(messageOnWire),
      cursor: chatCursorOf(past.value.cursor),
      agentMessages: agentMessages.map(agentMessageOnWire),
    });
  });
}

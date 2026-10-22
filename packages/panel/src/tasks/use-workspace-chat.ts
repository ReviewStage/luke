import { useAtom } from "@effect/atom-react";
import type {
  ChatAnswer,
  ChatChannel,
  ChatMessage,
  ChatWriteAnswer,
  ChatWriteRequest,
} from "@luke/features/chat-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentChatAnswerView,
  type CodingAgentChatAttachmentParams,
  type CodingAgentChatPostParams,
  type CodingAgentChatWriteAnswerView,
  type CodingAgentInboxAttachmentView,
} from "@luke/features/coding-agent-view";
import { ACT_KIND } from "@luke/host/acts";
import type { ChatAskAnswer, ChatChannelChange, ChatPost } from "@luke/ui/chat-model";
import { keepIdentity } from "@luke/wire";
import { Duration, Effect } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { askAct } from "../act.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { messageFailureWords } from "./coding-agent-model.js";

/**
 * use-workspace-chat.ts -- the chosen workspace's chat as one control: followed over Neon Realtime and pushed as it changes, and the window's posts, answers, resolves, and reads on their way back.
 *
 * The window holds the chat's stream open on its act port
 * (`codingAgents.chatFollow`) while it is signed in to a workspace outside
 * a fixture run, and the host pushes the chat whole down it each time it
 * changes, so nothing here asks again, holds a cursor, or keeps a loop.
 * Each push is the chat whole: the roster, the channels, and the messages
 * it holds (each channel's newest, and every open ask), which replace what
 * was held, a message held newer by the place it last changed at kept, so a
 * push that crosses a write's own answer never sets a message back. What
 * the window wrote, a message or a channel, is laid over each push that may
 * have been read before the write landed, until a push holds it as written
 * or `OVERLAY_HOLD` has passed since it was answered.
 * Another workspace starts from nothing of this one's. A chat
 * that could not be read is let go and says so, with Try again, which
 * follows it anew.
 *
 * A post and an answer go under a key minted here and kept with their
 * words, so the same one sent again after a lost reply is taken once and
 * tells no one twice; the service answers with the message as it then
 * stands, which is put in place at once. An answer to an ask its poster
 * changed first, or one no longer open, is not taken, and the card says so.
 * Each push keeps every message, channel, and member it says the same of as
 * the one held, by id, so a part drawn from an unchanged one holds, and a
 * push that changes nothing hands back the chat held. A message is matched
 * by its id alone, so a message the window wrote and the push that holds it
 * are one message, never two.
 * While a channel is shown the developer has read to the newest message
 * held: the cursor moves in the window at once, and the service is told
 * once `CHAT_READ_PAUSE` after the first move of a burst, of the newest place
 * each channel moved to by then, so a run of messages costs one read, not
 * one each. For you moves no cursor, since what waits there is what has
 * not been read.
 * Mark as read, from a rail row or a group's head, reads each channel it
 * names to its newest message held, on that channel's cursor alone.
 * A picture a message carries is read on its own, by the message and the
 * attachment its block names, in the workspace read.
 */

/**
 * How the window follows a workspace's chat: each push is handed to `hear`
 * as it comes, a stream that could not open or broke as a chat that could
 * not be read, until the returned call stops it.
 */
export type ChatFollower = (
  workspaceId: string,
  hear: (chat: CodingAgentChatAnswerView) => void,
) => () => void;

/** A follower over an act door: the chat's stream, opened as an act. */
export const chatFollowerOf =
  (act: typeof askAct): ChatFollower =>
  (workspaceId, hear) => {
    let stopped = false;
    let stream: AsyncIteratorObject<CodingAgentChatAnswerView> | undefined;
    const following = act(ACT_KIND.CODING_AGENTS_CHAT_FOLLOW, { workspaceId }).then(
      async (opened) => {
        stream = opened;
        // A stream that opened only after the window let it go is closed at once.
        if (stopped) {
          await opened.return?.(undefined);
          return;
        }
        for await (const chat of opened) {
          if (!stopped) hear(chat);
        }
        // A stream that ended though the window still follows it has stopped being told anything.
        if (!stopped) hear({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      },
    );
    following.catch(() => {
      if (!stopped) hear({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
    });
    return () => {
      stopped = true;
      void stream?.return?.(undefined);
    };
  };

/** How one write is sent: the workspace and the write, answered as the view hears it. */
export type ChatWriter = (
  params: CodingAgentChatPostParams,
) => Promise<CodingAgentChatWriteAnswerView>;

/** How one picture a message carries is read: the workspace, the message, and the attachment, answered as the view hears it. */
export type ChatPictureReader = (
  params: CodingAgentChatAttachmentParams,
) => Promise<CodingAgentInboxAttachmentView>;

/** What Chat draws and presses of the service's chat. */
export interface WorkspaceChatControl {
  /** The chat as last read; none before the first read of this workspace answers. */
  readonly chat: ChatAnswer | undefined;
  /** Whether the last read did not answer, so Chat offers to try again. */
  readonly failed: boolean;
  readonly onRetry: () => void;
  /** Posts as the developer; answers why the post did not go, or nothing once it is taken. */
  readonly onPost: (post: ChatPost) => Promise<string | undefined>;
  /** Answers an ask as the developer; answers why it was not taken, or nothing once it is. */
  readonly onAnswer: (answer: ChatAskAnswer) => Promise<string | undefined>;
  /** Opens or edits a topic channel as the developer; answers why it was refused, or nothing once it is taken. */
  readonly onChannel: (change: ChatChannelChange) => Promise<string | undefined>;
  /** Marks channels read to the newest message each holds, as a row's Mark as read asks; a channel with nothing past its cursor is left alone. */
  readonly onRead: (channelIds: readonly string[]) => void;
  /** Reads one picture a message carries, by the message and the attachment its block names. */
  readonly readPicture: (
    messageId: string,
    attachmentId: string,
  ) => Promise<CodingAgentInboxAttachmentView>;
}

/** What a card says when its answer was not taken. */
export const CHAT_NOT_TAKEN =
  "The ask changed before your answer landed. Answer it as it stands now.";

interface Held {
  /** The account the chat was read for, so another account signing in starts from nothing of it. */
  readonly account: string | undefined;
  readonly workspaceId: string | undefined;
  readonly chat: ChatAnswer | undefined;
  readonly failed: boolean;
}

/** Whether what is held was read for the account and workspace given. */
function heldFor(
  held: Held,
  account: string | undefined,
  workspaceId: string | undefined,
): boolean {
  return held.account === account && held.workspaceId === workspaceId;
}

function fresh(account: string | undefined, workspaceId: string | undefined): Held {
  return { account, workspaceId, chat: undefined, failed: false };
}

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** No cursor moved ahead of the service. */
const NOTHING_AHEAD: ReadonlyMap<string, number> = new Map();

/** How long what the window wrote is laid over pushes that may predate it, at most: a held poll answers a change within about a second. */
const OVERLAY_HOLD_MS = 30_000;

/** How long after a channel's cursor first moves in a burst the service is told where it moved to. */
export const CHAT_READ_PAUSE = Duration.seconds(1);

/**
 * A message as delivered again, kept as the one held where it says the same:
 * the newer word of the two, sharing what the held one says alike, and the
 * held one itself where they are equal.
 */
function keptMessage(standing: ChatMessage | undefined, message: ChatMessage): ChatMessage {
  if (standing === undefined) return message;
  if (standing.touchedSeq > message.touchedSeq) return standing;
  return keepIdentity(standing, message);
}

/** The list handed back as the one held where each item is the held one at its place. */
function keptList<Each>(held: readonly Each[] | undefined, next: readonly Each[]): readonly Each[] {
  if (held === undefined || held.length !== next.length) return next;
  return next.every((each, at) => each === held[at]) ? held : next;
}

/** The messages held with each newer word on one put in place by id, in the order posted. */
function withMessages(
  held: readonly ChatMessage[],
  newer: readonly ChatMessage[],
): readonly ChatMessage[] {
  const byId = new Map(held.map((message) => [message.id, message]));
  for (const message of newer) byId.set(message.id, keptMessage(byId.get(message.id), message));
  return keptList(
    held,
    [...byId.values()].toSorted((one, other) => one.seq - other.seq),
  );
}

/** The channels given with each one written since put in its place by id, or after them where the push had none yet. */
function withChannels(
  channels: readonly ChatChannel[],
  written: readonly ChatChannel[],
): readonly ChatChannel[] {
  const fresh = written.filter((channel) => !channels.some((each) => each.id === channel.id));
  return [
    ...channels.map((channel) => written.find((each) => each.id === channel.id) ?? channel),
    ...fresh,
  ];
}

/**
 * The chat held with a push taken in: the push whole, which messages it
 * holds included, each one the window holds newer kept, each read cursor
 * the window holds further kept, and what the window wrote laid over it,
 * since a push may have been read before a write landed.
 */
function withRead(
  chat: ChatAnswer | undefined,
  answer: ChatAnswer,
  written: { readonly channels: readonly ChatChannel[]; readonly messages: readonly ChatMessage[] },
): ChatAnswer {
  const held = new Map((chat?.messages ?? []).map((message) => [message.id, message]));
  const pushed = keptList(
    chat?.messages,
    answer.messages.map((message) => keptMessage(held.get(message.id), message)),
  );
  // Note that a cursor never moves back, so a push read before a read's answer sets nothing back.
  // A push with no channel past its floor carries no `reads`, which says nothing of the cursors held.
  const reads =
    chat === undefined || (chat.reads === undefined && answer.reads === undefined)
      ? answer.reads
      : furthestReads(chat, answer.reads ?? []);
  const taken: ChatAnswer = {
    ...answer,
    readSeq: Math.max(chat?.readSeq ?? 0, answer.readSeq),
    ...(reads === undefined ? undefined : { reads }),
    channels: withChannels(answer.channels, written.channels),
    messages: withMessages(pushed, written.messages),
  };
  return chat === undefined ? taken : keptChat(chat, taken);
}

/**
 * A chat taken in, kept as the one held where it says the same: its roster,
 * channels, and cursors kept where equal, its messages as already kept by
 * id, and the held chat itself where nothing moved. Note that the messages
 * are never matched by place, since a message fallen out between two pushes
 * would pair every one after it with its neighbour.
 */
function keptChat(held: ChatAnswer, taken: ChatAnswer): ChatAnswer {
  const kept: ChatAnswer = {
    ...taken,
    members: keepIdentity(held.members, taken.members),
    channels: keepIdentity(held.channels, taken.channels),
    messages: keptList(held.messages, taken.messages),
    ...(taken.reads === undefined
      ? undefined
      : { reads: held.reads === undefined ? taken.reads : keepIdentity(held.reads, taken.reads) }),
  };
  const keys = Object.keys(kept) as (keyof ChatAnswer)[];
  const same =
    keys.length === Object.keys(held).length &&
    keys.every((key) => Object.hasOwn(held, key) && held[key] === kept[key]);
  return same ? held : kept;
}

/** What the window wrote, a channel or a message: what the write answered, the account and workspace it went as and to, and when it was answered. */
interface Written {
  readonly channel?: ChatChannel;
  readonly message?: ChatMessage;
  readonly account: string | undefined;
  readonly workspaceId: string;
  readonly at: number;
}

/** Whether a push holds what the window wrote as written: the channel as it stands, or the message as new as it. */
function holdsAsWritten(pushed: ChatAnswer, written: Written): boolean {
  const { channel, message } = written;
  if (message !== undefined) {
    const standing = pushed.messages.find((each) => each.id === message.id);
    return standing !== undefined && standing.touchedSeq >= message.touchedSeq;
  }
  const standing = pushed.channels.find((each) => each.id === channel?.id);
  return (
    standing !== undefined &&
    standing.name === channel?.name &&
    standing.purpose === channel?.purpose &&
    standing.archived === channel?.archived
  );
}

/**
 * Each channel's cursor as far as either the chat held or a read's answer
 * or a push puts it. Note that a cursor never moves back, so of two reads
 * answered out of order, as Mark all as read sends them, the older answer
 * sets nothing back, nor does a push read before either landed.
 */
function furthestReads(
  chat: ChatAnswer,
  answered: NonNullable<ChatAnswer["reads"]>,
): NonNullable<ChatAnswer["reads"]> {
  const furthest = new Map((chat.reads ?? []).map((each) => [each.channelId, each.readSeq]));
  for (const each of answered) {
    furthest.set(each.channelId, Math.max(furthest.get(each.channelId) ?? 0, each.readSeq));
  }
  return [...furthest].map(([channelId, readSeq]) => ({ channelId, readSeq }));
}

/** The chat held with a write's answer taken in: the message it names in place, or the cursor where it moved. */
function withWrite(chat: ChatAnswer, answer: ChatWriteAnswer): ChatAnswer {
  if ("channel" in answer) {
    const { channel } = answer;
    const standing = chat.channels.some((each) => each.id === channel.id);
    return {
      ...chat,
      channels: standing
        ? chat.channels.map((each) => (each.id === channel.id ? channel : each))
        : [...chat.channels, channel],
    };
  }
  if ("readSeq" in answer) {
    return {
      ...chat,
      readSeq: Math.max(chat.readSeq, answer.readSeq),
      ...(answer.reads === undefined ? undefined : { reads: furthestReads(chat, answer.reads) }),
    };
  }
  const message =
    "posted" in answer ? answer.posted : "ask" in answer ? answer.ask : answer.resolved;
  const messages = withMessages(chat.messages, [message]);
  return messages === chat.messages ? chat : { ...chat, messages };
}

/** A write as it landed: the service's answer, or why there is none. */
type Landed = { readonly answer: ChatWriteAnswer } | { readonly refused: string };

/** The key a send goes under: the one minted for the same words while they wait to be taken, else a new one. */
function keyFor(keys: Map<string, string>, words: string): string {
  const kept = keys.get(words) ?? crypto.randomUUID();
  keys.set(words, kept);
  return kept;
}

/** What a send says once landed: why it did not go or was not taken, or nothing; a send that landed lets its key go. */
function settledWords(
  keys: Map<string, string>,
  words: string,
  landed: Landed,
): string | undefined {
  if ("refused" in landed) return landed.refused;
  keys.delete(words);
  const { answer } = landed;
  return "taken" in answer && !answer.taken ? CHAT_NOT_TAKEN : undefined;
}

/** The latest place anything held in a channel was posted or changed at; none in an empty one. */
function newestSeqIn(chat: ChatAnswer | undefined, channelId: string): number {
  const placed = (chat?.messages ?? []).flatMap((message) =>
    message.channelId === channelId ? [message.touchedSeq] : [],
  );
  return Math.max(0, ...placed);
}

/** How far the reader has read a channel: its own cursor there where it read further, else its cursor everywhere. */
function readSeqIn(chat: ChatAnswer | undefined, channelId: string): number {
  const own = chat?.reads?.find((each) => each.channelId === channelId)?.readSeq ?? 0;
  return Math.max(chat?.readSeq ?? 0, own);
}

/** The chat with each cursor the window moved ahead of the service laid over it; the chat itself where none is ahead. */
function withAhead(
  chat: ChatAnswer | undefined,
  ahead: ReadonlyMap<string, number>,
): ChatAnswer | undefined {
  if (chat === undefined) return undefined;
  const moved = [...ahead].filter(([channelId, seq]) => seq > readSeqIn(chat, channelId));
  if (moved.length === 0) return chat;
  return {
    ...chat,
    reads: furthestReads(
      chat,
      moved.map(([channelId, readSeq]) => ({ channelId, readSeq })),
    ),
  };
}

/** The cursors moved ahead of the service, by channel, for the account and workspace they were moved in. */
interface Ahead {
  readonly account: string | undefined;
  readonly workspaceId: string | undefined;
  readonly seqs: ReadonlyMap<string, number>;
}

export function useWorkspaceChat(input: {
  /** The account signed in, whose chat it is. */
  account: string | undefined;
  workspaceId: string | undefined;
  /** Whether the chat is followed at all: a live run, signed in. */
  active: boolean;
  /** The channel of Chat on screen, whose messages have been read; none while For you or nothing of Chat is. */
  reading: string | undefined;
  followChat: ChatFollower;
  writeChat: ChatWriter;
  readPicture: ChatPictureReader;
}): WorkspaceChatControl {
  const { account, workspaceId, active, reading } = input;
  const [held, setHeld] = useState<Held>(() => fresh(account, workspaceId));
  if (!heldFor(held, account, workspaceId)) setHeld(fresh(account, workspaceId));
  const [attempt, setAttempt] = useState(0);
  // A send's key and words, by what it sends, so the same send again goes under the same key.
  const keys = useRef(new Map<string, string>());
  // What the window wrote, by id, laid over pushes that may predate it.
  const written = useRef(new Map<string, Written>());
  const latest = useRef(input);
  latest.current = input;

  const following = active && workspaceId !== undefined && !held.failed;
  useEffect(() => {
    if (!following || workspaceId === undefined) return;
    return latest.current.followChat(workspaceId, (pushed) => {
      if ("failure" in pushed) {
        setHeld((was) => (heldFor(was, account, workspaceId) ? { ...was, failed: true } : was));
        return;
      }
      // A write is let go once a push holds it as written, or once a push could no longer predate it.
      const now = Date.now();
      for (const [id, each] of written.current) {
        if (holdsAsWritten(pushed, each) || now - each.at > OVERLAY_HOLD_MS) {
          written.current.delete(id);
        }
      }
      const ours = [...written.current.values()].filter(
        (each) => each.account === account && each.workspaceId === workspaceId,
      );
      const since = {
        channels: ours.flatMap((each) => (each.channel === undefined ? [] : [each.channel])),
        messages: ours.flatMap((each) => (each.message === undefined ? [] : [each.message])),
      };
      // A push that changes nothing hands back what is held, so nothing drawn from it is drawn again.
      setHeld((was) => {
        if (!heldFor(was, account, workspaceId)) return was;
        const chat = withRead(was.chat, pushed, since);
        return chat === was.chat ? was : { ...was, chat };
      });
    });
    // Note that the account is a dependency, so another account's push starts over rather than landing in its chat.
  }, [following, account, workspaceId, attempt]);

  const onRetry = useCallback(() => {
    setHeld((was) => ({ ...was, failed: false }));
    setAttempt((count) => count + 1);
  }, []);

  // A write's answer is put in place only while the window still reads the workspace it went to.
  const write = useCallback(
    async (request: ChatWriteRequest): Promise<Landed> => {
      if (workspaceId === undefined) return { refused: messageFailureWords(UNANSWERED.failure) };
      const answer = await latest.current
        .writeChat({ workspaceId, write: request })
        .catch((): CodingAgentChatWriteAnswerView => UNANSWERED);
      if ("failure" in answer) return { refused: messageFailureWords(answer.failure) };
      const at = Date.now();
      if ("channel" in answer) {
        written.current.set(answer.channel.id, {
          channel: answer.channel,
          account,
          workspaceId,
          at,
        });
      } else if (!("readSeq" in answer)) {
        const message =
          "posted" in answer ? answer.posted : "ask" in answer ? answer.ask : answer.resolved;
        written.current.set(message.id, { message, account, workspaceId, at });
      }
      setHeld((was) =>
        heldFor(was, account, workspaceId) && was.chat !== undefined
          ? { ...was, chat: withWrite(was.chat, answer) }
          : was,
      );
      return { answer };
    },
    [account, workspaceId],
  );

  const onPost = useCallback(
    (post: ChatPost) => {
      const words = JSON.stringify([workspaceId, post]);
      const request = { ...post, clientKey: keyFor(keys.current, words) };
      return write(request).then((landed) => settledWords(keys.current, words, landed));
    },
    [workspaceId, write],
  );
  const onAnswer = useCallback(
    (answer: ChatAskAnswer) => {
      const words = JSON.stringify([workspaceId, answer]);
      const request = { answer, clientKey: keyFor(keys.current, words) };
      return write(request).then((landed) => settledWords(keys.current, words, landed));
    },
    [workspaceId, write],
  );

  const onChannel = useCallback(
    (change: ChatChannelChange) =>
      write(change).then((landed) => ("refused" in landed ? landed.refused : undefined)),
    [write],
  );

  const readPicture = useCallback(
    (messageId: string, attachmentId: string): Promise<CodingAgentInboxAttachmentView> =>
      workspaceId === undefined
        ? Promise.resolve(UNANSWERED)
        : latest.current
            .readPicture({ workspaceId, messageId, attachmentId })
            .catch((): CodingAgentInboxAttachmentView => UNANSWERED),
    [workspaceId],
  );

  const onRead = useCallback(
    (channelIds: readonly string[]) => {
      for (const channelId of channelIds) {
        const newest = newestSeqIn(held.chat, channelId);
        if (newest > readSeqIn(held.chat, channelId)) void write({ readTo: newest, channelId });
      }
    },
    [held.chat, write],
  );

  // While a channel is shown, the developer has read it to the newest message it holds: moved in the window at once, told after a pause.
  const newest = reading === undefined ? 0 : newestSeqIn(held.chat, reading);
  const readSeq = reading === undefined ? 0 : readSeqIn(held.chat, reading);
  const [ahead, setAhead] = useState<Ahead>(() => ({ account, workspaceId, seqs: new Map() }));
  const aheadHere =
    ahead.account === account && ahead.workspaceId === workspaceId ? ahead.seqs : NOTHING_AHEAD;
  // The places each channel moved to that the service is yet to be told, for the account and workspace they were read in.
  const untold = useRef<Ahead>({ account, workspaceId, seqs: new Map() });
  const [pauseAtom] = useState(() =>
    rendererRuntime.fn((stamp: number) => Effect.as(Effect.sleep(CHAT_READ_PAUSE), stamp)),
  );
  const [pause, startPause] = useAtom(pauseAtom);
  const pauses = useRef({ started: 0, ended: 0 });
  // The place the channel shown last moved to, so a draw that moves nothing tells nothing.
  const told = useRef<{
    readonly account: string | undefined;
    readonly workspaceId: string | undefined;
    readonly channelId: string | undefined;
    readonly seq: number;
  }>({ account, workspaceId, channelId: undefined, seq: 0 });
  useEffect(() => {
    if (reading === undefined) return;
    // Note that a read is the account's own, so what another account moved says nothing of this one's.
    const same =
      told.current.account === account &&
      told.current.workspaceId === workspaceId &&
      told.current.channelId === reading;
    const already = same ? told.current.seq : 0;
    if (newest <= readSeq || newest <= already) return;
    told.current = { account, workspaceId, channelId: reading, seq: newest };
    const here = untold.current.account === account && untold.current.workspaceId === workspaceId;
    const waiting = here ? untold.current.seqs : NOTHING_AHEAD;
    untold.current = { account, workspaceId, seqs: new Map(waiting).set(reading, newest) };
    setAhead((was) => {
      const kept = was.account === account && was.workspaceId === workspaceId;
      const seqs = new Map(kept ? was.seqs : NOTHING_AHEAD).set(reading, newest);
      return { account, workspaceId, seqs };
    });
    // Note that a pause already running takes this move with it, so a burst is told once.
    if (pauses.current.started === pauses.current.ended) {
      pauses.current.started += 1;
      startPause(pauses.current.started);
    }
  }, [reading, newest, readSeq, account, workspaceId, startPause]);

  // A pause run out tells the service where each channel moved to; a read that did not land is let go, so the channel shown again tells it again.
  useEffect(() => {
    if (!AsyncResult.isSuccess(pause) || pause.waiting) return;
    if (pause.value !== pauses.current.started || pauses.current.ended === pause.value) return;
    pauses.current.ended = pause.value;
    const telling = untold.current;
    untold.current = { ...telling, seqs: new Map() };
    if (telling.account !== account || telling.workspaceId !== workspaceId) return;
    for (const [channelId, seq] of telling.seqs) {
      void write({ readTo: seq, channelId }).then((landed) => {
        if (!("refused" in landed)) return;
        const { current } = told;
        if (current.channelId === channelId && current.seq === seq) {
          told.current = { ...current, seq: 0 };
        }
        setAhead((was) =>
          was.account === account &&
          was.workspaceId === workspaceId &&
          was.seqs.get(channelId) === seq
            ? { ...was, seqs: new Map([...was.seqs].filter(([id]) => id !== channelId)) }
            : was,
        );
      });
    }
  }, [pause, account, workspaceId, write]);

  const chat = useMemo(() => withAhead(held.chat, aheadHere), [held.chat, aheadHere]);

  return {
    chat,
    failed: held.failed,
    onRetry,
    onPost,
    onAnswer,
    onChannel,
    onRead,
    readPicture,
  };
}

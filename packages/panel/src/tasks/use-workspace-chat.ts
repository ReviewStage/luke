import {
  CHAT_CURSOR_START,
  type ChatAnswer,
  type ChatChannel,
  type ChatMessage,
  type ChatWriteAnswer,
  type ChatWriteRequest,
} from "@luke/features/chat-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentChatAnswerView,
  type CodingAgentChatAttachmentParams,
  type CodingAgentChatParams,
  type CodingAgentChatPostParams,
  type CodingAgentChatWriteAnswerView,
  type CodingAgentInboxAttachmentView,
} from "@luke/features/coding-agent-view";
import type { ChatAskAnswer, ChatChannelChange, ChatPost } from "@luke/ui/chat-model";
import { useCallback, useEffect, useRef, useState } from "react";
import { messageFailureWords } from "./coding-agent-model.js";

/**
 * use-workspace-chat.ts -- the chosen workspace's chat as one control: read on the service's held long-poll, and the window's posts, answers, resolves, and reads on their way back.
 *
 * The service holds a read open while nothing changed past the cursor and
 * lets it go at its own hold, so the loop is one read after another with no
 * clock of its own, as a plan's inbox is read (`use-plan-inbox.ts`). The
 * cursor is the service's own; the start answers at once. Each answer
 * carries the roster and the channels whole, which replace what was held,
 * and the messages posted or changed past the cursor, which replace the
 * ones held by id where they are newer by the place they last changed at,
 * so a read that crosses a write's own answer never sets a message back.
 * The loop runs while the window is signed in to a workspace outside a
 * fixture run; another workspace starts from nothing of this one's. A read
 * that did not answer ends the loop and says so, with Try again, rather
 * than asking again at once.
 *
 * A post and an answer go under a key minted here and kept with their
 * words, so the same one sent again after a lost reply is taken once and
 * tells no one twice; the service answers with the message as it then
 * stands, which is put in place at once. An answer to an ask its poster
 * changed first, or one no longer open, is not taken, and the card says so.
 * While a channel is shown the developer has read to the newest message
 * held, which is told to the service once per place it moves to. For you
 * moves no cursor, since what waits there is what has not been read.
 * A picture a message carries is read on its own, by the message and the
 * attachment its block names, in the workspace read.
 */

/** How one read is asked: the workspace and the cursor to read past, answered as the view hears it. */
export type ChatReader = (params: CodingAgentChatParams) => Promise<CodingAgentChatAnswerView>;

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

/** The messages held with each newer word on one put in place by id, in the order posted. */
function withMessages(
  held: readonly ChatMessage[],
  newer: readonly ChatMessage[],
): readonly ChatMessage[] {
  const byId = new Map(held.map((message) => [message.id, message]));
  for (const message of newer) {
    const standing = byId.get(message.id);
    if (standing === undefined || standing.touchedSeq <= message.touchedSeq) {
      byId.set(message.id, message);
    }
  }
  return [...byId.values()].toSorted((one, other) => one.seq - other.seq);
}

/** The channels given with each one written since put in its place by id, or after them where the read had none yet. */
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
 * The chat held with a read's answer taken in: the roster and channels
 * whole, the messages by id. Note that a channel carries no place of its
 * own to order a read against a write, as a message's `touchedSeq` does, so
 * the channels the window wrote while the read was out are laid back over
 * the read's, which may have been taken before they were.
 */
function withRead(
  chat: ChatAnswer | undefined,
  answer: ChatAnswer,
  written: readonly ChatChannel[],
): ChatAnswer {
  return {
    ...answer,
    channels: withChannels(answer.channels, written),
    messages: withMessages(chat?.messages ?? [], answer.messages),
  };
}

/** A channel the window wrote: what the write answered, the account and workspace it went as and to, and the count of channel writes it was. */
interface WrittenChannel {
  readonly channel: ChatChannel;
  readonly account: string | undefined;
  readonly workspaceId: string;
  readonly generation: number;
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
      ...(answer.reads === undefined ? undefined : { reads: answer.reads }),
    };
  }
  const message =
    "posted" in answer ? answer.posted : "ask" in answer ? answer.ask : answer.resolved;
  return { ...chat, messages: withMessages(chat.messages, [message]) };
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

export function useWorkspaceChat(input: {
  /** The account signed in, whose chat it is. */
  account: string | undefined;
  workspaceId: string | undefined;
  /** Whether the chat is read at all: a live run, signed in. */
  active: boolean;
  /** The channel of Chat on screen, whose messages have been read; none while For you or nothing of Chat is. */
  reading: string | undefined;
  readChat: ChatReader;
  writeChat: ChatWriter;
  readPicture: ChatPictureReader;
}): WorkspaceChatControl {
  const { account, workspaceId, active, reading } = input;
  const [held, setHeld] = useState<Held>(() => fresh(account, workspaceId));
  if (!heldFor(held, account, workspaceId)) setHeld(fresh(account, workspaceId));
  const [attempt, setAttempt] = useState(0);
  // A send's key and words, by what it sends, so the same send again goes under the same key.
  const keys = useRef(new Map<string, string>());
  // Each channel the window writes, by id, and how many it has written, which a read taken before one did not see.
  const written = useRef(new Map<string, WrittenChannel>());
  const channelWrites = useRef(0);
  const latest = useRef(input);
  latest.current = input;

  const looping = active && workspaceId !== undefined && !held.failed;
  useEffect(() => {
    if (!looping || workspaceId === undefined) return;
    let live = true;
    const loop = async () => {
      let after = CHAT_CURSOR_START;
      while (live) {
        const asked = channelWrites.current;
        const answer = await latest.current
          .readChat({ workspaceId, after })
          .catch((): CodingAgentChatAnswerView => UNANSWERED);
        if (!live) return;
        if ("failure" in answer) {
          setHeld((was) => (heldFor(was, account, workspaceId) ? { ...was, failed: true } : was));
          return;
        }
        after = answer.cursor;
        // A write this read was asked after is in it, so only the ones written since are laid over it, and the rest let go.
        for (const [id, each] of written.current) {
          if (each.generation <= asked) written.current.delete(id);
        }
        const since = [...written.current.values()].flatMap((each) =>
          each.account === account && each.workspaceId === workspaceId ? [each.channel] : [],
        );
        setHeld((was) =>
          heldFor(was, account, workspaceId)
            ? { ...was, chat: withRead(was.chat, answer, since) }
            : was,
        );
      }
    };
    void loop();
    return () => {
      live = false;
    };
    // Note that the account is a dependency, so another account's read starts over rather than landing in its chat.
  }, [looping, account, workspaceId, attempt]);

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
      if ("channel" in answer) {
        channelWrites.current += 1;
        written.current.set(answer.channel.id, {
          channel: answer.channel,
          account,
          workspaceId,
          generation: channelWrites.current,
        });
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

  // While a channel is shown, the developer has read it to the newest message it holds: told once per place, of that channel alone.
  const newest = reading === undefined ? 0 : newestSeqIn(held.chat, reading);
  const readSeq = reading === undefined ? 0 : readSeqIn(held.chat, reading);
  const told = useRef<{
    readonly account: string | undefined;
    readonly workspaceId: string | undefined;
    readonly channelId: string | undefined;
    readonly seq: number;
  }>({ account, workspaceId, channelId: undefined, seq: 0 });
  useEffect(() => {
    if (reading === undefined) return;
    // Note that a read is the account's own, so what another account told says nothing of this one's.
    const same =
      told.current.account === account &&
      told.current.workspaceId === workspaceId &&
      told.current.channelId === reading;
    const already = same ? told.current.seq : 0;
    if (newest <= readSeq || newest <= already) return;
    const telling = { account, workspaceId, channelId: reading, seq: newest };
    told.current = telling;
    // A read that did not land is forgotten, so the channel shown again tells it again.
    void write({ readTo: newest, channelId: reading }).then((landed) => {
      if ("refused" in landed && told.current === telling) told.current = { ...telling, seq: 0 };
    });
  }, [reading, newest, readSeq, account, workspaceId, write]);

  return {
    chat: held.chat,
    failed: held.failed,
    onRetry,
    onPost,
    onAnswer,
    onChannel,
    readPicture,
  };
}

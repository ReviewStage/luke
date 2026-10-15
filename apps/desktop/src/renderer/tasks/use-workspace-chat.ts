import {
  CHAT_CURSOR_START,
  type ChatAnswer,
  type ChatMessage,
  type ChatWriteAnswer,
  type ChatWriteRequest,
} from "@luke/features/chat-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentChatAnswerView,
  type CodingAgentChatParams,
  type CodingAgentChatPostParams,
  type CodingAgentChatWriteAnswerView,
} from "@luke/features/coding-agent-view";
import type { ChatAskAnswer, ChatPost } from "@luke/ui/chat-model";
import { useCallback, useEffect, useRef, useState } from "react";
import { messageFailureWords } from "./coding-agent-model";

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
 */

/** How one read is asked: the workspace and the cursor to read past, answered as the view hears it. */
export type ChatReader = (params: CodingAgentChatParams) => Promise<CodingAgentChatAnswerView>;

/** How one write is sent: the workspace and the write, answered as the view hears it. */
export type ChatWriter = (
  params: CodingAgentChatPostParams,
) => Promise<CodingAgentChatWriteAnswerView>;

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
}

/** What a card says when its answer was not taken. */
export const CHAT_NOT_TAKEN =
  "The ask changed before your answer landed. Answer it as it stands now.";

interface Held {
  readonly workspaceId: string | undefined;
  readonly chat: ChatAnswer | undefined;
  readonly failed: boolean;
}

function fresh(workspaceId: string | undefined): Held {
  return { workspaceId, chat: undefined, failed: false };
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

/** The chat held with a read's answer taken in: the roster and channels whole, the messages by id. */
function withRead(chat: ChatAnswer | undefined, answer: ChatAnswer): ChatAnswer {
  return { ...answer, messages: withMessages(chat?.messages ?? [], answer.messages) };
}

/** The chat held with a write's answer taken in: the message it names in place, or the cursor where it moved. */
function withWrite(chat: ChatAnswer, answer: ChatWriteAnswer): ChatAnswer {
  if ("readSeq" in answer) return { ...chat, readSeq: Math.max(chat.readSeq, answer.readSeq) };
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

/** The newest message held, by its place; none in an empty chat. */
function newestSeq(chat: ChatAnswer | undefined): number {
  return chat?.messages.at(-1)?.seq ?? 0;
}

export function useWorkspaceChat(input: {
  workspaceId: string | undefined;
  /** Whether the chat is read at all: a live run, signed in. */
  active: boolean;
  /** Whether a channel of Chat is on screen, so what it holds has been read. */
  reading: boolean;
  readChat: ChatReader;
  writeChat: ChatWriter;
}): WorkspaceChatControl {
  const { workspaceId, active, reading } = input;
  const [held, setHeld] = useState<Held>(() => fresh(workspaceId));
  if (held.workspaceId !== workspaceId) setHeld(fresh(workspaceId));
  const [attempt, setAttempt] = useState(0);
  // A send's key and words, by what it sends, so the same send again goes under the same key.
  const keys = useRef(new Map<string, string>());
  const latest = useRef(input);
  latest.current = input;

  const looping = active && workspaceId !== undefined && !held.failed;
  useEffect(() => {
    if (!looping || workspaceId === undefined) return;
    let live = true;
    const loop = async () => {
      let after = CHAT_CURSOR_START;
      while (live) {
        const answer = await latest.current
          .readChat({ workspaceId, after })
          .catch((): CodingAgentChatAnswerView => UNANSWERED);
        if (!live) return;
        if ("failure" in answer) {
          setHeld((was) => (was.workspaceId === workspaceId ? { ...was, failed: true } : was));
          return;
        }
        after = answer.cursor;
        setHeld((was) =>
          was.workspaceId === workspaceId ? { ...was, chat: withRead(was.chat, answer) } : was,
        );
      }
    };
    void loop();
    return () => {
      live = false;
    };
  }, [looping, workspaceId, attempt]);

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
      setHeld((was) =>
        was.workspaceId === workspaceId && was.chat !== undefined
          ? { ...was, chat: withWrite(was.chat, answer) }
          : was,
      );
      return { answer };
    },
    [workspaceId],
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

  // While a channel is shown, the developer has read to the newest message held: told once per place.
  const newest = newestSeq(held.chat);
  const readSeq = held.chat?.readSeq ?? 0;
  const told = useRef<{ readonly workspaceId: string | undefined; readonly seq: number }>({
    workspaceId,
    seq: 0,
  });
  useEffect(() => {
    const already = told.current.workspaceId === workspaceId ? told.current.seq : 0;
    if (!reading || newest <= readSeq || newest <= already) return;
    told.current = { workspaceId, seq: newest };
    void write({ readTo: newest });
  }, [reading, newest, readSeq, workspaceId, write]);

  return { chat: held.chat, failed: held.failed, onRetry, onPost, onAnswer };
}

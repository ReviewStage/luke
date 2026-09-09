import {
  ACTION_RESULT_STATUS,
  type ActionResult,
  isActionResult,
  isRecord,
  isWireString,
  UNKNOWN_ACTION_STATUS,
  type UnknownActionResult,
  type UnparsedWireValue,
} from "@sidecar/wire";

/**
 * What became of a write the user asked for. Every adapter capability answers
 * with the same three: accepted, rejected with a reason the user can act on,
 * or unsupported — the adapter has no documented way to do this, which is an
 * answer rather than a failure. One status set, because two identical triples
 * would be an API break the moment they diverged.
 */
export type ProviderActionResult = ActionResult;

/**
 * What became of a control. Providers must report unsupported or rejected
 * controls explicitly; the core deliberately provides no fallback path such
 * as terminal input injection.
 */
export type ProviderControlResult = ProviderActionResult;

/**
 * What became of a send. A rejection carries a reason the user can act on,
 * never the message itself; unsupported means the adapter has no documented
 * way to message this session, which is an answer rather than a failure.
 */
export type ProviderMessageResult = ProviderActionResult;

export type ProviderTranscriptResult =
  | { status: typeof ACTION_RESULT_STATUS.ACCEPTED; transcript: string }
  | { status: typeof ACTION_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof ACTION_RESULT_STATUS.UNSUPPORTED; reason: string };

/**
 * One incremental transcript reading: the lines gained since the cursor the
 * caller held, the cursor to continue from, and whether the read fell short
 * of everything gained. An empty `text` is an honest "nothing new". The
 * cursor is absent only when the provider handed back no position to resume
 * from, so the next read begins as this one did.
 */
export interface ProviderTranscriptSinceReading {
  text: string;
  cursor?: string;
  truncated: boolean;
}

export type ProviderTranscriptSinceResult =
  | ({ status: typeof ACTION_RESULT_STATUS.ACCEPTED } & ProviderTranscriptSinceReading)
  | { status: typeof ACTION_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof ACTION_RESULT_STATUS.UNSUPPORTED; reason: string };

/**
 * Who wrote one message of a conversation reading. Only the two voices a chat
 * screen draws exist here: the developer's own sends and the agent's own
 * words. Everything else a provider stores beside them — tool calls, tool
 * output, lifecycle events, harness chatter — has no author a bubble can
 * honestly wear, so it never becomes a `ProviderConversationMessage` at all.
 */
export const CONVERSATION_MESSAGE_AUTHOR = {
  USER: "user",
  AGENT: "agent",
} as const;

export type ConversationMessageAuthor =
  (typeof CONVERSATION_MESSAGE_AUTHOR)[keyof typeof CONVERSATION_MESSAGE_AUTHOR];

/**
 * One attributed message of an observed session's conversation, exactly as
 * the provider stored it: the words are never truncated — a cut message says
 * something its author did not — and the bounds live on the page instead.
 */
export interface ProviderConversationMessage {
  /** The provider's own id for this message. */
  id: string;
  author: ConversationMessageAuthor;
  text: string;
  /** Unix ms the provider recorded the message at, when it reported one. */
  receivedAt?: number;
}

/**
 * What a conversation read answered with: one bounded page of attributed
 * messages and the positions to continue from. `lastMessageId` names the
 * newest stored message the page consumed — attributed or not — so a poll
 * resumes where this read stopped; it is absent on an older-history page,
 * which must never move the poll cursor backward. `firstOffset` names the
 * stored offset the page began at and `hasOlder` whether history stands
 * before it, so a scroll to the top can keep reading; both are absent on a
 * poll, which never looks backward. `hasMore` says newer messages remain
 * beyond a bounded poll page.
 */
export type ProviderConversationResult =
  | {
      status: typeof ACTION_RESULT_STATUS.ACCEPTED;
      messages: readonly ProviderConversationMessage[];
      lastMessageId?: string;
      hasMore: boolean;
      firstOffset?: number;
      hasOlder?: boolean;
    }
  | { status: typeof ACTION_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof ACTION_RESULT_STATUS.UNSUPPORTED; reason: string };

export async function providerTranscriptResult(
  rendering: Promise<string | undefined>,
): Promise<ProviderTranscriptResult> {
  const transcript = await rendering;
  return transcript
    ? { status: ACTION_RESULT_STATUS.ACCEPTED, transcript }
    : {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "That session's transcript could not be found.",
      };
}

export async function providerTranscriptSinceResult(
  reading: Promise<ProviderTranscriptSinceReading | undefined>,
): Promise<ProviderTranscriptSinceResult> {
  const read = await reading;
  return read
    ? { status: ACTION_RESULT_STATUS.ACCEPTED, ...read }
    : {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "That session's transcript could not be found.",
      };
}

/**
 * What became of a creation ask — the same three answers a message gets, for
 * the same reasons: a rejection carries a reason the user can act on, and
 * unsupported means the provider documents no way to create one here. An
 * acceptance may also carry the id of the session the creation response
 * named — an identifier only, never an address — so the surface can open the
 * new workspace once an observation pass reports it under that id. A provider
 * whose response names no session simply omits it, and the workspace stands
 * unopened rather than guessed at.
 */
export type ProviderWorkspaceResult =
  | {
      status: typeof ACTION_RESULT_STATUS.ACCEPTED;
      /** The created session's id, exactly as the provider's response named it. */
      providerSessionId?: string;
      /** Creation landed, but a non-essential follow-up such as opening failed. */
      warning?: string;
    }
  | { status: typeof ACTION_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof ACTION_RESULT_STATUS.UNSUPPORTED; reason: string }
  /** The create was handed to the machine and its answer lost: it may have happened, so it is never retried. */
  | UnknownActionResult;

/**
 * What became of a request to open a session. Opening is a local action — the
 * session's address is handed to the operating system, never to a provider —
 * so the answer is the app's own: opened, refused by the system, or
 * unsupported because the session never reported an address. A pressed row
 * ignores the answer; a spoken ask says it aloud, and grounding that sentence
 * is why this is answered at all.
 */
export type SessionOpenResult = ActionResult | UnknownActionResult;

/**
 * What became of a write a session's own row asked for — a typed message or
 * an advertised control — as it travels back to the row that asked: the
 * provider's three answers, or unknown where the write was handed on and its
 * answer lost, which the row must neither call failed nor repeat.
 */
export type SessionWriteResult = ActionResult | UnknownActionResult;

export function isSessionWriteResult(value: UnparsedWireValue): value is SessionWriteResult {
  if (isActionResult(value)) return true;
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    value.status === UNKNOWN_ACTION_STATUS &&
    isWireString(value.reason)
  );
}

/**
 * Thrown by an open port when the address was handed to the process that
 * opens it and that process went away before answering: the system may have
 * opened it. An adapter that creates through a deep link reads this as an
 * unknown outcome, never a refusal, so the journal can neither call the
 * create failed nor repeat it.
 */
export class ExternalOpenAnswerLostError extends Error {}

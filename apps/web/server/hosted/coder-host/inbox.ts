import {
  INBOX_ANSWER_LEAD,
  INBOX_BOUNDS,
  INBOX_KIND,
  INBOX_STATUS,
  INBOX_TOOL,
  type InboxItem,
  type InboxReply,
  inboxCloseInputSchema,
  inboxPostInputSchema,
  inboxReadInputSchema,
} from "@sidecar/hosted/inbox-wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Option, Result } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { ACTION_RESULT_STATUS, EXCESS_KEYS, type UnparsedWireValue } from "../../core.js";
import {
  agentInboxItems,
  closeInboxItem,
  INBOX_POST_REFUSAL,
  type InboxAgent,
  type InboxPostRefusal,
  postInboxItem,
} from "../inbox-store.js";
import { logStoreFailure } from "../store-failure.js";

/**
 * inbox.ts -- the coding agent's three inbox tools: post an item for the developer, close one, and read them all.
 *
 * What an agent cannot do or decide alone, a product choice, an approval
 * of a risky step, a question, or something only the developer can do by
 * hand such as a setting on GitHub, goes in the developer's inbox rather
 * than in a message, where it is lost in the transcript: an item of its own
 * on the service (`inbox-store.ts`), drawn on the plan's Inbox tab until the
 * developer answers it or the agent takes it back. The agent names each
 * item by a key of its own and keeps it current by posting under the same
 * key again, which never posts it twice. No call holds the turn, since a
 * coder session takes no input mid-turn
 * (`brain-host/eve-sessions.ts`'s `requestInput`): an answer the agent
 * needs to hear reaches it as one of the developer's messages, and one it
 * does not is kept for it to read. Every call answers with the agent's
 * whole inbox as it stands, answers and all, so the model holds its items
 * whatever its context has lost to compaction. A worker gets none of these
 * tools, because the developer answers the agent it works for.
 */

/** The tools as the model is shown them (`coder/tools/`): each one's name, words, and input. */
export const INBOX_TOOLS = {
  POST: {
    name: INBOX_TOOL.POST,
    description:
      "Put something you need from the developer in their inbox, apart from your transcript, where they answer it. " +
      "key is your own short lowercase slug for the item, such as branch-protection; posting under a key you used before " +
      "replaces that item and opens it again, so keep an item current under its key and never post it twice. " +
      "kind is choice (two to six options, each a short label and an optional detail, and name the label you recommend), " +
      "approval (a yes or no on one step you propose), question (an open answer), or task (something only the developer " +
      "can do by hand, such as changing a GitHub setting or adding a secret: say exactly what to do, with links, in details). " +
      "Put what they need to act in details as short Markdown. needsReply is whether you need to hear the answer as a message; " +
      "set it false for a task you only need done, and its answer is kept for you to read. " +
      `An answer you need reaches you as a developer's message whose first line starts "${INBOX_ANSWER_LEAD}" and names the key. ` +
      `You may hold at most ${INBOX_BOUNDS.MAX_OPEN_PER_AGENT} open items. The call answers with your whole inbox as it stands.`,
    inputSchema: inboxPostInputSchema,
  },
  CLOSE: {
    name: INBOX_TOOL.CLOSE,
    description:
      "Take an item of yours out of the developer's inbox, by its key, with why: you no longer need it, " +
      "you found the answer yourself, or you checked that the task is done. The call answers with your whole inbox as it stands.",
    inputSchema: inboxCloseInputSchema,
  },
  READ: {
    name: INBOX_TOOL.READ,
    description:
      "Read every item you have put in the developer's inbox as it stands now: what is still open, what they answered and how, " +
      "and what you closed. Read it before you rely on a task you posted without needsReply being done.",
    inputSchema: inboxReadInputSchema,
  },
} as const;

/** One item as the agent reads it back: its key, kind, title, where it stands, and the answer or the reason where there is one. */
interface AgentInboxLine {
  readonly key: string;
  readonly kind: InboxItem["kind"];
  readonly title: string;
  readonly status: InboxItem["status"];
  /** What an open item asks, as the agent posted it. */
  readonly details?: string;
  readonly options?: InboxItem["options"];
  readonly recommended?: string;
  readonly needsReply?: boolean;
  readonly answer?: InboxReply;
  readonly closedReason?: string;
}

/** What a call answers, as the model reads it: the agent's inbox as it stands, or why the call did nothing beside it. */
export type InboxToolResult =
  | {
      readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED;
      readonly inbox: readonly AgentInboxLine[];
    }
  | {
      readonly status: typeof ACTION_RESULT_STATUS.REJECTED;
      readonly reason: string;
      readonly inbox?: readonly AgentInboxLine[];
    };

/** Why a call did nothing, in the words the model reads. */
export const INBOX_REFUSAL = {
  UNREADABLE_POST:
    "Not posted: the item does not read. key is a lowercase slug of letters, digits, dots, dashes, and underscores.",
  UNREADABLE_CLOSE: "Not closed: name the item's key and why you close it.",
  TOO_MANY: `Not posted: you hold ${INBOX_BOUNDS.MAX_OPEN_PER_AGENT} open items already. Close one you no longer need first.`,
  NO_ITEM: "Not closed: you have no item under that key.",
  NO_OPTIONS: "Not posted: a choice offers between two and six options.",
  UNKNOWN_RECOMMENDATION: "Not posted: recommended names no option's label.",
  NO_AGENT: "Not done: this conversation is no coding agent's.",
  UNAVAILABLE: "Not done: the service could not reach its store.",
} as const;

const readPost = readEither(inboxPostInputSchema, { excess: EXCESS_KEYS.DROP });
const readClose = readEither(inboxCloseInputSchema, { excess: EXCESS_KEYS.DROP });

/**
 * An item as the agent reads it back. Note that an open item carries what
 * it asks whole, its details, options, recommendation, and whether the
 * agent waits to hear back, because compaction may have taken the call
 * that posted it out of the model's context, and an open item is one the
 * agent still acts on; a settled one carries what came of it alone.
 */
function lineOf(item: InboxItem): AgentInboxLine {
  const asks =
    item.status === INBOX_STATUS.OPEN
      ? {
          ...(item.details === undefined ? undefined : { details: item.details }),
          ...(item.options === undefined ? undefined : { options: item.options }),
          ...(item.recommended === undefined ? undefined : { recommended: item.recommended }),
          needsReply: item.needsReply,
        }
      : undefined;
  return {
    key: item.key,
    kind: item.kind,
    title: item.title,
    status: item.status,
    ...asks,
    ...(item.answer === undefined ? undefined : { answer: item.answer }),
    ...(item.closedReason === undefined ? undefined : { closedReason: item.closedReason }),
  };
}

/**
 * The agent's inbox as it reads it: what is open first, then what was
 * answered, then what it closed, each the latest changed first. Note that
 * closed items are read last, because they are the agent's own decisions
 * and the open and answered ones are what it acts on.
 */
function inboxOf(items: readonly InboxItem[]): readonly AgentInboxLine[] {
  const order = [INBOX_STATUS.OPEN, INBOX_STATUS.ANSWERED, INBOX_STATUS.CLOSED];
  return order.flatMap((status) => items.filter((item) => item.status === status).map(lineOf));
}

/** The agent's inbox as the call answers it. */
function accepted(agent: InboxAgent): Effect.Effect<InboxToolResult, never, SqlClient.SqlClient> {
  return Effect.map(agentInboxItems(agent), (items) => ({
    status: ACTION_RESULT_STATUS.ACCEPTED,
    inbox: inboxOf(items),
  })).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

export function inboxRejected(reason: string): InboxToolResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** A post's own refusal, before the store is asked: a choice with too few options, or a recommendation naming none. */
function postRefusal(post: typeof inboxPostInputSchema.Type): string | undefined {
  if (post.kind !== INBOX_KIND.CHOICE) return undefined;
  const options = post.options ?? [];
  if (options.length < 2) return INBOX_REFUSAL.NO_OPTIONS;
  if (post.recommended !== undefined && !options.some((each) => each.label === post.recommended)) {
    return INBOX_REFUSAL.UNKNOWN_RECOMMENDATION;
  }
  return undefined;
}

/** What the store's refusal of a post reads as to the model. */
function storeRefusal(refusal: InboxPostRefusal): string {
  return refusal === INBOX_POST_REFUSAL.TOO_MANY_OPEN
    ? INBOX_REFUSAL.TOO_MANY
    : INBOX_REFUSAL.NO_AGENT;
}

/** Runs one post: the item written under its key and the agent's inbox answered, or why not. */
export function postToInbox(
  agent: InboxAgent,
  input: UnparsedWireValue,
): Effect.Effect<InboxToolResult, never, SqlClient.SqlClient> {
  const read = readPost(input);
  if (Result.isFailure(read)) return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_POST));
  const refused = postRefusal(read.success);
  if (refused !== undefined) return Effect.succeed(inboxRejected(refused));
  return Effect.flatMap(postInboxItem(agent, read.success), (posted) =>
    Result.isFailure(posted)
      ? Effect.succeed(inboxRejected(storeRefusal(posted.failure)))
      : accepted(agent),
  ).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

/** Runs one close: the item under the key closed with why and the agent's inbox answered, or why not. */
export function closeInInbox(
  agent: InboxAgent,
  input: UnparsedWireValue,
): Effect.Effect<InboxToolResult, never, SqlClient.SqlClient> {
  const read = readClose(input);
  if (Result.isFailure(read)) return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_CLOSE));
  return Effect.flatMap(closeInboxItem(agent, read.success.key, read.success.reason), (closed) =>
    Option.isNone(closed) ? Effect.succeed(inboxRejected(INBOX_REFUSAL.NO_ITEM)) : accepted(agent),
  ).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

/** Runs one read: the agent's inbox as it stands. */
export function readOwnInbox(
  agent: InboxAgent,
): Effect.Effect<InboxToolResult, never, SqlClient.SqlClient> {
  return accepted(agent);
}

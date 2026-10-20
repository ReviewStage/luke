import { posix } from "node:path";
import type { DatabaseServices } from "@luke/database/core/query";
import { inboxSandboxPicturePaths } from "@luke/features/inbox-attachment-link";
import {
  INBOX_ANSWER_LEAD,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BOUNDS,
  INBOX_CLOSE_LEAD,
  INBOX_FIELD,
  INBOX_MESSAGE_AUTHOR,
  INBOX_MESSAGE_LEAD,
  INBOX_STATUS,
  INBOX_TOOL,
  type InboxAnswers,
  type InboxAsk,
  type InboxField,
  type InboxItem,
  type InboxMessage,
  type InboxReadAsk,
  type InboxReply,
  type InboxThreadPostInput,
  inboxReadInputSchema,
  inboxThreadPostInputSchema,
  inboxWithdrawInputSchema,
} from "@luke/features/inbox-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result } from "effect";
import { ACTION_RESULT_STATUS, EXCESS_KEYS, type UnparsedWireValue } from "../../core.js";
import { logStoreFailure } from "../../http/store-failure.js";
import {
  agentInboxItems,
  closeInboxItem,
  INBOX_POST_REFUSAL,
  type InboxAgent,
  type InboxBodyPicture,
  type InboxPostRefusal,
  postInboxThread,
} from "../../inbox/inbox-store.js";
import { CODER } from "./bounds.js";
import { type InboxSandboxDoor, readSandboxImage, type SandboxImageTerms } from "./inbox-image.js";

/**
 * inbox.ts -- the coding agent's three inbox tools: post a message on a thread of the developer's inbox, withdraw a thread's open ask, and read every thread back.
 *
 * What an agent cannot do or decide alone, a product choice, an approval
 * of a risky step, a question, or something only the developer can do by
 * hand such as a setting on GitHub, and whatever is ready for the developer
 * to look at, review, or test by hand, such as a pull request, goes in the
 * inbox rather than in a message, where it is lost in the transcript: a
 * thread of its own on the service (`inbox-store.ts`), drawn on the task's
 * Inbox tab. The agent names each thread by a key of its own. A post is one
 * message on it, one Markdown body with its chips, its cards, and its
 * pictures where they belong, which may end with an ask, `decide`, `do`, or
 * `answer` (`@luke/features/inbox-wire`); the first post under a key opens
 * the thread and names its title, and a later one adds a message, its ask
 * replacing the one open. A picture is drawn in the body by the path of
 * its file in the agent's sandbox, a screenshot of what it rendered, which
 * a post reads there first (`inbox-image.ts`) and the store keeps as a file
 * of the message, writing its address in the path's place; a file that is
 * not there, not an image, or past the bound refuses the whole post with
 * the path named. A post that asks nothing is a note, or the agent's reply
 * on the thread, since replying never answers: a member's message on the
 * thread reaches the agent as one of the developer's messages, and so does
 * an answer it waits on. No call holds the turn, since a coder session
 * takes no input mid-turn (`brain-host/eve-sessions.ts`'s `requestInput`).
 * Every call answers with the agent's whole inbox as it stands, each
 * thread's messages in order with their asks and answers, so the model
 * holds its threads whatever its context has lost to compaction. A worker
 * gets none of these tools, because the developer answers the agent it
 * works for.
 */

/** The inbox's picture bound in megabytes, as the words the model reads say it. */
const MAX_PICTURE_MB = (INBOX_BOUNDS.MAX_IMAGE_BYTES / 1_000_000).toFixed(1);

/** The tools as the model is shown them (`apps/dev/tools/`): each one's name, words, and input. */
export const INBOX_TOOLS = {
  POST: {
    name: INBOX_TOOL.POST,
    description:
      "Put something in the developer's inbox, apart from your transcript: something you need from them, or something ready for them to look at or review, " +
      "such as a pull request you opened or a page you showed. Each post is one message on a thread under key, your own short lowercase slug such as branch-protection. " +
      "The first post under a key opens its thread and must name its title; a later post under the same key adds a message to that thread, never a second one, " +
      "and a title it names renames the thread only where the post asks. " +
      `body is the message, one Markdown body of at most ${INBOX_BOUNDS.MAX_MESSAGE_CHARS} characters. ` +
      "Write a file, a pull request, or an issue in it as a mention, such as [@store.ts](https://github.com/<owner>/<name>/blob/HEAD/<path>), so Luke draws it as a chip. " +
      "Put a link alone on its own line to show it as a card: a pull request, an issue, a page such as the GitHub settings page a to-do is done on, " +
      "or the exact lines a decision is about, as a blob link into your repository at the full 40-character commit you read them at, one already on GitHub, " +
      `ending #L<start>-L<end>, at most ${INBOX_BOUNDS.MAX_CODE_LINES} lines, which they see as GitHub holds them at that commit. ` +
      `Draw a picture where it belongs, such as a screenshot of a UI you rendered, as ![alt](<path> "caption"): path is the file's path in your sandbox, ` +
      `relative to the checkout or absolute, a PNG, JPEG, or WebP of at most ${MAX_PICTURE_MB} MB, at most ${INBOX_BOUNDS.MAX_MESSAGE_PICTURES} a message; ` +
      "alt says in a sentence what it shows, and pictures written next to each other stand side by side. " +
      "ask is what the message asks of them, which ends it: " +
      `decide (two to ${INBOX_BOUNDS.MAX_OPTIONS} options, each a short label and an optional detail; name the label you recommend; multiple lets them pick several; ` +
      "for a go-ahead on one step you propose, two short options such as Approve and Request changes), " +
      "do (a to-do: something only they can do by hand, such as changing a GitHub setting, adding a secret, or testing by hand what you could not test yourself; " +
      `its steps, at most ${INBOX_BOUNDS.MAX_STEPS}, say exactly what to do, and they tick each before they mark it done, or say they couldn't), ` +
      `or answer (one to ${INBOX_BOUNDS.MAX_FIELDS} typed fields, text, number, select with its options, or boolean, each named by its label and required where it must be filled; ` +
      "or no fields for an answer in their own words); never ask for a credential or a secret in a form, since the answer reaches your transcript: " +
      "that is a do the developer does by hand. A post without ask asks nothing: something they should only know, or your reply on the thread. " +
      "A thread holds one open ask, and a newer ask replaces it. " +
      "waits is whether you need to hear the answer as a message: decide and answer wait unless you set it false, and do waits only where you set it true. " +
      "An answer you do not wait for is kept for you to read, though one carrying their words or a file still reaches you as a message. " +
      `An answer reaches you as a developer's message whose first line starts "${INBOX_ANSWER_LEAD}" and names the key. ` +
      `Replying never answers: a member may write on a thread at any point, which reaches you as a developer's message whose first line starts "${INBOX_MESSAGE_LEAD}" and names the key; ` +
      "answer it, or follow up after an answer, with a post under the key that asks nothing unless what you need changed. " +
      `You may hold at most ${INBOX_BOUNDS.MAX_OPEN_PER_AGENT} open asks. The call answers with your whole inbox as it stands.`,
    inputSchema: inboxThreadPostInputSchema,
  },
  WITHDRAW: {
    name: INBOX_TOOL.WITHDRAW,
    description:
      "Withdraw the open ask of one of your threads, by its key, with why: you no longer need it, you found the answer yourself, " +
      "or you checked that the to-do is done. The thread and its messages stay; refused where it holds no open ask, such as one already answered. " +
      "The call answers with your whole inbox as it stands.",
    inputSchema: inboxWithdrawInputSchema,
  },
  READ: {
    name: INBOX_TOOL.READ,
    description:
      "Read your threads in the developer's inbox as they stand now: every one still asking, whole, and the latest settled ones by their last messages. " +
      "Each message reads in order with who wrote it, you or a member by name, the ask it ends with and where that stands " +
      "(open, answered, replaced by a newer ask, or withdrawn, with your reason), and the answer a member's message carries. " +
      "A member may close a thread without answering, which withdraws its ask with no reason, and closedBy names them; " +
      `where you waited on it, that reaches you as a developer's message whose first line starts "${INBOX_CLOSE_LEAD}" and names the key: ` +
      "take it as their not wanting what the ask asked. Read it before you rely on a do you posted without waits being done.",
    inputSchema: inboxReadInputSchema,
  },
} as const;

/** An ask as the agent reads it back: whole while it is open, since the agent still acts on it, and its type and where it stands once settled. */
type AgentAskLine = InboxReadAsk | Pick<InboxReadAsk, "type" | "status" | "withdrawnReason">;

/** One message of a thread as the agent reads it back: who wrote it, you or a member by name, its words, its files by name, its ask, and the answer it carries. */
interface AgentThreadLine {
  readonly from: string;
  readonly text: string;
  readonly files?: readonly string[];
  readonly ask?: AgentAskLine;
  readonly answers?: Omit<InboxAnswers, "ask">;
}

/** One thread as the agent reads it back: its key, title, where it stands, whether the agent waits on its open ask, and its messages in order. */
interface AgentInboxLine {
  readonly key: string;
  readonly title: string;
  readonly status: InboxItem["status"];
  /** Whether an answer to the open ask reaches the agent as a message, on a thread still asking. */
  readonly waits?: boolean;
  /** How many earlier messages a settled thread's read leaves out. */
  readonly earlier?: number;
  readonly thread: readonly AgentThreadLine[];
  /** The member who closed the thread without answering, by name: a former member's where their account is gone. */
  readonly closedBy?: string;
  /** What an item from before threads asks while open, which no message of its carries. */
  readonly blocks?: InboxItem["blocks"];
  readonly response?: InboxItem["response"];
  /** How an item from before threads was answered, and the names of the files the answer carried. */
  readonly answer?: InboxReply;
  readonly answerFiles?: readonly string[];
  /** Why an item from before threads was closed. */
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
    "Not posted: the post does not read. key is a lowercase slug of letters, digits, dots, dashes, and underscores; " +
    `body is Markdown of at most ${INBOX_BOUNDS.MAX_MESSAGE_CHARS} characters; title is one line of at most ${INBOX_BOUNDS.MAX_TITLE_CHARS}; ` +
    `ask is decide with two to ${INBOX_BOUNDS.MAX_OPTIONS} options, do with at most ${INBOX_BOUNDS.MAX_STEPS} steps, ` +
    `or answer with one to ${INBOX_BOUNDS.MAX_FIELDS} fields or none.`,
  NO_TITLE:
    "Not posted: you have no thread under that key, and the first post under a key names its title.",
  TOO_MANY: `Not posted: you hold ${INBOX_BOUNDS.MAX_OPEN_PER_AGENT} open asks already. Withdraw one you no longer need first.`,
  TOO_MANY_PICTURES: `Not posted: a message draws at most ${INBOX_BOUNDS.MAX_MESSAGE_PICTURES} pictures from your sandbox.`,
  NO_OPTIONS: "Not posted: a decide's options each stand under a label of their own.",
  UNKNOWN_RECOMMENDATION: "Not posted: recommended names no option's label.",
  FIELD_LABELS: "Not posted: an answer names each field by a label of its own.",
  SELECT_OPTIONS:
    "Not posted: a select field offers its options, each once, and no other field offers options.",
  UNREADABLE_WITHDRAW: "Not withdrawn: name the thread's key and why you withdraw its ask.",
  NO_OPEN_ASK: "Not withdrawn: you have no thread under that key with an open ask.",
  NO_AGENT: "Not done: this conversation is no coding agent's.",
  UNAVAILABLE: "Not done: the service could not reach its store.",
} as const;

/** How many of a settled thread's latest messages its read carries: enough to see what came of it. */
const SETTLED_MESSAGES_TOLD = 3;

const readPost = readEither(inboxThreadPostInputSchema, { excess: EXCESS_KEYS.DROP });
const readWithdraw = readEither(inboxWithdrawInputSchema, { excess: EXCESS_KEYS.DROP });

/** How a post's picture is read from the sandbox: held to the inbox's picture bound, and refused in a post's own words. */
const PICTURE_TERMS: SandboxImageTerms = {
  maxBytes: INBOX_BOUNDS.MAX_IMAGE_BYTES,
  refusals: {
    NO_FILE: "Not posted: a picture names no file in your sandbox:",
    NOT_IMAGE: "Not posted: a picture names a file that is not a PNG, JPEG, or WebP image:",
    TOO_LARGE: `Not posted: a picture names a file larger than ${MAX_PICTURE_MB} MB; render it smaller, or at one screen scale:`,
    UNREADABLE: "Not posted: a picture's file could not be read from your sandbox:",
  },
};

/** Who wrote a message, as the agent reads it: itself, or the member by name, or a former member whose account is gone. */
function writerOf(message: InboxMessage): string {
  if (message.author === INBOX_MESSAGE_AUTHOR.AGENT) return "you";
  return message.member?.name ?? "a former member";
}

/** An ask as the agent reads it back: whole while open, and its type and standing, with why it was withdrawn, once settled. */
function askLineOf(ask: InboxReadAsk): AgentAskLine {
  if (ask.status === INBOX_ASK_STATUS.OPEN) return ask;
  return {
    type: ask.type,
    status: ask.status,
    ...(ask.withdrawnReason === undefined ? undefined : { withdrawnReason: ask.withdrawnReason }),
  };
}

/** An answer as the agent reads it back: how the member answered, without the id of the message it answers, which is the ask before it. */
function answersLineOf(answers: InboxAnswers): Omit<InboxAnswers, "ask"> {
  const { ask: _ask, ...answered } = answers;
  return answered;
}

/** One message of a thread as the agent reads it back, its files by name, since a member's reached it with their message and its own it sent. */
function threadLineOf(message: InboxMessage): AgentThreadLine {
  return {
    from: writerOf(message),
    text: message.text,
    ...(message.files === undefined
      ? undefined
      : { files: message.files.map((file) => file.name) }),
    ...(message.ask === undefined ? undefined : { ask: askLineOf(message.ask) }),
    ...(message.answers === undefined ? undefined : { answers: answersLineOf(message.answers) }),
  };
}

/**
 * Who closed an item without answering it, as the agent reads it: the
 * member by name. Note that the agent's own withdrawal always says why, so
 * a closed item without a reason or a member is one a member closed whose
 * account is gone.
 */
function closerOf(item: InboxItem): Pick<AgentInboxLine, "closedBy"> {
  if (item.status !== INBOX_STATUS.CLOSED) return {};
  if (item.closedBy !== undefined) return { closedBy: item.closedBy.name };
  return item.closedReason === undefined ? { closedBy: "a former member" } : {};
}

/**
 * What an item from before threads carries on itself rather than on a
 * message: what it asks while open, how it was answered, and why it was
 * closed. Note that an item posted since carries each on its messages, so
 * none is repeated where a message asks or answers.
 */
function legacyOf(item: InboxItem, messages: readonly InboxMessage[]): Partial<AgentInboxLine> {
  if (messages.some((message) => message.ask !== undefined || message.answers !== undefined)) {
    return {};
  }
  return {
    ...(item.status === INBOX_STATUS.OPEN ? { blocks: item.blocks, response: item.response } : {}),
    ...(item.answer === undefined ? undefined : { answer: item.answer }),
    ...(item.answerFiles === undefined
      ? undefined
      : { answerFiles: item.answerFiles.map((file) => file.name) }),
    ...(item.closedReason === undefined ? undefined : { closedReason: item.closedReason }),
  };
}

/**
 * A thread as the agent reads it back. Note that one still asking carries
 * its messages whole, as the read holds them, because compaction may have
 * taken the call that posted its ask out of the model's context and the
 * agent still acts on it; a settled one carries its latest few, which say
 * what came of it, and how many it leaves out.
 */
function lineOf(item: InboxItem): AgentInboxLine {
  const messages = item.thread ?? item.messages ?? [];
  const open = item.status === INBOX_STATUS.OPEN;
  const told = open ? messages : messages.slice(-SETTLED_MESSAGES_TOLD);
  const earlier = messages.length - told.length;
  return {
    key: item.key,
    title: item.title,
    status: item.status,
    ...(open ? { waits: item.needsReply } : undefined),
    ...(earlier > 0 ? { earlier } : undefined),
    thread: told.map(threadLineOf),
    ...closerOf(item),
    ...legacyOf(item, messages),
  };
}

/**
 * The agent's inbox as it reads it: what is open first, then what was
 * answered, then what was closed, each the latest changed first. Note that
 * closed threads are read last, because they are settled without an answer
 * and the open and answered ones are what it acts on.
 */
function inboxOf(items: readonly InboxItem[]): readonly AgentInboxLine[] {
  const order = [INBOX_STATUS.OPEN, INBOX_STATUS.ANSWERED, INBOX_STATUS.CLOSED];
  return order.flatMap((status) => items.filter((item) => item.status === status).map(lineOf));
}

/** The agent's inbox as the call answers it. */
function accepted(agent: InboxAgent): Effect.Effect<InboxToolResult, never, DatabaseServices> {
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

/** Whether every label stands once. */
function distinct(labels: readonly string[]): boolean {
  return new Set(labels).size === labels.length;
}

/** An answer's fields' own refusal: a label used twice, a select with no options or one twice, or options on a field that takes none. */
function fieldsRefusal(fields: readonly InboxField[]): string | undefined {
  if (!distinct(fields.map((field) => field.label))) return INBOX_REFUSAL.FIELD_LABELS;
  for (const field of fields) {
    const options = field.options;
    const select = field.type === INBOX_FIELD.SELECT;
    if (select ? options === undefined || !distinct(options) : options !== undefined) {
      return INBOX_REFUSAL.SELECT_OPTIONS;
    }
  }
  return undefined;
}

/** An ask's own refusal, before the store is asked: a decide's label used twice or a recommendation naming none, or an answer's fields. */
function askRefusal(ask: InboxAsk | undefined): string | undefined {
  switch (ask?.type) {
    case INBOX_ASK.DECIDE: {
      const labels = ask.options.map((option) => option.label);
      if (!distinct(labels)) return INBOX_REFUSAL.NO_OPTIONS;
      if (ask.recommended !== undefined && !labels.includes(ask.recommended)) {
        return INBOX_REFUSAL.UNKNOWN_RECOMMENDATION;
      }
      return undefined;
    }
    case INBOX_ASK.ANSWER:
      return ask.fields === undefined ? undefined : fieldsRefusal(ask.fields);
    default:
      return undefined;
  }
}

/** What the store's refusal of a post reads as to the model. */
function storeRefusal(refusal: InboxPostRefusal): string {
  switch (refusal) {
    case INBOX_POST_REFUSAL.TOO_MANY_OPEN:
      return INBOX_REFUSAL.TOO_MANY;
    case INBOX_POST_REFUSAL.NO_TITLE:
      return INBOX_REFUSAL.NO_TITLE;
    case INBOX_POST_REFUSAL.NO_AGENT:
      return INBOX_REFUSAL.NO_AGENT;
  }
}

/**
 * Whether the agent hears the answer to an ask as a message where it does
 * not say: a decision or an answer it asked for, yes; a to-do, which it
 * mostly needs only done, no.
 */
function waitsByDefault(ask: InboxAsk): boolean {
  return ask.type !== INBOX_ASK.DO;
}

/**
 * The pictures the body draws from the sandbox, each read there under the
 * path it is written by and named by its file's own name, or the first
 * refusal among them. Each path is read once, in the order first drawn,
 * and the first path refused ends the reading, so a post with a picture to
 * mend reads no further file for it.
 */
function bodyPictures(
  body: string,
  sandbox: InboxSandboxDoor,
): Effect.Effect<Result.Result<readonly InboxBodyPicture[], string>> {
  const paths = inboxSandboxPicturePaths(body);
  if (paths.length > INBOX_BOUNDS.MAX_MESSAGE_PICTURES) {
    return Effect.succeed(Result.fail(INBOX_REFUSAL.TOO_MANY_PICTURES));
  }
  return Effect.gen(function* () {
    const read: InboxBodyPicture[] = [];
    for (const path of paths) {
      const image = yield* readSandboxImage(sandbox, CODER.CHECKOUT_PATH, path, PICTURE_TERMS);
      if (Result.isFailure(image)) return Result.fail(image.failure);
      read.push({ ...image.success, path, name: posix.basename(path) || path });
    }
    return Result.succeed(read);
  });
}

/** The post as the store writes it: its key, title, words, and ask, and whether the agent waits on the answer, by the ask's default where it did not say. */
function threadPost(post: InboxThreadPostInput) {
  const { waits, ...written } = post;
  if (post.ask === undefined) return written;
  return { ...written, needsReply: waits ?? waitsByDefault(post.ask) };
}

/** Runs one post: its pictures read from the sandbox, the message written on the thread under its key, and the agent's inbox answered, or why not. */
export function postToInbox(
  agent: InboxAgent,
  input: UnparsedWireValue,
  sandbox: InboxSandboxDoor,
): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  const read = readPost(input);
  if (Result.isFailure(read)) return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_POST));
  const post = read.success;
  const refused = askRefusal(post.ask);
  if (refused !== undefined) return Effect.succeed(inboxRejected(refused));
  return Effect.flatMap(bodyPictures(post.body, sandbox), (pictures) => {
    if (Result.isFailure(pictures)) return Effect.succeed(inboxRejected(pictures.failure));
    return Effect.flatMap(postInboxThread(agent, threadPost(post), pictures.success), (posted) =>
      Result.isFailure(posted)
        ? Effect.succeed(inboxRejected(storeRefusal(posted.failure)))
        : accepted(agent),
    );
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

/** Runs one withdrawal: the open ask of the thread under the key withdrawn with why, and the agent's inbox answered, or why not. */
export function withdrawAsk(
  agent: InboxAgent,
  input: UnparsedWireValue,
): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  const read = readWithdraw(input);
  if (Result.isFailure(read)) {
    return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_WITHDRAW));
  }
  const { key, reason } = read.success;
  return Effect.flatMap(closeInboxItem(agent, key, reason), (withdrawn) =>
    Option.isNone(withdrawn)
      ? Effect.succeed(inboxRejected(INBOX_REFUSAL.NO_OPEN_ASK))
      : accepted(agent),
  ).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

/** Runs one read: the agent's inbox as it stands. */
export function readOwnInbox(
  agent: InboxAgent,
): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  return accepted(agent);
}

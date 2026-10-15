import type { DatabaseServices } from "@luke/database/core/query";
import {
  codeLinesReadable,
  INBOX_ANSWER_LEAD,
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_TOOL,
  type InboxChoice,
  type InboxForm,
  type InboxItem,
  type InboxPost,
  type InboxReply,
  inboxCloseInputSchema,
  inboxPostInputSchema,
  inboxReadInputSchema,
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
  type InboxImage,
  type InboxPostRefusal,
  postInboxItem,
} from "../../inbox/inbox-store.js";
import { CODER } from "./bounds.js";
import { type InboxSandboxDoor, readInboxImage } from "./inbox-image.js";

/**
 * inbox.ts -- the coding agent's three inbox tools: post an item for the developer, close one, and read them all.
 *
 * What an agent cannot do or decide alone, a product choice, an approval
 * of a risky step, a question, or something only the developer can do by
 * hand such as a setting on GitHub, goes in the developer's inbox rather
 * than in a message, where it is lost in the transcript: an item of its own
 * on the service (`inbox-store.ts`), drawn on the plan's Inbox tab until the
 * developer answers it or the agent takes it back. An item is a title, the
 * blocks of context under it, and the response it asks for, each a closed
 * shape the wire declares (`@luke/features/inbox-wire`). An image block
 * names a file in the agent's sandbox, a screenshot of what it rendered,
 * which a post reads there first (`inbox-image.ts`) and the store keeps as
 * an attachment of the item's; a file that is not there, not an image, or
 * past the bound refuses the whole post with the path named. The agent names
 * each item by a key of its own and keeps it current by posting under the
 * same key again, which never posts it twice. No call holds the turn, since
 * a coder session takes no input mid-turn
 * (`brain-host/eve-sessions.ts`'s `requestInput`): an answer the agent
 * needs to hear reaches it as one of the developer's messages, and so does
 * any carrying a note the developer typed; a bare press on one it does not
 * need is kept for it to read. Every call answers with the agent's
 * whole inbox as it stands, answers and all, so the model holds its items
 * whatever its context has lost to compaction. A worker gets none of these
 * tools, because the developer answers the agent it works for.
 */

/** The tools as the model is shown them (`apps/dev/tools/`): each one's name, words, and input. */
export const INBOX_TOOLS = {
  POST: {
    name: INBOX_TOOL.POST,
    description:
      "Put something you need from the developer in their inbox, apart from your transcript, where they answer it. " +
      "key is your own short lowercase slug for the item, such as branch-protection; posting under a key you used before " +
      "replaces that item and opens it again, so keep an item current under its key and never post it twice. " +
      "blocks is the context they need to act, in order: markdown blocks of short Markdown, a file, a pull request, or an " +
      "issue in it written as a Markdown link to its page, such as [store.ts](https://github.com/<owner>/<name>/blob/HEAD/<path>), " +
      "so Luke draws it as a chip; link blocks naming a page, " +
      "such as the GitHub settings page a to-do is done on, and code blocks pointing at the exact lines a decision is about: " +
      `repo is your repository as owner/name, path is from its root, startLine to endLine spans at most ${INBOX_BOUNDS.MAX_CODE_LINES} lines, ` +
      "and sha is the full 40-character commit you read them at, one already on GitHub; they see those lines as GitHub holds them at that commit; " +
      "and image blocks showing them a picture, such as a screenshot " +
      "of a UI you rendered: path is the file's path in your sandbox, relative to the checkout or absolute, a PNG, JPEG, " +
      `or WebP of at most ${(INBOX_BOUNDS.MAX_IMAGE_BYTES / 1_000_000).toFixed(1)} MB, and alt says in a sentence what it shows. ` +
      "response is what you ask of them: choice (two to six options, each a short label and an optional detail; name the " +
      "label you recommend; multiple lets them pick several), approval (a yes or no on one step you propose), text (an open " +
      "answer in their words), task (a to-do: something only they can do by hand, such as changing a GitHub setting or adding a secret: " +
      "say exactly what to do in the blocks), form (one to eight typed fields, text, number, select with its options, or " +
      "boolean, each named by its label and required where it must be filled; never ask for a credential or a secret in a " +
      "form, since the answer reaches your transcript: that is a to-do the developer does by hand), or none (something they " +
      "should know; they acknowledge it). needsReply is whether you need to hear the answer as a message; set it false for a to-do you only " +
      "need done or an item that asks nothing, and its answer is kept for you to read, though a note they type with it still reaches you as a message. " +
      `An answer you need reaches you as a developer's message whose first line starts "${INBOX_ANSWER_LEAD}" and names the key. ` +
      `You may hold at most ${INBOX_BOUNDS.MAX_OPEN_PER_AGENT} open items. The call answers with your whole inbox as it stands.`,
    inputSchema: inboxPostInputSchema,
  },
  CLOSE: {
    name: INBOX_TOOL.CLOSE,
    description:
      "Take an item of yours out of the developer's inbox, by its key, with why: you no longer need it, " +
      "you found the answer yourself, or you checked that the to-do is done. The call answers with your whole inbox as it stands.",
    inputSchema: inboxCloseInputSchema,
  },
  READ: {
    name: INBOX_TOOL.READ,
    description:
      "Read every item you have put in the developer's inbox as it stands now: what is still open, what they answered and how, " +
      "and what you closed. Read it before you rely on a to-do you posted without needsReply being done.",
    inputSchema: inboxReadInputSchema,
  },
} as const;

/** One item as the agent reads it back: its key, title, where it stands, what it asks while open, and the answer or the reason where there is one. */
interface AgentInboxLine {
  readonly key: string;
  readonly title: string;
  readonly status: InboxItem["status"];
  /** What an open item asks, as the agent posted it. */
  readonly blocks?: InboxItem["blocks"];
  readonly response?: InboxItem["response"];
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
    "Not posted: the item does not read. key is a lowercase slug of letters, digits, dots, dashes, and underscores; " +
    "blocks are markdown, link, code, or image, a code block's sha the full 40-character lowercase commit, an image naming its path and alt; " +
    "response is one of choice, approval, text, task, form, or none; " +
    `a choice and a select field offer between two and ${INBOX_BOUNDS.MAX_OPTIONS} options.`,
  UNREADABLE_CLOSE: "Not closed: name the item's key and why you close it.",
  TOO_MANY: `Not posted: you hold ${INBOX_BOUNDS.MAX_OPEN_PER_AGENT} open items already. Close one you no longer need first.`,
  NO_ITEM: "Not closed: you have no item under that key.",
  NO_OPTIONS: "Not posted: a choice's options each stand under a label of their own.",
  UNKNOWN_RECOMMENDATION: "Not posted: recommended names no option's label.",
  FIELD_LABELS: "Not posted: a form names each field by a label of its own.",
  SELECT_OPTIONS:
    "Not posted: a select field offers its options, each once, and no other field offers options.",
  CODE_REPOSITORY:
    "Not posted: a code block points at lines of your own repository, named as owner/name.",
  CODE_LINES: `Not posted: a code block's endLine is at or after its startLine, and it spans at most ${INBOX_BOUNDS.MAX_CODE_LINES} lines.`,
  NO_AGENT: "Not done: this conversation is no coding agent's.",
  UNAVAILABLE: "Not done: the service could not reach its store.",
} as const;

const readPost = readEither(inboxPostInputSchema, { excess: EXCESS_KEYS.DROP });
const readClose = readEither(inboxCloseInputSchema, { excess: EXCESS_KEYS.DROP });

/**
 * An item as the agent reads it back. Note that an open item carries what
 * it asks whole, its blocks, its response, and whether the agent waits to
 * hear back, because compaction may have taken the call that posted it out
 * of the model's context, and an open item is one the agent still acts on;
 * a settled one carries what came of it alone.
 */
function lineOf(item: InboxItem): AgentInboxLine {
  const asks =
    item.status === INBOX_STATUS.OPEN
      ? { blocks: item.blocks, response: item.response, needsReply: item.needsReply }
      : undefined;
  return {
    key: item.key,
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

/** A choice's own refusal: a label used twice, or a recommendation naming none. */
function choiceRefusal(choice: InboxChoice): string | undefined {
  const labels = choice.options.map((option) => option.label);
  if (!distinct(labels)) return INBOX_REFUSAL.NO_OPTIONS;
  if (choice.recommended !== undefined && !labels.includes(choice.recommended)) {
    return INBOX_REFUSAL.UNKNOWN_RECOMMENDATION;
  }
  return undefined;
}

/** A form's own refusal: a label used twice, a select with no options or one twice, or options on a field that takes none. */
function formRefusal(form: InboxForm): string | undefined {
  if (!distinct(form.fields.map((field) => field.label))) return INBOX_REFUSAL.FIELD_LABELS;
  for (const field of form.fields) {
    const select = field.type === INBOX_FIELD.SELECT;
    const options = field.options;
    if (select ? options === undefined || !distinct(options) : options !== undefined) {
      return INBOX_REFUSAL.SELECT_OPTIONS;
    }
  }
  return undefined;
}

/**
 * A code block's own refusal: lines of another repository than the agent's
 * own, which the desktop reads through the plan's repository alone, or a
 * range running backwards or past the bound. Note that GitHub spells a
 * repository's name in any case, so the names are compared without it.
 */
function codeRefusal(block: InboxPost["blocks"], repository: string): string | undefined {
  const own = repository.toLowerCase();
  for (const each of block ?? []) {
    if (each.type !== INBOX_BLOCK.CODE) continue;
    if (each.repo.toLowerCase() !== own) return INBOX_REFUSAL.CODE_REPOSITORY;
    if (!codeLinesReadable(each)) return INBOX_REFUSAL.CODE_LINES;
  }
  return undefined;
}

/** A post's own refusal, before the store is asked: what the blocks' and the response's shapes admit but the item cannot carry or ask. */
function postRefusal(post: InboxPost, repository: string): string | undefined {
  const blocks = codeRefusal(post.blocks, repository);
  if (blocks !== undefined) return blocks;
  switch (post.response.type) {
    case INBOX_RESPONSE.CHOICE:
      return choiceRefusal(post.response);
    case INBOX_RESPONSE.FORM:
      return formRefusal(post.response);
    default:
      return undefined;
  }
}

/** What the store's refusal of a post reads as to the model. */
function storeRefusal(refusal: InboxPostRefusal): string {
  return refusal === INBOX_POST_REFUSAL.TOO_MANY_OPEN
    ? INBOX_REFUSAL.TOO_MANY
    : INBOX_REFUSAL.NO_AGENT;
}

/** The agent a post is written for: its own, and the repository it works in as `owner/name`, which its code blocks must name. */
export interface PostingAgent extends InboxAgent {
  readonly repository: string;
}

/**
 * The post's pictures, one per image block in the blocks' order, read from
 * the sandbox, or the first refusal among them. Each distinct path is read
 * once, in the order first named, and the first path refused ends the
 * reading, so a post with a block to mend reads no further file for it.
 */
function postImages(
  post: InboxPost,
  sandbox: InboxSandboxDoor,
): Effect.Effect<Result.Result<readonly InboxImage[], string>> {
  const paths = (post.blocks ?? []).flatMap((block) =>
    block.type === INBOX_BLOCK.IMAGE ? [block.path] : [],
  );
  return Effect.gen(function* () {
    const read = new Map<string, InboxImage>();
    for (const path of paths) {
      if (read.has(path)) continue;
      const image = yield* readInboxImage(sandbox, CODER.CHECKOUT_PATH, path);
      if (Result.isFailure(image)) return Result.fail(image.failure);
      read.set(path, image.success);
    }
    // Every path was read above, so each lookup finds its picture.
    return Result.succeed(paths.flatMap((path) => read.get(path) ?? []));
  });
}

/** Runs one post: its pictures read from the sandbox, the item written under its key, and the agent's inbox answered, or why not. */
export function postToInbox(
  agent: PostingAgent,
  input: UnparsedWireValue,
  sandbox: InboxSandboxDoor,
): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  const read = readPost(input);
  if (Result.isFailure(read)) return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_POST));
  const { repository, ...owner } = agent;
  const refused = postRefusal(read.success, repository);
  if (refused !== undefined) return Effect.succeed(inboxRejected(refused));
  const post = read.success;
  return Effect.flatMap(postImages(post, sandbox), (images) => {
    if (Result.isFailure(images)) return Effect.succeed(inboxRejected(images.failure));
    return Effect.flatMap(postInboxItem(owner, post, images.success), (posted) =>
      Result.isFailure(posted)
        ? Effect.succeed(inboxRejected(storeRefusal(posted.failure)))
        : accepted(agent),
    );
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

/** Runs one close: the item under the key closed with why and the agent's inbox answered, or why not. */
export function closeInInbox(
  agent: InboxAgent,
  input: UnparsedWireValue,
): Effect.Effect<InboxToolResult, never, DatabaseServices> {
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
): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  return accepted(agent);
}

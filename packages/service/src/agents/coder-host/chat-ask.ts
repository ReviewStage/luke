import type { ChatImageWrite, ChatMessageRow } from "@luke/database/models/chat-store";
import { chatAttachmentId } from "@luke/database/models/ids";
import {
  ASK_STATUS,
  type AskStatus,
  CHAT_ASK,
  CHAT_BLOCK,
  CHAT_BOUNDS,
  CHAT_FIELD,
  type ChatBlock,
  type ChatChoice,
  type ChatForm,
  type ChatPostBlock,
  type ChatReadResponse,
  type ChatReply,
  type ChatResponse,
  codeLinesReadable,
  mentionedHandles,
  type postChatAskInputSchema,
} from "@luke/features/chat-wire";
import { Effect, Result } from "effect";
import { CODER } from "./bounds.js";
import { type InboxSandboxDoor, readInboxImage } from "./inbox-image.js";

/**
 * chat-ask.ts -- what an ask a coding agent posts in chat carries: its shape held to what it can ask, its pictures read from the sandbox, and how the agent reads its asks back.
 *
 * An ask is a chat message carrying what the Inbox's items asked: a
 * choice, an approval, words, a task, a form, or an acknowledgement,
 * under a key of the agent's, posted again under the key to keep it
 * current. What the wire's shapes admit but an ask cannot carry is
 * refused before the store is asked: a choice whose labels repeat or
 * whose recommendation names none, a form whose labels repeat or whose
 * options sit on a field that takes none, and lines of a repository other
 * than the agent's own. An image block names a file in the agent's
 * sandbox, read there (`inbox-image.ts`) and kept as an attachment of the
 * message's under an id named for the post and the path, so a post sent
 * again keeps the picture it kept. The agent reads its asks back whole
 * while open, since compaction may have taken the call that posted one
 * out of its context, and settled ones by what came of them alone.
 */

/** Why an ask was not posted, in the words the model reads. */
export const ASK_REFUSAL = {
  NO_OPTIONS: "Not posted: a choice's options each stand under a label of their own.",
  UNKNOWN_RECOMMENDATION: "Not posted: recommended names no option's label.",
  FIELD_LABELS: "Not posted: a form names each field by a label of its own.",
  SELECT_OPTIONS:
    "Not posted: a select field offers its options, each once, and no other field offers options.",
  CODE_REPOSITORY:
    "Not posted: a code block points at lines of your own repository, named as owner/name.",
  CODE_LINES: `Not posted: a code block's endLine is at or after its startLine, and it spans at most ${CHAT_BOUNDS.MAX_CODE_LINES} lines.`,
  ELSEWHERE:
    "Not posted: an ask stays where it was first posted. Post it again under its key in the same channel or thread, " +
    "or resolve it and ask under a new key.",
  NO_ASK: "Not resolved: you have no ask under that key.",
  TOO_MANY_BLOCKS: `Not posted: your words are the message's first block, so name at most ${CHAT_BOUNDS.MAX_BLOCKS - 1} blocks under them.`,
} as const;

/** A post that may carry an ask, as the wire reads it. */
type AskPost = typeof postChatAskInputSchema.Type;

/** One ask as the agent reads it back: its key and place, where it stands, what it asks while open, and what came of it. */
export interface AskLine {
  readonly key: string;
  readonly seq: number;
  readonly in: string;
  readonly status: AskStatus;
  readonly revision: number;
  readonly title?: string;
  readonly response?: ChatReadResponse;
  readonly needsReply?: boolean;
  readonly answer?: ChatReply;
  readonly answeredBy?: string;
  readonly closedReason?: string;
}

/** What a post's pictures came to: the blocks as the message keeps them, each image by its attachment, and the pictures to keep. */
export interface PostPictures {
  readonly blocks: readonly ChatBlock[];
  readonly images: readonly ChatImageWrite[];
}

/** Whether every label stands once. */
function distinct(labels: readonly string[]): boolean {
  return new Set(labels).size === labels.length;
}

/** A choice's own refusal: a label used twice, or a recommendation naming none. */
function choiceRefusal(choice: ChatChoice): string | undefined {
  const labels = choice.options.map((option) => option.label);
  if (!distinct(labels)) return ASK_REFUSAL.NO_OPTIONS;
  if (choice.recommended !== undefined && !labels.includes(choice.recommended)) {
    return ASK_REFUSAL.UNKNOWN_RECOMMENDATION;
  }
  return undefined;
}

/** A form's own refusal: a label used twice, a select with no options or one twice, or options on a field that takes none. */
function formRefusal(form: ChatForm): string | undefined {
  if (!distinct(form.fields.map((field) => field.label))) return ASK_REFUSAL.FIELD_LABELS;
  for (const field of form.fields) {
    const select = field.type === CHAT_FIELD.SELECT;
    const options = field.options;
    if (select ? options === undefined || !distinct(options) : options !== undefined) {
      return ASK_REFUSAL.SELECT_OPTIONS;
    }
  }
  return undefined;
}

/** A response's own refusal, by its type. */
function responseRefusal(response: ChatResponse): string | undefined {
  switch (response.type) {
    case CHAT_ASK.CHOICE:
      return choiceRefusal(response);
    case CHAT_ASK.FORM:
      return formRefusal(response);
    default:
      return undefined;
  }
}

/**
 * A code block's own refusal: lines of another repository than the agent's
 * own, which the desktop reads through the plan's repository alone, or a
 * range running backwards or past the bound. Note that GitHub spells a
 * repository's name in any case, so the names are compared without it.
 */
function codeRefusal(blocks: readonly ChatPostBlock[], repository: string): string | undefined {
  const own = repository.toLowerCase();
  for (const block of blocks) {
    if (block.type !== CHAT_BLOCK.CODE) continue;
    if (block.repo.toLowerCase() !== own) return ASK_REFUSAL.CODE_REPOSITORY;
    if (!codeLinesReadable(block)) return ASK_REFUSAL.CODE_LINES;
  }
  return undefined;
}

/** A post's own refusal, before the store is asked: what its blocks' and its ask's shapes admit but a message cannot carry or ask, its words among its blocks. */
export function askPostRefusal(post: AskPost, repository: string): string | undefined {
  if ((post.blocks?.length ?? 0) >= CHAT_BOUNDS.MAX_BLOCKS) return ASK_REFUSAL.TOO_MANY_BLOCKS;
  const blocks = codeRefusal(post.blocks ?? [], repository);
  if (blocks !== undefined) return blocks;
  return post.ask === undefined ? undefined : responseRefusal(post.ask.response);
}

/** The handles a post mentions, in its words and in every Markdown block under them, each once. */
export function postMentions(post: AskPost): readonly string[] {
  const markdown = (post.blocks ?? []).flatMap((block) =>
    block.type === CHAT_BLOCK.MARKDOWN ? [block.text] : [],
  );
  return mentionedHandles([post.text, ...markdown].join("\n\n"));
}

/**
 * The post's blocks as the message keeps them, its words first, and each
 * image read from the sandbox, or the first refusal among them. Each
 * distinct path is read once, in the order first named, and the first path
 * refused ends the reading, so a post with a block to mend reads no
 * further file for it.
 */
export function postPictures(
  post: AskPost,
  clientKey: string,
  sandbox: InboxSandboxDoor,
): Effect.Effect<Result.Result<PostPictures, string>> {
  return Effect.gen(function* () {
    const read = new Map<string, ChatImageWrite>();
    const blocks: ChatBlock[] = [{ type: CHAT_BLOCK.MARKDOWN, text: post.text }];
    for (const block of post.blocks ?? []) {
      if (block.type !== CHAT_BLOCK.IMAGE) {
        blocks.push(block);
        continue;
      }
      const id = chatAttachmentId(clientKey, block.path);
      if (!read.has(block.path)) {
        const image = yield* readInboxImage(sandbox, CODER.CHECKOUT_PATH, block.path);
        if (Result.isFailure(image)) return Result.fail(image.failure);
        read.set(block.path, { id, ...image.success });
      }
      blocks.push({ type: CHAT_BLOCK.IMAGE, attachmentId: id, alt: block.alt });
    }
    return Result.succeed({ blocks, images: [...read.values()] });
  });
}

/**
 * An ask as the agent reads it back, named where it was asked. Note that
 * an open ask carries what it asks whole, because compaction may have taken
 * the call that posted it out of the model's context and an open ask is one
 * the agent still acts on; a settled one carries what came of it alone.
 */
export function askLineOf(
  message: ChatMessageRow,
  where: string,
  handleOf: (memberId: string) => string,
): AskLine | undefined {
  const { ask, askKey, askRevision, askStatus } = message;
  if (ask === null || askKey === null || askRevision === null || askStatus === null) {
    return undefined;
  }
  const open = askStatus === ASK_STATUS.OPEN;
  return {
    key: askKey,
    seq: message.seq,
    in: where,
    status: askStatus,
    revision: askRevision,
    ...(ask.title === undefined ? undefined : { title: ask.title }),
    ...(open ? { response: ask.response, needsReply: ask.needsReply ?? true } : undefined),
    ...(message.answer === null ? undefined : { answer: message.answer }),
    ...(message.answeredByMemberId === null
      ? undefined
      : { answeredBy: handleOf(message.answeredByMemberId) }),
    ...(message.closedReason === null ? undefined : { closedReason: message.closedReason }),
  };
}

import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { CODE_PATH_MAX_CHARS, codeLineSchema, commitShaSchema } from "./plan-wire.js";

/**
 * inbox-wire.ts -- the retired inbox's tool names, and what a post to it carried, which a transcript written while coding agents had an inbox still names.
 *
 * Coding agents once kept items in the developer's inbox through three
 * tools; the inbox, its routes, and its tables are gone, and no agent is
 * offered the tools now. A transcript written before still carries their
 * calls, so the names stay (`agent-tools.ts`), and so does the shape of a
 * post's input, which the desktop reads to draw an old post as the item it
 * was: a title, its blocks of context, and the response it asked for.
 * Nothing here is shown to a model or crosses a request any longer.
 */

/** The bounds a post was held to as it was made, which the desktop reads an old post's input under. */
const INBOX_BOUNDS = {
  MAX_KEY_CHARS: 80,
  MAX_TITLE_CHARS: 160,
  MAX_BLOCKS: 8,
  MAX_MARKDOWN_CHARS: 8_000,
  MAX_URL_CHARS: 2_000,
  MAX_PATH_CHARS: 1_024,
  MAX_ALT_CHARS: 300,
  MAX_LABEL_CHARS: 160,
  MAX_OPTIONS: 6,
  MAX_OPTION_DETAIL_CHARS: 600,
  MAX_FIELDS: 8,
} as const;

/** The tools an agent keeps its items with, by the names their tool parts carry in its transcript. */
export const INBOX_TOOL = {
  /** Posts an item, or replaces the one under the same key. */
  POST: "post_to_inbox",
  /** Takes an item back, with why. */
  CLOSE: "close_inbox_item",
  /** Reads the agent's items as they stand, answers and all. */
  READ: "read_inbox",
} as const;

/** The blocks an item's context is made of. */
export const INBOX_BLOCK = {
  /** Words in Markdown. */
  MARKDOWN: "markdown",
  /** An address with a label, such as the GitHub page a task is done on. */
  LINK: "link",
  /** Lines of a file of the agent's repository, as they stood at a commit. */
  CODE: "code",
  /** A picture the agent took in its sandbox, kept as an attachment of the item's. */
  IMAGE: "image",
} as const;

/** The responses an item asks for, each answered its own way. */
export const INBOX_RESPONSE = {
  /** Pick one of the agent's options, or several where it allows, one perhaps recommended, or answer in the developer's own words. */
  CHOICE: "choice",
  /** Approve or decline a step the agent proposes. */
  APPROVAL: "approval",
  /** An open answer in the developer's own words. */
  TEXT: "text",
  /** Something the developer does by hand, such as a setting on GitHub, marked done or not possible. */
  TASK: "task",
  /** Typed fields the developer fills in. */
  FORM: "form",
  /** Nothing but an acknowledgement: something the developer should know. */
  NONE: "none",
} as const;

/** The fields a form may ask. */
export const INBOX_FIELD = {
  /** A line of words. */
  TEXT: "text",
  /** A number. */
  NUMBER: "number",
  /** One of the field's options. */
  SELECT: "select",
  /** Yes or no. */
  BOOLEAN: "boolean",
} as const;

function boundedText(maximumChars: number) {
  return EffectSchema.String.check(EffectSchema.isMaxLength(maximumChars));
}

function filledText(maximumChars: number) {
  return EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(maximumChars),
  );
}

/** An item's key as the agent spells it: a short slug, the same each time it means the same item. */
const inboxKeySchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_KEY_CHARS),
  EffectSchema.isPattern(/^[a-z0-9][a-z0-9._-]*$/u),
);

/** A link's address: a web page, and nothing a desktop would hand to another scheme. */
const WEB_ADDRESS = /^https?:\/\/\S+$/u;

/**
 * The blocks an agent writes as they are kept: words in Markdown, a link
 * with its label, or the lines of a file the agent points at, in its
 * repository as `owner/name`, from its first line to its last, at the
 * commit it read them at, so the reference never moves under a later push.
 * Note that a code block carries no line of the file: the desktop reads
 * them from GitHub at that commit, as its File tab reads a file.
 */
const WORD_BLOCKS = [
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_BLOCK.MARKDOWN),
    text: filledText(INBOX_BOUNDS.MAX_MARKDOWN_CHARS),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_BLOCK.LINK),
    url: EffectSchema.String.check(
      EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_URL_CHARS),
      EffectSchema.isPattern(WEB_ADDRESS),
    ),
    label: filledText(INBOX_BOUNDS.MAX_LABEL_CHARS),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_BLOCK.CODE),
    repo: githubRepositoryFullNameSchema,
    path: filledText(CODE_PATH_MAX_CHARS),
    startLine: codeLineSchema,
    endLine: codeLineSchema,
    sha: commitShaSchema,
  }),
] as const;

/** What an image block says of its picture: the words that stand for it where it cannot be seen. */
const imageWords = { alt: filledText(INBOX_BOUNDS.MAX_ALT_CHARS) };

/** One block as the agent posts it: the word blocks as they are kept, and an image by the path of its file in the agent's sandbox, which the service reads and keeps. */
const inboxPostBlockSchema = EffectSchema.Union([
  ...WORD_BLOCKS,
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_BLOCK.IMAGE),
    path: filledText(INBOX_BOUNDS.MAX_PATH_CHARS),
    ...imageWords,
  }),
]);

export type InboxPostBlock = typeof inboxPostBlockSchema.Type;

/** An item's context as the agent posts it: its blocks in order, few. */
const inboxPostBlocksSchema = EffectSchema.Array(inboxPostBlockSchema).check(
  EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_BLOCKS),
);

/** One option of a choice: its label, and the trade-off in a sentence where the agent wrote one. */
const inboxOptionSchema = EffectSchema.Struct({
  label: filledText(INBOX_BOUNDS.MAX_LABEL_CHARS),
  detail: EffectSchema.optionalKey(boundedText(INBOX_BOUNDS.MAX_OPTION_DETAIL_CHARS)),
});

/** One field of a form: its type, its label, which names its value in the answer, whether it must be filled, and a select's options. */
const inboxFieldSchema = EffectSchema.Struct({
  type: EffectSchema.Literals(Object.values(INBOX_FIELD)),
  label: filledText(INBOX_BOUNDS.MAX_LABEL_CHARS),
  required: EffectSchema.optionalKey(EffectSchema.Boolean),
  options: EffectSchema.optionalKey(
    EffectSchema.Array(filledText(INBOX_BOUNDS.MAX_LABEL_CHARS)).check(
      EffectSchema.isMinLength(2),
      EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_OPTIONS),
    ),
  ),
});

/**
 * What an item asks of the developer, one of six: a choice among options,
 * several where `multiple`, the label it recommends named; an approval; words,
 * with what the box says while empty; a task; a form of fields; or nothing
 * but an acknowledgement.
 */
const inboxResponseSchema = EffectSchema.Union([
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_RESPONSE.CHOICE),
    options: EffectSchema.Array(inboxOptionSchema).check(
      EffectSchema.isMinLength(2),
      EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_OPTIONS),
    ),
    multiple: EffectSchema.optionalKey(EffectSchema.Boolean),
    recommended: EffectSchema.optionalKey(EffectSchema.String),
  }),
  EffectSchema.Struct({ type: EffectSchema.Literal(INBOX_RESPONSE.APPROVAL) }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_RESPONSE.TEXT),
    placeholder: EffectSchema.optionalKey(boundedText(INBOX_BOUNDS.MAX_LABEL_CHARS)),
  }),
  EffectSchema.Struct({ type: EffectSchema.Literal(INBOX_RESPONSE.TASK) }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_RESPONSE.FORM),
    fields: EffectSchema.Array(inboxFieldSchema).check(
      EffectSchema.isMinLength(1),
      EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_FIELDS),
    ),
  }),
  EffectSchema.Struct({ type: EffectSchema.Literal(INBOX_RESPONSE.NONE) }),
]);

/**
 * What a post's tool part carries as its input: the item's key, a title,
 * the blocks of context under it, an image among them by its path in the
 * sandbox, the response it asks for, and whether the agent needs to hear
 * back, which it did unless it said not.
 */
export const inboxPostInputSchema = EffectSchema.Struct({
  key: inboxKeySchema,
  title: filledText(INBOX_BOUNDS.MAX_TITLE_CHARS),
  blocks: EffectSchema.optionalKey(inboxPostBlocksSchema),
  response: inboxResponseSchema,
  needsReply: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type InboxPost = typeof inboxPostInputSchema.Type;

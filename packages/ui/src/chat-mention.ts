import type { ChatMemberMention } from "@luke/features/chat-mentions";
import { CHAT_BOUNDS, CHAT_TARGET_SIGIL } from "@luke/features/chat-wire";
import { type DateSpan, dateChipText, dateLabel, dateOfWords } from "@luke/features/date-mention";
import { encodeMention, MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import { insideCode } from "./skill-mention.js";

/**
 * chat-mention.ts -- a member or a channel named in a chat message as `@handle` or `#name`: where one is being typed, which match it, and what choosing one writes.
 *
 * A chat message names a member the way every chat does, an `@` at the
 * start of a word and then the handle (`@agent-2`), which tells that
 * member; and links a channel with a `#` the same way (`#general`). The
 * composer opens its list while the caret stands in such a word, on the
 * same terms a `/` opens the skills (`skill-mention.ts`): an `@` or a `#`
 * inside a word (`dev@example.com`, `a#b`), or in code, opens nothing, and
 * neither does a word past the bound its grammar keeps a handle or a name
 * to. A chosen one is written as its own word and a space, so the word's
 * edge ends the mention as the service reads one.
 *
 * Words after an `@` that read as a date (`@tomorrow 3pm`, `@next fri`,
 * `@oct 20 to 24`, `@luke/features/date-mention`) offer that date too,
 * first, said as its chip says it, with the date in full beside it; a pick
 * writes it as the same link every box of the app writes
 * (`[@Oct 20, 2026](luke://date/2026-10-20)`). A date may span words, so
 * its `@` word is read up to six words long, as the agent box reads one,
 * while a handle is still one word: words after a handle that name no
 * date open nothing. Nothing here draws.
 */

type ChatSigil = (typeof CHAT_TARGET_SIGIL)[keyof typeof CHAT_TARGET_SIGIL];

/** An `@` or `#` word the caret stands at the end of: its sigil, where it stands, and the letters typed after it. */
export interface ChatMention {
  readonly sigil: ChatSigil;
  readonly start: number;
  readonly query: string;
}

/** A member or a channel as the composer offers it: its sigil, its handle or name, a muted line of what it stands for, and, for a person or an agent, the mention a chip writes it as. */
export interface ChatTarget {
  readonly sigil: ChatSigil;
  readonly name: string;
  readonly detail: string | undefined;
  /** The mention a box that draws chips writes the member as; none for a channel or Luke, written as their word. */
  readonly mention?: ChatMemberMention | undefined;
  /** The date the words after an `@` name, for the row that offers it; none for a member or a channel. */
  readonly date?: DateSpan | undefined;
}

/** A date's link as a pick writes it: its name, the date in full, and its target. */
interface ChatDateLink {
  readonly name: string;
  readonly target: string;
}

/** The characters a handle or a channel's name is spelled in, by its sigil (`chat-wire.ts`'s grammars). */
const NAME_CHARACTER = {
  [CHAT_TARGET_SIGIL.MEMBER]: /[a-z0-9-]/u,
  [CHAT_TARGET_SIGIL.CHANNEL]: /[a-z0-9._-]/u,
} as const satisfies Record<ChatSigil, RegExp>;

/** The most characters a handle or a channel's name may spell, by its sigil, as `post_chat`'s `to` bounds it. */
const NAME_BOUND = {
  [CHAT_TARGET_SIGIL.MEMBER]: CHAT_BOUNDS.MAX_HANDLE_CHARS,
  [CHAT_TARGET_SIGIL.CHANNEL]: CHAT_BOUNDS.MAX_KEY_CHARS,
} as const satisfies Record<ChatSigil, number>;

/** The words and the caret after an edit. */
interface TextEdit {
  readonly text: string;
  readonly caret: number;
}

/** A character that ends a word. */
const SPACE = /\s/u;

/** The `@` words the caret ends, read for a date: `@` at the start of a word, then up to six words with no bracket, parenthesis, or `@` in them, as the agent box reads them (`composer-editor.ts`). */
const DATE_WORDS = /(^|\s)@((?:[^\s@[\]()]+(?: [^\s@[\]()]+){0,5}))$/u;

/** A character of a date's `@` words, which a pick replaces through to the word's end. */
const DATE_WORD_CHARACTER = /[^\s@[\]()]/u;

/** Where a date's link is written; a date names no workspace or repository, so its target reads none. */
const NO_PLACE = { workspace: "", repository: null } as const;

function isSigil(character: string | undefined): character is ChatSigil {
  return character === CHAT_TARGET_SIGIL.MEMBER || character === CHAT_TARGET_SIGIL.CHANNEL;
}

/** The `@` or `#` word the caret ends, as far as it has been typed; nothing where the caret stands in no such word. */
export function chatMentionAt(text: string, caret: number): ChatMention | undefined {
  let at = caret;
  while (at > 0 && /[a-z0-9._-]/u.test(text[at - 1] ?? "")) at -= 1;
  // Note that a channel's name may hold a dot a handle may not, so the word is walked back on the wider set and checked on its own sigil's.
  const start = at - 1;
  const sigil = text[start];
  if (!isSigil(sigil)) return undefined;
  const query = text.slice(at, caret);
  if (query.length > NAME_BOUND[sigil]) return undefined;
  if (![...query].every((character) => NAME_CHARACTER[sigil].test(character))) return undefined;
  const before = text[start - 1];
  if (before !== undefined && !SPACE.test(before)) return undefined;
  if (insideCode(text, start)) return undefined;
  return { sigil, start, query };
}

/** The row that offers the date the words after an `@` name: said as its chip says it from `now` in `zone`, with the date in full beside it; nothing where they name none. */
function dateTarget(query: string, now: number, zone: string): ChatTarget | undefined {
  const date = dateOfWords(query, now, zone);
  if (date === undefined) return undefined;
  return {
    sigil: CHAT_TARGET_SIGIL.MEMBER,
    name: dateChipText(date, now, zone),
    detail: dateLabel(date, zone),
    date,
  };
}

/** The `@` words the caret ends where they read as a date, counted from `now` in the reader's `zone`: where the `@` stands, the words, and the row that offers the date; nothing otherwise, or in code. */
export function chatDateAt(
  text: string,
  caret: number,
  now: number,
  zone: string,
): { readonly mention: ChatMention; readonly target: ChatTarget } | undefined {
  const match = DATE_WORDS.exec(text.slice(0, caret));
  if (match === null) return undefined;
  const query = match[2] ?? "";
  const start = caret - query.length - 1;
  if (insideCode(text, start)) return undefined;
  const target = dateTarget(query, now, zone);
  if (target === undefined) return undefined;
  return { mention: { sigil: CHAT_TARGET_SIGIL.MEMBER, start, query }, target };
}

/** The link a date is written as: the date in full, a time in the writer's `zone`, and its `luke://date/` target. */
export function dateLink(date: DateSpan, zone: string): ChatDateLink {
  return {
    name: dateLabel(date, zone),
    target: encodeMention({ kind: MENTION_KIND.DATE, ...date }, NO_PLACE),
  };
}

/**
 * What an `@` word lists: the date its words name first, then the members
 * or the channels it matches, each as `matchingTargets` finds them.
 */
export function chatRows(
  targets: readonly ChatTarget[],
  mention: ChatMention,
  now: number,
  zone: string,
): readonly ChatTarget[] {
  const date =
    mention.sigil === CHAT_TARGET_SIGIL.MEMBER ? dateTarget(mention.query, now, zone) : undefined;
  const matched = matchingTargets(targets, mention);
  return date === undefined ? matched : [date, ...matched];
}

/**
 * The targets of the mention's sigil whose name or detail holds the query:
 * those whose name starts with it first, then those whose name holds it,
 * then those whose detail does, each in the order given.
 */
export function matchingTargets(
  targets: readonly ChatTarget[],
  mention: ChatMention,
): readonly ChatTarget[] {
  const asked = mention.query.toLowerCase();
  const own = targets.filter((target) => target.sigil === mention.sigil);
  const starts = own.filter((target) => target.name.startsWith(asked));
  const holds = own.filter(
    (target) => !target.name.startsWith(asked) && target.name.includes(asked),
  );
  const describes = own.filter(
    (target) => !target.name.includes(asked) && (target.detail ?? "").toLowerCase().includes(asked),
  );
  return [...starts, ...holds, ...describes];
}

/** The message with the word under the caret written as the target chosen, a space after it, and the caret after that. */
export function chooseTarget(text: string, mention: ChatMention, name: string): TextEdit {
  let end = mention.start + 1;
  while (end < text.length && NAME_CHARACTER[mention.sigil].test(text[end] ?? "")) end += 1;
  const after = text.slice(end);
  const spaced = after.startsWith(" ") ? after : ` ${after}`;
  const written = `${mention.sigil}${name}`;
  return {
    text: `${text.slice(0, mention.start)}${written}${spaced}`,
    caret: mention.start + written.length + 1,
  };
}

/** The message with the `@` words under the caret written as the date's link, a space after it, and the caret after that. */
export function chooseDate(
  text: string,
  mention: ChatMention,
  date: DateSpan,
  zone: string,
): TextEdit {
  let end = mention.start + 1 + mention.query.length;
  while (end < text.length && DATE_WORD_CHARACTER.test(text[end] ?? "")) end += 1;
  const after = text.slice(end);
  const spaced = after.startsWith(" ") ? after : ` ${after}`;
  const written = mentionMarkdown(
    { kind: MENTION_KIND.DATE, ...date },
    dateLabel(date, zone),
    NO_PLACE,
  );
  return {
    text: `${text.slice(0, mention.start)}${written}${spaced}`,
    caret: mention.start + written.length + 1,
  };
}

import { CHAT_TARGET_SIGIL } from "@luke/features/chat-wire";
import { insideCode } from "./skill-mention.js";

/**
 * chat-mention.ts -- a member or a channel named in a chat message as `@handle` or `#name`: where one is being typed, which match it, and what choosing one writes.
 *
 * A chat message names a member the way every chat does, an `@` at the
 * start of a word and then the handle (`@agent-2`), which tells that
 * member; and links a channel with a `#` the same way (`#general`). The
 * composer opens its list while the caret stands in such a word, on the
 * same terms a `/` opens the skills (`skill-mention.ts`): an `@` or a `#`
 * inside a word (`dev@example.com`, `a#b`), or in code, opens nothing. A
 * chosen one is written as its own word and a space. Nothing here draws.
 */

type ChatSigil = (typeof CHAT_TARGET_SIGIL)[keyof typeof CHAT_TARGET_SIGIL];

/** An `@` or `#` word the caret stands at the end of: its sigil, where it stands, and the letters typed after it. */
export interface ChatMention {
  readonly sigil: ChatSigil;
  readonly start: number;
  readonly query: string;
}

/** A member or a channel as the composer offers it: its sigil, its handle or name, and a muted line of what it stands for. */
export interface ChatTarget {
  readonly sigil: ChatSigil;
  readonly name: string;
  readonly detail: string | undefined;
}

/** The characters a handle or a channel's name is spelled in, by its sigil (`chat-wire.ts`'s grammars). */
const NAME_CHARACTER = {
  [CHAT_TARGET_SIGIL.MEMBER]: /[a-z0-9-]/u,
  [CHAT_TARGET_SIGIL.CHANNEL]: /[a-z0-9._-]/u,
} as const satisfies Record<ChatSigil, RegExp>;

/** The words and the caret after an edit. */
interface TextEdit {
  readonly text: string;
  readonly caret: number;
}

/** A character that ends a word. */
const SPACE = /\s/u;

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
  if (![...query].every((character) => NAME_CHARACTER[sigil].test(character))) return undefined;
  const before = text[start - 1];
  if (before !== undefined && !SPACE.test(before)) return undefined;
  if (insideCode(text, start)) return undefined;
  return { sigil, start, query };
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

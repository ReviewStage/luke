import { mentionedHandles } from "./chat-wire.js";
import { MENTION_KIND, type Mention, mentionLinksIn, mentionsIn } from "./mention-link.js";

/**
 * chat-mentions.ts -- whom a chat message's words name: the `@handle`s typed as words, and the people, agents, and Lukes written as mention links, as a chip in any of the app's boxes writes one.
 *
 * A chat message names a member two ways. An agent writes its handle as a
 * word (`@agent-2`), as `post_chat` tells it to; a person's box writes the
 * member as the same mention link every box of the app writes
 * (`[@Ada Lovelace](https://tryluke.dev/acme/person/<userId>)`), a Luke as
 * his task's (`…/plan/<taskId>/luke`). Both are read here: the links that
 * name a person, an agent, or a Luke, which address them, and the handles
 * typed outside any link, so a link's label (`[@ada](…)`) is never read as
 * the handle `ada`. A link of any other kind, a file or a task, is a
 * reference that addresses no one. And the words are written back for an
 * agent the way it names members, each such link as the member's
 * `@handle`, so the notice it reads, and the reply it writes, use one name.
 */

/** A mention that addresses a member of the chat: a person, an agent, or a task's Luke. */
export type ChatMemberMention = Extract<
  Mention,
  {
    readonly kind:
      | typeof MENTION_KIND.PERSON
      | typeof MENTION_KIND.AGENT
      | typeof MENTION_KIND.LUKE;
  }
>;

/** A member written as a mention link, and the label it was written with, which stands for it where it names no member. */
interface ChatMentionedMember {
  readonly mention: ChatMemberMention;
  readonly label: string;
}

/** Whether a mention addresses a member, which a file's or a task's does not. */
function addresses(mention: Mention): mention is ChatMemberMention {
  return (
    mention.kind === MENTION_KIND.PERSON ||
    mention.kind === MENTION_KIND.AGENT ||
    mention.kind === MENTION_KIND.LUKE
  );
}

/** The words with every mention link blanked out, each character a space, so what is read around them keeps its place. */
function withoutLinks(text: string): string {
  let out = "";
  let at = 0;
  for (const link of mentionLinksIn(text)) {
    out += text.slice(at, link.start) + " ".repeat(link.end - link.start);
    at = link.end;
  }
  return out + text.slice(at);
}

/** Whom a message's words name. */
export interface ChatMentions {
  /** The handles typed outside any link, each once. */
  readonly handles: readonly string[];
  /** The members written as links, in order. */
  readonly members: readonly ChatMentionedMember[];
}

/** Whom the words name: the handles typed outside any link, and the members written as links. */
export function chatMentionsIn(text: string): ChatMentions {
  return {
    handles: mentionedHandles(withoutLinks(text)),
    members: mentionsIn(text, null).flatMap(({ mention, label }) =>
      addresses(mention) ? [{ mention, label }] : [],
    ),
  };
}

/**
 * The words as an agent reads them: each link naming a member written as
 * that member's `@handle`, or as the link's own label where `handleOf`
 * finds no member; every other link left as written.
 */
export function chatWordsForAgents(
  text: string,
  handleOf: (mention: ChatMemberMention) => string | undefined,
): string {
  let out = "";
  let at = 0;
  for (const found of mentionsIn(text, null)) {
    if (!addresses(found.mention)) continue;
    const handle = handleOf(found.mention);
    out += text.slice(at, found.start) + (handle === undefined ? found.label : `@${handle}`);
    at = found.end;
  }
  return out + text.slice(at);
}

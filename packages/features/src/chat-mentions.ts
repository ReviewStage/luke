import {
  decodeMention,
  handedMentionsIn,
  linkMention,
  MENTION_KIND,
  type Mention,
  mentionLinksIn,
  mentionsIn,
} from "./mention-link.js";

/**
 * chat-mentions.ts -- whom a chat message names: the people and agents written as mention links, as a chip in any of the app's boxes writes one, and the member a post's `to` names.
 *
 * A chat message names a member the way every box of the app does, by its
 * mention link: a person's (`[@Ada Lovelace](https://tryluke.dev/acme/person/<userId>)`),
 * and an agent's under its task or its workspace. The links that name a
 * person or an agent address them; a link of any other kind, a file, a task,
 * or a task's Luke (`…/plan/<taskId>/luke`), whom no task has any more, is a
 * reference that addresses no one, and an `@word` outside any link is words.
 * A post's `to` names a member's DM by the same link, written whole or as
 * its bare address.
 */

/** A mention that addresses a member of the chat: a person or an agent. */
export type ChatMemberMention = Extract<
  Mention,
  { readonly kind: typeof MENTION_KIND.PERSON | typeof MENTION_KIND.AGENT }
>;

/** A member written as a mention link, and the label it was written with, which stands for it where it names no member. */
interface ChatMentionedMember {
  readonly mention: ChatMemberMention;
  readonly label: string;
}

/** Whether a mention addresses a member, which a file's, a task's, or a Luke's does not. */
function addresses(mention: Mention): mention is ChatMemberMention {
  return mention.kind === MENTION_KIND.PERSON || mention.kind === MENTION_KIND.AGENT;
}

/**
 * Every mention the words write, however many: a message is bounded by its
 * own length, and the cap a message's mentions are read under elsewhere
 * would let references to tasks or files written first crowd out a member
 * named after them.
 */
function everyMention(text: string) {
  return mentionsIn(text, null, mentionLinksIn(text).length);
}

/** Whom a message's words name. */
export interface ChatMentions {
  /** The members written as links, in order. */
  readonly members: readonly ChatMentionedMember[];
}

/** Whom the words name: the members written as mention links. */
export function chatMentionsIn(text: string): ChatMentions {
  return {
    members: everyMention(text).flatMap(({ mention, label }) =>
      addresses(mention) ? [{ mention, label }] : [],
    ),
  };
}

/**
 * The member a post's `to` names: a person's or an agent's mention link
 * written whole, `[@Name](address)`, or its address alone;
 * nothing for a `#name`, a link of any other kind, or words that are no link.
 */
export function chatTargetMember(target: string): ChatMemberMention | undefined {
  const [link] = mentionLinksIn(target);
  const whole = link !== undefined && link.start === 0 && link.end === target.length;
  const mention = decodeMention(whole ? link.target : target, null);
  return mention !== undefined && addresses(mention) ? mention : undefined;
}

/**
 * The words with each person or agent they name written as `@` and
 * its name alone, whether by a mention link or by its address written bare,
 * every other link left as written: what a chat notice's words mention
 * beside the members it names, which are the chat's to name and no one's
 * pointing.
 */
export function withoutMemberLinks(text: string): string {
  let out = "";
  let at = 0;
  // Note that every link is read, past the cap a message's mentions are handed under, so none is left to be handed.
  for (const found of handedMentionsIn(text, null, text.length)) {
    if (!addresses(found.mention)) continue;
    const name = linkMention(found.label, found.target, null)?.name ?? found.label;
    out += `${text.slice(at, found.start)}@${name}`;
    at = found.end;
  }
  return out + text.slice(at);
}

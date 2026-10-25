import type { ChatMemberSubject, ChatNamedSubject } from "@luke/database/models/chat-store";
import { type ChatMemberMention, chatMentionsIn } from "@luke/features/chat-mentions";
import { MEMBER_KIND } from "@luke/features/chat-wire";
import { MENTION_KIND } from "@luke/features/mention-link";

/**
 * chat-ask.ts -- whom a chat message's words name, as the store resolves them: each person or agent a mention link writes.
 *
 * A member's post in the window's Chat names the members it addresses by
 * their mention links (`@luke/features/chat-mentions`); the store finds a
 * person by their account and an agent by its id, and a link that names no
 * member keeps the label it was written with.
 */

/** Whom a post's words name, as the store resolves them: the members written as mention links. */
export interface ChatNamed {
  readonly subjects: readonly ChatNamedSubject[];
}

/** The member a mention link names, as the store finds one: a person by their account, an agent by its id. */
export function subjectOf(mention: ChatMemberMention): ChatMemberSubject {
  switch (mention.kind) {
    case MENTION_KIND.PERSON:
      return { kind: MEMBER_KIND.HUMAN, userId: mention.userId };
    case MENTION_KIND.AGENT:
      return { kind: MEMBER_KIND.AGENT, agentId: mention.agentId };
  }
}

/** Whom words name: each person or agent a mention link writes, with its label as written, which names it where it names no member. */
export function namedIn(words: string): ChatNamed {
  return {
    subjects: chatMentionsIn(words).members.map(({ mention, label }) => ({
      subject: subjectOf(mention),
      label,
    })),
  };
}

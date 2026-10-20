import type { DatabaseServices } from "@luke/database/core/query";
import {
  agentMembersOf,
  type ChatAgentMember,
  type ChatMemberRow,
} from "@luke/database/models/chat-store";
import { readAccountNames } from "@luke/database/models/workspace-store";
import { CHAT_MEMBER_LABEL, MEMBER_KIND } from "@luke/features/chat-wire";
import { MENTION_KIND } from "@luke/features/mention-link";
import { Effect } from "effect";
import type { StoreFailure } from "../../http/store-failure.js";
import { workspaceStepOf, writtenMention } from "../written-mentions.js";

/**
 * chat-names.ts -- how the chat names its members to a coding agent, to a plan's Luke, and in the notices they are told by: each by its mention link, as the rest of the app names a person, an agent, or a task's Luke.
 *
 * A person is written as their account's link, `[@Ada Lovelace](…/person/<userId>)`,
 * an agent as its own under its task, or under its workspace where it works
 * on none, named by its title or else its model's id, as `list_agents`
 * writes one, and a task's Luke as his task's `…/plan/<taskId>/luke`. Each
 * is written under the workspace's step as the reading account reads it
 * (`written-mentions.ts`), so the agent copies the link a read hands it to
 * address the member, and its chip opens the member wherever it is drawn.
 * A member no link can be written of, an agent or a Luke whose agent or
 * task is gone (`mintFormer`), or a person whose account is, is named by a
 * plain label (`CHAT_MEMBER_LABEL`), which addresses no one.
 */

/** How the chat names its members as one account reads them. */
export interface ChatNames {
  /** The member as an agent reads and writes it: its mention link, or a plain label where none can be written. */
  readonly mention: (member: ChatMemberRow) => string;
  /** What the member is called, its link's own name: a person's account's name, an agent's title or model, Luke, or a former one's label. */
  readonly name: (member: ChatMemberRow) => string;
}

/** What names a member: each agent member's name and task, by its agent's id, each person's account's name, by their account, and the name read off them. */
interface MemberNaming {
  readonly agents: ReadonlyMap<string, ChatAgentMember>;
  readonly name: (member: ChatMemberRow) => string;
  readonly people: ReadonlyMap<string, string>;
}

/** What the members given are called in the workspace, as the account reads them: each agent's name and task, and each person's account's name. */
function namingOf(
  userId: string,
  organizationId: string,
  members: Iterable<ChatMemberRow>,
): Effect.Effect<MemberNaming, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const agents = yield* agentMembersOf(userId, organizationId);
    const people = yield* readAccountNames(
      [...members].flatMap((member) => (member.userId === null ? [] : [member.userId])),
    );
    const name = (member: ChatMemberRow): string => {
      switch (member.kind) {
        case MEMBER_KIND.LUKE:
          return CHAT_MEMBER_LABEL.LUKE;
        case MEMBER_KIND.AGENT: {
          const agent = member.agentId === null ? undefined : agents.get(member.agentId);
          return agent?.name ?? CHAT_MEMBER_LABEL.FORMER_AGENT;
        }
        case MEMBER_KIND.HUMAN:
          return (
            (member.userId === null ? undefined : people.get(member.userId)) ??
            CHAT_MEMBER_LABEL.FORMER_PERSON
          );
      }
    };
    return { agents, people, name };
  });
}

/**
 * What the members given are called, as the account reads the workspace,
 * with no link written: what a notice's row and the account's waiting read
 * name a poster by.
 */
export function chatMemberNamesOf(
  userId: string,
  organizationId: string,
  members: Iterable<ChatMemberRow>,
): Effect.Effect<(member: ChatMemberRow) => string, StoreFailure, DatabaseServices> {
  return Effect.map(namingOf(userId, organizationId, members), (naming) => naming.name);
}

/**
 * How the account names the members given in the workspace: the step its
 * links are written under, and what each member is called, read once for
 * every member a reader or a notice names.
 */
export function chatNamesOf(
  userId: string,
  organizationId: string,
  members: Iterable<ChatMemberRow>,
): Effect.Effect<ChatNames, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const step = yield* workspaceStepOf(userId, organizationId);
    const { agents, people, name } = yield* namingOf(userId, organizationId, members);
    const mention = (member: ChatMemberRow): string => {
      switch (member.kind) {
        case MEMBER_KIND.LUKE:
          return member.taskId === null
            ? name(member)
            : writtenMention(
                { kind: MENTION_KIND.LUKE, taskId: member.taskId },
                name(member),
                step,
              );
        case MEMBER_KIND.AGENT: {
          const agent = member.agentId === null ? undefined : agents.get(member.agentId);
          if (member.agentId === null || agent === undefined) return name(member);
          const task = agent.taskId === undefined ? undefined : { taskId: agent.taskId };
          return writtenMention(
            { kind: MENTION_KIND.AGENT, ...task, agentId: member.agentId },
            agent.name,
            step,
          );
        }
        case MEMBER_KIND.HUMAN:
          return member.userId === null || !people.has(member.userId)
            ? name(member)
            : writtenMention(
                { kind: MENTION_KIND.PERSON, userId: member.userId },
                name(member),
                step,
              );
      }
    };
    return { mention, name };
  });
}

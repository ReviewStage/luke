import { type ChatAnswer, MEMBER_KIND } from "@luke/features/chat-wire";
import { ACTOR_KIND, ACTOR_STATE, type Actor, LUKE_ACTOR, personActor } from "@luke/ui/actor-model";
import { type ChatNames, chatWho } from "@luke/ui/chat-model";
import { useMemberDirectory } from "../member-directory.js";
import { providerOf } from "./coding-agent-model.js";

/**
 * chat-actors.ts -- a chat member as the rest of the app draws who said something: a person with their photo, Luke, or an agent with its harness.
 *
 * A chat message names its author by member, and a member is a person, an
 * agent, or a task's Luke. Each is drawn as the `Actor` every other place
 * of the window draws them by (`actor-ref.tsx`): a person read against the
 * workspace's members for their name, photo, email, and role, "You" for
 * the reader, grayed where they left (`personActor`); an agent by its title,
 * its task where a plan's summary names it, and its harness at rest, as a
 * transcript's sender is (`lineSender`); and Luke as himself. A person the
 * members read does not reach yet stands by their handle, the reader by
 * the account's own name.
 */

/** The actor a member is drawn as, by the member's id, read against the workspace's members around the caller. */
export function useChatActor(
  chat: ChatAnswer | undefined,
  names: ChatNames,
): (memberId: string) => Actor {
  const { members, readerId, former } = useMemberDirectory();
  return (memberId) => {
    if (chat === undefined) return personActor(undefined, members, readerId, former);
    const who = chatWho(chat, names, memberId);
    const member = who.member;
    switch (member?.kind) {
      case MEMBER_KIND.LUKE:
        return LUKE_ACTOR;
      case MEMBER_KIND.AGENT: {
        // Note that the read names every agent's plan; the summaries' few stand in for a read from before it did.
        const taskId =
          member.planId ??
          (member.agentId === undefined ? undefined : names.agentTasks.get(member.agentId));
        return {
          kind: ACTOR_KIND.AGENT,
          name: who.name,
          ...(member.agentId === undefined ? undefined : { agentId: member.agentId }),
          ...(taskId === undefined ? undefined : { taskId }),
          provider: who.agent === undefined ? undefined : providerOf(who.agent.model),
          state: ACTOR_STATE.REST,
        };
      }
      case MEMBER_KIND.HUMAN: {
        if (member.userId === undefined) return personActor(undefined, members, readerId, former);
        const named = members?.find((each) => each.userId === member.userId)?.name;
        return personActor(
          { userId: member.userId, name: named ?? who.name },
          members,
          readerId,
          former,
        );
      }
      default:
        return personActor(undefined, members, readerId, former);
    }
  };
}

import { CHANNEL_KIND, type ChatAnswer, MEMBER_KIND } from "@luke/features/chat-wire";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { TaskAgentLine, TaskSummary } from "@luke/features/task-wire";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  personActor,
  SOMEONE_REASON,
} from "@luke/ui/actor-model";
import { type ChatAgentLine, type ChatNames, chatNames, chatWho } from "@luke/ui/chat-model";
import { useMemo } from "react";
import { type Directory, useMemberDirectory } from "../member-directory.js";
import { agentActor } from "./coding-agent-model.js";
import { type UnlinedAgent, useUnlinedAgents } from "./mentioned-agent-card.js";

/**
 * chat-actors.ts -- a chat member as the rest of the app draws who said something: a person with their photo, Luke, or an agent with its harness and where it stands.
 *
 * A chat message names its author by member, and a member is a person, an
 * agent, or a task's Luke. Each is drawn as the `Actor` every other place
 * of the window draws them by (`actor-ref.tsx`): a person read against the
 * workspace's members for their name, photo, email, and role, "You" for
 * the reader, grayed where they left (`personActor`); an agent by its name,
 * its task where a plan's summary names it, and its harness wearing where
 * it stands, as its tile is everywhere else (`agentActor`); and Luke as
 * himself. A person the members read does not reach yet stands by the
 * name the chat read carries, the reader by the account's own, and a member
 * whose account is gone as a former member, by the one name `chatWho`
 * gives them.
 *
 * An agent is named and drawn from its line: the plans' summaries name a
 * few of each task's agents, and an agent the chat draws past those, an
 * archived one's or one past the few, is read as its chip's mark reads it
 * (`useUnlinedAgents`), so no agent stands as its model's bare id on the
 * mark of no known harness.
 */

/**
 * An agent's line from the summary a read of it answered, as a plan's
 * summary would list it, and the automation whose run started it. Note that
 * a read lands once and is not followed, so only a failure, which no turn
 * comes after, is kept; any other status is drawn at rest rather than as it
 * stood when read, so an agent never stays working on its face after it
 * stopped.
 */
function lineOf(agent: CodingAgentSummary): ChatAgentLine {
  const line: ChatAgentLine = {
    id: agent.id,
    title: agent.title,
    model: agent.model,
    effort: agent.effort,
    status:
      agent.status === CODING_AGENT_STATUS.FAILED
        ? CODING_AGENT_STATUS.FAILED
        : CODING_AGENT_STATUS.COMPLETED,
    ...(agent.personaName === undefined ? undefined : { personaName: agent.personaName }),
    ...(agent.kind === undefined ? undefined : { kind: agent.kind }),
  };
  return agent.automationName === undefined
    ? line
    : { ...line, automationName: agent.automationName };
}

/** The agents the chat draws, as authors of its messages or one of a direct message's two, that no line of `names` names. */
function unlinedAgents(chat: ChatAnswer | undefined, names: ChatNames): readonly UnlinedAgent[] {
  if (chat === undefined) return [];
  const drawn = new Set([
    ...chat.messages.map((message) => message.authorId),
    ...chat.channels.flatMap((channel) =>
      channel.kind === CHANNEL_KIND.DM ? (channel.members ?? []) : [],
    ),
  ]);
  return chat.members.flatMap((member) =>
    member.kind !== MEMBER_KIND.AGENT ||
    member.agentId === undefined ||
    !drawn.has(member.id) ||
    names.agents.has(member.agentId)
      ? []
      : [{ agentId: member.agentId, taskId: member.planId }],
  );
}

/** A member whose account is gone, as `chatWho` names them: by the name the chat still holds, else as a former member. */
function formerMember(name: string | undefined): Actor {
  const left = { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.FORMER } as const;
  return name === undefined ? left : { ...left, name };
}

/**
 * The names a chat is drawn by (`chatNames`): each agent's line from the
 * plans' summaries and the lines the read carries, and for an agent the chat
 * draws that none of those names, the line read for it.
 */
export function useChatNames(
  tasks: readonly TaskSummary[],
  read: { readonly answer: ChatAnswer; readonly agents: readonly TaskAgentLine[] } | undefined,
  selfName: string | undefined,
): ChatNames {
  // Note that the names are kept on the lines the read carries, not the read, so a push that brings a message names no one anew.
  const lines = read?.agents;
  const answer = read?.answer;
  const listed = useMemo(() => chatNames(tasks, lines ?? [], selfName), [tasks, lines, selfName]);
  const unlined = useMemo(() => unlinedAgents(answer, listed), [answer, listed]);
  const found = useUnlinedAgents(unlined);
  return useMemo(
    () =>
      found.length === 0
        ? listed
        : chatNames(tasks, [...(lines ?? []), ...found.map(lineOf)], selfName),
    [found, listed, tasks, lines, selfName],
  );
}

/**
 * The actor a member is drawn as, by the member's id, read against the
 * workspace's members around the caller. Note that it stands, and hands back
 * the one actor for a member, while the roster, the names, and the members
 * read stand, so a row drawn from it holds across a push that only brings a
 * message.
 */
export function useChatActor(
  chat: Pick<ChatAnswer, "self" | "members"> | undefined,
  names: ChatNames,
): (memberId: string) => Actor {
  const { members, readerId, former } = useMemberDirectory();
  const self = chat?.self;
  const roster = chat?.members;
  return useMemo(() => {
    const drawn = new Map<string, Actor>();
    const read = { members, readerId, former };
    const held = self === undefined || roster === undefined ? undefined : { self, members: roster };
    return (memberId: string) => {
      const standing = drawn.get(memberId);
      if (standing !== undefined) return standing;
      const actor = actorOf(held, names, read, memberId);
      drawn.set(memberId, actor);
      return actor;
    };
  }, [self, roster, names, members, readerId, former]);
}

/** One member's actor, read against the roster, the names, and the workspace's members. */
function actorOf(
  chat: Pick<ChatAnswer, "self" | "members"> | undefined,
  names: ChatNames,
  { members, readerId, former }: Pick<Directory, "members" | "readerId" | "former">,
  memberId: string,
): Actor {
  if (chat === undefined) return personActor(undefined, members, readerId, former);
  const who = chatWho(chat, names, memberId);
  const member = who.member;
  switch (member?.kind) {
    case MEMBER_KIND.AGENT: {
      // Note that the read names every agent's plan; the summaries' few stand in for a read from before it did.
      const taskId =
        member.planId ??
        (member.agentId === undefined ? undefined : names.agentTasks.get(member.agentId));
      // An agent no line names is drawn at rest on the mark of no known harness.
      const drawn =
        who.agent === undefined
          ? {
              kind: ACTOR_KIND.AGENT,
              name: who.name,
              provider: undefined,
              state: ACTOR_STATE.REST,
            }
          : agentActor(who.agent, who.name);
      return {
        ...drawn,
        ...(member.agentId === undefined ? undefined : { agentId: member.agentId }),
        ...(taskId === undefined ? undefined : { taskId }),
      };
    }
    case MEMBER_KIND.HUMAN: {
      if (member.userId !== undefined) {
        const named = members?.find((each) => each.userId === member.userId)?.name;
        return personActor(
          { userId: member.userId, name: named ?? who.name },
          members,
          readerId,
          former,
        );
      }
      return formerMember(member.name);
    }
    default:
      return formerMember(undefined);
  }
}

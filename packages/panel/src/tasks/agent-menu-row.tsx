/**
 * agent-menu-row.tsx -- one workspace agent as every agent menu of the panel draws its row.
 *
 * A row leads with the agent's tab glyph, which gives way to the working
 * mark while it works, and is named as its tab is (`agentTabLabel`). Its
 * detail is its task, as the `@` menu says it: This task for the task the
 * menu is open on, another task by its name, or No task, and Archived after
 * it for an archived agent; a task named as the agent is said nowhere, since
 * it would only say the name again. Its end wears a teammate's face where
 * someone other than the reader started it, as the sidebar's agent row does,
 * and the failed mark once its turn failed. Rested on, it hangs the agent's
 * own card, drawn from the summary the menu already read, so the card asks
 * the service nothing; an agent read with no summary hangs the card read as
 * it is hung, as a chip's is. A search finds it by its name and its detail.
 */

import type { CodingAgentPullRequest } from "@luke/features/coding-agent-wire";
import { ACTOR_KIND, type EditReader, teammateCreator } from "@luke/ui/actor-model";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useMemberDirectory } from "../member-directory.js";
import type { MenuRow } from "../searchable-menu.js";
import { AgentCard, AgentHoverCard, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { agentTabLabel } from "./coding-agent-model.js";
import type { MentionableAgent } from "./mention-picker.js";
import { type MentionedAgentsPlace, useMentionedPlace } from "./mentioned-agent-card.js";
import { agentEndMark, TAB_KIND, tabLook } from "./tab-look.js";

/** What a row says of an agent's task: the open one, another by its name or by none, or none at all, and whether it is archived. */
const AGENT_DETAIL = {
  THIS_TASK: "This task",
  NO_TASK: "No task",
  OTHER_TASK: "Another task",
  ARCHIVED: "Archived",
} as const;

/** What stands between an agent's task and its being archived in its row's detail. */
const DETAIL_JOIN = " · ";

/** The line under an agent's card, as a card read for a chip says it: the task the agent works on. */
const CARD_FOOT = {
  NO_TASK: "On no task",
  ON: "On ",
} as const;

/** The pull requests a row's card names, none: an agent's own is drawn where its task is open, and the workspace's list carries none. */
const NO_PULL_REQUESTS = new Map<string, CodingAgentPullRequest>();

/** What a menu draws its agents' rows against: the catalog and reader its cards name, the members its faces are read from, and the task it is open on, where it is open on one. */
export interface AgentRowPlace extends MentionedAgentsPlace {
  readonly directory: EditReader;
  /** The task the menu is open on, whose agents say This task; none where it is open on no task. */
  readonly taskId?: string | undefined;
}

/** The line under an agent's card: the task it works on, where the list named it. */
function cardFoot(agent: MentionableAgent): string | undefined {
  if (agent.task === undefined) return CARD_FOOT.NO_TASK;
  return agent.task.name === undefined ? undefined : `${CARD_FOOT.ON}${agent.task.name}`;
}

/**
 * An agent's card as ⌘K hangs it, drawn from the summary the list already
 * read, so it stands whole the moment it is hung; one read without a
 * summary hangs the card read as it is hung.
 */
function agentCard(agent: MentionableAgent, place: AgentRowPlace): React.ReactNode {
  const { actor, summary } = agent;
  if (summary === undefined) {
    return actor.kind === ACTOR_KIND.AGENT ? (
      <AgentHoverCard actor={{ ...actor, taskId: agent.task?.id }} agentId={agent.id} />
    ) : undefined;
  }
  const agents = {
    models: place.models,
    me: place.me,
    agents: [summary],
    archived: undefined,
    pullRequests: NO_PULL_REQUESTS,
  };
  return (
    <AgentCard
      subject={agentSubject(agents, agent.id, NOTHING_HELD, false)}
      models={place.models}
      foot={cardFoot(agent)}
    />
  );
}

/** The row's end: a teammate's face where the reader did not start the agent, then the failed mark where its turn failed. */
function agentRowEnd(agent: MentionableAgent, place: AgentRowPlace): React.ReactNode {
  const { summary } = agent;
  if (summary === undefined) return undefined;
  const starter = teammateCreator(
    { createdBy: summary.startedBy, ownerId: summary.startedBy?.userId },
    place.directory,
  );
  const failed = agentEndMark(summary, true);
  if (starter === undefined && failed === undefined) return undefined;
  return (
    <>
      {starter === undefined ? null : <ActorMark actor={starter} size={ACTOR_SIZE.MARK} />}
      {failed}
    </>
  );
}

/** What an agent's row says of its task: this one, another by its name, or none, and whether it is archived. */
function agentTaskDetail(
  agent: Pick<MentionableAgent, "task" | "archived">,
  taskId: string | undefined,
): string {
  const task =
    agent.task === undefined
      ? AGENT_DETAIL.NO_TASK
      : agent.task.id === taskId
        ? AGENT_DETAIL.THIS_TASK
        : (agent.task.name ?? AGENT_DETAIL.OTHER_TASK);
  return agent.archived === true ? `${task}${DETAIL_JOIN}${AGENT_DETAIL.ARCHIVED}` : task;
}

/** The row's detail, its task's words left out where they would only say its name again. */
function rowDetail(
  agent: MentionableAgent,
  label: string,
  taskId: string | undefined,
): string | undefined {
  const repeats = agent.task?.name?.trim().toLowerCase() === label.trim().toLowerCase();
  if (!repeats) return agentTaskDetail(agent, taskId);
  return agent.archived === true ? AGENT_DETAIL.ARCHIVED : undefined;
}

/** What the menus around the caller draw their agents' rows against, on the task `taskId` where they are open on one. */
export function useAgentRowPlace(taskId?: string): AgentRowPlace {
  const place = useMentionedPlace();
  const directory = useMemberDirectory();
  return { ...place, directory, taskId };
}

/** One workspace agent as an agent menu's row: its tab's glyph and name, its task, its starter's face and failed mark, and its card. */
export function agentMenuRow(agent: MentionableAgent, place: AgentRowPlace): MenuRow {
  const { summary } = agent;
  const label = summary === undefined ? agent.name : agentTabLabel(summary, place.models);
  const icon =
    summary === undefined ? (
      <ActorMark actor={agent.actor} />
    ) : (
      tabLook({ kind: TAB_KIND.AGENT, name: label, agent: summary }).icon
    );
  const detail = rowDetail(agent, label, place.taskId);
  return {
    id: agent.id,
    label,
    icon,
    detail,
    end: agentRowEnd(agent, place),
    card: agentCard(agent, place),
    terms: detail === undefined ? [label] : [label, detail],
  };
}

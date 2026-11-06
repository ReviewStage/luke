import type { AgentPullRequest } from "@repo/features/agent-wire";
import type { MenuRow } from "@repo/ui";
import { ACTOR_KIND, type EditReader, teammateCreator } from "@repo/ui/actor-model";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useMemberDirectory } from "../member-directory.js";
import { agentName } from "./agent-model.js";
import { AgentCard, AgentHoverCard, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { type CardFoot, taskFoot } from "./agent-tab-card.js";
import type { MentionableAgent } from "./mention-picker.js";
import { type MentionedAgentsPlace, useMentionedPlace } from "./mentioned-place.js";
import { agentEndMark, TAB_KIND, tabLook } from "./tab-look.js";

const AGENT_DETAIL = {
  THIS_TASK: "This task",
  NO_TASK: "No task",
  OTHER_TASK: "Another task",
  ARCHIVED: "Archived",
} as const;

const DETAIL_JOIN = " · ";

const CARD_FOOT = {
  NO_TASK: "On no task",
  ON: "On ",
} as const;

const NO_PULL_REQUESTS = new Map<string, AgentPullRequest>();

export interface AgentRowPlace extends MentionedAgentsPlace {
  readonly directory: EditReader;
  readonly taskId?: string | undefined;
}

function cardFoot(agent: MentionableAgent): CardFoot | undefined {
  if (agent.task === undefined) return taskFoot(CARD_FOOT.NO_TASK);
  return agent.task.name === undefined ? undefined : taskFoot(`${CARD_FOOT.ON}${agent.task.name}`);
}

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

function rowDetail(
  agent: MentionableAgent,
  label: string,
  taskId: string | undefined,
): string | undefined {
  const repeats = agent.task?.name?.trim().toLowerCase() === label.trim().toLowerCase();
  if (!repeats) return agentTaskDetail(agent, taskId);
  return agent.archived === true ? AGENT_DETAIL.ARCHIVED : undefined;
}

export function useAgentRowPlace(taskId?: string): AgentRowPlace {
  const place = useMentionedPlace();
  const directory = useMemberDirectory();
  return { ...place, directory, taskId };
}

export function agentMenuRow(agent: MentionableAgent, place: AgentRowPlace): MenuRow {
  const { summary } = agent;
  const label = summary === undefined ? agent.name : agentName(summary, place.models);
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

import type { AgentSummary } from "@repo/features/agent-wire";
import { LINK_PLACE, pullRequestAddressOf } from "@repo/features/link-grammar";
import { summaryOfTaskless, TASKS_READ, type TasksView } from "@repo/features/tasks-view";
import { listedPullRequestOf } from "@repo/ui/pull-request-link";
import * as Atom from "effect/reactivity/Atom";
import type { ReactNode } from "react";
import { tabCard } from "../desktop/tab-card.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { type AgentSubject, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { type MentionedAgentsPlace, useMentionedPlace } from "./mentioned-place.js";
import { TAB_KIND } from "./tab-look.js";
import { useListedPullRequest } from "./use-agent-pull-request.js";
import type { AgentsControl } from "./use-agents.js";
import { useKnownNames } from "./use-known-names.js";
import { useOpenPlace } from "./use-open-link.js";

/**
 * mentioned-agent-card.tsx -- the card a chip of a coding agent hangs where the place drawing it holds no tab of the agent: the agent's tab's own card, drawn from the task list the host holds, and the task it works on.
 *
 * A chip of an agent of the plan's page it stands on hangs that agent's
 * tab's card, as the page reads it (`mention-chip.tsx`'s `agentOf`). Any
 * other, an agent of another task of the workspace or of none, in a
 * transcript, the Inbox, or a description, hangs the same card (`agent-ref.tsx`'s
 * `AgentCard`), drawn from the agents the task list carries: every task's,
 * archived ones among them, and those on no task. So hanging one asks the
 * service nothing, and a rename or an archive shows on it as the list's row
 * takes it. Under a rule the card names the task the agent works on, as the
 * window lists it, or says it works on none. Until the list first answers
 * live it stands `reading`; an agent the list does not carry, one of a
 * workspace the reader left say, hangs the chip's own card.
 *
 * A pull request's chip, and an agent's Changes', hangs its Pull request
 * tab's card from the pull request the list holds of the agent that opened
 * it, as the service last synced it (`useListedPullRequest`), never a fresh
 * read of GitHub.
 *
 * A mark the window holds no model for, an archived agent's or one past the
 * few a task's row names, takes its harness from the same list
 * (`ReadAgentModel`).
 */

/** What a card's foot says of the task an agent works on. */
const TASK_WORDS = {
  NONE: "On no task",
  UNKNOWN: "On another task",
} as const;

/** No pull request of another task's agents is held here. */
const NO_PULL_REQUESTS: AgentsControl["pullRequests"] = new Map();

/** Where the task list stands on an agent it carries not. */
const UNLISTED = {
  /** The list has not yet answered live, and may carry it once it does. */
  READING: "reading",
  /** The list answered, or failed, and carries no such agent. */
  ABSENT: "absent",
} as const;

/** An agent as the task list carries it, or where the list stands on one it carries not. */
type Listed = AgentSummary | (typeof UNLISTED)[keyof typeof UNLISTED];

/** The agent the list carries; none where it carries none. */
function agentOf(listed: Listed): AgentSummary | undefined {
  return typeof listed === "string" ? undefined : listed;
}

/**
 * An agent as the task list carries it: among every task's agents, archived
 * ones among them, or the agents on no task. Note that the list carries a
 * task's agents only once it has answered live, so until then, and unless
 * it failed, an agent it does not name may still be among them.
 */
function listedAgentOf(tasks: TasksView | undefined, agentId: string): Listed {
  const onTask = tasks?.taskAgents?.find((agent) => agent.id === agentId);
  if (onTask !== undefined) return onTask;
  const onNone = tasks?.tasklessAgents?.find((agent) => agent.id === agentId);
  if (onNone !== undefined) return summaryOfTaskless(onNone);
  const answered = tasks?.taskAgents !== undefined || tasks?.listStatus === TASKS_READ.FAILED;
  return answered ? UNLISTED.ABSENT : UNLISTED.READING;
}

/** One agent as the task list carries it, for every card of it. */
const listedAgentAtom = Atom.family((agentId: string) =>
  Atom.map(APP_SLICE.TASKS, (tasks) => listedAgentOf(tasks, agentId)),
);

/** The model one agent runs on, as the task list carries it, for every mark of it; none where it carries no such agent. */
const listedModelAtom = Atom.family((agentId: string) =>
  Atom.map(listedAgentAtom(agentId), (listed) => agentOf(listed)?.model),
);

/** What a mark draws of the model the list carries, or of none. */
type ModelDrawer = (model: string | undefined) => ReactNode;

/**
 * The model an agent the window holds no line of runs on, for its mark, as
 * the task list carries the agent. It is drawn with none until the list
 * carries the agent, and where it never does.
 */
export function ReadAgentModel({
  agentId,
  children,
}: {
  agentId: string;
  children: ModelDrawer;
}): ReactNode {
  return children(useAppSlice(listedModelAtom(agentId)));
}

/** What a card of an agent's says of the task it works on: its name as the window lists it, none, or another the window does not list. */
function useTaskFoot(agent: AgentSummary | undefined): string | undefined {
  const tasks = useKnownNames().tasks;
  if (agent === undefined) return undefined;
  if (agent.planId === null) return TASK_WORDS.NONE;
  const task = tasks.get(agent.planId);
  return task === undefined ? TASK_WORDS.UNKNOWN : `On ${task}`;
}

/** An agent as its tab's card names it, from the list's line of it. */
function listedSubject(agent: AgentSummary, place: MentionedAgentsPlace): AgentSubject {
  return agentSubject(
    {
      agents: [agent],
      archived: undefined,
      models: place.models,
      me: place.me,
      pullRequests: NO_PULL_REQUESTS,
    },
    agent.id,
    NOTHING_HELD,
    false,
  );
}

/**
 * The card of an agent a chip names where the place holds no tab of it:
 * the agent's tab's card (`tabCard`), with the task it works on at its
 * foot, as the task list carries the agent; `reading` until the list first
 * answers, and `fallback` where it carries no such agent.
 */
export function MentionedAgentCard({
  agentId,
  reading,
  fallback,
}: {
  agentId: string;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const place = useMentionedPlace();
  const listed = useAppSlice(listedAgentAtom(agentId));
  const agent = agentOf(listed);
  const foot = useTaskFoot(agent);
  if (listed === UNLISTED.READING) return reading;
  if (agent === undefined) return fallback;
  return tabCard({
    kind: TAB_KIND.AGENT,
    subject: listedSubject(agent, place),
    models: place.models,
    foot,
  });
}

/** A pull request one of the workspace's agents opened, as the window lists it: the agent, the task it works on, none for one on none, and its number. */
interface OwnedPullRequest {
  readonly agentId: string;
  readonly taskId: string | undefined;
  readonly number: number | undefined;
}

/** The agent that opened the pull request a link names, among the tasks and the agents on no task the window lists; none where none of them did. */
function useOwnedPullRequest(url: string): OwnedPullRequest | undefined {
  const tasks = useAppSlice(APP_SLICE.TASKS);
  if (tasks === undefined) return undefined;
  const number = pullRequestAddressOf(url)?.number;
  const listed = listedPullRequestOf(url, tasks.tasks, tasks.tasklessAgents);
  return listed === undefined ? undefined : { ...listed, number };
}

/**
 * The Pull request tab's card of a pull request the window lists an agent
 * of opening, from the agent and its pull request as the task list carries
 * them; `reading` until the list first answers, and `fallback` where it
 * carries neither, or where the chip names another of the agent's pull
 * requests than the one its row keeps.
 */
function OwnedPullRequestCard({
  owned,
  reading,
  fallback,
}: {
  owned: OwnedPullRequest;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const place = useMentionedPlace();
  const openPlace = useOpenPlace();
  const { agentId, taskId, number } = owned;
  const listed = useAppSlice(listedAgentAtom(agentId));
  const pullRequest = useListedPullRequest(agentId);
  if (listed === UNLISTED.READING) return reading;
  const agent = agentOf(listed);
  const another = number !== undefined && pullRequest?.number !== number;
  if (agent === undefined || pullRequest === undefined || another) return fallback;
  const card = tabCard({
    kind: TAB_KIND.CHANGES,
    subject: listedSubject(agent, place),
    models: place.models,
    pullRequest,
    people: undefined,
    onOpenAgent: () =>
      openPlace?.({
        kind: LINK_PLACE.AGENT,
        ...(taskId === undefined ? undefined : { planId: taskId }),
        agentId,
      }),
  });
  return card ?? fallback;
}

/**
 * The card of a pull request a chip names: the card its Pull request tab
 * hangs (`tabCard`), wherever the chip stands, for any pull request one of
 * the agents the window lists opened, a task's or one on no task, as the
 * task list carries it; `reading` until the list first answers, and
 * `fallback`, what GitHub answered of it, for any other and where the list
 * carries none.
 */
export function PullRequestChipCard({
  url,
  reading,
  fallback,
}: {
  url: string;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const owned = useOwnedPullRequest(url);
  if (owned === undefined) return fallback;
  return <OwnedPullRequestCard owned={owned} reading={reading} fallback={fallback} />;
}

/** The card of an agent's own pull request a chip names by the agent, a link to its Pull request tab: the card that tab hangs, as the task list carries it, as a link to the pull request's page on GitHub hangs it. */
export function AgentPullRequestChipCard({
  agentId,
  taskId,
  reading,
  fallback,
}: {
  agentId: string;
  /** The task a link to the agent's Changes named it under, which the card's agent opens on, where it did. */
  taskId: string | undefined;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  return (
    <OwnedPullRequestCard
      owned={{ agentId, taskId, number: undefined }}
      reading={reading}
      fallback={fallback}
    />
  );
}

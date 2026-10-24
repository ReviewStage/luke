import { useAtomValue } from "@effect/atom-react";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BOUNDS,
  type CodingAgentPullRequest,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { pullRequestAddressOf } from "@luke/features/github-repositories-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import type { CatalogModel } from "@luke/features/models-wire";
import { ACT_KIND } from "@luke/host/acts";
import { listedPullRequestOf, pullRequestAgentOf } from "@luke/ui/pull-request-link";
import { Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { createContext, type ReactNode, useContext } from "react";
import { askAct } from "../act.js";
import { tabCard } from "../desktop/tab-card.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { type AgentSubject, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { pullRequestAsked } from "./pull-request-number.js";
import { TAB_KIND } from "./tab-look.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";
import { useKnownNames } from "./use-known-names.js";
import { useOpenPlace } from "./use-open-link.js";

/**
 * mentioned-agent-card.tsx -- the card a chip of a coding agent hangs where the place drawing it holds no tab of the agent: the agent's tab's own card, read when it is first hung, and the task it works on.
 *
 * A chip of an agent of the plan's page it stands on hangs that agent's
 * tab's card, as the page reads it (`mention-chip.tsx`'s `agentOf`). Any
 * other, an agent of another task of the workspace or of none, in a
 * transcript, the Inbox, or a plan, hangs the same card (`agent-ref.tsx`'s
 * `AgentCard`), read from the service as the card is first hung and never
 * as the chip is drawn, so words full of chips ask nothing until one is
 * looked at: an agent on a task by its task's agents, archived ones among
 * them, the read a plan's page takes, held once per task for every card
 * hung of it at once; an agent on no task by the workspace's agents whose
 * title or task holds the name the chip was written with, and where none
 * of those is it, by the workspace's newest, and then by its own id, and
 * only then is it not found. Under a rule the card names the task the agent works on, as the
 * window lists it, or says it works on none; a card of an agent not found
 * says neither. While the read is out, or
 * where it failed or no workspace is known to read it in, the chip's own
 * card stands in its place.
 *
 * A mark the window holds no model for, an archived agent's or one past the
 * few a task's row names, is read the same way as it is drawn
 * (`ReadAgentModel`), by the very read its card takes, held once for every
 * mark and card of it, so its harness is drawn without the card being hung
 * first. An agent the window holds a model for is read for nothing.
 */

/** What a mentioned agent's card names it by: the catalog that names its model, and the reader, whose own agents name no starter. */
export interface MentionedAgentsPlace {
  readonly models: readonly CatalogModel[] | undefined;
  readonly me: string | undefined;
}

const NO_PLACE: MentionedAgentsPlace = { models: undefined, me: undefined };

const MentionedAgentsContext = createContext<MentionedAgentsPlace>(NO_PLACE);

/** Hands every agent's chip under it what its card is named by. */
export const MentionedAgents = MentionedAgentsContext.Provider;

/** The reader, as the window around the chips names them, whose own work a card names no one over. */
export function useMentionedReader(): string | undefined {
  return useContext(MentionedAgentsContext).me;
}

/** What the window around the chips names an agent's card by: the catalog that names its model, and the reader. */
export function useMentionedPlace(): MentionedAgentsPlace {
  return useContext(MentionedAgentsContext);
}

/** What a card's foot says of the task an agent works on. */
const TASK_WORDS = {
  NONE: "On no task",
  UNKNOWN: "On another task",
} as const;

/** A read of agents that answered nothing a card can draw. */
const UNREAD = undefined;

type AgentsRead = readonly CodingAgentSummary[] | typeof UNREAD;

/** No pull request of another task's agents is held here. */
const NO_PULL_REQUESTS: CodingAgentsControl["pullRequests"] = new Map();

/** The agents one task holds, archived ones among them, as the service answered; nothing where it refused. */
function taskAgents(taskId: string): Effect.Effect<AgentsRead> {
  return Effect.promise(() =>
    askAct(ACT_KIND.CODING_AGENTS_LIST, { taskId, includeArchived: true }).then(
      (answer) => ("failure" in answer ? UNREAD : answer.agents),
      () => UNREAD,
    ),
  );
}

/** The workspace's agents, archived ones among them, whose title or task holds `words`, or its newest where no words are given; nothing where it refused. */
function workspaceAgents(
  workspaceId: string,
  words: string | undefined,
): Effect.Effect<AgentsRead> {
  return Effect.promise(() =>
    askAct(ACT_KIND.CODING_AGENTS_WORKSPACE_LIST, {
      workspaceId,
      includeArchived: true,
      ...(words === undefined ? undefined : { words }),
    }).then(
      (answer) => ("failure" in answer ? UNREAD : answer.agents),
      () => UNREAD,
    ),
  );
}

/** One agent by its id, as its own page reads it; none where the service holds no such agent the account reaches, and nothing where it refused. */
function agentById(agentId: string): Effect.Effect<AgentsRead> {
  return Effect.promise(() =>
    askAct(ACT_KIND.CODING_AGENTS_PAGE, { agentId }).then(
      (answer) => {
        if (!("failure" in answer)) {
          // The page spells no automation as null, where the summary the card reads leaves it out.
          const { automationId, ...page } = answer.agent;
          return [automationId === null ? page : { ...page, automationId }];
        }
        return answer.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND ? NO_AGENT : UNREAD;
      },
      () => UNREAD,
    ),
  );
}

/** A read that found no such agent. */
const NO_AGENT: readonly CodingAgentSummary[] = [];

/** The words a name searches by, where the service takes them: some, and within its bound. */
function searchWords(name: string): string | undefined {
  const words = name.trim();
  return words === "" || words.length > CODING_AGENT_BOUNDS.MAX_SEARCH_CHARS ? undefined : words;
}

/** One task's agents, read once for every card hung of it while one stands. */
const taskAgentsAtom = Atom.family((taskId: string) => rendererRuntime.atom(taskAgents(taskId)));

/**
 * The workspace's agents an agent on no task is found among: those its
 * name finds, else the newest, read once for every card hung of it while
 * one stands.
 */
const tasklessAgentsAtom = Atom.family((workspaceId: string) =>
  Atom.family((agentId: string) =>
    Atom.family((name: string) =>
      rendererRuntime.atom(
        Effect.gen(function* () {
          const words = searchWords(name);
          const found = words === undefined ? UNREAD : yield* workspaceAgents(workspaceId, words);
          if (found?.some((agent) => agent.id === agentId)) return found;
          const newest = yield* workspaceAgents(workspaceId, undefined);
          if (newest === UNREAD || newest.some((agent) => agent.id === agentId)) return newest;
          // Note that an agent older than the newest and renamed since is read by its id, and only an agent that read finds not is not found.
          return yield* agentById(agentId);
        }),
      ),
    ),
  ),
);

/** One agent read by its id, for a mark of an agent on no task drawn where no workspace is known to find it in, read once for every mark of it while one stands. */
const agentByIdAtom = Atom.family((agentId: string) => rendererRuntime.atom(agentById(agentId)));

/** The model a read answered the agent runs on; none while it is out, where it failed, and where it found no such agent. */
function modelOf(read: AsyncResult.AsyncResult<AgentsRead>, agentId: string): string | undefined {
  if (!AsyncResult.isSuccess(read)) return undefined;
  return read.value?.find((agent) => agent.id === agentId)?.model;
}

/** An agent the window holds no line of, and the task it works on; none for an agent on none. */
export interface UnlinedAgent {
  readonly agentId: string;
  readonly taskId: string | undefined;
}

/** What separates an agent's task from its id, and one agent from the next, in a key of the agents read together. */
const KEY_SEPARATOR = { TASK: "/", AGENT: "," } as const;

/** The agents asked for as one key, each `task/agent` with no task before the slash for one on none, in one order whatever order they were asked in. */
function unlinedKey(agents: readonly UnlinedAgent[]): string {
  return agents
    .map(({ agentId, taskId }) => `${taskId ?? ""}${KEY_SEPARATOR.TASK}${agentId}`)
    .toSorted()
    .join(KEY_SEPARATOR.AGENT);
}

/**
 * The agents a key names, each read as its mark reads it: by its task's
 * agents, archived ones among them, where it works on one, and by its own
 * id where it works on none. Each answers as its read lands; one still out,
 * failed, or that found no such agent is left out.
 */
const unlinedAgentsAtom = Atom.family((key: string) =>
  Atom.make((get): readonly CodingAgentSummary[] =>
    key.split(KEY_SEPARATOR.AGENT).flatMap((entry) => {
      const [taskId = "", agentId = ""] = entry.split(KEY_SEPARATOR.TASK);
      if (agentId === "") return [];
      const read = get(taskId === "" ? agentByIdAtom(agentId) : taskAgentsAtom(taskId));
      const agent = AsyncResult.isSuccess(read)
        ? read.value?.find((each) => each.id === agentId)
        : undefined;
      return agent === undefined ? [] : [agent];
    }),
  ),
);

/**
 * The agents a place draws that the window holds no line of, an archived
 * agent's or one past the few its task's row names, read by the very reads
 * their marks and cards take (`ReadAgentModel`), so each is read once for
 * every place that draws it. Note that a read lands once, so where one
 * stands it is no newer than its first answer.
 */
export function useUnlinedAgents(agents: readonly UnlinedAgent[]): readonly CodingAgentSummary[] {
  return useAtomValue(unlinedAgentsAtom(unlinedKey(agents)));
}

/** What a mark draws of the model read, or of none. */
type ModelDrawer = (model: string | undefined) => ReactNode;

function TaskAgentModel({
  taskId,
  agentId,
  children,
}: {
  taskId: string;
  agentId: string;
  children: ModelDrawer;
}): ReactNode {
  return children(modelOf(useAtomValue(taskAgentsAtom(taskId)), agentId));
}

function TasklessAgentModel({
  workspaceId,
  agentId,
  name,
  children,
}: {
  workspaceId: string;
  agentId: string;
  name: string;
  children: ModelDrawer;
}): ReactNode {
  return children(modelOf(useAtomValue(tasklessAgentsAtom(workspaceId)(agentId)(name)), agentId));
}

function AgentModelById({
  agentId,
  children,
}: {
  agentId: string;
  children: ModelDrawer;
}): ReactNode {
  return children(modelOf(useAtomValue(agentByIdAtom(agentId)), agentId));
}

/**
 * The model an agent the window holds no line of runs on, read for its
 * mark by the very read its card takes, so a card hung after shares it: by
 * its task's agents, archived ones among them, where it works on one; by
 * the workspace's agents its name finds, as its card finds it, where it
 * works on none; and by its own id where no workspace or name is known.
 * It is drawn with none while the read is out and where it answered
 * nothing.
 */
export function ReadAgentModel({
  agentId,
  taskId,
  workspaceId,
  name,
  children,
}: {
  agentId: string;
  /** The task the agent works on; none for an agent on none, or where the place does not say. */
  taskId: string | undefined;
  /** The workspace the words are of, which an agent on no task is found in. */
  workspaceId?: string | undefined;
  /** The name the agent was written with, which an agent on no task is searched by. */
  name?: string | undefined;
  children: ModelDrawer;
}): ReactNode {
  if (taskId !== undefined) {
    return (
      <TaskAgentModel taskId={taskId} agentId={agentId}>
        {children}
      </TaskAgentModel>
    );
  }
  if (workspaceId === undefined || name === undefined) {
    return <AgentModelById agentId={agentId}>{children}</AgentModelById>;
  }
  return (
    <TasklessAgentModel workspaceId={workspaceId} agentId={agentId} name={name}>
      {children}
    </TasklessAgentModel>
  );
}

/** What a card of an agent's says of the task it works on: its name as the window lists it, none, or another the window does not list. */
function useTaskFoot(agent: CodingAgentSummary | undefined): string | undefined {
  const tasks = useKnownNames().tasks;
  if (agent === undefined) return undefined;
  if (agent.planId === null) return TASK_WORDS.NONE;
  const task = tasks.get(agent.planId);
  return task === undefined ? TASK_WORDS.UNKNOWN : `On ${task}`;
}

/** An agent as its tab's card names it, from the agents a read answered. */
function readSubject(
  agents: readonly CodingAgentSummary[],
  agentId: string,
  place: MentionedAgentsPlace,
): AgentSubject {
  return agentSubject(
    {
      agents,
      archived: undefined,
      models: place.models,
      me: place.me,
      pullRequests: NO_PULL_REQUESTS,
    },
    agentId,
    NOTHING_HELD,
    false,
  );
}

/** The agent's tab's card read from the agents a read answered (`tabCard`), with the task it works on under a rule; `reading` while the read is out, and the chip's own where it answered nothing. */
function ReadAgentCard({
  read,
  agentId,
  reading,
  fallback,
}: {
  read: AsyncResult.AsyncResult<AgentsRead>;
  agentId: string;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const place = useContext(MentionedAgentsContext);
  const agents = AsyncResult.isSuccess(read) ? read.value : UNREAD;
  const subject = agents === UNREAD ? undefined : readSubject(agents, agentId, place);
  // An agent not found works nowhere the card can say.
  const foot = useTaskFoot(subject?.agent);
  if (AsyncResult.isInitial(read)) return reading;
  if (subject === undefined) return fallback;
  return tabCard({ kind: TAB_KIND.AGENT, subject, models: place.models, foot });
}

/**
 * The card of an agent a chip names where the place holds no tab of it:
 * the agent's tab's card, read as it is hung, `reading` while it is read,
 * or `fallback` where the read answered nothing. An agent on a task is
 * read by its task's agents, one on no task by the workspace's agents its
 * name finds, and one whose task and workspace the place does not know by
 * its own id.
 */
export function MentionedAgentCard({
  agentId,
  taskId,
  name,
  workspaceId,
  reading,
  fallback,
}: {
  agentId: string;
  /** The task the agent works on; none for an agent on none, or where the place does not say. */
  taskId: string | undefined;
  /** The name the chip was written with, which an agent on no task is searched by. */
  name: string;
  /** The workspace the words are of, which an agent on no task is read in. */
  workspaceId: string | undefined;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const atom =
    taskId !== undefined
      ? taskAgentsAtom(taskId)
      : workspaceId !== undefined
        ? tasklessAgentsAtom(workspaceId)(agentId)(name)
        : agentByIdAtom(agentId);
  const read = useAtomValue(atom);
  return <ReadAgentCard read={read} agentId={agentId} reading={reading} fallback={fallback} />;
}

/** An agent's pull request of the number given, as its Pull request tab reads it; none where it opened no such one, and nothing where the service refused. */
function agentPullRequest(
  agentId: string,
  number: number | undefined,
): Effect.Effect<CodingAgentPullRequest | null | typeof UNREAD> {
  return Effect.promise(() =>
    askAct(ACT_KIND.CODING_AGENTS_PULL_REQUEST, pullRequestAsked(agentId, number)).then(
      (answer) => ("failure" in answer ? UNREAD : answer.pullRequest),
      () => UNREAD,
    ),
  );
}

/** One agent's pull request by its number, read once for every card hung of it while one stands. */
const agentPullRequestAtom = Atom.family((agentId: string) =>
  Atom.family((number: number | undefined) =>
    rendererRuntime.atom(agentPullRequest(agentId, number)),
  ),
);

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
  const listed = listedPullRequestOf(url, tasks.tasks);
  if (listed !== undefined) return { ...listed, number };
  const taskless = (tasks.tasklessAgents ?? []).flatMap((agent) =>
    agent.pullRequest === undefined ? [] : [{ agentId: agent.id, url: agent.pullRequest.url }],
  );
  const agentId = pullRequestAgentOf(url, taskless);
  return agentId === undefined ? undefined : { agentId, taskId: undefined, number };
}

/** The Pull request tab's card of a pull request the window lists an agent of opening, read as it is hung. */
function OwnedPullRequestCard({
  owned,
  reading,
  fallback,
}: {
  owned: OwnedPullRequest;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const place = useContext(MentionedAgentsContext);
  const openPlace = useOpenPlace();
  const { agentId, taskId } = owned;
  const agentsRead = useAtomValue(
    taskId === undefined ? agentByIdAtom(agentId) : taskAgentsAtom(taskId),
  );
  const pullRequestRead = useAtomValue(agentPullRequestAtom(agentId)(owned.number));
  if (AsyncResult.isInitial(agentsRead) || AsyncResult.isInitial(pullRequestRead)) return reading;
  const agents = AsyncResult.isSuccess(agentsRead) ? agentsRead.value : UNREAD;
  const pullRequest = AsyncResult.isSuccess(pullRequestRead) ? pullRequestRead.value : UNREAD;
  if (agents === UNREAD || pullRequest === UNREAD || pullRequest === null) return fallback;
  const card = tabCard({
    kind: TAB_KIND.CHANGES,
    subject: readSubject(agents, agentId, place),
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
 * the agents the window lists opened, a task's or one on no task, read as
 * it is first hung; `reading` while it is read, and `fallback`, what
 * GitHub answered of it, for any other and where the read answers nothing.
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

/** The card of an agent's own pull request a chip names by the agent, a link to its Pull request tab: the card that tab hangs, read as it is hung, as a link to the pull request's page on GitHub hangs it. */
export function AgentPullRequestChipCard({
  agentId,
  taskId,
  reading,
  fallback,
}: {
  agentId: string;
  taskId: string;
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

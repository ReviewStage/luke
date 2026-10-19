import { useAtomValue } from "@effect/atom-react";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { CODING_AGENT_BOUNDS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import { ACT_KIND } from "@luke/host/acts";
import { Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { createContext, type ReactNode, useContext } from "react";
import { askAct } from "../act.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { AgentCard, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";
import { useKnownNames } from "./use-known-names.js";

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
interface MentionedAgentsPlace {
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

/** The card read from the agents a read answered, or the chip's own while it is out or where it answered nothing. */
function ReadAgentCard({
  read,
  agentId,
  foot,
  fallback,
}: {
  read: AsyncResult.AsyncResult<AgentsRead>;
  agentId: string;
  foot: string;
  fallback: ReactNode;
}): ReactNode {
  const { models, me } = useContext(MentionedAgentsContext);
  const agents = AsyncResult.isSuccess(read) ? read.value : UNREAD;
  if (agents === UNREAD) return fallback;
  const subject = agentSubject(
    { agents, archived: undefined, models, me, pullRequests: NO_PULL_REQUESTS },
    agentId,
    NOTHING_HELD,
    false,
  );
  // An agent not found works nowhere the card can say.
  return (
    <AgentCard
      subject={subject}
      models={models}
      foot={subject.agent === undefined ? undefined : foot}
    />
  );
}

function TaskAgentCard({
  taskId,
  agentId,
  fallback,
}: {
  taskId: string;
  agentId: string;
  fallback: ReactNode;
}): ReactNode {
  const read = useAtomValue(taskAgentsAtom(taskId));
  const task = useKnownNames().tasks.get(taskId);
  const foot = task === undefined ? TASK_WORDS.UNKNOWN : `On ${task}`;
  return <ReadAgentCard read={read} agentId={agentId} foot={foot} fallback={fallback} />;
}

function TasklessAgentCard({
  workspaceId,
  agentId,
  name,
  fallback,
}: {
  workspaceId: string;
  agentId: string;
  name: string;
  fallback: ReactNode;
}): ReactNode {
  const read = useAtomValue(tasklessAgentsAtom(workspaceId)(agentId)(name));
  return <ReadAgentCard read={read} agentId={agentId} foot={TASK_WORDS.NONE} fallback={fallback} />;
}

/**
 * The card of an agent a chip names where the place holds no tab of it:
 * the agent's tab's card, read as it is hung, or `fallback` while it is
 * read, where the read answered nothing, and for an agent on no task where
 * no workspace is known to read it in.
 */
export function MentionedAgentCard({
  agentId,
  taskId,
  name,
  workspaceId,
  fallback,
}: {
  agentId: string;
  /** The task the agent works on; none for an agent on none. */
  taskId: string | undefined;
  /** The name the chip was written with, which an agent on no task is searched by. */
  name: string;
  /** The workspace the words are of, which an agent on no task is read in. */
  workspaceId: string | undefined;
  fallback: ReactNode;
}): ReactNode {
  if (taskId !== undefined) {
    return <TaskAgentCard taskId={taskId} agentId={agentId} fallback={fallback} />;
  }
  if (workspaceId === undefined) return fallback;
  return (
    <TasklessAgentCard
      workspaceId={workspaceId}
      agentId={agentId}
      name={name}
      fallback={fallback}
    />
  );
}

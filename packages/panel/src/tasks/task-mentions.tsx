import type { AgentSummary } from "@repo/features/agent-wire";
import { type MentionPlace, sectionAnchors } from "@repo/features/mention-link";
import type { CatalogModel } from "@repo/features/models-wire";
import { descriptionSections } from "@repo/features/description-document";
import type { TaskSummary } from "@repo/features/task-wire";
import { TASKS_READ } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import {
  queryOptions,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { askAct } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { descriptionDocumentQuery } from "../live-reads.js";
import type { LinkDrawer } from "../markdown-message.js";
import type { MentionNode } from "../description-editor/contract.js";
import { QUERY_ROOT } from "../query-keys.js";
import { agentActor, agentName } from "./agent-model.js";
import { type MentionDoors, mentionLinkDrawer } from "./mention-chip.js";
import type { MentionHolder } from "./mention-holder.js";
import type {
  MentionAgentsReader,
  MentionableAgent,
  MentionablePage,
  MentionablePullRequest,
} from "./mention-picker.js";
import type { AgentsControl } from "./use-agents.js";
import { useOpenTask } from "./use-open-link.js";
import { useWorkspaceAgents } from "./use-workspace-agents.js";
import { workspaceAgentSearchQueryOptions } from "./workspace-agent-search.js";

export interface TaskMentionsValue {
  readonly holder: MentionHolder | undefined;
  readonly taskName: string;
  readonly workspace: string;
  readonly repository: string | null;
  readonly workspaceId?: string | undefined;
  readonly text: () => string;
  readonly pages?: readonly MentionablePage[] | undefined;
  readonly agents?: readonly MentionableAgent[] | undefined;
  readonly readAgents?: MentionAgentsReader | undefined;
  readonly pullRequests?: readonly MentionablePullRequest[] | undefined;
  readonly doors: MentionDoors;
}

const TaskMentionsContext = createContext<TaskMentionsValue | undefined>(undefined);

type MentionBox = (mention: MentionNode) => void;

interface MentionBoxes {
  readonly box: MentionBox | undefined;
  readonly stand: (update: (standing: MentionBox | undefined) => MentionBox | undefined) => void;
}

const MentionBoxContext = createContext<MentionBoxes | undefined>(undefined);

export function TaskMentions({
  value,
  children,
}: {
  value: TaskMentionsValue | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const [box, stand] = useState<MentionBox | undefined>(undefined);
  const boxes = useMemo<MentionBoxes>(() => ({ box, stand }), [box]);
  return (
    <TaskMentionsContext.Provider value={value}>
      <MentionBoxContext.Provider value={boxes}>{children}</MentionBoxContext.Provider>
    </TaskMentionsContext.Provider>
  );
}

export function useTaskMentions(): TaskMentionsValue | undefined {
  return useContext(TaskMentionsContext);
}

const NO_ANCHORS: ReadonlySet<string> = new Set();

const OPEN_NOTHING = (): void => undefined;

interface TasklessHolding {
  readonly agentId: string;
  readonly pages: readonly MentionablePage[] | undefined;
  readonly pullRequests: readonly MentionablePullRequest[];
}

export interface TasklessPlace {
  readonly workspace: string;
  readonly workspaceId: string;
  readonly repository: string | null;
}

export function tasklessMentions(
  place: TasklessPlace,
  onOpenTask: MentionDoors["onOpenTask"],
  readAgents?: MentionAgentsReader,
  opens: Partial<Pick<MentionDoors, "pullRequestOf" | "onOpenFile">> = {},
  holds?: TasklessHolding,
): TaskMentionsValue {
  const { workspace, workspaceId, repository } = place;
  const holder = holds === undefined ? undefined : { agentId: holds.agentId };
  return {
    holder,
    taskName: "",
    workspace,
    workspaceId,
    repository,
    text: () => "",
    pages: holds?.pages,
    readAgents,
    pullRequests: holds?.pullRequests,
    doors: {
      holder,
      place: { workspace, repository },
      anchors: NO_ANCHORS,
      onOpenTask,
      onOpenFile: repository === null ? undefined : opens.onOpenFile,
      pullRequestOf: opens.pullRequestOf,
    },
  };
}

const NO_AGENTS: readonly MentionableAgent[] = [];

const NO_AGENTS_HELD: readonly AgentSummary[] = [];

interface TaskHolding {
  readonly pages: readonly MentionablePage[] | undefined;
  readonly agents: Pick<AgentsControl, "agents" | "archived" | "models" | "pullRequests">;
  readonly readAgents: MentionAgentsReader | undefined;
}

export function heldTaskMentions(
  task: Pick<TaskSummary, "id" | "name" | "repository">,
  workspace: string,
  text: string | undefined,
  { pages, agents, readAgents }: TaskHolding,
  doors: Pick<MentionDoors, "onOpenTask" | "onOpenFile" | "agentOf" | "pullRequestOf">,
): TaskMentionsValue {
  const holder = { taskId: task.id };
  const { repository } = task;
  return {
    holder,
    taskName: task.name,
    workspace,
    repository,
    text: () => text ?? "",
    pages,
    agents: (agents.agents ?? NO_AGENTS_HELD).map((agent) => {
      const name = agentName(agent, agents.models);
      return { id: agent.id, name, actor: agentActor(agent, name), summary: agent };
    }),
    readAgents,
    pullRequests: mentionablePullRequests(agents),
    doors: {
      ...doors,
      holder: text === undefined ? undefined : holder,
      place: { workspace, repository },
      anchors:
        text === undefined
          ? NO_ANCHORS
          : new Set(sectionAnchors(descriptionSections(text).map((section) => section.heading))),
    },
  };
}

function newestRevisionQueryOptions(taskId: string | undefined, savedAt: number | undefined) {
  return queryOptions({
    queryKey: [QUERY_ROOT.TASK_NEWEST_REVISION, taskId, savedAt],
    queryFn:
      taskId === undefined || savedAt === undefined ? skipToken : () => newestRevisionText(taskId),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

async function newestRevisionText(taskId: string): Promise<string | null> {
  const page = await askAct(ACT_KIND.TASKS_REVISIONS, { taskId });
  if (!("revisions" in page)) return null;
  const newest = page.revisions[0];
  if (newest === undefined) return "";
  const answer = await askAct(ACT_KIND.TASKS_REVISION, { taskId, seq: newest.seq });
  return "revision" in answer ? answer.revision.document.body : null;
}

export function useSavedDescriptionText(
  task: Pick<TaskSummary, "id" | "updatedAt"> | undefined,
): string | undefined {
  const held = useQuery({ ...descriptionDocumentQuery(task?.id), enabled: false }).data;
  const openText = held !== undefined && "task" in held ? held.task.document.body : undefined;
  const reading = openText === undefined ? task?.id : undefined;
  const savedAt = task?.updatedAt;
  const revision = useQuery({
    ...newestRevisionQueryOptions(reading, savedAt),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === reading ? previous : undefined,
  });
  if (openText !== undefined) return openText;
  return reading === undefined ? undefined : (revision.data ?? undefined);
}

export function mentionablePullRequests(
  agents: Pick<AgentsControl, "agents" | "archived" | "models" | "pullRequests">,
): readonly MentionablePullRequest[] {
  const held = [...(agents.agents ?? []), ...(agents.archived ?? [])];
  const offered = new Set<string>();
  return held.flatMap((agent) => {
    const pullRequest = agents.pullRequests.get(agent.id);
    if (pullRequest === undefined || offered.has(pullRequest.url)) return [];
    offered.add(pullRequest.url);
    return [{ ...pullRequest, agent: agentName(agent, agents.models) }];
  });
}

export function mentionableAgent(
  agent: AgentSummary,
  names: ReadonlyMap<string, string>,
  models: readonly CatalogModel[] | undefined,
): MentionableAgent {
  const name = agentName(agent, models);
  return {
    id: agent.id,
    name,
    actor: agentActor(agent, name),
    ...(agent.planId === null
      ? undefined
      : { task: { id: agent.planId, name: names.get(agent.planId) } }),
    archived: agent.archivedAt !== undefined,
    summary: agent,
  };
}

export function useMentionAgentsReader(
  workspaceId: string | undefined,
  tasks: readonly { readonly id: string; readonly name: string }[],
  models: readonly CatalogModel[] | undefined,
): MentionAgentsReader | undefined {
  const queryClient = useQueryClient();
  const { mutate: refreshTasks } = useMutation(actMutation(ACT_KIND.TASKS_REFRESH));
  const newest = useWorkspaceAgents(workspaceId, null);
  const listFailed = newest !== undefined && "failed" in newest;
  const carried = newest !== undefined && !listFailed;
  const naming = useRef({ tasks, models, newest: NO_AGENTS_HELD });
  naming.current = {
    tasks,
    models,
    newest: newest !== undefined && "agents" in newest ? newest.agents : NO_AGENTS_HELD,
  };
  const read = useCallback<MentionAgentsReader>(
    (words) => {
      if (workspaceId === undefined) return Promise.resolve(NO_AGENTS);
      const offered = (agents: readonly AgentSummary[]) => {
        const names = new Map(naming.current.tasks.map((task) => [task.id, task.name]));
        return agents.map((agent) => mentionableAgent(agent, names, naming.current.models));
      };
      if (words === undefined) {
        if (listFailed) {
          refreshTasks();
          return Promise.reject(new Error(TASKS_READ.FAILED));
        }
        return Promise.resolve(carried ? offered(naming.current.newest) : NO_AGENTS);
      }
      return queryClient
        .fetchQuery(workspaceAgentSearchQueryOptions(workspaceId, words, { includeArchived: true }))
        .then((answer) => {
          if ("failure" in answer) throw new Error(answer.failure);
          return offered(answer.agents);
        });
    },
    [queryClient, refreshTasks, workspaceId, listFailed, carried],
  );
  return workspaceId === undefined ? undefined : read;
}

export interface MentionedTask {
  readonly taskId: string;
  readonly place: MentionPlace;
  readonly anchors: ReadonlySet<string>;
}

export function useMentionDoors(task?: MentionedTask): MentionDoors {
  const page = useContext(TaskMentionsContext)?.doors;
  const openTask = useOpenTask();
  const windowDoors = useMemo<MentionDoors>(
    () => ({
      holder: task === undefined ? undefined : { taskId: task.taskId },
      place: task?.place ?? { workspace: "", repository: null },
      anchors: task?.anchors ?? NO_ANCHORS,
      onOpenTask: openTask ?? OPEN_NOTHING,
      onOpenFile: undefined,
    }),
    [openTask, task],
  );
  return page ?? windowDoors;
}

export function useMentionLink(task?: MentionedTask): LinkDrawer {
  const doors = useMentionDoors(task);
  return useMemo(() => mentionLinkDrawer(doors), [doors]);
}

export function useMentionBox(receive: MentionBox): void {
  const stand = useContext(MentionBoxContext)?.stand;
  const latest = useRef(receive);
  latest.current = receive;
  useEffect(() => {
    if (stand === undefined) return;
    const taking: MentionBox = (mention) => latest.current(mention);
    stand(() => taking);
    return () => stand((standing) => (standing === taking ? undefined : standing));
  }, [stand]);
}

export function useMentionDrop(): ((mention: MentionNode) => void) | undefined {
  return useContext(MentionBoxContext)?.box;
}

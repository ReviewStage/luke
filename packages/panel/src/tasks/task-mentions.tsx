import type { AgentSummary } from "@repo/features/agent-wire";
import { descriptionSections } from "@repo/features/description-document";
import { LIVE_READ } from "@repo/features/live-wire";
import { type MentionPlace, sectionAnchors } from "@repo/features/mention-link";
import type { CatalogModel } from "@repo/features/models-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import { TASKS_READ } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { queryOptions, skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { askAct, useAct } from "../act.js";
import type { MentionNode } from "../description-editor/contract.js";
import type { LinkDrawer } from "../markdown-message.js";
import { QUERY_ROOT } from "../query-keys.js";
import { useHeldRows } from "../use-host-read.js";
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

/**
 * task-mentions.tsx -- what a task's page hands every place on it that picks or draws a mention: the task, its saved text, and what opening a mention does.
 *
 * The description's own words draw their mentions through the document
 * (`description-body.tsx`); an agent's message box on the same page picks them with
 * `@` (`agent-composer.tsx`), the task's pages and agents among them, and its transcript draws the ones a message
 * holds as chips (`transcript-blocks.tsx`). Those stand far from the task's
 * page in the tree, so the page hands them this, as it hands them its skills
 * (`skill-chip.tsx`'s `SkillFiles`). A place off a task's page reads nothing,
 * picks no mention, and draws a mention's link as words.
 *
 * The page of an agent no task holds, as an automation's run starts one,
 * hands the same through `tasklessMentions`: its repository's files, its
 * skills, and the servers, with no description's sections, since there is no task.
 * New task's composer hands the same for its workspace, its repository's
 * once one is chosen on its chip (`new-task-composer.tsx`). Each
 * hands the workspace's coding agents too, the newest as the task list
 * carries them and those words name as the service finds them, through
 * `useMentionAgentsReader`, each named by its task.
 *
 * The Inbox's box on a thread of a task hands what the task's page does
 * (`heldTaskMentions`), off that page: the description's sections as last saved
 * (`useSavedDescriptionText`), and the pages, agents, and pull requests the
 * Inbox holds of the task.
 *
 * The page also carries a mention made elsewhere on it into the agent's
 * message box drawn there: the box drawn now takes it in (`useMentionBox`),
 * and a File tab's ⌥⌘K hands it the lines picked (`useMentionDrop`), which
 * it offers only while a box stands to take them. The page draws one
 * agent's tab at a time, so the box drawn is the current agent's.
 */

/** A task's page's mentions: what holds them, its text as saved, and the doors its chips open through. */
export interface TaskMentionsValue {
  /** The task, or the agent on no task, whose page it is; none for a place neither holds. */
  readonly holder: MentionHolder | undefined;
  readonly taskName: string;
  /** The slug of the task's workspace, which a mention of it is written under. */
  readonly workspace: string;
  /** The task's repository, `owner/name`; null before one is chosen. */
  readonly repository: string | null;
  /** The id of the workspace whose installation the repository is read through, where no task names it. */
  readonly workspaceId?: string | undefined;
  readonly text: () => string;
  /** The pages agents showed on the task, or the agent on no task showed itself, which an `@` offers; none where neither holds the place. */
  readonly pages?: readonly MentionablePage[] | undefined;
  /** The task's coding agents, which an `@` offers first; none off a task. */
  readonly agents?: readonly MentionableAgent[] | undefined;
  /** Reads the workspace's coding agents, which an `@` offers after the task's own. */
  readonly readAgents?: MentionAgentsReader | undefined;
  /** The pull requests the task's agents published, or the agent on no task did, which an `@` offers; none elsewhere. */
  readonly pullRequests?: readonly MentionablePullRequest[] | undefined;
  readonly doors: MentionDoors;
}

const TaskMentionsContext = createContext<TaskMentionsValue | undefined>(undefined);

/** What takes in a mention made elsewhere on the page: the agent's message box drawn there. */
type MentionBox = (mention: MentionNode) => void;

/** The box standing on the page, if one is, and the door a box takes its place through. */
interface MentionBoxes {
  readonly box: MentionBox | undefined;
  readonly stand: (update: (standing: MentionBox | undefined) => MentionBox | undefined) => void;
}

const MentionBoxContext = createContext<MentionBoxes | undefined>(undefined);

/**
 * Hands every place under it the task's page's mentions. Note that the text
 * is the description's saved words, never an open editor's, because the agent is
 * handed the sections of the description as saved, and a section the box offered
 * that the send cannot find would reach the agent as gone. None hands
 * nothing, as no page does, so an owner whose mentions come and go keeps
 * what it draws under them mounted.
 */
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

/** The task's page's mentions; nothing off a task's page. */
export function useTaskMentions(): TaskMentionsValue | undefined {
  return useContext(TaskMentionsContext);
}

/** The anchors of no task. */
const NO_ANCHORS: ReadonlySet<string> = new Set();

/** What a press on a task's chip does with no opener at hand, as in a test of one surface: nothing. */
const OPEN_NOTHING = (): void => undefined;

/** What an agent on no task holds on its own page, which an `@` there offers: the agent, the pages it showed, and the pull request it opened, as the page has read them. */
interface TasklessHolding {
  readonly agentId: string;
  readonly pages: readonly MentionablePage[] | undefined;
  readonly pullRequests: readonly MentionablePullRequest[];
}

/** A place no task holds, as an agent an automation started stands in: its workspace's slug, which a mention is written under, its id, which its repository is read through, and the repository, null where none is chosen yet, as in New task. */
export interface TasklessPlace {
  readonly workspace: string;
  readonly workspaceId: string;
  readonly repository: string | null;
}

/**
 * The mentions of a page no task holds, as the page of an agent an
 * automation started is: its repository's files and folders, its skills,
 * and the servers, and no description's sections; on an agent's own page, the
 * pages it showed and the pull request it opened, which `holds` hands; a task or a section a message
 * names opens through `onOpenTask`, and a file through `onOpenFile`, in
 * the panel beside the page, which reads it by the place's workspace and
 * repository, or on GitHub where the place hands none. A place of no
 * repository, as the app's page is, offers the rest all the same. A link to a
 * pull request the place's agent opened hangs the card `pullRequestOf`
 * answers, where the place hands one.
 */
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

/** The agents of no read. */
const NO_AGENTS: readonly MentionableAgent[] = [];

/** The agents of a task not read yet. */
const NO_AGENTS_HELD: readonly AgentSummary[] = [];

/** What a place holds of a task beside its description's words: the pages agents showed on it, its agents as read, and the reader of the workspace's. */
interface TaskHolding {
  readonly pages: readonly MentionablePage[] | undefined;
  readonly agents: Pick<AgentsControl, "agents" | "archived" | "models" | "pullRequests">;
  readonly readAgents: MentionAgentsReader | undefined;
}

/**
 * The mentions of a task, as its page hands them and the Inbox's box on a
 * thread of the task does: the description and its sections, read off `text`, its
 * saved words; the pages agents showed on it; its standing agents, offered
 * first; the workspace's, through `readAgents`; and the pull requests its
 * agents published. Note that while `text` is unread no chip of the
 * thread is judged against the description's sections, since none would be found
 * and each would be drawn gone.
 */
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

/**
 * The words of a task's newest revision as saved by `savedAt`, which a
 * save moves, so a revision read under one stamp never goes stale: read
 * through the version history's acts, the page then the revision. A read
 * refused answers none, so no chip is judged against sections never read,
 * and a description with no revision yet answers no words.
 */
function newestRevisionQueryOptions(taskId: string | undefined, savedAt: number | undefined) {
  return queryOptions({
    queryKey: [QUERY_ROOT.TASK_NEWEST_REVISION, taskId, savedAt],
    queryFn:
      taskId === undefined || savedAt === undefined ? skipToken : () => newestRevisionText(taskId),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** The words of the task's newest revision; none where a read was refused, and no words where it has no revision yet. */
async function newestRevisionText(taskId: string): Promise<string | null> {
  const page = await askAct(ACT_KIND.TASKS_REVISIONS, { taskId });
  if (!("revisions" in page)) return null;
  const newest = page.revisions[0];
  if (newest === undefined) return "";
  const answer = await askAct(ACT_KIND.TASKS_REVISION, { taskId, seq: newest.seq });
  return "revision" in answer ? answer.revision.document.body : null;
}

/**
 * The saved words of a task's description for a place off its page, as the
 * Inbox's box on a thread of the task offers its sections: a description's the host
 * holds for a window that opened it, else its newest revision's, read through the
 * version history's acts and again once a save moves the task's stamp,
 * the words last read standing meanwhile; none until first read, or where
 * the read failed. A description with no revision yet has no words to offer.
 */
export function useSavedDescriptionText(
  task: Pick<TaskSummary, "id" | "updatedAt"> | undefined,
): string | undefined {
  const held = useHeldRows(LIVE_READ.DESCRIPTION_DOCUMENT, task?.id);
  const openText = held !== undefined && "task" in held ? held.task.document.body : undefined;
  const reading = openText === undefined ? task?.id : undefined;
  const savedAt = task?.updatedAt;
  const revision = useQuery({
    ...newestRevisionQueryOptions(reading, savedAt),
    // Note that the words last read stand while a save's are read, and only the same task's.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === reading ? previous : undefined,
  });
  if (openText !== undefined) return openText;
  return reading === undefined ? undefined : (revision.data ?? undefined);
}

/**
 * The task's pull requests as an `@` list offers them: each its agents
 * published, as far as the window has read them, in the order the agents
 * were started, an archived agent's among them, labeled by its agent's
 * tab's name; a pull request two agents published is offered once, under
 * the first.
 */
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

/** One agent of the workspace's list as a menu offers it: by its tab's name, wearing its tile, with its task named from `names`, the tasks' names by id. */
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

/**
 * Reads the workspace's coding agents as an `@` list offers them: the
 * newest as the task list carries them (`useWorkspaceAgents`), archived
 * ones left out, or those the service finds the words name, archived ones
 * among them, each by its tab's name, wearing its tile, with its task
 * named from `tasks`, the tasks the window lists, archived ones among
 * them; none where no workspace is known, and a rejection where the list
 * or the search failed, which a list says it could not read rather than
 * that no agent matches. A read of the newest while the task list failed
 * asks the host to read it again, as the list's own Try again does. The
 * reader stands for as long as what it reads by does, so a list keeps what
 * it read, and moves as the task list first carries the workspace's agents
 * or fails, so a list open before then reads them again.
 */
export function useMentionAgentsReader(
  workspaceId: string | undefined,
  tasks: readonly { readonly id: string; readonly name: string }[],
  models: readonly CatalogModel[] | undefined,
): MentionAgentsReader | undefined {
  const { tell } = useAct();
  const queryClient = useQueryClient();
  const newest = useWorkspaceAgents(workspaceId, null);
  const listFailed = newest !== undefined && "failed" in newest;
  const carried = newest !== undefined && !listFailed;
  // Note that the names and the newest are read as each read answers, so the reader stands while the window's lists move.
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
          tell(ACT_KIND.TASKS_REFRESH);
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
    [queryClient, tell, workspaceId, listFailed, carried],
  );
  return workspaceId === undefined ? undefined : read;
}

/** A task a place off its page draws the words of, as the description's version history does: its id, where its mentions are written, and its sections' anchors as they stand. */
export interface MentionedTask {
  readonly taskId: string;
  readonly place: MentionPlace;
  readonly anchors: ReadonlySet<string>;
}

/**
 * The doors a mention's chip opens through where it is drawn: the task's
 * page's, or, off one, the window's own: a task or a section opened by the
 * window's opener, and no file, since no File tab stands there. A place
 * off the page drawing one description's words, as its version history does,
 * names the task, so a file of its repository is still the file and a
 * section the description no longer holds is drawn gone; with none, as in the
 * workspace's Inbox, no repository is at hand, so a GitHub page is drawn as
 * GitHub's, but for a file's or a folder's, drawn as that file or folder of
 * the repository its address names (`mention-chip.tsx`'s `linkChip`).
 */
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

/** What draws a link in Markdown drawn here as its mention's chip, through the doors `useMentionDoors` hands for the task given. */
export function useMentionLink(task?: MentionedTask): LinkDrawer {
  const doors = useMentionDoors(task);
  return useMemo(() => mentionLinkDrawer(doors), [doors]);
}

/** Makes the agent's message box the one a mention made elsewhere on the page is laid into, for as long as it is drawn. */
export function useMentionBox(receive: MentionBox): void {
  const stand = useContext(MentionBoxContext)?.stand;
  const latest = useRef(receive);
  latest.current = receive;
  useEffect(() => {
    if (stand === undefined) return;
    const taking: MentionBox = (mention) => latest.current(mention);
    // Note that a box is set as a function's answer, since the box is itself a function.
    stand(() => taking);
    return () => stand((standing) => (standing === taking ? undefined : standing));
  }, [stand]);
}

/** Hands a mention to the agent's message box drawn on the page; nothing while no box stands there, or off a task's page. */
export function useMentionDrop(): ((mention: MentionNode) => void) | undefined {
  return useContext(MentionBoxContext)?.box;
}

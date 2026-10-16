import type { MentionPlace } from "@luke/features/mention-link";
import type { CatalogModel } from "@luke/features/models-wire";
import { ACT_KIND } from "@luke/host/acts";
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
import { useAct } from "../act";
import type { LinkDrawer } from "../markdown-message";
import type { MentionNode } from "../plan-editor/contract";
import { agentActor, agentTabLabel } from "./coding-agent-model";
import { type MentionDoors, mentionLinkDrawer } from "./mention-chip";
import type {
  MentionAgentsReader,
  MentionableAgent,
  MentionablePage,
  MentionablePullRequest,
} from "./mention-picker";
import type { CodingAgentsControl } from "./use-coding-agents";
import { useOpenTask } from "./use-open-link";

/**
 * plan-mentions.tsx -- what a plan's page hands every place on it that picks or draws a mention: the plan, its saved text, and what opening a mention does.
 *
 * The plan's own words draw their mentions through the document
 * (`plan-body.tsx`); an agent's message box on the same page picks them with
 * `@` (`agent-composer.tsx`), the plan's pages and agents among them, and its transcript draws the ones a message
 * holds as chips (`transcript-blocks.tsx`). Those stand far from the plan's
 * page in the tree, so the page hands them this, as it hands them its skills
 * (`skill-chip.tsx`'s `SkillFiles`). A place off a plan's page reads nothing,
 * picks no mention, and draws a mention's link as words.
 *
 * The page of an agent no plan holds, as an automation's run starts one,
 * hands the same through `planlessMentions`: its repository's files, its
 * skills, and the servers, with no plan's sections, since there is no plan.
 * Either hands the workspace's coding agents too, read as an `@` list
 * opens through `useMentionAgentsReader`, each named by its task.
 *
 * The page also carries a mention made elsewhere on it into the agent's
 * message box drawn there: the box drawn now takes it in (`useMentionBox`),
 * and a File tab's ⌥⌘K hands it the lines picked (`useMentionDrop`), which
 * it offers only while a box stands to take them. The page draws one
 * agent's tab at a time, so the box drawn is the current agent's.
 */

/** A plan's page's mentions: the plan, its text as saved, and the doors its chips open through. */
export interface PlanMentionsValue {
  readonly taskId: string;
  readonly taskName: string;
  /** The slug of the plan's workspace, which a mention of it is written under. */
  readonly workspace: string;
  /** The plan's repository, `owner/name`; null before one is chosen. */
  readonly repository: string | null;
  /** The id of the workspace whose installation the repository is read through, where no plan names it (`NO_PLAN`). */
  readonly workspaceId?: string | undefined;
  readonly text: () => string;
  /** The pages agents showed on the plan, which an `@` offers; none off a plan. */
  readonly pages?: readonly MentionablePage[] | undefined;
  /** The plan's coding agents, which an `@` offers first; none off a plan. */
  readonly agents?: readonly MentionableAgent[] | undefined;
  /** Reads the workspace's coding agents, which an `@` offers after the plan's own. */
  readonly readAgents?: MentionAgentsReader | undefined;
  /** The pull requests the plan's agents published, which an `@` offers; none off a plan. */
  readonly pullRequests?: readonly MentionablePullRequest[] | undefined;
  readonly doors: MentionDoors;
}

const PlanMentionsContext = createContext<PlanMentionsValue | undefined>(undefined);

/** What takes in a mention made elsewhere on the page: the agent's message box drawn there. */
type MentionBox = (mention: MentionNode) => void;

/** The box standing on the page, if one is, and the door a box takes its place through. */
interface MentionBoxes {
  readonly box: MentionBox | undefined;
  readonly stand: (update: (standing: MentionBox | undefined) => MentionBox | undefined) => void;
}

const MentionBoxContext = createContext<MentionBoxes | undefined>(undefined);

/**
 * Hands every place under it the plan's page's mentions. Note that the text
 * is the plan's saved words, never an open editor's, because the agent is
 * handed the sections of the plan as saved, and a section the box offered
 * that the send cannot find would reach the agent as gone.
 */
export function PlanMentions({
  value,
  children,
}: {
  value: PlanMentionsValue;
  children: ReactNode;
}): React.JSX.Element {
  const [box, stand] = useState<MentionBox | undefined>(undefined);
  const boxes = useMemo<MentionBoxes>(() => ({ box, stand }), [box]);
  return (
    <PlanMentionsContext.Provider value={value}>
      <MentionBoxContext.Provider value={boxes}>{children}</MentionBoxContext.Provider>
    </PlanMentionsContext.Provider>
  );
}

/** The plan's page's mentions; nothing off a plan's page. */
export function usePlanMentions(): PlanMentionsValue | undefined {
  return useContext(PlanMentionsContext);
}

/** Where no plan's page stands, or a page stands with no plan, its plan: none, so a section of any plan is drawn as found, and none is offered. */
export const NO_TASK = "";

/** The anchors of no plan. */
const NO_ANCHORS: ReadonlySet<string> = new Set();

/** What a press on a plan's chip does with no opener at hand, as in a test of one surface: nothing. */
const OPEN_NOTHING = (): void => undefined;

/** A place no plan holds, as an agent an automation started stands in: its workspace's slug, which a mention is written under, its id, which its repository is read through, and the repository. */
export interface PlanlessPlace {
  readonly workspace: string;
  readonly workspaceId: string;
  readonly repository: string;
}

/**
 * The mentions of a page no plan holds, as the page of an agent an
 * automation started is: its repository's files and folders, its skills,
 * and the servers, and no plan's sections; a plan or a section a message
 * names opens through `onOpenPlan`, and a file is GitHub's, since no File
 * tab stands there.
 */
export function planlessMentions(
  place: PlanlessPlace,
  onOpenTask: MentionDoors["onOpenTask"],
  readAgents?: MentionAgentsReader,
): PlanMentionsValue {
  const { workspace, workspaceId, repository } = place;
  return {
    taskId: NO_TASK,
    taskName: "",
    workspace,
    workspaceId,
    repository,
    text: () => "",
    readAgents,
    doors: {
      taskId: NO_TASK,
      place: { workspace, repository },
      anchors: NO_ANCHORS,
      onOpenTask,
      onOpenFile: undefined,
    },
  };
}

/** The agents of no read. */
const NO_AGENTS: readonly MentionableAgent[] = [];

/**
 * The task's pull requests as an `@` list offers them: each its agents
 * published, as far as the window has read them, in the order the agents
 * were started, an archived agent's among them, labelled by its agent's
 * tab's name; a pull request two agents published is offered once, under
 * the first.
 */
export function mentionablePullRequests(
  agents: Pick<CodingAgentsControl, "agents" | "archived" | "models" | "pullRequests">,
): readonly MentionablePullRequest[] {
  const held = [...(agents.agents ?? []), ...(agents.archived ?? [])];
  const offered = new Set<string>();
  return held.flatMap((agent) => {
    const pullRequest = agents.pullRequests.get(agent.id);
    if (pullRequest === undefined || offered.has(pullRequest.url)) return [];
    offered.add(pullRequest.url);
    return [{ ...pullRequest, agent: agentTabLabel(agent, agents.models) }];
  });
}

/**
 * Reads the workspace's coding agents as an `@` list offers them: the
 * newest, or those the words name, archived ones among them, each by its
 * tab's name, wearing its tile, with its task named from `tasks`, the
 * tasks the window lists, archived ones among them; none where no
 * workspace is known or the read failed. The reader stands for as
 * long as what it reads by does, so a list keeps what it read.
 */
export function useMentionAgentsReader(
  workspaceId: string | undefined,
  tasks: readonly { readonly id: string; readonly name: string }[],
  models: readonly CatalogModel[] | undefined,
): MentionAgentsReader | undefined {
  const { act } = useAct();
  // Note that the names are read as each read answers, so the reader stands while the window's lists move.
  const naming = useRef({ tasks, models });
  naming.current = { tasks, models };
  const read = useCallback<MentionAgentsReader>(
    (words) => {
      if (workspaceId === undefined) return Promise.resolve(NO_AGENTS);
      return act(ACT_KIND.CODING_AGENTS_WORKSPACE_LIST, {
        workspaceId,
        ...(words === undefined ? undefined : { words, includeArchived: true }),
      }).then(
        (answer) => {
          if ("failure" in answer) return NO_AGENTS;
          const names = new Map(naming.current.tasks.map((task) => [task.id, task.name]));
          return answer.agents.map((agent): MentionableAgent => {
            const name = agentTabLabel(agent, naming.current.models);
            return {
              id: agent.id,
              name,
              actor: agentActor(agent, name),
              ...(agent.planId === null
                ? undefined
                : { task: { id: agent.planId, name: names.get(agent.planId) } }),
              archived: agent.archivedAt !== undefined,
            };
          });
        },
        () => NO_AGENTS,
      );
    },
    [act, workspaceId],
  );
  return workspaceId === undefined ? undefined : read;
}

/** A plan a place off its page draws the words of, as the plan's version history does: its id, where its mentions are written, and its sections' anchors as they stand. */
export interface MentionedTask {
  readonly taskId: string;
  readonly place: MentionPlace;
  readonly anchors: ReadonlySet<string>;
}

/**
 * The doors a mention's chip opens through where it is drawn: the plan's
 * page's, or, off one, the window's own: a plan or a section opened by the
 * window's opener, and no file, since no File tab stands there. A place
 * off the page drawing one plan's words, as its version history does,
 * names the plan, so a file of its repository is still the file and a
 * section the plan no longer holds is drawn gone; with none, as in the
 * workspace's Inbox, no repository is at hand, so a GitHub page is drawn as
 * GitHub's.
 */
export function useMentionDoors(task?: MentionedTask): MentionDoors {
  const page = useContext(PlanMentionsContext)?.doors;
  const openTask = useOpenTask();
  const windowDoors = useMemo<MentionDoors>(
    () => ({
      taskId: task?.taskId ?? NO_TASK,
      place: task?.place ?? { workspace: "", repository: null },
      anchors: task?.anchors ?? NO_ANCHORS,
      onOpenTask: openTask ?? OPEN_NOTHING,
      onOpenFile: undefined,
    }),
    [openTask, task],
  );
  return page ?? windowDoors;
}

/** What draws a link in Markdown drawn here as its mention's chip, through the doors `useMentionDoors` hands for the plan given. */
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

/** Hands a mention to the agent's message box drawn on the page; nothing while no box stands there, or off a plan's page. */
export function useMentionDrop(): ((mention: MentionNode) => void) | undefined {
  return useContext(MentionBoxContext)?.box;
}

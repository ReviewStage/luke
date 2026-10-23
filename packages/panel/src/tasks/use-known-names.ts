import { useAtomValue } from "@effect/atom-react/Hooks";
import { agentTabLabel } from "@luke/features/model-label";
import type { KnownNames } from "@luke/features/place-chip-model";
import type { TaskStatus } from "@luke/features/task-wire";
import { TASKS_READ } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import type { AppStateSnapshot } from "@luke/host/app-state";
import * as Atom from "effect/reactivity/Atom";
import { useEffect, useMemo } from "react";
import { tellAct } from "../act.js";
import { useAutomation } from "../automation-directory.js";
import { useMemberDirectory } from "../member-directory.js";
import { appStateDerivedAtom } from "../use-app-state.js";

/**
 * use-known-names.ts -- the names the window already holds for places in Luke, by id, for a chip to call a Luke link by.
 *
 * Read from main's document, which every window holds: every task's title,
 * the agents each task's row names, as their tabs name them
 * (`agentTabLabel`, so an operator is Luke and an untitled agent goes by its
 * model), and the models they run on, the agents with no task the list
 * carries, theirs, and the automations that started them, the active task's
 * pages, the Inbox items waiting, and the agents an automation started with
 * no task; and from the directories standing around the caller, the members
 * and the automation asked for. Nothing is fetched, so a name the window
 * does not hold is not here; a chip naming a task before the list was ever
 * read asks for it once (`useTaskNameCatchUp`), and the follow that read
 * starts brings each task's name as the service gives it.
 *
 * The document's names are built once per delivery in an atom every chip
 * shares, rather than once per chip, so a transcript of a hundred chips
 * builds them once; and not at all for a delivery that moved neither the
 * tasks nor the Inbox.
 */

/** No people: what a caller outside a member directory names. */
const NO_PEOPLE: ReadonlyMap<string, string> = new Map();

/** The two slices of the document the names are read from. */
interface NamedSlices {
  readonly planning: AppStateSnapshot["tasks"] | undefined;
  readonly inbox: AppStateSnapshot["inbox"] | undefined;
}

/** The slices, which tell their readers only when either is a new object, so a delivery that kept both builds nothing. */
const namedSlicesAtom: Atom.Atom<NamedSlices> = Atom.withEquality(
  appStateDerivedAtom((state): NamedSlices => ({ planning: state?.tasks, inbox: state?.inbox })),
  (held, next) => held.planning === next.planning && held.inbox === next.inbox,
);

/** The names the document holds, no people among them, the one value every reader of this window shares. */
const heldNamesAtom: Atom.Atom<KnownNames> = Atom.map(namedSlicesAtom, ({ planning, inbox }) => {
  const tasks = new Map(planning?.tasks.map((task) => [task.id, task.name]));
  const agents = new Map<string, string>();
  const agentModels = new Map<string, string>();
  for (const task of planning?.tasks ?? []) {
    for (const agent of task.agents?.agents ?? []) {
      agents.set(agent.id, agentTabLabel(agent));
      agentModels.set(agent.id, agent.model);
    }
  }
  const automations = new Map<string, string>();
  for (const agent of planning?.tasklessAgents ?? []) {
    agents.set(agent.id, agentTabLabel(agent));
    agentModels.set(agent.id, agent.model);
    if (agent.automationId !== null && agent.automationName !== undefined) {
      automations.set(agent.automationId, agent.automationName);
    }
  }
  // Note that an item's brief names its agent as its row does now, so a title there stands over the list's.
  for (const item of inbox?.taskless ?? []) {
    if (item.agentTitle === null && agents.has(item.agentId)) continue;
    agents.set(
      item.agentId,
      agentTabLabel({
        title: item.agentTitle,
        model: item.agentModel,
        automationName: item.automationName ?? undefined,
      }),
    );
  }
  const pages = new Map(planning?.pages?.map((page) => [page.id, page.title]));
  const inboxItems = new Map(
    [...(inbox?.waiting ?? []).flatMap((task) => task.items), ...(inbox?.taskless ?? [])].map(
      (item) => [item.id, item.title],
    ),
  );
  return {
    tasks,
    agents,
    agentModels,
    pages,
    pagesTaskId: planning?.activeTaskId,
    inboxItems,
    people: NO_PEOPLE,
    automations,
  };
});

/** Each listed task's status, by its id, built once per delivery that moved the tasks or the Inbox, as the names are. */
const heldStatusesAtom: Atom.Atom<ReadonlyMap<string, TaskStatus>> = Atom.map(
  namedSlicesAtom,
  ({ planning }) =>
    new Map(
      (planning?.tasks ?? []).flatMap((task) =>
        task.status === undefined ? [] : [[task.id, task.status] as const],
      ),
    ),
);

/** Whether main's document holds no read of the task list yet, so nothing follows it and no task's name can land. */
const listUnreadAtom: Atom.Atom<boolean> = appStateDerivedAtom(
  (state) => state?.tasks.listStatus === TASKS_READ.IDLE,
);

/** Whether a chip has asked for the list since it was last unread, so the chips of one transcript ask once between them. */
const listAsked = { asked: false };

/**
 * Asks the window to follow its task list where a chip names a task and no
 * read of the list has started yet, once between every chip, so the task's
 * name lands. The list is followed live from its first read
 * (`compose-tasks.ts`), so a task the list holds Untitled or not at all
 * takes its name as the service names it, and asking again would read
 * nothing new; nothing for none asked for.
 */
export function useTaskNameCatchUp(taskId: string | undefined): void {
  const unread = useAtomValue(listUnreadAtom);
  useEffect(() => {
    if (!unread) {
      listAsked.asked = false;
      return;
    }
    if (taskId === undefined || listAsked.asked) return;
    listAsked.asked = true;
    tellAct(ACT_KIND.TASKS_REFRESH);
  }, [unread, taskId]);
}

/**
 * The status of the task `taskId` names, as the window's task list holds it,
 * which a chip or a row naming the task wears as its mark (`PlanGlyph`);
 * none for a task the window does not list, or none asked for.
 */
export function useTaskStatus(taskId: string | undefined): TaskStatus | undefined {
  const statuses = useAtomValue(heldStatusesAtom);
  return taskId === undefined ? undefined : statuses.get(taskId);
}

/**
 * The names the window holds, the automation `automationId` names among them
 * where the directory around the caller lists it. Outside a member directory
 * and with no automation asked for, every caller is handed the one shared
 * value, which stays the same object until the tasks or the Inbox move.
 */
export function useKnownNames(automationId?: string): KnownNames {
  const held = useAtomValue(heldNamesAtom);
  const { members, former } = useMemberDirectory();
  const automation = useAutomation(automationId)?.automation;
  const people = useMemo(
    () =>
      members === undefined && former === undefined
        ? NO_PEOPLE
        : new Map([...(former ?? []), ...(members ?? [])].map((each) => [each.userId, each.name])),
    [members, former],
  );
  // Note that the directory's automation is its name now, so it stands over the name the run that started an agent kept.
  const automations = useMemo(
    () =>
      automation === undefined
        ? held.automations
        : new Map([...held.automations, [automation.id, automation.name]]),
    [held.automations, automation],
  );
  return useMemo(
    () =>
      people === held.people && automations === held.automations
        ? held
        : { ...held, people, automations },
    [held, people, automations],
  );
}

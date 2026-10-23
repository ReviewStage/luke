import { useAtomValue } from "@effect/atom-react/Hooks";
import { agentTabLabel } from "@luke/features/model-label";
import type { KnownNames } from "@luke/features/place-chip-model";
import { type TaskStatus, UNTITLED_TASK_NAME } from "@luke/features/task-wire";
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
 * does not hold is not here; a chip naming a task the list does not hold,
 * or holds Untitled, asks the list read again once (`useTaskNameCatchUp`).
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

/** Whether the window's task list landed, so a task it does not list is one it cannot read rather than one not read yet. */
const listReadAtom: Atom.Atom<boolean> = appStateDerivedAtom(
  (state) => state?.tasks.listStatus === TASKS_READ.READY,
);

/**
 * The tasks a chip has asked the list read again for, each once in the
 * window's life, and the names the last read was asked over, so the chips
 * of one transcript drawn together ask one read between them.
 */
const caughtUp: { readonly asked: Set<string>; over: ReadonlyMap<string, string> | undefined } = {
  asked: new Set(),
  over: undefined,
};

/**
 * Asks the task list read again where a chip names the task `taskId` names
 * and the list does not hold it, or holds it Untitled, once for each task,
 * since a task takes its name on the service and the window hears no push
 * for a task's row; nothing for none asked for, or before the list landed.
 */
export function useTaskNameCatchUp(taskId: string | undefined, known: KnownNames): void {
  const listRead = useAtomValue(listReadAtom);
  const held = taskId === undefined ? undefined : known.tasks.get(taskId);
  const behind =
    listRead && taskId !== undefined && (held ?? UNTITLED_TASK_NAME) === UNTITLED_TASK_NAME;
  useEffect(() => {
    if (!behind || taskId === undefined || caughtUp.asked.has(taskId)) return;
    caughtUp.asked.add(taskId);
    if (caughtUp.over === known.tasks) return;
    caughtUp.over = known.tasks;
    tellAct(ACT_KIND.TASKS_REFRESH);
  }, [behind, taskId, known.tasks]);
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

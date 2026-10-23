import { useAtomValue } from "@effect/atom-react/Hooks";
import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import type { KnownNames } from "@luke/features/place-chip-model";
import type { TaskStatus } from "@luke/features/task-wire";
import { taskKey } from "@luke/features/workspace-key";
import type { AppStateSnapshot } from "@luke/host/app-state";
import * as Atom from "effect/reactivity/Atom";
import { useMemo } from "react";
import { useAutomation } from "../automation-directory.js";
import { useMemberDirectory } from "../member-directory.js";
import { appStateDerivedAtom } from "../use-app-state.js";

/**
 * use-known-names.ts -- the names the window already holds for places in Luke, by id, for a chip to call a Luke link by.
 *
 * Read from main's document, which every window holds: every task's title,
 * the agents each task's row names and the models they run on, the agents
 * with no task the list carries, theirs, and the automations that started
 * them, the active task's pages, each task's key, the Inbox
 * items waiting, and the agents an automation started with no task; and
 * from the directories standing around the caller, the members and the
 * automation asked for. Nothing is fetched, so a name the window does not
 * hold is not here.
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
      if (agent.title !== null) agents.set(agent.id, agent.title);
      agentModels.set(agent.id, agent.model);
    }
  }
  const automations = new Map<string, string>();
  for (const agent of planning?.tasklessAgents ?? []) {
    if (agent.title !== null) agents.set(agent.id, agent.title);
    agentModels.set(agent.id, agent.model);
    if (agent.automationId !== null && agent.automationName !== undefined) {
      automations.set(agent.automationId, agent.automationName);
    }
  }
  for (const item of inbox?.taskless ?? []) {
    if (item.agentTitle !== null) agents.set(item.agentId, item.agentTitle);
  }
  const pages = new Map(planning?.pages?.map((page) => [page.id, page.title]));
  const inboxItems = new Map(
    [...(inbox?.waiting ?? []).flatMap((task) => task.items), ...(inbox?.taskless ?? [])].map(
      (item) => [item.id, item.title],
    ),
  );
  return { tasks, agents, agentModels, pages, inboxItems, people: NO_PEOPLE, automations };
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

/** No keys: what a window listing no numbered task holds, one object for every reader. */
const NO_KEY_TARGETS: ReadonlyMap<string, string> = new Map();

/** Whether two sets of keys name the same tasks by the same links, which a delivery that moved no task's key keeps. */
function sameTargets(
  held: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): boolean {
  if (held.size !== next.size) return false;
  for (const [key, target] of held) if (next.get(key) !== target) return false;
  return true;
}

/**
 * Each listed task's key (`ACME-42`), the link its mention is written with,
 * built once per delivery that moved the tasks or the Inbox, as the names
 * are. A key two tasks share, as two workspaces whose names begin alike
 * give theirs, names neither, so words never chip the wrong task. It tells
 * its readers only when a key or its link changed, which a task's other
 * moves never do, so the words drawn with it are read again only then.
 */
const heldKeyTargetsAtom: Atom.Atom<ReadonlyMap<string, string>> = Atom.withEquality(
  Atom.map(namedSlicesAtom, ({ planning }) => {
    const workspaces = new Map(planning?.workspaces.map((workspace) => [workspace.id, workspace]));
    const targets = new Map<string, string>();
    const shared = new Set<string>();
    for (const task of planning?.tasks ?? []) {
      const workspace = workspaces.get(task.workspaceId);
      if (workspace === undefined || task.number === undefined) continue;
      const key = taskKey(workspace.name, task.number);
      if (targets.has(key)) shared.add(key);
      const place = { workspace: workspace.slug ?? "", repository: null };
      targets.set(key, encodeMention({ kind: MENTION_KIND.TASK, taskId: task.id }, place));
    }
    for (const key of shared) targets.delete(key);
    return targets.size === 0 ? NO_KEY_TARGETS : targets;
  }),
  sameTargets,
);

/**
 * The link each listed task's key names its task by, which words written
 * with a key in them are drawn with as that task's chip; the one shared
 * value, the same object until a task's key or its link changes.
 */
export function useTaskKeyTargets(): ReadonlyMap<string, string> {
  return useAtomValue(heldKeyTargetsAtom);
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

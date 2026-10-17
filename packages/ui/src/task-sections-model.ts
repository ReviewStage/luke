/**
 * task-sections-model.ts -- the sidebar's sections, their order, the tasks each holds, and the writes a drag or a menu asks of them.
 *
 * Every function is pure over the account's sections as the service last
 * answered them (`@luke/features/task-section-wire`). A write the window
 * asked and the service has not yet answered is drawn by `applySectionWrite`
 * over what was read, so a drop lands where it was let go before the
 * service's word comes back. The sections stand in the order dragged, a
 * section never dragged on top, newest made first, as Pinned's pins do
 * (`pin-order.ts`), and so do the tasks in each.
 */

import { inPinOrder, type PinPlace, pinPositionsForMove } from "@luke/features/pin-order";
import {
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSectionEntry,
  type TaskSections,
  type TaskSectionWrite,
} from "@luke/features/task-section-wire";

/** What a refused change to the sections says, the drag or the menu that asked having gone. */
export const SECTION_WRITE_FAILED_NOTE = "Your sections could not be changed. Try again.";

/** No sections and no tasks in any, as before the first read lands. */
export const NO_TASK_SECTIONS: TaskSections = { sections: [], entries: [] };

/** Where a section stands among the others. */
const sectionPlace = (section: TaskSection): PinPlace => ({
  position: section.position,
  at: section.createdAt,
});

/** Where an entry stands among its section's tasks. */
const entryPlace = (entry: TaskSectionEntry): PinPlace => ({
  position: entry.position,
  at: entry.addedAt,
});

/** The entries but the task's, which a write that moves it replaces. */
function withoutTask(entries: readonly TaskSectionEntry[], taskId: string): TaskSectionEntry[] {
  return entries.filter((entry) => entry.taskId !== taskId);
}

/** A task put in a section, or moved within it, as the service would keep it. */
function placed(
  state: TaskSections,
  write: Extract<TaskSectionWrite, { kind: typeof TASK_SECTION_WRITE.PLACE }>,
  now: number,
): TaskSections {
  const { taskId, sectionId, position } = write;
  const others = withoutTask(state.entries, taskId);
  if (sectionId === null) return { ...state, entries: others };
  if (!state.sections.some((section) => section.id === sectionId)) return state;
  const standing = state.entries.find((entry) => entry.taskId === taskId);
  const kept = standing?.sectionId === sectionId ? standing : undefined;
  const at = kept?.addedAt ?? now;
  const where = position ?? (kept === undefined ? undefined : kept.position);
  const entry: TaskSectionEntry = {
    taskId,
    sectionId,
    addedAt: at,
    ...(where === undefined ? undefined : { position: where }),
  };
  return { ...state, entries: [...others, entry] };
}

/**
 * The sections as the service will answer them once it has taken `write`,
 * made at `now`: a section made, edited, moved, or deleted with its
 * entries, or a task put in a section or in none. A write naming a section
 * the state does not hold changes nothing, as the service refuses it.
 */
export function applySectionWrite(
  state: TaskSections,
  write: TaskSectionWrite,
  now: number,
): TaskSections {
  switch (write.kind) {
    case TASK_SECTION_WRITE.CREATE: {
      if (state.sections.some((section) => section.id === write.id)) return state;
      const { id, workspaceId, title, icon } = write;
      const made: TaskSection = {
        id,
        workspaceId,
        title,
        createdAt: now,
        ...(icon === undefined ? undefined : { icon }),
      };
      return { ...state, sections: [...state.sections, made] };
    }
    case TASK_SECTION_WRITE.EDIT:
      return {
        ...state,
        sections: state.sections.map((section) => {
          if (section.id !== write.id) return section;
          const { icon: _, ...rest } = section;
          return {
            ...rest,
            title: write.title,
            ...(write.icon === null ? undefined : { icon: write.icon }),
          };
        }),
      };
    case TASK_SECTION_WRITE.MOVE:
      return {
        ...state,
        sections: state.sections.map((section) =>
          section.id === write.id ? { ...section, position: write.position } : section,
        ),
      };
    case TASK_SECTION_WRITE.DELETE:
      return {
        sections: state.sections.filter((section) => section.id !== write.id),
        entries: state.entries.filter((entry) => entry.sectionId !== write.id),
      };
    case TASK_SECTION_WRITE.PLACE:
      return placed(state, write, now);
  }
}

/** The workspace's sections, in the order the sidebar draws them. */
export function workspaceSections(state: TaskSections, workspaceId: string): TaskSection[] {
  return inPinOrder(
    state.sections.filter((section) => section.workspaceId === workspaceId),
    sectionPlace,
  );
}

/** The section each task stands in, by the task's id. */
export function sectionEntries(state: TaskSections): ReadonlyMap<string, TaskSectionEntry> {
  return new Map(state.entries.map((entry) => [entry.taskId, entry]));
}

/** A section's entries, in the order the sidebar draws its tasks. */
export function sectionOrder(state: TaskSections, sectionId: string): TaskSectionEntry[] {
  return inPinOrder(
    state.entries.filter((entry) => entry.sectionId === sectionId),
    entryPlace,
  );
}

/** The writes that stand the section at `from` among `sections`, as drawn, at `to`. */
export function sectionMoveWrites(
  sections: readonly TaskSection[],
  from: number,
  to: number,
): TaskSectionWrite[] {
  return [...pinPositionsForMove(sections, from, to, sectionPlace)].map(([section, position]) => ({
    kind: TASK_SECTION_WRITE.MOVE,
    id: section.id,
    position,
  }));
}

/**
 * The writes that stand the task at `from` among a section's tasks as the
 * sidebar draws them, `order`, at `to`. Only the drawn tasks are counted,
 * since a task in the section that stands elsewhere, pinned or archived, is
 * no row the pointer passed.
 */
export function entryMoveWrites(
  order: readonly TaskSectionEntry[],
  sectionId: string,
  from: number,
  to: number,
): TaskSectionWrite[] {
  return [...pinPositionsForMove(order, from, to, entryPlace)].map(([entry, position]) => ({
    kind: TASK_SECTION_WRITE.PLACE,
    taskId: entry.taskId,
    sectionId,
    position,
  }));
}

/**
 * The writes that put the task in the section at `to` among the tasks it
 * draws, `order`, the task left out of the count, from another section or
 * from none; a task already among them is moved within it. The task's own
 * write comes first, so it stands in the section before any neighbour is
 * given a new place beside it. A task new to the section dropped on top
 * needs no place, since one never dragged stands on top.
 */
export function placeWrites(
  order: readonly TaskSectionEntry[],
  taskId: string,
  sectionId: string,
  to: number,
  now: number,
): TaskSectionWrite[] {
  const from = order.findIndex((entry) => entry.taskId === taskId);
  const at = Math.max(0, Math.min(to, order.length - (from < 0 ? 0 : 1)));
  if (from >= 0) return entryMoveWrites(order, sectionId, from, at);
  const moving: TaskSectionEntry = { taskId, sectionId, addedAt: now };
  const positions = pinPositionsForMove([moving, ...order], 0, at, entryPlace);
  const ownPosition = positions.get(moving);
  const first: TaskSectionWrite = {
    kind: TASK_SECTION_WRITE.PLACE,
    taskId,
    sectionId,
    ...(ownPosition === undefined ? undefined : { position: ownPosition }),
  };
  const rest = [...positions]
    .filter(([entry]) => entry !== moving)
    .map(
      ([entry, position]): TaskSectionWrite => ({
        kind: TASK_SECTION_WRITE.PLACE,
        taskId: entry.taskId,
        sectionId,
        position,
      }),
    );
  return [first, ...rest];
}

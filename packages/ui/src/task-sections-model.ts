/**
 * task-sections-model.ts -- the sidebar's sections, their order, the tasks and agents each holds, and the writes a drag or a menu asks of them.
 *
 * Every function is pure over the account's sections as the service last
 * answered them (`@luke/features/task-section-wire`). A write the window
 * asked and the service has not yet answered is drawn by `applySectionWrite`
 * over what was read, so a drop lands where it was let go before the
 * service's word comes back. The sections stand in the order dragged, a
 * section never dragged on top, newest made first, as Pinned's pins do
 * (`pin-order.ts`), and so do the rows in each, an agent with no task's
 * among the tasks' in the one order, as an agent's pin stands among the
 * plans' in Pinned.
 */

import {
  inPinOrder,
  type PinPlace,
  pinPositionsForInsert,
  pinPositionsForMove,
} from "@luke/features/pin-order";
import {
  type AgentSectionEntry,
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSectionEntry,
  type TaskSections,
  type TaskSectionWrite,
} from "@luke/features/task-section-wire";

/** What a refused change to the sections says, the drag or the menu that asked having gone. */
export const SECTION_WRITE_FAILED_NOTE = "Your sections could not be changed. Try again.";

/** No sections and no tasks in any, as before the first read lands. */
export const NO_TASK_SECTIONS: TaskSections = { sections: [], entries: [], agentEntries: [] };

/** A row a section keeps: a task's entry, or an agent with no task's. */
export type SectionEntry = TaskSectionEntry | AgentSectionEntry;

/** Which row a write puts in a section: a task, or an agent with no task, named as a pin's move names one. */
export interface SectionMember {
  readonly agent: boolean;
  readonly id: string;
}

/** Whether a section's row is an agent's. */
export function isAgentEntry(entry: SectionEntry): entry is AgentSectionEntry {
  return "agentId" in entry;
}

/** The row an entry keeps. */
export function memberOf(entry: SectionEntry): SectionMember {
  return isAgentEntry(entry)
    ? { agent: true, id: entry.agentId }
    : { agent: false, id: entry.taskId };
}

/** Whether an entry keeps the row named. */
function keeps(entry: SectionEntry, member: SectionMember): boolean {
  return isAgentEntry(entry) === member.agent && memberOf(entry).id === member.id;
}

/** The write that puts the row in a section at a place, or by its instant, or, under null, in none. */
function placeWrite(
  member: SectionMember,
  sectionId: string | null,
  position?: string,
): TaskSectionWrite {
  const where = position === undefined ? undefined : { position };
  return member.agent
    ? { kind: TASK_SECTION_WRITE.PLACE_AGENT, agentId: member.id, sectionId, ...where }
    : { kind: TASK_SECTION_WRITE.PLACE, taskId: member.id, sectionId, ...where };
}

/** An entry for the row, in the section, put there at `addedAt`. */
function entryFor(
  member: SectionMember,
  sectionId: string,
  addedAt: number,
  position?: string,
): SectionEntry {
  const where = position === undefined ? undefined : { position };
  return member.agent
    ? { agentId: member.id, sectionId, addedAt, ...where }
    : { taskId: member.id, sectionId, addedAt, ...where };
}

/** Where a section stands among the others. */
const sectionPlace = (section: TaskSection): PinPlace => ({
  position: section.position,
  at: section.createdAt,
});

/** Where an entry stands among its section's rows. */
const entryPlace = (entry: SectionEntry): PinPlace => ({
  position: entry.position,
  at: entry.addedAt,
});

/** Every entry of the state, the tasks' and the agents' alike. */
function allEntries(state: TaskSections): SectionEntry[] {
  return [...state.entries, ...state.agentEntries];
}

/** The state with its entries replaced, each kind back in its own list. */
function withEntries(state: TaskSections, entries: readonly SectionEntry[]): TaskSections {
  const tasks: TaskSectionEntry[] = [];
  const agents: AgentSectionEntry[] = [];
  for (const entry of entries) {
    if (isAgentEntry(entry)) agents.push(entry);
    else tasks.push(entry);
  }
  return { ...state, entries: tasks, agentEntries: agents };
}

/** A task or an agent put in a section, or moved within it, as the service would keep it. */
function placed(
  state: TaskSections,
  member: SectionMember,
  write: { readonly sectionId: string | null; readonly position?: string },
  now: number,
): TaskSections {
  const { sectionId, position } = write;
  const entries = allEntries(state);
  const others = entries.filter((entry) => !keeps(entry, member));
  if (sectionId === null) return withEntries(state, others);
  if (!state.sections.some((section) => section.id === sectionId)) return state;
  const standing = entries.find((entry) => keeps(entry, member));
  const kept = standing?.sectionId === sectionId ? standing : undefined;
  const where = position ?? kept?.position;
  return withEntries(state, [...others, entryFor(member, sectionId, kept?.addedAt ?? now, where)]);
}

/**
 * The sections as the service will answer them once it has taken `write`,
 * made at `now`: a section made, edited, moved, or deleted with its
 * entries, or a task or an agent put in a section or in none. A write naming a section
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
        agentEntries: state.agentEntries.filter((entry) => entry.sectionId !== write.id),
      };
    case TASK_SECTION_WRITE.PLACE:
      return placed(state, { agent: false, id: write.taskId }, write, now);
    case TASK_SECTION_WRITE.PLACE_AGENT:
      return placed(state, { agent: true, id: write.agentId }, write, now);
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

/** The section the row stands in, where it stands in one. */
export function memberSection(state: TaskSections, member: SectionMember): string | undefined {
  return allEntries(state).find((entry) => keeps(entry, member))?.sectionId;
}

/** A section's entries, the tasks' and the agents' together, in the order the sidebar draws its rows. */
export function sectionOrder(state: TaskSections, sectionId: string): SectionEntry[] {
  return inPinOrder(
    allEntries(state).filter((entry) => entry.sectionId === sectionId),
    entryPlace,
  );
}

/** The tasks of a section, in its order, its agents left out. */
export function sectionTaskIds(state: TaskSections, sectionId: string): string[] {
  return sectionOrder(state, sectionId).flatMap((entry) =>
    isAgentEntry(entry) ? [] : [entry.taskId],
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
 * The writes that stand the row at `from` among a section's rows as the
 * sidebar draws them, `order`, at `to`. Only the drawn rows are counted,
 * since a task or an agent in the section that stands elsewhere, pinned or
 * archived, is no row the pointer passed.
 */
export function entryMoveWrites(
  order: readonly SectionEntry[],
  sectionId: string,
  from: number,
  to: number,
): TaskSectionWrite[] {
  return [...pinPositionsForMove(order, from, to, entryPlace)].map(([entry, position]) =>
    placeWrite(memberOf(entry), sectionId, position),
  );
}

/**
 * The writes that put the row, a task or an agent, in the section at `to`
 * among the rows it draws, `order`, the row left out of the count, from
 * another section or from none; a row already among them is moved within
 * it. The row's own write comes first, so it stands in the section before
 * any neighbour is given a new place beside it. A row new to the section
 * dropped on top needs no place, since one never dragged stands on top.
 */
export function placeWrites(
  order: readonly SectionEntry[],
  member: SectionMember,
  sectionId: string,
  to: number,
  now: number,
): TaskSectionWrite[] {
  const from = order.findIndex((entry) => keeps(entry, member));
  const at = Math.max(0, Math.min(to, order.length - (from < 0 ? 0 : 1)));
  if (from >= 0) return entryMoveWrites(order, sectionId, from, at);
  const moving = entryFor(member, sectionId, now);
  const positions = pinPositionsForMove([moving, ...order], 0, at, entryPlace);
  const first = placeWrite(member, sectionId, positions.get(moving));
  const rest = [...positions]
    .filter(([entry]) => entry !== moving)
    .map(([entry, position]) => placeWrite(memberOf(entry), sectionId, position));
  return [first, ...rest];
}

/**
 * The writes that put `members`, tasks and agents in their order, on top of
 * a section, from another section or from none, as a section's Move tasks
 * to asks: the last put first, so the first stands on top. Note that each
 * is given a position, even on top, unlike `placeWrites`, because rows
 * moved together are stamped by the service's clock in the same instant,
 * which would leave their order among themselves to chance.
 */
export function placeAllWrites(
  state: TaskSections,
  members: readonly SectionMember[],
  sectionId: string,
  now: number,
): TaskSectionWrite[] {
  let order = sectionOrder(state, sectionId).filter(
    (entry) => !members.some((member) => keeps(entry, member)),
  );
  const writes: TaskSectionWrite[] = [];
  for (const member of [...members].reverse()) {
    const entry = entryFor(member, sectionId, now);
    const positions = pinPositionsForInsert(order, entry, 0, entryPlace);
    // Note that the order is kept here rather than read back from the state, because a section just made is in none yet.
    order = [entry, ...order].map((each) => {
      const position = positions.get(each);
      return position === undefined ? each : { ...each, position };
    });
    // The moving row stands first in the answer, so its own write goes ahead of its neighbours'.
    for (const [each, position] of positions) {
      writes.push(placeWrite(memberOf(each), sectionId, position));
    }
  }
  return writes;
}

/** The writes that take `members`, tasks and agents, out of every section, as a section's Remove tasks from section asks. */
export function unplaceAllWrites(members: readonly SectionMember[]): TaskSectionWrite[] {
  return members.map((member) => placeWrite(member, null));
}

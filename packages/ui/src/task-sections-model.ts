/**
 * task-sections-model.ts -- the sidebar's sections, their order, the tasks and agents each holds, and the writes a drag or a menu asks of them.
 *
 * Every function is pure over the account's sections as the host draws them
 * (`@luke/features/task-section-wire`), a write the service has not yet
 * answered among them (`@luke/features/task-section-writes`), so a drop
 * lands where it was let go before the service's word comes back. The
 * sections stand in the order dragged, a
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
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSectionEntry,
  type TaskSections,
  type TaskSectionWrite,
} from "@luke/features/task-section-wire";
import {
  allEntries,
  entryFor,
  isAgentEntry,
  keepsMember,
  memberOf,
  type SectionEntry,
  type SectionMember,
} from "@luke/features/task-section-writes";

/** What a refused change to the sections says, the drag or the menu that asked having gone. */
export const SECTION_WRITE_FAILED_NOTE = "Your sections could not be changed. Try again.";

/** No sections and no tasks in any, as before the first read lands. */
export const NO_TASK_SECTIONS: TaskSections = { sections: [], entries: [], agentEntries: [] };

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
  return allEntries(state).find((entry) => keepsMember(entry, member))?.sectionId;
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
  const from = order.findIndex((entry) => keepsMember(entry, member));
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
    (entry) => !members.some((member) => keepsMember(entry, member)),
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

/**
 * The writes an Undo of moving `members` into `movedTo`, or out of every
 * section under null, asks: each member still standing where the move put
 * it goes back where it stood in `before`, in its section after the rows
 * that stood above it there and still do, or in none. One moved anywhere
 * since stays, since that was chosen anew. Note that each is given a
 * position, as `placeAllWrites` gives one, because one put back by its
 * instant alone would stand above the rows it stood under.
 */
export function restoreWrites(
  before: TaskSections,
  current: TaskSections,
  members: readonly SectionMember[],
  movedTo: string | null,
  now: number,
): TaskSectionWrite[] {
  const due = members.filter((member) => (memberSection(current, member) ?? null) === movedTo);
  const writes: TaskSectionWrite[] = [];
  const orders = new Map<string, SectionEntry[]>();
  const back = due.map((member) => {
    const from = memberSection(before, member);
    const was = from === undefined ? [] : sectionOrder(before, from);
    return { member, from, was, at: was.findIndex((entry) => keepsMember(entry, member)) };
  });
  // Note that each section's rows go back from the top down, so each lands under those put back before it.
  for (const { member, from, was, at } of back.sort((a, b) => a.at - b.at)) {
    if (from === undefined) {
      writes.push(placeWrite(member, null));
      continue;
    }
    const order = orders.get(from) ?? sectionOrder(current, from);
    const above = was
      .slice(0, at)
      .filter((entry) => order.some((each) => keepsMember(each, memberOf(entry)))).length;
    const entry = entryFor(member, from, now);
    const positions = pinPositionsForInsert(order, entry, above, entryPlace);
    const next = [...order];
    next.splice(Math.min(above, order.length), 0, entry);
    orders.set(
      from,
      next.map((each) => {
        const position = positions.get(each);
        return position === undefined ? each : { ...each, position };
      }),
    );
    for (const [each, position] of positions) {
      writes.push(placeWrite(memberOf(each), from, position));
    }
  }
  return writes;
}

/** The writes that take `members`, tasks and agents, out of every section, as a section's Remove tasks from section asks. */
export function unplaceAllWrites(members: readonly SectionMember[]): TaskSectionWrite[] {
  return members.map((member) => placeWrite(member, null));
}

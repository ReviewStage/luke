import {
  inPinOrder,
  type PinPlace,
  pinPositionsForInsert,
  pinPositionsForMove,
} from "@repo/features/pin-order";
import {
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSectionEntry,
  type TaskSections,
  type TaskSectionWrite,
} from "@repo/features/task-section-wire";
import {
  allEntries,
  entryFor,
  isAgentEntry,
  keepsMember,
  memberOf,
  type SectionEntry,
  type SectionMember,
} from "@repo/features/task-section-writes";

export const SECTION_WRITE_FAILED_NOTE = "Your sections could not be changed. Try again.";

export const NO_TASK_SECTIONS: TaskSections = { sections: [], entries: [], agentEntries: [] };

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

const sectionPlace = (section: TaskSection): PinPlace => ({
  position: section.position,
  at: section.createdAt,
});

const entryPlace = (entry: SectionEntry): PinPlace => ({
  position: entry.position,
  at: entry.addedAt,
});

export function workspaceSections(state: TaskSections, workspaceId: string): TaskSection[] {
  return inPinOrder(
    state.sections.filter((section) => section.workspaceId === workspaceId),
    sectionPlace,
  );
}

export function sectionEntries(state: TaskSections): ReadonlyMap<string, TaskSectionEntry> {
  return new Map(state.entries.map((entry) => [entry.taskId, entry]));
}

export function memberSection(state: TaskSections, member: SectionMember): string | undefined {
  return allEntries(state).find((entry) => keepsMember(entry, member))?.sectionId;
}

export function sectionOrder(state: TaskSections, sectionId: string): SectionEntry[] {
  return inPinOrder(
    allEntries(state).filter((entry) => entry.sectionId === sectionId),
    entryPlace,
  );
}

export function sectionTaskIds(state: TaskSections, sectionId: string): string[] {
  return sectionOrder(state, sectionId).flatMap((entry) =>
    isAgentEntry(entry) ? [] : [entry.taskId],
  );
}

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
    order = [entry, ...order].map((each) => {
      const position = positions.get(each);
      return position === undefined ? each : { ...each, position };
    });
    for (const [each, position] of positions) {
      writes.push(placeWrite(memberOf(each), sectionId, position));
    }
  }
  return writes;
}

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

export function unplaceAllWrites(members: readonly SectionMember[]): TaskSectionWrite[] {
  return members.map((member) => placeWrite(member, null));
}

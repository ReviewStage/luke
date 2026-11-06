import {
  type AgentSectionEntry,
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSectionEntry,
  type TaskSections,
  type TaskSectionWrite,
} from "./task-section-wire.js";

export type SectionEntry = TaskSectionEntry | AgentSectionEntry;

export interface SectionMember {
  readonly agent: boolean;
  readonly id: string;
}

export function isAgentEntry(entry: SectionEntry): entry is AgentSectionEntry {
  return "agentId" in entry;
}

export function memberOf(entry: SectionEntry): SectionMember {
  return isAgentEntry(entry)
    ? { agent: true, id: entry.agentId }
    : { agent: false, id: entry.taskId };
}

export function keepsMember(entry: SectionEntry, member: SectionMember): boolean {
  return isAgentEntry(entry) === member.agent && memberOf(entry).id === member.id;
}

export function entryFor(
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

export function allEntries(state: TaskSections): SectionEntry[] {
  return [...state.entries, ...state.agentEntries];
}

function withEntries(state: TaskSections, entries: readonly SectionEntry[]): TaskSections {
  const tasks: TaskSectionEntry[] = [];
  const agents: AgentSectionEntry[] = [];
  for (const entry of entries) {
    if (isAgentEntry(entry)) agents.push(entry);
    else tasks.push(entry);
  }
  return { ...state, entries: tasks, agentEntries: agents };
}

function placed(
  state: TaskSections,
  member: SectionMember,
  write: { readonly sectionId: string | null; readonly position?: string },
  now: number,
): TaskSections {
  const { sectionId, position } = write;
  const entries = allEntries(state);
  const others = entries.filter((entry) => !keepsMember(entry, member));
  if (sectionId === null) return withEntries(state, others);
  if (!state.sections.some((section) => section.id === sectionId)) return state;
  const standing = entries.find((entry) => keepsMember(entry, member));
  const kept = standing?.sectionId === sectionId ? standing : undefined;
  const where = position ?? kept?.position;
  return withEntries(state, [...others, entryFor(member, sectionId, kept?.addedAt ?? now, where)]);
}

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

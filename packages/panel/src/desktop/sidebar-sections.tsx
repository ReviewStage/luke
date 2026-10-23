import {
  TASK_SECTION_BOUNDS,
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSectionIcon,
  type TaskSectionWrite,
} from "@luke/features/task-section-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import {
  BUTTON_SIZE,
  ConfirmDialog,
  DIALOG_TONE,
  type DialogConfirm,
  EllipsisIcon,
  GAP,
  IconButton,
  LAYOUT_ELEMENT,
  MarkDoneIcon,
  NOTE_LINE_LOOK,
  NoteLine,
  PencilIcon,
  Stack,
  TextField,
  Tooltip,
  TrashIcon,
  useConfirmDialog,
  useLeaving,
  useMenu,
} from "@luke/ui";
import { TASK_ROW, type TaskRow, taskRowKey } from "@luke/ui/task-list-model";
import {
  memberOf,
  memberSection,
  placeAllWrites,
  placeWrites,
  type SectionEntry,
  type SectionMember,
  sectionMoveWrites,
  sectionOrder,
  unplaceAllWrites,
  workspaceSections,
} from "@luke/ui/task-sections-model";
import { SETTLED_STATUS, settleOffered } from "@luke/ui/tasks-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { FolderOutputIcon, LayersIcon, MailOpenIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useReadMarks } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "./action-menu.js";
import { type RowPlace, RowPlaced, withRowMoves } from "./row-moves.js";
import { SectionIconPicker, sectionGlyph } from "./section-icon-picker.js";
import { SidebarGroupHeader } from "./sidebar-group-header.js";
import { useRowDrag } from "./use-row-drag.js";

/**
 * sidebar-sections.tsx -- the account's own sections in the sidebar, between Pinned and Tasks: each a title, and an icon where one was chosen, over the tasks and agents kept in it, the dialog that makes and edits one, and the Move to section of a task's menu and an agent's.
 *
 * A section is the reader's own (`task-section-wire.ts`), so nothing here
 * is a teammate's. Each stands under a header like a repository's, its icon
 * where a repository's picture stands, or its title alone where it has none,
 * folded and kept as a repository's
 * fold is, with Edit section and Delete section on its ⋯ and a right-click,
 * and between them, while it holds rows, what acts on all of them at once:
 * Mark all as read while any task is unread, Move tasks to another section
 * or a new one and Remove tasks from section, which take its agents with
 * its tasks, and Mark tasks done, which sets its tasks all Done and asks
 * nothing, as a repository's does. An agent with no task stands among its
 * tasks as a task does, in the one order, and is dragged as one.
 * Its rows stand in the order dragged, and a row is dragged within its
 * section, into another, onto Tasks, which takes it out of every section,
 * or onto Pinned, which pins it there and takes it out of every section too
 * (`use-row-drag.ts`'s drop zones); a section is dragged among the others
 * by its header. Every change is drawn at once and kept on the account
 * (`TasksControl.onWriteSections`). Deleting a section asks first, though
 * it deletes no task, because its title and icon are not brought back.
 */

/** The zone Tasks is as a drop zone, which takes a task out of every section; a section's is its id. */
export const TASKS_DROP_ZONE = "tasks";

/** The zone Pinned is as a drop zone, which pins a task where it is let go and takes it out of every section. */
export const PINNED_DROP_ZONE = "pinned";

/** What a press must land in to drag a section rather than one of its tasks. */
const SECTION_HANDLE = ".sidebar-repository-header";

/** Why a blank title was not kept. */
const TITLE_ASKED = "Name the section.";

/** What the dialog was opened to do: make a section in a workspace, then perhaps more with it, or edit one. */
type SectionAsk =
  | {
      readonly kind: typeof TASK_SECTION_WRITE.CREATE;
      readonly workspaceId: string;
      readonly after: ((sectionId: string) => readonly TaskSectionWrite[]) | undefined;
    }
  | { readonly kind: typeof TASK_SECTION_WRITE.EDIT; readonly section: TaskSection };

/** The section dialogs' doors, and the cards they open. */
export interface SectionDialogs {
  /** Opens New section in a workspace; `after` is what to write with the section once made, a task moved into it. */
  askNew: (workspaceId: string, after?: (sectionId: string) => readonly TaskSectionWrite[]) => void;
  askEdit: (section: TaskSection) => void;
  askDelete: (section: TaskSection) => void;
  dialog: React.JSX.Element;
}

/** The writes a section dialog's answer makes. */
function answerWrites(ask: SectionAsk, title: string, icon: TaskSectionIcon | undefined) {
  if (ask.kind === TASK_SECTION_WRITE.EDIT) {
    return [{ kind: TASK_SECTION_WRITE.EDIT, id: ask.section.id, title, icon: icon ?? null }];
  }
  const id = crypto.randomUUID();
  const made: TaskSectionWrite = {
    kind: TASK_SECTION_WRITE.CREATE,
    id,
    workspaceId: ask.workspaceId,
    title,
    ...(icon === undefined ? undefined : { icon }),
  };
  return [made, ...(ask.after?.(id) ?? [])];
}

/**
 * New section, Edit section, and Delete section's question, standing only
 * while `surfaceOpen` and an account is signed in. New and Edit ask a
 * title, held to the wire's bound, and an icon; Enter in the title answers.
 * Every answer is drawn at once, so the card never waits on the service.
 */
export function useSectionDialogs(tasks: TasksControl, surfaceOpen: boolean): SectionDialogs {
  const [ask, setAsk] = useState<SectionAsk | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState<TaskSectionIcon | undefined>(undefined);
  const [doomed, setDoomed] = useState<TaskSection | undefined>(undefined);
  const field = useRef<HTMLInputElement | null>(null);
  // Note that a question about a section goes with the section, deleted on another Mac or by a refresh.
  const standing = (section: TaskSection | undefined) =>
    section !== undefined && tasks.taskSections.sections.some((each) => each.id === section.id);
  const asked = ask?.kind === TASK_SECTION_WRITE.EDIT ? standing(ask.section) : true;
  const confirm: DialogConfirm = useConfirmDialog(
    { subject: tasks.signedIn && asked, surfaceOpen },
    (): Promise<ActionResult> => {
      const trimmed = title.trim();
      if (trimmed === "" || ask === undefined) {
        return Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: TITLE_ASKED });
      }
      tasks.onWriteSections(answerWrites(ask, trimmed, icon));
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
  );
  const deletion = useConfirmDialog(
    { subject: tasks.signedIn && standing(doomed), surfaceOpen },
    (): Promise<ActionResult> => {
      if (doomed !== undefined) {
        tasks.onWriteSections([{ kind: TASK_SECTION_WRITE.DELETE, id: doomed.id }]);
      }
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
  );
  const open = (next: SectionAsk, words: string, chosen: TaskSectionIcon | undefined) => {
    setAsk(next);
    setTitle(words);
    setIcon(chosen);
    confirm.ask();
  };
  const editing = ask?.kind === TASK_SECTION_WRITE.EDIT;
  const dialog = (
    <>
      <ConfirmDialog
        confirm={confirm}
        field={field}
        question={{
          title: editing ? "Edit section" : "New section",
          verb: editing ? "Save" : "Create section",
          running: editing ? "Saving" : "Creating section",
          tone: DIALOG_TONE.PRIMARY,
        }}
      >
        <TextField
          ref={field}
          label="Section title"
          spellCheck={false}
          placeholder="Section title"
          maxLength={TASK_SECTION_BOUNDS.MAX_TITLE_CHARS}
          value={title}
          disabled={confirm.busy}
          onChange={(next) => {
            setTitle(next);
            // Note that a refused answer has settled, so the refusal alone holds
            // the card up: the question is asked again rather than cleared, or
            // the first key typed after it would close the card.
            if (confirm.rejection !== undefined) confirm.ask();
          }}
        />
        {/* Keyed by what was asked, so each opening starts its tab, color, and search afresh from the icon it opened with. */}
        <SectionIconPicker
          key={ask?.kind === TASK_SECTION_WRITE.EDIT ? ask.section.id : TASK_SECTION_WRITE.CREATE}
          icon={icon}
          disabled={confirm.busy}
          onIcon={setIcon}
        />
      </ConfirmDialog>
      <ConfirmDialog
        confirm={deletion}
        question={{
          title: "Delete section?",
          body: `“${doomed?.title ?? ""}” leaves your sidebar, and its tasks go back under Tasks. No task is deleted.`,
          verb: "Delete section",
          running: "Deleting",
        }}
      />
    </>
  );
  return {
    askNew: (workspaceId, after) =>
      open({ kind: TASK_SECTION_WRITE.CREATE, workspaceId, after }, "", undefined),
    askEdit: (section) =>
      open({ kind: TASK_SECTION_WRITE.EDIT, section }, section.title, section.icon),
    askDelete: (section) => {
      setDoomed(section);
      deletion.ask();
    },
    dialog,
  };
}

/** The row a sidebar row is in a section: its task, or its agent with no task. */
export function rowMember(row: TaskRow): SectionMember {
  return row.kind === TASK_ROW.TASK
    ? { agent: false, id: row.task.id }
    : { agent: true, id: row.agent.id };
}

/**
 * The Move to section of a task's menu or an agent's: the row's workspace's
 * sections, the one it stands in checked, New section… to make one with the
 * row in it, and Remove from section while it stands in one. A row moved
 * here lands on top of its new section, as one dragged onto its header
 * would.
 */
export function moveToSectionEntry(
  tasks: TasksControl,
  member: SectionMember,
  workspaceId: string,
  askNew: SectionDialogs["askNew"],
): MenuEntry {
  const state = tasks.taskSections;
  const standing = memberSection(state, member);
  const put = (sectionId: string) =>
    placeWrites(sectionOrder(state, sectionId), member, sectionId, 0, Date.now());
  const sections = workspaceSections(state, workspaceId).map((section): MenuAction => {
    const glyph = sectionGlyph(section.icon);
    return {
      label: section.title,
      ...(glyph === undefined ? undefined : { icon: glyph }),
      checked: section.id === standing,
      onSelect: () => {
        if (section.id !== standing) tasks.onWriteSections(put(section.id));
      },
    };
  });
  const remove: MenuAction[] =
    standing === undefined
      ? []
      : [
          {
            label: "Remove from section",
            onSelect: () => tasks.onWriteSections(unplaceAllWrites([member])),
          },
        ];
  return {
    label: "Move to section",
    icon: <LayersIcon />,
    items: [
      ...sections,
      { label: "New section…", onSelect: () => askNew(workspaceId, put) },
      ...remove,
    ],
  };
}

/** One section's rows as the sidebar draws them: the entries in its order, each with the task's or the agent's row the list holds, one for one. */
export interface DrawnSection {
  readonly section: TaskSection;
  readonly entries: readonly SectionEntry[];
  readonly rows: readonly TaskRow[];
}

/** The tasks among a section's rows, in its order. */
export function drawnSectionTasks(drawn: DrawnSection): TaskSummary[] {
  return drawn.rows.flatMap((row) => (row.kind === TASK_ROW.TASK ? [row.task] : []));
}

/** What every section is drawn with. */
interface SectionContext {
  readonly tasks: TasksControl;
  readonly dialogs: SectionDialogs;
  /** Whether a row is the open one, the open task's or the agent's whose page stands, which a fold leaves standing. */
  readonly current: (row: TaskRow) => boolean;
  /** Whether a task is unread, as its row's weight says. */
  readonly unread: (task: TaskSummary) => boolean;
  /** Whether the sidebar is in sight, which the menus close without. */
  readonly inSight: boolean;
  readonly folded: (sectionId: string) => boolean;
  readonly onToggle: (sectionId: string) => void;
  /** A task's row or an agent's, as it stands in any list of the sidebar. */
  readonly row: (row: TaskRow) => React.JSX.Element;
  /** Hears a row let go over another zone: a section by its id, Tasks, or Pinned. */
  readonly onDropRow: (row: TaskRow, zone: string, at: number) => void;
}

/** What a section's actions on all its tasks run through beyond the section's writes: each asks or reaches past the sections. */
interface SectionDoors {
  readonly onMarkRead: () => void;
  /** Sets every task Done. */
  readonly onMarkDone: () => void;
}

/**
 * Move tasks to: the workspace's other sections and New section…, each
 * taking every row of the section, its agents' with its tasks', in its
 * order, onto the top of the one chosen.
 */
function moveTasksEntry(drawn: DrawnSection, context: SectionContext): MenuEntry {
  const { section } = drawn;
  const { tasks, dialogs } = context;
  const members = drawn.entries.map(memberOf);
  const put = (sectionId: string) =>
    placeAllWrites(tasks.taskSections, members, sectionId, Date.now());
  const others = workspaceSections(tasks.taskSections, section.workspaceId)
    .filter((other) => other.id !== section.id)
    .map((other): MenuAction => {
      const glyph = sectionGlyph(other.icon);
      return {
        label: other.title,
        ...(glyph === undefined ? undefined : { icon: glyph }),
        onSelect: () => tasks.onWriteSections(put(other.id)),
      };
    });
  return {
    label: "Move tasks to",
    icon: <LayersIcon />,
    items: [
      ...others,
      { label: "New section…", onSelect: () => dialogs.askNew(section.workspaceId, put) },
    ],
  };
}

/**
 * A section's menu: Edit section, then what acts on every row it draws
 * while it draws any, then Delete section. Only the rows drawn are acted
 * on, so one kept in it but pinned or archived, which it draws not, is
 * left where it stands; what only a task takes, a read mark or Done, acts
 * on its tasks alone.
 */
function sectionActionGroups(
  drawn: DrawnSection,
  context: SectionContext,
  doors: SectionDoors,
): MenuEntry[][] {
  const { section } = drawn;
  const { tasks, dialogs } = context;
  const edit: MenuEntry[] = [
    { label: "Edit section", icon: <PencilIcon />, onSelect: () => dialogs.askEdit(section) },
  ];
  const remove: MenuEntry[] = [
    {
      label: "Delete section",
      icon: <TrashIcon />,
      danger: true,
      onSelect: () => dialogs.askDelete(section),
    },
  ];
  if (drawn.rows.length === 0) return [edit, remove];
  const held = drawnSectionTasks(drawn);
  const read: MenuEntry[] = held.some(context.unread)
    ? [{ label: "Mark all as read", icon: <MailOpenIcon />, onSelect: doors.onMarkRead }]
    : [];
  const bulk: MenuEntry[] = [
    ...read,
    moveTasksEntry(drawn, context),
    {
      label: "Remove tasks from section",
      icon: <FolderOutputIcon />,
      onSelect: () => tasks.onWriteSections(unplaceAllWrites(drawn.entries.map(memberOf))),
    },
    ...(held.some((task) => settleOffered(task, SETTLED_STATUS.DONE))
      ? [{ label: "Mark tasks done", icon: <MarkDoneIcon />, onSelect: doors.onMarkDone }]
      : []),
  ];
  return [edit, bulk, remove];
}

/** One section: its header, its menu, and its rows, or a word that tasks are dragged in while it holds none. */
function SidebarSection({
  drawn,
  context,
  place,
}: {
  drawn: DrawnSection;
  context: SectionContext;
  /** Where the section stands among the sections, which its menu moves it from under a finger. */
  place: RowPlace;
}): React.JSX.Element {
  const { section } = drawn;
  const { tasks } = context;
  const folded = context.folded(section.id);
  const rows = folded ? drawn.rows.filter(context.current) : drawn.rows;
  const move = folded
    ? undefined
    : (from: number, to: number) => tasks.onWriteSections(placeWritesWithin(drawn, from, to));
  const drag = useRowDrag(move, {
    onDropOut: (from, zone, at) => {
      const row = rows[from];
      if (row !== undefined) context.onDropRow(row, zone, at);
    },
  });
  const menu = useMenu(tasks.shown && context.inSight);
  const ellipsis = useRef<HTMLButtonElement | null>(null);
  const reads = useReadMarks();
  // Note that a row on its way out has no place among the rows a drag or a menu moves.
  const shown = useLeaving(rows, taskRowKey);
  const listedAt = new Map(rows.map((row, at) => [taskRowKey(row), at]));
  const placeOf = (key: string) => {
    const at = listedAt.get(key);
    return move === undefined || at === undefined
      ? undefined
      : { at, count: rows.length, onMove: move };
  };
  const held = drawnSectionTasks(drawn);
  const groups = sectionActionGroups(drawn, context, {
    onMarkRead: () => {
      for (const task of held.filter(context.unread)) reads.mark(task, false);
    },
    onMarkDone: () =>
      tasks.onSettleTasks(
        held.map(({ id }) => id),
        SETTLED_STATUS.DONE,
      ),
  });
  const glyph = sectionGlyph(section.icon);
  return (
    <div
      className="sidebar-repository sidebar-own-section"
      data-row-drop={section.id}
      data-iconless={glyph === undefined ? "true" : undefined}
    >
      <SidebarGroupHeader
        glyph={glyph}
        name={section.title}
        folded={folded}
        count={drawn.rows.length}
        menuOpen={menu.open !== undefined}
        contextMenu={menu.contextMenu(ellipsis)}
        onToggle={() => context.onToggle(section.id)}
        actions={
          <Tooltip label="Section actions">
            <IconButton
              ref={ellipsis}
              icon={<EllipsisIcon />}
              label={`Actions for ${section.title}`}
              size={BUTTON_SIZE.COMPACT}
              {...menu.trigger()}
            />
          </Tooltip>
        }
      />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${section.title} actions`}
          menu={menu.drawn}
          groups={withRowMoves(groups, place)}
          onClose={menu.close}
        />
      )}
      {rows.length === 0 ? (
        folded ? null : (
          <div className="sidebar-section-slot">
            <NoteLine look={NOTE_LINE_LOOK.INSET}>Drag tasks here</NoteLine>
          </div>
        )
      ) : (
        // A folded section's rows are only the open one, so a drop over it lands on top rather than among them.
        <Stack
          as={LAYOUT_ELEMENT.UL}
          gap={GAP.ROW}
          className="sidebar-tasks"
          data-row-drop-rows={folded ? undefined : ""}
          moves
          onPointerDown={drag}
        >
          {shown.map(({ key, value: row }) => (
            <RowPlaced key={key} place={placeOf(key)}>
              {context.row(row)}
            </RowPlaced>
          ))}
        </Stack>
      )}
    </div>
  );
}

/** The writes that stand the row at `from` in a section, as drawn, at `to`. */
function placeWritesWithin(drawn: DrawnSection, from: number, to: number): TaskSectionWrite[] {
  const entry = drawn.entries[from];
  if (entry === undefined) return [];
  return placeWrites(drawn.entries, memberOf(entry), drawn.section.id, to, Date.now());
}

/**
 * The account's sections in the listed workspace, between Pinned and Tasks,
 * in the order dragged: a section's header is its handle, so a press on one
 * of its rows drags the row and not the section.
 */
export function SidebarSections({
  sections,
  context,
}: {
  sections: readonly DrawnSection[];
  context: SectionContext;
}): React.JSX.Element {
  const order = sections.map((drawn) => drawn.section);
  const move = (from: number, to: number) =>
    context.tasks.onWriteSections(sectionMoveWrites(order, from, to));
  const drag = useRowDrag(move, { handle: SECTION_HANDLE });
  return (
    <nav className="sidebar-group" aria-label="Sections">
      <Stack
        as={LAYOUT_ELEMENT.UL}
        gap={GAP.CONTROL}
        className="sidebar-sections"
        moves
        onPointerDown={drag}
      >
        {sections.map((drawn, at) => (
          <li key={drawn.section.id} className="sidebar-sections-item">
            <SidebarSection
              drawn={drawn}
              context={context}
              place={{ at, count: sections.length, onMove: move }}
            />
          </li>
        ))}
      </Stack>
    </nav>
  );
}

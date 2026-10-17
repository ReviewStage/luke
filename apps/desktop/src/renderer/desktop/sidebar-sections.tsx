import {
  TASK_SECTION_BOUNDS,
  TASK_SECTION_GLYPH,
  TASK_SECTION_ICON_KIND,
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSectionEntry,
  type TaskSectionGlyph,
  type TaskSectionIcon,
  type TaskSectionWrite,
  taskSectionIconSchema,
} from "@luke/features/task-section-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import {
  ConfirmDialog,
  DIALOG_TONE,
  type DialogConfirm,
  EllipsisIcon,
  PencilIcon,
  TrashIcon,
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import {
  placeWrites,
  sectionEntries,
  sectionMoveWrites,
  sectionOrder,
  workspaceSections,
} from "@luke/ui/task-sections-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { Schema } from "effect";
import {
  BanIcon,
  BookmarkIcon,
  BriefcaseIcon,
  BugIcon,
  CircleIcon,
  FlagIcon,
  FlaskConicalIcon,
  FolderIcon,
  HeartIcon,
  LayersIcon,
  type LucideIcon,
  RocketIcon,
  StarIcon,
  ZapIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import type { TasksControl } from "../tasks/use-tasks-tab";
import { Tooltip } from "../tooltip";
import { ActionMenu, type MenuAction, type MenuEntry } from "./action-menu";
import { SidebarGroupHeader } from "./sidebar-group-header";
import { useRowDrag } from "./use-row-drag";

/**
 * sidebar-sections.tsx -- the account's own sections in the sidebar, between Pinned and Tasks: each a title, and an icon where one was chosen, over the tasks kept in it, the dialog that makes and edits one, and the task menu's Move to section.
 *
 * A section is the reader's own (`task-section-wire.ts`), so nothing here
 * is a teammate's. Each stands under a header like a repository's, its icon
 * where a repository's picture stands, or its title alone where it has none,
 * folded and kept as a repository's
 * fold is, with Edit section and Delete section on its ⋯ and a right-click.
 * Its tasks stand in the order dragged, and a row is dragged within its
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

/** Each glyph a section may wear, by its name on the wire, and what the dialog calls it. */
const GLYPHS = {
  [TASK_SECTION_GLYPH.FOLDER]: { icon: FolderIcon, label: "Folder" },
  [TASK_SECTION_GLYPH.STAR]: { icon: StarIcon, label: "Star" },
  [TASK_SECTION_GLYPH.BOOKMARK]: { icon: BookmarkIcon, label: "Bookmark" },
  [TASK_SECTION_GLYPH.FLAG]: { icon: FlagIcon, label: "Flag" },
  [TASK_SECTION_GLYPH.ROCKET]: { icon: RocketIcon, label: "Rocket" },
  [TASK_SECTION_GLYPH.ZAP]: { icon: ZapIcon, label: "Lightning" },
  [TASK_SECTION_GLYPH.BUG]: { icon: BugIcon, label: "Bug" },
  [TASK_SECTION_GLYPH.FLASK]: { icon: FlaskConicalIcon, label: "Flask" },
  [TASK_SECTION_GLYPH.BRIEFCASE]: { icon: BriefcaseIcon, label: "Briefcase" },
  [TASK_SECTION_GLYPH.LAYERS]: { icon: LayersIcon, label: "Layers" },
  [TASK_SECTION_GLYPH.HEART]: { icon: HeartIcon, label: "Heart" },
  [TASK_SECTION_GLYPH.CIRCLE]: { icon: CircleIcon, label: "Circle" },
} as const satisfies Record<TaskSectionGlyph, { icon: LucideIcon; label: string }>;

/** The emoji the dialog offers at a press; any other is typed or picked with the system's own picker. */
const OFFERED_EMOJI = ["🚀", "🔥", "⭐", "🐛", "🎯", "💡", "🧪", "📌"] as const;

/** Why a blank title was not kept. */
const TITLE_ASKED = "Name the section.";

/** Whether a value is an icon the wire takes: one emoji, or a glyph it names. */
const isSectionIcon = Schema.is(taskSectionIconSchema);

/** A section's icon: its emoji, its glyph, or nothing for a section without one, which wears none. */
function sectionGlyph(icon: TaskSectionIcon | undefined): React.JSX.Element | undefined {
  if (icon === undefined) return undefined;
  if (icon.kind === TASK_SECTION_ICON_KIND.EMOJI) {
    return (
      <span className="sidebar-section-emoji" aria-hidden="true">
        {icon.emoji}
      </span>
    );
  }
  const Glyph = GLYPHS[icon.glyph].icon;
  return <Glyph />;
}

/** Whether two icons are the same, none being the same as none. */
function sameIcon(a: TaskSectionIcon | undefined, b: TaskSectionIcon | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.kind === TASK_SECTION_ICON_KIND.EMOJI) {
    return b.kind === TASK_SECTION_ICON_KIND.EMOJI && a.emoji === b.emoji;
  }
  return b.kind === TASK_SECTION_ICON_KIND.GLYPH && a.glyph === b.glyph;
}

/**
 * The dialog's choice of icon: none, each glyph, and a few emoji, each a
 * button pressed while it is the one chosen, and a field any one emoji is
 * typed or picked into, which chooses it as soon as it reads as one.
 */
function SectionIconPicker({
  icon,
  disabled,
  onIcon,
}: {
  icon: TaskSectionIcon | undefined;
  disabled: boolean;
  onIcon: (icon: TaskSectionIcon | undefined) => void;
}): React.JSX.Element {
  const [typed, setTyped] = useState(
    icon?.kind === TASK_SECTION_ICON_KIND.EMOJI && !OFFERED_EMOJI.some((one) => one === icon.emoji)
      ? icon.emoji
      : "",
  );
  const choice = (label: string, offered: TaskSectionIcon | undefined, face: React.ReactNode) => (
    <Tooltip key={label} label={label}>
      <button
        type="button"
        className="section-icon-choice"
        aria-label={label}
        aria-pressed={sameIcon(icon, offered)}
        disabled={disabled}
        onClick={() => onIcon(offered)}
      >
        {face}
      </button>
    </Tooltip>
  );
  return (
    <fieldset className="section-icon-picker" disabled={disabled}>
      <legend className="section-icon-legend">Icon</legend>
      <div className="section-icon-choices">
        {choice("No icon", undefined, <BanIcon />)}
        {Object.values(TASK_SECTION_GLYPH).map((glyph) =>
          choice(
            GLYPHS[glyph].label,
            { kind: TASK_SECTION_ICON_KIND.GLYPH, glyph },
            sectionGlyph({ kind: TASK_SECTION_ICON_KIND.GLYPH, glyph }),
          ),
        )}
        {OFFERED_EMOJI.map((emoji) =>
          choice(emoji, { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji }, emoji),
        )}
      </div>
      <input
        className="dialog-name-field section-emoji-field"
        aria-label="Any emoji"
        placeholder="Or type an emoji (⌃⌘Space)"
        spellCheck={false}
        value={typed}
        maxLength={TASK_SECTION_BOUNDS.MAX_EMOJI_UNITS}
        onChange={(event) => {
          const next = event.target.value;
          setTyped(next);
          const asked = { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: next.trim() };
          if (isSectionIcon(asked)) onIcon(asked);
        }}
      />
    </fieldset>
  );
}

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
        <input
          ref={field}
          className="dialog-name-field"
          aria-label="Section title"
          spellCheck={false}
          placeholder="Section title"
          maxLength={TASK_SECTION_BOUNDS.MAX_TITLE_CHARS}
          value={title}
          disabled={confirm.busy}
          onChange={(event) => {
            setTitle(event.target.value);
            confirm.clear();
          }}
        />
        {/* Keyed by what was asked, so each opening starts its typed emoji from the icon it opened with. */}
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

/**
 * The task menu's Move to section: the task's workspace's sections, the one
 * it stands in checked, New section… to make one with the task in it, and
 * Remove from section while it stands in one. A task moved here lands on
 * top of its new section, as one dragged onto its header would.
 */
export function moveToSectionEntry(
  tasks: TasksControl,
  task: TaskSummary,
  askNew: SectionDialogs["askNew"],
): MenuEntry {
  const state = tasks.taskSections;
  const standing = sectionEntries(state).get(task.id)?.sectionId;
  const put = (sectionId: string) =>
    placeWrites(sectionOrder(state, sectionId), task.id, sectionId, 0, Date.now());
  const sections = workspaceSections(state, task.workspaceId).map((section): MenuAction => {
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
            onSelect: () =>
              tasks.onWriteSections([
                { kind: TASK_SECTION_WRITE.PLACE, taskId: task.id, sectionId: null },
              ]),
          },
        ];
  return {
    label: "Move to section",
    icon: <LayersIcon />,
    items: [
      ...sections,
      { label: "New section…", onSelect: () => askNew(task.workspaceId, put) },
      ...remove,
    ],
  };
}

/** One section's tasks as the sidebar draws them: the entries in its order, each with the task the list holds. */
export interface DrawnSection {
  readonly section: TaskSection;
  readonly entries: readonly TaskSectionEntry[];
  readonly tasks: readonly TaskSummary[];
}

/** What every section is drawn with. */
interface SectionContext {
  readonly tasks: TasksControl;
  readonly dialogs: SectionDialogs;
  /** Whether a task is the open one, which a fold leaves standing. */
  readonly current: (taskId: string) => boolean;
  /** Whether the sidebar is in sight, which the menus close without. */
  readonly inSight: boolean;
  readonly folded: (sectionId: string) => boolean;
  readonly onToggle: (sectionId: string) => void;
  /** A task's row, as it stands in any list of the sidebar. */
  readonly row: (task: TaskSummary) => React.JSX.Element;
  /** Hears a task let go over another zone: a section by its id, Tasks, or Pinned. */
  readonly onDropTask: (taskId: string, zone: string, at: number) => void;
}

/** One section: its header, its menu, and its tasks, or a word that tasks are dragged in while it holds none. */
function SidebarSection({
  drawn,
  context,
}: {
  drawn: DrawnSection;
  context: SectionContext;
}): React.JSX.Element {
  const { section } = drawn;
  const { tasks, dialogs } = context;
  const folded = context.folded(section.id);
  const rows = folded ? drawn.tasks.filter((task) => context.current(task.id)) : drawn.tasks;
  const drag = useRowDrag(
    folded ? undefined : (from, to) => tasks.onWriteSections(placeWritesWithin(drawn, from, to)),
    {
      onDropOut: (from, zone, at) => {
        const task = rows[from];
        if (task !== undefined) context.onDropTask(task.id, zone, at);
      },
    },
  );
  const menu = useMenu(tasks.shown && context.inSight);
  const ellipsis = useRef<HTMLButtonElement | null>(null);
  const groups: MenuAction[][] = [
    [{ label: "Edit section", icon: <PencilIcon />, onSelect: () => dialogs.askEdit(section) }],
    [
      {
        label: "Delete section",
        icon: <TrashIcon />,
        danger: true,
        onSelect: () => dialogs.askDelete(section),
      },
    ],
  ];
  return (
    <div className="sidebar-repository sidebar-own-section" data-row-drop={section.id}>
      <SidebarGroupHeader
        glyph={sectionGlyph(section.icon)}
        name={section.title}
        folded={folded}
        count={drawn.tasks.length}
        menuOpen={menu.open !== undefined}
        onContextMenu={menu.contextMenu(ellipsis)}
        onToggle={() => context.onToggle(section.id)}
        actions={
          <Tooltip label="Section actions">
            <button
              ref={ellipsis}
              type="button"
              className="sidebar-repository-action"
              aria-label={`Actions for ${section.title}`}
              {...menu.trigger()}
            >
              <EllipsisIcon />
            </button>
          </Tooltip>
        }
      />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${section.title} actions`}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
      {rows.length === 0 ? (
        folded ? null : (
          <p className="sidebar-section-empty">Drag tasks here</p>
        )
      ) : (
        // A folded section's rows are only the open one, so a drop over it lands on top rather than among them.
        <ul
          className="sidebar-tasks"
          data-row-drop-rows={folded ? undefined : ""}
          onPointerDown={drag}
        >
          {rows.map(context.row)}
        </ul>
      )}
    </div>
  );
}

/** The writes that stand the task at `from` in a section, as drawn, at `to`. */
function placeWritesWithin(drawn: DrawnSection, from: number, to: number): TaskSectionWrite[] {
  const entry = drawn.entries[from];
  if (entry === undefined) return [];
  return placeWrites(drawn.entries, entry.taskId, drawn.section.id, to, Date.now());
}

/**
 * The account's sections in the listed workspace, between Pinned and Tasks,
 * in the order dragged: a section's header is its handle, so a press on one
 * of its tasks drags the task and not the section.
 */
export function SidebarSections({
  sections,
  context,
}: {
  sections: readonly DrawnSection[];
  context: SectionContext;
}): React.JSX.Element {
  const order = sections.map((drawn) => drawn.section);
  const drag = useRowDrag(
    (from, to) => context.tasks.onWriteSections(sectionMoveWrites(order, from, to)),
    { handle: SECTION_HANDLE },
  );
  return (
    <nav className="sidebar-group" aria-label="Sections">
      <ul className="sidebar-sections" onPointerDown={drag}>
        {sections.map((drawn) => (
          <li key={drawn.section.id} className="sidebar-sections-item">
            <SidebarSection drawn={drawn} context={context} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

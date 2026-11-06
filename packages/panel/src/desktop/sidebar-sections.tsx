import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  TASK_SECTION_BOUNDS,
  TASK_SECTION_ICON_KIND,
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSectionIcon,
  type TaskSections,
  type TaskSectionWrite,
} from "@repo/features/task-section-wire";
import {
  applySectionWrite,
  memberOf,
  type SectionEntry,
  type SectionMember,
} from "@repo/features/task-section-writes";
import type { TaskSummary } from "@repo/features/task-wire";
import { countWords, TERM } from "@repo/features/words";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  type DialogConfirm,
  FormField,
  GAP,
  GROUP_HEADING,
  GroupHeader,
  type GroupHeaderEditEnd,
  GroupHeaderEditor,
  type GroupHeaderEditorHandle,
  Inline,
  LAYOUT_ELEMENT,
  type ListRowNest,
  MoreButton,
  motionKey,
  NOTE_LINE_LOOK,
  NoteLine,
  nextRowOrHead,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextField,
  TrashIcon,
  useConfirmDialog,
  useLeaving,
  useMenu,
} from "@repo/ui";
import { FolderPlusIcon, MailOpenIcon } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import {
  type DrawnTaskRow,
  type HiddenStatus,
  TASK_ROW,
  type TaskRow,
  taskRowKey,
} from "@repo/ui/task-list-model";
import {
  memberSection,
  placeAllWrites,
  placeWrites,
  restoreWrites,
  sectionMoveWrites,
  sectionOrder,
  unplaceAllWrites,
  workspaceSections,
} from "@repo/ui/task-sections-model";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { commandAction, commandHead, PANEL_COMMAND } from "../command-items.js";
import { sameAnswer, useConfirmAct } from "../confirm-act.js";
import { confirmFailure } from "../failure-report.js";
import { useReadMarks } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { undoToast, useToast } from "../toast.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "./action-menu.js";
import { listedSlot, movedBeside, nestsOf, siblingsAt, useNestedRows } from "./nested-rows.js";
import { type RowPlace, RowPlaced, useRowMoveKeys, withRowMoves } from "./row-moves.js";
import { SectionIconWell, sectionGlyph } from "./section-icon-picker.js";
import { foldedCount, SIDEBAR_SECTION_SLOT, sidebarFold, TASK_NOUN } from "./sidebar-fold.js";
import { SidebarRun, type SidebarRunsPlace } from "./sidebar-run.js";
import { HiddenStatusesLine, NONE_MATCH } from "./sidebar-task-view.js";
import { useFormDialog } from "./use-form-dialog.js";
import { useRowDrag, useRunRowDrag } from "./use-row-drag.js";

export const TASKS_DROP_ZONE = "tasks";

export const PINNED_DROP_ZONE = "pinned";

const SECTION_HANDLE = ".ui-group-header-head";

const TITLE_ASKED = "Name the section.";

const SECTION_DELETED = "Section deleted";

export const NEW_SECTION = "New section";

interface SectionAsk {
  readonly workspaceId: string;
  readonly after: ((sectionId: string) => readonly TaskSectionWrite[]) | undefined;
  readonly moving: ReactNode;
}

export interface SectionDialogs {
  askNew: (
    workspaceId: string,
    after?: (sectionId: string) => readonly TaskSectionWrite[],
    moving?: ReactNode,
  ) => void;
  askDelete: (section: TaskSection, from: HTMLElement | null) => void;
  move: (
    members: readonly SectionMember[],
    movedTo: string | null,
    writes: readonly TaskSectionWrite[],
  ) => void;
  dialog: React.JSX.Element;
}

function createWrite(workspaceId: string, title: string, icon: TaskSectionIcon | undefined) {
  return {
    kind: TASK_SECTION_WRITE.CREATE,
    id: crypto.randomUUID(),
    workspaceId,
    title,
    ...(icon === undefined ? undefined : { icon }),
  } satisfies TaskSectionWrite;
}

function answerWrites(ask: SectionAsk, title: string, icon: TaskSectionIcon | undefined) {
  const made = createWrite(ask.workspaceId, title, icon);
  return [made, ...(ask.after?.(made.id) ?? [])];
}

export function movesInto(count: number, name?: string): ReactNode {
  if (count === 1) {
    if (name === undefined) return "The agent moves into it";
    return (
      <>
        “<ReplayMask>{name}</ReplayMask>” moves into it
      </>
    );
  }
  return `${count} tasks move into it`;
}

function movedNote(count: number, title: string | null): string {
  if (title === null) {
    return count === 1
      ? "Removed from its section"
      : `${countWords(count, TERM.TASK)} removed from their sections`;
  }
  return count === 1 ? `Moved to ${title}` : `${countWords(count, TERM.TASK)} moved to ${title}`;
}

function undeleteWrites(
  before: TaskSections,
  current: TaskSections,
  section: TaskSection,
  now: number,
): TaskSectionWrite[] {
  const { id, workspaceId, title, icon } = section;
  const made: TaskSectionWrite = {
    kind: TASK_SECTION_WRITE.CREATE,
    id,
    workspaceId,
    title,
    ...(icon === undefined ? undefined : { icon }),
  };
  const remade = applySectionWrite(current, made, now);
  const was = workspaceSections(before, workspaceId).findIndex((each) => each.id === id);
  const order = workspaceSections(remade, workspaceId);
  const from = order.findIndex((each) => each.id === id);
  const at = Math.min(Math.max(was, 0), order.length - 1);
  const moved = from === at ? [] : sectionMoveWrites(order, from, at);
  const members = sectionOrder(before, id)
    .map(memberOf)
    .filter((member) => memberSection(current, member) === undefined);
  return [made, ...moved, ...placeAllWrites(remade, members, id, now)];
}

export function useSectionDialogs(
  tasks: Pick<TasksControl, "signedIn" | "taskSections" | "onWriteSections">,
  surfaceOpen: boolean,
): SectionDialogs {
  const [ask, setAsk] = useState<SectionAsk | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState<TaskSectionIcon | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const field = useRef<HTMLInputElement | null>(null);
  const toast = useToast();
  const latest = useRef(tasks);
  latest.current = tasks;
  const writing = useMutation({
    mutationFn: (): Promise<ActionResult> => {
      const trimmed = title.trim();
      if (trimmed === "" || ask === undefined) {
        return Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: TITLE_ASKED });
      }
      tasks.onWriteSections(answerWrites(ask, trimmed, icon));
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
  });
  const confirmAct = useConfirmAct(writing, {
    send: () => writing.mutateAsync(),
    answered: sameAnswer,
  });
  const confirm: DialogConfirm = useConfirmDialog(
    { subject: tasks.signedIn, surfaceOpen },
    confirmAct,
    confirmFailure(FAILURE_SURFACE.SECTION_WRITE),
  );
  const blank = title.trim() === "";
  const form = useFormDialog(confirm, !blank);
  const dialog = (
    <Dialog
      open={form.open}
      title={NEW_SECTION}
      replayUnmasked
      busy={form.settling}
      refused={form.refusal !== undefined}
      initialFocus={field}
      onDismiss={form.dismiss}
      restoreTo={nextRowOrHead}
      actions={
        <DialogActions
          onCancel={form.dismiss}
          act={{
            verb: "Create section",
            tone: DIALOG_TONE.PRIMARY,
            running: "Creating section",
            ...form.act,
          }}
        />
      }
    >
      <Stack gap={GAP.TIGHT}>
        <FormField label="Name" error={form.refusal}>
          {(control) => (
            <Inline gap={GAP.CONTROL}>
              <SectionIconWell
                icon={icon}
                open={picking}
                onOpenChange={setPicking}
                onIcon={setIcon}
                variant={BUTTON_VARIANT.OUTLINE}
                disabled={form.settling}
              />
              <div className="section-dialog-name min-w-0 flex-auto">
                <TextField
                  ref={field}
                  field={control}
                  spellCheck={false}
                  placeholder="Launch week"
                  maxLength={TASK_SECTION_BOUNDS.MAX_TITLE_CHARS}
                  value={title}
                  disabled={form.settling}
                  onEnter={blank ? confirm.run : form.submit}
                  onChange={(next) => {
                    setTitle(next);
                    if (confirm.rejection !== undefined) confirm.ask();
                  }}
                />
              </div>
            </Inline>
          )}
        </FormField>
        {ask?.moving === undefined ? null : (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {ask.moving}
          </Text>
        )}
      </Stack>
    </Dialog>
  );
  return {
    askNew: (workspaceId, after, moving) => {
      setAsk({ workspaceId, after, moving });
      setTitle("");
      setIcon(undefined);
      setPicking(false);
      confirm.ask();
    },
    askDelete: (section, from) => {
      const before = tasks.taskSections;
      if (from !== null) nextRowOrHead(from)()?.focus({ preventScroll: true });
      tasks.onWriteSections([{ kind: TASK_SECTION_WRITE.DELETE, id: section.id }]);
      toast({
        ...undoToast(SECTION_DELETED, () => {
          const now = latest.current;
          now.onWriteSections(undeleteWrites(before, now.taskSections, section, Date.now()));
        }),
        replayUnmasked: true,
      });
    },
    move: (members, movedTo, writes) => {
      if (members.length === 0) return;
      const before = tasks.taskSections;
      tasks.onWriteSections(writes);
      const title =
        movedTo === null
          ? null
          : (before.sections.find((section) => section.id === movedTo)?.title ?? "");
      const undo = undoToast(movedNote(members.length, title), () => {
        const now = latest.current;
        const back = restoreWrites(before, now.taskSections, members, movedTo, Date.now());
        if (back.length > 0) now.onWriteSections(back);
      });
      toast(title === null ? { ...undo, replayUnmasked: true } : undo);
    },
    dialog,
  };
}

type InPlace =
  | {
      readonly kind: typeof TASK_SECTION_WRITE.CREATE;
      readonly workspaceId: string;
      readonly from: HTMLElement | null;
    }
  | {
      readonly kind: typeof TASK_SECTION_WRITE.EDIT;
      readonly sectionId: string;
    };

export interface SectionEdits {
  readonly inPlace: InPlace | undefined;
  readonly focusing: string | undefined;
  beginCreate: (workspaceId: string, from: HTMLElement | null) => void;
  beginEdit: (sectionId: string) => void;
  end: (focus?: string) => void;
  focused: () => void;
}

export function useSectionEdits(): SectionEdits {
  const [inPlace, setInPlace] = useState<InPlace | undefined>(undefined);
  const [focusing, setFocusing] = useState<string | undefined>(undefined);
  return {
    inPlace,
    focusing,
    beginCreate: (workspaceId, from) =>
      setInPlace({ kind: TASK_SECTION_WRITE.CREATE, workspaceId, from }),
    beginEdit: (sectionId) => setInPlace({ kind: TASK_SECTION_WRITE.EDIT, sectionId }),
    end: (focus) => {
      setInPlace(undefined);
      if (focus !== undefined) setFocusing(focus);
    },
    focused: () => setFocusing(undefined),
  };
}

function sameIcon(a: TaskSectionIcon | undefined, b: TaskSectionIcon | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.kind === TASK_SECTION_ICON_KIND.EMOJI) {
    return b.kind === TASK_SECTION_ICON_KIND.EMOJI && a.emoji === b.emoji;
  }
  return b.kind === TASK_SECTION_ICON_KIND.GLYPH && a.glyph === b.glyph && a.color === b.color;
}

function SectionEditor({
  title,
  icon,
  onEnd,
}: {
  title: string;
  icon: TaskSectionIcon | undefined;
  onEnd: (end: GroupHeaderEditEnd, icon: TaskSectionIcon | undefined) => void;
}): React.JSX.Element {
  const [chosen, setChosen] = useState(icon);
  const [open, setOpen] = useState(false);
  const editor = useRef<GroupHeaderEditorHandle | null>(null);
  return (
    <GroupHeaderEditor
      ref={editor}
      value={title}
      label="Section name"
      placeholder="Section name"
      maxLength={TASK_SECTION_BOUNDS.MAX_TITLE_CHARS}
      holding={open}
      glyph={
        <SectionIconWell
          icon={chosen}
          open={open}
          onOpenChange={(next, away) => {
            setOpen(next);
            if (away) editor.current?.leave();
          }}
          onIcon={setChosen}
          size={BUTTON_SIZE.COMPACT}
        />
      }
      onEnd={(end) => onEnd(end, chosen)}
    />
  );
}

export function rowMember(row: TaskRow): SectionMember {
  return row.kind === TASK_ROW.TASK
    ? { agent: false, id: row.task.id }
    : { agent: true, id: row.agent.id };
}

export function newSectionAction(onSelect: () => void): MenuAction {
  return { label: NEW_SECTION, icon: <FolderPlusIcon />, onSelect };
}

export function moveToSectionEntry(
  tasks: Pick<TasksControl, "taskSections">,
  member: SectionMember,
  workspaceId: string,
  dialogs: Pick<SectionDialogs, "askNew" | "move">,
  name?: string | undefined,
): MenuEntry {
  const state = tasks.taskSections;
  const standing = memberSection(state, member);
  const put = (sectionId: string) =>
    placeWrites(sectionOrder(state, sectionId), member, sectionId, 0, Date.now());
  const sections = workspaceSections(state, workspaceId).map((section): MenuAction => {
    const glyph = sectionGlyph(section.icon);
    return {
      label: section.title,
      key: section.id,
      replayMasked: true,
      ...(glyph === undefined ? undefined : { icon: glyph }),
      checked: section.id === standing,
      onSelect: () => {
        if (section.id !== standing) dialogs.move([member], section.id, put(section.id));
      },
    };
  });
  const remove: MenuAction[] =
    standing === undefined
      ? []
      : [
          {
            label: "Remove from section",
            onSelect: () => dialogs.move([member], null, unplaceAllWrites([member])),
          },
        ];
  return {
    ...commandHead(PANEL_COMMAND.MOVE_TO_SECTION),
    items: [
      ...sections,
      newSectionAction(() => dialogs.askNew(workspaceId, put, movesInto(1, name))),
      ...remove,
    ],
  };
}

export interface DrawnSection {
  readonly section: TaskSection;
  readonly entries: readonly SectionEntry[];
  readonly rows: readonly TaskRow[];
}

export interface ShownSection extends DrawnSection {
  readonly hidden: readonly HiddenStatus[];
  readonly othersHeld: boolean;
}

function drawnSectionTasks(drawn: DrawnSection): TaskSummary[] {
  return drawn.rows.flatMap((row) => (row.kind === TASK_ROW.TASK ? [row.task] : []));
}

interface SectionContext {
  readonly tasks: TasksControl;
  readonly dialogs: SectionDialogs;
  readonly edits: SectionEdits;
  readonly current: (row: TaskRow) => boolean;
  readonly unread: (task: TaskSummary) => boolean;
  readonly inSight: boolean;
  readonly folded: (sectionId: string) => boolean;
  readonly onToggle: (sectionId: string) => void;
  readonly opened: (taskId: string) => boolean;
  readonly row: (
    row: DrawnTaskRow,
    nest: ListRowNest | undefined,
    place: VirtualRowPlace,
  ) => React.JSX.Element;
  readonly runs: SidebarRunsPlace;
  readonly onDropRow: (row: TaskRow, zone: string, at: number) => void;
  readonly onCarried: (carried: boolean) => void;
  readonly onOpenBoard: () => void;
}

interface SectionDoors {
  readonly opener: React.RefObject<HTMLElement | null>;
  readonly onMarkRead: () => void;
}

function sectionActionGroups(
  drawn: DrawnSection,
  context: SectionContext,
  doors: SectionDoors,
): MenuEntry[][] {
  const { section } = drawn;
  const { dialogs, edits } = context;
  const edit: MenuEntry[] = [
    commandAction(PANEL_COMMAND.RENAME, () => edits.beginEdit(section.id), false),
  ];
  const remove: MenuEntry[] = [
    {
      label: "Delete section",
      icon: <TrashIcon />,
      danger: true,
      onSelect: () => dialogs.askDelete(section, doors.opener.current),
    },
  ];
  const read: MenuEntry[] = drawnSectionTasks(drawn).some(context.unread)
    ? [{ label: "Mark all as read", icon: <MailOpenIcon />, onSelect: doors.onMarkRead }]
    : [];
  return [[...edit, ...read], remove];
}

function SectionRows({
  drawn,
  context,
  rows,
  folded,
}: {
  drawn: DrawnSection;
  context: SectionContext;
  rows: readonly TaskRow[];
  folded: boolean;
}): React.JSX.Element {
  const nested = useNestedRows(rows, context.opened, context.current);
  const shown = useLeaving(nested, ({ row }) => taskRowKey(row));
  const keys = useMemo(() => shown.map(({ key }) => key), [shown]);
  const listedAt = new Map(nested.map(({ row }, at) => [taskRowKey(row), at]));
  const fromListed = (from: number) => {
    const key = shown[from]?.key;
    return key === undefined ? undefined : listedAt.get(key);
  };
  const storedAt = (at: number) => {
    const held = nested[at];
    return held === undefined ? -1 : drawn.rows.indexOf(held.row);
  };
  const besideSibling = (from: number, beside: number | undefined) => {
    if (beside === undefined) return;
    context.tasks.onWriteSections(placeWritesWithin(drawn, storedAt(from), storedAt(beside)));
  };
  const move = folded
    ? undefined
    : (from: number, to: number) => {
        const at = fromListed(from);
        if (at !== undefined)
          besideSibling(at, movedBeside(nested, at, listedSlot(shown, from, to)));
      };
  const drag = useRunRowDrag(move, {
    onDropOut: (from, zone, at) => {
      const held = shown[from]?.value;
      if (held !== undefined) context.onDropRow(held.row, zone, at);
    },
    onCarried: context.onCarried,
  });
  const moveKeys = useRowMoveKeys(move);
  const nests = nestsOf(shown.map(({ value }) => value));
  const placeOf = (key: string) => {
    const at = listedAt.get(key);
    if (move === undefined || at === undefined) return undefined;
    const siblings = siblingsAt(nested, at);
    return {
      at: siblings.indexOf(at),
      count: siblings.length,
      onMove: (from: number, to: number) => {
        const moved = siblings[from];
        if (moved !== undefined) besideSibling(moved, siblings[to]);
      },
    };
  };
  return (
    <SidebarRun
      place={context.runs}
      keys={keys}
      drops={!folded}
      onPointerDown={drag}
      block={moveKeys}
    >
      {(index, place) => {
        const entry = shown[index];
        return entry === undefined ? null : (
          <RowPlaced key={entry.key} place={placeOf(entry.key)}>
            {context.row(entry.value, nests[index], place)}
          </RowPlaced>
        );
      }}
    </SidebarRun>
  );
}

function SectionFoot({
  drawn,
  onOpenBoard,
}: {
  drawn: ShownSection;
  onOpenBoard: () => void;
}): React.JSX.Element | null {
  if (drawn.rows.length > 0 || drawn.hidden.length > 0) {
    return <HiddenStatusesLine hidden={drawn.hidden} onOpen={onOpenBoard} />;
  }
  return (
    <div className={SIDEBAR_SECTION_SLOT}>
      <NoteLine look={NOTE_LINE_LOOK.INSET}>
        {drawn.othersHeld ? NONE_MATCH : "Drag tasks here"}
      </NoteLine>
    </div>
  );
}

function SidebarSection({
  drawn,
  context,
  place,
}: {
  drawn: ShownSection;
  context: SectionContext;
  place: RowPlace;
}): React.JSX.Element {
  const { section } = drawn;
  const { tasks } = context;
  const folded = context.folded(section.id);
  const standing = drawn.rows.filter(context.current);
  const menu = useMenu(tasks.shown && context.inSight);
  const ellipsis = useRef<HTMLButtonElement | null>(null);
  const reads = useReadMarks();
  const held = drawnSectionTasks(drawn);
  const groups = sectionActionGroups(drawn, context, {
    opener: ellipsis,
    onMarkRead: () => {
      for (const task of held.filter(context.unread)) reads.mark(task, false);
    },
  });
  const glyph = sectionGlyph(section.icon);
  const { edits } = context;
  const root = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (edits.focusing !== section.id || edits.inPlace !== undefined) return;
    root.current?.querySelector<HTMLElement>(".ui-group-header-lead")?.focus();
    edits.focused();
  });
  const renaming =
    edits.inPlace?.kind === TASK_SECTION_WRITE.EDIT && edits.inPlace.sectionId === section.id
      ? edits.inPlace
      : undefined;
  const renamed = (end: GroupHeaderEditEnd, icon: TaskSectionIcon | undefined) => {
    edits.end(end.byKey ? section.id : undefined);
    if (!end.kept) return;
    const title = end.value === "" ? section.title : end.value;
    if (title === section.title && sameIcon(icon, section.icon)) return;
    tasks.onWriteSections([
      { kind: TASK_SECTION_WRITE.EDIT, id: section.id, title, icon: icon ?? null },
    ]);
  };
  return (
    <div ref={root} className="sidebar-repository sidebar-own-section" data-row-drop={section.id}>
      <GroupHeader
        editing={
          renaming === undefined ? undefined : (
            <SectionEditor title={section.title} icon={section.icon} onEnd={renamed} />
          )
        }
        heading={GROUP_HEADING.NONE}
        glyph={glyph}
        label={<ReplayMask>{section.title}</ReplayMask>}
        fold={sidebarFold(folded, () => context.onToggle(section.id))}
        count={
          drawn.rows.length === 0 && (drawn.hidden.length > 0 || drawn.othersHeld)
            ? undefined
            : foldedCount(folded, drawn.rows.length, TASK_NOUN)
        }
        menuOpen={menu.open !== undefined}
        contextMenu={menu.contextMenu(ellipsis)}
        standing={
          standing.length === 0 ? undefined : (
            <SectionRows drawn={drawn} context={context} rows={standing} folded />
          )
        }
        actions={
          <MoreButton
            ref={ellipsis}
            thing={section.title}
            size={BUTTON_SIZE.COMPACT}
            {...menu.trigger()}
          />
        }
      >
        {drawn.rows.length === 0 ? null : (
          <SectionRows drawn={drawn} context={context} rows={drawn.rows} folded={false} />
        )}
        <SectionFoot drawn={drawn} onOpenBoard={context.onOpenBoard} />
      </GroupHeader>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${section.title} actions`}
          replayUnmasked
          menu={menu.drawn}
          groups={withRowMoves(groups, place)}
          onClose={menu.close}
        />
      )}
    </div>
  );
}

function placeWritesWithin(drawn: DrawnSection, from: number, to: number): TaskSectionWrite[] {
  const entry = drawn.entries[from];
  if (entry === undefined) return [];
  return placeWrites(drawn.entries, memberOf(entry), drawn.section.id, to, Date.now());
}

function sectionKeyOf(drawn: DrawnSection): string {
  return drawn.section.id;
}

export function SidebarSections({
  sections,
  workspaceId,
  context,
}: {
  sections: readonly ShownSection[];
  workspaceId: string | undefined;
  context: SectionContext;
}): React.JSX.Element | null {
  const order = sections.map((drawn) => drawn.section);
  const move = (from: number, to: number) =>
    context.tasks.onWriteSections(sectionMoveWrites(order, from, to));
  const drag = useRowDrag(move, { handle: SECTION_HANDLE });
  const keys = useRowMoveKeys(move);
  const shown = useLeaving(sections, sectionKeyOf);
  const listedAt = new Map(sections.map((drawn, at) => [sectionKeyOf(drawn), at]));
  const { tasks, edits } = context;
  const creating =
    edits.inPlace?.kind === TASK_SECTION_WRITE.CREATE && edits.inPlace.workspaceId === workspaceId
      ? edits.inPlace
      : undefined;
  if (shown.length === 0 && creating === undefined) return null;
  const created = (end: GroupHeaderEditEnd, icon: TaskSectionIcon | undefined) => {
    if (creating === undefined) return;
    if (!end.kept || end.value === "") {
      edits.end();
      if (end.byKey) creating.from?.focus();
      return;
    }
    const made = createWrite(creating.workspaceId, end.value, icon);
    edits.end(end.byKey ? made.id : undefined);
    tasks.onWriteSections([made]);
  };
  return (
    <nav className="sidebar-group" aria-label="Sections">
      <Stack
        as={LAYOUT_ELEMENT.UL}
        gap={GAP.CONTROL}
        className="sidebar-sections"
        moves
        onPointerDown={drag}
        {...keys}
      >
        {shown.map(({ key, value: drawn }, drawnAt) => (
          <li key={key} className="sidebar-sections-item" {...motionKey(key)}>
            <SidebarSection
              drawn={drawn}
              context={context}
              place={{ at: listedAt.get(key) ?? drawnAt, count: sections.length, onMove: move }}
            />
          </li>
        ))}
        {creating === undefined ? null : (
          <li className="sidebar-sections-item sidebar-sections-new">
            <div className="sidebar-repository sidebar-own-section">
              <SectionEditor title="" icon={undefined} onEnd={created} />
            </div>
          </li>
        )}
      </Stack>
    </nav>
  );
}

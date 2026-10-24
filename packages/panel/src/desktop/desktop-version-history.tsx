import { ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { LINK_PLACE, linkOf } from "@luke/features/link-grammar";
import { sectionAnchors } from "@luke/features/mention-link";
import { planSections } from "@luke/features/plan-document";
import type { PlanRevisionLine } from "@luke/features/task-wire";
import { readFailedWords } from "@luke/features/words";
import type { FormerMember, Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { APP_COMMAND, APP_SHORTCUTS } from "@luke/settings/shortcuts";
import type { DialogConfirm } from "@luke/ui";
import {
  BackIcon,
  BUTTON_SIZE,
  BusyLabel,
  commandKeyshortcuts,
  EllipsisIcon,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_ELEMENT,
  Fill,
  FoldingButton,
  IconButton,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  List,
  ListRow,
  NavItem,
  OneLine,
  PageToolbar,
  ResizeEdge,
  RetryRowLabel,
  RowHint,
  RowHintOptions,
  SCROLL_FADE,
  ScrollArea,
  Shortcut,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  TEXT_BUTTON_LINES,
  TextButton,
  Time,
  Tooltip,
  useMenu,
  useMinute,
} from "@luke/ui";
import { type Actor, actorName } from "@luke/ui/actor-model";
import { DOCUMENT_REGION } from "@luke/ui/tasks-model";
import { ArrowUpRightIcon, FileDiffIcon, LinkIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark, actorCard, LeftWords } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { ColumnFoot } from "../call/call-card.js";
import { LINK_COPY, useCopyToast } from "../copy-feedback.js";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import type { NavigationHistory } from "../navigation-history.js";
import { hiddenColumns, SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { centreWithin } from "../tasks/code-pane.js";
import {
  type ChangedSection,
  changedSections,
  type HistoryReader,
  opensSections,
  type RevisionSource,
  revisionAuthorOf,
  revisionSource,
  revisionSummary,
  sectionName,
  sourceLabel,
  VERSION_CHANGE,
  versionDiff,
} from "../tasks/plan-history-model.js";
import type { MentionedTask } from "../tasks/task-mentions.js";
import {
  HISTORY_READ,
  type OpenedSections,
  type PlanHistoryControl,
  type ViewedVersion,
} from "../tasks/use-plan-history.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useFormerMembers, useWorkspaceMembers } from "../tasks/use-workspace-members.js";
import { useVersionRestore, VersionPageSkeleton, VersionView } from "../tasks/version-view.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { HistoryButtons, useSidebarEdge } from "./desktop-sidebar.js";
import { useNarrowFocus } from "./narrow-focus.js";
import type { SidebarCollapse } from "./sidebar-collapse.js";

/**
 * desktop-version-history.tsx -- a plan's version history, taking the whole window the way Settings does: every version listed where the sidebar stands, the one chosen beside them.
 *
 * The left column is as wide as the tasks' sidebar and resizes it from its
 * own edge, never folding, as Settings' page list does. At its head stand
 * back and forward and the Back row, which Escape presses too, then the
 * view's title, then the versions, newest first: who wrote each, drawn as
 * the rest of the window draws them (Luke's face as the Transcript wears
 * it, the reader's account picture as You, a teammate's sign-in picture
 * where the workspace's members read lists one, a coding agent's harness and
 * title), what it did, and how long ago, in the sidebar's few letters with
 * the moment itself on hover. The newest is the plan as it stands and the
 * one drawn when the view opens, wearing no tag of its own: its Restore says
 * it is already current. Opened from a section's "Edited by", the view draws
 * the version that made the section's last change instead, its row brought
 * into the list's view. Choosing a row, or stepping with the up and down
 * arrows, draws that version beside the list (`version-view.tsx`), and older
 * versions are read a page at a time from the list's foot. A row's ⋯, which
 * stands in its time's place while the row is hovered or holds the
 * keyboard as a sidebar task's Pin and Archive do, and its right-click offer
 * what applies to its version: Show changes, its Open, and its Restore. Show
 * changes, or the right arrow, slides the column one level over, as a nested
 * page of System Settings does, the title going with the list: All versions
 * at its head, who wrote the version, which opens where it was written, then
 * a row for each section it changed, a section added or removed saying so.
 * The first is drawn alone beside them, the arrows step through the rest,
 * and the left arrow, Escape, or All versions slide back with the version
 * still chosen. A version keeps only the text its writer's
 * saves left, so a section is the finest step it is read in. While the
 * versions are read, the list and the page stand as quiet blocks in their
 * own shapes (`skeleton.tsx`).
 *
 * The view is one place in the window's history however many versions are
 * chosen in it, so Back returns to wherever it was opened from, the task as
 * it was left, side panel and all; a restore that lands leaves for the task
 * it restored, where the window's toast offers its Undo. Every row and the version beside them name what
 * the plan held, so both are left out of the screen recording
 * (`ph-no-capture`) as a second line behind the recording's text masking.
 *
 * What the history is of is handed in as its subject: the open task's
 * (`taskVersionSubject`), or the account's plan template's, whose versions
 * are the developer's alone (`../settings/plan-template-history.tsx`).
 */

/**
 * What a version history is of, as the view draws it: the history as read
 * and its presses, the words it names what the versions are of in, the title
 * every version is drawn under, and what applies to its versions.
 */
export interface VersionSubject {
  readonly versions: PlanHistoryControl;
  /** What the versions are of, in the view's own words: "plan", or "template". */
  readonly noun: string;
  readonly title: string | undefined;
  /** Whether the view is on screen, which the restore's question stands on. */
  readonly shown: boolean;
  /** The coding agents whose harness a revision of theirs wears. */
  readonly agents: readonly Pick<CodingAgentSummary, "id" | "model">[];
  /** What a revision did, in a few words. */
  readonly summary: (line: PlanRevisionLine) => string;
  /** Goes to the place that wrote a revision; none where nothing else in the window writes the subject. */
  readonly onShowSource: ((source: RevisionSource) => void) | undefined;
  /** Whether every person's revision is the reader's own, as the account's template's are; a task's are its members'. */
  readonly own: boolean;
  /** The workspace whose members wrote the revisions, whose pictures their rows wear; none for the account's own template. */
  readonly workspace: Pick<Workspace, "id" | "memberCount"> | undefined;
  /** The task the versions are of, which their mentions are read against; none for the account's own template. */
  readonly task?: MentionedTask | undefined;
}

/** What the page says while the subject has no revision yet. */
const NO_HISTORY_LINE = "No versions yet.";

/** What the menu item that opens a revision's sections says. */
const SECTIONS_LABEL = "Show changes";

/** What a row's ⋯ says. */
const ACTIONS_LABEL = "Version actions";

/** The word a changed section wears beside its name: none for an edit, which most are. */
const SECTION_CHANGE_WORDS = {
  [VERSION_CHANGE.ADDED]: "Added",
  [VERSION_CHANGE.REMOVED]: "Removed",
  [VERSION_CHANGE.CHANGED]: undefined,
} as const satisfies Record<ChangedSection["change"], string | undefined>;

/** The placeholder rows' shape while the versions are read: each row's author and summary as wide as their share of it. */
const LOG_SKELETON = [
  { author: "34%", summary: "78%" },
  { author: "48%", summary: "62%" },
  { author: "28%", summary: "84%" },
  { author: "40%", summary: "56%" },
] as const;

/** What the sections' pane says where the revision's version did not read. */
const SECTIONS_FAILED = readFailedWords("the sections it changed");

/** How wide each placeholder row of a revision's sections stands, a section's name as a share of its line. */
const SECTIONS_SKELETON = ["46%", "62%", "38%"] as const;

/** A placeholder revision's writer's mark, at a row's actor mark's size (`avatar.css`). */
const ROW_MARK_SKELETON = "20px";

/** How wide a placeholder revision's time stands, a short moment's ("2h", "Mon"). */
const TIME_SKELETON = "28px";

/** What the list of versions, and of a revision's sections, are called to a reader. */
const LIST_LABEL = { VERSIONS: "Version list", SECTIONS: "Sections changed" } as const;

/** The way from a revision to the place that wrote it: what its Open says, and the press. */
interface SourceDoor {
  readonly label: string;
  readonly onOpen: () => void;
}

/** A revision's Open as an item of its right-click menu. */
function sourceItem(source: SourceDoor): MenuAction {
  return { label: source.label, icon: <ArrowUpRightIcon />, onSelect: source.onOpen };
}

/**
 * One revision's row: who wrote it, what it did, and when; lit while its
 * version is drawn. Its ⋯ stands over the time while the row is hovered or
 * holds the keyboard, a button beside the row rather than inside it, since a
 * button holds no other, and drops the same menu the row's right-click
 * hangs at the pointer. A row with nothing to offer has neither.
 */
function RevisionRow({
  line,
  author,
  selected,
  now,
  rowRef,
  onSelect,
  onOpenSections,
  source,
  onRestore,
  onCopyLink,
  summary,
}: {
  line: PlanRevisionLine;
  author: Actor;
  selected: boolean;
  now: number;
  rowRef: (row: HTMLElement | null) => void;
  onSelect: () => void;
  /** Opens the sections the revision changed; none for a revision that opens none. */
  onOpenSections: (() => void) | undefined;
  /** The way to the place that wrote the revision; none where nothing else in the window did. */
  source: SourceDoor | undefined;
  /** Chooses the version and asks to restore it; none for the plan as it stands. */
  onRestore: (() => void) | undefined;
  /** Copies the version's link; none for a history with no link of its own. */
  onCopyLink: (() => void) | undefined;
  /** What the revision did, in a few words. */
  summary: string;
}): React.JSX.Element {
  const { lastEdit } = line;
  const menu = useMenu(true);
  const ellipsis = useRef<HTMLButtonElement | null>(null);
  const groups = [
    [
      ...(onOpenSections === undefined
        ? []
        : [{ label: SECTIONS_LABEL, icon: <FileDiffIcon />, onSelect: onOpenSections }]),
      ...(source === undefined ? [] : [sourceItem(source)]),
      ...(onCopyLink === undefined
        ? []
        : [
            { label: LINK_COPY.LABEL, icon: <LinkIcon aria-hidden="true" />, onSelect: onCopyLink },
          ]),
    ],
    onRestore === undefined
      ? []
      : [{ label: "Restore this version", icon: <RotateCcwIcon />, onSelect: onRestore }],
  ].filter((group) => group.length > 0);
  const offered = groups.length > 0;
  // Note that the ⋯ is what a right-click's menu hands focus back to, since
  // it is the menu's own door from the keyboard.
  const showMenu = menu.contextMenu(ellipsis);
  // Note that the author's card hangs beside the row as the pointer rests on it; an author with none, Luke or an agent, hangs nothing.
  const card = actorCard(author);
  return (
    <>
      <RowHintOptions card={card} cardBeside>
        <ListRow
          ref={rowRef}
          leading={<ActorMark actor={author} size={ACTOR_SIZE.ROW} />}
          title={
            <span className="version-row-author" data-author={author.kind}>
              {actorName(author)}
              <LeftWords actor={author} />
            </span>
          }
          description={<span className="version-row-summary">{summary}</span>}
          meta={<Time at={lastEdit.at} now={now} />}
          current={selected ? LIST_ROW_CURRENT.ITEM : undefined}
          onPress={onSelect}
          contextMenu={offered ? showMenu : undefined}
          actionsAt={LIST_ROW_ACTIONS.HOVER}
          menuOpen={menu.open !== undefined}
          hint={card === undefined ? undefined : { Hint: RowHint, label: actorName(author) }}
          actions={
            offered ? (
              <Tooltip label={ACTIONS_LABEL}>
                <IconButton
                  ref={ellipsis}
                  icon={<EllipsisIcon />}
                  label={ACTIONS_LABEL}
                  size={BUTTON_SIZE.COMPACT}
                  {...menu.trigger()}
                />
              </Tooltip>
            ) : null
          }
        />
      </RowHintOptions>
      {menu.drawn === undefined ? null : (
        <ActionMenu label={ACTIONS_LABEL} menu={menu.drawn} groups={groups} onClose={menu.close} />
      )}
    </>
  );
}

/**
 * The head of a revision's sections: the way back to every version, and who
 * wrote it, which goes where it was written where anywhere in the window
 * did, and is said and not pressed where nowhere did.
 */
function SectionsHead({
  author,
  source,
  onBack,
}: {
  author: Actor;
  source: SourceDoor | undefined;
  onBack: () => void;
}): React.JSX.Element {
  const name = (
    <OneLine className="version-row-author">
      {actorName(author)}
      <LeftWords actor={author} />
    </OneLine>
  );
  return (
    <>
      <NavItem icon={<BackIcon />} onClick={onBack}>
        All versions
      </NavItem>
      <p className="version-sections-head">
        <ActorMark actor={author} size={ACTOR_SIZE.ROW} />
        {source === undefined ? (
          name
        ) : (
          <Tooltip label={source.label}>
            <TextButton onClick={source.onOpen}>{name}</TextButton>
          </Tooltip>
        )}
      </p>
    </>
  );
}

/** One section a revision changed: its name, and a quiet word where it was added or removed rather than edited; lit while it is drawn. */
function SectionRow({
  section,
  selected,
  rowRef,
  onSelect,
  source,
}: {
  section: ChangedSection;
  selected: boolean;
  rowRef: (row: HTMLElement | null) => void;
  onSelect: () => void;
  /** The way to the place that wrote its revision, which its right-click offers. */
  source: SourceDoor | undefined;
}): React.JSX.Element {
  const word = SECTION_CHANGE_WORDS[section.change];
  const menu = useMenu(true);
  return (
    <>
      <ListRow
        ref={rowRef}
        title={sectionName(section.heading)}
        meta={word}
        current={selected ? LIST_ROW_CURRENT.ITEM : undefined}
        onPress={onSelect}
        contextMenu={source === undefined ? undefined : menu.contextMenu()}
      />
      {menu.drawn === undefined || source === undefined ? null : (
        <ActionMenu
          label="Section actions"
          menu={menu.drawn}
          groups={[[sourceItem(source)]]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The reader as their account names them, or nobody while no account is signed in, with the workspace's members beside. */
function readerOf(
  account: AccountSnapshot,
  members: readonly WorkspaceMember[] | undefined,
  former: readonly FormerMember[] | undefined,
): HistoryReader {
  const reader =
    account.status === ACCOUNT_STATUS.SIGNED_IN
      ? { id: account.id, name: account.name ?? account.email, pictureUrl: account.pictureUrl }
      : { id: undefined, name: undefined, pictureUrl: undefined };
  const read = members === undefined ? reader : { ...reader, members };
  return former === undefined ? read : { ...read, former };
}

/**
 * The versions while they are read, as rows of a revision's own: its
 * writer's mark, their name over its summary, and its time, so the
 * revisions land where the blocks stood.
 */
function LogSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading the versions…">
      <List label={LIST_LABEL.VERSIONS}>
        {LOG_SKELETON.map((row) => (
          <ListRow
            key={row.author}
            leading={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={ROW_MARK_SKELETON} />}
            title={<Skeleton width={row.author} />}
            description={<Skeleton width={row.summary} />}
            meta={<Skeleton width={TIME_SKELETON} />}
          />
        ))}
      </List>
    </SkeletonRegion>
  );
}

/** A revision's sections while they are read, as rows of a section's own: its name on one line. */
function SectionsSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading the sections it changed…">
      <List label={LIST_LABEL.SECTIONS}>
        {SECTIONS_SKELETON.map((width) => (
          <ListRow key={width} title={<Skeleton width={width} />} />
        ))}
      </List>
    </SkeletonRegion>
  );
}

/**
 * The foot of the list while an older page stands: read on its press, and
 * offered again after a read that failed. Note that it is a text button
 * rather than `@luke/ui`'s Button, because its failure and Retry run to two
 * lines in a column the sidebar's width, which a control's one line would
 * cut short.
 */
function EarlierRow({ onRead }: { onRead: () => Promise<boolean> }): React.JSX.Element {
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  const read = () => {
    if (reading) return;
    setReading(true);
    onRead().then(
      (landed) => {
        setReading(false);
        setFailed(!landed);
      },
      () => {
        setReading(false);
        setFailed(true);
      },
    );
  };
  return (
    <p className="version-earlier">
      <TextButton lines={TEXT_BUTTON_LINES.TWO} onClick={read}>
        <BusyLabel delay busy={reading} label="Loading older versions">
          {failed ? (
            <RetryRowLabel failure="Could not read older versions." />
          ) : (
            "Show older versions"
          )}
        </BusyLabel>
      </TextButton>
    </p>
  );
}

/** The key of the row among `rows` that is `element`, where it is one. */
function keyOfRow<K>(rows: Map<K, HTMLElement>, element: EventTarget | null): K | undefined {
  for (const [key, row] of rows) if (row === element) return key;
  return undefined;
}

/**
 * Chooses the row the focus stepped onto from another row of the same
 * list, which is what its ↑↓ do (`List`'s roving keys). Note that a focus
 * that comes into the list from outside chooses nothing, so Tab lands on a
 * row without changing the version shown.
 */
function chooseSteppedRow<K>(
  rows: Map<K, HTMLElement>,
  choose: (key: K) => void,
): (event: React.FocusEvent) => void {
  return (event) => {
    if (keyOfRow(rows, event.relatedTarget) === undefined) return;
    const key = keyOfRow(rows, event.target);
    if (key !== undefined) choose(key);
  };
}

/**
 * ← and → on a row: → goes into the row's sections where it has them, and
 * ← comes back out. Note that they are heard on the list's own box, so a
 * field, a dialog, or a menu over a row, whose keys bubble through React's
 * tree, are never taken for a row's.
 */
function goThroughRow<K>(
  rows: Map<K, HTMLElement>,
  keys: { readonly open?: (key: K) => boolean; readonly back?: () => void },
): (event: React.KeyboardEvent) => void {
  return (event) => {
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const key = keyOfRow(rows, event.target);
    if (key === undefined) return;
    if (event.key === "ArrowRight" && keys.open?.(key) === true) event.preventDefault();
    else if (event.key === "ArrowLeft" && keys.back !== undefined) {
      event.preventDefault();
      keys.back();
    }
  };
}

/**
 * Hands the focus to the chosen section once a revision's sections are
 * drawn, because the list of versions goes inert as they open and the focus
 * with it, and the sections' arrows need a row to walk from. Note that it
 * only takes a focus that was lost, never one the reader put somewhere.
 */
function useSectionsFocused(
  opened: number | undefined,
  unit: number | undefined,
  sectionRows: Map<number, HTMLElement>,
): void {
  const focused = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (opened === undefined) focused.current = undefined;
    if (opened === undefined || unit === undefined || focused.current === opened) return;
    const row = sectionRows.get(unit);
    if (row === undefined) return;
    focused.current = opened;
    if (document.activeElement === null || document.activeElement === document.body) row.focus();
  }, [opened, unit, sectionRows]);
}

/**
 * The row of the version the view opened on, brought into the list's view
 * once it is chosen, so a version opened deep in the list is seen lit. Only
 * the list scrolls, since the window around it must not.
 */
function useOpenedRowShown(
  selected: number | undefined,
  rows: Map<number, HTMLElement>,
  log: React.RefObject<HTMLDivElement | null>,
): void {
  const shown = useRef(false);
  useEffect(() => {
    const row = selected === undefined ? undefined : rows.get(selected);
    if (shown.current || row === undefined || log.current === null) return;
    shown.current = true;
    const box = log.current.getBoundingClientRect();
    const line = row.getBoundingClientRect();
    if (line.top < box.top || line.bottom > box.bottom) centreWithin(log.current, row);
  }, [selected, rows, log]);
}

/** The sections the open revision changed, once its version is read; nothing while it is read, or while no revision is open. */
function openedSections(
  viewing: ViewedVersion | undefined,
  opened: OpenedSections | undefined,
): readonly ChangedSection[] | undefined {
  if (opened === undefined || viewing?.line.seq !== opened.seq) return undefined;
  const { read } = viewing;
  if (read.kind !== HISTORY_READ.READY) return undefined;
  return changedSections(versionDiff(read.previous, read.document), read.previous === null);
}

/** Whether the open revision's version failed to read, so its sections will not stand until it is read again. */
function sectionsFailed(
  viewing: ViewedVersion | undefined,
  opened: OpenedSections | undefined,
): boolean {
  return (
    opened !== undefined &&
    viewing?.line.seq === opened.seq &&
    viewing.read.kind === HISTORY_READ.FAILED
  );
}

/**
 * The version history's page beside the list: the version chosen, or the
 * state standing in its place.
 */
function VersionPage({
  subject,
  restore,
  section,
  lead,
}: {
  subject: VersionSubject;
  restore: DialogConfirm;
  /** The one unit of the version drawn alone, while a section of its revision is open. */
  section: number | undefined;
  /** What leads the page's bar: the way back to the list, where the page stands alone. */
  lead: React.ReactNode;
}): React.JSX.Element {
  const { versions } = subject;
  if (versions.viewing !== undefined) {
    return (
      <VersionView
        viewing={versions.viewing}
        restore={restore}
        title={subject.title}
        noun={subject.noun}
        section={section}
        task={subject.task}
        lead={lead}
        onRetry={versions.onRetryVersion}
      />
    );
  }
  const { list } = versions;
  // A list read that holds versions is still finding the one the view opened on.
  const finding = list.kind === HISTORY_READ.READY && list.revisions.length > 0;
  if (list.kind === HISTORY_READ.READING || finding) {
    return <VersionPageSkeleton lead={lead} title={subject.title} section={section} />;
  }
  return (
    <>
      {lead === undefined ? <div className="desktop-drag-strip" /> : <PageToolbar lead={lead} />}
      <Fill className="desktop-empty-region">
        {list.kind === HISTORY_READ.FAILED ? (
          <ErrorState onRetry={versions.onRetry} placement={ERROR_STATE_PLACEMENT.CENTRED}>
            The history could not be read.
          </ErrorState>
        ) : (
          <EmptyState>{NO_HISTORY_LINE}</EmptyState>
        )}
      </Fill>
    </>
  );
}

/** What the way back from a version to the list says, in a narrow room. */
const VERSION_LIST = "Versions";

/** The open plan's history as the view's subject: its name, its agents, and the places in the window its revisions were written. */
export function taskVersionSubject(tasks: TasksControl): VersionSubject {
  const { region, boundFor } = tasks;
  const task = region.kind === DOCUMENT_REGION.READY ? region.task : undefined;
  const workspace = tasks.workspaces.find((each) => each.id === task?.workspaceId);
  return {
    workspace,
    // A version's mentions are read against the task as it stands, as its page reads them.
    task:
      task === undefined
        ? undefined
        : {
            taskId: task.id,
            place: { workspace: workspace?.slug ?? task.workspaceId, repository: task.repository },
            anchors: new Set(
              sectionAnchors(planSections(task.document.body).map((section) => section.heading)),
            ),
          },
    versions: tasks.history,
    noun: "plan",
    title: task?.name,
    shown: tasks.shown,
    agents: tasks.agents.agents ?? [],
    summary: revisionSummary,
    onShowSource:
      boundFor === undefined ? undefined : (source) => tasks.onShowSource(boundFor, source),
    own: false,
  };
}

/**
 * A version history over the whole window: the versions where the sidebar
 * stands, with the way back at their head and the call card at their foot,
 * as the sidebar holds them, and the version chosen beside them. `onExit`
 * leaves for wherever it was opened from, and `onRestored` for what a
 * restore landed on. A narrow room shows the list or the version, one at a
 * time (`hiddenColumns`): a version or a section chosen stands alone the
 * whole width, under a way back to the list.
 */
export function DesktopVersionHistory({
  sidebar,
  room,
  history,
  subject,
  account,
  onExit,
  onRestored,
}: {
  sidebar: SidebarCollapse;
  room: ShellRoom;
  history: NavigationHistory;
  subject: VersionSubject;
  /** Who is reading, whose revisions are drawn as theirs. */
  account: AccountSnapshot;
  onExit: () => void;
  onRestored: () => void;
}): React.JSX.Element {
  const now = useMinute();
  const { versions, agents } = subject;
  const { list } = versions;
  const revisions = list.kind === HISTORY_READ.READY ? list.revisions : [];
  const rows = useRef(new Map<number, HTMLElement>()).current;
  const sectionRows = useRef(new Map<number, HTMLElement>()).current;
  const log = useRef<HTMLDivElement>(null);
  const { opened } = versions.spot ?? {};
  const edge = useSidebarEdge(sidebar);
  const members = useWorkspaceMembers(subject.workspace);
  // A version of a plan has a link of its own, its plan's under its revision; another history's has none.
  const copy = useCopyToast();
  const linked = subject.task;
  const former = useFormerMembers(subject.workspace);
  const reader = readerOf(account, members, former);
  // A restore that lands leaves for the task it restored, which is not always the one Back returns to.
  const restore = useVersionRestore(versions, subject.shown, onRestored);
  const sections = openedSections(versions.viewing, opened);
  const failed = sectionsFailed(versions.viewing, opened);
  const sourceOf = (line: PlanRevisionLine, author: Actor): SourceDoor | undefined => {
    const source = revisionSource(line);
    const { onShowSource } = subject;
    if (source === undefined || onShowSource === undefined) return undefined;
    return { label: sourceLabel(source, author), onOpen: () => onShowSource(source) };
  };
  const openedLine = revisions.find((line) => line.seq === opened?.seq);
  const chosenSection =
    sections?.find((section) => section.heading === opened?.heading) ?? sections?.[0];
  const unit = chosenSection?.unit;
  const openedAuthor =
    openedLine === undefined
      ? undefined
      : revisionAuthorOf(openedLine, reader, agents, subject.own);
  const openedSource =
    openedLine === undefined || openedAuthor === undefined
      ? undefined
      : sourceOf(openedLine, openedAuthor);
  const openSections = versions.onOpenSections;
  const restoreOf = (line: PlanRevisionLine): (() => void) | undefined => {
    const newest = revisions[0]?.seq;
    if (line.seq === newest) return undefined;
    return () => {
      versions.onSelect(line.seq);
      restore.ask();
    };
  };
  const closeSections = () => {
    if (opened === undefined) return;
    versions.onCloseSections();
    rows.get(opened.seq)?.focus();
  };
  useAppCommand(APP_COMMAND.EXIT_VERSION_HISTORY, opened === undefined ? onExit : closeSections);
  const chooseUnit = (at: number) => {
    versions.onChooseSection(sections?.find((section) => section.unit === at)?.heading);
  };
  const versionKeys = goThroughRow(rows, {
    open: (seq) => {
      const line = revisions.find((each) => each.seq === seq);
      if (line === undefined || !opensSections(line)) return false;
      openSections(seq);
      return true;
    },
  });
  const sectionKeys = goThroughRow(sectionRows, { back: closeSections });
  useSectionsFocused(opened?.seq, unit, sectionRows);
  useOpenedRowShown(versions.selected, rows, log);
  const hidden = hiddenColumns(room, versions.listed);
  const screen = useNarrowFocus(room, versions.listed);

  return (
    <div ref={screen} className="desktop-version-history">
      <nav className="version-log ph-no-capture" aria-label="Versions" hidden={hidden.list}>
        <div className="desktop-drag-strip" />
        <HistoryButtons history={history} room={room} />
        <NavItem
          icon={<BackIcon />}
          aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.EXIT_VERSION_HISTORY)}
          shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.EXIT_VERSION_HISTORY].chord} />}
          onClick={onExit}
        >
          Back
        </NavItem>
        <div className="version-log-track" data-opened={String(opened !== undefined)}>
          <div className="version-log-pane" inert={opened !== undefined}>
            <h1 className="version-log-title">Version history</h1>
            <Fill className="sidebar-section">
              <ScrollArea ref={log} fade={SCROLL_FADE.BOTH}>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: the keys and the focus are the rows' own, which the box only hears bubble. */}
                <div
                  className="sidebar-section-body"
                  onFocus={chooseSteppedRow(rows, versions.onSelect)}
                  onKeyDown={versionKeys}
                >
                  {list.kind === HISTORY_READ.READING ? <LogSkeleton /> : null}
                  <List label={LIST_LABEL.VERSIONS}>
                    {revisions.map((line) => {
                      const author = revisionAuthorOf(line, reader, agents, subject.own);
                      return (
                        <RevisionRow
                          key={line.seq}
                          line={line}
                          author={author}
                          source={sourceOf(line, author)}
                          selected={line.seq === versions.selected}
                          now={now}
                          rowRef={(row) => {
                            if (row === null) rows.delete(line.seq);
                            else rows.set(line.seq, row);
                          }}
                          onSelect={() => versions.onSelect(line.seq)}
                          onOpenSections={
                            opensSections(line) ? () => openSections(line.seq) : undefined
                          }
                          onRestore={restoreOf(line)}
                          onCopyLink={
                            linked === undefined
                              ? undefined
                              : () =>
                                  copy(
                                    linkOf(
                                      {
                                        kind: LINK_PLACE.VERSION,
                                        planId: linked.taskId,
                                        revision: line.seq,
                                      },
                                      linked.place.workspace,
                                    ),
                                    LINK_COPY.COPIED,
                                  )
                          }
                          summary={subject.summary(line)}
                        />
                      );
                    })}
                  </List>
                  {list.kind === HISTORY_READ.READY && list.earlier !== undefined ? (
                    <EarlierRow onRead={versions.onLoadEarlier} />
                  ) : null}
                </div>
              </ScrollArea>
            </Fill>
          </div>
          <Fill
            as={FILL_ELEMENT.SECTION}
            className="sidebar-section version-log-pane"
            aria-label={LIST_LABEL.SECTIONS}
            inert={opened === undefined}
          >
            <ScrollArea fade={SCROLL_FADE.BOTH}>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: the keys and the focus are the rows' own, which the box only hears bubble. */}
              <div
                className="sidebar-section-body"
                onFocus={chooseSteppedRow(sectionRows, chooseUnit)}
                onKeyDown={sectionKeys}
              >
                {openedLine === undefined ? null : (
                  <>
                    <SectionsHead
                      author={
                        openedAuthor ?? revisionAuthorOf(openedLine, reader, agents, subject.own)
                      }
                      source={openedSource}
                      onBack={closeSections}
                    />
                    {failed ? (
                      <div className="sidebar-note">
                        <ErrorState onRetry={versions.onRetryVersion}>{SECTIONS_FAILED}</ErrorState>
                      </div>
                    ) : sections === undefined ? (
                      <SectionsSkeleton />
                    ) : null}
                    <List label={LIST_LABEL.SECTIONS}>
                      {sections?.map((section) => (
                        <SectionRow
                          key={section.unit}
                          section={section}
                          selected={section.unit === unit}
                          rowRef={(row) => {
                            if (row === null) sectionRows.delete(section.unit);
                            else sectionRows.set(section.unit, row);
                          }}
                          onSelect={() => chooseUnit(section.unit)}
                          source={openedSource}
                        />
                      ))}
                    </List>
                  </>
                )}
              </div>
            </ScrollArea>
          </Fill>
        </div>
        <ColumnFoot />
        {/* Last, so the drag strip above the way back does not take the edge's top from it. */}
        {room === SHELL_ROOM.WIDE ? <ResizeEdge edge={edge} /> : null}
      </nav>
      <section className="version-page ph-no-capture" aria-label="Version" hidden={hidden.item}>
        <PageFind page={FIND_PAGE.VERSION_HISTORY} at={String(versions.selected)} active>
          <VersionPage
            subject={subject}
            restore={restore}
            section={opened === undefined ? undefined : unit}
            lead={
              room === SHELL_ROOM.NARROW ? (
                <FoldingButton label={VERSION_LIST} icon={<BackIcon />} onClick={versions.onList} />
              ) : undefined
            }
          />
        </PageFind>
      </section>
    </div>
  );
}

/** The open plan's version history, as the window draws it in place of the tasks (`pages-on-demand.ts`). */
export function TaskVersionHistory({
  tasks,
  ...view
}: Omit<Parameters<typeof DesktopVersionHistory>[0], "subject"> & {
  tasks: TasksControl;
}): React.JSX.Element {
  return <DesktopVersionHistory {...view} subject={taskVersionSubject(tasks)} />;
}

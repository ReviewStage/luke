import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import type { AgentSummary } from "@repo/features/agent-wire";
import { LINK_PLACE, linkOf } from "@repo/features/link-grammar";
import { sectionAnchors } from "@repo/features/mention-link";
import { descriptionSections } from "@repo/features/description-document";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { DescriptionRevisionLine } from "@repo/features/task-wire";
import { readFailedWords, readingWords } from "@repo/features/words";
import type { FormerMember, Workspace, WorkspaceMember } from "@repo/features/workspace-wire";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  BACK_BUTTON_LOOK,
  BackButton,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FailureNote,
  FILL_ELEMENT,
  Fill,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  List,
  ListRow,
  NO_BACK_KEY,
  OneLine,
  ResizeEdge,
  RowHint,
  RowHintOptions,
  reachedKey,
  SCROLL_FADE,
  ScrollArea,
  ShowMoreRow,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TextButton,
  Time,
  Toolbar,
  Tooltip,
  useMinute,
  useRovingKeys,
} from "@repo/ui";
import { type Actor, actorName } from "@repo/ui/actor-model";
import { ArrowUpRightIcon, GLYPH, RotateCcwIcon } from "@repo/ui/icons";
import { DOCUMENT_REGION } from "@repo/ui/tasks-model";
import {
  VIRTUAL_ROW_KEY_ATTRIBUTE,
  VIRTUAL_ROWS_ANCHOR,
  type VirtualRowPlace,
  VirtualRows,
  type VirtualRowsHandle,
} from "@repo/ui/virtual-rows";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import { ACTOR_SIZE, ActorMark, actorCard, LeftWords } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import { useListEdge, useScreenRef, useScreenSplit } from "../column-split.js";
import { useCopyToast } from "../copy-feedback.js";
import { copyLinkItem, useChordLinks } from "../copy-link-item.js";
import { unreadShown } from "../failure-report.js";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import { workspaceMembersQuery } from "../live-reads.js";
import type { NavigationHistory } from "../navigation-history.js";
import { centerWithin } from "../scroll-within.js";
import { hiddenColumns, SHELL_ROOM, type ShellRoom } from "../shell-room.js";
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
} from "../tasks/description-history-model.js";
import type { MentionedTask } from "../tasks/task-mentions.js";
import { useNumberedPlace } from "../tasks/use-link-standing.js";
import {
  HISTORY_READ,
  type OpenedSections,
  type DescriptionHistoryControl,
  type ViewedVersion,
} from "../tasks/use-description-history.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import {
  useVersionRestore,
  VersionPageSkeleton,
  type VersionRestore,
  VersionView,
} from "../tasks/version-view.js";
import { type MenuAction, rowMenu } from "./action-menu.js";
import { backPlaceOf } from "./back-place.js";
import { HistoryButtons } from "./desktop-sidebar.js";
import { useNarrowFocus } from "./narrow-focus.js";
import { PhoneHead } from "./phone-head.js";
import { PLACE_LIST, PLACE_LIST_TITLE, PLACE_PAGE, PLACE_SPLIT } from "./place-columns.js";
import type { SidebarCollapse } from "./sidebar-collapse.js";

const VERSION_AUTHOR =
  "version-row-author min-w-0 overflow-hidden whitespace-nowrap text-label font-ui-medium text-foreground";

const VERSION_PANE = "version-log-pane flex min-h-0 min-w-0 flex-col px-ring-reach";

export interface VersionSubject {
  readonly versions: DescriptionHistoryControl;
  readonly title: string | undefined;
  readonly agents: readonly Pick<AgentSummary, "id" | "model">[];
  readonly summary: (line: DescriptionRevisionLine) => string;
  readonly onShowSource: ((source: RevisionSource) => void) | undefined;
  readonly workspace: Pick<Workspace, "id" | "memberCount"> | undefined;
  readonly task?: MentionedTask | undefined;
}

const NO_HISTORY_LINE = "No versions yet.";

const SECTIONS_LABEL = "Show changes";

const VERSION_THING = "Version";

const SECTION_THING = "Section";

const SECTION_CHANGE_WORDS = {
  [VERSION_CHANGE.ADDED]: "Added",
  [VERSION_CHANGE.REMOVED]: "Removed",
  [VERSION_CHANGE.CHANGED]: undefined,
} as const satisfies Record<ChangedSection["change"], string | undefined>;

const LOG_SKELETON = [
  { author: "34%", summary: "78%" },
  { author: "48%", summary: "62%" },
  { author: "28%", summary: "84%" },
  { author: "40%", summary: "56%" },
] as const;

const SECTIONS_FAILED = readFailedWords("the sections it changed");

const SECTIONS_SKELETON = ["46%", "62%", "38%"] as const;

const ROW_MARK_SKELETON = "20px";

const TIME_SKELETON = "28px";

const LIST_LABEL = { VERSIONS: "Version list", SECTIONS: "Sections changed" } as const;

interface SourceDoor {
  readonly label: string;
  readonly onOpen: () => void;
}

function sourceItem(source: SourceDoor): MenuAction {
  return { label: source.label, icon: <ArrowUpRightIcon />, onSelect: source.onOpen };
}

function RevisionRow({
  line,
  author,
  selected,
  now,
  place,
  rowRef,
  onSelect,
  onOpenSections,
  source,
  onRestore,
  copyLink,
  summary,
}: {
  line: DescriptionRevisionLine;
  author: Actor;
  selected: boolean;
  now: number;
  place: VirtualRowPlace;
  rowRef: (row: HTMLElement | null) => void;
  onSelect: () => void;
  onOpenSections: (() => void) | undefined;
  source: SourceDoor | undefined;
  onRestore: (() => void) | undefined;
  copyLink: MenuAction | undefined;
  summary: string;
}): React.JSX.Element {
  const { lastEdit } = line;
  const coarse = useCoarsePointer();
  const groups = [
    [
      ...(copyLink === undefined ? [] : [copyLink]),
      ...(onOpenSections === undefined
        ? []
        : [{ label: SECTIONS_LABEL, icon: <GLYPH.SECTION />, onSelect: onOpenSections }]),
      ...(source === undefined ? [] : [sourceItem(source)]),
    ],
    onRestore === undefined
      ? []
      : [{ label: "Restore this version", icon: <RotateCcwIcon />, onSelect: onRestore }],
  ].filter((group) => group.length > 0);
  const card = actorCard(author);
  return (
    <RowHintOptions card={card}>
      <ListRow
        ref={rowRef}
        place={place}
        leading={<ActorMark actor={author} size={ACTOR_SIZE.ROW} />}
        title={
          <span className={VERSION_AUTHOR} data-author={author.kind}>
            {actorName(author)}
            <LeftWords actor={author} />
          </span>
        }
        description={
          <span className="version-row-summary line-clamp-2 whitespace-normal">{summary}</span>
        }
        meta={<Time at={lastEdit.at} now={now} />}
        current={selected ? LIST_ROW_CURRENT.ITEM : undefined}
        onPress={onSelect}
        actionsAt={LIST_ROW_ACTIONS.HOVER}
        hint={card === undefined ? undefined : { Hint: RowHint, label: actorName(author) }}
        menu={rowMenu(VERSION_THING, groups)}
        more={!coarse}
      />
    </RowHintOptions>
  );
}

const ALL_VERSIONS = "All versions";
const ALL_VERSIONS_PLACE = "all versions";

const VERSION_HISTORY = "Version history";

function SectionsHead({
  author,
  source,
  onBack,
}: {
  author: Actor;
  source: SourceDoor | undefined;
  onBack: (() => void) | undefined;
}): React.JSX.Element {
  const name = (
    <OneLine className={VERSION_AUTHOR}>
      {actorName(author)}
      <LeftWords actor={author} />
    </OneLine>
  );
  return (
    <>
      {onBack === undefined ? null : (
        <BackButton
          look={BACK_BUTTON_LOOK.COLUMN}
          label={ALL_VERSIONS}
          place={ALL_VERSIONS_PLACE}
          command={APP_COMMAND.EXIT_VERSION_HISTORY}
          onBack={onBack}
        />
      )}
      <p className="version-sections-head mx-0 my-control-gap flex min-w-0 flex-none items-center gap-control-gap whitespace-nowrap px-row-inset py-item-gap">
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

function SectionRow({
  section,
  selected,
  rowRef,
  onSelect,
  source,
  copyLink,
}: {
  section: ChangedSection;
  selected: boolean;
  rowRef: (row: HTMLElement | null) => void;
  onSelect: () => void;
  source: SourceDoor | undefined;
  copyLink: MenuAction | undefined;
}): React.JSX.Element {
  const word = SECTION_CHANGE_WORDS[section.change];
  const coarse = useCoarsePointer();
  const items = [
    ...(copyLink === undefined ? [] : [copyLink]),
    ...(source === undefined ? [] : [sourceItem(source)]),
  ];
  return (
    <ListRow
      ref={rowRef}
      title={sectionName(section.heading)}
      meta={word}
      current={selected ? LIST_ROW_CURRENT.ITEM : undefined}
      onPress={onSelect}
      menu={items.length === 0 ? undefined : rowMenu(SECTION_THING, [items])}
      more={!coarse}
    />
  );
}

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

class OlderVersionsUnread extends Error {
  constructor() {
    super("The older versions could not be read.");
    this.name = "OlderVersionsUnread";
  }
}

function EarlierRow({
  before,
  onRead,
}: {
  before: number;
  onRead: () => Promise<boolean>;
}): React.JSX.Element {
  const older = useMutation({
    mutationFn: async () => {
      if (!(await onRead())) throw new OlderVersionsUnread();
    },
  });
  const reading = older.isPending;
  const failed = older.isError;
  const read = () => {
    if (!reading) older.mutate();
  };
  return (
    <div className="version-earlier mx-0 mt-control-gap mb-0 px-row-inset py-row-inset text-caption text-muted-foreground">
      {failed ? (
        <FailureNote
          failure={unreadShown(FAILURE_SURFACE.DESCRIPTION_HISTORY_OLDER_READ)}
          onRetry={read}
        >
          Could not read older versions.
        </FailureNote>
      ) : (
        <ShowMoreRow
          more={before - 1}
          shown={false}
          onToggle={read}
          busy={reading}
          busyLabel={readingWords("older versions")}
        />
      )}
    </div>
  );
}

function keyOfRow<K>(rows: Map<K, HTMLElement>, element: EventTarget | null): K | undefined {
  for (const [key, row] of rows) if (row === element) return key;
  return undefined;
}

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

function useOpenedRowShown(
  selected: number | undefined,
  rows: Map<number, HTMLElement>,
  log: RefObject<HTMLDivElement | null>,
  run: RefObject<VirtualRowsHandle | null>,
): void {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current || selected === undefined || log.current === null) return;
    const row = rows.get(selected);
    if (row === undefined) {
      shown.current = run.current?.bringIn(String(selected)) === true;
      return;
    }
    shown.current = true;
    const box = log.current.getBoundingClientRect();
    const line = row.getBoundingClientRect();
    if (line.top < box.top || line.bottom > box.bottom) centerWithin(log.current, row);
  }, [selected, rows, log, run]);
}

const REVISION_ESTIMATE_PX = 64;

const REVISION_GAP_PX = 2;

const ROW_PRESS = ".ui-list-row-main";

function openedSections(
  viewing: ViewedVersion | undefined,
  opened: OpenedSections | undefined,
): readonly ChangedSection[] | undefined {
  if (opened === undefined || viewing?.line.seq !== opened.seq) return undefined;
  const { read } = viewing;
  if (read.kind !== HISTORY_READ.READY) return undefined;
  return changedSections(versionDiff(read.previous, read.document), read.previous === null);
}

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

function VersionPage({
  subject,
  restore,
  section,
  lead,
}: {
  subject: VersionSubject;
  restore: VersionRestore;
  section: number | undefined;
  lead: React.ReactNode;
}): React.JSX.Element {
  const { versions } = subject;
  if (versions.viewing !== undefined) {
    return (
      <VersionView
        viewing={versions.viewing}
        restore={restore}
        title={subject.title}
        section={section}
        task={subject.task}
        lead={lead}
        onRetry={versions.onRetryVersion}
      />
    );
  }
  const { list } = versions;
  const finding = list.kind === HISTORY_READ.READY && list.revisions.length > 0;
  if (list.kind === HISTORY_READ.READING || finding) {
    return <VersionPageSkeleton lead={lead} title={subject.title} section={section} />;
  }
  return (
    <>
      {lead === undefined ? (
        <Toolbar />
      ) : (
        <PhoneHead place="version" start={lead} title={null} end={null} />
      )}
      <Fill className="desktop-empty-region">
        {list.kind === HISTORY_READ.FAILED ? (
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.DESCRIPTION_HISTORY_READ)}
            onRetry={versions.onRetry}
            placement={ERROR_STATE_PLACEMENT.CENTERED}
          >
            The history could not be read.
          </ErrorState>
        ) : (
          <EmptyState>{NO_HISTORY_LINE}</EmptyState>
        )}
      </Fill>
    </>
  );
}

const VERSION_LIST = "Versions";

const VERSION_LIST_PLACE = "versions";

export function taskVersionSubject(tasks: TasksControl): VersionSubject {
  const { region, boundFor } = tasks;
  const task = region.kind === DOCUMENT_REGION.READY ? region.task : undefined;
  const workspace = tasks.workspaces.find((each) => each.id === task?.workspaceId);
  return {
    workspace,
    task:
      task === undefined
        ? undefined
        : {
            taskId: task.id,
            place: { workspace: workspace?.slug ?? task.workspaceId, repository: task.repository },
            anchors: new Set(
              sectionAnchors(
                descriptionSections(task.document.body).map((section) => section.heading),
              ),
            ),
          },
    versions: tasks.history,
    title: task?.name,
    agents: tasks.agents.agents ?? [],
    summary: revisionSummary,
    onShowSource:
      boundFor === undefined ? undefined : (source) => tasks.onShowSource(boundFor, source),
  };
}

export function DesktopVersionHistory({
  sidebar,
  room,
  history,
  subject,
  account,
  onExit,
  onRestored,
  exitPlace,
}: {
  sidebar: SidebarCollapse;
  room: ShellRoom;
  history: NavigationHistory;
  subject: VersionSubject;
  account: AccountSnapshot;
  onExit: () => void;
  onRestored: () => void;
  exitPlace?: string | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const { versions, agents } = subject;
  const { list } = versions;
  const revisions = list.kind === HISTORY_READ.READY ? list.revisions : [];
  const rows = useRef(new Map<number, HTMLElement>()).current;
  const sectionRows = useRef(new Map<number, HTMLElement>()).current;
  const log = useRef<HTMLDivElement>(null);
  const run = useRef<VirtualRowsHandle>(null);
  const keys = useMemo(() => revisions.map((line) => String(line.seq)), [revisions]);
  const roving = useRovingKeys<HTMLDivElement>({
    reach: (from, to) => {
      const inHand = from?.closest(`[${VIRTUAL_ROW_KEY_ATTRIBUTE}]`);
      const key = reachedKey(
        keys,
        inHand?.getAttribute(VIRTUAL_ROW_KEY_ATTRIBUTE) ?? undefined,
        to,
      );
      if (key === undefined) return false;
      const press = run.current?.rowElement(key)?.querySelector<HTMLElement>(ROW_PRESS);
      if (press !== undefined && press !== null) {
        press.focus();
        return true;
      }
      return (
        run.current?.bringIn(key, (row) => row.querySelector<HTMLElement>(ROW_PRESS)?.focus()) ===
        true
      );
    },
  });
  const { opened } = versions.spot ?? {};
  const edge = useListEdge(sidebar);
  const people = useQuery(workspaceMembersQuery(subject.workspace?.id)).data;
  const copy = useCopyToast();
  const chord = useChordLinks();
  const numbered = useNumberedPlace();
  const linked = subject.task;
  const versionLinkItem = (revision: number): MenuAction | undefined =>
    linked === undefined
      ? undefined
      : copyLinkItem(
          copy,
          linkOf(
            numbered(
              { kind: LINK_PLACE.VERSION, planId: linked.taskId, revision },
              linked.place.workspace,
            ),
            linked.place.workspace,
          ),
          chord,
        );
  const reader = readerOf(account, people?.members, people?.former);
  const restore = useVersionRestore(versions, onRestored);
  const sections = openedSections(versions.viewing, opened);
  const failed = sectionsFailed(versions.viewing, opened);
  const sourceOf = (line: DescriptionRevisionLine, author: Actor): SourceDoor | undefined => {
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
    openedLine === undefined ? undefined : revisionAuthorOf(openedLine, reader, agents);
  const openedSource =
    openedLine === undefined || openedAuthor === undefined
      ? undefined
      : sourceOf(openedLine, openedAuthor);
  const openSections = versions.onOpenSections;
  const restoreOf = (line: DescriptionRevisionLine): (() => void) | undefined => {
    const newest = revisions[0]?.seq;
    if (line.seq === newest) return undefined;
    return () => restore.onRestore(line.seq);
  };
  const closeSections = () => {
    if (opened === undefined) return;
    versions.onCloseSections();
    const row = rows.get(opened.seq);
    if (row !== undefined) row.focus();
    else
      run.current?.bringIn(String(opened.seq), (drawn) =>
        drawn.querySelector<HTMLElement>(ROW_PRESS)?.focus(),
      );
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
  useOpenedRowShown(versions.selected, rows, log, run);
  const split = useScreenSplit(room);
  const hidden = hiddenColumns(split.columns, versions.listed);
  const screen = useScreenRef(useNarrowFocus(split.columns, versions.listed), split.ref);
  const narrow = room === SHELL_ROOM.NARROW;
  const exitPlaceName = exitPlace ?? backPlaceOf(history, subject.title ?? "description");

  return (
    <div
      ref={screen}
      className={`desktop-version-history ${PLACE_SPLIT}`}
      data-single={String(split.single)}
    >
      <nav
        className={`version-log ph-no-capture ${PLACE_LIST}`}
        aria-label="Versions"
        hidden={hidden.list}
      >
        {narrow ? (
          <PhoneHead
            place="version-log"
            start={
              opened === undefined ? (
                <BackButton
                  label="Back"
                  place={exitPlaceName}
                  command={APP_COMMAND.EXIT_VERSION_HISTORY}
                  onBack={onExit}
                />
              ) : (
                <BackButton
                  label={ALL_VERSIONS}
                  place={ALL_VERSIONS_PLACE}
                  command={APP_COMMAND.EXIT_VERSION_HISTORY}
                  onBack={closeSections}
                />
              )
            }
            title={VERSION_HISTORY}
            end={null}
          />
        ) : (
          <>
            <div className="desktop-drag-strip" />
            <HistoryButtons history={history} room={room} />
            <BackButton
              look={BACK_BUTTON_LOOK.COLUMN}
              label="Back"
              place={exitPlaceName}
              command={opened === undefined ? APP_COMMAND.EXIT_VERSION_HISTORY : NO_BACK_KEY}
              onBack={onExit}
            />
          </>
        )}
        <div
          className="version-log-track -mx-ring-reach grid min-h-0 flex-1 grid-cols-version-track grid-rows-version-track overflow-x-clip"
          data-opened={String(opened !== undefined)}
        >
          <div className={VERSION_PANE} inert={opened !== undefined}>
            {narrow ? null : (
              <Text
                as={TEXT_ELEMENT.H1}
                variant={TEXT_VARIANT.TITLE}
                className={`version-log-title ${PLACE_LIST_TITLE}`}
              >
                {VERSION_HISTORY}
              </Text>
            )}
            <Fill className="sidebar-section -m-ring-reach">
              <ScrollArea ref={log} fade={SCROLL_FADE.BOTH}>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: the keys and the focus are the rows' own, which the box only hears bubble. */}
                <div
                  {...roving}
                  className="sidebar-section-body flex min-h-list-held flex-col p-ring-reach"
                  onFocus={(event) => {
                    roving.onFocus(event);
                    chooseSteppedRow(rows, versions.onSelect)(event);
                  }}
                  onKeyDown={(event) => {
                    versionKeys(event);
                    if (!event.defaultPrevented) roving.onKeyDown(event);
                  }}
                >
                  {list.kind === HISTORY_READ.READING ? <LogSkeleton /> : null}
                  <VirtualRows
                    scroller={log}
                    keys={keys}
                    estimate={REVISION_ESTIMATE_PX}
                    gap={REVISION_GAP_PX}
                    anchor={VIRTUAL_ROWS_ANCHOR.START}
                    listItems
                    holdsFocus
                    aria-label={LIST_LABEL.VERSIONS}
                    handle={run}
                  >
                    {(index, place) => {
                      const line = revisions[index];
                      if (line === undefined) return null;
                      const author = revisionAuthorOf(line, reader, agents);
                      return (
                        <RevisionRow
                          line={line}
                          place={place}
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
                          copyLink={versionLinkItem(line.seq)}
                          summary={subject.summary(line)}
                        />
                      );
                    }}
                  </VirtualRows>
                  {list.kind === HISTORY_READ.READY && list.earlier !== undefined ? (
                    <EarlierRow before={list.earlier} onRead={versions.onLoadEarlier} />
                  ) : null}
                </div>
              </ScrollArea>
            </Fill>
          </div>
          <Fill
            as={FILL_ELEMENT.SECTION}
            className={`sidebar-section -m-ring-reach ${VERSION_PANE}`}
            aria-label={LIST_LABEL.SECTIONS}
            inert={opened === undefined}
          >
            <ScrollArea fade={SCROLL_FADE.BOTH}>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: the keys and the focus are the rows' own, which the box only hears bubble. */}
              <div
                className="sidebar-section-body flex min-h-list-held flex-col p-ring-reach"
                onFocus={chooseSteppedRow(sectionRows, chooseUnit)}
                onKeyDown={sectionKeys}
              >
                {openedLine === undefined ? null : (
                  <>
                    <SectionsHead
                      author={openedAuthor ?? revisionAuthorOf(openedLine, reader, agents)}
                      source={openedSource}
                      onBack={narrow ? undefined : closeSections}
                    />
                    {failed ? (
                      <ErrorState
                        failure={unreadShown(FAILURE_SURFACE.DESCRIPTION_VERSION_READ)}
                        onRetry={versions.onRetryVersion}
                        placement={ERROR_STATE_PLACEMENT.ROWS}
                      >
                        {SECTIONS_FAILED}
                      </ErrorState>
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
                          copyLink={opened === undefined ? undefined : versionLinkItem(opened.seq)}
                        />
                      ))}
                    </List>
                  </>
                )}
              </div>
            </ScrollArea>
          </Fill>
        </div>
        {split.single ? null : <ResizeEdge edge={edge} />}
      </nav>
      <section
        className={`version-page ph-no-capture ${PLACE_PAGE}`}
        aria-label="Version"
        hidden={hidden.item}
      >
        <PageFind page={FIND_PAGE.VERSION_HISTORY} at={String(versions.selected)} active>
          <VersionPage
            subject={subject}
            restore={restore}
            section={opened === undefined ? undefined : unit}
            lead={
              split.single ? (
                <BackButton
                  label={VERSION_LIST}
                  place={VERSION_LIST_PLACE}
                  onBack={versions.onList}
                />
              ) : undefined
            }
          />
        </PageFind>
      </section>
    </div>
  );
}

export function TaskVersionHistory({
  tasks,
  ...view
}: Omit<Parameters<typeof DesktopVersionHistory>[0], "subject"> & {
  tasks: TasksControl;
}): React.JSX.Element {
  return <DesktopVersionHistory {...view} subject={taskVersionSubject(tasks)} />;
}

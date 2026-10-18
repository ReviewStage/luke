import {
  clearedIssueFilter,
  filteredIssues,
  ISSUE_GROUPING,
  ISSUE_PRIORITY_WORDS,
  type IssueGrouping,
  issueFilterAnyPriority,
  issueFilterChanged,
  issueFilterCreatedBy,
  issueFilterToggledPriority,
} from "@luke/features/issue-list-model";
import {
  ISSUE_CALL_FAILURE,
  type IssueCallFailure,
  type IssueView,
} from "@luke/features/issue-view";
import type { Issue, IssueStatus } from "@luke/features/issue-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { useAppCommand } from "@luke/panel/app-commands";
import { PaneGlide } from "@luke/panel/desktop/pane-motion";
import { type IssueChange, useIssue, useIssues } from "@luke/panel/desktop/use-issues";
import { useRowKeys } from "@luke/panel/desktop/use-row-keys";
import { MemberDirectory, useMemberDirectory } from "@luke/panel/member-directory";
import { useMinute } from "@luke/panel/tasks/task-time";
import { TOAST_HOLD, TOAST_TONE, useToast } from "@luke/panel/toast";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_VARIANT,
  Button,
  COLLECTION_STATE,
  CollectionPage,
  type CollectionState,
  DetailPage,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  IconButton,
  PAGE_FRAME,
  PAGE_WIDTH,
  useMenu,
} from "@luke/ui";
import { Schema } from "effect";
import {
  CircleCheckIcon,
  CircleDotIcon,
  ListFilterIcon,
  ListIcon,
  ListTodoIcon,
  PlusIcon,
  SignalHighIcon,
  SlidersHorizontalIcon,
  SquareKanbanIcon,
  UsersIcon,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LinkWorkspaceProvider } from "../copy-link-item";
import { ExperimentTag, SendFeedbackButton } from "../experiment-marks";
import { ISSUES_PAGE, type TasksControl } from "../tasks/use-tasks-tab";
import { commandKeyshortcuts, Tooltip } from "../tooltip";
import { ActionMenu, type MenuAction, type MenuEntry } from "./action-menu";
import { openPullRequest } from "./desktop-factory";
import { readKept, writeKept } from "./folded-groups";
import { IssueBoard, IssueBoardSkeleton, useBoardKeys } from "./issue-board";
import { IssueCrumbs, IssueDetail, IssueDetailSkeleton, IssueDocumentPage } from "./issue-detail";
import { type IssueFilterControl, useIssueFilter } from "./issue-filter-view";
import { IssueList, listRowIssue } from "./issue-list";
import { ISSUE_OPENING, type IssueOpening, IssuePeek, peekFits } from "./issue-peek";
import { PRIORITY_ORDER, PriorityGlyph } from "./issue-pickers";
import { type IssueWork, IssueWorkProvider } from "./issue-work";
import { type IssueDraft, NewIssueDialog } from "./new-issue-dialog";
import { createdByEntries } from "./sidebar-task-view";

/**
 * issues-page.tsx -- the window's Issues page: the listed workspace's issues on a board of a column for each status, or listed under a heading for each, and a new one filed from a card.
 *
 * It stands in the plan's place beside the sidebar, as the Automations page
 * does, and its sidebar row is marked while it does. It is an experiment
 * (`EXPERIMENT.ISSUES`): every door to it is gated on the account's switch,
 * and its toolbar says so with a quiet badge and Send feedback. New issue,
 * or C pressed anywhere on the page but a field, opens a card as New task
 * does (`new-issue-dialog.tsx`), whose issue lands in its group at once; a
 * board column's + opens it with that column's status chosen. A workspace
 * with no issue yet says so in either layout, New issue its one way on.
 * ↑ and ↓ move through the rows from anywhere on the
 * page. A press or Return on a card or row peeks its issue beside the
 * board or list (`issue-peek.tsx`), which follows the keyboard from card
 * to card and which Escape puts away; with ⌘ held, or from the peek's Open
 * as page, the issue opens on its own page instead (`issue-detail.tsx`),
 * from which Escape comes back to the list with that row holding the
 * keyboard. Board or List, as View options last chose, and
 * whether the List groups by status or by priority, are kept in the
 * renderer's own storage as the Inbox's view choices are
 * (`folded-groups.ts`), so the page opens in them again on this Mac. View
 * options also filters the issues, by priority, by who filed them, and past
 * settled ones gone quiet (`issue-list-model.ts`), kept per workspace the
 * same way (`issue-filter-view.ts`); a filter that keeps none of a
 * workspace's issues says so, with Clear filters.
 */

/** A board's card, and every press that opens an issue: a card, or a list row. */
const CARD = ".sidebar-task";
const PRESSES = `${CARD}, button.luke-list-row-main`;

/** What takes typing, where C is a letter rather than the command: a field, or words edited where they stand. */
const TYPED_INTO = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/** Whether an element takes typing. */
function typedInto(element: HTMLElement): boolean {
  return element.isContentEditable || element.closest(TYPED_INTO) !== null;
}

/** How the page lays its issues out: a board of a column for each status, as it first opens, or the list under a heading for each. */
const ISSUES_LAYOUT = {
  BOARD: "board",
  LIST: "list",
} as const;

type IssuesLayout = (typeof ISSUES_LAYOUT)[keyof typeof ISSUES_LAYOUT];

/** Where the layout last chosen is kept in the renderer's storage. */
const LAYOUT_KEY = "luke.issuesLayout";

/** The layout last chosen. */
const storedLayout = Schema.fromJsonString(Schema.Literals(Object.values(ISSUES_LAYOUT)));

/** Where the List's grouping last chosen is kept in the renderer's storage. */
const GROUPING_KEY = "luke.issuesGrouping";

/** The List's grouping last chosen. */
const storedGrouping = Schema.fromJsonString(Schema.Literals(Object.values(ISSUE_GROUPING)));

/** How the List groups its issues, and the press that changes it. */
interface GroupingControl {
  readonly grouping: IssueGrouping;
  readonly onGrouping: (grouping: IssueGrouping) => void;
}

/** What the toolbar's layout menu is called. */
const VIEW_OPTIONS = "View options";

/** What files a new issue is called, in the toolbar and in an empty workspace. */
const NEW_ISSUE = "New issue";

/** What the list's page is read as while its issues are, and one issue's page while its issue is. */
const READING_LINE = "Reading issues";
const READING_ONE_LINE = "Reading the issue";

/** What the list says where it could not be read. */
const UNREAD_LINE = "The issues could not be read.";

/** What the page says where its filter keeps none of the workspace's issues. */
const NO_MATCH_LINE = "No issues match";

/** What one issue's page says where it could not be read, and where it names no issue of the workspace. */
const UNREAD_ONE_LINE = "The issue could not be read.";
const GONE_LINE = "This issue is gone, or not in this workspace.";

/** What a change the service did not keep says. */
const UNCHANGED_LINE = "Couldn't change the issue. Try again.";

/** The new issue's card as asked for: the status it opens on, or none for the card's own. */
interface Composing {
  readonly status: IssueStatus | undefined;
}

/**
 * A change's answer as the pages say it: whether it was kept, and a toast
 * where it was not. Note that a refused archive is said by its own dialog,
 * which stays up to say it.
 */
function useChangeSaid(): (asked: IssueChange, sent: Promise<IssueView>) => Promise<boolean> {
  const toast = useToast();
  return (asked, sent) =>
    sent.then((answer) => {
      if ("issue" in answer) return true;
      if (asked.archived === undefined) {
        toast({ words: UNCHANGED_LINE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
      }
      return false;
    });
}

/**
 * Whether the keyboard is still where a change from an issue's menu left it:
 * on that issue's card or row, or on nothing once the answer moved the card
 * away. A card a change moved keeps the keyboard only then, so one answered
 * after the developer went on to another control takes nothing from it.
 */
function keyboardLeftWith(issueId: string): boolean {
  const at = document.activeElement;
  if (at === null || at === document.body) return true;
  if (!(at instanceof HTMLElement)) return false;
  return (
    (at.closest<HTMLElement>("[data-issue-id]")?.dataset.issueId ?? listRowIssue(at)) === issueId
  );
}

/** The issue a card's or a list row's press opens, if the element is one. */
function pressIssue(element: HTMLElement): string | undefined {
  if (element.matches(CARD))
    return element.closest<HTMLElement>("[data-issue-id]")?.dataset.issueId;
  return listRowIssue(element);
}

/** The press of an issue's card or row as the page draws it now, if it stands. */
function pressOf(page: HTMLElement, issueId: string): HTMLElement | undefined {
  return [...page.querySelectorAll<HTMLElement>(PRESSES)].find(
    (press) => pressIssue(press) === issueId,
  );
}

/**
 * What the list's page stands, by its read, its layout, and what its
 * filter keeps. Note that a workspace with no issue yet stands the empty
 * state in either layout, as Factory does, rather than a board of empty
 * columns, and a filter that keeps none of a workspace's issues says so in
 * either layout; and that a board being read stands as ready, drawing its
 * own columns of blocks (`IssueBoardSkeleton`), since the page's loading
 * rows are a list's shape, not a board's.
 */
function listState(
  read: ReturnType<typeof useIssues>["read"],
  onBoard: boolean,
  kept: number,
): CollectionState {
  if (read === undefined) return onBoard ? COLLECTION_STATE.READY : COLLECTION_STATE.LOADING;
  if ("failure" in read) return COLLECTION_STATE.ERROR;
  return kept === 0 ? COLLECTION_STATE.EMPTY : COLLECTION_STATE.READY;
}

/** The list's page: the listed workspace's issues by status, as its filter keeps them, a new one a press away. */
function ListPage({
  root,
  tasks,
  issues,
  focused,
  peeked,
  layout,
  onLayout,
  grouping,
  filter,
  onFocus,
  onOpen,
  onCompose,
  onComposeIn,
}: {
  /** What the arrows move through the rows of: the pages' own root. */
  root: HTMLElement | null;
  tasks: TasksControl;
  issues: ReturnType<typeof useIssues>;
  /** The issue whose card or row takes the keyboard as it is drawn. */
  focused: string | undefined;
  /** The issue read in the peek beside the page, whose card or row is marked; none while none is. */
  peeked: string | undefined;
  layout: IssuesLayout;
  onLayout: (layout: IssuesLayout) => void;
  grouping: GroupingControl;
  /** What the page leaves out of the workspace's issues, and the press that changes it. */
  filter: IssueFilterControl;
  /** Hands the keyboard to an issue's card or row wherever it is drawn next, or to none. */
  onFocus: (issueId: string | undefined) => void;
  /** Opens an issue as its card or row was pressed: in the peek, or on its own page. */
  onOpen: (issue: Issue, opening: IssueOpening) => void;
  /** Opens the new issue's card; none while no workspace is listed to file one in. */
  onCompose: (() => void) | undefined;
  /** Opens the card with a board column's status chosen; none while no workspace is listed. */
  onComposeIn: ((status: IssueStatus) => void) | undefined;
}): React.JSX.Element {
  const view = tasks.issuesView;
  useAppCommand(APP_COMMAND.EXIT_ISSUES, view.onClose);
  const now = useMinute();
  const workspace = tasks.workspace;
  const { read, reload } = issues;
  const onBoard = layout === ISSUES_LAYOUT.BOARD;
  useRowKeys(root, tasks.shown && !onBoard);
  useBoardKeys(root, tasks.shown && onBoard);
  const said = useChangeSaid();
  const change = (issue: Issue, asked: IssueChange) => {
    const sent = said(asked, issues.change({ issueId: issue.id, change: asked }));
    if (asked.archived !== undefined) return sent;
    // Note that no card takes the keyboard while the change is out, so a card redrawn meanwhile takes it from nothing.
    onFocus(undefined);
    return sent.then((kept) => {
      if (kept && keyboardLeftWith(issue.id)) onFocus(issue.id);
      return kept;
    });
  };
  const workspaceName = workspace?.name ?? "";
  const every = read !== undefined && "issues" in read ? read.issues : undefined;
  const listed = every === undefined ? undefined : filteredIssues(every, filter.filter, now);
  return (
    <CollectionPage
      frame={PAGE_FRAME.TOOLBAR}
      // Note that the board stands its columns across the room and scrolls sideways past it, each column scrolling its own cards.
      width={onBoard ? PAGE_WIDTH.FULL : PAGE_WIDTH.MEASURE}
      label="Issues"
      toolbar={
        <header className="desktop-toolbar">
          <div className="desktop-toolbar-heading">
            <h1 className="desktop-toolbar-title">Issues</h1>
            <ExperimentTag />
          </div>
          <div className="desktop-toolbar-actions">
            <SendFeedbackButton experiment={EXPERIMENT.ISSUES} />
            <ViewOptions
              shown={tasks.shown}
              workspace={workspace}
              layout={layout}
              onLayout={onLayout}
              grouping={grouping}
              filter={filter}
            />
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              icon={<PlusIcon />}
              aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.NEW_ISSUE)}
              disabled={onCompose === undefined}
              onClick={onCompose}
            >
              {NEW_ISSUE}
            </Button>
          </div>
        </header>
      }
      state={listState(read, onBoard, listed?.length ?? 0)}
      loadingLabel={READING_LINE}
      empty={
        every !== undefined && every.length > 0 ? (
          <EmptyState
            icon={<ListFilterIcon />}
            action={{
              label: "Clear filters",
              onClick: () => filter.onFilter(clearedIssueFilter(every, now)),
            }}
          >
            {NO_MATCH_LINE}
          </EmptyState>
        ) : (
          // Note that its New issue is the toolbar's, unavailable while no workspace is listed or the card stands.
          <EmptyState
            icon={<ListTodoIcon />}
            action={{
              label: NEW_ISSUE,
              disabled: onCompose === undefined,
              onClick: () => onCompose?.(),
            }}
          >
            No issues yet
          </EmptyState>
        )
      }
      error={
        <ErrorState onRetry={reload} placement={ERROR_STATE_PLACEMENT.CENTRED}>
          {UNREAD_LINE}
        </ErrorState>
      }
    >
      {/* Note that the children stand only once ready, which a page still being read is only on the board. */}
      {listed === undefined ? (
        <IssueBoardSkeleton label={READING_LINE} />
      ) : onBoard ? (
        <IssueBoard
          issues={listed}
          workspaceName={workspaceName}
          now={now}
          focused={focused}
          peeked={peeked}
          shown={tasks.shown}
          onOpen={onOpen}
          onCompose={onComposeIn}
          onChange={change}
        />
      ) : (
        <div className="issue-groups">
          <IssueList
            grouping={grouping.grouping}
            issues={listed}
            workspaceName={workspaceName}
            now={now}
            focused={focused}
            peeked={peeked}
            shown={tasks.shown}
            onOpen={onOpen}
            onChange={change}
          />
        </div>
      )}
    </CollectionPage>
  );
}

/**
 * The toolbar's button that drops the menu of how the page lays its issues
 * out and what it leaves out, each choice checked, as the sidebar's tasks
 * View options does: Board or List, and while the List stands, Group by
 * Status or Priority; Priority, every one or those chosen;
 * Created by, in a shared workspace or while it filters, Anyone, Me, or a
 * member by face; and Show completed, whether a Done or Canceled issue
 * last changed over a week ago stands, off at first. While the filter
 * differs from that first one, the button wears the sidebar's dot and
 * says it is filtered.
 */
function ViewOptions({
  shown,
  workspace,
  layout,
  onLayout,
  grouping,
  filter: { filter, onFilter },
}: {
  shown: boolean;
  /** The workspace listed, which alone filters by creator where it is shared. */
  workspace: TasksControl["workspace"];
  layout: IssuesLayout;
  onLayout: (layout: IssuesLayout) => void;
  grouping: GroupingControl;
  filter: IssueFilterControl;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const reader = useMemberDirectory();
  const memberCount = workspace?.memberCount;
  const shared = memberCount === undefined ? (reader.members?.length ?? 0) > 1 : memberCount > 1;
  const layouts: MenuAction[] = [
    {
      label: "Board",
      icon: <SquareKanbanIcon />,
      checked: layout === ISSUES_LAYOUT.BOARD,
      onSelect: () => onLayout(ISSUES_LAYOUT.BOARD),
    },
    {
      label: "List",
      icon: <ListIcon />,
      checked: layout === ISSUES_LAYOUT.LIST,
      onSelect: () => onLayout(ISSUES_LAYOUT.LIST),
    },
  ];
  const groupBy = (label: string, icon: React.JSX.Element, value: IssueGrouping): MenuAction => ({
    label,
    icon,
    checked: grouping.grouping === value,
    onSelect: () => grouping.onGrouping(value),
  });
  // Note that only the List groups: the board's columns are its statuses.
  const groupings: MenuEntry[] =
    layout === ISSUES_LAYOUT.LIST
      ? [
          {
            label: "Group by",
            icon: <ListIcon />,
            items: [
              groupBy("Status", <CircleDotIcon />, ISSUE_GROUPING.STATUS),
              groupBy("Priority", <SignalHighIcon />, ISSUE_GROUPING.PRIORITY),
            ],
          },
        ]
      : [];
  const priorities: MenuEntry = {
    label: "Priority",
    icon: <SignalHighIcon />,
    items: [
      {
        label: "Any priority",
        checked: filter.priorities === undefined,
        onSelect: () => onFilter(issueFilterAnyPriority(filter)),
      },
      ...PRIORITY_ORDER.map((priority) => ({
        label: ISSUE_PRIORITY_WORDS[priority],
        icon: <PriorityGlyph priority={priority} />,
        checked: filter.priorities?.includes(priority) === true,
        onSelect: () => onFilter(issueFilterToggledPriority(filter, priority)),
      })),
    ],
  };
  const createdBy: MenuEntry[] =
    shared || filter.createdBy !== undefined
      ? [
          {
            label: "Created by",
            icon: <UsersIcon />,
            items: createdByEntries(
              filter.createdBy,
              (chosen) => onFilter(issueFilterCreatedBy(filter, chosen)),
              reader,
            ),
          },
        ]
      : [];
  const completed: MenuAction = {
    label: "Show completed",
    icon: <CircleCheckIcon />,
    detail: "Done or canceled over a week ago",
    checked: filter.showCompleted,
    onSelect: () => onFilter({ ...filter, showCompleted: !filter.showCompleted }),
  };
  const filtered = issueFilterChanged(filter);
  return (
    <>
      <span className="issues-view-options" data-filtered={filtered ? "true" : undefined}>
        <Tooltip label={VIEW_OPTIONS}>
          <IconButton
            icon={<SlidersHorizontalIcon />}
            label={VIEW_OPTIONS}
            aria-description={filtered ? "Filtered" : undefined}
            {...menu.trigger()}
          />
        </Tooltip>
      </span>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          groups={[[...layouts, ...groupings], [priorities, ...createdBy], [completed]]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** One issue's page while its issue is not drawn: its page in blocks while it is read, or why it could not be, with Retry. */
function DetailFrame({
  failure,
  onRetry,
  onBack,
}: {
  failure: IssueCallFailure | undefined;
  onRetry: () => void;
  onBack: () => void;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_ISSUES, onBack);
  const toolbar = (
    <header className="desktop-toolbar">
      <div className="desktop-toolbar-heading">
        <IssueCrumbs onBack={onBack} />
        <ExperimentTag />
      </div>
    </header>
  );
  // Note that the blocks stand in the issue's own document, so the issue lands where they stood.
  if (failure === undefined) {
    return (
      <IssueDocumentPage label="Issue" toolbar={toolbar}>
        <IssueDetailSkeleton label={READING_ONE_LINE} />
      </IssueDocumentPage>
    );
  }
  return (
    <DetailPage frame={PAGE_FRAME.TOOLBAR} label="Issue" toolbar={toolbar}>
      <ErrorState onRetry={onRetry} placement={ERROR_STATE_PLACEMENT.CENTRED}>
        {failure === ISSUE_CALL_FAILURE.NOT_FOUND ? GONE_LINE : UNREAD_ONE_LINE}
      </ErrorState>
    </DetailPage>
  );
}

/**
 * One issue's page: the issue as its own read answered it, or as the list
 * holds it until then, and every change sent through the list, so the list
 * it goes back to already holds what was kept.
 */
function IssuePage({
  tasks,
  issueId,
  issues,
  onBack,
}: {
  tasks: TasksControl;
  issueId: string;
  issues: ReturnType<typeof useIssues>;
  onBack: () => void;
}): React.JSX.Element {
  const said = useChangeSaid();
  const { read, reload, change } = useIssue(issueId, issues.change);
  const listed =
    issues.read !== undefined && "issues" in issues.read
      ? issues.read.issues.find((each) => each.id === issueId)
      : undefined;
  const issue = read !== undefined && "issue" in read ? read.issue : listed;
  const onChange = (asked: IssueChange) => said(asked, change(asked));
  // Note that an issue of a workspace other than the one listed is no issue of this page, as a link to one is not.
  const listedElsewhere =
    issue !== undefined &&
    tasks.workspace !== undefined &&
    issue.workspaceId !== tasks.workspace.id;
  if (issue === undefined || listedElsewhere) {
    const failure = listedElsewhere
      ? ISSUE_CALL_FAILURE.NOT_FOUND
      : read !== undefined && "failure" in read
        ? read.failure
        : undefined;
    return <DetailFrame failure={failure} onRetry={reload} onBack={onBack} />;
  }

  return (
    // The workspace's members, read for the issue's creator: their picture, and You for the reader's own.
    <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
      <IssueDetail
        issue={issue}
        workspaceName={tasks.workspace?.name ?? ""}
        onChange={onChange}
        onBack={onBack}
      />
    </MemberDirectory>
  );
}

/**
 * The listed workspace's tasks started from the issue, the archived ones
 * among them, newest started first whatever the sidebar's pins put first.
 */
function tasksStartedFrom(issueId: string, listed: TasksControl["listed"]): TaskSummary[] {
  return [...listed.tasks, ...listed.archived]
    .filter((task) => task.issueId === issueId)
    .sort((one, other) => other.createdAt - one.createdAt || other.id.localeCompare(one.id));
}

/**
 * The window's Issues pages, in the plan's place: the list, or one issue's.
 * The list is read once for both, so an issue opened from it draws at once
 * and a change is in the list the moment it lands; going back from an
 * issue hands its row the keyboard.
 */
export function IssuesPage({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  const work: IssueWork = {
    onStartTask: (issue, identifier, agent) =>
      tasks.onNewTaskFrom(
        { id: issue.id, workspaceId: issue.workspaceId, identifier, title: issue.title },
        agent,
      ),
    tasksOf: (issueId) => tasksStartedFrom(issueId, tasks.listed),
    onOpenTask: tasks.onSelect,
    onOpenPullRequest: (task, pullRequest) => openPullRequest(tasks, task, pullRequest),
  };
  // Every Copy link on these pages is written under the listed workspace, whose issues they are.
  return (
    <LinkWorkspaceProvider value={tasks.workspace?.slug ?? tasks.workspace?.id}>
      <IssueWorkProvider value={work}>
        <IssuesPages tasks={tasks} />
      </IssueWorkProvider>
    </LinkWorkspaceProvider>
  );
}

/** The Issues pages themselves, under the workspace their links are written in. */
function IssuesPages({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  const view = tasks.issuesView;
  const workspace = tasks.workspace;
  const issues = useIssues(workspace?.id);
  const [cameFrom, setCameFrom] = useState<string | undefined>(undefined);
  const [composing, setComposing] = useState<Composing | undefined>(undefined);
  // Note that the layout is the page's own, so an issue opened from it goes back to it, and the board until one is first chosen.
  const [layout, setLayout] = useState<IssuesLayout>(() =>
    readKept(LAYOUT_KEY, storedLayout, ISSUES_LAYOUT.BOARD),
  );
  const [grouping, setGrouping] = useState<IssueGrouping>(() =>
    readKept(GROUPING_KEY, storedGrouping, ISSUE_GROUPING.STATUS),
  );
  const filter = useIssueFilter(tasks.me, workspace?.id);
  const [pages, setPages] = useState<HTMLDivElement | null>(null);
  // Note that the pane motion reads the root as a ref, and the arrows and C as the element itself.
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const holdPages = useCallback((node: HTMLDivElement | null) => {
    pagesRef.current = node;
    setPages(node);
  }, []);
  // The peek is the window's side panel beside the page, drawing the issue last peeked while it is open.
  const { sidePanel } = tasks;
  const { peeked, onPeek } = view;
  const said = useChangeSaid();
  const listedNow = useRef(workspace?.id);
  listedNow.current = workspace?.id;
  /**
   * The new issue's card asked for. Note that the page must hold the
   * keyboard, or the window itself, and no field of the page may, because C
   * is a letter as well as the command: one typed in a title, the
   * description, or the card's own field is that letter and nothing more.
   */
  const compose = (status?: IssueStatus) => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) {
      if (!pages?.contains(focused) || typedInto(focused)) return;
    }
    setComposing({ status });
  };
  const onCompose =
    workspace === undefined || composing !== undefined ? undefined : () => compose();
  // Note that a column's + stands while the card does, which covers it, so the heads hold still under the card.
  const onComposeIn = workspace === undefined ? undefined : compose;
  useAppCommand(APP_COMMAND.NEW_ISSUE, onCompose);
  const onCreate = (draft: IssueDraft) => {
    if (workspace === undefined) return Promise.resolve(false);
    return issues
      .create({ workspaceId: workspace.id, ...draft })
      .then((answer) => "issue" in answer);
  };
  const { place } = view;
  const back = () => {
    if (place.kind === ISSUES_PAGE.ISSUE) setCameFrom(place.issueId);
    view.onOpen({ kind: ISSUES_PAGE.LIST });
  };
  // Note that the peek reads the issues the page draws, so one View options or the minute filters out is peeked no more.
  const now = useMinute();
  const listedIssues =
    issues.read !== undefined && "issues" in issues.read
      ? filteredIssues(issues.read.issues, filter.filter, now)
      : undefined;
  const peekedIssue =
    place.kind === ISSUES_PAGE.LIST && peeked !== undefined
      ? listedIssues?.find((each) => each.id === peeked)
      : undefined;
  const peeking = sidePanel.open && peekedIssue !== undefined;
  // Note that an issue the page no longer draws, archived, filtered out, or of a workspace no longer listed, is peeked no more, the panel showing it sliding out with it.
  const gone =
    peeked !== undefined &&
    listedIssues !== undefined &&
    !listedIssues.some((each) => each.id === peeked);
  const { onSetOpen, open: panelOpen } = sidePanel;
  // Note that a peek is of the workspace it was opened in, so another workspace listed puts it away for good, though its list held the issue too.
  const listedIn = useRef(workspace?.id);
  const moved = listedIn.current !== workspace?.id;
  // Note that it is shut before the frame is painted, so the panel slides out rather than vanishing for a frame first.
  useLayoutEffect(() => {
    if (moved) listedIn.current = workspace?.id;
    if (!gone && !(moved && peeked !== undefined)) return;
    if (panelOpen) onSetOpen(false);
    onPeek(undefined);
  }, [gone, moved, peeked, workspace?.id, panelOpen, onSetOpen, onPeek]);
  // Note that the issue's page draws no panel, so a peek filling the page is brought back beside it first, and leaves no panel full screen for the next page to draw.
  const openPage = (issue: Issue) => {
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    onPeek(undefined);
    view.onOpen({ kind: ISSUES_PAGE.ISSUE, issueId: issue.id });
  };
  // Note that a page with no room for the panel beside a column opens the issue's page, as before there was a peek.
  const open = (issue: Issue, opening: IssueOpening) => {
    if (opening === ISSUE_OPENING.PAGE || pages === null || !peekFits(pages)) {
      openPage(issue);
      return;
    }
    onPeek(issue.id);
    onSetOpen(true);
  };
  /** Puts the peek away, handing its card or row the keyboard where the panel held it, or nothing did. */
  const closePeek = () => {
    const at = document.activeElement;
    const keyless =
      at === null ||
      at === document.body ||
      (pages?.querySelector(".side-panel")?.contains(at) ?? false);
    if (peeked !== undefined && pages !== null && keyless) pressOf(pages, peeked)?.focus();
    onSetOpen(false);
  };
  // While a peek stands it follows the keyboard: a card or row reached by an arrow, Tab, or a press is the one peeked.
  useEffect(() => {
    if (pages === null || !peeking) return;
    const follow = (event: FocusEvent) => {
      const issueId = event.target instanceof HTMLElement ? pressIssue(event.target) : undefined;
      if (issueId !== undefined) onPeek(issueId);
    };
    pages.addEventListener("focusin", follow);
    return () => pages.removeEventListener("focusin", follow);
  }, [pages, peeking, onPeek]);
  // Note that a window narrowed past the peek's room beside a column puts the peek away, as one that never had it opens none.
  const closeNow = useRef(closePeek);
  closeNow.current = closePeek;
  useEffect(() => {
    if (pages === null || !peeking) return;
    const observer = new ResizeObserver(() => {
      if (!peekFits(pages)) closeNow.current();
    });
    observer.observe(pages);
    return () => observer.disconnect();
  }, [pages, peeking]);
  return (
    <div ref={holdPages} className="issues-pages" data-panel-open={String(peeking)}>
      {place.kind === ISSUES_PAGE.LIST ? (
        // The workspace's members, read for View options' Created by: their faces, and Me for the reader.
        <MemberDirectory workspace={workspace} readerId={tasks.me}>
          <ListPage
            root={pages}
            tasks={tasks}
            issues={issues}
            focused={cameFrom}
            peeked={peekedIssue?.id}
            layout={layout}
            onLayout={(chosen) => {
              // Note that the row the page came back from is let go, so the new layout's row takes no keyboard from the menu.
              setCameFrom(undefined);
              setLayout(chosen);
              writeKept(LAYOUT_KEY, storedLayout, chosen);
            }}
            grouping={{
              grouping,
              onGrouping: (chosen) => {
                // As with a layout, the row the page came back from takes no keyboard from the menu.
                setCameFrom(undefined);
                setGrouping(chosen);
                writeKept(GROUPING_KEY, storedGrouping, chosen);
              },
            }}
            filter={{
              filter: filter.filter,
              onFilter: (chosen) => {
                // As with a layout, the row the page came back from takes no keyboard from the menu.
                setCameFrom(undefined);
                filter.onFilter(chosen);
              },
            }}
            onFocus={setCameFrom}
            onOpen={open}
            onCompose={onCompose}
            onComposeIn={onComposeIn}
          />
        </MemberDirectory>
      ) : (
        // Keyed by the issue, so another issue's page holds nothing of the last's.
        <IssuePage
          key={place.issueId}
          tasks={tasks}
          issueId={place.issueId}
          issues={issues}
          onBack={back}
        />
      )}
      {/* The workspace's members, read for the peeked issue's creator: their picture, and You for the reader's own. */}
      <MemberDirectory workspace={workspace} readerId={tasks.me}>
        <IssuePeek
          panel={sidePanel}
          issue={place.kind === ISSUES_PAGE.LIST ? peekedIssue : undefined}
          workspaceName={workspace?.name ?? ""}
          onChange={(asked) =>
            peeked === undefined
              ? Promise.resolve(false)
              : said(asked, issues.change({ issueId: peeked, change: asked }))
          }
          onClose={closePeek}
          onOpenPage={openPage}
        />
      </MemberDirectory>
      {/* The board or list glides as the peek takes its room and gives it back. */}
      <PaneGlide root={pagesRef} layout={{ peekOpen: peeking }} />
      {/* Keyed by the workspace, so a title typed in one is never filed in another. */}
      <NewIssueDialog
        key={workspace?.id}
        open={composing !== undefined}
        status={composing?.status}
        onCreate={onCreate}
        onClose={() => {
          // Note that a card filed in a workspace no longer listed puts away no card of the one listed now.
          if (listedNow.current === workspace?.id) setComposing(undefined);
        }}
      />
    </div>
  );
}

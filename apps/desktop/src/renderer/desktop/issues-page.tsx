import {
  ISSUE_CALL_FAILURE,
  type IssueCallFailure,
  type IssueView,
} from "@luke/features/issue-view";
import type { Issue, IssueStatus } from "@luke/features/issue-wire";
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
  ListIcon,
  ListTodoIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  SquareKanbanIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { useAppCommand } from "../app-commands";
import { LinkWorkspaceProvider } from "../copy-link-item";
import { ExperimentTag, SendFeedbackButton } from "../experiment-marks";
import { MemberDirectory } from "../member-directory";
import { useMinute } from "../tasks/task-time";
import { ISSUES_PAGE, type TasksControl } from "../tasks/use-tasks-tab";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";
import { commandKeyshortcuts, Tooltip } from "../tooltip";
import { ActionMenu, type MenuAction } from "./action-menu";
import { readKept, writeKept } from "./folded-groups";
import { IssueBoard, IssueBoardSkeleton, useBoardKeys } from "./issue-board";
import { IssueCrumbs, IssueDetail, IssueDetailSkeleton } from "./issue-detail";
import { IssueList, listRowIssue } from "./issue-list";
import { type IssueWork, IssueWorkProvider } from "./issue-work";
import { type IssueDraft, NewIssueDialog } from "./new-issue-dialog";
import { type IssueChange, useIssue, useIssues } from "./use-issues";
import { useRowKeys } from "./use-row-keys";

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
 * page, and Return opens the one reached on its own page
 * (`issue-detail.tsx`), from which Escape comes back to the list with that
 * row holding the keyboard. Board or List, as View options last chose, is
 * kept in the renderer's own storage as the Inbox's view choices are
 * (`folded-groups.ts`), so the page opens in it again on this Mac.
 */

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

/** What the toolbar's layout menu is called. */
const VIEW_OPTIONS = "View options";

/** What files a new issue is called, in the toolbar and in an empty workspace. */
const NEW_ISSUE = "New issue";

/** What the list's page is read as while its issues are, and one issue's page while its issue is. */
const READING_LINE = "Reading issues";
const READING_ONE_LINE = "Reading the issue";

/** What the list says where it could not be read. */
const UNREAD_LINE = "The issues could not be read.";

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

/**
 * What the list's page stands, by its read and its layout. Note that a
 * workspace with no issue yet stands the empty state in either layout, as
 * Factory does, rather than a board of empty columns; and that
 * a board being read stands as ready, drawing its own columns of blocks
 * (`IssueBoardSkeleton`), since the page's loading rows are a list's shape,
 * not a board's.
 */
function listState(read: ReturnType<typeof useIssues>["read"], onBoard: boolean): CollectionState {
  if (read === undefined) return onBoard ? COLLECTION_STATE.READY : COLLECTION_STATE.LOADING;
  if ("failure" in read) return COLLECTION_STATE.ERROR;
  return read.issues.length === 0 ? COLLECTION_STATE.EMPTY : COLLECTION_STATE.READY;
}

/** The list's page: the listed workspace's issues by status, a new one a press away. */
function ListPage({
  root,
  tasks,
  issues,
  focused,
  layout,
  onLayout,
  onFocus,
  onCompose,
  onComposeIn,
}: {
  /** What the arrows move through the rows of: the pages' own root. */
  root: HTMLElement | null;
  tasks: TasksControl;
  issues: ReturnType<typeof useIssues>;
  /** The issue whose card or row takes the keyboard as it is drawn. */
  focused: string | undefined;
  layout: IssuesLayout;
  onLayout: (layout: IssuesLayout) => void;
  /** Hands the keyboard to an issue's card or row wherever it is drawn next, or to none. */
  onFocus: (issueId: string | undefined) => void;
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
  const open = (issue: Issue) => view.onOpen({ kind: ISSUES_PAGE.ISSUE, issueId: issue.id });
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
  const listed = read !== undefined && "issues" in read ? read.issues : undefined;
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
            <ViewOptions shown={tasks.shown} layout={layout} onLayout={onLayout} />
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
      state={listState(read, onBoard)}
      loadingLabel={READING_LINE}
      empty={
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
          shown={tasks.shown}
          onOpen={open}
          onCompose={onComposeIn}
          onChange={change}
        />
      ) : (
        <div className="issue-groups">
          <IssueList
            issues={listed}
            workspaceName={workspaceName}
            now={now}
            focused={focused}
            shown={tasks.shown}
            onOpen={open}
            onChange={change}
          />
        </div>
      )}
    </CollectionPage>
  );
}

/** The toolbar's button that drops the menu of how the page lays its issues out, the choice checked, as the Inbox's View options does. */
function ViewOptions({
  shown,
  layout,
  onLayout,
}: {
  shown: boolean;
  layout: IssuesLayout;
  onLayout: (layout: IssuesLayout) => void;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const choices: MenuAction[] = [
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
  return (
    <>
      <Tooltip label={VIEW_OPTIONS}>
        <IconButton icon={<SlidersHorizontalIcon />} label={VIEW_OPTIONS} {...menu.trigger()} />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          groups={[choices]}
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
  return (
    <DetailPage
      frame={PAGE_FRAME.TOOLBAR}
      label="Issue"
      toolbar={
        <header className="desktop-toolbar">
          <div className="desktop-toolbar-heading">
            <IssueCrumbs onBack={onBack} />
            <ExperimentTag />
          </div>
        </header>
      }
    >
      {failure === undefined ? (
        <IssueDetailSkeleton label={READING_ONE_LINE} />
      ) : (
        <ErrorState onRetry={onRetry} placement={ERROR_STATE_PLACEMENT.CENTRED}>
          {failure === ISSUE_CALL_FAILURE.NOT_FOUND ? GONE_LINE : UNREAD_ONE_LINE}
        </ErrorState>
      )}
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
 * The window's Issues pages, in the plan's place: the list, or one issue's.
 * The list is read once for both, so an issue opened from it draws at once
 * and a change is in the list the moment it lands; going back from an
 * issue hands its row the keyboard.
 */
export function IssuesPage({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  const work: IssueWork = {
    onStartTask: (issue, identifier) =>
      tasks.onNewTaskFrom({
        id: issue.id,
        workspaceId: issue.workspaceId,
        identifier,
        title: issue.title,
      }),
    tasksOf: (issueId) => tasks.listed.tasks.filter((task) => task.issueId === issueId),
    onOpenTask: tasks.onSelect,
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
  const [pages, setPages] = useState<HTMLDivElement | null>(null);
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
  return (
    <div ref={setPages} className="issues-pages">
      {place.kind === ISSUES_PAGE.LIST ? (
        <ListPage
          root={pages}
          tasks={tasks}
          issues={issues}
          focused={cameFrom}
          layout={layout}
          onLayout={(chosen) => {
            // Note that the row the page came back from is let go, so the new layout's row takes no keyboard from the menu.
            setCameFrom(undefined);
            setLayout(chosen);
            writeKept(LAYOUT_KEY, storedLayout, chosen);
          }}
          onFocus={setCameFrom}
          onCompose={onCompose}
          onComposeIn={onComposeIn}
        />
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

import { ISSUE_CALL_FAILURE, type IssueCallFailure } from "@luke/features/issue-view";
import { EXPERIMENT } from "@luke/settings";
import { ListTodoIcon } from "lucide-react";
import { useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { EmptyState } from "../empty-state";
import { ExperimentTag, SendFeedbackButton } from "../experiment-marks";
import { READ_FAILURE_PLACE, ReadFailure } from "../read-failure";
import { Skeleton, SkeletonRegion } from "../skeleton";
import { useMinute } from "../tasks/task-time";
import { ISSUES_PAGE, type TasksControl } from "../tasks/use-tasks-tab";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";
import { IssueDetail } from "./issue-detail";
import { IssueList } from "./issue-list";
import { type IssueChange, useIssue, useIssues } from "./use-issues";
import { useRowKeys } from "./use-row-keys";

/**
 * issues-page.tsx -- the window's Issues page: the listed workspace's issues, grouped by where each stands, and a new one filed by typing its title.
 *
 * It stands in the plan's place beside the sidebar, as the Automations page
 * does, and its sidebar row is marked while it does. It is an experiment
 * (`EXPERIMENT.ISSUES`): every door to it is gated on the account's switch,
 * and its toolbar says so with a quiet badge and Send feedback. The
 * toolbar's field files an issue in the listed workspace on Return, which lands in its group at
 * once and empties the field; a filing the service refused keeps the title
 * typed and says so. ↑ and ↓ move through the rows from anywhere on the
 * page, and Return opens the one reached on its own page
 * (`issue-detail.tsx`), from which Escape comes back to the list with that
 * row holding the keyboard.
 */

/** What the list says where it could not be read. */
const UNREAD_LINE = "The issues could not be read.";

/** What one issue's page says where it could not be read, and where it names no issue of the workspace. */
const UNREAD_ONE_LINE = "The issue could not be read.";
const GONE_LINE = "This issue is gone, or not in this workspace.";

/** What a change the service did not keep says. */
const UNCHANGED_LINE = "Couldn't change the issue. Try again.";

/** What a filing the service did not take says. */
const UNFILED_LINE = "Couldn't create the issue. Try again.";

/** The rows a read still out stands in for, by their widths. */
const LIST_SKELETON = ["62%", "48%", "71%", "55%"] as const;

/** The field a new issue's title is typed into, Return filing it. */
function NewIssueField({
  disabled,
  onFile,
}: {
  disabled: boolean;
  onFile: (title: string) => Promise<boolean>;
}): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [filing, setFiling] = useState(false);
  const file = () => {
    const typed = title.trim();
    if (typed === "" || filing) return;
    setFiling(true);
    onFile(typed).then((filed) => {
      setFiling(false);
      if (filed) setTitle("");
    });
  };
  return (
    <input
      type="text"
      className="settings-input issues-new-title"
      aria-label="New issue title"
      placeholder="New issue…"
      value={title}
      disabled={disabled}
      readOnly={filing}
      onChange={(event) => setTitle(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        file();
      }}
    />
  );
}

/** The list's page: the listed workspace's issues by status, a new one a title away. */
function ListPage({
  plans,
  issues,
  focused,
}: {
  plans: TasksControl;
  issues: ReturnType<typeof useIssues>;
  focused: string | undefined;
}): React.JSX.Element {
  const view = plans.issuesView;
  useAppCommand(APP_COMMAND.EXIT_ISSUES, view.onClose);
  const toast = useToast();
  const now = useMinute();
  const workspace = plans.workspace;
  const { read, reload, create } = issues;
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useRowKeys(root, plans.shown);
  const onFile = (title: string) => {
    if (workspace === undefined) return Promise.resolve(false);
    return create({ workspaceId: workspace.id, title }).then((answer) => {
      if ("issue" in answer) return true;
      toast({ words: UNFILED_LINE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
      return false;
    });
  };
  return (
    <section ref={setRoot} className="issues-view" aria-label="Issues">
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          <h1 className="desktop-toolbar-title">Issues</h1>
          <ExperimentTag />
        </div>
        <div className="desktop-toolbar-actions">
          <SendFeedbackButton experiment={EXPERIMENT.ISSUES} />
          {/* Keyed by the workspace, so a title typed in one is never filed in another. */}
          <NewIssueField key={workspace?.id} disabled={workspace === undefined} onFile={onFile} />
        </div>
      </header>
      <div className="issues-scroll scroll-fade-top">
        {read === undefined ? (
          <SkeletonRegion label="Reading the issues…" className="issues-skeleton">
            {LIST_SKELETON.map((width) => (
              <div key={width} className="issues-skeleton-row">
                <Skeleton width={width} />
              </div>
            ))}
          </SkeletonRegion>
        ) : "failure" in read ? (
          <ReadFailure line={UNREAD_LINE} onRetry={reload} place={READ_FAILURE_PLACE.CENTRED} />
        ) : read.issues.length === 0 ? (
          <EmptyState icon={<ListTodoIcon />}>No issues yet</EmptyState>
        ) : (
          <IssueList
            issues={read.issues}
            workspaceName={workspace?.name ?? ""}
            now={now}
            focused={focused}
            onOpen={(issue) => view.onOpen({ kind: ISSUES_PAGE.ISSUE, issueId: issue.id })}
          />
        )}
      </div>
    </section>
  );
}

/** One issue's page while its issue is not drawn: its empty frame while it is read, or why it could not be, with Retry. */
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
    <section className="issues-view" aria-label="Issue">
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          <button type="button" className="toolbar-button" onClick={onBack}>
            <ListTodoIcon />
            Issues
          </button>
        </div>
      </header>
      <div className="issues-scroll scroll-fade-top">
        {failure === undefined ? null : (
          <ReadFailure
            line={failure === ISSUE_CALL_FAILURE.NOT_FOUND ? GONE_LINE : UNREAD_ONE_LINE}
            onRetry={onRetry}
            place={READ_FAILURE_PLACE.CENTRED}
          />
        )}
      </div>
    </section>
  );
}

/**
 * One issue's page: the issue as its own read answered it, or as the list
 * holds it until then, and every change sent through the list, so the list
 * it goes back to already holds what was kept.
 */
function DetailPage({
  plans,
  issueId,
  issues,
  onBack,
}: {
  plans: TasksControl;
  issueId: string;
  issues: ReturnType<typeof useIssues>;
  onBack: () => void;
}): React.JSX.Element {
  const toast = useToast();
  const { read, reload, change } = useIssue(issueId, issues.change);
  const listed =
    issues.read !== undefined && "issues" in issues.read
      ? issues.read.issues.find((each) => each.id === issueId)
      : undefined;
  const issue = read !== undefined && "issue" in read ? read.issue : listed;
  const onChange = (asked: IssueChange) =>
    change(asked).then((answer) => {
      if ("issue" in answer) return true;
      // Note that a refused archive is said by its own dialog, which stays up to say it.
      if (asked.archived === undefined) {
        toast({ words: UNCHANGED_LINE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
      }
      return false;
    });
  // Note that an issue of a workspace other than the one listed is no issue of this page, as a link to one is not.
  const listedElsewhere =
    issue !== undefined &&
    plans.workspace !== undefined &&
    issue.workspaceId !== plans.workspace.id;
  if (issue === undefined || listedElsewhere) {
    const failure = listedElsewhere
      ? ISSUE_CALL_FAILURE.NOT_FOUND
      : read !== undefined && "failure" in read
        ? read.failure
        : undefined;
    return <DetailFrame failure={failure} onRetry={reload} onBack={onBack} />;
  }

  return (
    <IssueDetail
      issue={issue}
      workspaceName={plans.workspace?.name ?? ""}
      onChange={onChange}
      onBack={onBack}
    />
  );
}

/**
 * The window's Issues pages, in the plan's place: the list, or one issue's.
 * The list is read once for both, so an issue opened from it draws at once
 * and a change is in the list the moment it lands; going back from an
 * issue hands its row the keyboard.
 */
export function IssuesPage({ tasks: plans }: { tasks: TasksControl }): React.JSX.Element {
  const view = plans.issuesView;
  const issues = useIssues(plans.workspace?.id);
  const [cameFrom, setCameFrom] = useState<string | undefined>(undefined);
  const { place } = view;
  if (place.kind === ISSUES_PAGE.LIST) {
    return <ListPage plans={plans} issues={issues} focused={cameFrom} />;
  }
  const back = () => {
    setCameFrom(place.issueId);
    view.onOpen({ kind: ISSUES_PAGE.LIST });
  };
  // Keyed by the issue, so another issue's page holds nothing of the last's.
  return (
    <DetailPage
      key={place.issueId}
      plans={plans}
      issueId={place.issueId}
      issues={issues}
      onBack={back}
    />
  );
}

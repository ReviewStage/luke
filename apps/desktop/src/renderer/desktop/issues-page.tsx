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
import { IssueList } from "./issue-list";
import { useIssues } from "./use-issues";
import { useRowKeys } from "./use-row-keys";

/**
 * issues-page.tsx -- the window's Issues page: the listed workspace's issues, grouped by where each stands, and a new one filed by typing its title.
 *
 * It stands in the plan's place beside the sidebar, as the Automations page
 * does, and its sidebar row is marked while it does. It is an experiment
 * (`EXPERIMENT.ISSUES`): every door to it is gated on the account's switch,
 * and its toolbar says so with a quiet badge and Send feedback. The toolbar's field files an
 * issue in the listed workspace on Return, which lands in its group at
 * once and empties the field; a filing the service refused keeps the title
 * typed and says so. ↑ and ↓ move through the rows from anywhere on the
 * page, and Return opens the one reached.
 */

/** What the list says where it could not be read. */
const UNREAD_LINE = "The issues could not be read.";

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
      onChange={(event) => setTitle(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        file();
      }}
    />
  );
}

/**
 * The window's Issues page, in the plan's place: the listed workspace's
 * issues by status, a new one a title away.
 */
export function IssuesPage({ tasks: plans }: { tasks: TasksControl }): React.JSX.Element {
  const view = plans.issuesView;
  useAppCommand(APP_COMMAND.EXIT_ISSUES, view.onClose);
  const toast = useToast();
  const now = useMinute();
  const workspace = plans.workspace;
  const { read, reload, create } = useIssues(workspace?.id);
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
          <NewIssueField disabled={workspace === undefined} onFile={onFile} />
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
            onOpen={(issue) => view.onOpen({ kind: ISSUES_PAGE.ISSUE, issueId: issue.id })}
          />
        )}
      </div>
    </section>
  );
}

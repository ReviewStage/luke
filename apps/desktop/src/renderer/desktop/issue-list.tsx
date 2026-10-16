import {
  ISSUE_PRIORITY_WORDS,
  ISSUE_STATUS_WORDS,
  issueGroups,
  issueIdentifier,
} from "@luke/features/issue-list-model";
import {
  ISSUE_PRIORITY,
  ISSUE_STATUS,
  type Issue,
  type IssuePriority,
  type IssueStatus,
} from "@luke/features/issue-wire";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleIcon,
  CircleXIcon,
  SignalHighIcon,
  SignalLowIcon,
  SignalMediumIcon,
} from "lucide-react";
import { GLYPH_STATE, StateGlyph } from "../state-glyph";
import { RelativeTime } from "../tasks/relative-time";

/**
 * issue-list.tsx -- a workspace's issues as the Issues page lists them: under a heading for each status, the work under way first, each row its status, its identifier, its title, how much it matters, and when it last changed.
 *
 * Every row is drawn as a sidebar row is, a button inside its item, so the
 * page's ↑ and ↓ move through the rows and Return opens the one reached.
 * The order is the view model's (`issue-list-model.ts`); nothing is sorted
 * here.
 */

/** Each status's glyph, as its group's heading and its rows wear it. */
const STATUS_GLYPH = {
  [ISSUE_STATUS.BACKLOG]: <CircleDashedIcon />,
  [ISSUE_STATUS.TODO]: <CircleIcon />,
  [ISSUE_STATUS.IN_PROGRESS]: <CircleDotIcon />,
  [ISSUE_STATUS.DONE]: <CircleCheckIcon />,
  [ISSUE_STATUS.CANCELED]: <CircleXIcon />,
} as const satisfies Record<IssueStatus, React.ReactNode>;

/** Each priority's mark; an unweighed issue wears none. */
const PRIORITY_GLYPH = {
  [ISSUE_PRIORITY.NONE]: null,
  [ISSUE_PRIORITY.URGENT]: <CircleAlertIcon />,
  [ISSUE_PRIORITY.HIGH]: <SignalHighIcon />,
  [ISSUE_PRIORITY.MEDIUM]: <SignalMediumIcon />,
  [ISSUE_PRIORITY.LOW]: <SignalLowIcon />,
} as const satisfies Record<IssuePriority, React.ReactNode>;

/** A status's glyph, coloured by the status it stands for. */
function StatusGlyph({ status }: { status: IssueStatus }): React.JSX.Element {
  return (
    <span className="issue-status-glyph" data-status={status}>
      <StateGlyph glyph={STATUS_GLYPH[status]} state={GLYPH_STATE.REST} />
    </span>
  );
}

/** One issue's row: one press that opens it. */
function IssueRow({
  issue,
  workspaceName,
  now,
  onOpen,
}: {
  issue: Issue;
  workspaceName: string;
  now: number;
  onOpen: () => void;
}): React.JSX.Element {
  const priority = PRIORITY_GLYPH[issue.priority];
  return (
    <li className="sidebar-task-item home-row issue-row" data-issue-id={issue.id}>
      <button type="button" className="sidebar-task" onClick={onOpen}>
        <span className="sidebar-task-line">
          <span className="home-row-picture">
            <StatusGlyph status={issue.status} />
          </span>
          <span className="issue-row-identifier">
            {issueIdentifier(workspaceName, issue.number)}
          </span>
          <span className="sidebar-task-name issue-row-title">{issue.title}</span>
          {priority === null ? null : (
            <span
              className="issue-priority-mark"
              data-priority={issue.priority}
              title={ISSUE_PRIORITY_WORDS[issue.priority]}
            >
              {priority}
              <span className="visually-hidden">{ISSUE_PRIORITY_WORDS[issue.priority]}</span>
            </span>
          )}
          <RelativeTime className="sidebar-task-time" at={issue.updatedAt} now={now} />
        </span>
      </button>
    </li>
  );
}

/** The issues under a heading for each status they stand in, the work under way first. */
export function IssueList({
  issues,
  workspaceName,
  now,
  onOpen,
}: {
  issues: readonly Issue[];
  workspaceName: string;
  now: number;
  onOpen: (issue: Issue) => void;
}): React.JSX.Element {
  return (
    <>
      {issueGroups(issues).map((group) => (
        <section
          key={group.status}
          className="issue-group"
          aria-label={ISSUE_STATUS_WORDS[group.status]}
        >
          <h2 className="issue-group-head">
            <StatusGlyph status={group.status} />
            <span className="issue-group-name">{ISSUE_STATUS_WORDS[group.status]}</span>
            <span className="issue-group-count">{group.issues.length}</span>
          </h2>
          <ul className="issue-rows">
            {group.issues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                workspaceName={workspaceName}
                now={now}
                onOpen={() => onOpen(issue)}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

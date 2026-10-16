import {
  ISSUE_PRIORITY_WORDS,
  ISSUE_STATUS_WORDS,
  issueGroups,
  issueIdentifier,
} from "@luke/features/issue-list-model";
import type { Issue } from "@luke/features/issue-wire";
import { useLayoutEffect, useRef } from "react";
import { RelativeTime } from "../tasks/relative-time";
import { PRIORITY_GLYPH, StatusGlyph } from "./issue-pickers";

/**
 * issue-list.tsx -- a workspace's issues as the Issues page lists them: under a heading for each status, the work under way first, each row its status, its identifier, its title, how much it matters, and when it last changed.
 *
 * Every row is drawn as a sidebar row is, a button inside its item, so the
 * page's ↑ and ↓ move through the rows and Return opens the one reached.
 * The order is the view model's (`issue-list-model.ts`); nothing is sorted
 * here.
 */

/** One issue's row: one press that opens it, holding the keyboard as it is drawn where it is the issue the page came back from. */
function IssueRow({
  issue,
  workspaceName,
  now,
  focused,
  onOpen,
}: {
  issue: Issue;
  workspaceName: string;
  now: number;
  focused: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const priority = PRIORITY_GLYPH[issue.priority];
  const row = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (focused) row.current?.focus();
  }, [focused]);
  return (
    <li className="sidebar-task-item home-row issue-row" data-issue-id={issue.id}>
      <button ref={row} type="button" className="sidebar-task" onClick={onOpen}>
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
  focused,
  onOpen,
}: {
  issues: readonly Issue[];
  workspaceName: string;
  now: number;
  /** The issue whose row takes the keyboard as the list is drawn: the one the page came back from. */
  focused: string | undefined;
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
                focused={issue.id === focused}
                onOpen={() => onOpen(issue)}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

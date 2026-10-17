import { ISSUE_STATUS_WORDS, issueGroups, issueIdentifier } from "@luke/features/issue-list-model";
import type { Issue } from "@luke/features/issue-wire";
import { useMenu } from "@luke/ui";
import { useLayoutEffect, useRef } from "react";
import { RelativeTime } from "../tasks/relative-time";
import { IssueActions } from "./issue-actions";
import { PriorityMark, StatusGlyph } from "./issue-pickers";
import type { IssueChange } from "./use-issues";

/**
 * issue-list.tsx -- a workspace's issues as the Issues page lists them: under a heading for each status, the work under way first, each row its status, its identifier, its title, how much it matters, and when it last changed.
 *
 * The headings and rows are Home's own (`desktop-home.tsx`): a section
 * title with its count over the sidebar's rows, each a button inside its
 * item, so the page's ↑ and ↓ move through the rows and Return opens the
 * one reached. A right-click on a row, or the menu key or ⇧F10 on it,
 * opens its actions (`issue-actions.tsx`).
 * The order is the view model's (`issue-list-model.ts`); nothing is sorted
 * here.
 */

/** One issue's row: one press that opens it, holding the keyboard as it is drawn where it is the issue the page came back from. */
function IssueRow({
  issue,
  workspaceName,
  now,
  focused,
  shown,
  onOpen,
  onChange,
}: {
  issue: Issue;
  workspaceName: string;
  now: number;
  focused: boolean;
  shown: boolean;
  onOpen: () => void;
  onChange: (change: IssueChange) => Promise<boolean>;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const identifier = issueIdentifier(workspaceName, issue.number);
  const row = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (focused) row.current?.focus();
  }, [focused]);
  return (
    <li className="sidebar-task-item home-row" data-issue-id={issue.id}>
      <button
        ref={row}
        type="button"
        className="sidebar-task"
        onClick={onOpen}
        onContextMenu={menu.contextMenu()}
        onKeyDown={menu.keyMenu}
      >
        <span className="sidebar-task-line">
          <span className="home-row-picture">
            <StatusGlyph status={issue.status} />
          </span>
          <span className="issue-row-identifier">{identifier}</span>
          <span className="sidebar-task-name issue-row-title">{issue.title}</span>
          <PriorityMark priority={issue.priority} />
          <RelativeTime className="sidebar-task-time" at={issue.updatedAt} now={now} />
        </span>
      </button>
      <IssueActions
        issue={issue}
        identifier={identifier}
        menu={menu}
        shown={shown}
        onChange={onChange}
      />
    </li>
  );
}

/** The issues under a heading for each status they stand in, the work under way first. */
export function IssueList({
  issues,
  workspaceName,
  now,
  focused,
  shown,
  onOpen,
  onChange,
}: {
  issues: readonly Issue[];
  workspaceName: string;
  now: number;
  /** The issue whose row takes the keyboard as the list is drawn: the one the page came back from. */
  focused: string | undefined;
  /** Whether the page stands, which a card's menu and question do not outlive. */
  shown: boolean;
  onOpen: (issue: Issue) => void;
  /** Sends a change to an issue from its menu, answering whether it was kept. */
  onChange: (issue: Issue, change: IssueChange) => Promise<boolean>;
}): React.JSX.Element {
  return (
    <>
      {issueGroups(issues).map((group) => (
        <section
          key={group.status}
          className="home-section"
          aria-label={ISSUE_STATUS_WORDS[group.status]}
        >
          <h2 className="home-section-title">
            {ISSUE_STATUS_WORDS[group.status]}
            <span className="home-section-count">{group.issues.length}</span>
          </h2>
          <ul className="sidebar-tasks">
            {group.issues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                workspaceName={workspaceName}
                now={now}
                focused={issue.id === focused}
                shown={shown}
                onOpen={() => onOpen(issue)}
                onChange={(change) => onChange(issue, change)}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

import {
  type IssueGrouping,
  issueIdentifier,
  issueListGroups,
} from "@luke/features/issue-list-model";
import type { Issue } from "@luke/features/issue-wire";
import { List, ListRow, TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text, useMenu } from "@luke/ui";
import { useCallback, useLayoutEffect, useRef } from "react";
import { RelativeTime } from "../tasks/relative-time";
import { IssueActions } from "./issue-actions";
import { PriorityMark, StatusGlyph } from "./issue-pickers";
import type { IssueChange } from "./use-issues";

/**
 * issue-list.tsx -- a workspace's issues as the Issues page lists them: under a heading for each status, the work under way first, or for each priority, each row its status, its identifier, its title, how much it matters, and when it last changed.
 *
 * The sections are Home's own (`desktop-home.tsx`): a heading with its
 * count over a `List` of `ListRow`s, each a press, so the page's ↑ and ↓
 * move through the rows and Return opens the one reached. A right-click on
 * a row, or the menu key or ⇧F10 on it, opens its actions
 * (`issue-actions.tsx`), which hand the keyboard back to the row's press.
 * The order is the view model's (`issue-list-model.ts`); nothing is sorted
 * here.
 */

/** Each drawn row's press, by the issue it opens. */
const ROW_ISSUES = new WeakMap<Element, string>();

/** The issue whose list row's press the element is, if it is one. */
export function listRowIssue(element: Element): string | undefined {
  return ROW_ISSUES.get(element);
}

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
  const row = useRef<HTMLElement | null>(null);
  const hold = useCallback(
    (press: HTMLElement | null) => {
      row.current = press;
      if (press !== null) ROW_ISSUES.set(press, issue.id);
    },
    [issue.id],
  );
  useLayoutEffect(() => {
    if (focused) row.current?.focus();
  }, [focused]);
  return (
    <>
      <ListRow
        ref={hold}
        leading={<StatusGlyph status={issue.status} />}
        title={
          <>
            <span className="issue-row-identifier">{identifier}</span>
            <span className="issue-row-title">{issue.title}</span>
          </>
        }
        meta={
          <span className="home-row-meta">
            <PriorityMark priority={issue.priority} />
            <RelativeTime at={issue.updatedAt} now={now} />
          </span>
        }
        onPress={onOpen}
        onContextMenu={menu.contextMenu(row)}
        onKeyDown={menu.keyMenu}
      />
      {/* Note that the menu and its question stand beside the row, not in it, because a press inside them would otherwise reach the row's own right-click. */}
      <IssueActions
        issue={issue}
        identifier={identifier}
        menu={menu}
        shown={shown}
        onChange={onChange}
      />
    </>
  );
}

/** The issues under a heading for each status they stand in, the work under way first, or for each priority, the most pressing first. */
export function IssueList({
  issues,
  grouping,
  workspaceName,
  now,
  focused,
  shown,
  onOpen,
  onChange,
}: {
  issues: readonly Issue[];
  grouping: IssueGrouping;
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
      {issueListGroups(issues, grouping).map((group) => (
        <section key={group.key} className="home-section" aria-label={group.words}>
          {/* Note that the count stands inside the heading, so a reader moving by headings hears it. */}
          <h2 className="issue-group-head">
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.SECTION} tone={TEXT_TONE.MUTED}>
              {group.words}
            </Text>
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
              {group.issues.length}
            </Text>
          </h2>
          <List label={group.words}>
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
          </List>
        </section>
      ))}
    </>
  );
}

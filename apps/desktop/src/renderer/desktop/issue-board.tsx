import {
  ISSUE_PRIORITY_WORDS,
  ISSUE_STATUS_WORDS,
  issueColumns,
  issueIdentifier,
} from "@luke/features/issue-list-model";
import type { Issue } from "@luke/features/issue-wire";
import { useEffect, useLayoutEffect, useRef } from "react";
import { RelativeTime } from "../tasks/relative-time";
import { PRIORITY_GLYPH, StatusGlyph } from "./issue-pickers";

/**
 * issue-board.tsx -- a workspace's issues as a board: a column for every status, the work under way first, each column's cards in the list's order.
 *
 * The columns are Factory's stations (`desktop-factory.tsx`), side by side
 * on a wide window and one over the next on a narrow one, so the board
 * reads as Factory's line does. A card is a row of the sidebar's own on two
 * lines, its identifier, mark, and time over its whole title, since a
 * column is too narrow for the list's one line. ↑ and ↓ move through a column's cards,
 * ← and → to the nearest card of the next column holding any, from the
 * window itself as from a card, and Return opens the card reached.
 */

/** What a column with no issue says in its own place. */
const NO_ISSUES = "No issues";

/** A card, as the list's rows are drawn: a button inside its item. */
const CARDS = ".sidebar-task";

/** A column of cards. */
const COLUMNS = "[data-issue-column]";

/** How each arrow moves: across the columns, or down a column. */
const ARROW_MOVE = {
  ArrowUp: { across: 0, down: -1 },
  ArrowDown: { across: 0, down: 1 },
  ArrowLeft: { across: -1, down: 0 },
  ArrowRight: { across: 1, down: 0 },
} as const satisfies Record<string, { across: number; down: number }>;

/** Whether a key names an arrow the board moves by. */
function isArrow(key: string): key is keyof typeof ARROW_MOVE {
  return Object.hasOwn(ARROW_MOVE, key);
}

/** The card an arrow reaches from the card at `column`, `row`, or none where the board ends that way. */
function reached(
  columns: readonly (readonly HTMLElement[])[],
  column: number,
  row: number,
  move: { readonly across: number; readonly down: number },
): HTMLElement | undefined {
  if (move.across === 0) return columns[column]?.[row + move.down];
  // Note that an empty column is passed over, to the next one holding a card.
  for (let next = column + move.across; next >= 0 && next < columns.length; next += move.across) {
    const cards = columns[next] ?? [];
    if (cards.length > 0) return cards[Math.min(row, cards.length - 1)];
  }
  return undefined;
}

/**
 * The arrows over the board, from the window itself or from one of its
 * cards: the first press from the window reaches the first card of the
 * first column holding any. A key with a modifier, or one pressed anywhere
 * else, is left alone.
 */
export function useBoardKeys(board: HTMLElement | null, shown: boolean): void {
  useEffect(() => {
    if (board === null || !shown) return;
    const step = (event: KeyboardEvent) => {
      if (!isArrow(event.key)) return;
      if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
      const columns = [...board.querySelectorAll(COLUMNS)].map((column) => [
        ...column.querySelectorAll<HTMLElement>(CARDS),
      ]);
      const from = document.activeElement;
      const column = columns.findIndex((cards) => cards.some((card) => card === from));
      const fromWindow = from === null || from === document.body;
      if (column < 0 && !fromWindow) return;
      event.preventDefault();
      if (column < 0) {
        columns.find((cards) => cards.length > 0)?.[0]?.focus();
        return;
      }
      const row = (columns[column] ?? []).findIndex((card) => card === from);
      reached(columns, column, row, ARROW_MOVE[event.key])?.focus();
    };
    window.addEventListener("keydown", step);
    return () => window.removeEventListener("keydown", step);
  }, [board, shown]);
}

/** One issue's card: one press that opens it, holding the keyboard as it is drawn where it is the issue the page came back from. */
function IssueCard({
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
  const card = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (focused) card.current?.focus();
  }, [focused]);
  return (
    <li className="sidebar-task-item home-row factory-row" data-issue-id={issue.id}>
      <button ref={card} type="button" className="sidebar-task" onClick={onOpen}>
        <span className="sidebar-task-line">
          <span className="issue-row-identifier">
            {issueIdentifier(workspaceName, issue.number)}
          </span>
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
        <span className="sidebar-task-name issue-row-title issue-card-title">{issue.title}</span>
      </button>
    </li>
  );
}

/** The board: a column for every status, each headed by its glyph, its name, and how many issues stand in it. */
export function IssueBoard({
  issues,
  workspaceName,
  now,
  focused,
  onOpen,
}: {
  issues: readonly Issue[];
  workspaceName: string;
  now: number;
  /** The issue whose card takes the keyboard as the board is drawn: the one the page came back from. */
  focused: string | undefined;
  onOpen: (issue: Issue) => void;
}): React.JSX.Element {
  return (
    <div className="factory-line-up issue-board">
      {issueColumns(issues).map((column) => (
        <section
          key={column.status}
          className="factory-step"
          data-issue-column={column.status}
          aria-label={ISSUE_STATUS_WORDS[column.status]}
        >
          <h2 className="factory-head">
            <StatusGlyph status={column.status} />
            <span className="factory-name">{ISSUE_STATUS_WORDS[column.status]}</span>
            <span className="factory-count">{column.issues.length}</span>
          </h2>
          {column.issues.length === 0 ? (
            <p className="factory-idle">{NO_ISSUES}</p>
          ) : (
            <ul className="sidebar-tasks factory-rows">
              {column.issues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  workspaceName={workspaceName}
                  now={now}
                  focused={issue.id === focused}
                  onOpen={() => onOpen(issue)}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

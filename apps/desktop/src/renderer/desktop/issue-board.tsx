import { ISSUE_STATUS_WORDS, issueColumns, issueIdentifier } from "@luke/features/issue-list-model";
import type { Issue } from "@luke/features/issue-wire";
import { useEffect, useLayoutEffect, useRef } from "react";
import { RelativeTime } from "../tasks/relative-time";
import { PriorityMark, StatusGlyph } from "./issue-pickers";

/**
 * issue-board.tsx -- a workspace's issues as a board: a column for every status, in the order work moves through them, each column's cards in the list's order.
 *
 * Each column is headed and boxed as Factory's stations are
 * (`desktop-factory.tsx`), and the columns stand side by side at every
 * width, the board scrolling sideways in its own scroller (`issues.css`)
 * rather than stacking them into a second copy of the list. A column fills
 * the page's height and scrolls its own cards, so its head stays in view. A
 * card is a row of the sidebar's own on two lines, its identifier, mark,
 * and time over its whole title, since a column is too narrow for the
 * list's one line. ↑ and ↓ move through a column's cards,
 * ← and → to the nearest card of the next column holding any, from the
 * window itself as from a card, and Return opens the card reached.
 */

/** What a column with no issue says in its own place. */
const NO_ISSUES = "No issues";

/** A card, as the list's rows are drawn: a button inside its item. */
const CARDS = ".sidebar-task";

/** A column of cards. */
const COLUMNS = "[data-issue-column]";

/** The board's own scroller, which scrolls sideways (`issues-page.tsx`). */
const BOARD_SCROLLER = ".issue-board-scroll";

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
 * Keeps the column a card stands in whole inside the board's scroller, its
 * inset to spare, scrolling only that scroller (the renderer's rule against
 * `scrollIntoView`). Note that a focus scrolls a card in only where none of
 * it shows, so a column half past the edge would hold the keyboard half
 * unseen.
 */
function keepColumnInView(card: HTMLElement): void {
  const column = card.closest<HTMLElement>(COLUMNS);
  const scroller = column?.closest<HTMLElement>(BOARD_SCROLLER);
  if (column === null || column === undefined || scroller === null || scroller === undefined) {
    return;
  }
  const inset = Number.parseFloat(getComputedStyle(scroller).paddingLeft) || 0;
  const left =
    column.getBoundingClientRect().left -
    scroller.getBoundingClientRect().left +
    scroller.scrollLeft -
    inset;
  const right = left + column.offsetWidth + 2 * inset;
  if (left < scroller.scrollLeft) scroller.scrollLeft = left;
  else if (right > scroller.scrollLeft + scroller.clientWidth) {
    scroller.scrollLeft = right - scroller.clientWidth;
  }
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
      const row = (columns[column] ?? []).findIndex((card) => card === from);
      const card =
        column < 0
          ? columns.find((cards) => cards.length > 0)?.[0]
          : reached(columns, column, row, ARROW_MOVE[event.key]);
      if (card === undefined) return;
      card.focus();
      keepColumnInView(card);
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
          <PriorityMark priority={issue.priority} />
          <RelativeTime className="sidebar-task-time" at={issue.updatedAt} now={now} />
        </span>
        <span className="sidebar-task-name issue-row-title issue-card-title">{issue.title}</span>
      </button>
    </li>
  );
}

/** The board: a column for every status, each headed by its glyph, its name, and how many issues stand in it, a column holding none saying so instead. */
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
    <div className="issue-board">
      {issueColumns(issues).map((column) => (
        <section
          key={column.status}
          className="factory-step issue-column"
          data-issue-column={column.status}
          aria-label={ISSUE_STATUS_WORDS[column.status]}
        >
          <h2 className="factory-head">
            <StatusGlyph status={column.status} />
            <span className="factory-name">{ISSUE_STATUS_WORDS[column.status]}</span>
            {column.issues.length === 0 ? null : (
              <span className="factory-count">{column.issues.length}</span>
            )}
          </h2>
          {column.issues.length === 0 ? (
            <p className="factory-idle">{NO_ISSUES}</p>
          ) : (
            <ul className="sidebar-tasks issue-column-cards scroll-fade">
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

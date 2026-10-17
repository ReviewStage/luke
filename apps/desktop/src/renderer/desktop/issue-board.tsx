import { ISSUE_STATUS_WORDS, issueColumns, issueIdentifier } from "@luke/features/issue-list-model";
import type { Issue, IssueStatus } from "@luke/features/issue-wire";
import { IconButton, TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text, useMenu } from "@luke/ui";
import { PlusIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { RelativeTime } from "../tasks/relative-time";
import { Tooltip } from "../tooltip";
import { IssueActions } from "./issue-actions";
import { PriorityMark, StatusGlyph } from "./issue-pickers";
import type { IssueChange } from "./use-issues";

/**
 * issue-board.tsx -- a workspace's issues as a board: a column for every status, in the order work moves through them, each column's cards in the list's order.
 *
 * Each column is headed and boxed as Factory's stations are
 * (`desktop-factory.tsx`), in the shared type roles and button, and the
 * columns stand side by side at every width, the board scrolling sideways in its own scroller (`issues.css`)
 * rather than stacking them into a second copy of the list. A column fills
 * the page's height and scrolls its own cards, so its head stays in view. A
 * card is a row of the sidebar's own on two lines, its identifier, mark,
 * and time over its whole title, since a column is too narrow for the
 * list's one line. A column's head ends in a + that opens the new issue's
 * card with that column's status chosen. ↑ and ↓ move through a column's cards,
 * ← and → to the nearest card of the next column holding any, from the
 * window itself as from a card, and Return opens the card reached. A
 * right-click on a card, or the menu key or ⇧F10 on it, opens its actions
 * (`issue-actions.tsx`).
 */

/** What a column with no issue says in its own place. */
const NO_ISSUES = "No issues";

/** What a column's + is called, by the column it files into. */
function newIssueIn(status: IssueStatus): string {
  return `New issue in ${ISSUE_STATUS_WORDS[status]}`;
}

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
  const card = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    // Note that the board was drawn again on the way back, its scroller at its start, so the column is brought whole into view as an arrow brings it.
    if (!focused || card.current === null) return;
    card.current.focus();
    keepColumnInView(card.current);
  }, [focused]);
  return (
    <li className="sidebar-task-item home-row factory-row" data-issue-id={issue.id}>
      <button
        ref={card}
        type="button"
        className="sidebar-task"
        onClick={onOpen}
        onContextMenu={menu.contextMenu()}
        onKeyDown={menu.keyMenu}
      >
        <span className="sidebar-task-line">
          <span className="issue-row-identifier">{identifier}</span>
          <PriorityMark priority={issue.priority} />
          <RelativeTime className="sidebar-task-time" at={issue.updatedAt} now={now} />
        </span>
        <span className="sidebar-task-name issue-row-title issue-card-title">{issue.title}</span>
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

/**
 * The board: a column for every status, each headed by its glyph, its name,
 * how many issues stand in it, and a + filing a new one into it; a column
 * holding none says so in place of its count.
 */
export function IssueBoard({
  issues,
  workspaceName,
  now,
  focused,
  shown,
  onOpen,
  onCompose,
  onChange,
}: {
  issues: readonly Issue[];
  workspaceName: string;
  now: number;
  /** The issue whose card takes the keyboard as the board is drawn: the one the page came back from. */
  focused: string | undefined;
  /** Whether the page stands, which a card's menu and question do not outlive. */
  shown: boolean;
  onOpen: (issue: Issue) => void;
  /** Opens the new issue's card with a column's status chosen; none while no workspace is listed to file one in. */
  onCompose: ((status: IssueStatus) => void) | undefined;
  /** Sends a change to an issue from its menu, answering whether it was kept. */
  onChange: (issue: Issue, change: IssueChange) => Promise<boolean>;
}): React.JSX.Element {
  return (
    <div className="issue-board">
      {issueColumns(issues).map((column) => (
        <section
          key={column.status}
          className="issue-column"
          data-issue-column={column.status}
          aria-label={ISSUE_STATUS_WORDS[column.status]}
        >
          <h2 className="issue-column-head">
            <StatusGlyph status={column.status} />
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.SECTION}>
              {ISSUE_STATUS_WORDS[column.status]}
            </Text>
            {column.issues.length === 0 ? null : (
              <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
                {column.issues.length}
              </Text>
            )}
            {onCompose === undefined ? null : (
              <Tooltip label={newIssueIn(column.status)}>
                <IconButton
                  icon={<PlusIcon />}
                  label={newIssueIn(column.status)}
                  onClick={() => onCompose(column.status)}
                />
              </Tooltip>
            )}
          </h2>
          {column.issues.length === 0 ? (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {NO_ISSUES}
            </Text>
          ) : (
            <ul className="sidebar-tasks issue-column-cards scroll-fade">
              {column.issues.map((issue) => (
                <IssueCard
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
          )}
        </section>
      ))}
    </div>
  );
}

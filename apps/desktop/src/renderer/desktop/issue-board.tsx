import {
  ISSUE_STATUS_WORDS,
  type IssueGroup,
  issueColumns,
  issueIdentifier,
} from "@luke/features/issue-list-model";
import { ISSUE_STATUS_ORDER, type Issue, type IssueStatus } from "@luke/features/issue-wire";
import type { IssueChange } from "@luke/panel/desktop/use-issues";
import { useRowDrag } from "@luke/panel/desktop/use-row-drag";
import {
  IconButton,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useMenu,
} from "@luke/ui";
import { PlusIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { RelativeTime } from "../tasks/relative-time";
import { Tooltip } from "../tooltip";
import { IssueActions } from "./issue-actions";
import { ISSUE_OPENING, type IssueOpening, openingOf, pageKey } from "./issue-peek";
import { PriorityMark, StatusGlyph } from "./issue-pickers";
import { IssueCardPullRequest } from "./issue-work";

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
 * window itself as from a card, and Return peeks the card reached, ⌘Return
 * opening its page (`issue-peek.tsx`); the card peeked is marked. A
 * right-click on a card, or the menu key or ⇧F10 on it, opens its actions
 * (`issue-actions.tsx`). A card dragged onto another column is moved to
 * that column's status, sent as its menu's Status sends it, so it stands
 * where it was until the answer lands, and a column keeps the list's order
 * rather than one dragged. The drag is the sidebar's (`use-row-drag.ts`):
 * the board is its drop scope, each column a zone of it, and a card is
 * carried over the window as a copy, as a sidebar row is, while it stands
 * faded in its column.
 */

/** What a column with no issue says in its own place. */
const NO_ISSUES = "No issues";

/** How wide each placeholder column's heading stands, as a share of what its glyph leaves, and how wide each of its cards' titles, so the columns read as columns of their own. */
const SKELETON_COLUMNS = [
  { heading: "56%", cards: ["82%", "64%", "74%"] },
  { heading: "36%", cards: ["70%", "88%"] },
  { heading: "48%", cards: ["76%", "58%", "84%"] },
  { heading: "34%", cards: ["66%"] },
  { heading: "52%", cards: ["72%"] },
] as const;

/** How wide a placeholder card's identifier and its time stand, as wide as "ACME-12" and a short "2h". */
const SKELETON_IDENTIFIER = "48px";
const SKELETON_TIME = "20px";

/** What a column's + is called, by the column it files into. */
function newIssueIn(status: IssueStatus): string {
  return `New issue in ${ISSUE_STATUS_WORDS[status]}`;
}

/** A card, as the list's rows are drawn: a button inside its item. */
const CARDS = ".sidebar-task";

/** A column of cards. */
const COLUMNS = "[data-issue-column]";

/** The board itself, which its page scrolls sideways (`issues-page.tsx`). */
const BOARD = ".issue-board";

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

/** The nearest box around the board that scrolls sideways: its page's scroll. */
function sidewaysScroller(board: HTMLElement): HTMLElement | undefined {
  for (let box = board.parentElement; box !== null; box = box.parentElement) {
    const overflow = getComputedStyle(box).overflowX;
    if (overflow === "auto" || overflow === "scroll") return box;
  }
  return undefined;
}

/**
 * Keeps the column a card stands in whole inside the page's sideways
 * scroll, the board's inset to spare, scrolling only that scroller (the
 * renderer's rule against `scrollIntoView`). Note that a focus scrolls a
 * card in only where none of it shows, so a column half past the edge
 * would hold the keyboard half unseen.
 */
function keepColumnInView(card: HTMLElement): void {
  const column = card.closest<HTMLElement>(COLUMNS);
  const board = column?.closest<HTMLElement>(BOARD);
  if (board === null || board === undefined) return;
  const scroller = sidewaysScroller(board);
  if (column === null || column === undefined || scroller === undefined) return;
  // Note that the scroll's content starts where the scroller does, less how far it has scrolled, and the board stands the page's inset in from there.
  const start = scroller.getBoundingClientRect().left - scroller.scrollLeft;
  const inset = board.getBoundingClientRect().left - start;
  const left = column.getBoundingClientRect().left - start - inset;
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
  peeked,
  shown,
  onOpen,
  onChange,
}: {
  issue: Issue;
  workspaceName: string;
  now: number;
  focused: boolean;
  /** Whether its issue is the one read in the peek beside the board. */
  peeked: boolean;
  shown: boolean;
  onOpen: (opening: IssueOpening) => void;
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
        aria-current={peeked ? true : undefined}
        onClick={(event) => onOpen(openingOf(event))}
        onContextMenu={menu.contextMenu()}
        onKeyDown={(event) => {
          // Note that ⌘Return is taken before the button's own Return, which would peek it.
          if (!pageKey(event)) return menu.keyMenu(event);
          event.preventDefault();
          onOpen(ISSUE_OPENING.PAGE);
        }}
      >
        <span className="sidebar-task-line">
          <span className="issue-row-identifier">{identifier}</span>
          <PriorityMark priority={issue.priority} />
          <IssueCardPullRequest issue={issue} />
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

/** The status a column's drop zone names, or none for a zone that is no column's. */
function columnStatus(zone: string): IssueStatus | undefined {
  return ISSUE_STATUS_ORDER.find((status) => status === zone);
}

/**
 * A column: its head, and its cards or the line saying it holds none. It is
 * a drop zone of the board, and its cards are dragged out of it onto
 * another; dropped there, a card's issue is sent that column's status.
 */
function IssueColumn({
  column,
  workspaceName,
  now,
  focused,
  peeked,
  shown,
  onOpen,
  onCompose,
  onChange,
}: {
  column: IssueGroup;
  workspaceName: string;
  now: number;
  focused: string | undefined;
  peeked: string | undefined;
  shown: boolean;
  onOpen: (issue: Issue, opening: IssueOpening) => void;
  onCompose: ((status: IssueStatus) => void) | undefined;
  onChange: (issue: Issue, change: IssueChange) => Promise<boolean>;
}): React.JSX.Element {
  const drag = useRowDrag(undefined, {
    onDropOut: (from, zone) => {
      const issue = column.issues[from];
      const status = columnStatus(zone);
      if (issue === undefined || status === undefined || status === issue.status) return;
      void onChange(issue, { status });
    },
  });
  return (
    <section
      className="issue-column"
      data-issue-column={column.status}
      data-row-drop={column.status}
      aria-label={ISSUE_STATUS_WORDS[column.status]}
    >
      <h2 className="issue-column-head">
        <StatusGlyph status={column.status} />
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.SECTION} truncate>
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
        <ul className="sidebar-tasks issue-column-cards scroll-fade" onPointerDown={drag}>
          {column.issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              workspaceName={workspaceName}
              now={now}
              focused={issue.id === focused}
              peeked={issue.id === peeked}
              shown={shown}
              onOpen={(opening) => onOpen(issue, opening)}
              onChange={(change) => onChange(issue, change)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The board: a column for every status, each headed by its glyph, its name,
 * how many issues stand in it, and a + filing a new one into it; a column
 * holding none says so in place of its count. It is the drop scope its
 * cards are dragged across.
 */
export function IssueBoard({
  issues,
  workspaceName,
  now,
  focused,
  peeked,
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
  /** The issue read in the peek beside the board, whose card is marked; none while none is. */
  peeked: string | undefined;
  /** Whether the page stands, which a card's menu and question do not outlive. */
  shown: boolean;
  /** Opens an issue as its card was pressed: in the peek, or on its own page. */
  onOpen: (issue: Issue, opening: IssueOpening) => void;
  /** Opens the new issue's card with a column's status chosen; none while no workspace is listed to file one in. */
  onCompose: ((status: IssueStatus) => void) | undefined;
  /** Sends a change to an issue from its menu, answering whether it was kept. */
  onChange: (issue: Issue, change: IssueChange) => Promise<boolean>;
}): React.JSX.Element {
  return (
    <div className="issue-board" data-row-drop-scope="">
      {issueColumns(issues).map((column) => (
        <IssueColumn
          key={column.status}
          column={column}
          workspaceName={workspaceName}
          now={now}
          focused={focused}
          peeked={peeked}
          shown={shown}
          onOpen={onOpen}
          onCompose={onCompose}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

/**
 * The board while its issues are first read: a column for every status in
 * the board's own box, its head a block where the glyph and the name will
 * stand, over a few cards each a block for its identifier and time over one
 * for its title, so the cards land where the blocks stood rather than on a
 * blank page. Nothing stands for the counts and the +, and the region says
 * what is being read.
 */
export function IssueBoardSkeleton({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="issue-board-reading">
      <SkeletonRegion label={label}>
        <div className="issue-board">
          {ISSUE_STATUS_ORDER.map((status, at) => {
            const shape = SKELETON_COLUMNS[at % SKELETON_COLUMNS.length] ?? SKELETON_COLUMNS[0];
            return (
              <div key={status} className="issue-column">
                <div className="issue-column-head">
                  <Skeleton shape={SKELETON_SHAPE.CIRCLE} width="var(--luke-control-icon)" />
                  <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.SECTION}>
                    <Skeleton width={shape.heading} />
                  </Text>
                </div>
                <div className="sidebar-tasks issue-column-cards">
                  {shape.cards.map((title, card) => (
                    // oxlint-disable-next-line react/no-array-index-key -- a placeholder's cards have nothing but their place.
                    <div key={card} className="issue-card-skeleton">
                      <span className="issue-card-skeleton-line">
                        <Skeleton width={SKELETON_IDENTIFIER} />
                        <Skeleton width={SKELETON_TIME} />
                      </span>
                      <Skeleton width={title} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </SkeletonRegion>
    </div>
  );
}

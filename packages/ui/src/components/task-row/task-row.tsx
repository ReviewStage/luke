import {
  type ComponentPropsWithRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useId,
  useRef,
} from "react";
import { cssCustomProperties } from "../../css.js";
import { FoldChevronIcon } from "../../face/glyphs.js";
import { ReplayMask } from "../../session-replay-marks.js";
import { LIST_COLUMN, TASK_PROPERTY } from "../../tasks-page-model.js";
import { BUTTON_SIZE } from "../button/button.js";
import { CARD_CORNER, CARD_ELEMENT, CARD_PADDING, CARD_SHADOW, Card } from "../card/card.js";
import { CardPress, SELECT_BOX_PLACE } from "../card-press/card-press.js";
import { motionKey, motionRows } from "../list-motion/list-motion.js";
import {
  type ListRowFold,
  type ListRowHint,
  type ListRowNest,
  nestedItem,
} from "../list-row/list-row.js";
import { OneLine } from "../one-line/one-line.js";
import { useRovingKeys } from "../roving-keys/roving-keys.js";
import { type ListRowMenu, useRowMenu } from "../row-menu/row-menu.js";
import type { ListSelection } from "../selection/list-selection.js";
import { SelectionRegion } from "../selection/selection-region.js";
import { Skeleton } from "../skeleton/skeleton.js";
import type { VirtualRowPlace } from "../virtual-rows/virtual-rows.js";

/**
 * task-row.tsx -- a task as one line of columns: how it stands to the list's task, its priority, key, and status before its name, what the list draws of it after, and an end of its owner's, each cell in its own column so the columns line up down every row, and its ⋯ coming in over the row's end.
 *
 * A row is one line of a grid its list stands, a subgrid of the list's
 * columns, as Linear's list stands its rows, so each cell lines up down the
 * list whatever any one row holds. Which cells a row draws is its list's
 * (`cells`), the same for every row of it, and what stands in each is the
 * row's owner's (`content`): the chips that change a task where it stands,
 * its key, its assignee's face, its pull requests. The Tasks page's List
 * stands every row of the page in one grid whose columns its display
 * chooses and folds by width; a list of a task's related tasks stands its
 * own (`TaskRows`), its columns fixed to the few it draws, each row led by
 * how its task stands to the list's (`RELATION`), so it reads as a
 * sentence: Blocked by, its key, its status, its name.
 *
 * The row's press reaches every edge of it (`CardPress`), opening the task,
 * its name on one line in the label's weight, what the eye reads in the
 * cells said after the name to a reader (`said`), and a mark that stands
 * beside the name (`beside`). The cells that hold a control stand over the
 * press, and the rest let the pointer through to it, a related task's kind
 * leading the row among the first; a cell of its owner's, the pull requests
 * and the end, lifts only the links and buttons in it, so a press anywhere
 * but a chip or the ⋯ opens the task. Its box comes in
 * under the pointer in the gutter at its start (`SELECT_BOX_PLACE.GUTTER`),
 * where its list chooses rows, and stays while any is chosen. Its menu
 * (`menu`) is opened alike by its ⋯, a right-click, and the menu key
 * (`useRowMenu`). The ⋯ keeps no column, so a list's last column ends at
 * the row's end inset: it comes in over the row's end while the row is in
 * hand, holds the keyboard, or has its menu open, nothing in the row moving,
 * as the sidebar's and the inbox's rows do: over the last cell, which gives
 * way under it, where that cell only says something (the time on the Tasks
 * page), and in a narrow column the list keeps for it where the last cell
 * holds a control (an assignee's chip) or the name is the last cell, so
 * neither is ever covered; on a screen with no hover it stands there at
 * rest, the cells after the name stepping aside for it where it would stand
 * over the last (`task-row.css`). A row may leave its ⋯ out (`more`), as a
 * phone's mail list draws none on its rows, and offer its menu by the long
 * press, the right-click, and the menu key alone: no cell then steps aside
 * or gives way, and its list keeps the ⋯ no column (`TaskRows`'s `more`).
 * A list whose rows are neither chosen nor carry a ⋯, a composer's dock of
 * related tasks, stands them bare (`edges`): no gutter at a row's start, its
 * first cell at its inset, and no ⋯ or column for one, its last cell, the
 * dock's ×, at its end.
 * One being renamed, whose press is its field, keeps it. Renamed, its name gives way
 * to the field its owner hands (`editor`); what did not land stands under
 * it (`note`).
 *
 * A row in a list drawing only the rows near the view (`VirtualRows`) wears
 * its place there (`place`), as a `ListRow` does. A row its list counts
 * unread names its task in the heavier weight until it is read (`unread`),
 * as a `ListRow` does, and a row may hang its owner's hint from its press
 * (`hint`), the task's card beside the row while the pointer rests on it,
 * as Home's Recent hangs it.
 *
 * A row may stand nested under another (`depth`), its name in by a nest
 * for each level, its other columns still lined up with every row's; and a
 * row with rows nested under it folds them (`fold`), by a chevron before
 * its name, a control of its own beside the press, and by → and ← on the
 * press, as a `ListRow`'s fold does; a reader hears its level and its place
 * among its siblings (`nest`), as a `ListRow`'s reader does.
 *
 * A group's quick add draws its draft as a row of the same cells, raised
 * as a card off the list (`TaskRowDraft`), so it reads as the row it is
 * about to be, and a list still being read stands rows of the same cells
 * holding its owner's blocks (`TaskRowSkeleton`).
 */

/** The cells a task's row draws, each in a column of its own, in the order a row draws them. */
export const TASK_ROW_CELL = {
  /** How the row's task stands to the task the list is about, leading the row so it reads as a sentence: Blocked by …. */
  RELATION: "relation",
  PRIORITY: TASK_PROPERTY.PRIORITY,
  KEY: TASK_PROPERTY.KEY,
  STATUS: TASK_PROPERTY.STATUS,
  WAITING: TASK_PROPERTY.WAITING,
  REPOSITORY: TASK_PROPERTY.REPOSITORY,
  ASSIGNEE: TASK_PROPERTY.ASSIGNEE,
  CREATOR: TASK_PROPERTY.CREATOR,
  AGENTS: TASK_PROPERTY.AGENTS,
  PULL_REQUESTS: "pullRequests",
  /** How many of the task's sub-tasks are finished, of all of them ("1/3"). */
  SUB_TASKS: LIST_COLUMN.SUB_TASKS,
  UPDATED: TASK_PROPERTY.UPDATED,
  /** What the row's owner stands at its end, before its ⋯: a dock's × that takes the row away, say. */
  END: "end",
} as const;

export type TaskRowCell = (typeof TASK_ROW_CELL)[keyof typeof TASK_ROW_CELL];

/**
 * What room a row keeps at its edges: a list's, a gutter at its start for
 * the box that chooses it and its ⋯ at its end; its ⋯ alone, for a list
 * whose rows are never chosen, as Home's Recent stands them, its first cell
 * at the row's inset; or none, for a list whose rows are neither chosen nor
 * carry a ⋯, as a composer's dock draws them, its first cell standing at the
 * row's inset and its last at its end.
 */
export const TASK_ROW_EDGES = {
  LIST: "list",
  UNCHOSEN: "unchosen",
  BARE: "bare",
} as const;

export type TaskRowEdges = (typeof TASK_ROW_EDGES)[keyof typeof TASK_ROW_EDGES];

/** Every cell, in the order a row draws them and its list stands their columns. */
const TASK_ROW_CELL_ORDER: readonly TaskRowCell[] = Object.values(TASK_ROW_CELL);

/** The cells drawn before a row's name; the rest stand after it. */
const LEADING: readonly TaskRowCell[] = [
  TASK_ROW_CELL.RELATION,
  TASK_ROW_CELL.PRIORITY,
  TASK_ROW_CELL.KEY,
  TASK_ROW_CELL.STATUS,
];

/**
 * The cells after the name that only say something, holding no control, so
 * the ⋯ may come in over one standing last: every cell but the assignee's
 * chip, the creator's face, the pull requests' chips, and the owner's end.
 */
const QUIET_AFTER: readonly TaskRowCell[] = [
  TASK_ROW_CELL.WAITING,
  TASK_ROW_CELL.REPOSITORY,
  TASK_ROW_CELL.AGENTS,
  TASK_ROW_CELL.SUB_TASKS,
  TASK_ROW_CELL.UPDATED,
];

/** The ⋯'s own column, where the list keeps one: a compact button's width. */
const MORE_COLUMN = "var(--ui-space-24)";

/** The cells a related task's row draws, in its own list: how it stands to the list's task, its chips, its key, its assignee, its pull requests, and how many of its sub-tasks are finished. */
export const RELATED_TASK_CELLS: readonly TaskRowCell[] = [
  TASK_ROW_CELL.RELATION,
  TASK_ROW_CELL.PRIORITY,
  TASK_ROW_CELL.KEY,
  TASK_ROW_CELL.STATUS,
  TASK_ROW_CELL.ASSIGNEE,
  TASK_ROW_CELL.PULL_REQUESTS,
  TASK_ROW_CELL.SUB_TASKS,
];

/** How wide each column stands, by the cell it holds: its content's own, the repository's held to a short name's. */
const COLUMN_WIDTH = {
  [TASK_ROW_CELL.RELATION]: "auto",
  [TASK_ROW_CELL.PRIORITY]: "auto",
  [TASK_ROW_CELL.KEY]: "auto",
  [TASK_ROW_CELL.STATUS]: "auto",
  [TASK_ROW_CELL.WAITING]: "auto",
  [TASK_ROW_CELL.REPOSITORY]: "fit-content(22ch)",
  [TASK_ROW_CELL.ASSIGNEE]: "auto",
  [TASK_ROW_CELL.CREATOR]: "auto",
  [TASK_ROW_CELL.AGENTS]: "auto",
  [TASK_ROW_CELL.PULL_REQUESTS]: "auto",
  [TASK_ROW_CELL.SUB_TASKS]: "auto",
  [TASK_ROW_CELL.UPDATED]: "auto",
  [TASK_ROW_CELL.END]: "auto",
} as const satisfies Record<TaskRowCell, string>;

/** A row's cell: a line in the caption's type, in its column, letting the pointer through to the row's press. */
const CELL =
  "ui-task-row-cell flex items-center gap-item-gap text-caption text-muted-foreground tabular-nums whitespace-nowrap";

/**
 * How narrow a cell may stand: as narrow as its column, but the one the ⋯
 * comes in over, which is at least the ⋯'s width, so its column is too, and
 * the ⋯ never reaches past it onto a control in the cell before where every
 * row leaves the last one empty.
 */
const CELL_LEAST = { REST: "min-w-0", UNDER_MORE: "min-w-ui-24" } as const;

/**
 * The room past its words a cell's own marks take, in characters of the
 * cell's type, where its row is placed out of its list's grid
 * (`taskRowFit`): a count's ring and its badge's sides, the waiting mark,
 * and the repository's picture; and the characters the time the row was
 * updated says at most ("11mo ago").
 */
const FIT_CHARS = {
  SUB_TASKS_MARKS: 5,
  WAITING_MARKS: 3,
  REPOSITORY_MARKS: 4,
  UPDATED: 8,
} as const;

/** The repository's column's widest, in characters, as `COLUMN_WIDTH` holds it. */
const REPOSITORY_MOST_CHARS = 22;

/** A pull request's chip past its number: its compact pill's sides and its edge, its mark, and the gap between them (`Chip`), and a character's room more, since the number is set in the chip's own weight. */
const PULL_REQUEST_CHIP_MARKS =
  "(2 * var(--ui-space-8) + var(--ui-space-12) + var(--ui-space-4) + 1ch)";

/**
 * How wide each cell whose words differ from row to row stands at least,
 * where its row is placed out of its list's grid, read from what the list
 * sets on its element (`taskRowFit`): the key in its own monospaced type,
 * so a character of it is one `ch`, a cell of words by its characters, the
 * pull requests by their chips, and the agents' mark by its seat, which
 * stands empty on a task with none. A cell not named here draws the same
 * marks on every row.
 */
const CELL_FIT: Partial<Record<TaskRowCell, CSSProperties>> = {
  [TASK_ROW_CELL.KEY]: {
    fontFamily: "var(--ui-font-mono)",
    minWidth: "calc(var(--ui-task-row-key-chars, 0) * 1ch)",
  },
  [TASK_ROW_CELL.PULL_REQUESTS]: {
    minWidth: `calc(var(--ui-task-row-pull-requests, 0) * (${PULL_REQUEST_CHIP_MARKS} + var(--ui-task-row-pull-request-chars, 0) * 1ch) + max(0, var(--ui-task-row-pull-requests, 0) - 1) * var(--ui-item-gap))`,
  },
  [TASK_ROW_CELL.SUB_TASKS]: { minWidth: "calc(var(--ui-task-row-sub-task-chars, 0) * 1ch)" },
  [TASK_ROW_CELL.WAITING]: { minWidth: "calc(var(--ui-task-row-waiting-chars, 0) * 1ch)" },
  [TASK_ROW_CELL.REPOSITORY]: { minWidth: "calc(var(--ui-task-row-repository-chars, 0) * 1ch)" },
  [TASK_ROW_CELL.AGENTS]: { minWidth: "var(--ui-space-16)" },
  [TASK_ROW_CELL.UPDATED]: { minWidth: `${FIT_CHARS.UPDATED}ch` },
};

/** A cell over the row's press where it holds anything, and the press's own where it stands empty. */
const OVER_WHERE_FILLED =
  "pointer-events-none not-empty:pointer-events-auto not-empty:relative not-empty:z-1";

/**
 * A cell whose own controls stand over the row's press and nothing else:
 * a press on a link or a button in it is that control's, and one on its
 * words, a pill, or the room around its chips is the row's.
 */
const OVER_ITS_CONTROLS =
  "pointer-events-none relative z-1 [&_a]:pointer-events-auto [&_button]:pointer-events-auto";

/**
 * Each cell's place in a row's reading order, the relation, priority, key,
 * and status before the name and the rest after it, and whether it stands
 * over the row's press: the chips take their own presses, and a cell left
 * empty, a nested row's relation among them, leaves the press its own. The time ends on its last letter, so times of
 * any length line up at their ends down the column.
 */
const CELL_PLACE = {
  [TASK_ROW_CELL.RELATION]: `${OVER_WHERE_FILLED} order-0`,
  [TASK_ROW_CELL.PRIORITY]: "pointer-events-auto relative z-1 order-1",
  [TASK_ROW_CELL.KEY]: "pointer-events-none order-2",
  [TASK_ROW_CELL.STATUS]: "pointer-events-auto relative z-1 order-3",
  [TASK_ROW_CELL.WAITING]: "pointer-events-none order-5",
  [TASK_ROW_CELL.REPOSITORY]: "pointer-events-none order-6",
  [TASK_ROW_CELL.ASSIGNEE]: `${OVER_WHERE_FILLED} order-7`,
  [TASK_ROW_CELL.CREATOR]: "pointer-events-none order-8",
  [TASK_ROW_CELL.AGENTS]: "pointer-events-none order-9",
  [TASK_ROW_CELL.PULL_REQUESTS]: `${OVER_ITS_CONTROLS} order-10`,
  [TASK_ROW_CELL.SUB_TASKS]: "pointer-events-none order-11",
  [TASK_ROW_CELL.UPDATED]: "pointer-events-none order-12 justify-end",
  [TASK_ROW_CELL.END]: `${OVER_ITS_CONTROLS} order-13`,
} as const satisfies Record<TaskRowCell, string>;

/** A cell after the name, which steps aside while the ⋯ stands at rest over the last on a screen with no hover (`task-row.css`). */
const AFTER = "ui-task-row-after";

/** The ⋯'s place: out of the row's columns, at its end inset, over its press while it shows (`task-row.css`). */
const MORE = "ui-task-row-more z-1 flex items-center";

/**
 * A row: a subgrid of the list's columns a little taller than a control,
 * filled under the pointer and while its menu is open, a draft's as a task's,
 * keeping a gutter at its start for its box (`SELECT_BOX_PLACE.GUTTER`), as
 * Linear's list does, so every row's name lines up whether or not it shows one.
 */
const ROW_BOX =
  "ui-task-row relative col-span-full grid min-h-tasks-list-row items-center rounded-control py-ui-2 text-foreground [transition:transform_var(--ui-duration-fast)_var(--ui-spring-fast),background-color_var(--ui-duration-hover)_var(--ui-motion-exit),opacity_var(--ui-duration-quick)_var(--ui-motion-exit)] data-[menu-open=true]:bg-muted data-[menu-open=true]:shadow-menu-open-edge hover:bg-muted";

/** A row standing in its list's grid: a subgrid of the list's columns. */
const ROW_FRAME = `${ROW_BOX} grid-cols-subgrid`;

/**
 * A row placed absolutely in a run drawing only the rows near the view
 * (`VirtualRows`): no subgrid, since a box placed absolutely is no item of
 * the grid it stands in, so it lays out the list's columns itself
 * (`--tasks-list-columns`), at the gap the list stands them at.
 */
const PLACED_FRAME = `${ROW_BOX} grid-cols-tasks-list gap-x-block-gap`;

/** A task's row by the room it keeps at its edges: its gutter at its start for its box, or its first cell at its inset. */
const ROW = {
  [TASK_ROW_EDGES.LIST]: `${ROW_FRAME} px-row-inset ps-select-gutter`,
  [TASK_ROW_EDGES.UNCHOSEN]: `${ROW_FRAME} px-row-inset`,
  [TASK_ROW_EDGES.BARE]: `${ROW_FRAME} px-row-inset`,
} as const satisfies Record<TaskRowEdges, string>;

/** A row placed in a run drawing only the rows near the view, by the room it keeps at its edges, as `ROW`. */
const PLACED_ROW = {
  [TASK_ROW_EDGES.LIST]: `${PLACED_FRAME} px-row-inset ps-select-gutter`,
  [TASK_ROW_EDGES.UNCHOSEN]: `${PLACED_FRAME} px-row-inset`,
  [TASK_ROW_EDGES.BARE]: `${PLACED_FRAME} px-row-inset`,
} as const satisfies Record<TaskRowEdges, string>;

/** A draft's row, raised as a card, its hairline taken out of its inset so its cells stand on the rows' lines. */
const DRAFT_ROW = `${ROW_FRAME} px-task-row-draft ui-task-row-draft`;

/** The name's cell, the one that takes the row's press, in the text's ink. */
const NAME_CELL =
  "ui-task-row-cell pointer-events-auto order-4 flex min-w-0 flex-col items-stretch gap-0 text-label tabular-nums whitespace-nowrap";

/** The name's ink: the text's, or the muted ink for a row whose task is settled. */
const NAME_INK = { REST: "text-foreground", SETTLED: "text-muted-foreground" } as const;

/** A nested row's name, in by a nest for each level it stands at. */
const NESTED = "ps-list-row-nest";

/** What a row's press shows: its name on one line. */
const PRESS = "ui-task-row-press flex min-w-0 items-center";

/** The name's weight: the label's, or the heavier one while its list counts it unread. */
const NAME_WEIGHT = { REST: "font-ui-medium", UNREAD: "font-emphasis" } as const;

/** A mark beside the name, a gap from its last letter. */
const BESIDE = "ui-task-row-beside ms-icon-gap inline-flex flex-none items-center";

/** Where a row's name gives way to its field while it is renamed. */
const EDITOR = "ui-task-row-press flex min-w-0 items-center font-ui-regular";

/** What did not land, in the name's cell. */
const NOTE = "ui-task-row-note text-caption text-danger";

/** A row folding the rows nested under it: its chevron, then its press. */
const FOLDS = "ui-task-row-folds flex min-w-0 items-center";

/** The fold's chevron, a control of its own beside the press, standing over it, a glyph's size. */
const FOLD =
  "ui-task-row-fold relative z-1 me-icon-gap grid min-h-control-icon min-w-control-icon flex-none cursor-press place-items-center rounded-control border-0 bg-transparent p-0 text-muted-foreground";

/** A list of its own: one grid of the cells its rows draw, its rows edge to edge. */
const ROWS =
  "ui-task-rows m-0 grid list-none grid-cols-tasks-list content-start gap-x-block-gap gap-y-0 p-0";

/** Which way a key asks a row's fold to stand: → open, ← folded. */
const FOLD_KEY_OPENS: Readonly<Record<string, boolean>> = { ArrowRight: true, ArrowLeft: false };

/** The cells of a row in its list's order, whatever order its owner names them in. */
function inOrder(cells: readonly TaskRowCell[]): readonly TaskRowCell[] {
  return TASK_ROW_CELL_ORDER.filter((cell) => cells.includes(cell));
}

/** The cell the ⋯ comes in over: the last drawn, where it stands after the name and only says something; none where the list keeps the ⋯ a column. */
function cellUnderMore(cells: readonly TaskRowCell[]): TaskRowCell | undefined {
  const last = inOrder(cells).at(-1);
  return last !== undefined && QUIET_AFTER.includes(last) ? last : undefined;
}

/** A cell of a row, in its column, holding what its owner stands there; empty where it holds nothing. */
function RowCell({
  cell,
  underMore,
  placed,
  children,
}: {
  cell: TaskRowCell;
  underMore: TaskRowCell | undefined;
  /** Whether its row is placed out of its list's grid, where the cell stands as wide as the list says its column does (`taskRowFit`). */
  placed: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const after = LEADING.includes(cell) ? "" : ` ${AFTER}`;
  return (
    <span
      style={placed ? CELL_FIT[cell] : undefined}
      className={`${CELL} ${cell === underMore ? CELL_LEAST.UNDER_MORE : CELL_LEAST.REST} ${CELL_PLACE[cell]}${after}`}
      data-cell={cell}
      data-under-more={cell === underMore ? "true" : undefined}
    >
      {children}
    </span>
  );
}

/** A row's cells, in their columns in the list's order, each holding what its owner stands there. */
function RowCells({
  cells,
  content,
  underMore,
  placed = false,
}: {
  cells: readonly TaskRowCell[];
  content: Partial<Record<TaskRowCell, ReactNode>>;
  underMore: TaskRowCell | undefined;
  placed?: boolean;
}): React.JSX.Element {
  return (
    <>
      {inOrder(cells).map((cell) => (
        <RowCell key={cell} cell={cell} underMore={underMore} placed={placed}>
          {content[cell]}
        </RowCell>
      ))}
    </>
  );
}

/** A row's item: one line of its list's grid, keeping the room its edges ask for. */
function RowItem({
  edges,
  placed = false,
  ...item
}: Omit<ComponentPropsWithRef<"li">, "className"> & {
  edges: TaskRowEdges;
  /** Whether it stands placed in a run drawing only the rows near the view, out of its list's grid. */
  placed?: boolean;
}): React.JSX.Element {
  return <li {...item} className={placed ? PLACED_ROW[edges] : ROW[edges]} />;
}

/** The name's cell, the one the row's press stands in, in by a nest for each level the row stands at. */
function NameCell({
  settled = false,
  depth = 0,
  children,
}: {
  settled?: boolean | undefined;
  depth?: number | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span
      className={[NAME_CELL, settled ? NAME_INK.SETTLED : NAME_INK.REST, depth === 0 ? "" : NESTED]
        .join(" ")
        .trim()}
      data-cell="name"
      style={depth === 0 ? undefined : cssCustomProperties({ "--ui-list-row-depth": depth })}
    >
      {children}
    </span>
  );
}

/** What a task's row says in the cells whose words differ from row to row, as its list reads them for `taskRowFit`. */
export interface TaskRowWords {
  readonly key?: string | undefined;
  /** Each open pull request's number as its chip says it ("#42"). */
  readonly pullRequests?: readonly string[] | undefined;
  /** Its finished sub-tasks of all of them ("1/3"). */
  readonly subTasks?: string | undefined;
  readonly waiting?: string | undefined;
  readonly repository?: string | undefined;
}

/** The most characters any of `words` holds; none where none holds any. */
function mostChars(words: Iterable<string | undefined>): number {
  let most = 0;
  for (const each of words) most = Math.max(most, each?.length ?? 0);
  return most;
}

/** The characters a cell's column stands, its marks' room after its words, where any row says anything there. */
function withMarks(chars: number, marks: number): number {
  return chars === 0 ? 0 : chars + marks;
}

/**
 * How wide the columns of a list of task rows stand where its rows are
 * placed out of its grid (`VirtualRows`), as custom properties for the
 * element its rows stand in: a row placed so lays the list's columns out
 * on its own, and a column sized by its row's own words would stand at a
 * width of its own on each row, so each cell whose words differ stands as
 * wide as the widest the list's tasks say there (`CELL_FIT`), read from
 * every task it lists rather than from the rows drawn, so the columns
 * line up down the list and stand still as it scrolls.
 */
export function taskRowFit(rows: readonly TaskRowWords[]): CSSProperties {
  const pullRequests = rows.map((row) => row.pullRequests ?? []);
  return cssCustomProperties({
    "--ui-task-row-key-chars": mostChars(rows.map((row) => row.key)),
    "--ui-task-row-pull-requests": Math.max(0, ...pullRequests.map((each) => each.length)),
    "--ui-task-row-pull-request-chars": mostChars(pullRequests.flat()),
    "--ui-task-row-sub-task-chars": withMarks(
      mostChars(rows.map((row) => row.subTasks)),
      FIT_CHARS.SUB_TASKS_MARKS,
    ),
    "--ui-task-row-waiting-chars": withMarks(
      mostChars(rows.map((row) => row.waiting)),
      FIT_CHARS.WAITING_MARKS,
    ),
    "--ui-task-row-repository-chars": withMarks(
      Math.min(mostChars(rows.map((row) => row.repository)), REPOSITORY_MOST_CHARS),
      FIT_CHARS.REPOSITORY_MARKS,
    ),
  });
}

/**
 * The grid's columns for the cells drawn, in the order a row draws them:
 * those before the name, the name, and those after it, then the ⋯'s own
 * where it comes in over no cell (`cellUnderMore`) and its rows draw it
 * (`more`); the cell it comes in over is held to the ⋯'s width at least
 * (`CELL_LEAST`). The list standing the rows lays them as its
 * `--tasks-list-columns`.
 */
export function taskRowColumns(cells: readonly TaskRowCell[], more = true): string {
  const drawn = inOrder(cells);
  const width = (cell: TaskRowCell) => COLUMN_WIDTH[cell];
  const before = drawn.filter((cell) => LEADING.includes(cell)).map(width);
  const after = drawn.filter((cell) => !LEADING.includes(cell)).map(width);
  const moreColumn = more && cellUnderMore(cells) === undefined ? [MORE_COLUMN] : [];
  return [...before, "minmax(0, 1fr)", ...after, ...moreColumn].join(" ");
}

/** One task's row: its press, which opens it, its cells in their columns, and its ⋯ over its end. */
export function TaskRow({
  taskId,
  name,
  said,
  beside,
  cells,
  content,
  editor,
  note,
  menu,
  more = true,
  edges = TASK_ROW_EDGES.LIST,
  disabled = false,
  onOpen,
  pressRef,
  depth = 0,
  nest,
  fold,
  settled = false,
  unread = false,
  hint,
  place,
  children,
}: {
  /** The task, which keys the row's motion, its choosing, and its box. */
  taskId: string;
  /** The task's name, on one line. */
  name: string;
  /** What a reader hears after the name that the eye reads in the cells: the key and status, say. */
  said?: ReactNode;
  /** A mark that stands beside the name, which says in the press what it says to the eye: a blocked task's stop sign. */
  beside?: ReactNode;
  /** The cells its list draws, the same for every row of it. */
  cells: readonly TaskRowCell[];
  /** What stands in each cell; a cell with none stands empty. */
  content: Partial<Record<TaskRowCell, ReactNode>>;
  /** The field the name gives way to while it is renamed; none while it is not. */
  editor?: ReactNode;
  /** What did not land, under the name. */
  note?: ReactNode;
  /** The task's menu; none while it offers none, as while it is renamed. */
  menu?: ListRowMenu | undefined;
  /** Whether the row draws its menu's ⋯; it may leave it out, its menu still a long press, a right-click, and the menu key away. Its list says the same (`TaskRows`'s `more`). */
  more?: boolean | undefined;
  /** What room it keeps at its edges, its list's (`TaskRows`'s `edges`): a bare row keeps no gutter for a box and draws no ⋯, its menu still a right-click and the menu key away. */
  edges?: TaskRowEdges | undefined;
  /** Whether its press is unavailable, as while the task is deleted. */
  disabled?: boolean | undefined;
  onOpen: () => void;
  /** The press, for what focuses it again once an edit ends. */
  pressRef?: RefObject<HTMLButtonElement | null> | undefined;
  /** How deep it stands nested under other rows: 0, at the top, unless said. */
  depth?: number | undefined;
  /** Where it stands among its siblings, in a list that nests rows, which a reader hears with its level; none in a list that nests none. */
  nest?: ListRowNest | undefined;
  /** The rows nested under it, which it folds; none where it holds none. */
  fold?: ListRowFold | undefined;
  /** Whether it stands settled beside the rows still open, its name in the muted ink: a blocker that is done. */
  settled?: boolean | undefined;
  /** Whether its list counts it unread, its name standing in the heavier weight until it is read. */
  unread?: boolean | undefined;
  /** The owner's hint hung from the row's press and the words it raises, as a `ListRow`'s: its card, beside the row. */
  hint?: { readonly Hint: ListRowHint; readonly label: string } | undefined;
  /** Where the row stands in a run drawing only the rows near the view (`VirtualRows`); none where every row is drawn. */
  place?: VirtualRowPlace | undefined;
  /** What stands beside its cells and draws nothing in the grid: a dialog its menu opens. */
  children?: ReactNode;
}): React.JSX.Element {
  const own = useRef<HTMLButtonElement | null>(null);
  const press = pressRef ?? own;
  const nameId = useId();
  // Note that the row a hint hangs its card beside is the item, which a run measures through its place too.
  const item = useRef<HTMLLIElement | null>(null);
  const { ref: placeRef, ...placed } = place ?? {};
  const itemRef = useCallback(
    (element: HTMLLIElement | null) => {
      item.current = element;
      placeRef?.(element);
    },
    [placeRef],
  );
  // Note that a row being renamed keeps its ⋯, because its press, which the menu would hand focus back to, is its field.
  const bare = edges === TASK_ROW_EDGES.BARE;
  const drawsMore = (more && !bare) || editor !== undefined;
  const rowMenu = useRowMenu(menu, { disabled, opener: press, more: drawsMore });
  const underMore = drawsMore ? cellUnderMore(cells) : undefined;
  // Note that → and ← are the row's only while they would move its fold, so the list still hears the rest.
  const foldKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (fold === undefined) return;
    const asked = FOLD_KEY_OPENS[event.key];
    if (asked === undefined || asked === fold.open) return;
    event.preventDefault();
    fold.onOpenChange(asked);
  };
  const pressed = (
    <CardPress
      ref={press}
      disabled={disabled}
      selectKey={taskId}
      selectBox={edges === TASK_ROW_EDGES.LIST ? SELECT_BOX_PLACE.GUTTER : undefined}
      roving
      onKeyDown={fold === undefined ? undefined : foldKeys}
      onPress={() => {
        rowMenu.close(false);
        onOpen();
      }}
    >
      <span id={nameId} className={`${PRESS} ${unread ? NAME_WEIGHT.UNREAD : NAME_WEIGHT.REST}`}>
        {/* A task's name is always a person's words, so a screen recording masks it whatever stands round the row. */}
        <OneLine words={name}>
          <ReplayMask>{name}</ReplayMask>
        </OneLine>
        {beside === undefined ? null : <span className={BESIDE}>{beside}</span>}
        {said}
      </span>
    </CardPress>
  );
  const named = (
    <>
      {editor !== undefined ? (
        <span className={EDITOR}>{editor}</span>
      ) : hint === undefined ? (
        pressed
      ) : (
        <hint.Hint label={hint.label} row={item}>
          {pressed}
        </hint.Hint>
      )}
      {note === undefined ? null : <span className={NOTE}>{note}</span>}
    </>
  );
  return (
    <RowItem
      ref={itemRef}
      {...placed}
      edges={edges}
      placed={place !== undefined}
      data-task-id={taskId}
      {...motionKey(taskId)}
      {...rowMenu.props}
      data-editing={editor === undefined ? undefined : "true"}
      data-depth={depth === 0 ? undefined : depth}
      {...nestedItem(depth, nest)}
      data-settled={settled ? "true" : undefined}
      data-unread={unread ? "true" : undefined}
    >
      <NameCell settled={settled} depth={depth}>
        {fold === undefined ? (
          named
        ) : (
          <span className={FOLDS}>
            <button
              type="button"
              className={FOLD}
              aria-label={fold.label}
              aria-expanded={fold.open}
              onClick={() => fold.onOpenChange(!fold.open)}
            >
              {/* Note that the chevron turns on the one turn every fold makes (`disclosure.css`). */}
              <span className="ui-disclosure-turn" data-open={fold.open}>
                <FoldChevronIcon />
              </span>
            </button>
            <span className="flex min-w-0 flex-1 flex-col items-stretch">{named}</span>
          </span>
        )}
      </NameCell>
      <RowCells
        cells={cells}
        content={content}
        underMore={underMore}
        placed={place !== undefined}
      />
      <span className={MORE} data-cell="more">
        {rowMenu.more({ size: BUTTON_SIZE.COMPACT, describedBy: nameId })}
      </span>
      {rowMenu.popup}
      {children}
    </RowItem>
  );
}

/**
 * A row standing in a list still being read: the row's own item and cells,
 * a block where its name will stand and its owner's blocks in the cells
 * that will hold something, so it is the row's shape rather than a copy of
 * it.
 */
export function TaskRowSkeleton({
  cells,
  name,
  content,
  edges = TASK_ROW_EDGES.LIST,
}: {
  /** The cells its list draws, the same as its rows'. */
  cells: readonly TaskRowCell[];
  /** How wide the block where its name will stand is. */
  name: string;
  /** The block in each cell that will hold something. */
  content: Partial<Record<TaskRowCell, ReactNode>>;
  /** What room it keeps at its edges, its list's. */
  edges?: TaskRowEdges | undefined;
}): React.JSX.Element {
  return (
    <RowItem edges={edges}>
      <NameCell>
        <Skeleton width={name} />
      </NameCell>
      <RowCells cells={cells} content={content} underMore={undefined} />
    </RowItem>
  );
}

/**
 * A quick add's draft as a row of the list's own cells, raised as a card
 * off the list as a Board's draft is, so it reads as one being written: the
 * draft's chips in their cells and its bare title in the name's, or, once
 * an add was refused, why in the name's place. An add still out stands as
 * its row, its name muted (`pending`).
 */
export function TaskRowDraft({
  cells,
  content,
  name,
  note,
  drafting,
  pending,
}: {
  /** The cells its list draws, the same as its rows'. */
  cells: readonly TaskRowCell[];
  /** The draft's chip in each cell that says one. */
  content: Partial<Record<TaskRowCell, ReactNode>>;
  /** The title being written, or the add still out, and the chips with no column of their own after it. */
  name: ReactNode;
  /** Why the add was refused, in the name's place; none where it was not. */
  note?: ReactNode;
  /** Whether it is the draft being written rather than an add still out. */
  drafting: boolean;
  /** Whether an add is still out. */
  pending: boolean;
}): React.JSX.Element {
  return (
    <Card
      as={CARD_ELEMENT.LI}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
      shadow={CARD_SHADOW.SOFT}
      className={DRAFT_ROW}
      data-quick-add={drafting ? "" : undefined}
      data-pending={pending ? "true" : undefined}
    >
      <NameCell>
        {note === undefined ? (
          <span className={`${PRESS} ${NAME_WEIGHT.REST}`}>
            <ReplayMask>{name}</ReplayMask>
          </span>
        ) : (
          <span className={NOTE}>{note}</span>
        )}
      </NameCell>
      <RowCells cells={cells} content={content} underMore={undefined} />
    </Card>
  );
}

/**
 * A list of task rows standing on its own, outside the Tasks page: one grid
 * of the cells its rows draw (`RELATED_TASK_CELLS` unless said), named by
 * `label`, keeping its rows' ⋯ a column where they draw it (`more`), and
 * each row's gutter for its box and its ⋯ unless its rows are bare
 * (`edges`), as a composer's dock stands them under nothing but their own
 * cells. Its rows are one Tab stop that ↑↓ walk (`useRovingKeys`), or,
 * standing among other lists, join the walk of a box around them all
 * (`joinsWalk`), as a `List`'s may; and, where it is asked to
 * (`selection`), chosen together as a Mac's list chooses them, by the box
 * in a row's gutter, ⌘-click, ⇧-click, ⇧↑↓, ⌘A, and Esc
 * (`SelectionRegion`), a plain press still opening the task. Under a
 * `ListMotion` its rows may move as they arrive, leave, and change places
 * (`moves`), as a `List`'s do.
 */
export function TaskRows({
  id,
  label,
  cells = RELATED_TASK_CELLS,
  more = true,
  edges = TASK_ROW_EDGES.LIST,
  selection,
  joinsWalk = false,
  moves = false,
  children,
}: {
  /** The id a `SelectionBar` over it names; one is made where none is given. */
  id?: string | undefined;
  label: string;
  /** The cells its rows draw, which they are each handed too. */
  cells?: readonly TaskRowCell[] | undefined;
  /** Whether its rows draw their ⋯, which they are each handed too; where they leave it out, it keeps no column for it. */
  more?: boolean | undefined;
  /** What room its rows keep at their edges, which they are each handed too: a bare list keeps its rows' ⋯ no column, and only a list's chooses any. */
  edges?: TaskRowEdges | undefined;
  /** Which rows are chosen and what hears the next set, where the list chooses rows at all; only a list's edges choose any. */
  selection?: ListSelection | undefined;
  /** Whether its rows join the walk of a `useRovingKeys` box around it, with the rows of the lists beside it, rather than walk alone. */
  joinsWalk?: boolean | undefined;
  /** Whether its rows move as they arrive, leave, and change places, under a `ListMotion`. */
  moves?: boolean | undefined;
  /** Its `TaskRow`s. */
  children: ReactNode;
}): React.JSX.Element {
  const made = useId();
  const roving = useRovingKeys<HTMLUListElement>();
  const rows = (
    <ul
      {...(joinsWalk ? {} : roving)}
      className={ROWS}
      aria-label={label}
      style={cssCustomProperties({
        "--tasks-list-columns": taskRowColumns(cells, more && edges !== TASK_ROW_EDGES.BARE),
      })}
      {...(moves ? motionRows() : {})}
    >
      {children}
    </ul>
  );
  return selection === undefined || edges !== TASK_ROW_EDGES.LIST ? (
    rows
  ) : (
    <SelectionRegion id={id ?? made} selection={selection}>
      {rows}
    </SelectionRegion>
  );
}

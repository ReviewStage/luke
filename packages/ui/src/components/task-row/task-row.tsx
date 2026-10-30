import { type KeyboardEvent, type ReactNode, type RefObject, useId, useRef } from "react";
import { cssCustomProperties } from "../../css.js";
import { FoldChevronIcon } from "../../face/glyphs.js";
import { pulseOnPress } from "../../press-pulse.js";
import { TASK_PROPERTY } from "../../tasks-page-model.js";
import { BUTTON_SIZE } from "../button/button.js";
import { CARD_CORNER, CARD_ELEMENT, CARD_PADDING, CARD_SHADOW, Card } from "../card/card.js";
import { CardPress, SELECT_BOX_PLACE } from "../card-press/card-press.js";
import { motionKey } from "../list-motion/list-motion.js";
import type { ListRowFold } from "../list-row/list-row.js";
import { OneLine } from "../one-line/one-line.js";
import { useRovingKeys } from "../roving-keys/roving-keys.js";
import { type ListRowMenu, useRowMenu } from "../row-menu/row-menu.js";
import type { ListSelection } from "../selection/list-selection.js";
import { SelectionRegion } from "../selection/selection-region.js";

/**
 * task-row.tsx -- a task as one line of columns: its priority, key, and status before its name, what the list draws of it after, an end of its owner's, and its ⋯, each cell in its own column so the columns line up down every row.
 *
 * A row is one line of a grid its list stands, a subgrid of the list's
 * columns, as Linear's list stands its rows, so each cell lines up down the
 * list whatever any one row holds. Which cells a row draws is its list's
 * (`cells`), the same for every row of it, and what stands in each is the
 * row's owner's (`content`): the chips that change a task where it stands,
 * its key, its assignee's face, its pull requests. The Tasks page's List
 * stands every row of the page in one grid whose columns its display
 * chooses and folds by width; a list of a task's related tasks stands its
 * own (`TaskRows`), its columns fixed to the few it draws.
 *
 * The row's press reaches every edge of it (`CardPress`), opening the task,
 * its name on one line in the label's weight, what the eye reads in the
 * cells said after the name to a reader (`said`). The cells that hold a
 * control stand over the press, and the rest let the pointer through to it,
 * so a press anywhere but a chip or the ⋯ opens the task. Its box comes in
 * under the pointer in the gutter at its start (`SELECT_BOX_PLACE.GUTTER`),
 * where its list chooses rows, and stays while any is chosen. Its menu
 * (`menu`) is opened alike by its ⋯, shown while the row is in hand, a
 * right-click, and the menu key (`useRowMenu`). Renamed, its name gives way
 * to the field its owner hands (`editor`); what did not land stands under
 * it (`note`).
 *
 * A row may stand nested under another (`depth`), its name in by a nest
 * for each level, its other columns still lined up with every row's; and a
 * row with rows nested under it folds them (`fold`), by a chevron before
 * its name, a control of its own beside the press, and by → and ← on the
 * press, as a `ListRow`'s fold does.
 *
 * A group's quick add draws its draft as a row of the same cells, raised
 * as a card off the list (`TaskRowDraft`), so it reads as the row it is
 * about to be.
 */

/** The cells a task's row draws, each in a column of its own, in the order a row draws them. */
export const TASK_ROW_CELL = {
  PRIORITY: TASK_PROPERTY.PRIORITY,
  KEY: TASK_PROPERTY.KEY,
  STATUS: TASK_PROPERTY.STATUS,
  WAITING: TASK_PROPERTY.WAITING,
  REPOSITORY: TASK_PROPERTY.REPOSITORY,
  ASSIGNEE: TASK_PROPERTY.ASSIGNEE,
  CREATOR: TASK_PROPERTY.CREATOR,
  AGENTS: TASK_PROPERTY.AGENTS,
  PULL_REQUESTS: "pullRequests",
  UPDATED: TASK_PROPERTY.UPDATED,
  /** What the row's owner stands at its end, before its ⋯: a related task's kind, say. */
  END: "end",
} as const;

export type TaskRowCell = (typeof TASK_ROW_CELL)[keyof typeof TASK_ROW_CELL];

/** Every cell, in the order a row draws them and its list stands their columns. */
const TASK_ROW_CELL_ORDER: readonly TaskRowCell[] = Object.values(TASK_ROW_CELL);

/** The cells drawn before a row's name; the rest stand after it. */
const LEADING: readonly TaskRowCell[] = [
  TASK_ROW_CELL.PRIORITY,
  TASK_ROW_CELL.KEY,
  TASK_ROW_CELL.STATUS,
];

/** The cells a related task's row draws, in its own list: its chips, its key, its assignee, its pull requests, and its owner's end. */
export const RELATED_TASK_CELLS: readonly TaskRowCell[] = [
  TASK_ROW_CELL.PRIORITY,
  TASK_ROW_CELL.KEY,
  TASK_ROW_CELL.STATUS,
  TASK_ROW_CELL.ASSIGNEE,
  TASK_ROW_CELL.PULL_REQUESTS,
  TASK_ROW_CELL.END,
];

/** How wide each column stands, by the cell it holds: its content's own, the repository's held to a short name's. */
const COLUMN_WIDTH = {
  [TASK_ROW_CELL.PRIORITY]: "auto",
  [TASK_ROW_CELL.KEY]: "auto",
  [TASK_ROW_CELL.STATUS]: "auto",
  [TASK_ROW_CELL.WAITING]: "auto",
  [TASK_ROW_CELL.REPOSITORY]: "fit-content(22ch)",
  [TASK_ROW_CELL.ASSIGNEE]: "auto",
  [TASK_ROW_CELL.CREATOR]: "auto",
  [TASK_ROW_CELL.AGENTS]: "auto",
  [TASK_ROW_CELL.PULL_REQUESTS]: "auto",
  [TASK_ROW_CELL.UPDATED]: "auto",
  [TASK_ROW_CELL.END]: "auto",
} as const satisfies Record<TaskRowCell, string>;

/** A row's cell: a line in the caption's type, in its column, letting the pointer through to the row's press. */
const CELL =
  "luke-task-row-cell flex min-w-0 items-center gap-item-gap text-caption text-muted-foreground tabular-nums whitespace-nowrap";

/** A cell over the row's press where it holds anything, and the press's own where it stands empty. */
const OVER_WHERE_FILLED =
  "pointer-events-none not-empty:pointer-events-auto not-empty:relative not-empty:z-1";

/**
 * Each cell's place in a row's reading order, priority, key, and status
 * before the name and the rest after it, and whether it stands over the
 * row's press: the chips take their own presses, and a cell left empty
 * leaves the press its own. The time ends on its last letter, so times of
 * any length line up at their ends down the column.
 */
const CELL_PLACE = {
  [TASK_ROW_CELL.PRIORITY]: "pointer-events-auto relative z-1 order-1",
  [TASK_ROW_CELL.KEY]: "pointer-events-none order-2",
  [TASK_ROW_CELL.STATUS]: "pointer-events-auto relative z-1 order-3",
  [TASK_ROW_CELL.WAITING]: "pointer-events-none order-5",
  [TASK_ROW_CELL.REPOSITORY]: "pointer-events-none order-6",
  [TASK_ROW_CELL.ASSIGNEE]: `${OVER_WHERE_FILLED} order-7`,
  [TASK_ROW_CELL.CREATOR]: "pointer-events-none order-8",
  [TASK_ROW_CELL.AGENTS]: "pointer-events-none order-9",
  [TASK_ROW_CELL.PULL_REQUESTS]: `${OVER_WHERE_FILLED} order-10`,
  [TASK_ROW_CELL.UPDATED]: "pointer-events-none order-11 justify-end",
  [TASK_ROW_CELL.END]: `${OVER_WHERE_FILLED} order-12`,
} as const satisfies Record<TaskRowCell, string>;

/** The ⋯'s cell, at a row's end, standing over its press. */
const MORE_CELL = `${CELL} pointer-events-auto relative z-1 order-13`;

/**
 * A row: a subgrid of the list's columns a little taller than a control,
 * filled under the pointer and while its menu is open, a draft's as a task's,
 * keeping a gutter at its start for its box (`SELECT_BOX_PLACE.GUTTER`), as
 * Linear's list does, so every row's name lines up whether or not it shows one.
 */
const ROW_FRAME =
  "luke-task-row relative col-span-full grid min-h-tasks-list-row grid-cols-subgrid items-center rounded-control py-luke-2 text-foreground [transition:transform_var(--luke-duration-fast)_var(--luke-spring-fast),background-color_var(--luke-duration-hover)_var(--luke-motion-exit),opacity_var(--luke-duration-quick)_var(--luke-motion-exit)] data-[menu-open=true]:bg-muted data-[menu-open=true]:shadow-menu-open-edge [&:hover]:bg-muted";

/** A task's row, its gutter kept at its start for its box. */
const ROW = `${ROW_FRAME} px-row-inset ps-select-gutter`;

/** A draft's row, raised as a card, its hairline taken out of its inset so its cells stand on the rows' lines. */
const DRAFT_ROW = `${ROW_FRAME} px-task-row-draft luke-task-row-draft`;

/** The name's cell, the one that takes the row's press. */
const NAME_CELL =
  "luke-task-row-cell pointer-events-auto order-4 flex min-w-0 flex-col items-stretch gap-0 text-label text-foreground tabular-nums whitespace-nowrap";

/** A nested row's name, in by a nest for each level it stands at. */
const NESTED = "ps-list-row-nest";

/** What a row's press shows: its name on one line, in the label's weight. */
const PRESS = "luke-task-row-press flex min-w-0 items-center font-luke-medium";

/** Where a row's name gives way to its field while it is renamed. */
const EDITOR = "luke-task-row-press flex min-w-0 items-center font-luke-regular";

/** What did not land, in the name's cell. */
const NOTE = "luke-task-row-note text-caption text-danger";

/** A row folding the rows nested under it: its chevron, then its press. */
const FOLDS = "luke-task-row-folds flex min-w-0 items-center";

/** The fold's chevron, a control of its own beside the press, standing over it, a glyph's size. */
const FOLD =
  "luke-task-row-fold relative z-1 me-icon-gap grid min-h-control-icon min-w-control-icon flex-none cursor-press place-items-center rounded-control border-0 bg-transparent p-0 text-muted-foreground";

/** A list of its own: one grid of the cells its rows draw, its rows edge to edge. */
const ROWS =
  "luke-task-rows m-0 grid list-none grid-cols-tasks-list content-start gap-x-block-gap gap-y-0 p-0";

/** Which way a key asks a row's fold to stand: → open, ← folded. */
const FOLD_KEY_OPENS: Readonly<Record<string, boolean>> = { ArrowRight: true, ArrowLeft: false };

/** A cell of a row, in its column, holding what its owner stands there; empty where it holds nothing. */
function cellOf(cell: TaskRowCell, content: ReactNode): React.JSX.Element {
  return (
    <span key={cell} className={`${CELL} ${CELL_PLACE[cell]}`} data-cell={cell}>
      {content}
    </span>
  );
}

/** The cells of a row in its list's order, whatever order its owner names them in. */
function inOrder(cells: readonly TaskRowCell[]): readonly TaskRowCell[] {
  return TASK_ROW_CELL_ORDER.filter((cell) => cells.includes(cell));
}

/**
 * The grid's columns for the cells drawn, in the order a row draws them:
 * those before the name, the name, those after it, and the ⋯. The list
 * standing the rows lays them as its `--tasks-list-columns`.
 */
export function taskRowColumns(cells: readonly TaskRowCell[]): string {
  const drawn = inOrder(cells);
  const width = (cell: TaskRowCell) => COLUMN_WIDTH[cell];
  const before = drawn.filter((cell) => LEADING.includes(cell)).map(width);
  const after = drawn.filter((cell) => !LEADING.includes(cell)).map(width);
  return [...before, "minmax(0, 1fr)", ...after, "auto"].join(" ");
}

/** One task's row: its press, which opens it, its cells in their columns, and its ⋯. */
export function TaskRow({
  taskId,
  name,
  said,
  cells,
  content,
  editor,
  note,
  menu,
  disabled = false,
  onOpen,
  pressRef,
  depth = 0,
  fold,
  children,
}: {
  /** The task, which keys the row's motion, its choosing, and its box. */
  taskId: string;
  /** The task's name, on one line. */
  name: string;
  /** What a reader hears after the name that the eye reads in the cells: the key and status, say. */
  said?: ReactNode;
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
  /** Whether its press is unavailable, as while the task is deleted. */
  disabled?: boolean | undefined;
  onOpen: () => void;
  /** The press, for what focuses it again once an edit ends. */
  pressRef?: RefObject<HTMLButtonElement | null> | undefined;
  /** How deep it stands nested under other rows: 0, at the top, unless said. */
  depth?: number | undefined;
  /** The rows nested under it, which it folds; none where it holds none. */
  fold?: ListRowFold | undefined;
  /** What stands beside its cells and draws nothing in the grid: a dialog its menu opens. */
  children?: ReactNode;
}): React.JSX.Element {
  const own = useRef<HTMLButtonElement | null>(null);
  const press = pressRef ?? own;
  const nameId = useId();
  const rowMenu = useRowMenu(menu, { disabled, opener: press });
  // Note that → and ← are the row's only while they would move its fold, so the list still hears the rest.
  const foldKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (fold === undefined) return;
    const asked = FOLD_KEY_OPENS[event.key];
    if (asked === undefined || asked === fold.open) return;
    event.preventDefault();
    fold.onOpenChange(asked);
  };
  const named = (
    <>
      {editor === undefined ? (
        <CardPress
          ref={press}
          disabled={disabled}
          selectKey={taskId}
          selectBox={SELECT_BOX_PLACE.GUTTER}
          roving
          onKeyDown={fold === undefined ? undefined : foldKeys}
          onPress={() => {
            rowMenu.close(false);
            onOpen();
          }}
        >
          <span id={nameId} className={PRESS}>
            <OneLine>{name}</OneLine>
            {said}
          </span>
        </CardPress>
      ) : (
        <span className={EDITOR}>{editor}</span>
      )}
      {note === undefined ? null : <span className={NOTE}>{note}</span>}
    </>
  );
  return (
    <li
      className={ROW}
      data-task-id={taskId}
      {...motionKey(taskId)}
      {...rowMenu.props}
      data-editing={editor === undefined ? undefined : "true"}
      data-depth={depth === 0 ? undefined : depth}
    >
      <span
        className={depth === 0 ? NAME_CELL : `${NAME_CELL} ${NESTED}`}
        data-cell="name"
        style={depth === 0 ? undefined : cssCustomProperties({ "--luke-list-row-depth": depth })}
      >
        {fold === undefined ? (
          named
        ) : (
          <span className={FOLDS}>
            <button
              type="button"
              className={FOLD}
              aria-label={fold.label}
              aria-expanded={fold.open}
              onClick={pulseOnPress(() => fold.onOpenChange(!fold.open))}
            >
              {/* Note that the chevron turns on the one turn every fold makes (`disclosure.css`). */}
              <span className="luke-disclosure-turn" data-open={fold.open}>
                <FoldChevronIcon />
              </span>
            </button>
            <span className="flex min-w-0 flex-1 flex-col items-stretch">{named}</span>
          </span>
        )}
      </span>
      {inOrder(cells).map((cell) => cellOf(cell, content[cell]))}
      <span className={MORE_CELL} data-cell="more">
        {rowMenu.more({ size: BUTTON_SIZE.COMPACT, describedBy: nameId })}
      </span>
      {rowMenu.popup}
      {children}
    </li>
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
      <span className={NAME_CELL} data-cell="name">
        {note === undefined ? (
          <span className={PRESS}>{name}</span>
        ) : (
          <span className={NOTE}>{note}</span>
        )}
      </span>
      {inOrder(cells).map((cell) => cellOf(cell, content[cell]))}
      <span className={MORE_CELL} data-cell="more" />
    </Card>
  );
}

/**
 * A list of task rows standing on its own, outside the Tasks page: one grid
 * of the cells its rows draw (`RELATED_TASK_CELLS` unless said), named by
 * `label`. Its rows are one Tab stop that ↑↓ walk (`useRovingKeys`), and,
 * where it is asked to (`selection`), chosen together as a Mac's list
 * chooses them, by the box in a row's gutter, ⌘-click, ⇧-click, ⇧↑↓, ⌘A,
 * and Esc (`SelectionRegion`), a plain press still opening the task.
 */
export function TaskRows({
  id,
  label,
  cells = RELATED_TASK_CELLS,
  selection,
  children,
}: {
  /** The id a `SelectionBar` over it names; one is made where none is given. */
  id?: string | undefined;
  label: string;
  /** The cells its rows draw, which they are each handed too. */
  cells?: readonly TaskRowCell[] | undefined;
  /** Which rows are chosen and what hears the next set, where the list chooses rows at all. */
  selection?: ListSelection | undefined;
  /** Its `TaskRow`s. */
  children: ReactNode;
}): React.JSX.Element {
  const made = useId();
  const roving = useRovingKeys<HTMLUListElement>();
  const rows = (
    <ul
      {...roving}
      className={ROWS}
      aria-label={label}
      style={cssCustomProperties({ "--tasks-list-columns": taskRowColumns(cells) })}
    >
      {children}
    </ul>
  );
  return selection === undefined ? (
    rows
  ) : (
    <SelectionRegion id={id ?? made} selection={selection}>
      {rows}
    </SelectionRegion>
  );
}

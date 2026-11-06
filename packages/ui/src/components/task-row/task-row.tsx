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
import {
  reachInRun,
  VIRTUAL_ROWS_ANCHOR,
  type VirtualRowPlace,
  VirtualRows,
  type VirtualRowsHandle,
} from "../virtual-rows/virtual-rows.js";

export const TASK_ROW_CELL = {
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
  SUB_TASKS: LIST_COLUMN.SUB_TASKS,
  UPDATED: TASK_PROPERTY.UPDATED,
  END: "end",
} as const;

export type TaskRowCell = (typeof TASK_ROW_CELL)[keyof typeof TASK_ROW_CELL];

export const TASK_ROW_EDGES = {
  LIST: "list",
  UNCHOSEN: "unchosen",
  BARE: "bare",
} as const;

export type TaskRowEdges = (typeof TASK_ROW_EDGES)[keyof typeof TASK_ROW_EDGES];

const TASK_ROW_CELL_ORDER: readonly TaskRowCell[] = Object.values(TASK_ROW_CELL);

const LEADING: readonly TaskRowCell[] = [
  TASK_ROW_CELL.RELATION,
  TASK_ROW_CELL.PRIORITY,
  TASK_ROW_CELL.KEY,
  TASK_ROW_CELL.STATUS,
];

const QUIET_AFTER: readonly TaskRowCell[] = [
  TASK_ROW_CELL.WAITING,
  TASK_ROW_CELL.REPOSITORY,
  TASK_ROW_CELL.AGENTS,
  TASK_ROW_CELL.SUB_TASKS,
  TASK_ROW_CELL.UPDATED,
];

const MORE_COLUMN = "var(--ui-space-24)";

export const RELATED_TASK_CELLS: readonly TaskRowCell[] = [
  TASK_ROW_CELL.RELATION,
  TASK_ROW_CELL.PRIORITY,
  TASK_ROW_CELL.KEY,
  TASK_ROW_CELL.STATUS,
  TASK_ROW_CELL.ASSIGNEE,
  TASK_ROW_CELL.PULL_REQUESTS,
  TASK_ROW_CELL.SUB_TASKS,
];

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

const CELL =
  "ui-task-row-cell flex items-center gap-item-gap text-caption text-muted-foreground tabular-nums whitespace-nowrap";

const CELL_LEAST = { REST: "min-w-0", UNDER_MORE: "min-w-ui-24" } as const;

const FIT_CHARS = {
  MAKER: 16,
  SUB_TASKS_MARKS: 5,
  WAITING_MARKS: 3,
  REPOSITORY_MARKS: 4,
  UPDATED: 8,
} as const;

const REPOSITORY_MOST_CHARS = 22;

const RELATION_CHIP_MARKS =
  "min(var(--ui-task-row-relation-chars, 0), 1) * (2 * var(--ui-space-8) + 2 * (var(--ui-space-12) + var(--ui-space-4)) + 1ch)";

const PULL_REQUEST_CHIP_MARKS =
  "(2 * var(--ui-space-8) + var(--ui-space-12) + var(--ui-space-4) + 1ch)";

const CELL_FIT: Partial<Record<TaskRowCell, CSSProperties>> = {
  [TASK_ROW_CELL.KEY]: {
    fontFamily: "var(--ui-font-mono)",
    minWidth: "calc(var(--ui-task-row-key-chars, 0) * 1ch)",
  },
  [TASK_ROW_CELL.PULL_REQUESTS]: {
    minWidth: `calc(var(--ui-task-row-pull-requests, 0) * (${PULL_REQUEST_CHIP_MARKS} + var(--ui-task-row-pull-request-chars, 0) * 1ch) + max(0, var(--ui-task-row-pull-requests, 0) - 1) * var(--ui-item-gap))`,
  },
  [TASK_ROW_CELL.RELATION]: {
    minWidth: `calc(var(--ui-task-row-relation-chars, 0) * 1ch + ${RELATION_CHIP_MARKS})`,
  },
  [TASK_ROW_CELL.SUB_TASKS]: { minWidth: "calc(var(--ui-task-row-sub-task-chars, 0) * 1ch)" },
  [TASK_ROW_CELL.WAITING]: { minWidth: "calc(var(--ui-task-row-waiting-chars, 0) * 1ch)" },
  [TASK_ROW_CELL.REPOSITORY]: { minWidth: "calc(var(--ui-task-row-repository-chars, 0) * 1ch)" },
  [TASK_ROW_CELL.AGENTS]: { minWidth: "var(--ui-space-16)" },
  [TASK_ROW_CELL.UPDATED]: { minWidth: `${FIT_CHARS.UPDATED}ch` },
  [TASK_ROW_CELL.CREATOR]: {
    minWidth: `calc(${FIT_CHARS.MAKER}ch + var(--ui-item-gap) + var(--ui-space-20))`,
    justifyContent: "flex-end",
  },
};

const OVER_WHERE_FILLED =
  "pointer-events-none not-empty:pointer-events-auto not-empty:relative not-empty:z-1";

const OVER_ITS_CONTROLS =
  "pointer-events-none relative z-1 [&_a]:pointer-events-auto [&_button]:pointer-events-auto";

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

const AFTER = "ui-task-row-after";

const MORE = "ui-task-row-more z-1 flex items-center";

const ROW_BOX =
  "ui-task-row relative col-span-full grid min-h-tasks-list-row items-center rounded-control py-ui-2 text-foreground [transition:transform_var(--ui-duration-fast)_var(--ui-spring-fast),background-color_var(--ui-duration-hover)_var(--ui-motion-exit),opacity_var(--ui-duration-quick)_var(--ui-motion-exit)] data-[menu-open=true]:bg-muted data-[menu-open=true]:shadow-menu-open-edge hover:bg-muted";

const ROW_FRAME = `${ROW_BOX} grid-cols-subgrid`;

const PLACED_FRAME = `${ROW_BOX} grid-cols-tasks-list gap-x-block-gap`;

const ROW = {
  [TASK_ROW_EDGES.LIST]: `${ROW_FRAME} px-row-inset ps-select-gutter`,
  [TASK_ROW_EDGES.UNCHOSEN]: `${ROW_FRAME} px-row-inset`,
  [TASK_ROW_EDGES.BARE]: `${ROW_FRAME} px-row-inset`,
} as const satisfies Record<TaskRowEdges, string>;

const PLACED_ROW = {
  [TASK_ROW_EDGES.LIST]: `${PLACED_FRAME} px-row-inset ps-select-gutter`,
  [TASK_ROW_EDGES.UNCHOSEN]: `${PLACED_FRAME} px-row-inset`,
  [TASK_ROW_EDGES.BARE]: `${PLACED_FRAME} px-row-inset`,
} as const satisfies Record<TaskRowEdges, string>;

const DRAFT_ROW = `${ROW_FRAME} px-task-row-draft ui-task-row-draft`;

const NAME_CELL =
  "ui-task-row-cell pointer-events-auto order-4 flex min-w-0 flex-col items-stretch gap-0 text-label tabular-nums whitespace-nowrap";

const NAME_INK = { REST: "text-foreground", SETTLED: "text-muted-foreground" } as const;

const NESTED = "ps-list-row-nest";

const PRESS = "ui-task-row-press flex min-w-0 items-center";

const NAME_WEIGHT = { REST: "font-ui-medium", UNREAD: "font-emphasis" } as const;

const BESIDE = "ui-task-row-beside ms-icon-gap inline-flex flex-none items-center";

const EDITOR = "ui-task-row-press flex min-w-0 items-center font-ui-regular";

const NOTE = "ui-task-row-note text-caption text-danger";

const FOLDS = "ui-task-row-folds flex min-w-0 items-center";

const FOLD =
  "ui-task-row-fold relative z-1 me-icon-gap grid min-h-control-icon min-w-control-icon flex-none cursor-press place-items-center rounded-control border-0 bg-transparent p-0 text-muted-foreground";

const ROWS =
  "ui-task-rows m-0 grid list-none grid-cols-tasks-list content-start gap-x-block-gap gap-y-0 p-0";

const FOLD_KEY_OPENS: Readonly<Record<string, boolean>> = { ArrowRight: true, ArrowLeft: false };

function inOrder(cells: readonly TaskRowCell[]): readonly TaskRowCell[] {
  return TASK_ROW_CELL_ORDER.filter((cell) => cells.includes(cell));
}

function cellUnderMore(cells: readonly TaskRowCell[]): TaskRowCell | undefined {
  const last = inOrder(cells).at(-1);
  return last !== undefined && QUIET_AFTER.includes(last) ? last : undefined;
}

function RowCell({
  cell,
  underMore,
  placed,
  children,
}: {
  cell: TaskRowCell;
  underMore: TaskRowCell | undefined;
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

function RowItem({
  edges,
  placed = false,
  ...item
}: Omit<ComponentPropsWithRef<"li">, "className"> & {
  edges: TaskRowEdges;
  placed?: boolean;
}): React.JSX.Element {
  return <li {...item} className={placed ? PLACED_ROW[edges] : ROW[edges]} />;
}

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

export interface TaskRowWords {
  readonly key?: string | undefined;
  readonly relation?: string | undefined;
  readonly pullRequests?: readonly string[] | undefined;
  readonly subTasks?: string | undefined;
  readonly waiting?: string | undefined;
  readonly repository?: string | undefined;
}

function mostChars(words: Iterable<string | undefined>): number {
  let most = 0;
  for (const each of words) most = Math.max(most, each?.length ?? 0);
  return most;
}

function withMarks(chars: number, marks: number): number {
  return chars === 0 ? 0 : chars + marks;
}

export function taskRowFit(rows: readonly TaskRowWords[]): CSSProperties {
  const pullRequests = rows.map((row) => row.pullRequests ?? []);
  return cssCustomProperties({
    "--ui-task-row-key-chars": mostChars(rows.map((row) => row.key)),
    "--ui-task-row-relation-chars": mostChars(rows.map((row) => row.relation)),
    "--ui-task-row-pull-requests": pullRequests.reduce(
      (most, each) => Math.max(most, each.length),
      0,
    ),
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

export function taskRowColumns(cells: readonly TaskRowCell[], more = true): string {
  const drawn = inOrder(cells);
  const width = (cell: TaskRowCell) => COLUMN_WIDTH[cell];
  const before = drawn.filter((cell) => LEADING.includes(cell)).map(width);
  const after = drawn.filter((cell) => !LEADING.includes(cell)).map(width);
  const moreColumn = more && cellUnderMore(cells) === undefined ? [MORE_COLUMN] : [];
  return [...before, "minmax(0, 1fr)", ...after, ...moreColumn].join(" ");
}

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
  taskId: string;
  name: string;
  said?: ReactNode;
  beside?: ReactNode;
  cells: readonly TaskRowCell[];
  content: Partial<Record<TaskRowCell, ReactNode>>;
  editor?: ReactNode;
  note?: ReactNode;
  menu?: ListRowMenu | undefined;
  more?: boolean | undefined;
  edges?: TaskRowEdges | undefined;
  disabled?: boolean | undefined;
  onOpen: () => void;
  pressRef?: RefObject<HTMLButtonElement | null> | undefined;
  depth?: number | undefined;
  nest?: ListRowNest | undefined;
  fold?: ListRowFold | undefined;
  settled?: boolean | undefined;
  unread?: boolean | undefined;
  hint?: { readonly Hint: ListRowHint; readonly label: string } | undefined;
  place?: VirtualRowPlace | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  const own = useRef<HTMLButtonElement | null>(null);
  const press = pressRef ?? own;
  const nameId = useId();
  const item = useRef<HTMLLIElement | null>(null);
  const { ref: placeRef, ...placed } = place ?? {};
  const itemRef = useCallback(
    (element: HTMLLIElement | null) => {
      item.current = element;
      placeRef?.(element);
    },
    [placeRef],
  );
  const bare = edges === TASK_ROW_EDGES.BARE;
  const drawsMore = (more && !bare) || editor !== undefined;
  const rowMenu = useRowMenu(menu, { disabled, opener: press, more: drawsMore });
  const underMore = drawsMore ? cellUnderMore(cells) : undefined;
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

export function TaskRowSkeleton({
  cells,
  name,
  content,
  edges = TASK_ROW_EDGES.LIST,
}: {
  cells: readonly TaskRowCell[];
  name: string;
  content: Partial<Record<TaskRowCell, ReactNode>>;
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

export function TaskRowDraft({
  cells,
  content,
  name,
  note,
  drafting,
  pending,
}: {
  cells: readonly TaskRowCell[];
  content: Partial<Record<TaskRowCell, ReactNode>>;
  name: ReactNode;
  note?: ReactNode;
  drafting: boolean;
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
  id?: string | undefined;
  label: string;
  cells?: readonly TaskRowCell[] | undefined;
  more?: boolean | undefined;
  edges?: TaskRowEdges | undefined;
  selection?: ListSelection | undefined;
  joinsWalk?: boolean | undefined;
  moves?: boolean | undefined;
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

const ROW_ESTIMATE_PX = 36;

export function VirtualTaskRows({
  id,
  label,
  cells = RELATED_TASK_CELLS,
  more = true,
  edges = TASK_ROW_EDGES.LIST,
  selection,
  moves = false,
  scroller,
  shiftedBy,
  keys,
  overscan,
  fit,
  children,
}: {
  id?: string | undefined;
  label: string;
  cells?: readonly TaskRowCell[] | undefined;
  more?: boolean | undefined;
  edges?: TaskRowEdges | undefined;
  selection?: ListSelection | undefined;
  moves?: boolean | undefined;
  scroller: RefObject<HTMLElement | null>;
  shiftedBy?: RefObject<HTMLElement | null> | undefined;
  keys: readonly string[];
  overscan?: number | undefined;
  fit: CSSProperties;
  children: (index: number, place: VirtualRowPlace) => ReactNode;
}): React.JSX.Element {
  const made = useId();
  const run = useRef<VirtualRowsHandle>(null);
  const roving = useRovingKeys<HTMLDivElement>({ reach: reachInRun(run) });
  const rows = (
    <div
      {...roving}
      style={{
        ...fit,
        ...cssCustomProperties({
          "--tasks-list-columns": taskRowColumns(cells, more && edges !== TASK_ROW_EDGES.BARE),
        }),
      }}
    >
      <VirtualRows
        scroller={scroller}
        shiftedBy={shiftedBy}
        keys={keys}
        estimate={ROW_ESTIMATE_PX}
        overscan={overscan}
        anchor={VIRTUAL_ROWS_ANCHOR.START}
        listItems
        moves={moves}
        holdsFocus
        className="ui-task-rows"
        aria-label={label}
        handle={run}
      >
        {children}
      </VirtualRows>
    </div>
  );
  return selection === undefined || edges !== TASK_ROW_EDGES.LIST ? (
    rows
  ) : (
    <SelectionRegion
      id={id ?? made}
      selection={selection}
      order={[keys]}
      bringIn={(key, then) => run.current?.bringIn(key, then) ?? false}
    >
      {rows}
    </SelectionRegion>
  );
}

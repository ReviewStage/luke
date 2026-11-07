/**
 * live-read-binding.ts -- a declared live read (`@repo/features/live-read`) bound to the statements that answer it: the tables they read, the topics that wake it, who it admits, and what its answer carries beside them.
 *
 * A read is declared once in features, which can name no table, and bound
 * once here, in its own file under `reads/`, which holds its statements and
 * its binding and nothing else. The registry (`../sync/live-queries.ts`)
 * holds every binding, and one handler answers every bound read
 * (`answerBoundRead`, `live-procedures.ts`): the caller admitted, the params
 * bound, the parts sealed as the read's mode answers them, and the fields
 * beside them read.
 *
 * A bound read is held on a watch of the topics its params name
 * (`../sync/watch.ts`), so a write to any synced table it reads, each a
 * synced table's declaration (`@repo/database/sync/sync-table`), wakes it
 * within a coalesce window. A read whose topics its params don't name, such
 * as the reader's workspaces, looks them up on each request: the rows it
 * reads move when they change, so the next request after such a change
 * looks them up again.
 *
 * In `LIVE_MODE.SNAPSHOT` a wake runs the read again and answers it whole
 * where its digest moved. In `LIVE_MODE.CURSOR` the parts a reader follows
 * by cursor (`cursor.parts`) are answered only past where it holds them:
 * the rows written or amended since, which it joins onto its own, and the
 * cursor to read past next, read before the rows (`cursor.standing`), so a
 * write that lands meanwhile is read again rather than missed; a reader
 * whose cursor a rewind left behind is answered them whole. Its other parts
 * answer as a snapshot's do, and a reader that names no cursor is answered
 * every part whole. The registry test (`../sync/live-query.test.ts`) holds
 * each bound read's statements, past a cursor too, to the tables it names
 * and to no column those tables ignore.
 *
 * In `LIVE_MODE.DELTA` a reader that names a sync id (`LIVE_POLL.SYNC`) is
 * answered what moved past it alone (`delta`): the log's rows between that
 * id and the settled one (`@repo/database/models/sync-log`), the reader's
 * topics reach (`reach`, its own topics where it names none) or of a table
 * it takes whatever they name, narrow each part's statement to the rows
 * they could move (`statements`), and a part's own row (`own`, by its
 * declared key) a write the reader's topics reach moved, and the narrowed
 * read no longer finds, is answered gone. A write to one of its `whole`
 * tables that names the reader's account, what admits it to the rows,
 * answers it whole, as a reader too far behind is; one that names no sync
 * id is answered as a snapshot's reader is. Every table such a read reads
 * is logged.
 *
 * Each part's statement is built through `liveRowsStatement`, whose
 * selection compiles only where its columns are the part's declared row on
 * its encoded side: the same keys, each column's type assignable to its
 * field's, and null on both or neither. Its order is the part's own,
 * appended to the statement as the declaration names it, so the rows a poll
 * answers stand as the reader orders the ones it holds.
 */

import {
  type LiveSelect,
  type LiveSelection,
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@repo/database/core/live-statement";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import type { SyncTable } from "@repo/database/sync/sync-table";
import {
  type AnyLiveRead,
  type AnyLiveRows,
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadParams,
  ORDER,
} from "@repo/features/live-read";
import type { SealedLiveQueryWire } from "@repo/features/live-wire";
import {
  asc,
  type Column,
  desc,
  type GetColumnData,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { Duration, type Effect, Option, type Schema } from "effect";
import type { HostedRefusal } from "../http/http-effect.js";
import type { WebServices } from "../runtime.js";
import type { LiveReadName, LiveTopics, SyncMoved } from "../sync/live-query.js";

/** How often a held poll looks at a read a surface watches closely, such as a Mac's commands or an agent's browser tabs. */
export const WATCHED_LOOK = Duration.seconds(1);

/** A selection's columns: each a column or a typed expression, under the key its row names it by. */
type LiveColumns = Readonly<Record<string, SQLWrapper>>;

/** No instants. */
type NoInstants = Readonly<Record<never, SQLWrapper>>;

/** What a selection's rows answer, by key. */
type SelectedRow<Columns, Instants> = {
  readonly [Key in keyof LiveSelection<Columns, Instants>]: LiveSelection<
    Columns,
    Instants
  >[Key] extends SQL.Aliased<infer Value>
    ? Value
    : never;
};

/** Whether a selected value may stand for a declared field: its type assignable to the field's, and null on both or neither. */
type Agrees<Selected, Declared> = [Selected] extends [Declared]
  ? (null extends Selected ? true : false) extends (null extends Declared ? true : false)
    ? true
    : false
  : false;

/** The keys where a selection and a declared row disagree: one only either names, or one whose value does not agree. */
type Disagreeing<Selected, Declared> = {
  readonly [Key in keyof Selected | keyof Declared]-?: Key extends keyof Selected
    ? Key extends keyof Declared
      ? Agrees<Selected[Key], Declared[Key]> extends true
        ? never
        : Key
      : Key
    : Key;
}[keyof Selected | keyof Declared];

/** Nothing where a selection is its part's row; otherwise a field the selection cannot satisfy, naming the keys that disagree. */
type RowTie<Part extends AnyLiveRows, Columns, Instants> = [
  Disagreeing<SelectedRow<Columns, Instants>, Part["row"]["Encoded"]>,
] extends [never]
  ? unknown
  : {
      readonly "the selection disagrees with its declared row at": `${Disagreeing<
        SelectedRow<Columns, Instants>,
        Part["row"]["Encoded"]
      > &
        string}`;
    };

/** A select built so far, which takes its order last. */
interface Orderable {
  orderBy(...columns: SQL[]): LiveSelect;
}

/** A part's columns: those selected as they are, and its instants as epoch milliseconds. */
interface LivePartColumns<Columns extends LiveColumns, Instants extends LiveColumns> {
  readonly columns: Columns;
  readonly instants?: Instants;
  /** Whether the statement orders its rows as the part declares; `false` leaves the order to the reader alone (`orderedLiveRows`), as a statement that never ordered them did. */
  readonly ordered?: boolean;
}

/** A column read across an outer join, which answers null where the join finds no row, typed so. */
export function outerJoined<Joined extends Column>(
  column: Joined,
): SQL<GetColumnData<Joined> | null> {
  return sql<GetColumnData<Joined> | null>`${column}`;
}

/**
 * A column read as the type its row declares where that is narrower than
 * the column's, such as a nullable column a statement reads only where it
 * is set: the column itself in the statement, so a select of one table
 * writes it bare, as it would the column, where `sql<T>` would qualify it.
 */
export function columnAs<Declared>(column: Column): SQLWrapper<Declared> {
  // SAFETY: the column renders as itself; only the type a row is held to narrows.
  return column as unknown as SQLWrapper<Declared>;
}

/**
 * A select that orders itself, such as one that takes its newest row alone
 * by columns it never selects, built for an unordered part (`ordered:
 * false`): the reader orders the rows it holds by the part's declared
 * order, and the statement's own stands as written. Fails where it is
 * handed a declared order, which would stand after its own.
 */
export function ownOrder(select: LiveSelect): Orderable {
  return {
    orderBy: (...columns) => {
      if (columns.length > 0) throw new Error("a statement that orders itself takes no order");
      return select;
    },
  };
}

/**
 * One part's statement: its columns selected under its row's keys
 * (`liveSelection`), the select `build` makes of them, and the part's
 * declared order after it; none where it names a value a live statement
 * cannot bind. It compiles only where the columns are the part's row.
 */
export function liveRowsStatement<
  Part extends AnyLiveRows,
  const Columns extends LiveColumns,
  const Instants extends LiveColumns = NoInstants,
>(
  part: Part,
  selected: LivePartColumns<Columns, Instants> & RowTie<Part, Columns, Instants>,
  build: (selection: LiveSelection<Columns, Instants>) => Orderable,
): Option.Option<LiveStatement> {
  const instants: LiveColumns = selected.instants ?? {};
  const columns: LiveColumns = selected.columns;
  // Note that an unordered part orders by nothing, which renders no `order by`, so its statement stays as it was written before it was declared.
  const declared = selected.ordered === false ? [] : part.order;
  const order = declared.map(([field, way]) => {
    const column = columns[field] ?? instants[field];
    if (column === undefined)
      throw new Error(`a live read orders by ${field}, which it does not select`);
    return way === ORDER.ASC ? asc(column) : desc(column);
  });
  return liveStatementOf(
    build(liveSelection(selected.columns, selected.instants)).orderBy(...order),
  );
}

/** What a bound read's answer carries beside its statements. */
type BesideOf<Read extends AnyLiveRead> = Schema.Struct<Read["beside"]>["Type"];

/** A bound read's parts, by name. */
export type PartOf<Read extends AnyLiveRead> = keyof Read["parts"] & string;

/** Each part's statement, built for the params bound. */
type PartStatements<Read extends AnyLiveRead> = {
  readonly [Part in keyof Read["parts"]]: Option.Option<LiveStatement>;
};

/** What a bound read's handler is handed of the request: the request itself, and the params it bound. */
interface LiveReadRequest<Read extends AnyLiveRead> {
  readonly request: Request;
  readonly params: LiveReadParams<Read>;
}

/** The params a bound read's service binds itself (`LIVE_PARAM.SERVED`), each as text. */
type ServedParams<Read extends AnyLiveRead> = Readonly<{
  [Key in keyof Read["params"] & string as Read["params"][Key] extends typeof LIVE_PARAM.SERVED
    ? Key
    : never]: string;
}>;

/** Where a cursor read stands now: the cursor to read past next, where every row read after this stands at least, and whether a reader's cursor still stands, which a rewind past it ends. */
interface LiveCursorStanding {
  readonly next: string;
  stands(asked: string): boolean;
}

/** How a read in `LIVE_MODE.CURSOR` follows its cursor parts. */
interface LiveCursorBinding<Read extends AnyLiveRead> {
  /** The parts answered past the reader's cursor rather than whole. */
  readonly parts: readonly PartOf<Read>[];
  /** Where the read stands now, read before its rows. */
  standing(
    params: LiveReadParams<Read>,
  ): Effect.Effect<LiveCursorStanding, StoreFailure, DatabaseServices>;
}

/** How a read in `LIVE_MODE.DELTA` answers a reader past a sync id. */
interface LiveDeltaBinding<Read extends AnyLiveRead> {
  /** The tables a write to which naming the reader's account answers the read whole: what admits it to the rows. */
  readonly whole: readonly SyncTable[];
  /** The tables whose moved rows are taken whatever topics they name, since they name none of a reader's; their keys only narrow statements that keep their own rule of who reads them. */
  readonly anyTopic: readonly SyncTable[];
  /** The topics a moved row must name to be taken, where they are wider than those the read is woken on; those where left out. */
  reach?(params: LiveReadParams<Read>): LiveTopics;
  /** The table each part's own rows are read from, of the parts whose rows can leave it, each keyed by its declared key, which a log row names it by; a part not named answers none gone. */
  readonly own: Readonly<Partial<Record<PartOf<Read>, SyncTable>>>;
  /** The read's statements, each narrowed to the rows what moved could move. */
  statements(params: LiveReadParams<Read>, moved: SyncMoved): PartStatements<Read>;
}

/** The read's query as the reader asked it, each field as text or left out: for a check a param bound as text cannot make, such as whether the reader named it at all. */
type LiveReadQuery = Readonly<Record<string, string | undefined>>;

/** How the service answers a bound read beside its statements: who it admits, the params it binds itself, how often a held poll looks, the fields beside its rows, and what it measures. */
interface LiveReadAnswering<Read extends AnyLiveRead> {
  /** Whether the caller, already the account the read names, may read it; refused otherwise. */
  admit?(
    params: LiveReadParams<Read>,
    query: LiveReadQuery,
  ): Effect.Effect<void, HostedRefusal, WebServices>;
  /** The params it binds itself, given those its query bound; required where it declares one. */
  serve?(
    params: Omit<LiveReadParams<Read>, keyof ServedParams<Read>>,
    query: LiveReadQuery,
  ): Effect.Effect<ServedParams<Read>, HostedRefusal, WebServices>;
  /** How often a held poll looks at it; every three seconds where it names none, every second for a read a surface watches closely (`WATCHED_LOOK`). */
  readonly look?: Duration.Duration;
  /** What the answer carries beside its statements. */
  beside?(asked: LiveReadRequest<Read>): Effect.Effect<BesideOf<Read>, HostedRefusal, WebServices>;
  /** Handed the instant the first write that woke a held answer was heard, once its rows are read. */
  woken?(heardAt: number): Effect.Effect<void>;
  /** Handed each part as answered, for what it measures of them. */
  answered?(queries: Readonly<Record<string, SealedLiveQueryWire>>): Effect.Effect<void>;
}

/** How a declared read is answered by the service. */
export interface LiveReadBinding<Read extends AnyLiveRead, Topics extends LiveTopics = LiveTopics>
  extends LiveReadAnswering<Read> {
  /** The synced tables its statements read. */
  readonly reads: readonly SyncTable[];
  /** The topics a write to its rows notifies, for the params bound, or how to look them up. */
  topics(params: LiveReadParams<Read>): Topics;
  /** Each part's statement, for the params bound (`liveRowsStatement`), a cursor read's cursor parts past `past` where a cursor is named. */
  statements(params: LiveReadParams<Read>, past?: string): PartStatements<Read>;
  /** How its cursor parts are followed: required of a read in `LIVE_MODE.CURSOR`, and of no other. */
  readonly cursor?: LiveCursorBinding<Read>;
  /** How it answers a reader past a sync id: required of a read in `LIVE_MODE.DELTA`, and of no other. */
  readonly delta?: LiveDeltaBinding<Read>;
}

/** A delta read's statements and own rows as the procedures read them: every part built, and each own part's table under its declared key. */
interface BoundDelta<Read extends AnyLiveRead> {
  readonly whole: readonly SyncTable[];
  readonly anyTopic: readonly SyncTable[];
  reach?(params: LiveReadParams<Read>): LiveTopics;
  readonly own: ReadonlyMap<PartOf<Read>, { readonly table: SyncTable; readonly key: string }>;
  statements(
    params: LiveReadParams<Read>,
    moved: SyncMoved,
  ): Option.Option<Readonly<Record<PartOf<Read>, LiveStatement>>>;
}

/** A declared read bound: the live read Sync wakes under its declaration's name, its params, the tables it reads, and how its caller is admitted and its answer completed. */
export interface BoundLiveRead<
  Read extends AnyLiveRead = AnyLiveRead,
  Topics extends LiveTopics = LiveTopics,
> extends LiveReadAnswering<Read> {
  readonly declaration: Read;
  readonly name: LiveReadName;
  /** The params its statements are bound to, by the key the declaration names each under. */
  readonly params: readonly (keyof Read["params"] & string)[];
  readonly reads: readonly SyncTable[];
  topics(params: LiveReadParams<Read>): Topics;
  /** Every part's statement, a cursor read's cursor parts past `past` where one is named; none where one can't be built. */
  statements(
    params: LiveReadParams<Read>,
    past?: string,
  ): Option.Option<Readonly<Record<PartOf<Read>, LiveStatement>>>;
  readonly cursor?: LiveCursorBinding<Read>;
  readonly delta?: BoundDelta<Read>;
}

/** Any bound read, as the registry holds it and its tests read it: what Sync wakes it on and its statements, whatever its declaration names. */
export interface AnyBoundRead {
  readonly declaration: AnyLiveRead;
  readonly name: LiveReadName;
  readonly params: readonly string[];
  readonly reads: readonly SyncTable[];
  topics(params: Readonly<Record<string, string>>): LiveTopics;
  statements(
    params: Readonly<Record<string, string>>,
    past?: string,
  ): Option.Option<Readonly<Record<string, LiveStatement>>>;
  readonly cursor?: {
    standing(
      params: Readonly<Record<string, string>>,
    ): Effect.Effect<LiveCursorStanding, StoreFailure, DatabaseServices>;
  };
  readonly delta?: {
    statements(
      params: Readonly<Record<string, string>>,
      moved: SyncMoved,
    ): Option.Option<Readonly<Record<string, LiveStatement>>>;
  };
}

/** Every part's statement built, or none where one can't be. */
function allBuilt<Read extends AnyLiveRead>(
  statements: PartStatements<Read>,
): Option.Option<Readonly<Record<PartOf<Read>, LiveStatement>>> {
  // SAFETY: every part's statement is built, under the part's own name.
  return Option.all(statements) as Option.Option<Readonly<Record<PartOf<Read>, LiveStatement>>>;
}

/** A delta read's own parts, each with its table and the key its part declares; fails where a table's log names its rows by no such key, since none of its rows could be answered gone. */
function ownParts<Read extends AnyLiveRead>(
  read: Read,
  own: LiveDeltaBinding<Read>["own"],
): BoundDelta<Read>["own"] {
  const parts = new Map<PartOf<Read>, { readonly table: SyncTable; readonly key: string }>();
  // SAFETY: `own`'s keys are parts of the read, each naming its table or none.
  for (const [part, table] of Object.entries(own) as [PartOf<Read>, SyncTable | undefined][]) {
    if (table === undefined) continue;
    const key = read.parts[part]?.key ?? "";
    if (!table.log?.key.includes(key)) {
      throw new Error(
        `the live read ${read.name}'s ${part} is keyed by ${key}, which ${table.name}'s log names no row by`,
      );
    }
    parts.set(part, { table, key });
  }
  return parts;
}

/**
 * Binds a declared read to the statements that answer it, as a live read
 * Sync wakes under the declaration's name, params, and mode. Fails where it
 * reads no table, since nothing could wake it, where its mode and its
 * cursor or delta binding disagree, where it serves a param it binds
 * nowhere, and where it answers deltas but reads a table the log does not
 * see, since a write to one the log never saw would move a row no delta
 * carries.
 */
export function bindLiveRead<
  Read extends AnyLiveRead & { readonly name: LiveReadName },
  Topics extends LiveTopics,
>(read: Read, binding: LiveReadBinding<Read, Topics>): BoundLiveRead<Read, Topics> {
  if (binding.reads.length === 0) throw new Error(`the live read ${read.name} reads no table`);
  const cursor = binding.cursor !== undefined && binding.cursor.parts.length > 0;
  if (cursor !== (read.mode === LIVE_MODE.CURSOR))
    throw new Error(`the live read ${read.name} names cursor parts only in cursor mode`);
  if ((binding.delta !== undefined) !== (read.mode === LIVE_MODE.DELTA))
    throw new Error(`the live read ${read.name} answers deltas only in delta mode`);
  const unlogged = binding.reads.find((table) => table.log === undefined);
  if (binding.delta !== undefined && unlogged !== undefined) {
    throw new Error(
      `the live read ${read.name} answers deltas but reads ${unlogged.name}, which no log row records`,
    );
  }
  const served = Object.values(read.params).includes(LIVE_PARAM.SERVED);
  if (served && binding.serve === undefined)
    throw new Error(`the live read ${read.name} serves a param it binds nowhere`);
  const { delta, statements, ...answering } = binding;
  return {
    ...answering,
    declaration: read,
    name: read.name,
    // SAFETY: a declaration's params are its keys, each bound as text.
    params: Object.keys(read.params) as (keyof Read["params"] & string)[],
    statements: (params, past) => allBuilt(statements(params, past)),
    ...(delta === undefined
      ? undefined
      : {
          delta: {
            ...delta,
            own: ownParts(read, delta.own),
            statements: (params, moved) => allBuilt(delta.statements(params, moved)),
          },
        }),
  };
}

/** The bound reads by the name each answers. Fails where two bind one read. */
export function liveReadRegistry(
  reads: readonly AnyBoundRead[],
): ReadonlyMap<LiveReadName, AnyBoundRead> {
  const registry = new Map<LiveReadName, AnyBoundRead>();
  for (const read of reads) {
    if (registry.has(read.name)) throw new Error(`the live read ${read.name} is bound twice`);
    registry.set(read.name, read);
  }
  return registry;
}

/**
 * live-query.ts -- a live read as Sync wakes it: the synced tables it reads, the topics its params name, and its statements.
 *
 * A live read the desktop follows (`live/live-procedures.ts`) is held until
 * its rows move. One with a definition here is held on a watch of the topics
 * its params name (`watch.ts`), so a write to any table it reads wakes it
 * within a coalesce window, where one without is looked at again every
 * second. A definition names the read by its procedure, the params the
 * procedure binds once it has admitted the caller, the tables the read's
 * statements read, each a synced table's declaration
 * (`@repo/database/sync/sync-table`), so a read can't wait on a table nothing
 * captures, the topics those params wake it on, and the statements
 * themselves, built as the read's builder always built them. A read whose
 * topics its params don't name, such as the reader's workspaces, looks them
 * up on each request: the rows it reads move when they change, so the next
 * request after such a change looks them up again.
 *
 * In `LIVE_MODE.SNAPSHOT` a wake runs the read again and answers it whole
 * where its digest moved. In `LIVE_MODE.CURSOR` the parts a reader follows
 * by cursor (`cursor.parts`) are answered only past where it holds them:
 * the rows written or amended since, which it joins onto its own, and the
 * cursor to read past next, read before the rows (`cursor.standing`), so a
 * write that lands meanwhile is read again rather than missed; a reader
 * whose cursor a rewind left behind is answered them whole. Its other parts
 * answer as a snapshot's do, and a reader that names no cursor is answered
 * every part whole. The registry test (`live-query.test.ts`) holds each
 * registered definition's statements, past a cursor too, to the tables it
 * names and to no column those tables ignore.
 *
 * A read with `delta` also answers a reader that names a sync id
 * (`LIVE_POLL.SYNC`) with what moved past it alone: the log's rows between
 * that id and the settled one (`@repo/database/models/sync-log`), the
 * reader's topics reach or of a table it takes whatever they name, narrow
 * each part's statement to the rows they could move (`statements`), and a
 * part's own row a write the reader's topics reach moved, and the narrowed
 * read no longer finds, is answered gone. A write to one of its `whole`
 * tables that names the reader's account, what admits it to the rows,
 * answers it whole, as a reader too far behind is. Every table such a read
 * reads is logged, since a write to one the log never saw would move a row
 * no delta carries.
 */
import type { LiveStatement } from "@repo/database/core/live-statement";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import type { SyncWindowRow } from "@repo/database/models/sync-log";
import type { SyncTopic, TopicKind } from "@repo/database/sync/notification";
import type { SyncTable } from "@repo/database/sync/sync-table";
import type { hostedContract } from "@repo/features/contract";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Effect, Option } from "effect";

/** How a live read answers a wake: run again and answered whole where its rows moved, or its cursor parts answered past the reader's cursor. */
export const LIVE_MODE = { SNAPSHOT: "snapshot", CURSOR: "cursor" } as const;

type LiveMode = (typeof LIVE_MODE)[keyof typeof LIVE_MODE];

/** A live read's name: the procedure that answers it. */
export type LiveReadName = keyof (typeof hostedContract)["live"];

/** The values a live read is bound to, by the param each fills: an id, or a list as the read's query spells it. */
export type LiveParams<Param extends string> = Readonly<Record<Param, string>>;

/** Where a cursor read stands now: the cursor to read past next, where every row read after this stands at least, and whether a reader's cursor still stands, which a rewind past it ends. */
interface LiveCursorStanding {
  readonly next: string;
  stands(asked: string): boolean;
}

/** How a read in `LIVE_MODE.CURSOR` follows its cursor parts. */
interface LiveCursorRead<Param extends string, Part extends string> {
  /** The parts answered past the reader's cursor rather than whole. */
  readonly parts: readonly Part[];
  /** Where the read stands now, read before its rows. */
  standing(
    params: LiveParams<Param>,
  ): Effect.Effect<LiveCursorStanding, StoreFailure, DatabaseServices>;
}

/** What moved past a delta reader's sync id: the keys of each table's rows, and the ids its rows name under a topic kind. */
export interface SyncMoved {
  /** The values of the column among the keys of the table's moved rows, each once. */
  keys(table: SyncTable, column: PgColumn): readonly string[];
  /** The ids the table's moved rows name under the kind, each once. */
  topics(table: SyncTable, kind: TopicKind): readonly string[];
}

/** A part's own rows: the table they are read from and the column their key stands in, which the part answers each row's id under. */
interface LiveDeltaOwn {
  readonly table: SyncTable;
  readonly key: PgColumn;
}

/** How a read in delta mode answers a reader past a sync id. */
interface LiveDeltaRead<Param extends string, Part extends string> {
  /** The tables a write to which naming the reader's account answers the read whole: what admits it to the rows. */
  readonly whole: readonly SyncTable[];
  /** The tables whose moved rows are taken whatever topics they name, since they name none of a reader's; their keys only narrow statements that keep their own rule of who reads them. */
  readonly anyTopic: readonly SyncTable[];
  /** Each part's own rows, of the parts whose rows can leave it; a part not named answers none gone. */
  readonly own: Readonly<Partial<Record<Part, LiveDeltaOwn>>>;
  /** The read's statements, each narrowed to the rows what moved could move; none where they can't be built. */
  statements(
    params: LiveParams<Param>,
    moved: SyncMoved,
  ): Option.Option<Readonly<Record<Part, LiveStatement>>>;
}

/** The topics a read is woken on: named by its params alone, or looked up from them. */
export type LiveTopics =
  | readonly SyncTopic[]
  | Effect.Effect<readonly SyncTopic[], StoreFailure, DatabaseServices>;

/**
 * One live read's definition. Note that `topics` and `statements` are
 * methods, so a definition over its own params stands in the registry
 * beside every other.
 */
export interface LiveQuery<
  Param extends string = string,
  Part extends string = string,
  Topics extends LiveTopics = LiveTopics,
> {
  readonly name: LiveReadName;
  /** The params the procedure binds, each an id or a list as its query spells it. */
  readonly params: readonly Param[];
  /** The synced tables the statements read. */
  readonly reads: readonly SyncTable[];
  /** The topics a write to the read's rows notifies, for the params bound, or how to look them up. */
  topics(params: LiveParams<Param>): Topics;
  /**
   * The read's statements, a part each, as its builder builds them, its
   * cursor parts past `past` where a cursor is named; none where they can't
   * be built.
   */
  statements(
    params: LiveParams<Param>,
    past?: string,
  ): Option.Option<Readonly<Record<Part, LiveStatement>>>;
  readonly mode: LiveMode;
  /** How its cursor parts are followed, for a read in `LIVE_MODE.CURSOR` alone. */
  readonly cursor?: LiveCursorRead<Param, NoInfer<Part>>;
  /** How it answers a reader past a sync id, for a read that does. */
  readonly delta?: LiveDeltaRead<Param, NoInfer<Part>>;
}

/** The values of a moved row's keys under a column, as text. */
function keyValues(row: SyncWindowRow, column: string): readonly string[] {
  return row.key.flatMap((key) => {
    const value = key[column];
    return value === undefined ? [] : [String(value)];
  });
}

/** Each part's own row keys the window's rows the reader's topics reach moved, by part: what a narrowed read that misses one answers gone. */
export function ownMovedKeys<Part extends string>(
  own: Readonly<Partial<Record<Part, LiveDeltaOwn>>>,
  rows: readonly SyncWindowRow[],
): ReadonlyMap<Part, ReadonlySet<string>> {
  const moved = new Map<Part, ReadonlySet<string>>();
  // SAFETY: `own`'s keys are parts of the read, each naming its own rows or none.
  for (const [part, read] of Object.entries(own) as [Part, LiveDeltaOwn | undefined][]) {
    if (read === undefined) continue;
    const reached = rows.filter((row) => row.reached && row.table === read.table.name);
    moved.set(part, new Set(reached.flatMap((row) => keyValues(row, read.key.name))));
  }
  return moved;
}

/** What the window's rows moved, as a delta read narrows its statements to. */
export function syncMovedOf(rows: readonly SyncWindowRow[]): SyncMoved {
  const of = (table: SyncTable) => rows.filter((row) => row.table === table.name);
  return {
    keys: (table, column) => [...new Set(of(table).flatMap((row) => keyValues(row, column.name)))],
    topics: (table, kind) => [
      ...new Set(
        of(table).flatMap((row) =>
          row.topics.flatMap(([named, id]) => (named === kind ? [id] : [])),
        ),
      ),
    ],
  };
}

/**
 * Defines a live read Sync wakes. Fails where it reads no table, since
 * nothing could wake it, where its mode and its cursor parts disagree, and
 * where it answers deltas but reads a table the log does not see.
 */
export function defineLiveQuery<
  const Param extends string,
  Part extends string,
  Topics extends LiveTopics,
>(query: LiveQuery<Param, Part, Topics>): LiveQuery<Param, Part, Topics> {
  if (query.reads.length === 0) throw new Error(`the live read ${query.name} reads no table`);
  const followsCursor = query.cursor !== undefined && query.cursor.parts.length > 0;
  if (followsCursor !== (query.mode === LIVE_MODE.CURSOR)) {
    throw new Error(`the live read ${query.name} names cursor parts only in cursor mode`);
  }
  const unlogged = query.reads.find((table) => table.log === undefined);
  if (query.delta !== undefined && unlogged !== undefined) {
    throw new Error(
      `the live read ${query.name} answers deltas but reads ${unlogged.name}, which no log row records`,
    );
  }
  return query;
}

/** The definitions by the read each answers. Fails where two define one read. */
export function liveQueryRegistry(
  queries: readonly LiveQuery[],
): ReadonlyMap<LiveReadName, LiveQuery> {
  const registry = new Map<LiveReadName, LiveQuery>();
  for (const query of queries) {
    if (registry.has(query.name)) throw new Error(`the live read ${query.name} is defined twice`);
    registry.set(query.name, query);
  }
  return registry;
}

/**
 * live-query.ts -- a live read as Luke Sync wakes it: the synced tables it reads, the topics its params name, and its statements.
 *
 * A live read the desktop follows (`live/live-procedures.ts`) is held until
 * its rows move. One with a definition here is held on a watch of the topics
 * its params name (`watch.ts`), so a write to any table it reads wakes it
 * within a coalesce window, where one without is looked at again every
 * second. A definition names the read by its procedure, the params the
 * procedure binds once it has admitted the caller, the tables the read's
 * statements read, each a synced table's declaration
 * (`@luke/database/sync/sync-table`), so a read can't wait on a table nothing
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
 */
import type { LiveStatement } from "@luke/database/core/live-statement";
import type { DatabaseServices, StoreFailure } from "@luke/database/core/query";
import type { SyncTopic } from "@luke/database/sync/notification";
import type { SyncTable } from "@luke/database/sync/sync-table";
import type { hostedContract } from "@luke/features/contract";
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
}

/**
 * Defines a live read Luke Sync wakes. Fails where it reads no table, since
 * nothing could wake it, and where its mode and its cursor parts disagree.
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

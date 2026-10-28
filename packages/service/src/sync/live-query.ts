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
 * themselves, built as the read's builder always built them.
 *
 * Only `LIVE_MODE.SNAPSHOT` stands: on a wake the read is run again and
 * answered whole where its digest moved. The registry test
 * (`live-query.test.ts`) holds each registered definition's statements to the
 * tables it names and to no column those tables ignore.
 */
import type { LiveStatement } from "@luke/database/core/live-statement";
import type { SyncTopic } from "@luke/database/sync/notification";
import type { SyncTable } from "@luke/database/sync/sync-table";
import type { hostedContract } from "@luke/features/contract";
import type { Option } from "effect";

/** How a live read answers a wake: run again, and answered whole where its rows moved. */
export const LIVE_MODE = { SNAPSHOT: "snapshot" } as const;

type LiveMode = (typeof LIVE_MODE)[keyof typeof LIVE_MODE];

/** A live read's name: the procedure that answers it. */
export type LiveReadName = keyof (typeof hostedContract)["live"];

/** The values a live read is bound to, by the param each fills: an id, or a list as the read's query spells it. */
export type LiveParams<Param extends string> = Readonly<Record<Param, string>>;

/**
 * One live read's definition. Note that `topics` and `statements` are
 * methods, so a definition over its own params stands in the registry
 * beside every other.
 */
export interface LiveQuery<Param extends string = string, Part extends string = string> {
  readonly name: LiveReadName;
  /** The params the procedure binds, each an id or a list as its query spells it. */
  readonly params: readonly Param[];
  /** The synced tables the statements read. */
  readonly reads: readonly SyncTable[];
  /** The topics a write to the read's rows notifies, for the params bound. */
  topics(params: LiveParams<Param>): readonly SyncTopic[];
  /** The read's statements, a part each, as its builder builds them; none where they can't be built. */
  statements(params: LiveParams<Param>): Option.Option<Readonly<Record<Part, LiveStatement>>>;
  readonly mode: LiveMode;
}

/** Defines a live read Luke Sync wakes. Fails where it reads no table, since nothing could wake it. */
export function defineLiveQuery<const Param extends string, Part extends string>(
  query: LiveQuery<Param, Part>,
): LiveQuery<Param, Part> {
  if (query.reads.length === 0) throw new Error(`the live read ${query.name} reads no table`);
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

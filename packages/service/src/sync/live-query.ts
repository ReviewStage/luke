import type { LiveStatement } from "@repo/database/core/live-statement";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import type { SyncWindowRow } from "@repo/database/models/sync-log";
import type { SyncTopic, TopicKind } from "@repo/database/sync/notification";
import type { SyncTable } from "@repo/database/sync/sync-table";
import type { hostedContract } from "@repo/features/contract";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Effect, Option } from "effect";

export const LIVE_MODE = { SNAPSHOT: "snapshot", CURSOR: "cursor" } as const;

type LiveMode = (typeof LIVE_MODE)[keyof typeof LIVE_MODE];

export type LiveReadName = keyof (typeof hostedContract)["live"];

export type LiveParams<Param extends string> = Readonly<Record<Param, string>>;

interface LiveCursorStanding {
  readonly next: string;
  stands(asked: string): boolean;
}

interface LiveCursorRead<Param extends string, Part extends string> {
  readonly parts: readonly Part[];
  standing(
    params: LiveParams<Param>,
  ): Effect.Effect<LiveCursorStanding, StoreFailure, DatabaseServices>;
}

export interface SyncMoved {
  keys(table: SyncTable, column: PgColumn): readonly string[];
  topics(table: SyncTable, kind: TopicKind): readonly string[];
}

interface LiveDeltaOwn {
  readonly table: SyncTable;
  readonly key: PgColumn;
}

interface LiveDeltaRead<Param extends string, Part extends string> {
  readonly whole: readonly SyncTable[];
  readonly anyTopic: readonly SyncTable[];
  reach?(params: LiveParams<Param>): LiveTopics;
  readonly own: Readonly<Partial<Record<Part, LiveDeltaOwn>>>;
  statements(
    params: LiveParams<Param>,
    moved: SyncMoved,
  ): Option.Option<Readonly<Record<Part, LiveStatement>>>;
}

export type LiveTopics =
  | readonly SyncTopic[]
  | Effect.Effect<readonly SyncTopic[], StoreFailure, DatabaseServices>;

export interface LiveQuery<
  Param extends string = string,
  Part extends string = string,
  Topics extends LiveTopics = LiveTopics,
> {
  readonly name: LiveReadName;
  readonly params: readonly Param[];
  readonly reads: readonly SyncTable[];
  topics(params: LiveParams<Param>): Topics;
  statements(
    params: LiveParams<Param>,
    past?: string,
  ): Option.Option<Readonly<Record<Part, LiveStatement>>>;
  readonly mode: LiveMode;
  readonly cursor?: LiveCursorRead<Param, NoInfer<Part>>;
  readonly delta?: LiveDeltaRead<Param, NoInfer<Part>>;
}

function keyValues(row: SyncWindowRow, column: string): readonly string[] {
  return row.key.flatMap((key) => {
    const value = key[column];
    return value === undefined ? [] : [String(value)];
  });
}

export function ownMovedKeys<Part extends string>(
  own: Readonly<Partial<Record<Part, LiveDeltaOwn>>>,
  rows: readonly SyncWindowRow[],
): ReadonlyMap<Part, ReadonlySet<string>> {
  const moved = new Map<Part, ReadonlySet<string>>();
  for (const [part, read] of Object.entries(own) as [Part, LiveDeltaOwn | undefined][]) {
    if (read === undefined) continue;
    const reached = rows.filter((row) => row.reached && row.table === read.table.name);
    moved.set(part, new Set(reached.flatMap((row) => keyValues(row, read.key.name))));
  }
  return moved;
}

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

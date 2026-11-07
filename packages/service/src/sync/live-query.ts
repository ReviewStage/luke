/**
 * live-query.ts -- what every live read Sync wakes shares: its name, its params bound as text, the topics they name, and what moved past a delta reader's sync id.
 *
 * A live read is declared once (`@repo/features/live-read`) and bound once
 * (`../live/live-read-binding.ts`); this holds the vocabulary a binding and
 * the procedures that answer it (`../live/live-procedures.ts`) share: the
 * window of the sync log a delta reader is answered from, read as the keys
 * and topics its rows moved (`syncMovedOf`), and each part's own rows among
 * them (`ownMovedKeys`).
 */
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import type { SyncWindowRow } from "@repo/database/models/sync-log";
import type { SyncTopic, TopicKind } from "@repo/database/sync/notification";
import type { SyncTable } from "@repo/database/sync/sync-table";
import type { hostedContract } from "@repo/features/contract";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Effect } from "effect";

/** A live read's name: the procedure that answers it. */
export type LiveReadName = keyof (typeof hostedContract)["live"];

/** The values a live read is bound to, by the param each fills: an id, or a list as the read's query spells it. */
export type LiveParams<Param extends string> = Readonly<Record<Param, string>>;

/** What moved past a delta reader's sync id: the keys of each table's rows, and the ids its rows name under a topic kind. */
export interface SyncMoved {
  /** The values of the column among the keys of the table's moved rows, each once. */
  keys(table: SyncTable, column: PgColumn): readonly string[];
  /** The ids the table's moved rows name under the kind, each once. */
  topics(table: SyncTable, kind: TopicKind): readonly string[];
}

/** The topics a read is woken on: named by its params alone, or looked up from them. */
export type LiveTopics =
  | readonly SyncTopic[]
  | Effect.Effect<readonly SyncTopic[], StoreFailure, DatabaseServices>;

/** The values of a moved row's keys under a column, as text. */
function keyValues(row: SyncWindowRow, column: string): readonly string[] {
  return row.key.flatMap((key) => {
    const value = key[column];
    return value === undefined ? [] : [String(value)];
  });
}

/** Each part's own row keys the window's rows the reader's topics reach moved, by part, each read under the key its part declares: what a narrowed read that misses one answers gone. */
export function ownMovedKeys<Part extends string>(
  own: ReadonlyMap<Part, { readonly table: SyncTable; readonly key: string }>,
  rows: readonly SyncWindowRow[],
): ReadonlyMap<Part, ReadonlySet<string>> {
  const moved = new Map<Part, ReadonlySet<string>>();
  for (const [part, read] of own) {
    const reached = rows.filter((row) => row.reached && row.table === read.table.name);
    moved.set(part, new Set(reached.flatMap((row) => keyValues(row, read.key))));
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

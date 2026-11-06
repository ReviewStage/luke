import { type Collection, createCollection, type SyncConfig, type UtilsRecord } from "@tanstack/db";
import { Effect, Equal, type Scope } from "effect";

export const KEPT_BY_SCOPE = 0;

export type RowCollection<Row extends object, Key extends string> = Collection<
  Row,
  Key,
  UtilsRecord,
  never
>;

type RowChange<Row extends object, Key extends string> =
  | { readonly type: "insert"; readonly value: Row }
  | { readonly type: "update"; readonly value: Row }
  | { readonly type: "delete"; readonly key: Key };

type SyncWriter<Row extends object, Key extends string> = Parameters<
  SyncConfig<Row, Key>["sync"]
>[0];

export function rowChanges<Row extends object, Key extends string>(
  held: ReadonlyMap<Key, Row>,
  next: ReadonlyMap<Key, Row>,
): RowChange<Row, Key>[] {
  const gone = [...held.keys()]
    .filter((key) => !next.has(key))
    .map((key) => ({ type: "delete" as const, key }));
  const moved = [...next].flatMap(([key, row]): RowChange<Row, Key>[] => {
    const was = held.get(key);
    if (was === undefined) return [{ type: "insert", value: row }];
    return Equal.equals(was, row) ? [] : [{ type: "update", value: row }];
  });
  return [...gone, ...moved];
}

const readRows = new WeakMap<object, object>();

export function rowOf<Row extends object>(stored: object): Row {
  let read = readRows.get(stored);
  if (read === undefined) {
    read = Object.fromEntries(
      Object.entries(stored).filter(
        ([name, value]) => !name.startsWith("$") && value !== undefined,
      ),
    );
    readRows.set(stored, read);
  }
  return read as Row;
}

export function scopedCollection<Made extends { cleanup(): Promise<void> }>(
  make: () => Made,
): Effect.Effect<Made, never, Scope.Scope> {
  return Effect.acquireRelease(Effect.sync(make), (made) => Effect.promise(() => made.cleanup()));
}

export interface SyncedCollection<Row extends object, Key extends string> {
  readonly collection: RowCollection<Row, Key>;
  readonly held: () => ReadonlyMap<Key, Row>;
  readonly take: (next: ReadonlyMap<Key, Row>) => readonly Key[];
}

export function syncedCollection<Row extends object, Key extends string>(
  getKey: (row: Row) => Key,
): Effect.Effect<SyncedCollection<Row, Key>, never, Scope.Scope> {
  return Effect.gen(function* () {
    let writer: SyncWriter<Row, Key> | undefined;
    let held: ReadonlyMap<Key, Row> = new Map();
    const collection = yield* scopedCollection(() =>
      createCollection<Row, Key>({
        getKey,
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
        sync: {
          rowUpdateMode: "full",
          sync: (handed) => {
            writer = handed;
            handed.begin();
            handed.commit();
            handed.markReady();
            return () => {
              writer = undefined;
            };
          },
        },
      }),
    );
    const take = (next: ReadonlyMap<Key, Row>): readonly Key[] => {
      const changes = rowChanges(held, next);
      if (writer === undefined || changes.length === 0) return [];
      writer.begin();
      for (const change of changes) writer.write(change);
      writer.commit();
      held = next;
      return changes.map((change) =>
        change.type === "delete" ? change.key : getKey(change.value),
      );
    };
    return { collection, held: () => held, take };
  });
}
